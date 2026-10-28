# 开发指南

## 本地命令

```bash
npm install
npm run api:dev
npm run web:dev
npm run check
npm run e2e
npm run api:check
npm run web:check
npm run deploy:test
```

本地 npm 开发需要自行准备 `apps/api/.env`、`apps/web/.env`、PostgreSQL 和 Redis。项目部署不再以本地 npm 启动为主路径。

`npm run e2e` 会启动 Next.js Web 和本地 mock API，只覆盖浏览器主流程，不依赖真实 AI Key、PostgreSQL 或 Redis。它当前不并入默认 `npm run check`，避免把浏览器安装和本地端口占用变成所有代码检查的前置条件。

## 目录

```text
apps/api        Fastify JSON API
apps/web        Next.js Web
packages/contracts  前后端共享 TypeScript DTO
deploy          Caddy、种子数据、演示脚本
scripts         部署、备份、管理员脚本
compose.yaml    默认服务器 Compose 栈
Dockerfile.api  API 镜像
Dockerfile.web  Web 镜像
```

## GitHub Actions CI

工作流位于 [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)，在 PR、推送到 `main` 或手动触发时运行。三个任务独立并行，一个失败不会取消其他任务：

| 任务 | 检查内容 |
| --- | --- |
| `api checks` | `npm run api:check`：lint、contracts/API 类型检查、API 单元测试、构建 |
| `web checks` | `npm run web:check` 加 Web 单元测试：lint、contracts/Web 类型检查、构建、测试 |
| `Deployment script tests` | `sh scripts/test-deployment-scripts.sh`，与 `npm run deploy:test` 相同 |

API/Web 使用与 Docker 镜像一致的 Node.js 22，通过 `npm ci` 按锁文件安装依赖并缓存 npm 下载。同一 PR/分支的新运行会取消旧运行。

这套 CI 不需要仓库 secrets、真实 AI 服务、PostgreSQL 或 Redis；部署脚本测试使用替身命令，不部署应用。浏览器 E2E 和 Docker 镜像构建暂不纳入默认 CI。

## 质量检查

改 Docker、Compose、Caddy、环境变量或启动脚本后至少跑：

```bash
npm run check
npm run deploy:test
./scripts/deployment-stack.sh server config
sh -n scripts/deployment-stack.sh
sh -n scripts/deployment-smoke.sh
sh -n scripts/prod-deploy.sh
```

有 Docker daemon 和目标反代网络时再跑：

```bash
./scripts/deployment-stack.sh server preflight
UNFREQ_BASE_URL=https://你的域名 ./scripts/deployment-stack.sh server smoke
```
