# B3：PR #5 基线整理与复验

本轮回应 [B3 评审评论](https://github.com/NekoMint-Labs/Unfreq/pull/5#issuecomment-6557377866) 中尚未完成的基线整理和重新验收要求。#3/#4 已由维护者合入 main，本轮只整理 #5、执行检查并同步 PR；不合并 main，不执行生产迁移、部署或真实 Provider 调用。

## 来源与冲突处理

- 原 Head：`34c2ae338a2b75c5b96b86b102ce8cd65effa5ca`；原 B3 起点：`ff18fc7cef4206d3c8aa205149c2d7385bcad8fb`。
- 新 Base：main `c0fb0e34259da4f19d3e9bf54cf80506a202eece`，包含已批准的 #1～#4。
- 重放原 B3 四个提交，功能及原边界文档的最终提交：`cb10b6f5010d9d8784e63999818acb47a8c848b5`。
- 原 B3 范围 79 个文件中，78 个最终 blob 与旧 Head 完全相同，包括业务代码、迁移、依赖清单、锁和额度提案。唯一不同的是 `scripts/integration-runtime.mjs` 的来源与编译产物清单。

冲突位于集成 runtime 的校验清单及其合成夹具。保留 B3 导出的共享清单和双入口，加入 main 已有的 `generation-repository` 编译产物与来源，以及 `generation-harness.ts`、`generation-checkpoints.test.ts` 来源；重复模块通过同一清单列举一次。原 guard 单测使用共享清单，编译前后校验和子进程启动校验不变。

main 的 generation harness、进程夹具、checkpoint 用例，以及真实 Cookie 契约修正均完整保留。新增的“请求已准入、INSERT 等待期间完成关停、新 PID 接续同一 ID”回归没有被旧 B3 基线覆盖。未放宽超时、删除用例或降低断言。

远端 PR #5 已改为以 main 为 Base，GitHub 读回确认 `mergeable=true`，原内容冲突已解除。该值不代表正式批准；独立评审、全部必需 CI 与分支保护仍须分别满足，PR 保持 Draft。

## 验收记录

本地原始日志及集成 manifest 保存在 Git 忽略的 `test-results`，不把原始日志、缓存或合成凭据提交进仓库。下述计数只属于本轮上述功能 Head，不复用旧 65/65 或其他 PR 的成绩。最终同步 Head 的 GitHub CI 另在 [PR 检查页](https://github.com/NekoMint-Labs/Unfreq/pull/5/checks) 和本轮处理评论中记录。

| 检查 | 本轮实际结果 |
| --- | --- |
| Node / npm | 22.23.4 / 10.9.9 |
| 正常 `npm ci` | 535 包；postgres 3.4.9 原四文件补丁 `applied=4/verified=4`，exit 0 |
| `npm run check` | 工具 14/14、API 446/446（41 文件）、Web 38/38（8 文件），contracts/API/Web 类型、两端 lint 与构建均通过，exit 0 |
| `sh scripts/test-deployment-scripts.sh` | 原六组脚本回归通过，exit 0；使用替身 Docker/curl，不是部署 |
| `npm run api:integration` | 新 PG/Redis、6 文件、66/66，失败/跳过/todo 均为 0，runner exit 0 |
| 集成来源读回 | 41 份来源与 37 份编译产物哈希全部相同，清单无重复 |
| 清理独立读回 | manifest `cleaned=true`；本轮项目标签限定的容器、网络、卷查询均 exit 0 且为空 |

集成证据目录为 `test-results/integration/run-Gay6y9`，项目为 `unfreq-it-94c5995262bc`，测试持续约 115 秒。66 项包含原 B3 65 项和 main 补充的一项准入/关停交错回归；B3 多 PID 专项 19/19。共享额度、可信/伪造转发头、实际 chat/embedding/reranker/TTS 派发计量、Redis 故障拒绝外发、缓存音频、跨 PID 租约及真实 WS drain 均执行；EOF/FIN/RST、生成栅栏和关停/重启回归也保留并通过。

原始安装、check、部署脚本和集成日志分别位于 `test-results/pr5-reconcile-20261103/`；`source-readback.json` 与 `final-readback.json` 保存受保护输入/产物的独立核对结果。浏览器、真实模型质量、实际反代部署链、生产恢复及实体设备没有在本轮重新验收。

## 保留的验收边界

- [20 人 pilot 提案](./b3-pilot-boundaries-20261101.md) 仍是待负责人核价和批准的提案；全零结构样例未改，不启用任何生产额度。
- [部署指南](../deployment.md) 中的实际 Nginx Proxy Manager → Caddy → API 配置、双客户端、伪造头与副本一致性检查仍需在获准目标环境验收。本轮 loopback/注入测试不替代该部署链。
- 音频未知 commit/READY/PENDING 结果不猜退款、不盲目重复收费。崩溃/历史音频恢复与持久调度仍属独立 F1，不并入 B3。
- 作者撤回及公开字段白名单实施属 C1；postgres v4 与生产迁移器仍由独立 PR 审查。本轮没有合入 #8～#11 的改动，也不据此关闭 #7。
