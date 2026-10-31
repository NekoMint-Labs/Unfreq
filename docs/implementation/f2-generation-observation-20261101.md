# F2 后续：任务时序观察

日期：2026-11-01。基线为本地提交 `9c17074`，继续使用 `codex/f2-backup-replicas-logs`。本轮调整集成测试及其诊断，不修改生产 worker、执行权栅栏、并发配置或调度器。

## 先前失败与本次复核

F2 上一轮完整集成中，两项恢复检查在 5 秒观察终点仍为 MATCHING，但数据库记录的本次执行截止尚未到达。另一轮 capacity 同时提交六条任务，并发上限为 2，最后两条刚进入执行阶段；close 则在接受任务后 3 秒尚未抵达 Provider 时直接强杀，未调用 app.close。完整失败经过保留在 [F2 首轮记录](./f2-recovery-replicas-20261031.md)。

本轮首先保持原有 3 秒、5 秒观察窗口，增加活进程 HTTP 与仓库时序诊断。run-Pc1kAz / 6f70054e6613 的九项检查全部通过，耗时 71.89 秒，已清理。该轮 capacity 从首条 accepted 到六条完成约 1494ms，close 从 accepted 到自然退出约 426ms。没有复现前轮慢因，不能将这次通过解释为性能问题已修复，也不能将此前失败删除或改写。

## 观察方式调整

原 capacity 对六条任务各启动一次 25ms 轮询，共用一个连接和同一个 5 秒终点。这把排队、单次执行与重复查询的等待混在一起。现改为一次 SQL 批量观察：全部任务必须完成，每条必须满足预期尝试次数、DRAFT 状态和位置已生成、已持久标记派发、租约已释放；数据库直接比较完成回写时间与该 attempt 的截止时间，要求回写发生在截止之前。观察者稍晚读到已完成记录，不会被误判为超期。

等待仍有固定总上界，按任务数、并发 2、预期尝试次数、每次执行预算、退避上界和数据库收尾预算推导；每次重排都不刷新这个上界。每轮查询前、返回后均检查这个绝对上界，不能用最后一次迟到读取改判成功。尚未领取的任务也受此限制。这里的 10 秒 attempt 是合成夹具参数，生产默认配置为 180 秒，本轮均未修改；该观察上界不是生产吞吐或延迟承诺。

新增延迟排队回归：在真实领取入口暂停扫描，开始完成观察后等待至少 5100ms，检查数据库仍为 RECEIVED、attemptCount=0、deadline 为空且 Provider 无请求，再开放领取。最后须在实际 attempt 截止前完成且只执行一次。它专门覆盖“已超旧 5 秒窗口，但执行预算尚未开始”的情况。重试案例的外层实验预算由 45 秒调为 90 秒，以容纳冷启动、三次各 10 秒执行和失败清理；单次执行截止与 SQL/关闭预算不变。

带 signalId 的 checkpoint / held HTTP 准备检查，依据持久 attempt 截止及固定准备总上界等待。真正到达 checkpoint 或 Provider 后，仍须证明属于本次任务、执行尚有效。原先没有任务 ID 的扫描与其他既有检查继续采用原窗口。旧 3 秒准备、5 秒整批结果作为历史延迟观察保留，新成绩不表示它们均达到旧窗口。

关闭检查先确认实际 held HTTP 仍在等待，然后调用 app.close。新增固定 shutdown 取消计数，必须恰有一个请求因 shutdown 取消，不能用 deadline 取消代替。原 IPC 关闭响应预算及自然退出预算保留，同时记录 app.close 的起止时间，仍要求零 pending HTTP、零未处理错误、自然 exitCode=0 且没有强杀。

## 诊断与环境

HTTP 诊断只保留固定事件、可信 signalId/attemptId、序号、时刻、耗时、计数及允许的取消原因，不记录 URL、请求正文、输出、密钥或任意错误信息。每个子进程最多保存 256 条，并报告丢弃数量。失败裁决一旦作出便不再接受迟到成功；强杀前先采样活进程，避免此前先杀进程再读取诊断导致证据丢失。

