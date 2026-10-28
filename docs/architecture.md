# 架构与选型说明

这份文档说明 Unfreq 每一部分怎么搭建，以及为什么这样选。

## 总体目标

Unfreq 的核心需求不是做一个传统内容社区，而是支撑这条产品闭环：

```text
seed 输入
  -> AI 扩写
  -> 情绪指纹
  -> 同频匹配
  -> 结果页阅读
  -> resonance
  -> galaxy 可视化
  -> my frequency 沉淀
```

所以系统要同时满足几件事：

- 输入要轻，前端不能把用户推到复杂发帖流程里。
- AI 要在服务端编排，不能把 provider key 和提示词控制权放到浏览器。
- 信号要持久化，刷新、跳转、异步生成都不能丢。
- 匹配既要支持向量，也要能在 AI/embedding 不可用时降级。
- Web 只是第一个客户端，后续 Android 也要能复用同一套 JSON API。
- 部署要适合小型服务器，能用 Docker Compose 快速恢复。

## 总体结构

```text
Browser
  -> apps/web
       Next.js 页面、交互、3D galaxy
       -> apps/api
            Fastify JSON API、鉴权、AI 编排、信号业务
            -> PostgreSQL：主数据、迁移、向量字段
            -> Redis：会话、缓存、队列状态
            -> AI Provider：扩写、指纹、可选 embedding / TTS

apps/web <-> packages/contracts <-> apps/api
```

仓库用 npm workspaces 组织：

```text
apps/web            前端应用
apps/api            后端服务
packages/contracts  共享 DTO 和 API 类型
deploy              Caddy、演示配置、种子数据
scripts             部署、备份、管理员脚本
```

选择单仓库是因为前后端强依赖同一套业务语言和 API 字段。`packages/contracts` 放在同一个仓库里，可以让 Web 和 API 同步升级，减少“后端改字段、前端还在用旧字段”的问题。

## 前端：Next.js App Router

前端在 `apps/web`。

```text
apps/web/src/app          路由页面
apps/web/src/components   产品组件
apps/web/src/lib          API 调用和前端工具
apps/web/src/styles       全局样式
apps/web/public           PWA 图标和静态资源
```

Next.js App Router 用来组织页面入口，例如首页、登录、结果页、`/galaxy`、`/me` 和管理员页。产品组件放在 `components`，API 请求封装在 `lib`，避免页面里直接堆网络细节。

选择 Next.js 的原因：

- App Router 适合按产品页面拆入口。
- 同一个 Web 应用里可以放页面、健康检查 route 和 PWA 配置。
- TypeScript 能直接消费 `packages/contracts`。
- 构建结果适合放进 Docker 镜像，由 Caddy 统一反代。

Tailwind CSS 用来做界面样式。它适合这种自定义视觉语言较强的产品，不需要先维护一套很重的组件库。

3D galaxy 使用 `@react-three/fiber` 和 Three.js。选择它们是因为 galaxy 不是静态装饰，而是可拖拽、可缩放、可点击的关系空间。直接用 DOM 或 SVG 很难支撑 3D 坐标、相机控制和大量点位交互。

## 后端：Fastify JSON API

后端在 `apps/api`。

```text
apps/api/src/config       环境变量解析
apps/api/src/db           Drizzle schema、迁移、数据库客户端
apps/api/src/modules      业务模块
apps/api/src/plugins      Fastify 插件
apps/api/src/shared       共享工具和错误类型
```

业务按模块拆分。`signals` 是核心模块，负责 seed 接收、AI 生成、匹配、发布、共振、收藏、galaxy 查询和音频。`auth` 负责 FM 频率身份和 session。`ai` 负责 provider 适配、提示词和结构化生成。

选择 Fastify 的原因：

- 它是轻量 JSON API 服务，适合给 Web 和未来 Android 共用。
- 插件和模块边界清楚，便于把 auth、health、signals、admin 拆开。
- 性能和启动成本都适合 Docker 单服务部署。
- TypeScript 支持直接，能和 Zod、Drizzle、共享 contracts 配合。

后端不把业务写进 Next.js API routes，是因为产品明确需要移动端复用。Fastify 作为独立 API，可以让 Web、Android 或其他客户端使用同一套接口。

## 共享契约：packages/contracts

共享契约在 `packages/contracts`。

```text
packages/contracts/src/auth.ts
packages/contracts/src/signals.ts
packages/contracts/src/admin.ts
packages/contracts/src/theme-radio.ts
packages/contracts/src/api.ts
```

这里放前后端都要理解的 DTO、响应结构和业务枚举。根脚本会先构建 contracts，再构建 API 或 Web：

```bash
npm run contracts:build
```

选择共享 contracts 的原因：

- 同一个字段只定义一次。
- Web 调 API 时能拿到类型提示。
- API 改响应结构时，前端类型检查能及时失败。
- 后续 Android 接入时也能把这些契约转成跨端文档或生成材料。

## AI 编排

AI 层在 `apps/api/src/modules/ai`，信号生成链路主要在 `apps/api/src/modules/signals/service-creation.ts`。

