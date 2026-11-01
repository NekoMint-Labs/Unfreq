# 测试与隔离验证

## 统一检查

```bash
npm ci
npm run check
```

`check` 包含 contracts 类型检查、API lint / 类型检查 / 单测 / 构建，以及 Web lint / 类型检查 / **Web 单测** / 构建。也可单独运行 `npm run api:check`、`npm run web:check` 或 `npm run web:test`。

API 默认 Vitest 只收集 `src/**/*.test.ts`，不会因为新增集成用例而突然要求本机已有数据库。单测配置禁载项目 `.env`，清空外部 Provider 地址和密钥，并将数据库配置指向不可用的本地测试地址；业务替身须显式定义，不应依赖真实服务失败后回退。单测最多使用 2 个 worker，限制冷启动时多个 Fastify / TypeScript 实例的资源争用，保留默认 5 秒用例超时和全部用例。

## 真实 API / PostgreSQL / Redis 集成

需要 Node.js 22、npm 依赖和已启动的本地 Docker Engine / Docker Compose：

```bash
npm run api:integration
```

该命令使用真实 Fastify 应用的 `inject()` 请求生命周期、真实 PostgreSQL 与 Redis 驱动和真实历史迁移。AI 只有一个本机 HTTP 桩，返回合成、符合当前 schema 的固定响应；它验证编排、权限、存储和回退契约，**不评价真实模型效果**。它不启动浏览器，也不替代前端真实后端联合验收。

运行过程：

1. 验证 Docker context 使用本机 socket / named pipe，拒绝远端 Docker host 和外部连接参数。
2. 生成随机 `unfreq-it-<run id>` 项目名，使用 `tests/integration/compose.yaml`；显式空 env 文件，绝不读取根生产 Compose 或项目 `.env`。
3. 启动全新的 pgvector / Redis 容器，只绑定 `127.0.0.1` 的随机非默认端口。数据放在临时存储，不复用既有数据库、网络或命名数据卷。测试镜像已固定 digest。
4. 测试端再次核对运行标记、合成数据库名 / 身份与本地端口，拒绝对已有表的数据库进行首次迁移。执行真实 Drizzle migrations，不使用 `drizzle-kit push`。
5. 普通链路关闭每日 scheduler 和实际 Provider 配置；F1 专项仅在自己的新建 case 数据库显式启用受控 scheduler。HTTP fetch 只允许精确的本地桩 origin，尝试其他 HTTP 目标会失败并记为测试错误。
6. 等待合成生成任务和数据库副作用排空，关闭应用、连接池、桩服务；检查容器项目 / 服务标签后，只清理本次随机项目。结束后复核该项目没有残留容器。

命令不能指定已有数据库 URL、复用生产项目名或切换到生产 Compose。运行日志会显示证据目录：

```text
test-results/integration/run-<suffix>/manifest.json
test-results/integration/run-<suffix>/vitest.json
```

manifest 保存随机项目、合成端点、实际镜像 digest、测试计数、退出码和清理结果。JSON 报告必须有实际执行的测试，且没有失败、跳过或 todo，runner 才返回成功。目录已由 Git 忽略，禁止把原始日志、下载缓存或真实数据提交进仓库。

生成故障的子进程使用本轮 `run-*/runtime` 中一次编译的真实 API 与夹具，保持同一相对目录和共享执行上下文；不复用 `dist`、增量缓存或旧轮产物，也不回退到 TSX。编译失败、归属或关键文件哈希不符时拒绝启动。该检查覆盖入口和共享上下文等关键文件，不能表述为全目录签名。核心 API 与 EOF / RST 的父测试仍保留各自源模块；父进程继续执行源目录中的真实 SQL 迁移。

初始化阶段及失败后的有界方法耗时只记录固定阶段、ID、时间和状态，不记录输入、请求头、响应正文或异常内容。仓储调用耗时包含连接等待、数据库执行和调度，不等于纯 SQL 执行时间；Provider 的响应 finish / close 也不能证明客户端已消费或外部计费结果。超时之后采集诊断，不会改变原失败判定。

