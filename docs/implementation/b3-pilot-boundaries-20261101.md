# B3 pilot 预算提案与代理链验收边界

日期：2026-11-01。对应 PR #5 评论 `6557377866`，只按固定基线 [`3dc418be670ca316df3ad109c1c09b333a9b2b44`](https://github.com/NekoMint-Labs/Unfreq/commit/3dc418be670ca316df3ad109c1c09b333a9b2b44) 核对。本文件是待评审的初始提案，没有启用配置、部署或目标环境实测。后续 F1 与 C2 report 字段不属于这个 PR 的配置范围。

## 1. 小规模 pilot 的初始提案

假设首轮不超过 20 名受邀测试者，全站每天最多接收 30 次生成、最多新增 20 次音频任务；生成次数是接收上限，不保证这些请求都会成功完成。共享 IP、校园网/NAT、失败重试及后台调用均可能提前耗尽额度，需要先观察误封与实际调用量再调整。以下数值仅供评审，不替换仓库全部为零的结构样例。

字段严格对应 [PR5 的 23 个 budgets](https://github.com/NekoMint-Labs/Unfreq/blob/3dc418be670ca316df3ad109c1c09b333a9b2b44/apps/api/src/config/abuse.ts#L3)。`limit=0` 表示拒绝；没有“零等于无限”规则。`windowMs` 均为毫秒。

| 字段 | 建议 limit | windowMs | 计数对象与用途 |
| --- | ---: | ---: | --- |
| `registerIp` | 5 | 3600000 | 单 IP 注册请求；共享出口可能共用额度 |
| `registerSite` | 30 | 3600000 | 全站注册请求 |
| `passwordRequestIp` | 30 | 600000 | 单 IP 密码登录请求 |
| `passwordRequestSite` | 200 | 600000 | 全站密码登录请求 |
| `passwordFailureIp` | 10 | 900000 | 单 IP 密码失败预算 |
| `passwordFailureIdentityIp` | 5 | 900000 | 规范化 FM 身份与 IP 的组合失败预算；成功按现有预留/退款流程处理 |
| `emailRequestIp` | 0 | 3600000 | 生产邮件发送尚未实现，保持拒绝 |
| `emailRequestSite` | 0 | 3600000 | 同上，全站请求预算 |
| `emailVerifyIp` | 0 | 600000 | 生产验证码校验保持拒绝 |
| `emailVerifySite` | 0 | 600000 | 同上，全站校验预算 |
| `generationRequestUser` | 2 | 60000 | 单作者生成接收请求 |
| `generationDailyUser` | 5 | 86400000 | 单作者固定日窗口内接收数 |
| `generationDailySite` | 30 | 86400000 | 全站固定日窗口内接收数 |
| `audioReadIp` | 120 | 60000 | 单 IP 音频详情/文件读取入口，缓存读取也受入口预算约束 |
| `audioRequestIp` | 30 | 60000 | 单 IP 音频 POST 请求入口，重复请求也先经过此预算 |
| `audioNewIp` | 5 | 600000 | 单 IP 真正新建音频任务的预留预算 |
| `audioNewDailySite` | 20 | 86400000 | 全站真正新建音频任务的固定日窗口预算 |
| `diagnosticIp` | 10 | 600000 | 单 IP 前端诊断提交 |
| `diagnosticSite` | 100 | 600000 | 全站前端诊断提交 |
| `chatCallsSite` | 120 | 86400000 | 全站实际远端 chat 派发次数，含重试/备用 |
| `embeddingCallsSite` | 90 | 86400000 | 全站实际远端 embedding 派发次数，含重试/备用 |
| `rerankerCallsSite` | 60 | 86400000 | 全站实际远端 reranker 派发次数，含重试/备用 |
| `ttsCharactersSite` | 20000 | 86400000 | 每次 TTS 派发的 `compactText.length` 总和，即 UTF-16 代码单元，重试/备用再次扣除 |

这 23 个字段是预算结构；不加入后续举报提交/回执读取预算。四项付费额度在真实模型成本核价与目标链验收完成前仍应保持零，表中的非零值不构成远端调用授权。生产邮箱继续使用 `AUTH_LOGIN_DELIVERY_MODE=disabled`、`AUTH_LOGIN_CODE_RESPONSE=disabled`，不得用本地验证码回显替代生产发送。

另外建议 `pendingPerUser=1`、`ttsConcurrency=1`、`ttsTaskTimeoutMs=30000`；它们不是 budgets 内字段，且均须为正整数，不能用零表示关闭。生成 worker 的建议 `SIGNAL_GENERATION_CONCURRENCY=1`（记作 C）属于另一组配置。该 HEAD 通过数据库 live lease 与队列锁约束共享 C，所有 API/worker 必须使用相同 C、同一业务数据库；增加副本不应把它解释成每副本独立额度。30000ms 是音频整任务提案，仍须以目标网络/模型时延及实际关闭耗时验收，不能把计时器触发写成工作已经退出。

## 2. 费用只做有条件的规划

四项付费预算在实际发起请求前扣除，重试和备用 Provider 每次派发都计数；健康探测、手动/后台调用也可能共用这些全站桶。120/90/60 是全站派发池，不是“30 次生成各自必然可重试几次”的承诺。TTS 每次重试重新扣整段 UTF-16 长度；厂商可能按字符、字节、token、音频时长或最低计费单元结算，不能把代码单元直接当作账单字符。

只在已核实各实际模型的最大输入/输出、失败与重试计费规则、备用模型及最低计费单位后，才能填写：chat/embedding/reranker 的单次保守成本上界分别为 `c_chat / c_embedding / c_reranker`，TTS 可换算为每 UTF-16 单位的保守成本上界 `c_tts`。本提案的条件式规划上限为：

```text
B_window = 120*c_chat + 90*c_embedding + 60*c_reranker + 20000*c_tts
```

这些 `c` 是待核价的假设变量，本文件没有供应商报价，也没有账单保证。若单次成本上界无法建立，则不能把调用次数换算成金额，继续保持付费额度为零。还需单独预留历史未结算调用、税费/汇率及计费差异的缓冲，并由负责人填写允许金额与停止条件。

窗口使用 Redis 时间对齐的固定窗口，起点为 `floor(now/windowMs)*windowMs`，不是滚动 24 小时财务硬限额，也不是产品时区的自然日。紧邻边界可先后花完两个窗口：在上述假设均成立且没有额度重置时，跨边界的滚动 24 小时规划可能达到 `2*B_window`，再加约定缓冲。Redis 计数丢失、换 DB/namespace/HMAC 密钥或改窗口都会破坏原来的累计边界，必须按额度重置评审，不能用来绕过用量控制。

实现位置：[Redis 固定窗口与复合预算](https://github.com/NekoMint-Labs/Unfreq/blob/3dc418be670ca316df3ad109c1c09b333a9b2b44/apps/api/src/shared/abuse-control.ts#L35)、[TTS 实际派发计量](https://github.com/NekoMint-Labs/Unfreq/blob/3dc418be670ca316df3ad109c1c09b333a9b2b44/apps/api/src/modules/ai/tts.ts#L563)。

## 3. Nginx Proxy Manager → Caddy → API 的待验收链

这里的 NPM 指 Nginx Proxy Manager。仓库 [Caddyfile](https://github.com/NekoMint-Labs/Unfreq/blob/3dc418be670ca316df3ad109c1c09b333a9b2b44/deploy/Caddyfile#L1) 没有 `trusted_proxies`。Caddy 默认忽略传入的 `X-Forwarded-*` 值来防伪造，并根据直连对端生成转发信息。因此按这份默认配置经 NPM 转发时，原访客 XFF 会丢失；即使 API 信任 Caddy，也可能只识别到 NPM 地址，让所有访客共享其 IP 桶。**只配置 API 的 `TRUSTED_PROXY_CIDRS` 不能恢复已被 Caddy 丢掉的客户端地址。** 这是依据仓库配置与官方规则的推断，目标环境尚未读取或实测。[Caddy 转发头规则](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#defaults)

目标环境操作验收应按下列顺序留证；本提案不填任何真实 CIDR，也不授权改生产配置。

1. **读回实际链。** 保存 NPM/Caddy 镜像或版本、Nginx `nginx -T` 的有效 proxy host 与 custom include、Caddy 实际生效的适配配置、API 版本/信任列表；记录每跳实际 socket 对端及 IPv4/IPv6、NAT/容器网络关系。不要只看管理界面或仓库模板。确认 API/Caddy 上游端口不能被外部绕过入口访问。配置材料脱敏，不记录密钥或真实业务正文。
2. **逐跳确定信任。** NPM 入口须清理客户端提供的伪造转发头，Caddy 只信任实际 NPM 对端范围，API 只信任真实代理链中需被剥离的地址；只写“信任 Caddy”也不足以证明多跳解析正确。不使用 `trustProxy=true`、跳数或整个私网的一揽子信任。Caddy 的 `trusted_proxies_strict` 从 2.8 起可用；是否启用及转发追加方向须结合目标版本和真实头链核验。[Caddy 信任/严格解析](https://caddyserver.com/docs/caddyfile/options#trusted-proxies)、[Fastify trustProxy](https://fastify.dev/docs/latest/Reference/Server/#trustproxy)
3. **做双客户端验收。** 在获准的隔离 canary/验收 namespace 中，用公网出口不同的 A/B 客户端，调用无付费的合法合成诊断请求；同一 NAT 下两台设备不能证明 IP 分离。使用统一的小测试额度 N：A 经不同 API 副本累计前 N 次被接收、N+1 返回 429 且 `Retry-After>0`；B 的第一笔仍被接收。A 更换任意伪造 XFF、重复/多段 XFF、`Forwarded`、`X-Real-IP` 后仍受 A 原桶约束，不能借 B 或伪造值绕过。受控的不可信直连对端所带转发头也必须被忽略，公开直连入口应不可达。以短期受控观测或合成桶标记关联每跳，禁止增加公开 IP 回显接口。
4. **留结果再放行。** 保存用例时间、版本/配置摘要、A/B 合成标记、响应码与 Retry-After、各副本一致性及网络不可绕过证据。NPM 可加载 custom snippets，必须检查实际 include 与最终生成配置，不能从“NPM 存在”推断它已净化 XFF。验收结束移除临时观测；不 flush Redis、不轮换生产密钥来清测试桶。[NPM 官方配置入口](https://nginxproxymanager.com/advanced-config/)

现有 [IP 信任单元测试](https://github.com/NekoMint-Labs/Unfreq/blob/3dc418be670ca316df3ad109c1c09b333a9b2b44/apps/api/src/shared/request-identity.test.ts#L65) 和 [多 PID 伪造头/可信 CIDR 用例](https://github.com/NekoMint-Labs/Unfreq/blob/3dc418be670ca316df3ad109c1c09b333a9b2b44/apps/api/tests/integration/abuse.integration.test.ts#L34) 提供应用层回归依据；它们使用受控 peer/注入，不是 NPM→Caddy→API 真实部署链验收。

## 4. 配置一致性与故障处置

所有 API、副本和会派发 Provider 的 worker 必须共用同一 Redis 实例及逻辑 DB、同一 namespace、同一 HMAC 密钥和完全一致的 23 budgets/windowMs/并发策略；生成 C 与业务数据库也须一致。HMAC 可显式独立配置，未配置时本 HEAD 使用 SESSION_SECRET，因此不能让副本各自随机生成秘密。核验只比对受控指纹，不把秘密写进日志。不能用混合新旧策略的滚动过程来声称全局额度一致。

Redis 不可用或返回形状不可信时，受保护入口/新的远端派发应安全失败（通常 503）；额度不足返回 429 与剩余窗口的 Retry-After。保护拒绝不能被解释成普通 Provider 错误后换备用、重试或本地生成。已经在途的工作仍须实际终止和 drain，Redis 故障本身不证明厂商计算停止，也不撤销可能已发生的费用。

音频 READY/PENDING 缓存命中不再预留“新增音频”或重开付费任务，但读取/请求入口预算仍适用。已知未提交的失败才能按实现退款；未知 reservation commit、SQL/READY 回复不得猜退款或重建任务，必要时保留可能仍被引用的文件。TTS lease 只在实际合成/socket/文件/SQL 工作结算后释放；租约到期不等于 owned socket 已关闭。未知的持久 PENDING 需要读回、人工/后续恢复路径评审，不能承诺本 PR 已提供所有重启场景自动恢复。

对应源码与回归：[复合预算、HMAC 和 fail-closed](https://github.com/NekoMint-Labs/Unfreq/blob/3dc418be670ca316df3ad109c1c09b333a9b2b44/apps/api/src/shared/abuse-control.test.ts#L27)、[未知 commit 不退款](https://github.com/NekoMint-Labs/Unfreq/blob/3dc418be670ca316df3ad109c1c09b333a9b2b44/apps/api/src/modules/signals/audio-worker.test.ts#L153)、[每次重试与备用计量](https://github.com/NekoMint-Labs/Unfreq/blob/3dc418be670ca316df3ad109c1c09b333a9b2b44/apps/api/src/modules/ai/tts-lifecycle.test.ts#L364)、[多 PID 缓存/并发及真实 WS drain](https://github.com/NekoMint-Labs/Unfreq/blob/3dc418be670ca316df3ad109c1c09b333a9b2b44/apps/api/tests/integration/abuse.integration.test.ts#L192)。

## 5. 生成未知结果与 F1 的范围

`pendingPerUser` 按作者限制 DRAFT 中的 `RECEIVED/EXPANDING/MATCHING/WRITING` 受管生成任务；付费调用预算、共享生成 C 和 TTS 并发各自独立，不能互相替代。已经返回接收结果后遇到保护拒绝，worker 按 owner/CAS 尝试记录保护失败，不能悄悄改成本地内容；写入回复不确定时须读回/恢复，不能先宣称已经落库。生成只在能证明未派发的形状下安全重排；已有派发标记或存储结果不确定时保守结算 `GENERATION_OUTCOME_UNKNOWN`，不自动重复付费，也不保证供应商没有计费。[worker 失败分流](https://github.com/NekoMint-Labs/Unfreq/blob/3dc418be670ca316df3ad109c1c09b333a9b2b44/apps/api/src/modules/signals/generation-worker.ts#L139)、[派发后死亡不重放用例](https://github.com/NekoMint-Labs/Unfreq/blob/3dc418be670ca316df3ad109c1c09b333a9b2b44/apps/api/tests/integration/generation-checkpoints.test.ts#L80)

本 HEAD 的 [AI scheduler](https://github.com/NekoMint-Labs/Unfreq/blob/3dc418be670ca316df3ad109c1c09b333a9b2b44/apps/api/src/modules/signals/scheduler.ts#L17) 仍是进程本地每日 03:00 timer，[非 test 启动时会注册](https://github.com/NekoMint-Labs/Unfreq/blob/3dc418be670ca316df3ad109c1c09b333a9b2b44/apps/api/src/app.ts#L93)，不提供后续 F1 的持久业务日 claim、跨 PID 一次派发、显式生产开关或整批预算证明。B3 全站付费桶不能替代这些语义，生成请求 30 次也不能证明后台定时路径只有 30 次。pilot 前须核对所有定时/手动 caller 及目标启动路径；F1 调度验收单列，不把当前 PR 写成已经完成 F1。

本轮仅核对固定 HEAD 的源码、测试与官方代理资料，没有运行测试或目标链。历史 65 项/旧 CI 只属于原记录，不是任何重排后 HEAD 的新成绩。后续文档提交应保留固定来源、等待实际 HEAD 的必要检查；批准预算、启用付费调用和部署代理配置仍需分别完成上述前置与验收。
