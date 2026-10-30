# E2：Rerank 分数统一、整批回退与评分来源

日期：2026-10-30。依据总实施规范 E2 / R04，基线为已同步 E1 的 `e662fc9`，工作分支 `codex/e2-rerank-scores`。本记录对应本地实现和合成测试；未合并、部署或调用收费模型。

## 已修复的边界

原实现把 Provider 原始分直接放进 `0.6 × score + rules`，而 cosine 分已放大至 0–100。相同相关性的 0.9 与 90 会产生不同融合结果；缺分 ID 还会单独回填 cosine 分，形成同批混用分布。修复前通过真实 adapter/transport 加本地 fetch mock 运行回归，两项均失败，原日志保留于 `test-results/e2-baseline.log`。它证明合成输入下的算术缺陷，不证明已有线上排序或模型质量结论。

Reranker adapter 现在要求每个配置声明分数含义：相关性、越高越相关，范围只能为 `zero_to_one` 或 `zero_to_hundred`。统一输出 `[0,1]` 的 score，同时保留 rawScore/rawScale；规范版本为 `relevance-range-v1`。不按数值大小猜量纲，不自动夹紧负值或超界值，不对未声明的 logits 擅自使用 sigmoid。0 和上界均合法；NaN、Infinity、非数值及范围之外的分数不可用。

