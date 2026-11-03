# 运维手册

这份文档记录服务器日常操作。部署入口见 [部署指南](./deployment.md)，迁移入口见 [服务器迁移](./server-migration.md)。

额度调整、未知付费任务及代理链验证见 [B3 pilot 预算与代理链验收边界](./implementation/b3-pilot-boundaries-20261101.md)；该文档是待评审提案，不代表目标环境已验收。

## 常用命令

```bash
docker compose ps
docker compose logs -f api
docker compose restart api
docker compose pull --ignore-buildable
docker compose up --build -d
```

## 备份 PostgreSQL

```bash
./scripts/deployment-stack.sh server backup
```

已有目标拒绝覆盖。脚本在私有临时目录完整生成后发布 600 权限的产物，可处理的退出会清理临时文件；SIGKILL/断电仍可能留下私有明文，见 F2 记录。gzip 不是加密，备份仍需受控存放。SQL 不含媒体卷和 `.env`；保管原 PROVIDER_CONFIG_SECRET 才能解密数据库中的 Provider Key。

## 恢复 PostgreSQL

```bash
UNFREQ_RESTORE_ISOLATED=true ./scripts/deployment-stack.sh server restore /srv/unfreq/backups/pre-release.sql.gz
```

仅使用已核验的可信系统 dump，只允许新建空库，在单事务中检查目标与恢复；任意带 COMMIT 或 psql 元命令的 SQL 不受完整回滚承诺。隔离变量是人工声明，不验证网络；执行前停止应用写入、隔离反代，不用于运行中的数据库。成功后先核对媒体、配置、身份、向量及较新撤回/审核/删除状态，再开放读取。没有最新依据时，不得直接公开旧快照。UNFREQ_PG_USER / UNFREQ_PG_DATABASE 可指定简单标识符，默认 postgres / unfreq。

合成恢复步骤和本机测值见 [F2 实施记录](./implementation/f2-recovery-replicas-20261031.md)，不代替目标服务器验收。

## 副本和日志

先构建 API，再运行 `npm --workspace @unfreq/api run replicas:audit -- <signal UUID> --limit 50`，按当前环境配置生成只读清单。它不输出正文、不修复或删除，不能找齐未关联旧审计、独立图片、非 top 月报输入、备份或第三方副本。

Compose 的 UNFREQ_LOG_MAX_SIZE / UNFREQ_LOG_MAX_FILES 默认 10m / 3，控制各容器 json-file 轮转容量，不代表保留天数。当前配置修改不会操作运行中的容器；实际重建可能随旧容器移除其日志，部署前按已批准规则导出所需记录，并核对外部收集器。新增日志不得写入 Seed、密码、验证码、Cookie、Provider Key 或完整异常对象，保留期和历史清理仍按 A3 待决。

## 创建管理员

```bash
./scripts/admin-promote.sh server --code "你的 FM"
```

## 可选部署脚本

`prod-deploy.sh` 仍可用于一键补齐 `.env`、生成密钥、创建反代网络、备份数据库并发布：

```bash
./scripts/prod-deploy.sh https://你的域名
./scripts/prod-deploy.sh
```

直接 Compose 是主路径。脚本只是自动化运维入口。

该脚本创建或重写环境文件时使用600权限和同目录唯一临时文件；不会复用固定的 `.env.tmp`。环境文件本身为符号链接或非普通文件时拒绝执行，应先由操作者提供独立的普通文件。可处理的退出会清理本次临时文件；SIGKILL/断电仍可能留下600权限的临时副本，不保证它们已清除。上述措施不为磁盘内容加密，也不能代替生产密钥和数据处置规则。
