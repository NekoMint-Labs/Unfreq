# Unfreq

AI 同频匹配的可视化共振社区。

Unfreq 让用户用匿名 FM 频率写下一句 seed。系统把 seed 扩写成 expanded signal，提取情绪指纹，匹配同频陌生信号，并把信号之间的关系放进 3D galaxy。

它不是心理诊断工具，也不是传统论坛。它更接近一个「匿名表达 + AI 语义整理 + 同频发现 + 可视化反馈」系统。

## 文档

- [文档首页](./docs/index.md)
- [架构与选型说明](./docs/architecture.md)
- [使用指南](./docs/usage.md)
- [部署指南](./docs/deployment.md)
- [开发指南](./docs/development.md)
- [FAQ](./docs/faq.md)

## 核心流程

```text
write a seed
  -> AI expands it
  -> see same-frequency strangers
  -> resonate
  -> view galaxy
```

用户不需要写标题、解释背景或经营身份。Unfreq 把输入门槛压到一句 seed，再由后端完成 AI 扩写、结构化指纹、同频匹配和持久化。

## 它怎么搭起来

```text
apps/web            Next.js App Router 前端
apps/api            Fastify JSON API 后端
packages/contracts  前后端共享 TypeScript DTO
PostgreSQL          主数据和向量字段
Redis               会话、缓存和队列状态
Docker Compose      默认服务器部署
```

更详细的搭建方式和选型理由见 [架构与选型说明](./docs/architecture.md)。

## 快速开始

- 想先跑起来：看 [部署指南](./docs/deployment.md)。
- 想了解用户路径：看 [使用指南](./docs/usage.md)。
- 想本地开发：看 [开发指南](./docs/development.md)。
- 出问题先查：看 [FAQ](./docs/faq.md) 和 [排障手册](./docs/debug/index.md)。

## 产品术语

```text
user       -> frequency / 频率
identity   -> FM frequency / FM 频率
input      -> seed / 种子
generated  -> expanded signal / micro-monologue
post       -> signal / 信号
like       -> resonance / 我也想过
community  -> galaxy / tuning
profile    -> my frequency / 我的频率
```

前端可见文案不要使用用户、帖子、评论、点赞、版块、个人主页这类传统社区词。
