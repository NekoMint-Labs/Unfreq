# 本地收尾：播放、部署配置与剩余隔离验收

日期：2026-11-03（北京时间）。基线为 `63aca0658d92c55366db42ae6e18b5ee8efc21c2`，分支 `codex/remaining-local-acceptance-20261103`。接续[上轮41项成品与真实后端16组](./local-stack-20261103.md)，本轮只处理新发现的缺陷及尚未执行的本地范围，不重记上轮成绩。

## 服务端音频不应依赖浏览器朗读

`SignalPlaybackButton` 在播放已有READY服务端音频前无条件调用 `window.speechSynthesis.cancel()`。该能力在其他路径被当作可选项，但这里会使缺少Speech API的浏览器在 `Audio.play()` 前抛错。结果页和星图阅读层均使用此组件。

`test-results/playback-without-speech-20261103/old-callback-proof.json` 保存从未改动源码提取的原回调和双对照：无Speech API时已创建Audio、play调用0并出现TypeError；有该API时play调用1且无错误。该轻量证据使用受控依赖，不是浏览器、实际TTS或设备验收。

修复提交 `9fbb416f7839df0e32e7dfb31cc7a2b15d4e085d` 仅给该cancel增加能力判断，不改变权限拒绝与朗读降级策略。新增生产回归移除Speech API，先检查原合成公开信号的可读权限，再在本case提供合法READY响应和有效静音WAV，保留真实HTMLMediaElement播放/停止，并检查解码、无朗读及无pageerror。原有41项保持，生产浏览器总数为42；新Linux成品仍在验收，不能提前记为通过。

## 一键部署的环境文件与临时文件

旧 `prod-deploy.sh` 从普通模板复制配置，并使用固定的 `<env>.tmp` 重写。在默认umask022下，新建配置为0644，原有0600配置重写后也成为0644；已有临时文件会被覆盖，临时符号链接会写穿到其他文件。

原反例目录 `test-results/prod-deploy-env-permissions-20261103/original-6c14edd7d738d397afcda6fb-3Z0E8r` 保存原bytes、CRLF转LF的执行副本及各自SHA。真实Linux四项反例均复现，umask077负控制为0600；受控UID65534的读取结果仅记录布尔/长度，不输出合成凭证。原manifest SHA256为 `6b8f771de03155490271e96304e9954c3e433c25923738969a783766e7282be6`。实验exit0表示成功复现缺陷，不表示旧脚本验收通过。

修复使用umask077、600权限、同目录唯一mktemp和可处理退出的清理；首次发布完整配置采用不覆盖的硬链接，更新采用原子替换。固定 `.env.tmp` 不再参与；主环境路径为符号链接或非普通文件时拒绝执行。替换值按字面保留，生成或已有密钥不会输出。SIGKILL/断电仍可能留下私有临时副本，不承诺所有情况下完成清理，也未修改实际环境文件或运行真实部署。

永久部署回归新增5组，覆盖新建/重写的私有权限与字面值、固定临时文件/链接碰撞、主路径拒绝、更新失败保留原值及清理、首次发布竞争不覆盖。`suite-bcc0e6ec7250537693676cd2-pgP7z3` 的真实Linux16组全部通过；同一新suite使用冻结旧脚本时在新增600权限断言退出1，原失败保留。修复后的各直接探针均600、哨兵不变、受控低权限读取被拒绝。

上述正向suite manifest SHA256为 `a46b4d1557f424bdea1603d14824591a3742783ec54c746357f9e136152340c6`；独立 `independent-final-readback.json` SHA256为 `b1f049b3a904faa5688682edd8ce3b1e7ff780ed8bb499c289a12f9860f0ebe5`，六条只读资源查询全部通过，两个自有run的容器/网络/卷均为0。Windows测试仅对不能证明的POSIX权限作明确说明；本次权限结论来自Linux tmpfs，不外推NTFS权限。

## 当前说明与后续局部验收

演示脚本、FAQ、架构、开发与参赛说明已撤去无Provider完整生成的承诺；异步生成决策更新为现有PostgreSQL持久队列、租约与未知外发不重放，Redis不被写成当前持久生成队列。B1运维页的旧C1待实施说明指向后续真实验收，历史失败和计数仍保留。

本机正常权限 `npm run check` 已外层exit0：工具87、API767、Web192、lint/类型及两端构建通过，日志为 `test-results/remaining-local-full-check-20261103.log`。新42项成品、真实NPM的局部路由/协议验收，以及媒体命名卷归档/恢复正在分别留证；它们不等于生产数据恢复、真实模型或实体设备验收。
