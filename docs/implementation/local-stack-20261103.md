# 本机隔离全栈验收与首屏交互、HTTPS修复

日期：2026-11-03（北京时间）；基线 `d843461`，分支 `codex/local-stack-acceptance-20261103`。用户选择本机 Docker 隔离验收。本轮发现并修复两处表单首屏输入问题、HTTPS分享地址降级及定位星图水合异常；最终Linux成品41/41、真实后端全栈16/16均通过，来源及清理核对完成。生成使用内部固定合成Provider，不构成真实模型或生产环境验收。以下保留原失败、阻塞及逐轮证据，不把后续成功改写为首次成功。

## 范围与隔离

实际路径为宿主 Chromium → 回环 HTTPS edge Caddy → 仓库 Caddy → Web/API → 新建 PostgreSQL/Redis；使用真实生产成品、会话、迁移和 worker，数据均为本轮合成数据，未用浏览器 API 替身代替后端。

该双 Caddy 链不是实际 Nginx Proxy Manager，也不验证生产 TLS、访客 IP 归属、生产额度或真实模型效果。API/Web/PG/Redis 只连接本轮 internal 网络，不映射宿主端口；edge 的 TLS 端口仅绑定 `127.0.0.1`。proxy/edge 另有本轮桥接网络，不能把整个拓扑写成全部 internal。

第五轮存活期间另由只读 Docker 查询核对六个容器、镜像 ID、拥有标签、网络、卷和实际 API 配置：worker 开启、每日 scheduler 关闭、Provider 密钥及 URL 为空、四项付费额度为0，数据库/Redis只指向本轮服务。该检查不输出秘密值；未读取实际 `.env`、连接生产或调用收费模型。

## TLS 与客户端夹具的首四次失败

证据根目录为 `test-results/local-stack-20261103/`，`run-index-initial-six.json` 保留首六轮索引，最终 `run-index.json` 汇总全部12份原manifest的目录、退出码和指纹，未修改原manifest；TLS探针和镜像验收另记。以下四轮均 exit1、cleaned=true，sourceVerified=false；未完成的来源验证不补填成功。

| runId / 目录后缀 | 原失败 | 范围 |
| --- | --- | --- |
| `ebd19af8ca7792452c609687-Uhs7Tv` | Local HTTPS stack not ready | 尚未进入浏览器；后续独立 TLS 对照定位无 SNI 的 IP 客户端握手问题 |
| `280bf9ed8faa87b7e7b0cb20-9CLgbC` | Docker 命令 exit1 | 六容器已健康；从 tmpfs 导出公开 CA 的夹具需要调整 |
| `5e631c303524e39b5907f2d9-r4AWJo` | 原部署 smoke exit60 | Windows curl 的 CA/Schannel 验证未通过 |
| `9d059d0938761b61c8325b8e-2Cxepc` | 原部署 smoke exit60 | 客户端路径和本地 CA 吊销信息处理仍未满足，不是业务流程通过 |

三个 `tls-probe-*` 的原 summary 均保留。无 `default_sni` 时，不显式发送 SNI 的 IP 请求为 EPROTO，显式 SNI 为200；设置本轮 edge 的 `default_sni` 后两者均200。未据单次 readiness 超时直接推定应用故障。

`docker cp` 无法读取该 tmpfs 中的公开根证书，改为 `docker exec … cat` 导出该公开 CA；没有导出私钥。Git Bash 中固定本轮 curl 包装器的 POSIX PATH，显式指定本轮 CA；仅针对该本地 CA 缺少吊销信息的情形使用 Schannel `--ssl-revoke-best-effort`，保留证书链及主机名检查。最终对照为正确 CA 退出0、错误 CA 退出60，没有使用 `--insecure` 或修改系统信任库。

