# F4：剩余依赖维护与独立验证候选

日期：2026-11-01。代码基线 `baf41d32609bdfa144a05f192672938759a54795`，候选工作目录为 `test-results/f4-transitive-20261101/`，固定提交 `54cafe5b7668c2e736f2c865e3e115788fa3c8e4`。最终D已完成干净安装、完整检查、真实PG/Redis集成113/113、新锁完整Linux Web原生/停止/38项浏览器，以及使用精确校验缓存的Linux API开发/生产依赖阶段及探针。网络/引擎失败与缓存准备单列，完整官方audit仍未完成。以下成绩均来自D锁及本轮来源，不沿用历史成绩。

## 范围与当前状态

本候选保留 `postgres 3.4.9`、根 `postinstall`、四文件哈希补丁及两个 Dockerfile 的相关安装链。独立 postgres v4 候选的 119 项全套为 100 通过、19 失败，默认重试行为没有满足原 1800ms FIN 检查；该候选的自有临时资源已清理且来源读回通过。本轮不采用其驱动或移除旧补丁，也不把 v4 的安装或部分通过成绩归给当前候选。当前旧驱动目录没有 v4 新增的六项兼容用例，目标仍为原 113 项集成，以 runner 实际报告为准。

依赖维护按 A、B、C、D 四个固定阶段保留，只有锁与根 Node 要求属于本轮包变更。同目录另行同步了审核中内容非作者 404 的集成期望和通用来源冻结；完整检查与集成已使用这些最终输入。A/B/C 只记录各自的静态准备，实际运行成绩统一归于 D。

| 阶段 | 相对上一阶段的静态范围 | 固定证据与边界 |
| --- | --- | --- |
| A | Babel core `7.29.0 → 7.29.7`、browserslist `4.28.2 → 4.29.5`、js-yaml `4.1.1 → 4.3.2`、brace-expansion 两支 `1.1.14 → 1.1.21` / `5.0.6 → 5.0.12`、fflate 两支 `0.8.2 → 0.8.3` / `0.6.10 → 0.6.11`，及必要 Babel / 浏览器数据依赖 | 26 条包记录修改，无增删。26 条官方精确元数据、69 条相关依赖边通过；此阶段没有单独安装或测试 |
| B | Vitest `4.1.5 → 4.1.12`、Vite `8.0.11 → 8.3.5`，以及必要 Rolldown `1.2.16`、近层 LightningCSS `1.33.0` 等 | 相对 A 为 44 条记录：28 改、14 增、2 删；42 条现存变更的官方元数据、90 条依赖边、33 项 Node engine、15 条 Rolldown 平台边通过。没有把 A 的 26 条重新记作 B |
| C | tsx `4.21.0 → 4.22.0`，其近层 esbuild `0.27.7 → 0.28.2` 及 26 条平台包 | 相对 B 为 28 条修改，无增删；28 条官方元数据、31 条依赖边、28 项 Node engine、26 条平台边通过。A/B 固定证据不变 |
| D | 根 `package.json` 和锁根记录的 Node 要求从 `>=20.9.0` 收窄为 `^20.19.0 \|\| >=22.12.0` | 与当前 Vite 8 的真实 engine 一致；只改变根要求，不更新全局 Node/npm，不改变任何依赖版本。两个 Node 下界已运行下文所列定点验证 |

A/B/C 相对原始基线共 98 条包记录变化：82 改、14 增、2 删。D 另改锁的根工作区 engine；API、Web、contracts 三份 manifest 保持原字节。阶段 C 锁 SHA-256 为 `c1406b4517f276f709d279d58ecb0a18ea2f97f5a3d379dbc530d8eff4d6a92b`；阶段 D 锁为 `422f0fd50026581f08379ff3d2d7f0f63c492985123b54e9a211c655a6a1d049`。这些哈希只界定候选包文件，不代表完整源码签名或运行验收。

## Resolver、平台与失败记录

所有解析使用官方 `registry.npmjs.org`，未采用 force、legacy-peer-deps、override、跨主工具迁移或新增直接依赖。

