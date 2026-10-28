# 部署指南

这份文档适合把 Unfreq 部署到一台服务器上。

默认部署方式是 Docker Compose。它会启动 Web、API、PostgreSQL、Redis 和 Caddy。Caddy 接入已有 Nginx Proxy Manager 网络 `npm_default`，Web、API、PostgreSQL、Redis 留在内部 `app` 网络。

## 快速开始

```bash
cp .env.example .env
```

编辑 `.env`：

```env
WEB_ORIGIN=https://你的域名
UNFREQ_PROXY_NETWORK=npm_default
```

启动：

```bash
docker compose up --build -d
```

## 环境变量

根 `.env.example` 是服务器部署模板。正式部署前把 `SESSION_SECRET`、`PROVIDER_CONFIG_SECRET` 和 provider key 换成真实值。不要提交 `.env`。不要把真实 AI Key 写进仓库。

常用字段：

```text
WEB_ORIGIN                 公网访问地址，生产必须是 https://
UNFREQ_PROXY_NETWORK       已存在的反代 Docker 网络，默认 npm_default
SESSION_SECRET             会话签名密钥，生产必须是非占位强随机值
PROVIDER_CONFIG_SECRET     Provider Key 加密密钥，生产必须是非占位强随机值
AI_BASE_URL / AI_API_KEY   可选 AI 服务；为空时使用本地 fallback
EMBEDDING_API_KEY          可选 embedding；为空时回到关键词/标签匹配
TTS_API_KEY                可选服务端 TTS；为空时保留浏览器朗读 fallback
```

API 容器启动时会先执行数据库迁移。生产模式会拒绝占位 `SESSION_SECRET`、占位 `PROVIDER_CONFIG_SECRET`、占位域名和非 HTTPS `WEB_ORIGIN`。

## 反代配置

Nginx Proxy Manager 转发到：

```text
Scheme:              http
Forward Hostname/IP: unfreq-proxy
Forward Port:        80
```

如果反代网络不叫 `npm_default`，改 `.env`：

```env
UNFREQ_PROXY_NETWORK=你的网络名
```

## 为什么这样部署

- Docker Compose 适合单机部署和迁移。
- Caddy 只做项目内部反代，不直接负责公网证书。
- Nginx Proxy Manager 继续负责域名和证书入口。
- Web、API、PostgreSQL、Redis 不暴露到公网反代网络。
- 数据库、Redis、图片和音频都用 volume 保存，便于迁移和备份。

## 部署检查

```bash
./scripts/deployment-stack.sh server preflight
UNFREQ_BASE_URL=https://你的域名 ./scripts/deployment-stack.sh server smoke
```
