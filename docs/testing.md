# 测试与隔离验证

## 统一检查

```bash
npm ci
npm run check
```

`check` 包含 contracts 类型检查、API lint / 类型检查 / 单测 / 构建，以及 Web lint / 类型检查 / **Web 单测** / 构建。也可单独运行 `npm run api:check`、`npm run web:check` 或 `npm run web:test`。根 `web:test` 会先构建 contracts，再运行 Web 单测，独立检查不依赖此前 API 构建留下的 dist。

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

TCP 正常关闭（FIN）与 reset（RST）是两个不同的故障模型。历史 A2 调查证明 `postgres@3.4.9` 在首次握手遇到持续 FIN 时可能无限重连，对应补丁和当时成绩保留在[历史记录](./postgres-startup-patch.md)。当前候选为 `postgres@4.0.0` 加两文件生命周期补丁；官方修正、本地冷启动批次策略和准备态证据见[当前驱动说明](./postgres-driver.md)。增大 HTTP timeout 或仅用 `Promise.race` 返回失败仍不能证明底层请求停止。

```bash
node tests/integration/reproduce-postgres-eof.mjs
```

这个诊断只创建并连接自有 loopback FIN 端点，不接触任何既有服务。在观察窗口内仍 pending 时退出码为 1，并明确输出 `not-fixed`；它不把预期挂起当作成功。它只是驱动诊断，不代替 API 恢复验收；完整 EOF 回归在默认集成套件中，不被跳过。

当前候选由 root `postinstall` 调用 `scripts/apply-postgres-lifecycle-patch.mjs`，核对精确4.0.0、lock SRI及 `pool.js/index.js` 两文件的输入/输出 SHA256。ESM原生默认导入与CommonJS `.default` 接入各自保留真实Node模块回归，四连接工厂显式 `infer: true`。未知版本、integrity或源码漂移拒绝安装；已知修补状态只验证。两个Dockerfile使用同一新安装器，已分别实际验收Linux开发/生产依赖阶段；`--ignore-scripts` 会跳过补丁，不能记为本候选正常安装。

新增验证必须覆盖当前未发送冷启动批次的终结、类型加载迟到结果失效、健康连接占用时继续正常排队，以及同一个pool恢复后的新工作。健康队列不新增全局期限，已经发送的SQL、事务回调和旧注册不能被盲目重放；未知COMMIT结果仍需业务栅栏处理。自有TCP诊断17/17不代替真实数据库验收。本轮工具79/API767/Web192及两端lint/类型/构建通过，两个Node下界通过；真实PG/Redis独立完整重跑135/135、Web Linux成品浏览器38/38均exit0、cleaned=true，原预算及来源保护保留。首次冷初始化失败与旧119项负评原样保留。独立Web CI在测试前另执行contracts构建，避免依赖其他job或旧dist。具体范围见[新候选记录](./implementation/postgres-v4-upgrade-20261101.md)。

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

## 完整 Linux Web 镜像

```powershell
npm run web:image:verify
```

该入口从冻结来源构建 Dockerfile.web 的真实 runner，记录基础镜像、最终成品及 BUILD_ID；探测原生依赖和实际包/许可材料，使用镜像内 Next 与合成 API 验证页面和离线分享图。宿主 Chromium 访问 Linux Web 镜像，不作为 Linux 浏览器或实体设备结论。运行器/OG 的专项结果与完整镜像成绩分别记录，见[本轮实施记录](./implementation/f4-linux-web-runner-20261101.md)。

生产迁移器锁的最终成品已在 `run-1f4107d248add6f442bc5369` 完成三阶段构建，宿主等待提前退出后保留原失败并核对清理。`npm run web:image:verify -- --resume-runtime=<自有构建runId>` 可严格复用来源未变、原资源已清理的同一成品，重新运行全部探针与浏览器，不接受任意镜像或URL。本轮 `run-cb56e66fd506dc0b35cb0e1c` 实际38/38、来源/停止/清理和外层exit0；158构建输入及13验证输入全部核对，成品实际不含旧kit工具链。等待修复、原失败和图片限制见[补充记录](./implementation/web-runtime-readiness-20261102.md)。

当前 `postgres@4.0.0` 候选已完成独立 Linux Web 成品验收：`run-876dc359ed169e6e5dad38d9` 实际浏览器38/38，无跳过、重试或 flaky，SWC/sharp 原生探针、停止、来源读回和清理通过。158份 Docker 输入与12份验证输入前后核验通过；精确输入、镜像及 BUILD_ID 见[v4实施记录](./implementation/postgres-v4-upgrade-20261101.md)。较早的 Docker 环境失败、37/38及中断记录保留在[Linux补充记录](./implementation/f4-linux-web-runner-20261101.md)，不由最终通过覆盖。该 Web 服务使用合成 API；生产部署、真实 API/Provider、实机和完整分发合规仍需各自验收。

## 完整 Linux API 镜像

```powershell
npm run api:image:verify
```

该入口冻结 `Dockerfile.api` 的实际输入，构建开发、生产依赖及最终 runner，在新建隔离 PG/Redis 上执行真实入口迁移、应用请求与停止检查；不读取实际 `.env` 或连接生产。来源、资源所有权、完整运行及受限续验的规则见[API镜像记录](./implementation/api-image-20261102.md)。

