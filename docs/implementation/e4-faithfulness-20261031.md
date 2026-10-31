# E4：Demo 指标纠偏、模式复核与忠实性评测准备

日期：2026-10-31。基线 `de26531`，本地分支 `codex/e4-faithfulness-demo`。实施依据为总规范 E4（R05/R11）。本轮未调用收费 Provider、操作生产数据、合并或部署；没有将 E3 历史通过记录移作本轮证据。

## 缺陷与修复

后台原来的“最终方案”实际调用 classifyFallback、tagsFallback、moderateFallback 和历史本地 matcher；随机基线、部分规则基线和三个消融结果直接写固定数值。现只保留实际计算的一组“Demo / 本地规则夹具”，删除固定比较与消融，返回数据版本、哈希、分子/分母、方法及 11 项逐条输出。当前合成预设命中为分类 4/4、标签 2/4、风险 1/1、旧 Demo Top-1 匹配 2/2；这些数值均不代表模型效果。风险分母只含一条风险样例，没有评估误报率；匹配不走 E3 线上算法。

契约新增 evaluationKind=DEMO_RULE_FIXTURES、modelQualityValidated=false、competitionEvidenceEligible=false、ablationStatus=NOT_RUN。保留 ablations 空数组供兼容。后台固定显示“Demo / 规则夹具”和用途限制；旧服务端没有完整来源标记时隐藏百分比，不能因仍收到 FINAL 字段就恢复旧展示。未新增公开接口，读取继续要求管理员身份。

扩写复核原先有两处相反行为：Provider 提示词和本地规则允许 aftertaste / clarify_thought 没有场景细节，schema 却无条件要求具体物体与感官；创建服务又会把高分、无问题的失败复核直接改为通过。现在 schema 按真实输入 classification.expansionMode 选择规则，并与本地复核共用模式判断。诗句余韵、观点澄清允许如实缺少这些细节；另外四种模式及没有分类上下文的调用保持检查。复核失败进入已有的一次修订、再复核流程，不能仅凭高分绕过。

旧 `ai:signals:evaluate` 报告已标为 Signal Text Heuristic Check (Demo)，说明只检查 text，seedText 仅供对照阅读，不评价忠实性、作者认可或模型质量。没有修改该启发式的线上数值公式。

## 评测准备

新增冻结集合 `apps/api/tests/fixtures/e4-seeds.v1.json`，共 60 条、10 类合成 Seed，SHA-256 为 `064e9bb2b51ca0e32e650549fce9a053a4c145a0c73833dbc8abc1d17a71435f`。材料由编码助手起草，source=synthetic-authored-not-user-data，humanValidated=false；分组不是人工情绪真值，尚无真实模型运行或独立人评。字节哈希与 Git 换行属性均有检查。

`faithfulness:evaluate` 只离线导入已捕获的当前生产创建/worker 路径记录，不加载 Provider 配置、不连数据库、不发模型请求。prepare 校验输入与原始捕获的哈希，复制证据并生成两份评分为空、顺序各自打乱的盲评表。组织者保留 key，评审只见 Seed、正文与候选；候选 ID 仍保留，查询的 caseId/signalId 和模型元数据不进入评分表。

summarize 重新校验证据，拒绝重复请求、漏评、相同评审身份、未确认独立性、正文错配或空匹配被打相关性分。汇总明示数据来源、覆盖分母、失败、降级、分歧、p50/p95 和未知费用；作者认可始终为 null，不自动批准模型质量、参赛证据或消融。哈希只能检查文件一致性，不能证明声称的生产路径实际执行过。完整运行口径、字段和命令见[盲评说明](../faithfulness-evaluation.md)。

## 验证记录