进程被强制终止、Docker 中途退出或系统关机时，`finally` 可能没有机会完成。此时先查 manifest 的项目名，再按 **该项目** 的 Compose 标签盘点容器和网络；确认全部属于本次运行后再清理。不要使用全局 `docker system prune`、无项目限定的 `down` 或清理未知卷。

## 覆盖与边界

核心集成用例覆盖：

- 注册身份及镜像持久化、密码验证、HttpOnly Cookie、未认证与篡改 Cookie 拒绝。
- 真实 Redis 邮箱挑战的哈希、TTL、冷却、错误次数、成功认证及消费后重放拒绝；只观察合成 delivery 值，不替换真实业务函数。
- 生成 pending → 作者私密预览 → 确认发布，未登录 / 非作者发布拒绝。
- DRAFT、REVIEWING、HIDDEN、DELETED 及未生成完成异常夹具的公开过滤；REVIEWING 按当前受限对象契约验证，不把所有拒绝统一写成 403。
- 共振 / 收藏的并发唯一约束、个人收藏隔离；后台隐藏后的详情、星海、Hall、随机、匹配、回声、音频和旧媒体 URL 不再公开可读。
- 真实 TCP reset 故障下的存活 / 就绪区别，以及注册错误响应脱敏。
- 初次连接 / 内部类型加载的 FIN 故障，ESM 与 CJS 的查询、预留连接、事务、Drizzle 事务恢复；2 槽连接池中 5 路并发排队；注册失败后没有迟到写入。
- 生成任务在 pending 已提交、领取后未外发、AI 请求中、最终提交前的四个中断位置；每案持有独立数据库和真实 Node 子进程，重启须更换 PID。外发前与最终写入前使用测试侧仓储入口门闩，底层领取和条件写入仍为真实 SQL，不代表任意在途 SQL 或 COMMIT 确认丢失的验证。
- 两个真实进程共享相同 C 的容量限制、有限退避及耗尽、管理员隐藏和删除、HIDDEN → DRAFT 后旧任务失效、乱序完成和迟到失败。重试故障由隔离库触发器制造，退避到期和后续领取时间来自已提交记录。
- 正常关闭与外发前关闭：调用真实 `app.close()`，等待工作、HTTP 和数据库连接结束及子进程自然退出；强杀仅用于明确的故障注入或失败清理，不算成功排空。

核心链路显式启用真实生成 worker；EOF / RST 驱动故障夹具关闭扫描器，保持其独立故障范围。旧 NULL 元数据异常行继续验证公开过滤，新纳管行另验证数据库 CHECK 拒绝非法状态，不能关闭约束来构造旧夹具。生成配置、旧任务和升级边界见[生成任务运维说明](./implementation/b1-generation-operations.md)。修复前记录保留在[冻结基线](./implementation/b1-b2-generation-baseline.md)，本轮实际结果、失败尝试及限定见[生成可靠性验收记录](./implementation/b1-b2-generation-reliability.md)。

作者撤回端点属于 C1，当前后台隐藏用例不代表作者撤回闭环已完成。完整键盘星海阅读、物理手机性能、真实生产镜像 / 配置、收费 Provider 和模型质量不在本套测试的结论范围内。

## EOF 故障的独立复现

TCP 正常关闭（FIN）与 reset（RST）是两个不同的故障模型。当前调查发现 `postgres@3.4.9` 在首次握手阶段遇到持续 FIN 时，可能无限重连；增大 HTTP timeout 或仅用 `Promise.race` 返回失败都不能保证底层请求停止，也可能产生迟到写入。

```bash
node tests/integration/reproduce-postgres-eof.mjs
```

这个诊断只创建并连接自有 loopback FIN 端点，不接触任何既有服务。在观察窗口内仍 pending 时退出码为 1，并明确输出 `not-fixed`；它不把预期挂起当作成功。它只是驱动诊断，不代替 API 恢复验收；完整 EOF 回归在默认集成套件中，不被跳过。