后端不会让浏览器直接调用 provider。它会把用户 seed 转成几个受控任务：

```text
classification  判断输入类型和扩写边界
fingerprint     生成主频段、子情绪、核心需求、内在冲突
expansion       生成 expanded signal
review          检查扩写是否跑题、模板化或过度编造
matching        查找 same-frequency signals
```

选择服务端 AI 编排的原因：

- provider key 必须留在服务端。
- 提示词、schema、fallback 和审核策略需要集中控制。
- AI 输出不能直接发布，必须先经过结构化解析和质量检查。
- AI/embedding 不可用时，后端可以回到本地 fallback 或规则匹配。

这层把 AI 限定为“表达整理和语义提取工具”，不是自由聊天机器人，也不是心理诊断系统。

## 数据层：PostgreSQL、Drizzle、pgvector

主数据在 PostgreSQL。

```text
apps/api/src/db/schema.ts       数据表定义
apps/api/src/db/migrations      Drizzle 迁移
apps/api/src/db/vector.ts       向量相关处理
```

选择 PostgreSQL 的原因：

- 信号、频率、共振、收藏、审核、音频、配置都属于强持久化数据。
- 这些数据之间有清晰关系，关系型数据库更适合维护一致性。
- PostgreSQL 可以通过 pgvector 支持语义向量，减少额外引入向量数据库的复杂度。

选择 Drizzle 的原因：

- schema 和 TypeScript 靠得近，字段变更更容易被类型系统发现。
- 迁移文件留在仓库里，部署时 API 容器可以按迁移推进数据库。
- SQL 边界比较清楚，不会把复杂查询隐藏到不可控的 ORM 魔法里。

## Redis：会话、缓存和队列状态

Redis 在 Compose 里使用 `redis:7-alpine`，并开启 appendonly。

它承载会话、缓存和队列状态。主业务数据不放 Redis。Redis 丢失会影响登录态、缓存或未完成队列，但不应该破坏 PostgreSQL 里的主数据。

选择 Redis 的原因：

- session 和临时状态不适合全部塞进 PostgreSQL。
- 队列或生成状态需要低延迟读写。
- 后续把 in-process 生成队列升级成 Redis-backed worker 时，基础设施已经在。

## 信号生成与状态流转

信号创建不是同步等待 AI 完成。前端提交 seed 后，后端先创建 pending signal，返回稳定 id，然后页面进入 transmitting 状态并轮询。

```text
POST /api/signals
  -> 创建 pending signal
  -> 返回 signal id
  -> 后端排队生成
  -> 前端轮询状态
  -> 生成完成
  -> 作者预览
  -> 发布后进入 galaxy / matching / resonance
```

这样设计是因为 AI 扩写、review、embedding 和匹配都可能耗时。先返回 id 可以让刷新、跳转和网络波动更可控。

当前生成队列主要是服务进程内调度。状态写在数据库里，所以页面恢复没问题；但跨进程重启后的任务恢复，后续更适合接 BullMQ 或独立 worker。

## 部署：Docker Compose + Caddy + Nginx Proxy Manager

默认服务器部署在 `compose.yaml`。

```text
proxy      Caddy，对内连 web/api，对外接反代网络
web        Next.js production server
api        Fastify API
postgres   pgvector/pgvector:pg16
redis      redis:7-alpine
```

Caddy 同时进入内部 `app` 网络和外部 Nginx Proxy Manager 网络。Web、API、PostgreSQL、Redis 只留在内部网络。

选择这个结构的原因：

- 小型服务器可以用 Compose 一次拉起全栈。
- Nginx Proxy Manager 继续负责公网域名和证书入口。
- Caddy 只做项目内部反代，给 Nginx Proxy Manager 一个稳定 upstream：`unfreq-proxy:80`。
- 数据库、Redis 和 API 不直接暴露到反代网络，边界更清楚。
- volume 明确保存 PostgreSQL、Redis、图片和音频，迁移时知道要带走什么。

## 质量与脚本

根 `package.json` 聚合了前后端检查：

```text
npm run check       contracts + api + web
npm run api:check   lint + typecheck + test + build
npm run web:check   lint + typecheck + build
npm run e2e         浏览器主流程
npm run deploy:test 部署脚本测试
```

这样设计是为了把检查按层拆开。平时可以跑单层检查，提交前跑根检查。部署脚本有单独测试，因为 Docker、Caddy、环境变量和 shell 脚本的问题不一定会被 TypeScript 检查发现。

## 选型总结

```text
Next.js       Web 页面、PWA、产品交互
Fastify       独立 JSON API，便于多客户端复用
TypeScript    前后端统一类型边界
Zod           环境变量、请求和 AI 输出校验
Drizzle       类型友好的 PostgreSQL schema 和迁移
PostgreSQL    主数据持久化
pgvector      在主库内支持语义匹配
Redis         会话、缓存、队列状态
Three.js      3D galaxy 可视化
Docker Compose 小型服务器可复现部署
Caddy         项目内部反代
Nginx Proxy Manager 公网域名和证书入口
```