- `npm run check` 通过，见 `test-results/e4-check.log`：运行器 14/14、API 662/662、Web 136/136，lint、类型检查及两端构建通过。离线工具最后两处校正后，相关 14 项专项、API lint/类型/构建再次通过，见 `test-results/e4-evaluation-final.log`；CLI 黑盒 1/1，见 `test-results/e4-cli-smoke-final.log`。CLI 中的评分都是测试构造值，不计为人工评测。
- 模式专项最终 4 文件、94/94，见 `test-results/e4-modes-targeted.log`；后台专项串行 16/16，见 `test-results/e4-admin-targeted-20261031-serial.log`。最早的专项因系统 Temp rename EPERM 未收集测试，改用仓库 test-results 内的 Temp 后执行；后台一次既有冷导入超过原 5 秒，串行重跑通过，没有放宽超时。
- 生产构建浏览器 27/27，见 `test-results/e4-browser-final.log`。新增 E4 两项覆盖桌面、390px、减少动画、键盘展开、旧响应隐藏百分比及匿名/普通用户后台拒绝。已查看 `test-results/runtime/production-E4-keeps-tracea-a17e6-dence-on-desktop-and-mobile-chromium-production/` 的两张 E4 截图。浏览器使用本地合成 API，不证明真实后台鉴权或数据库行为。
- 首次生产浏览器在页面断言前因沙箱下缺少缓存浏览器启动失败，日志 `test-results/e4-browser-production.log`；读取当轮 trace 确认错误路径后，指定已有用户缓存，独立 Chromium 启动检查通过。该次测试服务未退出，核对确切 PID 与命令后只结束本轮三个残留进程。随后一次启动因端口仍占用而拒绝，记录在 `test-results/e4-browser-verified.log`；最终完整回归在可正常管理测试进程的环境执行。没有把环境失败记为页面通过。
- 开发模式首轮 5/6，首个星图 `page.goto` 在原 60 秒预算内未完成；日志 `test-results/e4-browser-development.log`，trace 与错误上下文复制到 `test-results/e4-dev-first-failure/`。同一预算完整重跑 6/6，见 `test-results/e4-browser-development-final.log`。还原 Next dev 自动添加的重复类型目录，没有修改测试超时或隐藏首轮失败。
- 部署脚本替身回归通过，见 `test-results/e4-deploy-scripts.log`；首次 Git Bash 被沙箱系统对象权限拒绝后，在允许的环境运行。只测试脚本，没有部署。
- 本轮真实 API/PG/Redis 隔离回归 6 文件、94/94，failed/pending/todo 均为 0，退出码 0，cleaned=true，耗时 340.95 秒。证据为 `test-results/e4-integration.log` 与 `test-results/integration/run-I6L4Mm/` 的 manifest、vitest 和 runtime-marker，runId 为 `c7f701c8d2e3`。新增 E4 管理员接口的匿名/普通用户拒绝、Demo 来源和分子/分母复算通过。首次检查发现本地 Docker 引擎未运行，启动 Docker Desktop 后验证引擎 29.7.2；本轮使用新建临时 PG/Redis 和回环 Provider，结束后随机项目的容器、网络均已清理，没有读取生产 `.env` 或复用现有卷。
- 集成期间 API、契约与夹具没有改动；结束后核对 runtime-marker 内全部源输入哈希，以及 `test-results/e4-source-20261031.json` 中 32 个变更源码/测试文件哈希，均匹配。入口哈希为 `a363581200c1d1275bad3ae148ffe395dd1afdb2deef5b6e6ee68d00516644aa`，仅代表该入口；本轮额外纳入 Provider、提示、schema、模式规则、文本检查及后台 Demo 计算模块，完整范围以标记为准，不宣称全仓库签名。

本轮没有依赖变更，复用现有安装与锁文件，没有重新执行 npm ci。未做实体手机、读屏器、真实模型或生产环境验收。Three.js 与 Next Edge Runtime 的既有弃用提示继续保留，未借 E4 扩大依赖升级范围。

## 尚未完成

E4 的真实效果验收仍未完成。60 条合成输入不能代替脱敏真实分布；E3 现有 4 查询/77 候选也不能代替 50–100 查询的人评匹配集。仍需实际模型、完整失败与降级记录、费用范围、至少两位独立评审，以及实际作者反馈。

指纹 fallback 会填入固定心理需求和冲突，taxonomy 的无关键词默认值仍可能套用困扰语义。本轮只验证既有轻松/喜悦/玩笑强制负向拒绝 guard，没有以合成回归宣称该风险解决。应在真实评测与产品规则确认后实现最小未知/不展示/修订路径，不通过扩大情绪词表掩盖缺口。真实消融必须关闭机制后重跑，不能写固定比较分。

没有数据库迁移或依赖升级；API、contracts 与 Web 应一起更新。回退使用本轮独立提交，保留 C1–E3 的既有公开及版本保护。下一项可独立推进的工程工作为 F1：先补注册/凭证镜像原子性和只读差异检查，再处理 scheduler 的业务时区、持久单日领取与批次账本。健康探针已有分离和故障证据，不重复改写。

本轮保存为独立本地提交，分支 `codex/e4-faithfulness-demo`，尚未推送或合并。原始运行证据仅在被忽略的 test-results 目录保留，没有把合成 CLI 评分或私密捕获作为实测指标提交。
