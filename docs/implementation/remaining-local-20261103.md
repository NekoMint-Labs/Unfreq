# 本地收尾：播放、部署配置与剩余隔离验收

日期：2026-11-03（北京时间）。基线为 `63aca0658d92c55366db42ae6e18b5ee8efc21c2`，分支 `codex/remaining-local-acceptance-20261103`，交付为[草稿PR #12](https://github.com/NekoMint-Labs/Unfreq/pull/12)。本轮修复服务端音频播放与部署环境文件写入问题，并完成新Linux42项、部署Linux16组、媒体卷33项与真正NPM的本机局部验收。各轮失败与恢复保留；不将上轮真实后端16组成绩重记为本轮，也不扩大为生产或真实模型验收。

## 服务端音频不应依赖浏览器朗读

`SignalPlaybackButton` 在播放已有READY服务端音频前无条件调用 `window.speechSynthesis.cancel()`。该能力在其他路径被当作可选项，但这里会使缺少Speech API的浏览器在 `Audio.play()` 前抛错。结果页和星图阅读层均使用此组件。

`test-results/playback-without-speech-20261103/old-callback-proof.json` 保存从未改动源码提取的原回调和双对照：无Speech API时已创建Audio、play调用0并出现TypeError；有该API时play调用1且无错误。该轻量证据使用受控依赖，不是浏览器、实际TTS或设备验收。

修复提交 `9fbb416f7839df0e32e7dfb31cc7a2b15d4e085d` 仅给该cancel增加能力判断，不改变权限拒绝与朗读降级策略。新增生产回归移除Speech API，先检查原合成公开信号的可读权限，再在本case提供合法READY响应和有效静音WAV，保留真实HTMLMediaElement播放/停止，并检查解码、无朗读及无pageerror。原有41项和预算保持，生产浏览器总数为42；最终新成品通过，前序失败及修正范围如下。

首个完整成品 `run-27d40ba23a8293a13694a066-YomWgw` 实际40/42、外层exit1、cleaned=true：新增音频case的真实播放/停止等断言已过，但最后的全页alert计数误命中空的Next路由announcer；旧E4月报case的末次API请求发生socket hang up，原因未定，没有API退出或OOM证据，不能断言为产品或资源问题。两份error-context/trace及原playwright.json均保留。独立 `independent-first-failure-readback.json` SHA256为 `e24573990dd98e7e361d30f675d761e30b609aa8188d93ff1e47683b53def184`，确认该验收窗口171份current/frozen来源一致、metadata/image身份及六类资源为0；它不把原40/42改成通过。

仅将新增case的alert断言限定到播放器父容器，仍严格要求全页pageErrors为空；旧41项及全部预算未改，测试提交为 `81fe79158a5db1597b1b3481182775177901c8c5`。之后从该提交重新执行原canonical完整构建与42项，独立记录新成品，不绕过续验来源约束或复用失败结果。

第二轮 `run-ffff0c77b882dd2348ffe088-ISpekj` 在runner导出时遇到Docker RPC EOF，未进入浏览器；只完成deps/prod-deps两阶段，没有runner metadata、image probe或新playwright报告。原manifest保留exit1、cleaned=false。`independent-build-failure-observation.json` SHA256为 `fcaaa498516aab511296db2b5644cee0f5db9163699365ebc4112c11313ad521`，171份current/frozen来源仍一致，不据此给成品绿灯。

当时WSL无运行发行版、Docker Desktop处于stopping；随后Desktop自行恢复running，本轮没有执行Docker重启/停止命令，也未修改设置。旧构建器实际退出255、OOMKilled=false，没有足够证据归因内存。日志中的镜像签名诊断在此前成功成品及NPM也出现，不能单据该条信息认定根因或关闭校验。

原CLI结束后，按冻结容器ID/name/image/config、2GB内存/3GB含swap、restart策略和唯一挂载，以及卷完整身份指纹/拥有标签核对，单独移除本轮已退出构建器及状态卷。另存 `independent-recovery-cleanup.json`，SHA256为 `d55d3ed25ad90fef01ed8f177c477e01b2282565e4edc0ef94fe001428bb5244`：13条命令exit0、六类自有资源归零、171份来源不变；原失败manifest没有改为cleaned=true。随后才按相同来源与原预算启动新的完整canonical运行。

最终 `run-cb634d20b388559e8f8e04ee-60HMDs` 从81fe提交完整构建Linux amd64成品 `sha256:982aac7f4260980f92c96483f6de77f1112f750694b89624573cf9d33b51689e`，sourceTree为 `927fc9b73222b7b5cd2d2e48789015318b5e75dcdb09e1b3fa49b55f58e9edbe`，Node22.23.4。原三阶段、原预算及全部42项完成，本次42/42、259.24秒、无跳过/失败/flaky，外层exit0、sourceVerified/cleaned=true。新增原生WAV播放/停止和旧E4月报均单次通过，未重复/放宽原用例。

最终独立 `independent-final-readback.json` SHA256为 `77339b27db92b487a938b31492dbea7ee92c30b08e7ba9c4cb31e4b5ffcd4e67`，12项/8条命令全部exit0，171份current/frozen来源、三份metadata、成品身份及165包/17嵌套路径核对通过，四旧工具名称/路径均无。direct停止143/3414.84ms、runtime停止0/1705.45ms，无OOM；六类资源在复用前归零。OG与新音频截图已查看，播放截图不作为听感或真实TTS质量证据；之后才允许NPM联合测试复用该成品。

## 一键部署的环境文件与临时文件

旧 `prod-deploy.sh` 从普通模板复制配置，并使用固定的 `<env>.tmp` 重写。在默认umask022下，新建配置为0644，原有0600配置重写后也成为0644；已有临时文件会被覆盖，临时符号链接会写穿到其他文件。

原反例目录 `test-results/prod-deploy-env-permissions-20261103/original-6c14edd7d738d397afcda6fb-3Z0E8r` 保存原bytes、CRLF转LF的执行副本及各自SHA。真实Linux四项反例均复现，umask077负控制为0600；受控UID65534的读取结果仅记录布尔/长度，不输出合成凭证。原manifest SHA256为 `6b8f771de03155490271e96304e9954c3e433c25923738969a783766e7282be6`。实验exit0表示成功复现缺陷，不表示旧脚本验收通过。

修复使用umask077、600权限、同目录唯一mktemp和可处理退出的清理；首次发布完整配置采用不覆盖的硬链接，更新采用原子替换。固定 `.env.tmp` 不再参与；主环境路径为符号链接或非普通文件时拒绝执行。替换值按字面保留，生成或已有密钥不会输出。SIGKILL/断电仍可能留下私有临时副本，不承诺所有情况下完成清理，也未修改实际环境文件或运行真实部署。

永久部署回归新增5组，覆盖新建/重写的私有权限与字面值、固定临时文件/链接碰撞、主路径拒绝、更新失败保留原值及清理、首次发布竞争不覆盖。`suite-bcc0e6ec7250537693676cd2-pgP7z3` 的真实Linux16组全部通过；同一新suite使用冻结旧脚本时在新增600权限断言退出1，原失败保留。修复后的各直接探针均600、哨兵不变、受控低权限读取被拒绝。

上述正向suite manifest SHA256为 `a46b4d1557f424bdea1603d14824591a3742783ec54c746357f9e136152340c6`；独立 `independent-final-readback.json` SHA256为 `b1f049b3a904faa5688682edd8ce3b1e7ff780ed8bb499c289a12f9860f0ebe5`，六条只读资源查询全部通过，两个自有run的容器/网络/卷均为0。Windows测试仅对不能证明的POSIX权限作明确说明；本次权限结论来自Linux tmpfs，不外推NTFS权限。

## 当前说明与后续局部验收

演示脚本、FAQ、架构、开发与参赛说明已撤去无Provider完整生成的承诺；异步生成决策更新为现有PostgreSQL持久队列、租约与未知外发不重放，Redis不被写成当前持久生成队列。B1运维页的旧C1待实施说明指向后续真实验收，历史失败和计数仍保留。

本机正常权限 `npm run check` 已外层exit0：工具87、API767、Web192、lint/类型及两端构建通过，日志为 `test-results/remaining-local-full-check-20261103.log`。提交 `35b7c6f` 的[四项CI](https://github.com/NekoMint-Labs/Unfreq/actions/runs/41569727803)通过。新42项成品、真实NPM局部路由/协议及媒体命名卷归档恢复分别按各自来源留证；它们不等于生产数据恢复、真实模型或实体设备验收。

## 媒体命名卷归档与空目标恢复

`test-results/media-volumes-20261103/run-81275ac7567f5e924bae7630-Nkunoc` 最终33项通过、outer0、cleaned=true、cleanupFailures为空。只使用每轮新建的两份源媒体卷、两份空目标卷及无网络/无端口工具容器，合成PNG/PCM WAV含UTF-8目录和带空格文件名；未启动数据库、API或Provider，也未读取已有卷。

原迁移命令实际创建0644归档且源挂载可写，原 `legacy-contract-failure.json` 保留passed=false。修正后的 `docs/server-migration.md` 两个shell正文按原样提取执行：源只读且写入尝试拒绝，Linux工具层目录0700/归档0600，shell no-clobber和显式检查拒绝既有归档、指向哨兵的链接及悬空链接；相应内容和目标缺失状态均不变。未执行并发同名竞争测试，不宣称已实测race。

空目标恢复后相对路径、SHA256、mode、UID/GID与源一致；非空目标再次恢复拒绝且内容不变。首轮22项与后两次包装器失败分别保留：官方镜像原/data目录非空，随后symlink映射使旧find检查漏判。只在自有helper内完整保留镜像原目录，并把文档检查改为cd /data后find .；没有删除原目录或既有卷。

工具镜像为已存在的官方固定RepoDigest `caddy@sha256:04913b1da43339a40ad1ea87827d70a576ac5aa6cf674c6e24fdca675887533a`，本机实际linux/amd64，不推断其他架构。该helper的/backup位于Linux可写层，完成后导出Windows字节副本，不据此证明NTFS或目标服务器bind目录的POSIX权限；目标部署仍须按文档检查。

最终manifest SHA256为 `fa8e57b017ac687e9f801fc7e47c1a00ce1539ef401b84754707d0491c9e44d1`；独立 `independent-resource-readback.json` SHA256为 `ae701c1a429bfdcfa1330f82d8200758f526075248986d8e863a8f814d2a0201`。24条只读查询覆盖四次run，拥有标签和名字双过滤的容器/卷/网络均为0。完整边界及输入指纹在同run的report.md；本结果不覆盖SQL、应用恢复、旧Redis状态衔接或生产迁移。

## 真正NPM的本机初始化与局部路由验收

NPM使用固定官方2.16.0成品、自有临时管理员和CA签发证书，没有修改系统hosts或系统CA。前两轮internal-only代理网使宿主入口不可达；第二轮同容器内登录POST200、宿主连接拒绝，并且实际NetworkSettings.Ports为空，原失败及清理记录均保留。第三轮只将NPM所在代理网改为自有bridge，不把它写成全部internal或出站防火墙。

`test-results/npm-local-20261103/run-fdf035fc804737d1ad643832-24yZLR` 的init-only最终exit0、sourceVerified/cleaned=true：实际官方登录200、自有证书创建201/上传200、Proxy Host创建201与默认配置读回、nginx -T及Caddy adapt通过，实际127回环端口发布已核对。独立 `independent-initialization-readback.json` SHA256为 `0022bff3085d1112431396a35c0ffca45e53897eb13be5e31128d940507b5095`，双标签资源读回为0；该初始化不是Web路由或生产链路通过。

首轮四服务联合 `run-a9505c7f6fc8460e2f734449-84HzCe` 的Node侧三组检查通过，但Chromium导航出现ERR_CONNECTION_CLOSED，整体exit1、cleaned=true。该轮已有no-proxy-server参数，缺少NPM access证据，不能直接归因系统代理。下一轮 `run-f8f3d002614835861250f39a-E28KYL` 在管理接口等待时发生Node unsettled top-level await，未执行finally；按冻结身份/双标签恢复清理，原manifest未改，另存recovery-cleanup.json，SHA256为 `c28275fb48dfa17b4750f21c01a456ab474e8a25d848c8d7195e76f53bb6aa6c`。

辅助脚本随后冻结并复用仓库已测试的 `runWithReferencedTimeout`，管理请求和JSON读取仍为原4000ms预算；没有使用全局keeper或放宽产品断言。最后一轮采用进程级精确域名映射和显式拒绝转发代理/精确bypass，先用Chromium访问真实NPM健康接口，再打开公开页；只保留安全netlog摘要。客户端路由对照通过，不据此追认首轮连接关闭的精确根因。

最终 `run-2c9b585282ce7030e77f1bb4-l0w7wl` 的8项主检查、5组目标检查全部通过，外层exit0、sourceVerified/cleaned=true。链路为官方[NPM 2.16.0](https://github.com/NginxProxyManager/nginx-proxy-manager/releases/tag/v2.16.0)，精确镜像 `jc21/nginx-proxy-manager@sha256:57d85bffc776c01909c7b24e127a69a72b7d8c75d387e6cb26c762978fc43e4c` → 冻结仓库Caddy → 上述已验Web42 → 只读合成API，未启动PG/Redis/worker或真实Provider。

实际验证自有CA和hostname、API/Web接口分流、HTTPS SSR/同源OG、两组伪造转发头、1200×630实际PNG，以及Chromium健康接口/公开页水合。pageErrors、外域页面请求和拒绝代理收到的请求均为空；实际nginx -T、Caddy adapt、默认Proxy Host字段及有效127回环端口均已保存，未以自定义advanced_config替代默认转发。浏览器使用ignoreHTTPSErrors=true，自有CA与域名强校验由Node完成，不宣称系统已信任该CA。

最终独立 `independent-final-readback.json` SHA256为 `113ed289c50cde0625ef0bb5a3ca7cbfd8505b1ce9d3303b60c290ba26b7f832`：冻结来源一致，拥有标签/项目双过滤的容器、网络和卷均为0，日志无私钥、密码或JWT，临时raw netlog已移除；两张PNG已查看。NPM代理网为自有bridge，Web/合成API仅internal，不把整个拓扑写成出站防火墙。该局部结果不覆盖真实API/数据库、生产TLS/IP/CIDR/额度、旧数据恢复、真实模型、人评或实体设备；A3数据处置和参赛事实仍按原边界。