首次启动时 Docker Linux 引擎不可用，测试未执行。Docker Desktop 页面报告 sailor-ingest.sock 无法访问；单文件改名也失败。确认 Docker 已退出、两个运行时目录直接子项均为零字节通信端点后，将目录原地改名保留，再启动现有 Docker Desktop，实测引擎为 29.7.2。采用了 [Docker 仓库问题记录中的运行时目录保留办法](https://github.com/docker/desktop-feedback/issues/554)，不把它当作官方永久修复。没有请求重置、删除文件、镜像/卷操作或 WSL 注销。

保留目录为 `%LOCALAPPDATA%/Docker/run.f2-preserved-20261101` 与 `%LOCALAPPDATA%/docker-secrets-engine.f2-preserved-20261101`；具体范围和失败记录见 test-results/f2-docker-recovery-20261101.json。没有上传诊断包。

## 验证与边界

- 首次 api:check 的工具检查为 13/15：两个既有补丁测试在受限临时目录的 rename 报 EPERM，未进入后续 API 检查；原日志 f2-timing-api-check-20261101.log 保留。正常本地权限下复跑 api:check 通过，运行器 15/15、API 732/732（64 文件），lint、类型与 API 构建通过，见 f2-timing-api-check-verified-20261101.log。独立审查后补强总 watchdog 并增加排队回归，最终源码的 lint 与类型再次通过，见 f2-timing-lint-final-20261101.log / f2-timing-types-final-20261101.log。
- 最终任务专项 run-qBebtt / 713b3e06f04d：10/10，67.95 秒，scope=generation-checkpoints、exitCode=0、cleaned=true，无失败、跳过或 TODO。延迟排队总观察约 5412ms，领取至回写约 225ms，真实完成未超过 attempt 截止，旧 5 秒指标明确为 false；capacity HTTP 峰值为 2；held request 因 shutdown 取消 1 次，app.close 为 231ms，零强杀。见 f2-timing-checkpoints-final-20261101.log、该轮 manifest/vitest 和 test-results/b1/baseline-713b3e06f04d-*.json。
- 完整集成 run-wPsDDo / 69d317b1fdfc：111/111，八个文件全部通过，411.43 秒，scope=full、exitCode=0、interrupted=false、cleaned=true，失败/跳过/TODO 均为零。包含原有 110 项及新增排队回归，没有通过固定专项跳过其他文件。见 f2-timing-integration-final-20261101.log 及该轮 manifest/vitest。
- 完整运行中的延迟队列实际排队约 5139.63ms，领取后 264.45ms 完成，旧 5 秒指标仍明确为 false；双 PID 六任务峰值为 2、两个有效 owner、共十二次合成请求；关闭准备约 117.54ms、app.close 为 232ms，shutdown 取消一次且自然退出。十六份 B1 报告均无实验或清理错误。
- 同一完整运行再次完成真实备份恢复：备份 2202ms、SQL 恢复 2564ms、恢复验证合计 11604ms，十三类检查、Linux 权限专项及数据库清理通过。检查点两条恢复、备份后新增一条缺失、较新撤回重放一次；仍不是生产 RPO/RTO 承诺。
- 最终三个变更测试源码的 SHA256、运行器 87 个来源输入和 76 个构建产物均逐一核对一致，见 f2-timing-source-final-20261101.json 与 f2-timing-hash-verification-20261101.json。原始证据保存在被忽略的 test-results，不提交合成配置或媒体。

本轮完整本地集成门禁通过，验证的是修正后的任务生命周期条件；没有证明先前慢因已唯一定位，或所有旧 3 秒/5 秒延迟目标均能达成。本轮未修改 Web 源码或依赖，未重跑 Web/浏览器/实体设备检查，不继承前轮成绩作为本轮验证。未推送、合并或部署，没有真实 Provider 请求、生产数据或数据处置策略变更。A3 保留期、硬删除、注销及备份销毁仍待所有者决策。