- A 的 npm 10 命名更新丢失 42 条未变包的 libc 元数据；仅在 version、resolved、integrity 均未变时恢复原字段，未改记录保留基线字段顺序。
- B 的 npm 10 联合更新及 Vitest 精确解析均在 Arborist `loadPeerSet` 报 `null.edgesOut`，原锁没有变化。使用固定官方 npm `11.19.1` 临时解包工具后正常生成候选；其官方 integrity 和 Node engine 已核验，没有更新全局工具。相关 [npm 上游报告](https://github.com/npm/cli/issues/9787)只能支持同类工具问题背景，不代替本次错误证据或唯一根因判断。
- npm 11 原始 B 锁删掉了 Vite 仍声明的可选 esbuild peer，误解析到不兼容的根 `0.25.12`。本候选保留阶段 A 已由正常 resolver 生成的近层 `esbuild 0.28.2` 及 26 条平台记录，Vite 的 `^0.27.0 || ^0.28.0` peer 现在满足。Rolldown 删除的 WASI 私有分支和新 Android arm-eabi 分支分别按官方可选依赖核验，未伪装成相同平台清单。
- C 首次 `install --save=false --package-lock-only` 虽退出 0，但没有写锁，未记作候选成功。随后正常精确选择现有 API 依赖 `tsx 4.22.0`，保存生成文件，再恢复原 manifest 字节及锁内原范围；所选版本同时满足 API `^4.0.0` 和 kit `^4.21.0`。C 再次保留 B 的 Vite 近层 esbuild 记录，没有顺带升级其他包。
- B 的 chai / tinyrainbow 顺带更新并非新父范围所必需，保留原版本。现有 46 条 libc 记录保持；不适用平台的既有 Tailwind wasm32 虚拟依赖问题仍在范围外，不声称全平台虚拟树已经清零。

此前 F4 的沙箱安装曾长时间停留且依赖不完整；正常权限重试曾出现 Windows WASM 残留，浅层 `npm ls` 又未能发现 Vite 的可选 esbuild peer。首次 Linux 生产依赖镜像还漏装 SWC。失败、后续同锁修复及相应验收分别保留在 [前轮维护记录](./f4-dependency-maintenance-20261101.md)和 [Linux 补充记录](./f4-linux-web-runner-20261101.md)。这些旧安装结果不证明当前 D 锁已安装成功，原有四文件补丁、递归依赖树与 Windows/Linux 原生加载须重新读回。

原始输出和阶段材料位于本地忽略目录 `test-results/f4-transitive-20261101-evidence/`。A、B/fixed、C/fixed 和 D 分开保存，不覆盖失败尝试。包安装、构建产物及测试日志不提交为源码。

## D 安装与来源记录

D 的根 manifest 与锁副本在 11:33:51 UTC 固定。首次完整来源记录脚本误把 Windows 绝对路径直接传入 ESM import，报 `ERR_UNSUPPORTED_ESM_URL_SCHEME`；当时编排没有停止，随后启动了安装。这是本轮记录顺序错误，保留在 `stage-D/source-recording-initial-error.json`。完整快照于 11:43:22 UTC 补齐，晚于安装开始，早于完整检查和集成；不能写成全部源码在安装前已经冻结。

正常权限 `npm ci --no-audit --no-fund` 从 11:40:17 至 11:47:09 UTC 退出 0，安装 543 个包，根 postinstall 为四文件补丁 `applied 4 / verified 4`。锁前后均为 D 哈希，根 manifest 与预先保存的副本一致。三个安装资产当前与基线 Git blob 经换行正规化后相同，实际安装的四文件补丁哈希及 ESM/CJS 加载也已读回；没有把这项后续核验说成安装前后两个独立时点的资产哈希记录。未为补记完整源码重复安装。

首次完整 `npm ls --all --json` 虽退出 0，递归仍发现七条 Windows WASM 残留问题，未记作通过。核验本轮目录归属、包名版本及无链接后，将六个目录完整保存至 `stage-D/preserved-wasm/`，116 个文件逐一读回相同；没有硬删除。随后完整树的 `problems / invalid / extraneous / error` 均为空，根目录与近层依赖使用实际安装路径核验。

完整检查、集成启动前均先核对 101 份来源和 D 锁，任一前置错误立即停止。首次集成尝试在 Docker info 处被沙箱管道权限拒绝，未创建服务或执行用例；三份原始日志保留于 `stage-D/integration-attempt-1-sandbox-denied/`。随后正常权限运行原完整 runner，通过后再核对 101 份来源、83 份编译产物、四文件补丁，以及本轮专属容器、网络和卷。用例、超时、重试、skip 和来源冻结要求均未放宽。

## 审计范围与暂时无法闭环的上游链

旧官方审计以锁 `fa3ee884...` 为对象，报告 28 个包记录（4 high、23 moderate、1 low），不是 28 个已证实可利用的应用漏洞。A 的新 lock-only 审计超过总准备阈值后按精确进程身份终止；B 的新审计在 60 秒总截止终止，锁前后哈希不变。C 没有重试。D 固定提交后另用官方 npm 11.19.1 做了一轮完整范围 lock-only 审计：收到官方 bulk 响应及后续元数据 HTTP 200，但图计算未在 210 秒内完成，按截止终止自有 PID45444并读回其退出。565份 tracked 输入、D锁及干净状态均无漂移。三次均未得到完整新 JSON，不能填写新的通过成绩或告警总数；原始响应、调试日志和退出记录保存在 `stage-D/final-audit/`，没有把 bulk 响应当成完整报告。

已将候选版本与旧官方记录的具体范围比对；这能说明已知范围是否仍匹配，不能替代最终锁的新完整审计或应用可利用性分析。

| 剩余链 | 当前事实与官方维护边界 |
| --- | --- |
| minimatch / lint | 旧记录的 [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) 影响 `<11.0.1`，修复为 `11.0.1`。当前根 `3.1.5`、typescript-estree 近层 `10.2.5` 仍匹配。官方 registry 当前的 typescript-estree `8.72.1` 仍要求 `^10.2.2`；ESLint 9/eslintrc/import/react/a11y 仍要求 3.x；即使 ESLint `10.14.0` 也只要求 `^10.2.6`。不能在父范围内强塞 minimatch 11 |
| ESLint 维护迁移 | Next config `16.4.3` 自身允许 ESLint `>=9`，但它带入的 import/react/a11y 插件 peer 仅到 9；当前 Node 满足 v10 engine 也不能绕过这些 peer。[ESLint 官方支持表](https://eslint.org/version-support/)已列 v9 EOL，后续须独立迁移并验证插件及规则，不把 v9 补丁或 v10 单包升级写成告警修复 |
| kit 旧 loader | 稳定版 [drizzle-kit 0.31.11](https://registry.npmjs.org/drizzle-kit/0.31.11) 仍依赖旧 esm-loader / core-utils，近层 esbuild `0.18.20` 仍匹配 [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) 的 `<=0.24.2`。不能用 kit `0.18.1` 降级或覆盖 esbuild 范围消除计数 |
| tsx 已知范围 | C 的 tsx `4.22.0` 使用 `~0.28.0`，锁定 `0.28.2` 不再匹配 [Windows 开发服务告警](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr) 的 `>=0.27.3 <0.28.1`。这仅修复该版本匹配；kit 的另一份旧 esbuild 仍在，不能据此保证 audit 包计数减少或全项目零告警 |

ORM `0.45.4` / kit `0.31.11` 可另做同支补丁维护，但不能宣称清除上述旧 loader 告警。ORM 的 `postgres >=3` peer 允许版本选择，不等于本应用已验证 v4；[0.45.4 发布说明](https://github.com/drizzle-team/drizzle-orm/releases/tag/0.45.4)的显式 `.prepare(name)` 修正也不能替代这里的事务、JSON/时间序列化与 FIN 回归。Drizzle v1 的 [官方升级流程](https://orm.drizzle.team/docs/upgrade-v1)涉及 `kit up`、目录和 journal 变化，必须另作兼容范围，不能混入本轮或重写已有迁移。

## 新来源的验收状态

下表只记录最终 D 锁的实际结果。Windows 完整检查和集成使用 Node `22.22.2` / npm `10.9.7`；两个较低版本只运行所列定点验证，没有把它们写成各自完成了整套应用检查。

| 检查 | 当前状态 |
| --- | --- |
| D 锁干净 `npm ci`，保留根 postinstall 与 postgres 四文件 applied / verified 读回 | 通过，退出 0；首次 applied 4 / verified 4，两下界再次运行均 applied 0 / verified 4 |
| 真实安装树与 Windows 原生模块 | 清理保存残留后完整树无问题；SWC / Rolldown 原生模块加载、sharp 实际 PNG、Vite import、四个近层 esbuild 实际 TypeScript 转换均通过。加载检查不代表这些工具全部功能验收，静态全平台边也不代表其他平台实际安装 |
| 官方 Node `20.19.0`、`22.12.0` 两个下界 | 两个绝对二进制哈希与已验证官方归档记录一致；各自通过原生读回、补丁幂等、原 FIN 诊断、tsx ESM/CJS CLI 及新 Vitest 的现有日志脱敏测试 5/5，不改全局工具。后续实际成绩见 `stage-D/node-boundaries.json`，早期 engine 静态记录不充当运行结果 |
| tsx 与 postgres 真实行为 | 两下界的 `.mts` / `.cts` 输入均经 tsx 4.22.0 实际执行，结果与 Node 版本正确。默认 1300ms FIN 诊断分别 76ms / 16ms 结算，客户端/服务端均关闭、无自有 socket；诊断仍保留 `acceptancePassed: false`，不替代应用全套。实际旧驱动 EOF 19/19 成绩来自下述完整集成 |
| 完整 `npm run check` | 退出 0；工具 77/77、API 767/767、Web 192/192，lint、类型检查、API 构建和 Next webpack 生产构建均通过；101 份输入与 D 锁前后不变 |
| 最终源下真实 PG/Redis 集成 | `run-2UaXsq`，8 个文件 113/113，failed / pending / todo 均 0；退出 0、未中断、cleaned=true。101 来源 / 83 产物及四文件补丁最终读回相同，自有容器 / 网络 / 卷均为空。覆盖新的 404 期望、原 EOF 预算和来源冻结，不继承旧轮次 |
| 最终 Linux Web 镜像、平台二进制、停止/清理、38 项镜像浏览器与真实 OG 图片查看 | `a705d3c8ad0fb78f8072b4f2` 38/38通过，失败/跳过/flaky/重试均0，exit0、cleaned=true；实际Linux SWC/sharp/contracts及7项禁带路径通过，direct SIGTERM143/runtime0且无OOM，158来源/冻结副本及12夹具读回一致，自有资源与metadata为空；本轮真实中文和emoji PNG已查看。首轮失败保留，见下文 |
| Linux API开发/生产依赖安装、旧补丁与TypeScript实际执行 | `5b4c30926677f92094f282ce` 两个阶段及探针通过，exit0、cleaned=true；只预填两份完整SRI校验的原锁字体tarball缓存，原npm参数/ENV/postinstall及失败退出码不变。postgres3.4.9补丁0 applied/4 verified、真实ESM/CJS、tsx4.22.0的.mts/.cts与esbuild0.28.2原生转换通过；没有启动API runner、数据库或应用请求 |
| 最终锁官方完整审计 | 未完成；已有超时记录，不阻塞其他实际验证 |

主要证据为 `stage-D/npm-ci-run.json`、`npm-ls-all-clean-summary.json`、`native-current-final.json`、`node-boundaries.json`、`check-run.json`、`integration-run.json` 与 `final-verification.json`。完整来源快照为 `source-before-check.json`；集成自身的 manifest、Vitest JSON 和 runtime marker 位于本候选 `test-results/integration/run-2UaXsq/`。最终读回之后才更新本记录的验收文字，运行输入没有随之改动。

本轮不连接生产、不应用生产迁移、不改变数据处置、调度开关或 Provider 配置，也不调用收费模型。真实模型、人评、实机、目标环境迁移/恢复、A3 数据处置与参赛事实仍按各自记录保留边界。

## Linux 首轮失败及恢复记录

独立 API 依赖验证使用同一干净提交、D锁和固定官方 Node index。`1ec4c43551734db178439213` 与 `21b253cf771576543faed120` 两轮均在真实 `npm ci --prefer-offline` 阶段分别约326.6秒、300.1秒出现 `ECONNRESET / network aborted`，尚未执行探针或 prod-deps，不能记作API镜像通过。两轮来源、冻结副本与工具读回相同，manifest和独立读回均确认自有builder容器、状态卷清零。构建输出保留于 `test-results/api-dependency-images-20261101/runs/`；内部npm调试日志随自有缓存卷清理未保留，不能据最后一个成功HTTP请求猜失败包。

第三轮 `fd74b47074a51917ad645644` 仅增加失败时输出本次npm debuglog并返回原退出码的诊断包装，原参数和安装链保持。npm10.9.9/Node22.23.4在约314.1秒出现TLS连接abort，audit bulk已200；未完成计时器只剩两份5.2.9的Noto字体，但日志未将具体socket唯一关联某个包。完整2805行debug和原构建输出保留，不能把两个未完成候选写成已确定的故障URL。原exit1、来源读回和自有资源清理结果分别保留。

据此从主机npm缓存按D锁完整SHA512-SRI流式取出两份官方tarball：noto-serif-sc 86,839,021字节、noto-sans-sc 73,833,077字节，另核SHA256与长度，不联网、不解包、不执行包内容。派生验证Dockerfile仅在两个原npm ci之前各加一条 `network=none` 的只读bind/cache预填RUN，用目标npm自带cacache完整SRI/size验证写入，再byDigest读回；原registry、ENV、npm ci参数、postinstall、诊断退出码和探针字节保持。预填及探针离线，不代表中间原npm安装也断网。两条新增RUN可精确剥离回原诊断版本，所有种子、工具和冻结副本纳入哈希门禁，没有导入完整用户缓存或修改仓库Dockerfile。

最终 `run-5b4c30926677f92094f282ce-vKS76H` 实际通过deps 306.8秒、prod-deps 35.5秒及各自探针；其中真实npm安装分别218.9秒/544包、25.77秒/184包，阶段耗时与安装耗时不混写。两次目标npm10.9.9/cacache19.0.1预填marker均匹配本run/role和两完整SRI，两次原postinstall各applied4/verified4；随后postgres幂等补丁0/4、ESM/CJS、tsx ESM/CJS TypeScript执行、近层esbuild原生转换均通过。manifest于14:45:31 UTC记exit0、cleaned=true，SHA-256为 `0c7c6160bafd78134a20d6fe7199e0deb7b9ead269ae4879cfa4811b1eaeca4d`。最终独立10来源/11工具种子/23冻结输入逐哈希匹配，精确自有容器、卷、应用资源及网络均0，metadata缺席；`independent-readback.json`另存该run目录。此前三次失败不覆盖，不能把本轮写成未使用缓存的冷网络验收或完整API runner镜像验收。

Web首轮 `8dae8b6cc8b6ea82826babb9` 从干净 `54cafe5` 冻结158份Docker输入和12份验证输入，source tree为 `f8d286b2eb6d03def265a9648d378515dd373598405a6b2fb3610faa6c5c440b`。真实deps安装147.9秒，随后prod-deps、Next构建和OCI层导出完成；sending tarball阶段Engine RPC EOF。Docker Desktop状态读回为stopping，docker-desktop WSL实例Stopped；原manifest保留exit1和cleaned=false，builder discovery/readback因服务不可用超时。独立只读核对158份来源、158份冻结副本、12份夹具及原manifest均匹配，不把这个补充读回写回原manifest的sourceVerified字段。

用户随后明确允许恢复全局Docker。官方start/restart未恢复后，只读日志定位后台启动时无法移除 `sailor-ingest.sock`（Windows1920）；单socket为0字节AF_UNIX重解析文件，父目录及祖先没有重解析跳转，后台进程已退出。单文件改名仍失败；核对run目录仅有四个0字节socket后，将 `%LOCALAPPDATA%/Docker/run` 在同目录改名保留为 `run.stale-20261101T132600Z`，创建空run目录，再启动服务。没有删除旧目录、修改ACL、settings、VHD或数据卷。系统此前另有虚拟内存不足事件，不能据此把Docker停止或socket故障的根因判定为已解决。服务恢复、本轮精确资源清理及最终镜像验收的结果继续另记。

随后日志又定位到仅有一个0字节AF_UNIX `engine.sock` 的 `%LOCALAPPDATA%/docker-secrets-engine` 运行时目录；将其完整改名保留后，前一失败启动遗留的两个socket也另存为新的run备份。只停止路径/PID/精确UTC创建时间确认的本次失败启动及错误报告进程，未停止WSL服务。两处运行时均为空后，Docker恢复健康29.7.2。独立恢复脚本严格核对原builder完整ID、镜像、2GiB/3GiB限额、唯一挂载和卷指纹，清理后精确容器/卷/应用容器/网络均0，私有metadata不存在；另写 `recovery-cleanup-independent-2026-11-01T13-49-48-451Z-03514cf8.json`，原manifest及cleaned=false未覆盖。158来源、158冻结副本和12夹具均读回通过。

用户释放内存后，14:04 UTC读回Windows物理可用约5.2GiB、提交可用约6.2GiB，再以同一干净54cafe5运行最终Web镜像。`run-a705d3c8ad0fb78f8072b4f2-HYMei7` 于14:19:14 UTC退出0、cleaned=true，38个测试全部passed且无重试。实际image inspect ID为 `sha256:9011b450dcec3a5a28161964f6e8b5cb9581b0f3577a3a415cd76e0bb674f08b`，revision及sourceTree f8d286b2…与本轮一致；Node22.23.4、BUILD_ID `b4SqipPRKz_3l7gf2myPe`。原生探针与库存一致，外部fetch计数0只覆盖该探针的既定边界，不外推所有系统网络出口。

14:38 UTC独立逐项核对158来源、158冻结副本、12夹具源及6复制夹具哈希；exact run/builder label与精确名称查询确认容器、网络、卷和私有metadata均为空。direct停止143、runtime停止0，均非OOM。root另已实际查看本轮1200×630中文和emoji PNG：标题、正文、页脚完整，长文按分享卡片规则省略；emoji/稀字使用明确标注的`[?]`占位，没有把完整emoji字体覆盖写成通过。Windows宿主Chromium访问Linux服务的范围保持，不构成Linux浏览器、物理设备或生产验收。

## 主工作区的同源安装与产物刷新

D以`04323b6`同步回主工作区，随后仅另加B3文档。498份非文档实际文件与SAFE `54cafe5` 对应Git blob一致：文本明确按CRLF正规化比较，二进制逐字节，不把它写成全部原始字节相同。主工作区101份来源和5份manifest分别冻结，根锁精确字节仍为D哈希。正常 `npm ci --no-audit --no-fund --prefer-offline` 退出0，543包，根补丁applied4/verified4；锁前后不变。

完整树再次发现同七条WASM残留；核对六目录、无链接边界及116份文件与D保存内容一致后，完整移入新的本轮忽略证据。随后递归依赖树无问题，Windows九项原生探针及postgres补丁/ESM/CJS通过。API首次增量构建退出0但未重发射未受影响入口，保留日志并仅备份ignored的API tsbuildinfo，再正常全量构建；API与Web生产构建均退出0，入口已刷新。

现有集成runtime工具另作纯编译并验证本工作区101来源/83产物。与候选比较77份逐字节相同，另6份仅CRLF，正规化后83份全部一致；原始逐字节比较false与EOL分析分别保留，未宣称83份都是同一原始哈希。完整check、两个Node下界和113集成不在主工作区重复执行，来源映射与本次实际检查明确区分。证据为 `test-results/root-D-finalize-20261101/final-readback.json`，passed=true；构建、日志和node_modules不提交为源码。
