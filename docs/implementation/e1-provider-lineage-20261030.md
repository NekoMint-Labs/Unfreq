# E1：实际 Provider 血缘与向量空间契约

日期：2026-10-30。依据所有者提供的总实施规范 E1 / R13、R14。基线 `c244a69`，工作分支 `codex/e1-provider-lineage`。本记录只对应本地代码和合成测试；未合并、部署、迁移真实数据库或调用收费模型。

## 实现

Chat transport 返回 `{ output, execution }`，业务校验只解析 output，审计直接保存 execution，不再重新解析配置首项。execution 包含实际任务、所用 Provider、模型、按序尝试的 fast/default 配置、失败种类、HTTP 状态、耗时及可用的 token 用量。响应提供格式合法的 model 时，顶层模型采用该报告值，同时保留尝试时请求的模型；未报告时仅能记录请求模型，不能据此证明服务端物理模型身份。

提示版本为 system prompt、公共生成参数和输入序列化版本的 SHA-256；规则降级明确标为 `local-rules / local-rules-v1`，保留此前失败调用和已经产生用量的无效业务输出。新增 `ai_reviews.execution_json` 可空字段；旧审计不回填推测血缘。管理员读取接口追加 execution，原 outputJson 不混入系统元数据。

新记录只提取规定的模型字符串和非负安全整数 token 字段，不复制响应原文、请求正文、URL、请求头、密钥或任意 usage 子字段。费用统一为 unknown，未提供用量不等于免费；耗时是本地 transport 观察值。原有审计 inputText 的生命周期不在本项改动范围。审计存储失败仍不能触发第二轮生成，取消、租约和共享预算仍在每次 dispatch 前生效。

## 向量空间和输入

`embedding_version` 沿用现有列，新的值为 `es1:<SHA-256>`。哈希输入按固定顺序包含：

1. 实际 Provider。
2. 实际报告模型，未报告时使用请求模型。
3. 维度。
4. 归一化约定 `provider-output-cosine-v1`：保留 Provider 原始向量，使用 pgvector cosine distance，不额外缩放。
5. 输入模板 `signal-body-v1`。
6. 原有手工配置 version，作为额外隔离开关。

密钥轮换不改变空间。模型别名报告变化也会分空间；服务端同名模型暗中换权重无法由客户端自动识别，运营方仍需锁定模型版本或更新手工 version。修改归一化或模板时必须修改对应版本常量，不能只修改展示文案。

创建、公开详情和回填都使用同一个 `buildSignalEmbeddingText`，实际输入是 `正文：` 加正文：首尾 trim、CRLF/CR 转 LF，保留其余内容。不包含 Seed、分类、隐藏画像或私密指纹。公开详情从作者确认的 snapshot 取正文。候选还必须满足确认正文等于被向量化的当前正文，未确认的后续修改不能借用原向量参与公开检索。

语义仓库接口必须传入完整空间元数据，同时过滤空间键、Provider、模型、记录维度和实际 `vector_dims`。旧 `v1`、空版本及不同空间不进入同一 cosine 查询；不提供无版本的宽松查询入口。零向量在适配器被拒绝，避免未定义的 cosine distance。空语义候选仍保留本次 query 向量供创建阶段写入，避免同一次生成重复调用 embedding。

公开详情有配置时仍会生成 query 向量；本项没有引入读时批量修复。HTTP 日志传入 `purpose=public-detail`，记录调用次数、重试/备用轨迹、空间、耗时、输入长度及 Provider 提供的用量，生成日志的 persisted=false 表示该步骤尚未持久化。候选日志明确 `legacyVectorsIncluded=false` 和数量。详情不会覆盖已存向量；需要后续降低重复读取费用时，应另做有配置版本和授权边界的缓存方案。

## 旧数据、索引与回填

旧内容继续按现有公开确认和作者权限读取，旧向量原样保留。因为旧数据不能证明输入模板，新空间不会默认信任它们；已有内容可能暂时只走关键词匹配。这一覆盖变化必须结合候选日志和以下清点结果观察，不能把关键词兜底宣称为旧空间语义召回通过。

0025 迁移只新增可空审计列，没有 ALTER/DROP 向量列或索引。仓库 0011 中的 ivfflat 建索引语句原本只是注释，0015 已改为无固定维度的 vector；本轮没有假定目标环境已建 ANN 索引。发布前应在目标环境只读清点实际索引和各空间数量，保留原定义。混合维度如要使用 ANN，需分别评审带明确维度 cast 和空间谓词的表达式/部分索引，并用实际查询的 EXPLAIN 验证命中；不能直接把旧索引当成新空间已加速的证据。

```sql
SELECT embedding_provider, embedding_model, embedding_dimensions,
       vector_dims(embedding) AS actual_dimensions, embedding_version,
       status, count(*)
FROM signals
GROUP BY 1, 2, 3, 4, 5, 6
ORDER BY 1, 2, 3, 4, 5, 6;

SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'signals';
```

