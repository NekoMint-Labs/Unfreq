# Unfreq

AI 同频匹配的可视化共振社区。

Unfreq 让注册者用匿名 FM 频率写下一句 seed。系统整理正文并生成私密预览；作者核对公开内容并确认发布后，表达才进入同频发现和 3D galaxy。当前不展示未经验证的心理标签、需求、冲突或百分比，也不据此概括个人特征。规则降级、匹配分数和内部指纹都不等于真实模型质量或心理评测结论。

星图采用艺术化排布，画面远近不表示语义相似度。可点开的星点对应公开表达；连线展示当前样本中的规则关联，亮度和大小还受共振、景深与装饰效果影响。具体含义见[使用指南](./docs/usage.md#galaxy)。

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
  -> private preview
  -> owner confirms publication
  -> see same-frequency strangers
  -> resonate
  -> view galaxy
```

用户不需要写标题、解释背景或经营身份。Unfreq 把输入门槛压到一句 seed，再由后端完成 AI 扩写、结构化指纹、同频匹配和持久化。

新发布预览不附心理分类标签或频段；此前由作者明确确认的公开快照保持原样。月度回顾是可能有误的自动整理，应对照原文阅读。真实模型效果、独立人工评测和作者认可仍待验收，见 [E4 后续记录](./docs/implementation/e4-unknown-interpretation-20261101.md)。

当前页面主流程为注册/登录、发射、私密预览、确认发布/撤回、公开阅读/共振/收藏/举报、星图和本人轨迹。正文播放取决于可用的音频来源。主题电台、Hall、留言、图片上传和双声道节目未接入当前页面主流程；自动 persona 互动没有生产调用入口。它们的 API、任务、数据和冻结范围见[能力清单](./docs/capability-inventory.md)，不作为正式演示功能。

## 它怎么搭起来

```text
apps/web            Next.js App Router 前端
apps/api            Fastify JSON API 后端
packages/contracts  前后端共享 TypeScript DTO
PostgreSQL          主数据和向量字段
Redis               登录挑战、共享限额和短期状态
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
