# 运维手册

这份文档记录服务器日常操作。部署入口见 [部署指南](./deployment.md)，迁移入口见 [服务器迁移](./server-migration.md)。

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