生产迁移器最终提交d470fae的完整API构建 `run-ac8e873d8fe30c8e9c57f0b7` 实际20/20，同一成品 `e27c26b864fa…` 的 `run-8858d0fbd74b7f84024c7feb` 再验20+4进行中任务关停/重启；均外层exit0、来源及清理通过。空/blank URL子进程拒绝、27项迁移及kit/loader实际缺失均覆盖，详见[迁移器记录](./implementation/runtime-migrations-20261102.md)。下段18项仍仅属旧成品历史范围。

本轮为同一成品的两阶段证据：`run37d9722` 完成全部构建阶段与构建器清理，随后 DockerHub pgvector 鉴权 EOF 使原 full run exit1、runtime未启动；核对同一311份 COPY 输入、探针/构建器与原 image ID 后，`run-5dd3535dc5ed52358a915845-nXZsky` 使用本机已有官方 RepoDigest 完成18/18、27项迁移、PID1为node、SIGTERM后506ms退出0，sourceVerified/cleaned=true、cleanupFailures为空，续验外层exit0。314份来源（311份 COPY、3份验证输入）的最终独立哈希核对无漂移，容器/网络/卷独立读回均为空。不能将续验通过改写为原整轮 exit0；较早的清理枚举错误和首次续验失败另存原记录。已有 `api:integration` 的135项、成品18项和工具82项属于不同门禁，互不替代。

## 源码与依赖组回退演练

API成品的进行中任务专项可使用`npm run api:image:verify -- --resume-shutdown=<自有构建runId>`，在同源镜像上执行原18组及4组真实worker关停/重启检查。2026-11-02最终run9d8ce16实际18/18+4/4、sourceVerified/cleaned=true、exit0；两次关停前都确认请求仍挂起，从探针开始到停止完成的宿主计时上界2.62/2.93秒均小于镜像内原25秒材料期限，详见[专项记录](./implementation/api-active-shutdown-20261102.md)。这是本地合成HTTP，不证明远端实际计算停止。

2026-11-02 在独立 Git archive 副本完成 `c54f7e4` 的有限范围演练：568份文件与原 Git blob 一致；正常权限 `npm ci` 实装542包，保留旧3.4.9四文件 postinstall，补丁SHA、幂等0/4、原生ESM/CJS与Drizzle构造通过，零SQL。首次全树虽exit0仍有7条多余 WASM 记录，先完整保留移出6个根目录并核对116文件哈希，再确认最终全树exit0且顶层及递归问题为空。源码及主目录4.0安装未变。日志、原沙箱EPERM、初始树和最终报告在 `test-results/postgres-rollback-20261102/`；不据此认定旧数据库恢复、业务/FIN、镜像或生产回退通过。

随后同一冻结568份源码、同一安装的原完整`npm run api:integration`已113/113、8文件全过，runner/外层exit0、cleaned=true，原预算和断言不变。包括EOF19、真实握手RST、业务、调度、生成、预算和合成SQL/媒体恢复；101份运行来源、83份产物和四补丁独立核对一致，主目录v4安装未变，项目容器/网络/卷读回为空。见[回退故障记录](./implementation/rollback-faults-20261102.md)。上段只记录先前安装演练的范围，后续成绩不覆盖原失败，也不构成生产恢复或版本降级授权。

## CI

生产迁移器新增第9个完整集成文件，4组覆盖空库27项/幂等、故障DDL/数据/ledger整体回滚、不可达DB及空/blank URL不得迁移到受控PG默认库。CLI及SQL/journal纳入136份来源、112份产物保护，原8文件与预算不变。最终run-Yjpd5T实际139/139、exit0、cleaned=true；API检查84工具/767单测和构建通过，同锁Web192及构建另有完整check证据，详见[迁移器记录](./implementation/runtime-migrations-20261102.md)。

现有 API、Web、部署脚本任务保留。Web 单测已并入 `web:check`，不再额外重复执行。新增独立 `Isolated API integration` job，运行同一个托管集成命令；不需要仓库 secrets 或收费 AI。

PR #8 精确 Head `590f8f4` 的[运行41330941297](https://github.com/NekoMint-Labs/Unfreq/actions/runs/41330941297)四项检查已通过：工具79、API767、Web192及真实 PG/Redis135/135。该提交为独立 Web job 补充 contracts 构建前置步骤；首次缺少 dist 的失败仍保留在[v4实施记录](./implementation/postgres-v4-upgrade-20261101.md)。远端 CI 不替代主目录重新执行；主目录对应安装、原生加载、构建及来源/产物映射单独登记，未重跑完整 check、两个 Node 下界或完整集成。

本轮新增 API 成品工具后的完整工具门禁实际82/82、无失败/取消/跳过/todo，exit0，13.71秒，日志为 `test-results/api-image-tools-complete-20261102.log`。首轮80/82的资源超时和 CLI 帮助文本断言问题、修正范围见 API 镜像记录；未放宽原预算或输入/远端保护。该工具成绩不转记为两端全部业务单测或完整数据库集成。

普通 `npm run check` 仍不强制要求 Docker 或测试浏览器；真实服务集成由显式命令和独立 CI job 负责。
