# 2026-11-01：A1–A3 评审评论处理

本地接续基线为 `2ef7f1e4933e2f8dfc051267f1e68544a5575129`。本轮先处理 GitHub 评论，未继续 Linux 镜像验收。原工作区的 `progress.md` 和 F4 镜像记录两份未提交修改保留，不纳入本轮提交。

## A1：测试 Cookie 与真实 API 一致

[评论](https://github.com/NekoMint-Labs/Unfreq/pull/1#issuecomment-6555151887)要求统一合成会话 Cookie。PR #1 的修正提交为 `c902118d80b4e083720669e978ad38e1db539ff4`，仅将合成 API 和 Playwright 断言中的名称改为 `unfreq_session`，没有修改业务 API。

在 PR #1 自身基线上安装锁定依赖并验证，未将当前 C1/F4 工作区的构建冒充 A1 成绩：

- 首次普通权限离线安装因 Windows workspace symlink `EPERM` 失败；正常本机权限重跑安装 532 包，退出 0，原日志保留。
- `npm run check` 退出 0：API 26 文件、220 项测试，两端 lint、类型检查与构建通过。
- 原生产浏览器套件 4/4，23.2 秒；使用真实 Next 生产构建、Windows Chromium 和 loopback 合成 API，端口为 33211/43211。
- [当前 Head 的 CI](https://github.com/NekoMint-Labs/Unfreq/actions/runs/41294004264)三项全部成功。

#1 已转为 Ready for review，并请求 `onedotmint` 独立复核。[处理回复](https://github.com/NekoMint-Labs/Unfreq/pull/1#issuecomment-6556262970)已读回。记录时尚无正式审批，未合并。

## A2：按合并前置条件跟踪

[评论](https://github.com/NekoMint-Labs/Unfreq/pull/2#issuecomment-6555152133)没有要求扩大现有实现；两个后续事项已分别登记并读回：

- [#6：集成检查设为必需](https://github.com/NekoMint-Labs/Unfreq/issues/6)：等 #2 合入 main 且目标提交上的检查成功后，再向 `Main` Ruleset 增加精确名称 `Isolated API integration`，保留全部现有保护并读回验证。当前不提前修改 Ruleset。
- [#7：postgres.js v4 独立升级](https://github.com/NekoMint-Labs/Unfreq/issues/7)：独立验证 Drizzle、参数推断、ESM/CJS、预留连接、事务及 FIN/RST/恢复。通过后再成组退役旧补丁、安装器、postinstall、Docker 接线和补丁专用测试/文档；现在保留 3.4.9 补丁。

[处理回复](https://github.com/NekoMint-Labs/Unfreq/pull/2#issuecomment-6556244119)已读回。#2 的基线协调及重新 CI 仍等待 #1 获准并 squash 合并；没有提前改动堆叠分支。

## A3：文档契约与后续 C1 修正分开交付

[评论](https://github.com/NekoMint-Labs/Unfreq/pull/3#issuecomment-6555152452)的文档修正提交为 `789d3db373ae80db0a16e7847a3e81afed60f2fe`。该提交只改七份 Markdown，保留旧 `200/REVIEW_RESTRICTED` 的基线事实；目标矩阵、不变量和 L01/L02 改为非作者 404。公开白名单、派生入口、服务端匹配/分类及撤回边界已同步到相关规范。

文档差异、相对链接/标题锚点和现状/目标一致性检查通过；[当前 Head 的 CI](https://github.com/NekoMint-Labs/Unfreq/actions/runs/41294022765)四项全部成功。[处理回复](https://github.com/NekoMint-Labs/Unfreq/pull/3#issuecomment-6556263642)已读回。#3 保持 Draft，待 #2 合并后再协调基线；未加入运行时、API、共享类型或 schema 变更。

当前较新的本地工作区另外落实了 REVIEWING 的非作者 404 修正，见 [C1 补充记录](./c1-reviewing-20261101.md)：路由专项 51/51、API 类型检查及变更文件 lint 通过。它没有混入 #3，也没有随旧 PR 推送。主工作区的三个代码文件与通过专项测试的隔离副本逐项哈希一致。

本地文档同步保留了已有的历史公开内容重新确认规则、F2 补充、E4 未知/未验证保护和 F3 冻结内容，未使用 A3 旧版文件覆盖后续规范。

## 来源与剩余边界

首次上传的文件带 Windows CRLF，GitHub 读回发现 diff 放大；仅替换本轮刚创建的两个提交并以预期 SHA 校验更新，规范为 LF。最终读回 A1 为两处单行修改，A3 为七份 Markdown、63 行新增/34 行删除。最终 CI 对应上述新 SHA，没有沿用被替换提交的成绩。

隔离目录与原始日志保存在本地忽略目录 `test-results/comment-fixes-20261101/`。本轮没有运行生产迁移、部署、真实收费 Provider、硬删除或历史数据处置。独立审批、依次合并、合并后 Ruleset 设置及独立 v4 升级仍按各自前置条件推进；不能把已回复评论解释为这些事项已经完成。

## 接续：A1 已合并，A2 已协调基线

2026-11-01 后续读回确认：`onedotmint` 于北京时间 18:46:39 批准 #1 的精确 Head `c902118d80b4e083720669e978ad38e1db539ff4`，并于 18:46:51 squash 合入 main，合并提交为 `74c15dc4a69e67e838c0c72865a4edcd04f046cf`。前文“尚无审批”描述首次交接时点，不代表本次接续状态。

#2 随后将原 A2 的两项提交重放到该 main，新 Head 为 `3d3dd6ca34dd16d1337d996b8c9b654a77f4ed5b`。range-diff 两项均相同，29 个 A2 文件 blob 不变；两 Cookie 文件与 main 一致。旧/新 A2 完整 diff 的 SHA-256 同为 `eb0802ce03804ccb4dcbfde999f9f243e9abad61a4f59673bfe152089cf53db4`。重排通过精确旧 SHA 的 lease 推送，PR Base 改为 main。

[新 Head 的四项 CI](https://github.com/NekoMint-Labs/Unfreq/actions/runs/41300135826)全部成功；#2 已转为 Ready for review 并请求独立审批，[接续回复](https://github.com/NekoMint-Labs/Unfreq/pull/2#issuecomment-6557099739)已发布。#2 尚未合并，因此 #6 Ruleset 设置和 #3 的下一轮基线协调仍保留前置条件。v4 候选没有混入 #2。

后续维护者于北京时间 19:25:19 将获批的 #2 squash 合入 main `c80fef65fa9f18a71305569ed5b1ee5e76a7fe61`。#3 的四项文档提交随后重放到该 main，新 Head 为 `39462e716ce4a7837c3519385e8580d06cd0dad6`；八份文档 blob 与完整 delta 均不变，delta SHA-256 为 `02a3e882db0664c632d647d50504c5741650c14f950862b5c7f5ce90636eac1d`。新 Head 的[四项 CI](https://github.com/NekoMint-Labs/Unfreq/actions/runs/41303531980)成功，已转为 Ready 并请求独立批准，[回复](https://github.com/NekoMint-Labs/Unfreq/pull/3#issuecomment-6557621170)已发布。此前的未合并说明仍保留为阶段记录。

维护者随后设置 #6；[只读验收记录](./ruleset-integration-20261101.md)确认四项检查已在默认分支实际生效，其他可读取配置不变，issue 已关闭。#7 的 v4 候选则在真实 FIN/恢复门禁失败，见[负向评估](./postgres-v4-20261101.md)；未将其升级或补丁删除混入当前实现。

## B1/B2：关停交错回归

针对[#4新评论](https://github.com/NekoMint-Labs/Unfreq/pull/4#issuecomment-6557377329)，在其精确旧Head `ff18fc7` 上另作测试、夹具、来源冻结及文档补充，提交 `ce93dcc2fbdf0c868d441a77a4cc8e99df320d97`。没有重写生产代码或schema。真实HTTP在通过准入后由本轮专属PostgreSQL INSERT屏障挂起，待真实consumer stop完成才放行；验证同ID持久pending、原PID自然退出、新PID仅领取一次、作者仅一行、两个预期Provider阶段各一次。文档据此说明：关闭前已准入请求可以持久排队等待其他或新启动消费者，不能承诺停机期间完成。

独立锁安装和完整本地check通过；最后夹具只读停止标记收紧后，lint、类型及冻结工具6/6另过，未把较早的check改标成较晚源码成绩。提交经普通快进推送到#4自己的head `fix/b1-generation-recovery`，Base仍为`docs/a3-data-lifecycle`、Draft不变。由于该Base已重排而当前PR有冲突，自动PR CI未触发；随后对精确Head只手动触发一次[独立CI](https://github.com/NekoMint-Labs/Unfreq/actions/runs/41312031728)。四项全部成功，工具14、API268、Web38、真实集成47/47，新增交错用例通过。下载日志确认PG、Redis与网络移除；未直接取得远端manifest，不外推其未读字段。

历史NULL pending盘点/不自动纳管、所有副本同数据库与同C、所有attempt/owner/lease/state栅栏以及未知付费工作不盲重放保持。C1仍另作接入。当前#4不是可合并状态；#3独立批准/合并后仍须协调冲突并对新Head重跑。[处理回复](https://github.com/NekoMint-Labs/Unfreq/pull/4#issuecomment-6558742765)已发布。

## B3：预算与代理链验收提案

针对[#5新评论](https://github.com/NekoMint-Labs/Unfreq/pull/5#issuecomment-6557377866)，提交 `34c2ae338a2b75c5b96b86b102ce8cd65effa5ca` 只新增[提案](./b3-pilot-boundaries-20261101.md)并在部署/运维各加一个入口，共三份Markdown。23个预算字段按当时PR5范围逐项核对；20人pilot、接收30次生成与20次新音频的数值仅待评审。成本以待核实际模型上界的变量公式说明，包含重试/备用、固定窗口边界及UTF-16与厂商计费的差异。全零结构样例保持，没有批准或启用生产数值。

文档明确默认Caddy会丢弃不受信任的传入XFF，仅配置API CIDR无法恢复已丢弃的访客地址；给出真实生效配置、逐跳地址、双客户端、伪造头和副本一致性的目标环境验收步骤，没有把应用层桩测试当作NPM→Caddy→API实测。共享Redis/DB、namespace、HMAC、策略、fail-closed、缓存音频、owned socket drain及未知PENDING/F1边界均保留。

三份远端文件逐字读回一致，提交差异确为三份文档；[新Head四项CI](https://github.com/NekoMint-Labs/Unfreq/actions/runs/41308905465)全部成功，真实集成65/65。#5仍Draft并堆叠#4，[处理回复](https://github.com/NekoMint-Labs/Unfreq/pull/5#issuecomment-6558259986)已读回；父分支整合、最终基线协调及对应新Head检查仍待前置条件，未继承旧绿灯作为合并资格。

## 接续：A3 已合并，B1/B2 已协调并送审

维护者于13:44:02 UTC正式批准#3精确Head `39462e716ce4a7837c3519385e8580d06cd0dad6`（review `5728345726`），13:44:14 UTC合入main `3e145a3c742db761ff6b89108362f280e9c5787c`。此前等待#3的说明是阶段记录，前提现已满足。

#4的11项提交随后在独立分支重放到该main，新Head `b11d5cb6f796de4ea92b14a61800fdcac39e67c0`。range-diff全部相同，56个B1变更路径blob不变，完整old/new delta SHA-256同为 `96f4c9f6ecd3a5998a879c4f23786a0a2bbe8a27503b67036390fec7a5dc93f9`。两Cookie修正与main相同，A3七份文档逐字保留，索引仅原B1两条新增链接，无人工冲突处理。以精确旧Head lease更新#4自己的head分支，Base协调为main，未更新main或#5的head。

[新PR事件CI](https://github.com/NekoMint-Labs/Unfreq/actions/runs/41314637247)四项全绿，工具14/API268/Web38、真实47/47，新交错回归通过。实际checkout为合并测试引用 `288af810deef3b0d430f4cec18f28891bf09f6dc`，其父为main和b11，tree与b11完全相同；没有把合并引用和Head SHA混写。下载日志确认PG/Redis/网络移除。#4已Ready并请求`onedotmint`独立复核，[协调回复](https://github.com/NekoMint-Labs/Unfreq/pull/4#issuecomment-6559151092)已读回，尚无正式批准或合并。

用户再次要求检查新评论后，实时核对open全集仅#4/#5/#7，没有新增他人顶层评论、正式review或inline thread。#5继续Draft并堆叠#4；其基线协调及新Head检查仍待#4获准合并，不提前重排或继承旧成绩。