[SiliconFlow 官方接口](https://docs.siliconflow.cn/docs/api/rerank-post)描述按相关性重排，并提供 results/index/relevance_score、top_n 和 token 元数据示例。该页面的一个小数示例不足以证明所有模型/部署都具有相同量纲。因此 SiliconFlow 和通用接口都需要配置声明，不根据品牌自动填写。SiliconFlow 请求显式要求返回本批全部候选，且不要求回传文档正文。

候选批次采用一致策略：缺 ID、重复/未知 ID、越界 index、无效分、空/部分结果均使整个 Provider 批次不可用。可以继续尝试下一个有明确契约的配置；只接受某一个 Provider 的完整结果，不拼接多个 Provider 的分数。所有 Provider 失败、超时或未配置时，本批统一退回原 cosine 映射。取消、预算保护、失去任务所有权仍直接停止，不能转成普通匹配降级或继续派发。

## 配置与兼容

后台 Provider 表单增加“分数范围（高分表示更相关）”，支持未声明、0–1、0–100。读取和再次保存已有记录会保留声明；检测接口也使用相同契约，完整候选覆盖才算结构检测通过。未知范围被 API 拒绝，不会当作自动识别模式。

- 数据库配置使用现有 `provider_configs.extra_json.scoreScale`。
- 环境配置新增 `RERANKER_SCORE_SCALE`，允许空值、`zero_to_one`、`zero_to_hundred`。
- 不修改已有数据库记录或自动推测历史声明。旧配置缺少声明时标为 degraded，匹配走语义回退；后台可在核对该模型约定后补选范围。
- 第一个配置不可用时仍检查后续配置，不让一个未声明的首项挡住已声明的备用配置。
- 没有数据库迁移。Compose 已通过 env_file 传入配置；测试环境显式固定该字段，不继承真实环境的范围或凭据。

相同模型升级后如果打分范围或含义改变，必须重新核对声明及冻结样本。声明范围只约束算术量纲，不是模型相关性的校准证明。

## 融合与公开结果

规则原始分仍为原来的四项相加，最高 40：主频段 20、子感受 10、情绪 5、核心需求 5。`scoreSignalMatch` 本体和星图使用的规则分没有改权重。统一计算为：

```text
rule01 = rawRuleScore / 40
cosine01 = 1 / (1 + cosineDistance)     # 保留旧映射，距离应在 [0,2]
rerank01 = rawScore / 声明的上界       # 仅接受已经验证的 0–1 或 0–100
publicScore = 100 × (0.6 × retrieval01 + 0.4 × rule01)
```

这就是旧语义分 `0.6 × retrieval(0..100) + rules(0..40)` 的显式尺度表达，不是新调出来的权重。只有规则时 retrieval 取 0，结果仍等于原始规则分。最终显示才舍入至四位小数；内部不先把不同量纲的值取整。cosine 输入为非有限值或不在数学范围内时不能进入语义排序。没有新增相似度接受阈值。

公开 score 保留 0–100 接口范围，超过 100 的值被拒绝而非夹紧。每条匹配追加可选 scoreProvenance：版本、显示尺度、`rules/cosine/reranker` 方法，以及 `rules_only/reranker_complete/reranker_not_configured/reranker_failed` 原因。两层公开投影和响应 schema 都保留这四个受控字段，同时继续排除 Seed、画像、原始分、Provider/model、凭据和用量。旧客户端可忽略追加字段。

这些数值是排序用的组合分，不是匹配概率，也不是心理诊断。启用 rerank 不代表效果提升。候选 K、混合召回、本人/AI 来源、接受阈值和“暂无合适同频”仍留给 E3；冻结真实样本和人工标注通过前，不调整默认权重。

## 旧新排序与成本记录

以下全为合成候选 A/B；A 的 cosine 距离为 0.2，B 为 0.5。旧列按旧公式/缺分策略计算，新列来自回归断言。排序同分按 ID 确定。

| 条件 | 旧结果 | 新结果 |
| --- | --- | --- |
| 原始重排 A=0.9、B=0.2，两条规则均为 40 | A=40.54，B=40.12 | A=94，B=52 |
| 原始重排 A=90、B=20，声明 0–100，规则均为 40 | A=94，B=52 | A=94，B=52，与对应的 0–1 声明相同 |
| 原始重排 A=0.9、B=0.2，A 规则为 0、B 为 40 | B=40.12 排在 A=0.54 前 | A=54 排在 B=52 前 |
| 只有 A=0.9，B 漏分，规则均为 40 | B=80 排在 A=40.54 前 | 整批 cosine 回退，A=90 排在 B=80 前 |

`signal.match.scoring` 记录同一候选集的旧公式/新公式排序、原始范围和规范化分，不新增 Provider 调用。`rerank.generate` 记录实际执行配置、响应报告模型、尝试轨迹、耗时、候选数量与安全用量。`rerank.attempt` 对每次已经派发的请求独立记录，即使后续预算拒绝或取消，也不会把此前的派发误记成没有成本；无已确认结果时标为 STOPPED_OR_UNACKNOWLEDGED。

用量只提取非负安全整数 token 字段，兼容 usage、tokens、meta.tokens；不记录任意 Provider reason、完整响应、query、候选正文、URL 或密钥。费用始终标记 unknown，缺失用量不能记作免费，token 用量也不能直接当作账单金额。实际金额需要运营方适用单价和 Provider 账单核对，本轮没有设置或虚构单价。

调用计数回归包括：未声明范围 0 次；正常完整结果 1 次；无效首项后完整备用结果 2 次；两个候选部分返回后无可用备用项只调用 1 次并整批回退。失败请求可能计费，回归保留其已报告用量；每次备用调用仍经过原有共享预算和任务栅栏。

## 验证记录

专项包括 0–1/0–100、负值、NaN/Infinity、重复/未知/缺 ID、非法 index、超时、整批回退、备用调用、同分确定性、旧新排序及安全日志。公开投影测试曾发现第二层手工白名单遗漏新增评分来源，修正后同时验证两层；没有放宽 C1 的私密字段断言。旧 C1 中“暂不限制 250 分”的延期测试已按 E2 契约改为拒绝超界值，保留全部有限性、权限和隐私验证。

首次 `npm run check` 的唯一单测失败为旧 250 分预期，见 `test-results/e2-check-first.log`。随后全仓库检查通过：API 52 个文件 627/627、Web 18 个文件 131/131；类型、lint、两端构建和运行器 14/14 通过，见 `test-results/e2-check-final.log`。补逐次派发记录后，最终 `npm run api:check` 仍为 627/627，见 `test-results/e2-api-final.log`。

隔离运行首轮 `run-5fqSBL` / `750c007a09a4` 在运行时预检发现测试清单误列未编译的 provider-stub.js，exit 1、未创建容器、cleaned true；日志 `test-results/e2-integration-final.log` 保留。该 stub 只在测试进程运行，修正为源文件哈希校验，实际 API adapter/scoring 模块仍校验编译产物。修改后的运行器安全检查再次 14/14，见 `test-results/e2-runner-final.log`。

最终独立隔离集成 `run-aQ6SiS` / `a120306a8d09` 为 6 个文件、89/89 通过，exitCode 0、interrupted false、cleaned true，见 `test-results/e2-integration-verified.log`。新数据库/HTTP 用例验证范围经管理员接口保存、真实 transport 读取该声明、0–100 归一化、带用量的部分结果被拒绝，以及公开 HTTP 响应完整保留安全评分来源。原有预算、多进程取消/恢复、撤回和权限过滤回归均包含在该轮。manifest、JSON 报告及不可变运行时位于 `test-results/integration/run-aQ6SiS/`。

提交前复核，全部 59 个运行时源文件输入仍与该轮 SHA-256 一致。源码指纹记录于 `test-results/e2-source-20261030.json`；测试日志和运行时产物被 Git 忽略。所有外部响应均来自本地 stub/mock，本轮没有真实模型质量、人评、收费调用或新的浏览器操作验收。

E2 代码提交为 `bfc6e98c91162e6f3db54c951d3e77bc7f374ac6`，已推送至 [E2 工作分支](https://github.com/NekoMint-Labs/Unfreq/tree/codex/e2-rerank-scores)，并以远程引用核对到同一提交。随后追加本次同步记录；未创建 PR、合并或部署。feature 分支推送未自动触发仅针对 main/PR/手动入口的远程 CI，本记录中的测试均为本地执行。

## 回退与后续

不覆盖历史向量、审计或内容数据。上线前逐项确认启用配置的分数范围；尚无证据的范围保持未声明，走原语义/规则路径。需要回退时，可在已授权发布流程内清空范围声明或禁用 reranker 配置，保持 E1 的空间隔离和 C1 的公开过滤；本轮没有执行真实环境配置变更。

下一项为 E3 的召回和接受策略；不能把本轮合成分数修复当作 Recall、nDCG、人评相关性或整体匹配质量已经提升。
