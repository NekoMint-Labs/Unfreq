# 运维手册

这份文档记录服务器日常操作。部署入口见 [部署指南](./deployment.md)，迁移入口见 [服务器迁移](./server-migration.md)。

额度调整、未知付费任务及代理链验证见 [B3 pilot 预算与代理链验收边界](./implementation/b3-pilot-boundaries-20261101.md)；该文档是待评审提案，不代表目标环境已验收。

C1 版本上线后的故障处置必须保留作者撤回与发布确认边界。直接恢复 pre-C1 应用或旧数据库备份可能重新公开已撤回内容；先隔离公共入口，再使用保留 C1 权限条件的已验收版本或隔离恢复环境。详见[部署指南中的同步发布与回退条件](./deployment.md)。日常试用保持 `AI_SIGNAL_SCHEDULER_ENABLED=false`；当前进程内定时器不具备多副本持久调度保证。

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

## 恢复 PostgreSQL

```bash
./scripts/deployment-stack.sh server restore /srv/unfreq/backups/pre-release.sql.gz
```

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
