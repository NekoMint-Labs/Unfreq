# Seed 忠实性评测准备与盲评

后台“Demo / 规则夹具”只运行固定合成内容和本地规则。它没有调用真实模型，也没有人工相关性标注，不能放进参赛实测指标。分类、标签和风险结果可以从后台的逐项输出复算；其中匹配使用历史 Demo scorer，不是 E3 的生产召回与重排。

`ai:signals:evaluate` 是文本启发式检查，只检查给定输出的写法。即使附有 seedText，也不比较原意，不能用其分数证明忠实性、没有编造或作者认可。

## 冻结输入

`apps/api/tests/fixtures/e4-seeds.v1.json` 包含 60 条由编码助手起草的合成 Seed，覆盖喜悦、放松、玩笑、荒诞意象、观点、诗性片段、日常、困扰、混合情绪、含糊或疑问十类。这些材料不是真实用户样本，也未经人类验证。category 是选题分组，不是情绪真值或标准答案。

文件旁的 SHA-256 和 `.gitattributes` 共同防止换行转换后静默改题。新增或修改样本应升版本并重新冻结；不要为了改善成绩改掉失败输入。该集合尚无实际模型输出或人评，60 这个数量不构成统计代表性。

E3 的 4 查询/77 候选仍是另一份合成回归集。本次没有增加一份伪装成真实相关性标注的 50–100 查询集；真实匹配样本和两位独立标注者仍需补齐。

## 捕获当前生产代码路径

在另行批准的模型、环境、样本和费用范围内，逐条通过 `POST /api/signals` 创建表达，等待真实 generation worker 完成或失败，读取作者私密结果及本次 AI 审计记录。不要用另一套简化扩写或评分器代替。评测样本保持私密，不需要发布；匹配候选另须满足 C1/E3 的公开与来源约束。

当前离线工具不负责发送这些请求，没有自动收费入口。它导入已有捕获，并检查样本、哈希、状态与评分配对的一致性；这些检查不能证明文件声称的代码路径确实执行过。原始请求/响应、审计记录和执行日志仍需由运行者保留和审核。只有导入脚本通过，不能宣布模型质量验收通过。

捕获 JSON 使用 `e4-capture-v1`，顶层包含：

| 字段 | 内容 |
| --- | --- |
| datasetSha256 | 原始数据文件的字节 SHA-256 |
| codeSha / promptSha256 | 实际运行提交及提示词文件 SHA-256；有未提交修改时不能用旧提交代替实际源码证据 |
| executionPath | 固定为 `POST /api/signals -> generation worker` |
| environment | `loopback-stub` 或 `external-model`，不得混淆 |
| rawEvidence | 原始捕获文件的 path 和 sha256；相对路径按捕获 JSON 所在目录解析 |
| records | 每条请求的完整结果或失败记录，不能只导入成功样本 |

每条记录必须含 caseId、原始 seedText、不同的 signalId、status、outputText、matches、provider、model、fallback、latencyMs、tokens、currencyCost 和 currency。status 为 COMPLETED 或 FAILED；失败正文必须为 null，匹配为空。matches 至多三条，每条含 id 和 text。没有可靠 token 或账单信息时写 null，不能写成零费用。不同执行阶段用了不同模型或降级时，完整轨迹放进 rawEvidence，记录中的模型字段仅用于索引，不替代轨迹。

工具允许先检查子集，但会报告冻结集合、已捕获、完成、失败及降级的数量。子集报告不代表其余输入通过。费用只在每条均有金额且币种一致时合计；p50/p95 按已捕获请求计算，包含失败请求，采用 nearest-rank。单次失败后的重试应保留为单独运行，不覆盖原捕获。

## 准备两份独立盲评

先构建 API，再从仓库根目录执行，路径建议使用绝对路径：

```powershell
npm run api:build
npm --workspace @unfreq/api run faithfulness:evaluate -- prepare --dataset E:/unfreq/apps/api/tests/fixtures/e4-seeds.v1.json --capture E:/unfreq/test-results/e4-real-capture.json --out E:/unfreq/test-results/e4-review-round-1
```

prepare 检查冻结数据和原始证据的字节哈希，将两份证据复制到全新的输出目录，拒绝覆盖已有评分。key.json、dataset.json 和 raw-evidence.bin 留给组织者，不交给评审。两位评审分别收到 reviewer-a.json 和 reviewer-b.json；表中只保留原始 Seed、生成正文与匹配候选，隐藏模型、被评表达的 caseId/signalId、选题类别和降级状态，并分别打乱顺序。候选 ID 仍保留用于识别匹配项。

所有评分初始为 null。两位评审独立填写不同的 reviewerId，完成后将 independentReviewConfirmed 改为 true，并按下列口径评分：

| 字段 | 口径 |
| --- | --- |
| faithfulness | 1–5；1 表示明显改写原意，3 表示大意尚在但有明显偏移，5 表示忠实保留原意与语气。不是文字华丽程度。 |
| fabrication | 是否加入原句没有依据的人物、经历、关系、诊断或事件；需要想象的输入按其允许范围判断。 |
| forcedNegative | 是否将轻松、喜悦、玩笑或中性输入强行解释为困扰。 |
| matchRelevance | 有匹配候选时用 1–5 评价该组候选与 Seed 的相关性，1 无关、3 部分相关、5 高度相关；没有候选时必须留 null。它不替代 E3 的逐候选相关等级。 |
| comment | 记录理由或需要复核的片段。 |

两位评审不能代替真实作者给出“作者认可”。本集合没有真实作者反馈，authorApproval 保持 null。需要作者认可时另收实际作者反馈，不能由编码助手或评审补写。

```powershell
npm --workspace @unfreq/api run faithfulness:evaluate -- summarize --key E:/unfreq/test-results/e4-review-round-1/key.json --first E:/unfreq/test-results/e4-review-round-1/reviewer-a.json --second E:/unfreq/test-results/e4-review-round-1/reviewer-b.json
```

summarize 重新检查复制的数据和原始证据哈希，并拒绝空白评分、相同评审身份、漏项、重复项、错配和被改动的正文。它报告均值、二元标记率、覆盖范围、延迟、已知费用及分歧项；两人相差超过 1 分或二元判断不同的项目需要人工复核。每个均值的分母是评分次数，两位评审评价同一条内容会产生两次评分。没有评分时输出 null。

摘要始终保留 modelQualityValidated=false、competitionEvidenceEligible=false、authorApproval=null、ablations=NOT_RUN。是否形成有效模型证据仍需核实样本来源、实际执行、盲评独立性和失败处理。做真实消融时，必须在同一冻结输入上实际关闭机制并重新运行；本工具不会生成固定消融百分比。

原始输入、捕获和人评只放在被忽略的 `test-results/` 或另行批准的位置，不提交真实用户数据、密钥或 Cookie。命令失败时只输出通用原因，不回显可能含私密 Seed 的解析错误。
