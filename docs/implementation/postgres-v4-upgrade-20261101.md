# postgres.js v4 升级与生命周期补丁候选

批次：2026-11-01；记录写于2026-11-02（北京时间）。基线为 `c54f7e4e28d091954231f268665d1f13d9e1320a`，工作目录为 `C:\Users\zrjdx\.codex\worktrees\unfreq-v4-upgrade\unfreq`，对应[issue #7](https://github.com/NekoMint-Labs/Unfreq/issues/7)及[PR #8](https://github.com/NekoMint-Labs/Unfreq/pull/8)。代码提交为 `476c89b`，Node/数据库证明提交为 `9fb6ee8`；本地检查、两个Node下界、135/135真实PG/Redis重跑、Linux API依赖阶段及Web成品38/38均已完成。后续提交补CI准备步骤及本记录，具体输入范围见下文；这不表示已经合并main或部署。

## 候选范围与锁

API 精确固定 `postgres@4.0.0`。相对本轮基线的 lock 对象只改变 `apps/api`、`node_modules/postgres` 两条记录；当前 lock SHA256 为：

```text
cdf351ca90d8d3325c349c16abefa71e35327d8aabd07a78ec3dfab16b64b3b4
```

这只描述 lock 差异，源代码还包括四连接工厂的 `infer: true`、原生 CommonJS `.default` 接入、模块回归、驱动生命周期补丁及安装/镜像清单。没有在本批生成或重写业务数据库迁移，也没有加入整个应用的参数语义迁移。根 Node 范围为 `^20.19.0 || >=22.12.0`。

本候选成组退役旧 `apply-postgres-startup-patch.mjs`、`postgres-3.4.9-startup.json` 和 `postgres-3.4.9-startup.patch`，同时接入新 `apply-postgres-lifecycle-patch.mjs`、`postgres-4.0.0-lifecycle.json` 和 `postgres-4.0.0-lifecycle.patch`。root postinstall、两个 Dockerfile 和集成/镜像来源清单仍保留新补丁接线。不能写成“v4 已无本地补丁”。

补丁移植的官方依据、本地冷启动请求批次补充、两文件输入/输出哈希及安装失败边界见[当前驱动说明](../postgres-driver.md)。候选保留健康排队行为，不重放已发送 SQL/回调，不以重建池或修改原错误类别代替同池恢复验证。

## 既有负评保留

[上一轮 v4 记录](./postgres-v4-20261101.md) 对应其他基线与锁。其 `run-jKUDtH / 6e581f5dcf40` 为 119 项中 100 通过、19 失败：三项是旧 REVIEWING 夹具与已获批 404 契约冲突，其余 16 项涉及 EOF、有界失败和恢复。原始 exit1、cleaned=true、来源/产物哈希和资源读回不改。测试主动结束超预算请求不能证明自然失败后的无迟到写入已经通过。

旧候选的工具74、API767、Web192、Node 下界或构建通过，也不转记成本轮成绩。新补丁是否解决原缺陷，须由本轮新来源、原预算和副作用断言的独立运行确认。

## 准备阶段已签收的结果

| 范围 | 本轮已确认结果 | 结论范围 |
| --- | --- | --- |
| 正常依赖安装 | 543 包；新 postinstall `applied=2 / verified=2` | 证明当前安装接线及已知补丁输入可以应用，不代替完整依赖/平台/运行验收 |
| 自有 TCP 协议诊断 | 17/17 | 仅合成 PostgreSQL 协议端点；不含真实 PostgreSQL、API、Redis 或收费 Provider |
| 完整本地检查 | 工具79/79、API767/767（67文件）、Web192/192（23文件）；两端lint/类型/构建通过，exit0 | 对应本轮选定108份来源，不含真实PG/Redis或Linux运行 |
| 当前 Windows 依赖树 | 完整 `npm ls --all --json` exit0，顶层及递归 `problems/extraneous` 均为空 | 首次报告中的7条WASM残留及完整保留记录另存，不以首次exit0冒充树有效 |
| 两个 Node 下界 | `20.19.0`、`22.12.0` 各通过幂等0/2、模块2/2、原生工具、17项TCP诊断、离线generate、Vitest 6/6 | 本轮C安装树与日志；协议诊断是合成端点，不是真实PG验收 |
| 首次完整真实 PG/Redis | 88通过、47跳过/135；exit1、cleaned=true | core初始化hook超过30000ms，整套未通过，原失败保留 |
| 独立完整真实 PG/Redis 重跑 | 135/135，8文件；exit0、cleaned=true，无失败/跳过/todo | 同源、同锁、原预算，108份来源前后不变；独立项目资源读回均为0 |
| Linux API依赖阶段 | deps/prod-deps及模块/TypeScript探针均通过，exit0、cleaned=true | 仅真实Dockerfile.api依赖阶段，不含完整API runner、数据库启动或应用请求 |
| Linux Web成品 | 浏览器38/38、无跳过/重试/flaky；原生探针、停止、来源与清理通过 | Linux amd64服务，主机Chromium访问；合成夹具，不代表Linux浏览器、物理设备或真实模型质量 |
| 最终锁完整官方 audit | exit1，完整报告为20条 moderate | exit1表示仍有告警；本轮报告已完整生成，不是超时或审计零告警 |

补丁与 TCP 的本地准备材料在候选工作区被忽略的 `test-results/v4-lifecycle-patch-20261101/`。最终安装、全部检查、来源冻结和资源收尾应记录各自实际命令及输入，不能仅凭本表摘要或旧目录名称签收整套候选。


Node 下界阶段于 `2026-11-01T15:58:28.505Z` 至 `16:00:16.400Z` 执行，16条顺序命令全部exit0。每个下界都实际运行当前安装器，结果为 `applied=0 / verified=2`；模块测试从当前C安装树加载真实驱动和Drizzle，原生 ESM/CommonJS 为同一默认导出。Vite转换、Rolldown打包、SWC `.node`、sharp PNG及tsx两种夹具均通过；tsx为`4.22.0`，tsx与Vitest/Vite近层esbuild为`0.28.2`，根版本仍为`0.25.12`。

两个官方运行时的ZIP和exe均重新核对，未改全局Node或PATH：

| Node | ZIP SHA256 | exe SHA256 |
| --- | --- | --- |
| 20.19.0 | `be72284c7bc62de07d5a9fd0ae196879842c085f11f7f2b60bf8864c0c9d6a4f` | `6e3a39787e667d50487f7335c85636c2823a53e636d73c2c841d45da4e57906c` |
| 22.12.0 | `2b8f2256382f97ad51e29ff71f702961af466c4616393f767455501e6aece9b8` | `b3b117a08ee61efee09e6fd523ab33c0c018da1b570bde08e4fd914dc1170ed6` |

每个下界的15项连接协议诊断和2项边界诊断均通过，覆盖FIN、类型加载挂起、故障后静默/同池恢复、健康lease等待、强制关闭及`min>0`故障静默。诊断执行独立副本，其18份包文件与当前安装包逐一哈希相同；这仍是合成TCP端点，不能写成真实PostgreSQL或API通过。两份无dotenv/dbCredentials、仅指定dialect/schema/out的本轮配置执行真实Drizzle generate，SQL均为`a166434616d599d56090d463e90fbceaaa3d48b4f1148bce5707f497f2897d77`，既有迁移前后哈希一致。

本轮证据位于候选本地忽略目录`test-results/v4-postinstall-validation-20261101/`，包括完整npm-ls原始JSON、WASM保留报告、每条命令stdout/stderr、两个native报告和`boundary-phase-summary.json`。后者SHA256为`221881d7006b97d4ae273f2392b5b44cdbb21a3a0dabc1ece9f4e6c51cfbd01e`。7条WASM残留对应6个完整目录，祖先和后代无链接，包身份核对后保留移出，116份文件大小与SHA256逐项读回一致；未删除或改动主缓存。8项安装输入在安装及本阶段前后均不变。

## 完整检查的来源与日志

完整 `npm run check` 于 `2026-11-01T15:59:50.883Z` 至 `16:09:42.256Z` 执行，exit0，未超时；lock仍为本页的 `cdf351ca…`。108份纳入门禁的来源文件前后变化列表为空；这是本次明确选择的输入，不表示全部工作目录、历史证据或所有安装文件都已冻结。精确记录在 `E:\unfreq\test-results\v4-final-check-20261101\check-run.json`，对应工具79/79、API767/767、Web192/192及两端lint、类型和构建。`source-before.json` 与 `source-after.json` 逐字节一致，两者SHA256均为 `aa1561c37a3f308fb6a1331264275a5a7b123c0e6f4a85b49c6e71949b67c61a`。Node阶段与该命令开始后的约26秒重叠，但边界Vitest于16:00:15.757Z结束，完整API Vitest于16:01:59Z开始，Web Vitest于16:05:45Z开始；没有把这段时间线写成全程串行。

首次完整真实 PG/Redis 运行使用原运行器，证据为候选 `test-results/integration/run-u3gw8N`，项目 `unfreq-it-e0cb6725b23d`。外层命令于 `2026-11-01T16:11:29.080Z` 至 `16:23:11.591Z` 执行，未触发外层超时；最终135项中88通过、47跳过，`success=false`、exit1。`numFailedTests=0` 不能解读为整套通过：core-flow的30000ms `beforeAll` 超限，47项测试未执行；驱动文件41项及其余已执行用例通过。

阶段记录显示迁移6074ms、app import 26824ms、app build 4513ms，harness-ready为37942ms，继续完成注册和控制创建/发布后整个setup为38976ms。该区间包括两次完整runtime校验和真实冷import，现有记录不足以把所有耗时归因于哈希或驱动。原hook、1800ms失败预算及所有guard保持不变，`afterAll` 等待准备工作后关闭自有资源。

108份来源前后无变化，清单SHA256仍为 `aa1561c37a3f308fb6a1331264275a5a7b123c0e6f4a85b49c6e71949b67c61a`；runtime marker包含83份编译产物。最终 `manifest.json` SHA256为 `bde6fb658aec17c6f290a220a3af8b56c80f8eb8ee5974cf0538ef71cf17896a`，`runtime-marker.json` 为 `8efd7225a72983780d931461aa2f158e54bba99a7181ede23595cab271992138`。manifest为 `cleaned=true`；主执行者在 `2026-11-01T16:24Z` 独立读回该项目容器、网络、卷均为0。原始日志、报告和来源清单位于 `E:\unfreq\test-results\v4-real-integration-20261102\` 与上述候选run目录，保留此次失败。

同源无改动的第二次完整运行已通过：`run-Z8LGD3 / unfreq-it-a9ded2fc5068`，外层命令于 `2026-11-01T16:24:11.961Z` 至 `16:33:18.501Z` 执行，原运行器实际8文件、135/135，失败/跳过/todo均为0，exit0、cleaned=true，未触发外层超时。日志与108份来源前后清单位于 `E:\unfreq\test-results\v4-real-integration-rerun-20261102\`；来源变化为空，锁仍为cdf351ca…，runtime保留83份编译产物。结束后独立读回该项目容器、网络、卷均为0。原30000ms hook、1800ms失败预算、同池恢复和副作用断言没有改变；第二次通过没有覆盖第一次失败记录。

## Linux依赖与Web成品

两个运行均以干净 `9fb6ee8129c3b4d5cf912cae496559cfe408915d` 执行，锁仍为cdf351ca…。API依赖证据在 `E:\unfreq\test-results\api-cache-seed-v4-20261102\runs\run-c7e41ee21c733688970366c9-4qYeQN\`：原Dockerfile.api的deps/prod-deps实际安装均应用新补丁2/2，离线探针再次验证0/2；Node22.23.4、Alpine3.24.3，真实ESM与CommonJS默认函数及index入口相同，两目标hash正确，tsx4.22.0的.mts/.cts和esbuild0.28.2原生转换通过。两份官方字体整包只预填本轮私有npm缓存，完整SRI校验，原npm命令及postinstall保留；依赖输入、工具和冻结副本前后核对通过，exit0、cleaned=true。这不是完整API runner验收。

Web证据为候选 `test-results/web-image/run-876dc359ed169e6e5dad38d9-dgl4vJ`，外层于 `2026-11-01T17:00:00.280Z` 至 `17:11:12.861Z` 执行。成品为Linux amd64，image `sha256:63f3dc5dd74ebfdeed9e897cd2951a331de5cf5659533a2349b5b4537493af76`，Node22.23.4，BUILD_ID为 `r_8MDCywxYhLIA45SjwMe`。38项浏览器测试全部通过，无跳过、重试、flaky；SWC musl原生加载、sharp PNG及contracts运行导入通过。158份Docker COPY输入、12份验证输入及其副本前后核验通过，外层另核108份运行来源无变化。实际查看新中文/表情分享PNG，中文正常，缺字/表情明确以[?]及页脚说明呈现，未改分享原文。Next全局fetch的外部请求记录为0；该guard不等同于操作系统出口防火墙。

两个Web进程停止前均在运行，实际SIGTERM后direct为143、runtime为0，均无OOM、dead或运行错误；最终exit0、cleaned=true。日志在 `E:\unfreq\test-results\v4-linux-web-20261102\`，独立读回按本轮标签核对容器、网络、卷及私有builder清理。此前Docker重启遇3个残留零字节AF_UNIX文件，先逐个核对类型/进程身份，再完整保留原运行目录并恢复服务；没有把环境恢复当作应用验收。

## 独立Web CI准备修正

[首个PR运行41328595284](https://github.com/NekoMint-Labs/Unfreq/actions/runs/41328595284) 对应head9fb6、实际checkout merge `f1293a546d1a9720c14effcd88966a43a1f0c27a`，tree与head均为 `0b3b450d371fc8e216c3b5209143ec84fe951a7f`。部署脚本、API工具79/API767和Linux真实集成135/135通过；独立Web job执行106项后5个suite在导入 `@unfreq/contracts` 时失败，未完成Web192或Next构建。原始日志保留于 `E:\unfreq\test-results\pr8-ci-readback-41328595284-20261102\`。

基线同样缺少这个前置步骤：contracts的types指向src而运行时exports指向dist，独立Web job的typecheck不会生成dist。本地完整check先执行API构建，因此没有暴露独立job的准备缺口。本批仅在CI矩阵的Web分支、测试前增加真实 `npm run contracts:build`，保留全部测试和预算；四份manifest、lock、108份运行来源及158份Docker输入均不改。当前CI结果以[PR #8 Checks](https://github.com/NekoMint-Labs/Unfreq/pull/8/checks)为准，不覆盖首次失败，也不把源码/平台成绩扩大为生产验收。

## 最终锁的独立完整 audit

本轮使用官方 npm `11.19.1`，于 `2026-11-01T15:26:17.822Z` 至 `15:26:37.384Z` 独立运行完整 audit，约19.6秒。报告在本机：

```text
E:\unfreq\test-results\full-audit-20261101\final-v4\
```

`audit.json` 是本轮原始报告，`classified-report.json` 是分类清单，`completion-summary.json` 记录独立请求及与 D 的对照，`inputs-before.json`、`audit-run.json` 和 `tool-verification.json` 记录输入及命令；`report.md` 为说明。不能拿 D 的原始 JSON 复制成新锁结果。

实际为20条 moderate 包记录，0 low/high/critical；其中16条 dev-only、4条正式依赖树，5条直接、15条传递，共21个安装路径，对应2条直接 advisory。这些维度不能相加当作另一份漏洞总数。正式依赖链仍有 drizzle-kit → esm-loader → core-utils → esbuild `0.18.20`，不能把20条全部归为开发依赖。

本轮新的官方 bulk 请求实际包含 postgres `4.0.0` 并收到 HTTP 200；包名、级别、路径及 fixAvailable 与 D 相同。`@typescript-eslint/type-utils` 的计算命中范围变动，锁中版本仍为 `8.59.2` 且两份范围均命中，未建立该输出差异的唯一原因，不能据此说 v4 改变了这个包。剩余告警涉及 minimatch/ESLint 和 kit 旧 loader 两条链；fixAvailable 均标为跨主方案，包含不适合本项目的降级建议。本轮没有用 force、override 或任意降级消除计数，包命中也不等于已经证实应用可利用。

本次 audit 只冻结并读回 lock、root/API/Web/contracts 四份 manifest、npm CLI 与配置指纹，命令前后无漂移。在该次audit期间，应用源码、安装器和补丁仍在并行修改，**该audit没有冻结或证明全部源码未变**。audit 不检验新补丁行为；后续交付仍须重新读回最终输入。

## 交付与回退边界

PR #8以尚未整合main的维护分支为基线，便于独立审查本轮驱动变更；基线整合、新补丁独立审查及main合并状态须分别确认。完整audit的20条moderate残留没有被宣称清零。

- 主目录同步与构建读回使用忽略目录 `E:\unfreq\test-results\root-v4-finalize-20261102\` 下的独立收尾工具，记录其实际clean提交、安装、原生加载、构建和来源/产物映射。C候选的135项成绩不冒充E主目录重新执行的成绩。
- 成组回退须把manifest、lock、驱动选项、安装器/补丁和Docker接线一起恢复，并保留FIN/恢复回归；旧基线及其独立证据仍保留。本轮没有生产数据迁移、生产回退或生产配置操作。

最终运行须另记精确提交或源文件指纹、lock、补丁输入/输出、实际计数、未执行项、失败、退出及清理。生产迁移、部署、真实模型质量与费用均不由本候选准备记录推出；issue #7保持未完成，直到其验收条件实际满足。
