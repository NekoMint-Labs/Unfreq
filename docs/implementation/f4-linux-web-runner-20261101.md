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

运行器只接受无参数或 --help，拒绝调用者指定 URL、镜像、项目及资源。它核验本机 Docker endpoint 并固定到该端点，使用 Docker Engine 默认构建器，避免持久选中的 buildx 构建器把上下文传到其他环境。[Docker 官方说明](https://docs.docker.com/build/builders/#difference-between-docker-build-and-docker-buildx-build)区分这两种默认选择。

从 Dockerfile 所需来源冻结构建上下文，排除工作区 node_modules、.next、环境文件与测试结果。记录来源提交、工作区状态、每个实际输入及树哈希。Dockerfile 新增 NODE_IMAGE 参数，默认仍为 node:22-alpine；验证时解析官方索引 digest 并固定同一基础镜像，构建真实 runner 阶段和默认 /api 浏览器配置。构建产物、基础索引、最终镜像 ID 与 BUILD_ID 分别记录，不混写标识类型。

先直接启动镜像原 npm CMD，检查 Web 健康并记录真实停止状态。随后在同一个最终镜像内，由测试监督进程启动相同 npm CMD、回环合成 API 和测试反向代理；/api/og 由真实 Next 处理，其他 /api 与测试控制路由才进入合成 API。本机独立端口探针确认 internal 网络没有分配所请求的宿主端口，因此 Web 使用本轮新建独立 bridge 网络，只映射到宿主 127.0.0.1 随机端口，DNS 指向容器回环。Next 的 fetch 只允许容器内合成 API 和内置 data: 资源，外部请求在发送前拒绝。它不是完整 OS 出站防火墙，计数也不涵盖宿主浏览器的一切网络流量。

宿主 Windows Chromium 访问 Linux Web 镜像，复用既有 35 项生产构建浏览器行为并补中文分享图/静态资源、emoji 占位两项案例；不能称为 Linux 浏览器或实体手机验收。不会使用本机 apps/web/.next 冒充镜像内构建。图片必须保存并实际查看，PNG 签名或尺寸本身不能证明中文字形与排版正确。

## 成品探测与材料边界

无网络探测容器实际加载 Linux musl SWC、sharp、contracts，并用 sharp 生成 PNG。检查最终镜像没有 .env、.git、原始 Web/API src、测试或测试结果目录；必要的编译 .next 是运行产物，不算误带源目录。

成品材料记录实际 Node/Alpine 包版本、包清单及包根 LICENSE/NOTICE/COPYING 等文件和哈希。现有生产安装覆盖整个 workspace，镜像不是仅含 Web 依赖的最小镜像，悬空的 API workspace 链接如实记录。清单不覆盖全部内嵌资产、系统库许可或分发义务，不是完整 SBOM 或法律合规结论。

每次结果写入 test-results/web-image/run-<随机>/。容器与网络清理前按本轮随机标签核对，结束后再次检查残留；镜像、冻结上下文、许可材料和构建缓存保留，便于复核，不全局清理。

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

完整镜像结果在实际运行后记录。

本轮没有真实账号、Provider、生产服务、数据处置或发布操作。真实数据效果、实机、目标生产部署和 A3 决策仍需各自条件。
