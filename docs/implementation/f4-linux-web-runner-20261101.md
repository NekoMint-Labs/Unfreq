# F4 补充：完整 Linux Web 镜像与离线分享卡片

日期：2026-11-01。基线 `778fdc0`，本地分支 `codex/f4-linux-web-runner`。继续处理完整 Linux Web runner 的工程验收，并单独维护 source-map-js `1.2.1 → 1.2.2`、baseline-browser-mapping `2.10.29 → 2.11.34`，补齐 Vite 的既有 esbuild 可选依赖边；本轮锁须重新安装和验收，不继承前轮成绩。不操作生产部署或有状态镜像。

## 分享图片的本地字体

审查发现 OG 使用 ImageResponse 却未传字体字节。已安装 Next 的缺字加载器会尝试在线字体或 emoji 服务。旧行为以合成文本且阻止网络验证：中文实际尝试三次网络请求，emoji 尝试两次且 PNG 失败。首次中文记录中的另一次 fetch 是内置 data: WASM，分类修正另存，不把它记为外发。原始记录在 test-results/og-offline-before-classified-20261101.json。

分享路由改用 Node runtime，从已锁 Fontsource 包中读取固定的 Noto Sans SC 和 JetBrains Mono WOFF 字体。只解析实际 cmap 覆盖，缓存一次，不接受请求控制的路径或字体 URL。常用中文、英文和 FM 数字使用本地字形；emoji、复杂组合及字库之外字符在图片中按完整字素替换为 `[?]`，脚注明确说明。正文页面、作者确认快照和版本不改。分享图仍是有长度上限的摘要，不是全文副本。

公开资格和版本检查保留；图片异步渲染结束后再次读取公开版本，撤回或版本改变则拒绝释放 PNG，响应保持 private/no-store。测试使用真实 Next ImageResponse 和 sharp，只有公开信号读取边界被合成替身替换。该测试不代替真实 API 权限验收。

## 完整镜像验证入口

```powershell
npm run web:image:verify
```