本轮固定 `postgres@3.4.9`，通过 root `postinstall` 应用可核对源码及结果 SHA256 的 Node ESM/CJS 小补丁。未知版本、lock integrity 或源码漂移会拒绝安装；重复运行只验证，不重复修改。Docker 的普通 / 生产依赖安装阶段使用同一个安装器。`--ignore-scripts` 会绕过补丁，不属于已验证的安装方式；若使用该选项，必须先运行 `npm run postinstall` 并通过质量检查。

补丁使当前启动请求真正失败并释放连接，新请求可重新连接；它不是 HTTP 层的超时返回，也不重放旧注册。它不保证已执行事务或未知 COMMIT 结果可以安全重放。固定版本补丁应在上游发布修复后重新评估，不能自动跳过哈希保护升级。来源和边界见[驱动补丁说明](./postgres-startup-patch.md)。

## 浏览器与部署脚本

```bash
npm run e2e
npm run deploy:test
```

原浏览器套件仍使用模拟 API，覆盖前端主路径；生产 Web 套件见 `tests/e2e/runtime/README.md`。两者都不能冒充真实 API / 数据库全链路。生产 Web 套件的公共 API 地址必须在构建时设置，且不能与另一个 Next dev / build 同时改写 `.next`。

部署脚本测试使用替身 Docker / curl，只验证脚本契约，不会部署应用。Windows 需使用可运行的 Git Bash；Codex 沙箱限制系统对象或原生进程启动时，可在明确获准的执行环境运行，不能把未启动的测试记为通过。

## E4 Demo 指标与离线盲评工具

后台百分比只对应合成规则夹具，不表示模型效果。Seed 忠实性另按[评测准备与盲评说明](./faithfulness-evaluation.md)操作；工具不会调用模型或代写人工评分。

```bash
npm run api:build
node --test tests/evaluation/faithfulness-cli.test.mjs
```

这项 CLI 回归只使用合成捕获与合成评分，检查两份评分表配对、缺失评分、证据篡改、JSON 键顺序和禁止覆盖，不能当作实际盲评。默认 API 单测另覆盖冻结 60 条输入、分母、失败记录与模式复核；生产 Web 套件覆盖后台 Demo 标识、旧数据隐藏、管理员限制、桌面及 390px。

## F1 身份与调度集成

同一个 `npm run api:integration` 包含身份第二写触发器故障、微秒时间精度、后台状态镜像与只读差异审计。F1 scheduler 的七项专项使用独立新库、真实编译 Node 子进程和生产 app 接线，只固定业务时钟与配置，不替换生成函数或仓储。用例覆盖双 PID 竞争、业务日切换、外发后死亡、正常取消排空、SQL 失败、派发预算耗尽和过期完成/错误 owner 拒绝。

运行标记新增 scheduler 入口，并验证全部已知入口路径、源码和产物哈希。结果、Provider 请求事件和子进程证据只保存在被忽略的 `test-results/`。合成 Provider 的质量分是夹具，不是模型质量指标。

## F2 合成恢复与副本

F2 同一隔离套件还运行真实部署脚本的合成 pg_dump/gzip → 空库 psql 恢复，验证损坏压缩包零写入、SQL 错误整次回滚、非空目标拒绝、媒体/config 字节、原密钥解密、pgvector 和 API 主路径。备份后新增记录应缺失，较新撤回状态在开放隔离读取前重放；检查点、RPO 观测和本机 RTO 写入该轮 f2-recovery/recovery-report.json。Linux 容器专项验证 700/600 权限，Windows noacl 不作为权限证明。本段 SQL/媒体恢复不包含 Redis AOF；AOF 的独立合成演练见下节，真实媒体质量、目标服务器和第三方处理仍待验收。