缺失向量回填脚本默认 dry-run，仅选择当前确认公开、正文一致、向量为 NULL 的 COMPLETED 内容，排除未确认、撤回、隐藏、删除和私密草稿。稳定按 createdAt/id 排序，单批 1–1000 条；每条调用前复核公开版本，写入以原正文、原公开版本和向量仍为空作 CAS。回填执行期间撤回或正文改变时不写入。旧的非空向量永不覆盖，不通过清空旧向量变相触发重嵌入。

预览输出 planKey、行数、各请求空间、输入长度、最大 dispatch 次数和最坏重试输入长度，不输出正文、ID 列表、密钥或 URL。配置快照固定于同一批次；最多每配置四次尝试，所以上限为 `行数 × 配置数 × 4`。长度按 JS UTF-16 单元计，不等于计费 token。未提供单价和完整用量时，货币费用与 token 估计均为 unknown；真实执行需按日志中的 Provider/model/usage 与适用价目核算，失败请求也可能计费。

以下为后续操作命令说明，本轮未在真实数据上执行：

```powershell
npm run api:build
# 仅预览，不调用 embedding Provider
npm --workspace @unfreq/api run embeddings:backfill -- --limit=100
# 另行批准实际范围、配置和费用后才执行
npm --workspace @unfreq/api run embeddings:backfill -- --limit=100 --apply
```

已有非空旧向量的迁移需另行批准具体范围和费用。先封存清点结果、原元数据和原索引定义，再按作者确认正文建立带 signalId/公开版本/正文摘要/空间键的影子批次，核算实际成功、失败、用量和费用；核验新空间召回后再评审切换及索引。不伪造历史模板，不批量补授权，不原地覆盖旧向量。影子迁移执行器及生产切换不属于此次交付。

实际发布需先应用 0025 增量迁移，再上线依赖该字段的应用。回滚应保留可空审计列和全部旧向量，优先停止 embedding 调度并使用关键词检索；回退应用不能把旧向量改标为新空间。Provider 停启和真实发布仍需另行授权，本轮没有执行这些操作。

## 验证与同步

专项初轮 70/70 通过。全量初轮保留了 5 个夹具/契约适配失败及一个随超时暴露的未完成断言：旧断言仍预期裸业务对象、旧 v1 版本、无正文前缀和已经移除的配置重读阶段；更新为新契约及真实响应解码取消栅栏后再验收，没有扩大超时或放宽隐私断言。日志 `test-results/e1-unit-initial.log`、`test-results/e1-unit-focused.log` 保留。

`npm run check` 通过：API 49 个文件、583 项单测，Web 18 个文件、130 项单测；类型、lint、两端构建和运行器安全检查 14/14 均通过，见 `test-results/e1-check-final.log`。收紧回填范围及版本栅栏后，单独重跑最终 `npm run api:check` 也通过，API 仍为 583/583，见 `test-results/e1-api-final.log`。本轮没有修改 Web 运行时代码，没有借用 D4 浏览器结果宣称新的浏览器验收。

最后独立执行的 `npm run api:integration` 为 6 个文件、87/87 通过，runDirectory `run-5bM9Pf`，runId `bb501b117c5c`，exitCode 0、interrupted false、cleaned true。日志 `test-results/e1-integration-final.log`；manifest、JSON 报告和不可变运行时指纹在 `test-results/integration/run-5bM9Pf/`。新增数据库用例验证：新旧空间及 3/4 维混存只召回同空间；错误维度元数据不引发 cosine 异常；旧正文可读且旧向量不覆盖；未确认正文和私密草稿不进入回填；回填写入受正文及公开版本栅栏约束；审计血缘落库和旧审计 NULL 兼容。0025 快照比对也确认只有该可空 jsonb 列新增。

所有 Provider 测试使用本地 stub/mock，未调用真实模型、执行真实回填或核算真实账单。本轮没有修改评分权重，也没有完成后续 E2/E3 的评分和真实模型评测。源码指纹保存于 `test-results/e1-source-20261030.json`；本地日志及运行产物被 Git 忽略，不上传含运行细节的测试目录。提交前再次校验，全部 56 个集成运行时输入仍与通过测试时的 SHA-256 一致。

E1 代码提交为 `2292eaa59365cb0f50abdf5fb671a5e2b00dad34`，已推送至 [E1 工作分支](https://github.com/NekoMint-Labs/Unfreq/tree/codex/e1-provider-lineage)，并以远程引用核对到相同提交。随后追加本次同步记录；未创建 PR、合并或部署。当前 CI 只在 main 推送、PR 或手动触发时执行，本记录不把 feature 分支推送当成远程 CI 通过。
