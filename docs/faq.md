# FAQ

## Unfreq 是什么

Unfreq 是一个 AI 同频匹配的可视化共振社区。它不是传统论坛，也不是心理诊断工具。

## 为什么不用用户名，而用 FM 频率

因为这个项目要降低表达门槛。频率身份比真实身份更轻，也更符合匿名表达的定位。

## 为什么要先显示 transmitting

因为 AI 扩写、匹配和写库都可能耗时。先返回稳定 id，页面就不会因为等待而丢失这次发射。

## AI 挂了怎么办

后端会走降级路径。能用本地 fallback 就先保住主流程，不能生成时再给出失败状态，而不是硬塞低质量内容。

## 为什么要拆成 deployment、operations、migration、architecture

因为这些内容用途不同。

- deployment 讲怎么起服务。
- operations 讲日常怎么管。
- migration 讲怎么搬服务器。
- architecture 讲为什么这样搭。

## 本地开发一定要配 AI Key 吗

不一定。项目里有本地 fallback 和部分离线检查路径，但真实效果还是要看具体模块是否依赖外部服务。
