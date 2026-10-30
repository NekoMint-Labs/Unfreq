# Unfreq 文档

Unfreq 是一个 AI 同频匹配的可视化共振社区。

它把匿名表达、AI 扩写、同频匹配和 3D galaxy 放在一条流程里，目标是让用户用一句 seed 进入系统，而不是先学会传统发帖。

## 先看什么

- [项目简介](../README.md)
- [架构与选型说明](./architecture.md)
- [使用指南](./usage.md)
- [部署指南](./deployment.md)

## 简介

- [项目原理与论文综述](./project-principles-and-literature-review.md)
- [实现与答辩说明](./project-implementation-and-defense-guide.md)

## 部署

- [部署指南](./deployment.md)
- [运维手册](./operations.md)
- [服务器迁移](./server-migration.md)

## 使用

- [使用指南](./usage.md)
- [FAQ](./faq.md)

## 开发

- [开发指南](./development.md)
- [总实施规范进度与下一步](./implementation/progress.md)
- [数据公开与生命周期设计（C1 本地实现已验收）](./data-lifecycle.md)
- [C1 发布确认、撤回与公开读取验收](./implementation/c1-publication-20261030.md)
- [C2 普通频率举报闭环](./implementation/c2-reporting-20261030.md)
- [D1 星图覆盖与定位验收](./implementation/d1-galaxy-coverage-20261030.md)
- [D2 星图视觉语义校正验收](./implementation/d2-galaxy-semantics-20261030.md)
- [D3 星图键盘阅读、焦点与减少动画](./implementation/d3-galaxy-accessibility-20261030.md)
- [B1 生成任务配置与切换说明（本地已验收）](./implementation/b1-generation-operations.md)
- [B1/B2 生成可靠性历史验收记录](./implementation/b1-b2-generation-reliability.md)

## 其他

- [排障手册](./debug/index.md)

## 它怎么工作

```text
seed 输入
  -> AI 扩写
  -> 情绪指纹
  -> 同频匹配
  -> 结果页阅读
  -> resonance
  -> galaxy 可视化
```

如果你想先看系统怎么搭，再看为什么这么搭，先读 [架构与选型说明](./architecture.md)。
