# Unfreq 文档

Unfreq 是一个 AI 同频匹配的可视化共振社区。

它把匿名表达、AI 扩写、同频匹配和 3D galaxy 放在一条流程里，目标是让用户用一句 seed 进入系统，而不是先学会传统发帖。

## 先看什么

- [项目简介](../README.md)
- [架构与选型说明](./architecture.md)
- [使用指南](./usage.md)
- [部署指南](./deployment.md)

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
- [Seed 忠实性评测准备与盲评](./faithfulness-evaluation.md)
- [E4 Demo 指标与模式复核实施记录](./implementation/e4-faithfulness-20261031.md)
- [E4 未知来源与暂不展示心理解读](./implementation/e4-unknown-interpretation-20261101.md)
- [F1 身份镜像与每日调度](./implementation/f1-identity-scheduler-20261031.md)
- [F2 合成恢复、副本追踪与日志](./implementation/f2-recovery-replicas-20261031.md)
- [F2 后续：任务时序观察](./implementation/f2-generation-observation-20261101.md)
- [F2 合成 Redis AOF 检查点恢复](./implementation/f2-redis-aof-20261101.md)
- [能力与遗留入口清单](./capability-inventory.md)
- [F3 能力登记与冻结](./implementation/f3-capability-inventory-20261101.md)
- [依赖分组维护与回退](./dependency-maintenance.md)
- [F4 依赖评估与 API 安全维护](./implementation/f4-dependency-maintenance-20261101.md)
- [F4 完整 Linux Web 镜像与离线分享卡片](./implementation/f4-linux-web-runner-20261101.md)
- [F4 最终兼容依赖维护候选](./implementation/f4-maintenance-final-candidate-20261101.md)
- [Main 必需集成检查验收](./implementation/ruleset-integration-20261101.md)
- [postgres v4 兼容性负向评估](./implementation/postgres-v4-20261101.md)
- [postgres v4 生命周期补丁候选与验收](./implementation/postgres-v4-upgrade-20261101.md)
- [完整 API 镜像与独立 Web 测试入口](./implementation/api-image-20261102.md)
- [API 成品进行中任务关停与重启](./implementation/api-active-shutdown-20261102.md)
- [旧版本回退后的真实业务与连接故障回归](./implementation/rollback-faults-20261102.md)
- [生产迁移器与开发工具依赖边界](./implementation/runtime-migrations-20261102.md)
- [Web 宿主等待修复与同成品续验](./implementation/web-runtime-readiness-20261102.md)
- [B3 pilot 预算提案与真实代理链验收](./implementation/b3-pilot-boundaries-20261101.md)
- [参赛事实与证据待办](./competition-evidence.md)
- [数据公开与生命周期设计（C1 本地实现已验收）](./data-lifecycle.md)
- [C1 发布确认、撤回与公开读取验收](./implementation/c1-publication-20261030.md)
- [C2 普通频率举报闭环](./implementation/c2-reporting-20261030.md)
- [D1 星图覆盖与定位验收](./implementation/d1-galaxy-coverage-20261030.md)
- [D2 星图视觉语义校正验收](./implementation/d2-galaxy-semantics-20261030.md)
- [D3 星图键盘阅读、焦点与减少动画](./implementation/d3-galaxy-accessibility-20261030.md)
- [D4 轮询、续写与历史统计](./implementation/d4-polling-history-20261030.md)
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
