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

## 必须带走的数据

- `.env`：包含 `WEB_ORIGIN`、`SESSION_SECRET`、`PROVIDER_CONFIG_SECRET` 和 Provider Key。
- `postgres-data`：业务主数据。使用 `server backup` 导出 SQL 备份。
- `api-image-storage`：图片上传文件，挂载在 API 容器 `/app/storage/images`。
- `api-audio-storage`：生成的音频文件，挂载在 API 容器 `/app/storage/audio/programs`。
- `redis-data`：会话、缓存和队列状态。Redis 丢失不会破坏 PostgreSQL 主数据，但会导致登录态、缓存和未完成队列丢失。

## 旧服务器备份

```bash
mkdir -p /srv/unfreq/backups
UNFREQ_BACKUP_FILE=/srv/unfreq/backups/unfreq-postgres-pre-migration.sql.gz ./scripts/deployment-stack.sh server backup
docker run --rm -v unfreq_api-image-storage:/data -v /srv/unfreq/backups:/backup alpine tar -czf /backup/unfreq-images-pre-migration.tar.gz -C /data .
docker run --rm -v unfreq_api-audio-storage:/data -v /srv/unfreq/backups:/backup alpine tar -czf /backup/unfreq-audio-pre-migration.tar.gz -C /data .
docker run --rm -v unfreq_redis-data:/data -v /srv/unfreq/backups:/backup alpine tar -czf /backup/unfreq-redis-pre-migration.tar.gz -C /data .
cp .env /srv/unfreq/backups/unfreq.env
```

如果 Compose project name 不是目录名 `unfreq`，先用 `docker volume ls | grep unfreq` 查真实 volume 名，再替换上面的 `unfreq_*`。

## 新服务器恢复

```bash
git clone https://github.com/your-org/Unfreq.git Unfreq
cd Unfreq
cp /srv/unfreq/backups/unfreq.env .env
docker network inspect npm_default >/dev/null 2>&1 || docker network create npm_default
docker compose up -d postgres
./scripts/deployment-stack.sh server restore /srv/unfreq/backups/unfreq-postgres-pre-migration.sql.gz
docker run --rm -v unfreq_api-image-storage:/data -v /srv/unfreq/backups:/backup alpine sh -c 'cd /data && tar -xzf /backup/unfreq-images-pre-migration.tar.gz'
docker run --rm -v unfreq_api-audio-storage:/data -v /srv/unfreq/backups:/backup alpine sh -c 'cd /data && tar -xzf /backup/unfreq-audio-pre-migration.tar.gz'
docker run --rm -v unfreq_redis-data:/data -v /srv/unfreq/backups:/backup alpine sh -c 'cd /data && tar -xzf /backup/unfreq-redis-pre-migration.tar.gz'
docker compose up --build -d
```

把 `git clone` 的仓库地址替换成真实地址。如果 `.env` 里的 `UNFREQ_PROXY_NETWORK` 不是 `npm_default`，按 `.env` 的值创建网络。

## 新服务器验收

```bash
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
