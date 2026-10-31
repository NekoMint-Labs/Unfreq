# 服务器迁移

迁移前先保留旧服务器，不要先下线。新服务器验收通过后再切 DNS 或反代入口。

## 迁移前检查

- 记录旧服务器代码分支、commit、域名、`WEB_ORIGIN`、`UNFREQ_PROXY_NETWORK`。
- 确认旧服务器 `docker compose ps` 全部健康。
- 确认旧服务器能通过公网访问 `/health`、`/health/deep`、`/web-health`、`/galaxy`。
- 确认 `.env` 已单独保存。不要提交到 Git。
- 确认旧服务器有足够空间写 PostgreSQL 备份和 volume 归档。
- 确认新服务器已安装 Docker 和 Docker Compose。
- 确认新服务器已创建反代 Docker 网络。默认网络名是 `npm_default`。
- 备份前冻结写入和 worker/scheduler，记录 SQL、媒体和配置的同一检查点；pg_dump 不提供跨卷原子快照。恢复时关闭应用及外部入口，准备可追溯的较新撤回/审核/删除状态依据。

## 必须带走的数据

- `.env`：包含 `WEB_ORIGIN`、`SESSION_SECRET`、`PROVIDER_CONFIG_SECRET` 和 Provider Key。
- `postgres-data`：业务主数据。使用 `server backup` 导出 SQL 备份。
- `api-image-storage`：图片上传文件，挂载在 API 容器 `/app/storage/images`。
- `api-audio-storage`：生成的音频文件，挂载在 API 容器 `/app/storage/audio/programs`。
- `redis-data`：登录挑战、一次性状态及共享请求/Provider 预算；账号和持久生成任务在 PostgreSQL。旧 AOF 的恢复、过期挑战和额度衔接须单独验收。

## 旧服务器备份

```bash
mkdir -p /srv/unfreq/backups
chmod 700 /srv/unfreq/backups
umask 077
UNFREQ_BACKUP_FILE=/srv/unfreq/backups/unfreq-postgres-pre-migration.sql.gz ./scripts/deployment-stack.sh server backup
docker run --rm -v unfreq_api-image-storage:/data -v /srv/unfreq/backups:/backup alpine tar -czf /backup/unfreq-images-pre-migration.tar.gz -C /data .
docker run --rm -v unfreq_api-audio-storage:/data -v /srv/unfreq/backups:/backup alpine tar -czf /backup/unfreq-audio-pre-migration.tar.gz -C /data .
docker run --rm -v unfreq_redis-data:/data -v /srv/unfreq/backups:/backup alpine tar -czf /backup/unfreq-redis-pre-migration.tar.gz -C /data .
cp .env /srv/unfreq/backups/unfreq.env
chmod 600 /srv/unfreq/backups/unfreq-images-pre-migration.tar.gz /srv/unfreq/backups/unfreq-audio-pre-migration.tar.gz /srv/unfreq/backups/unfreq-redis-pre-migration.tar.gz /srv/unfreq/backups/unfreq.env
```

如果 Compose project name 不是目录名 `unfreq`，先用 `docker volume ls | grep unfreq` 查真实 volume 名，再替换上面的 `unfreq_*`。

## 新服务器恢复

```bash
git clone https://github.com/your-org/Unfreq.git Unfreq
cd Unfreq
cp /srv/unfreq/backups/unfreq.env .env
docker network inspect npm_default >/dev/null 2>&1 || docker network create npm_default
docker compose up -d postgres
UNFREQ_RESTORE_ISOLATED=true ./scripts/deployment-stack.sh server restore /srv/unfreq/backups/unfreq-postgres-pre-migration.sql.gz
docker run --rm -v unfreq_api-image-storage:/data -v /srv/unfreq/backups:/backup alpine sh -c 'cd /data && tar -xzf /backup/unfreq-images-pre-migration.tar.gz'
docker run --rm -v unfreq_api-audio-storage:/data -v /srv/unfreq/backups:/backup alpine sh -c 'cd /data && tar -xzf /backup/unfreq-audio-pre-migration.tar.gz'
# Redis AOF 的恢复尚未纳入 F2 验收，不在此自动重放。
# 保持 API / Web / proxy 停止，先完成下述恢复核对。
```

把 `git clone` 的仓库地址替换成真实地址。如果 `.env` 里的 `UNFREQ_PROXY_NETWORK` 不是 `npm_default`，按 `.env` 的值创建网络。

## 新服务器验收

PostgreSQL 目标必须为空，不要为绕过保护删除线上表。先验证产物 SHA256、媒体字节、原密钥解密及 pgvector 扩展/查询，再依据较新状态清单复核撤回、审核、删除和公开版本。缺少最新依据时保持入口关闭。核对通过后，在仍隔离外部入口的环境启动服务，再做 smoke；对外开放和 DNS/反代切换由目标环境验收决定。F1 前旧版本还需关闭其默认自动调度入口。

隔离检查期间在目标配置中关闭 SIGNAL_GENERATION_WORKER_ENABLED 和 AI_SIGNAL_SCHEDULER_ENABLED，并阻断真实 Provider 外发。先核对恢复任务的派发记录、租约和额度，再按批准流程决定是否开启消费者；不要仅因为旧快照有 pending 就主动重发。

合成演练与手工步骤见 [F2 实施记录](./implementation/f2-recovery-replicas-20261031.md)。

```bash
# 仅在以上隔离、状态和配置核对通过后启动，仍不切换外部入口。
docker compose up --build -d
./scripts/deployment-stack.sh server preflight
UNFREQ_BASE_URL=https://你的域名 ./scripts/deployment-stack.sh server smoke
docker compose ps
docker compose logs --tail 80 api
```

浏览器验收：

- 打开首页并登录。
- 发射一个种子，确认生成信号成功。
- 进入“我的频率”，确认能看到自己的信号。
- 打开“星图”，确认旧信号和新信号能展示。
- 检查图片和音频是否能正常加载。

## 回滚

- 旧服务器保留到新服务器验收通过。
- DNS TTL 提前调低，迁移失败时把 DNS 或 Nginx Proxy Manager 转发切回旧服务器。
- 新服务器如果已经产生新数据，回滚前先在新服务器跑一次 `server backup`，避免丢失迁移窗口内的数据。
- 如果新服务器迁移失败，不要把失败后的 PostgreSQL 反向恢复到旧服务器。旧服务器继续作为可信数据源。