运行器只接受无参数或 --help，拒绝调用者指定 URL、镜像、项目及资源。它核验本机 Docker endpoint 并固定到该端点。前五轮使用 Docker Engine 默认构建器；接续提交改用显式指定 endpoint 和独立 BUILDX_CONFIG 的本轮限额构建器，具体资源及清理规则见后文。两者均不接受用户持久选中的任意 builder。[Docker 官方说明](https://docs.docker.com/build/builders/#difference-between-docker-build-and-docker-buildx-build)区分默认构建器的选择行为。

从 Dockerfile 所需来源冻结构建上下文，排除工作区 node_modules、.next、环境文件与测试结果。记录来源提交、工作区状态、每个实际输入及树哈希。Dockerfile 新增 NODE_IMAGE 参数，默认仍为 node:22-alpine；验证时解析官方索引 digest 并固定同一基础镜像，构建真实 runner 阶段和默认 /api 浏览器配置。构建产物、基础索引、最终镜像 ID 与 BUILD_ID 分别记录，不混写标识类型。

先直接启动镜像原 npm CMD，检查 Web 健康并记录真实停止状态。随后在同一个最终镜像内，由测试监督进程启动相同 npm CMD、回环合成 API 和测试反向代理；/api/og 由真实 Next 处理，其他 /api 与测试控制路由才进入合成 API。本机独立端口探针确认 internal 网络没有分配所请求的宿主端口，因此 Web 使用本轮新建独立 bridge 网络，只映射到宿主 127.0.0.1 随机端口，DNS 指向容器回环。Next 的 fetch 只允许容器内合成 API 和内置 data: 资源，外部请求在发送前拒绝。它不是完整 OS 出站防火墙，计数也不涵盖宿主浏览器的一切网络流量。

宿主 Windows Chromium 访问 Linux Web 镜像，复用既有 35 项生产构建浏览器行为并补中文分享图/静态资源、emoji 占位两项案例；不能称为 Linux 浏览器或实体手机验收。不会使用本机 apps/web/.next 冒充镜像内构建。图片必须保存并实际查看，PNG 签名或尺寸本身不能证明中文字形与排版正确。

## 成品探测与材料边界

无网络探测容器实际加载 Linux musl SWC、sharp、contracts，并用 sharp 生成 PNG。检查最终镜像没有 .env、.git、原始 Web/API src、测试或测试结果目录；必要的编译 .next 是运行产物，不算误带源目录。

成品材料记录实际 Node/Alpine 包版本、包清单及包根 LICENSE/NOTICE/COPYING 等文件和哈希。现有生产安装覆盖整个 workspace，镜像不是仅含 Web 依赖的最小镜像，悬空的 API workspace 链接如实记录。清单不覆盖全部内嵌资产、系统库许可或分发义务，不是完整 SBOM 或法律合规结论。

每次结果写入 test-results/web-image/run-<随机>/。应用容器与网络清理前按本轮随机标签核对，结束后再次检查残留；限额 builder 的容器和卷使用后文的独立归属核验。镜像、冻结上下文和许可材料保留，便于复核；新 builder 的私有缓存随本轮 state 卷移除，前五轮默认构建器的缓存不做全局清理。

fetch 夹具还强制 `redirect: error`，防止获准回环地址的 30x 在原生 fetch 内跟随到其他地址而绕过计数。Node 内置回归实际启动两个拥有的回环服务，四种 string/Request/options 写法均收到 302，但目标服务命中为零；本地 API 与 data: 仍可读取。拒绝记录只有固定计数，不接收 URL、正文或 token。此项 1/1 是夹具边界验证，不是声称已发生真实外发。

## 验证记录

### 依赖树的额外核验

两个补丁候选由 npm 生成，官方 resolved/integrity 读回一致，未添加直接依赖或 override。原始候选还丢失42处 Linux libc 字段，在确认版本/来源/完整性未变后恢复；应用时保留未改记录的字段顺序，结构仍等同候选。官方候选审计30→28包记录，仅移除这两包的匹配，剩余4 high、23 moderate、1 low；它不是可利用性或零风险结论。

按两包锁的正常 npm ci 成功，四文件 postgres 补丁和 Windows SWC/sharp/真实字体通过，但首次完整 npm ls --all 发现旧 Vite8.0.11 可选 peer 向上解析到不兼容的 esbuild0.25.12，以及7个未使用平台 WASM 后代。HEAD778fdc0四条相关锁记录一致，旧 f4-installed-clean 仅浅层树，故这是既有问题的首次递归暴露，不能归因于两个补丁。

隔离普通 cwd 的 npm install --package-lock-only 不修复该 peer；带 --prefix 的对照还触发 npm10将当前目录作为 file: 自链接的分支，所有此类候选均弃用。命名 npm update esbuild 的候选仅新增 Vitest 近层 esbuild0.28.2及26个平台 optional 记录，全部dev用途；保留 root0.25.12供Drizzle、tsx嵌套0.27.7和esbuild-kit嵌套0.18.20。27条官方包元数据逐项读回一致，旧42处libc字段已恢复；未采用整组Vitest/Vite升级。

虚拟全平台 npm ls --package-lock-only 证明 esbuild 错误消失，但仍报告旧 WASI runtime 边，未记为全绿。实际 Windows/Linux amd64 与其他平台要分开报告；后续正常安装、实际递归树和运行结果另列，不以手工复制安装目录伪装锁修复。

最终主锁 SHA256 为 `fa3ee88449b4142f0c68b7e4f21fcdca66cf51910dd174947dc4157229a387b7`。正常 npm ci 实装540包、退出0，postgres3.4.9四文件 applied/verified 均4。旧两包锁及最终锁的安装日志分别保留，没有将读入旧锁的先行安装当最终证据。

最终锁首次递归读回已无 esbuild invalid，但仍有7条不适用平台的 WASM 后代；退出码0也不能替代 problems 字段。逐个核验六个顶层目录的绝对路径、所有祖先非链接及包名/版本后，完整保留移动到 `test-results/f4-unused-wasm-preserved-20261101-8cf19409304f4712a23de1265f0de4fb/`，覆盖其中一条嵌套记录，不删业务数据或跨平台锁记录。移出后完整 npm ls --all 的 exit=0、problems=[]，Windows SWC、sharp PNG、两套真实字体以及四个 esbuild版本的原生 TypeScript transform 全部通过；见 f4-peer-installed-before-cleanup/clean.json。此为 npm10平台残留的本地处置，不宣称 npm ci 原始树天然无残留。

最终主锁官方 audit 仍28条（4 high、23 moderate、1 low），advisory身份/范围/严重度与两包候选一致，无新增/移除；只出现两条修复建议元数据变化。首次网络 ECONNRESET 的不完整传播范围记录保留，独立缓存有界重试成功且锁哈希未变，见 f4-peer-final-audit-20261101.json 与对应summary/diff。未使用 force、降级或 override 换取零告警。

### 运行与失败保留

OG 针对回归 26/26，Web lint、contracts/Web 类型检查通过，见 og-offline-resolver-targeted/lint/typecheck-20261101.log。大量 emoji、临界长度、组合字符、混合长文与实际 PNG 渲染均覆盖；26 项不是完整镜像或 API 权限验收。早期字体目录解析与 data: WASM 分类问题、长 emoji 原子截断修正分别保留，不覆盖首次失败。

第一次完整 npm check 通过工具39、API765、Web184及两端构建，但 Next 构建出现动态字体路径的 critical dependency 警告。检查实际产物证实 Webpack 将导入的 createRequire.resolve(variable) 编成空 context，不能把这次 exit=0 当字体路由可用。现改用运行时原生模块解析；新增工具回归实际编译完整 helper，要求零警告/空 context，并在仓库外 cwd 的两个真实 Node 子进程中核验当前与旧版加载分支的字体字节、SHA256和零 fetch。此回归不是最终 Docker 路由的替代证据。

最终主锁及修正后的应用代码运行完整 npm run check，exit0：工具41/41、API765/765（67文件）、Web184/184（22文件），contracts/API/Web类型、两端lint及构建通过，Next编译未再出现字体空context警告；见 f4-peer-final-check-20261101.log。完整 Linux 探针另要求实际缓存中载入的 musl SWC/sharp `.node` 文件并保存二进制哈希，不能用可能的 WASM 回退冒充原生加载。探针脚本语法已检查，实际结果待镜像运行。

部署脚本原11组在既有 Git Bash 正常本机权限下通过，exit0，39.048秒；Windows PATH缺少sh、受限MSYS启动失败分别保留。只有脚本本身的Docker/curl替身和临时合成目录，未执行真实部署；临时目录清理已读回。Windows noacl不作为POSIX权限证明，见 f4-web-deployment-shell-verification-20261101.json。

本轮未重跑完整113项数据库隔离套件：API业务、DTO、驱动与迁移均未变，API测试工具链已由本轮765单测/类型/构建覆盖，真实Redis恢复19项另列。此前113项仍只对应E4当时来源，不能改标为本轮锁或镜像的成绩。

前两轮镜像运行分别为 `235d310c6baacef339d7484e` 与 `5b4205ffe8a0a7bdb0c74545`，均因本机 Docker RPC EOF 失败，没有产出或验收最终 runner。第二轮 deps 的539包正常安装、四文件补丁与原生加载通过，但随后 prod-deps 镜像导出失败。首次清理未完成如实保留；引擎恢复后按各轮随机标签读回并清理，额外的 recovery-cleanup.json 记录零容器/网络残留，未改原始 manifest。

本机普通 Docker 重启还遇到失效 AF_UNIX socket。确认 Docker 已停止、目标目录仅有运行时 socket 后，保留性重命名 LocalAppData 下 Docker/run 与 docker-secrets-engine 为 `.f4-preserved-20261101-web`，再启动已安装的 Docker；未删除数据卷、重置 Docker、修改全局资源配置或升级软件。这不是 RPC EOF 的确定根因。本轮引擎29.7.2、VM约8GB；改为顺序预热 deps/prod-deps 的 cacheonly 输出，仅最终 runner 导入镜像，以减少重复中间镜像导出。所有命令有截止时间，并用本轮无网络无数据的临时进程保持构建期间运行状态。

第三、四轮均从干净提交 `aded0b0be4bb5bcc603479796b967a37c175d88b` 冻结156份Docker输入和10份夹具/运行器输入，两轮构建树SHA256相同：`edde339fd3c7715c622b7ddfdbf1a8d407aa78cc69bb3e497e60cf1417ba6bf9`。没有把先前脏工作区的镜像尝试重新标成本次来源。

| 轮次 | 结果 | 清理读回 |
| --- | --- | --- |
| 第三轮 `caa0a218f5329b2ad930c70c` | deps完整541包、postgres4文件补丁及SWC/sharp require门禁通过，cacheonly阶段59.66秒；随后Windows Docker CLI启动报 `out of memory allocating heap arena map`，尚未执行prod-deps | 原manifest仍cleaned=false；CLI恢复后的独立recovery-cleanup.json核对容器/网络均零残留，原记录不改 |
| 第四轮 `0161e9efb3f5194476b925d8` | deps缓存阶段1.81秒；prod-deps安装约6秒后再遇Engine RPC EOF，未到runner | 引擎恢复后按本轮标签、名称、固定镜像和无网络配置移除1个保持容器，独立读回容器/网络均零；原manifest仍失败 |

第三轮后的宿主快照为提交量28,132,294,656 / 29,992,472,576字节（93%）、物理可用约1.7GB；这是失败后的观测，不是峰值或前两轮EOF的确定根因。后续WSL只读观测还有约7GB可用，未找到能证明这些EOF均为Linux OOM的日志；Engine一度500后恢复29.7.2。记录为 f4-third-host-memory-20261101.json、f4-web-image-third/fourth-20261101.log及各轮manifest/failure/recovery-cleanup。未关闭用户应用、修改分页文件、全局WSL/Docker内存或执行全局清理。

**完整Linux runner仍未验收**：四轮均未产出并启动最终runner，没有本轮最终image ID/BUILD_ID、成品原生二进制探针、37项镜像浏览器、直接停止状态或真实Docker路由PNG的通过成绩。既有26项真实ImageResponse单测、helper样张和普通Next构建不能替代这些结果；最终Docker图仍待实际查看。停止/清理的验证入口已实现，环境失败不视为实现已经通过。

可选后续方案已只读查证，但未创建或运行：Buildx0.36.1支持本轮独立docker-container builder的memory/memory-swap限制，以及worker.oci的max-parallelism=1。[driver](https://docs.docker.com/build/builders/drivers/docker-container/)及[并行配置](https://docs.docker.com/build/buildkit/configure/#max-parallelism)说明其作用；它不能保证修复宿主CLI OOM或所有EOF。该driver会创建privileged容器及独立状态卷，需独立BUILDX_CONFIG、随机名称、固定本机endpoint、不--use、预先确认名称不存在，保存ID/镜像/挂载/限额后只清本轮资源；不能套用本运行器的自有标签清理假设或prune。2GB上限不含宿主CLI/Engine/导入开销，在当前约1.9GB提交余量下未贸然启动冷缓存的第五轮。先释放资源，再决定重试或实现单轮限额；不把这份方案当已实现或验收。

本地代码分为AOF `198df3f` 与Web/依赖/镜像入口 `aded0b0`；最终镜像来源应在下一次实际运行中重新记录。上述原始失败材料均保留。

本轮没有真实账号、Provider、生产服务、数据处置或发布操作。真实数据效果、实机、目标生产部署和 A3 决策仍需各自条件。

## 接续：独立限额构建器与停止语义

从 `7c2d08f` 接续。Docker 未运行，启动时两处 AF_UNIX 临时 socket 再次失效；在后端停止、绝对路径和零字节 socket 核验后，保留性重命名运行时目录再启动。没有删除卷、重置 Docker 或修改全局资源配置，记录见 `f4-docker-*-preservation-20261101*.json`。分步恢复过程中再次留下的 socket 也保留，最后同时处理两处目录才恢复引擎。

第五轮 `5641c357ba393865144c5bb1` 使用旧默认构建器，从 `7c2d08f` 冻结同一批 156 份 Docker 输入；deps 5.04 秒、prod-deps 42.26 秒通过，runner 到达 Next 编译后仍发生 Engine RPC EOF。构建期间宿主快照为可用物理内存 317 MiB、可用提交空间 85 MiB；这是当时观测而非峰值，不能证明所有 EOF 的根因。原 manifest 保留 exit1/cleaned=false；恢复引擎后只移除该轮已核验标签、名称、固定镜像及无网络配置的保持容器，独立 `recovery-cleanup.json` 核对零容器/网络残留，原记录不改。

本地提交 `45eb7f1` 将验证入口改为本轮独立的 docker-container BuildKit 构建器。名称随机，BUILDX_CONFIG 位于本轮证据目录，显式固定本机 endpoint，不修改用户选中的 builder；解析官方 BuildKit 索引 digest 后固定镜像。资源上限为 2 GiB 内存、3 GiB 内存加交换空间，worker.oci max-parallelism=1，restart-policy=no。依据 [driver 选项](https://docs.docker.com/build/builders/drivers/docker-container/)与[并行配置](https://docs.docker.com/build/buildkit/configure/#max-parallelism)；上限不包括宿主 CLI、Engine、导入或浏览器开销，也不保证消除环境故障。

Buildx 容器按 driver 使用 privileged，验证期间实际检查容器 ID、固定镜像、资源限额和唯一 state 卷。state 卷预建时带本轮标签；容器由 Buildx 自动创建，不假设它继承应用容器标签。清理前重读卷指纹和容器身份，先保留 daemon/state 移除本轮私有 builder 元数据，再单独停止、删除已核验容器，确认卷没有消费者后移除，最后读回。CLI 回执丢失时只在事前确认不存在、精确名称、本轮标签及 local driver/scope 全部满足后恢复卷归属；未知资源保持不动并报告清理失败，不执行 prune。

停止门禁改为实际角色语义：当前 Next 源码在 SIGTERM 关闭处理后退出 143，因此直接 npm CMD 接受本轮明确请求 SIGTERM 后的 143 或 0，测试监督进程仍只接受 0。两者均拒绝仍运行、OOM、dead、Docker error 和 137 等退出码。记录停止前运行状态、请求信号及结果，不以 143 推定全部请求已排空。新增两个 host helper 均进入来源冻结和最后读回。

最终工具门禁 `f4-bounded-builder-tools-final-20261101.log` 为 77/77，包含 builder 协议32项及停止策略4项；首次沙箱运行67/69，两项既有补丁夹具被临时目录 rename 权限拦截，原日志保留。正常本机权限的中间69/69及最终77/77分别记录。部署脚本原11组再次通过，合成临时目录读回零残留；只使用 Docker/curl 替身，Windows noacl 仍不构成 POSIX 权限证明。修正了两份规范漏列工具测试/Web单测的命令说明。

限额构建器的完整镜像结果另记；协议测试不替代真实 BuildKit、成品探针或镜像浏览器验收。未改变依赖锁、Web/API业务、数据库和 Provider 配置。

### 首轮限额镜像的实际缺陷与修正

`71e63466e25f26bf705482b8` 从干净 `45eb7f1` 冻结156份Docker输入、12份验证输入。deps/prod-deps/runner分别约160.24/36.02/228.26秒，首次完整产出Linux amd64 runner：Docker inspect ID为 `sha256:6dc8c39f5cdc751db9cab39928c567465faf91cc18b5b7439c3467fc28472972`，BUILD_ID为 `s1n5kqrJ8A6_elWzKJfAS`。实际Node22.23.4、musl SWC/sharp二进制加载和哈希、sharp PNG、contracts及禁带目录检查通过，登记181包/164份包根通知；这仍不是完整法律物料清单。原npm CMD收到本轮SIGTERM后实际退出143，无OOM或Docker error，与新增停止策略一致。

内核读回memory.max=2147483648、memory.swap.max=1073741824，确实限制本轮构建器；快照在 `f4-web-image-bounded-memory-20261101.jsonl`，不把单点当峰值。此前构建器一直保留到浏览器之后清理，宿主再次紧张：draft在newPage前超时，390px静态chunk为ERR_INSUFFICIENT_RESOURCES，D1出现WebGL context lost，D2截图时浏览器关闭。按manifest owner PID及精确Playwright命令核验后，只终止本轮浏览器子进程树，记录 `manual-browser-stop.json`；没有执行完37项，不以部分通过作为镜像验收。

真实PNG人工查看还发现长中文把页脚挤出画布，签名和尺寸测试不能发现。新布局固定header、正文和footer区域，长文适配字号和断行，保留126字符预算及原子占位、正文快照和二次版本门禁。新增真实ImageResponse/sharp像素回归：页脚必须和同提示短文一致且有实字，正文非空，上下安全区与正文/页脚间隔没有亮字；针对性30/30通过，长中文及emoji两张样图逐张查看。单独核对后原emoji样张没有裁切，确定缺陷为长中文排版。

D1 trace另暴露确定的React418：Galaxy服务器直接格式化本地时间，Linux UTC与上海浏览器文本不一致。改为SSR/首次hydrate一致的时间占位，随后按浏览器本地时区格式化，保留time的精确dateTime；不固定为无标注的北京时区，也不隐藏hydration警告。真实SSR在UTC/上海/纽约4项通过，新增真实SSR→上海浏览器回归，使完整镜像目标增为38项。其他locale调用经owning链核对是Server-only、浏览器交互后显示或未挂载旧组件，本轮没有扩展冻结能力。

运行器同时改为镜像载入后先清理私有builder和state卷，再启动探针及Chromium。清理补扫使用inspect返回的完整容器ID，避免64位创建ID与12位发现ID重复登记，移除后再inspect造成假失败。上述旧轮原manifest仍exit1/cleaned=false；builder本身已cleaned=true，另存的recovery-cleanup.json实际核对应用容器/网络及builder容器/卷均为0，没有覆盖原记录或追加删除。

`2ef7f1e` 保存上述修复。完整本地 `f4-image-fixes-full-check-20261101.log` exit0：工具77/API765（67文件）/Web192（23文件），两端lint/类型/构建通过。没有重跑真实数据库113项，也没有把旧源结果改成本次源的证据。

随后 `f9b1db581467a69bc6659c1a` 从干净 `2ef7f1e` 冻结158份Docker输入及12份验证输入，构建树 `2d7651474581a34f4245e66ac5599d35a05fff4b99fc6e3b68579245bd306d0e`，主锁仍为 `fa3ee88449b4142f0c68b7e4f21fcdca66cf51910dd174947dc4157229a387b7`。镜像Docker inspect ID为 `sha256:c4a703382006f6941b03a3a78331bc56ca5f23f521e8dc8bfe35c0bc294fc4f1`，BUILD_ID为 `TjmSx-rlSCEl6Z2lEmhHv`；成品探针通过，builder在运行前已实际清理，direct再次SIGTERM/143通过。

这轮完整浏览器为37/38，只有D3 WebGL创建失败用例在context收尾报 `browserContext.close: Test ended.`。trace中降级、公开样本、私密排除、键盘打开及关闭后焦点恢复断言全部完成，最后断言结束后才发生Close context失败。没有证据证明浏览器OOM、crash或业务缺陷，根因未定；没有修改产品/夹具、吞掉close错误、跳过或加重试。新跨时区回归及前轮资源失败项均通过，实际Linux的两张OG已逐张查看，并读回header/正文/footer有字、上下安全边界无亮字；PNG仍1200×630。原37/38失败和trace保留，exit1且cleaned=true，不当成全套通过；后续以相同输入的新项目独立完整复验。

### 评审修正后的完整复验

2026-11-01 从 `baf41d32609bdfa144a05f192672938759a54795` 的干净隔离工作区执行新一轮 `8cf25fb31fdb028cc4757b8a`。此前中断的 `2100a8fa712bce85f253036b` 已确认 owner PID 不存在、构建被取消；唯一遗留的私有 BuildKit 容器和 state 卷逐项匹配完整 ID、固定镜像、限额、挂载、标签及卷指纹后清理。独立 `recovery-cleanup.json` 读回容器/卷/应用容器/网络均零残留，原 manifest 的 SHA-256 `484e361a25169e74adc77b12c8231b87b5669c9c34503df0c2fe6f4233c7401b` 未变，没有补写成初次成功。

新轮冻结 158 份 Docker 输入和 12 份验证输入，构建树 `d98480d6a7fbf366b5d839fb65fc65bb2cd4c935417263960be8b9c74e0262c8`。相对旧轮，产品输入差异仅为换行；验证源码更新了两处 Cookie 名称，D3 用例、超时与重试策略未改。Docker inspect 的最终镜像 ID 为 `sha256:9920c3d8cb6e4da72aeaaf7576413590fc3515bc78a001a281551632cb8ccde0`，BUILD_ID 为 `DGlibD_fJVkIK_xz_sInK`。原生 musl SWC/sharp、PNG、contracts 和成品禁带目录探针通过；私有 builder 与 state 卷在浏览器前释放。

完整镜像浏览器 **38/38**，用时 349.82 秒，skipped/unexpected/flaky 均为 0。直接 npm CMD 的本轮 SIGTERM 停止为 143，测试监督进程停止为 0，均无 OOM、dead 或 Docker error；结束读回 `sourceVerified=true`、`exitCode=0`、`cleaned=true`。中文与 emoji 两张真实路由 PNG 已逐张查看：标题、正文和页脚可读，页脚未挤出，图片仍是有长度预算的摘要，emoji 占位提示正确。

原 37/38 的 D3 收尾失败仍保留。独立 trace 复核没有发现确定的夹具生命周期错误；新轮通过不等于已查明旧失败根因。证据位于 `test-results/f4-completion-20261101/test-results/web-image/run-8cf25fb31fdb028cc4757b8a-Jv3B7A/`，控制台日志为 `test-results/f4-completion-20261101-image.log`。这是 Windows Chromium 访问 Linux Web 镜像配合合成 API 的工程验收，不是 Linux 浏览器、实体手机或生产部署验收；后续依赖升级必须另做最终来源验证。