配置及命令依据：[Caddy 全局选项](https://caddyserver.com/docs/caddyfile/options)、[Docker cp](https://docs.docker.com/reference/cli/docker/container/cp/)、[curl 证书验证](https://curl.se/docs/sslcerts.html)、[curl 吊销信息 best-effort 选项](https://curl.se/docs/manpage.html#--ssl-revoke-best-effort)。这些夹具修正不等于生产代理/TLS配置已经验收。

## 第五轮：真实 smoke 通过，浏览器流程失败

`run-b1aeed134c93b1eb08e8d6ea-8Dqz4T` 已通过仓库原 preflight、六容器健康和原部署 smoke，真实 PG 已应用27项迁移。API深健康、Web健康及匿名首页均200。

浏览器 `browser-2026-11-02T17-16-47-390Z-2dd825f179/summary.json` 为3通过、1失败、12阻塞，exit1：作者通过页面注册时，等待注册响应20秒超时；后续登录、生成、发布、撤回、OG、星图和权限链因前置身份未建立而阻塞，不能当成这些功能分别失败或通过。非作者合成账号的直接 API 注册201、页面无外部请求/未捕获异常等已执行项单列保留。

整轮最终 exit1、sourceVerified=true、cleaned=true。独立 `independent-live-inspection.json` 核对上述实际配置，并在结束后读回本轮容器/网络/卷均为空；其 SHA256 为 `0c10c81435938b582999231be766cb5e12cfdb4a4a0f06236254c37dafb1c4d2`。原 manifest SHA256 为 `df9360ad27eaa7de615f17cff572450ec2addd743fe5960da336138de6411521`。

浏览器为本地私有 CA 设置 `ignoreHTTPSErrors=true`，因此浏览器通过本身不证明 CA 信任链；正确/错误 CA 的拒绝对照由上文真实 curl 单独执行。

## 第六轮：在旧成品上定位水合丢失输入

`run-736aca8ad188c07c8e555ca4-PwxX2A` 使用同一旧 Web 成品，仅运行受控诊断，不代替完整16组流程。实际拦住7份静态 JS，在 SSR 页面已显示、客户端事件尚未接管时观察注册表单：密码框和提交按钮可用，合成输入长度52；释放 JS 后，水合过程的 value setter 写入长度0，输入丢失且原生有效性检查失败。

`browser-hydration-8d61931f0fa1c01a/summary.json` 为2通过、2失败：两项失败分别是客户端未就绪时控件仍可用、已接受的早期输入未保留；水合后重新填写并通过真实 UI 注册返回201，另一项确认没有原生密码查询参数导航或外部请求。诊断未在水合前点击提交，不能把潜在原生 GET 风险写成已观察到密码泄露。

整轮 exit1、sourceVerified/cleaned=true，本轮容器/网络/卷均为空；manifest SHA256 为 `7b59da3bee0b0fb8af6ad48147026912fd2f9522b8c8c50cb5542c9f936b2a62`。

## 登录修复后的39项成品

最小产品修复仅改 `FrequencyLoginForm.tsx`：以 SSR 为false、客户端为true的就绪快照禁用两张凭据表单的输入与提交，事件接管后再启用；表单显式 `method="post"`。没有引入任意延迟，也没有修改注册 API 或认证契约。

`tests/e2e/runtime/production.spec.ts` 新增生产回归：实际拦住静态 JS，检查水合前两张表单禁用、POST方法，释放后可交互，并检查登录、httpOnly会话、SSR导航和刷新。该项使用生产 Web 与合成 API 夹具，与上面的真实后端全栈流程分开报告。

登录修复提交 `4ea78d18b65fed7fcfb48d9fbc95a6fca1d2f51f` 的本机 Web 检查 exit0：lint、类型、192项单测及生产构建通过。交付为基于 `d843461` 的[草稿PR #11](https://github.com/NekoMint-Labs/Unfreq/pull/11)，该提交的[四项CI](https://github.com/NekoMint-Labs/Unfreq/actions/runs/41493808872)通过；不表示批准、合并或部署。

新 Web 完整构建 `run-b5dcfd53975897516deb26e7-wckJho` 使用 Node22.23.4，生成 Linux amd64 镜像 `sha256:277b0df19b1bae2c91b3c072844059deba891312a766194a7af9131713449421`。三阶段真实构建、158份构建输入和13份验证来源核对通过；生产浏览器39/39、227.54秒，无跳过、重试或flaky，外层exit0、sourceVerified/cleaned=true。新增登录 JS gate 回归实际执行；该套仍使用合成 API，不能代替真实全栈16组。

该 Web run 的首次 `independent-final-readback.json` 因标签枚举命中一个短暂容器而非零，原JSON保留；后续只读观察未独立确认该容器所有者，没有删除它。全栈后续清理结束后的 `independent-final-readback-after-stack-cleanup.json` 全部通过，SHA256为 `8dbba26b204226e919de00e5b23f9faefcf6ada527a4165734a18cb959d3e195`；记录同镜像身份、171份输入在该验收窗口不变及六类资源为空，不把后续零资源改写成首次独立检查成功。

## 新成品真实全栈：登录已过，首页无法提交

`run-b5a407e230f67ca9a7234c47-HDoEYW` 使用上述39项成品，真实 smoke和27项迁移通过；浏览器 `browser-2026-11-02T17-48-59-265Z-2f2141c9e5/summary.json` 为5通过、1失败、10阻塞。页面注册、退出、再次登录、httpOnly/secure会话及SSR刷新已执行通过；首页填写后DOM可见文字，但计数为 `000 / 200`，发射按钮持续禁用，生成步骤失败。后续发布、OG、星图和撤回链未执行，不能从截图或前序通过推出它们通过。整轮外层exit1、sourceVerified/cleaned=true。

该轮 `independent-live-inspection.json` 的 SHA256为 `07a84ce6f7790672613a6580bfc2ced2bb166e38051ee96379f011b8911f82d7`。独立读取发生在清理后，明确 `liveSnapshotCaptured=false`、`liveEnvironmentVerified=false`：只能确认镜像身份、冻结合成env的空密钥/URL与零额度，以及容器/网络/卷为空，不能冒充运行中容器环境已被独立观察。

## 首页受控诊断与第二个修复

`run-fb222bdfc164d1a1fa570c0e-R0thHQ` 仅诊断首页水合，`browser-home-hydration-d5868c729342c7a3/summary.json` 为2通过、2失败。拦住7份静态JS时，输入框允许输入，DOM长度59而React计数0；释放JS后DOM仍为59、计数仍为0、提交禁用，未观察到value setter写入。与登录框的52→0不同，这里保留的是DOM文字，React状态尚未绑定。

水合后清空再填写才得到 `059 / 200`、按钮可用；诊断没有点击发射，实际生成请求0、外域请求0，导航query未带输入。整轮exit1、sourceVerified/cleaned=true，资源读回为空；该结果只定位问题，不是完整业务通过。

第二个最小修复仅为 `HomeFrequencyEntry.tsx` 增加客户端就绪状态：SSR禁用输入、发射及漫游按钮，表单显式POST；`production.spec.ts` 新增第二个JS gate回归，检查释放后的计数、提交body及导航，生产套件变为40项。未改Auth、API、合成响应、Provider或预算。

首页修复后的本机Web完整检查已外层exit0，lint、类型、192项单测及生产构建全部通过，日志为 `test-results/local-stack-home-web-check-20261103.log`。提交为 `8a5153a66d65411fbb67d9a3532ddd647113fc0b`；下述新40项及后续真实流程使用各自实际成品，不继承旧39项成绩。

## 40项成品与无Provider的实际失败

完整Web构建 `run-0553346ddc991c39682780ab-EjOFeh` 生成镜像 `sha256:280eb662e8a91bef127d3b26381daf538fc9960f206a2d1779d6f2cf09b86daa`，Node22.23.4；浏览器40/40、240.12秒，无跳过或flaky，外层exit0、sourceVerified/cleaned=true。同run的 `independent-final-readback.json` 为12项通过、actualExit0，SHA256为 `cc008ff1fac43b8df7cfe62acdb9a03034ee9e2ade04d2306f02aaa096008b85`。

使用该成品的 `run-41fa5e665e32f992233c7062-2JtOKa` 仍保持空Provider与零付费额度，浏览器5通过、1失败、10阻塞，外层exit1、sourceVerified/cleaned=true。首页已能真实提交，但主worker三次素材/扩写均为 `config_missing/AI_UNAVAILABLE`，最终 `FAILED/GENERATION_RETRY_EXHAUSTED`；当前主生成没有完整本地文学兜底，不能把辅助规则fallback当成主生成成功保证。部署指南中的过度承诺另作修正，未更改API或放开真实Provider。

该轮独立 `independent-live-inspection.json` 实际捕获运行中配置并确认清理后零资源，SHA256为 `6d98075d88243420bab2264cf17756591431c134987d7b61d16510ac065071ef`；此前第五轮的现场观察与本轮独立证据分别保留。

## 内部合成Provider：14/16，定位代理协议问题

后续仅在本轮隔离网络加入自有HTTP合成Provider，使用固定合成凭证，chat额度上限8、其他Provider额度0；不使用真实密钥或外部模型。真实API/worker仍执行原路径，浏览器不替换API。`run-2ce0831cbfe67fc6c563fc0a-CTdJGA` 的27迁移及原smoke通过，合成服务实际接到 `signal-material`、`signal-expansion-review` 两次请求；浏览器14通过、2失败、0阻塞，外层exit1、sourceVerified/cleaned=true。

两项失败为公开metadata协议从HTTPS变为HTTP，以及匿名浏览器记录一个React418错误；生成、作者确认发布、公开读取、实际OG、390px阅读/焦点、撤回及私密保留等已执行通过不能消除这两项失败。独立现场安全检查全通过，容器/网络/卷经拥有标签和Compose项目双过滤均为空；同run的独立JSON SHA256为 `59d9103fdda1e10c7c7106dfd865eb77906027e7f8051c84f0da59c665c5bf74`。

## 中间轮次：Caddy修正后15/16，定位Galaxy异常

仓库Caddy按server模式公网HTTPS约定，在Web上游明确覆盖 `X-Forwarded-Proto: https`；容器间仍HTTP，不直接沿用客户端伪造协议头。修正后的 `run-520ea8efc7c32eedad32404f-S4rRwe` 使用同一40项Web成品和内部合成Provider，浏览器15通过、1失败、0阻塞，外层exit1、sourceVerified/cleaned=true。公开metadata实际保持本轮HTTPS origin，伪造转发头不能改变该origin；这只验证本机双Caddy，不是实际NPM部署验收。

唯一未通过组为无未捕获页面错误检查：记录匿名访问 `/galaxy` 时的React418。其余15组通过也不能将该运行改记为16/16；后续截图不替代错误断言。独立观察捕获七服务，现场安全检查全true，结束后双过滤容器/网络/卷全0；同run的 `independent-live-inspection.json` SHA256为 `7910ff04f042d6f69dbee3a81cc1b8eec22a9da18e3db825f030258c1e521113`。

该轮结束时Galaxy水合问题尚未修复，新Linux41项与最终真实16组尚未执行；后续结果见下文。各轮原manifest、浏览器summary、失败、阻塞和独立观察均保留。本轮不包含实机、读屏器、真实模型、人评、生产部署或 A3 数据处置。

## 星图首帧修复与最终验证

提交 `9fb0e6e0191715e736dcad0a265f28310574fa2b` 保留定位点和原关闭逻辑，仅让 `GalaxyCanvas` 的阅读portal在服务器与首次水合时都为空，客户端就绪后再挂载到body。新增生产回归直接打开有效公开点的focus链接，拦住真实Next脚本检查SSR无弹窗，释放后检查正文、初始焦点、Escape关闭及焦点恢复，并要求全部pageerror为空；生产浏览器总数变为41。独立代码复核未发现阻断。

本机首轮Web检查在受限沙箱完成lint/类型检查，但Vitest的23个文件均在临时缓存rename时遭遇EPERM、实际执行测试0，外层exit1，原日志 `test-results/local-stack-galaxy-web-check-20261103.log` 保留。随后以正常Windows权限运行相同 `npm run web:check`，未修改用例或时间预算，lint、类型、192项单测及生产构建全部通过，外层exit0，日志为 `test-results/local-stack-galaxy-web-check-normal-20261103.log`。原部署脚本11组回归已外层exit0；Windows日志明确不能验证POSIX权限，不把它当作Linux权限验收。

`run-f8389f29a20128ddb583d01d-jqJ4Jy` 从上述提交完整构建Linux amd64成品 `sha256:cec1ad3d251fc21a707a07b2c7b33d00da29b609b359863f1f104fcfecbf52db`，sourceTree为 `473089ed8bf01a8a4f5327284c97a514f37f06d200f69560c6086a0462092a81`。三阶段构建、158份构建输入和13份验证来源核对通过；生产浏览器41/41、258.41秒，无跳过、失败或flaky，外层exit0、sourceVerified/cleaned=true。直接停止143/3550.51ms、受监督运行停止0/1398.54ms，均无OOM。该套使用合成API，真实后端16组另记；旧39/40及15/16均保留原成绩。

独立 `independent-final-readback.json` 的SHA256为 `52667b6cf94cd10dfc41a9f9e2d4a63b7b072473ce45bc94fc3aa0039b99c436`，8条只读命令全部exit0，171份current/frozen来源、三份构建metadata、镜像身份和165包/17嵌套路径核对通过，四个旧工具名称及路径均不存在。六类资源在复用前已读回为0；之后才允许全栈复用该镜像，避免继承镜像验证标签的全栈容器污染前一验收的清理时点。

## 最终真实后端全栈16/16

`run-93255a628a0af8e89a454143-DyjOEh` 复用上述新Web成品，API为既有已验证成品 `sha256:e27c26b864fabd154008b92d5d386e66852c02e7c01c76528b9c19bde8e5cbd1`；API来源未变化。原仓库preflight、HTTPS smoke、七服务健康和全新PG的27项迁移均通过。浏览器报告 `browser-2026-11-02T19-06-56-129Z-02e270fae3/summary.json` 为16通过、0失败、0阻塞；整轮外层exit0、sourceVerified/cleaned=true、cleanupFailures为空。

实际UI注册、退出/登录、secure/httpOnly会话及SSR刷新、首页提交和真实worker、草稿对匿名/非作者不可读、作者确认精确预览、匿名公开DTO及页面、HTTPS metadata与伪造转发头拒绝、真实匿名OG、390px星图定位阅读/关闭焦点、UI撤回、撤回后各公开入口隔离及作者历史全部执行。pageErrors和外域请求均为空；浏览器正常关闭。

内部合成Provider实际仅接收 `signal-material`、`signal-expansion-review` 两次请求，未触及chat上限8；其他Provider额度为0。生成解释来源为 `provider/unverified`，固定正文107字符，不是模型质量成绩。没有修改真实Provider配置、生产额度、依赖锁或API逻辑。

真实OG为1200×630、89095字节，SHA256 `afdd0b83df743b4faa99d6b178eda61fc5ce0f90b0c7c96880d3e3e437f6d0a0`，已实际查看中文排版；390×844星图阅读截图亦已查看，WebGL启用、正文可读、Escape恢复焦点。浏览器仿真不代表实体手机或读屏器验收。

独立 `independent-live-inspection.json` 的SHA256为 `ef6282139f5d67d8ca1610a9a17777b244d4dd59352488181807589c3fa881fc`：运行中七服务、镜像、固定合成Provider配置、端口和网络安全检查全通过；结束按本轮拥有标签及Compose项目双过滤，容器/网络/卷均为空，观察器自然exit0。仅移除本轮自有资源，验收镜像和证据保留，没有全局prune、用户数据处置或系统CA安装。

代码提交 `9fb0e6e` 的[四项CI](https://github.com/NekoMint-Labs/Unfreq/actions/runs/41503998647)全部通过；交付保持[草稿PR #11](https://github.com/NekoMint-Labs/Unfreq/pull/11)，基于PR #10的精确 `d843461`，不合并main。真实模型/双人评测、实际NPM与生产TLS/IP/额度、旧生产数据恢复、实机/读屏器、A3处置和参赛事实仍需相应对象与决定。