F2 的真实 SQL 另验证十二类副本引用、样本截断、媒体元数据和不输出私密内容；GET 详情/matches/Galaxy 前后对比数据库与本地 Provider 请求事件，确认不派发或回填。新审计的 signal/attempt 关联由真实 worker 验证。源码、脚本及 Linux fixture 纳入本轮来源指纹。

`npm run api:recovery:verify` 使用同一运行器的新项目，固定选择备份恢复和核心权限/副本两个文件，适合独立复核 F2。它不复用上一轮服务或接受任意测试路径，manifest 的 scope 为 f2-recovery；默认完整集成命令仍覆盖八个文件。固定 --generation-checkpoints 参数仅供任务重启专项诊断，不替代完整门禁。

2026-11-01 的 [F2 任务观察调整](./implementation/f2-generation-observation-20261101.md) 将 checkpoint 中排队、单次执行和关闭准备分别验证。完成观察使用单次 SQL 批量读取、持久化的完成时间/attempt 截止比较及不随重排刷新的总 watchdog；关闭额外要求 shutdown 取消，不能用 deadline 取消冒充。旧 3 秒准备、5 秒整批失败仍是历史延迟记录，新门禁不宣称这些旧窗口均已通过。生产执行预算、执行权检查和并发上限没有调整。

## 独立 Redis AOF 合成恢复

```powershell
npm run redis:recovery:verify
node --test tests/recovery/redis-aof-safety.test.mjs
```

第一条命令使用固定 Redis digest、本机 Docker endpoint、新建 internal 网络和拥有标签的卷/容器，不映射宿主端口。每个 client 通过一个持续 `docker exec -i … redis-cli -2 --json` 会话复用生产预算与一次性挑战 Lua，核对写入前及 WAITAOF 前后的 CLIENT ID；退出须实际收齐响应并结束进程。覆盖当前检查点恢复、绝对 TTL、不复活已消费状态、共享预算及严格模式下损坏 AOF 拒绝启动，另要求实际观察到较旧备份复活挑战、退回已花额度的危险反例。

真实演练 run-d736a665ead0 为19/19，来源及清理核对通过；第二条的参数、所有权及协议安全测试为20/20，其中协议路径使用管道替身，不能代替真实恢复。安全测试已纳入 test:integration-tools，真实演练仍须显式运行，不使普通 check 自动依赖 Docker。三次失败、协议探针及完整证据见[独立实施记录](./implementation/f2-redis-aof-20261101.md)。该范围不验证 API 登录、PostgreSQL/会话签名或生产旧备份的安全衔接，也不授权自动重放旧 AOF。

## 完整 Linux Web 镜像（仍待验收）

```powershell
npm run web:image:verify
```

该入口从冻结来源构建 Dockerfile.web 的真实 runner，记录基础镜像、最终成品及 BUILD_ID；探测原生依赖和实际包/许可材料，使用镜像内 Next 与合成 API 验证页面和离线分享图。宿主 Chromium 访问 Linux Web 镜像，不作为 Linux 浏览器或实体设备结论。运行器/OG 的专项结果与完整镜像成绩分别记录，见[本轮实施记录](./implementation/f4-linux-web-runner-20261101.md)。

本轮 source-map-js 1.2.2、baseline-browser-mapping 2.11.34 和Vite近层esbuild0.28.2已完成正常安装、平台残留保留移出后的完整依赖树、原生加载及全量本地检查（工具41/API765/Web184及两端构建）。完整镜像四轮因Docker环境失败，仍无最终runner/成品探针/37项镜像浏览器的通过成绩；干净来源和失败/清理分别记录，不沿用前轮成绩。先释放本机资源，再继续完整验收。生产部署、真实 API/Provider、实机和完整分发合规仍需各自验收。

## CI

现有 API、Web、部署脚本任务保留。Web 单测已并入 `web:check`，不再额外重复执行。新增独立 `Isolated API integration` job，运行同一个托管集成命令；不需要仓库 secrets 或收费 AI。

普通 `npm run check` 仍不强制要求 Docker 或测试浏览器；真实服务集成由显式命令和独立 CI job 负责。
