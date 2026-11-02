# API 成品：进行中任务关停与重启

日期：2026-11-02。接续 `7ba5787` 的镜像验证入口；本轮没有改动应用生成逻辑或依赖锁。使用此前完整构建的同一自有成品 `sha256:80d5376b8bba140643ff3b9f400f05a6a7804de0c228d8ad72e6f087ee1b15bc`，冻结311份Docker输入及6份验证来源，按原build manifest和image ID核对后运行。

## 入口与控制

```powershell
npm run api:image:verify -- --resume-shutdown=37d9722a666947f73b580cc0
```

该受限入口先执行原有18组生产模式合成检查，再在同一个自有internal网络中启动额外的真实API进程和只持有响应的本机HTTP夹具。Provider只接受固定合成key及本轮标记，没有外发能力。API开启真实生成worker，合成chat预算4次，其他付费预算为零；并发1、扫描100ms、关停宽限1000ms，原attempt、lease、数据库与材料任务期限不变。没有宿主端口、实际`.env`、生产数据或真实模型。

发出SIGTERM前再次读取Provider状态，必须仍有1个挂起请求。另从执行prepare/restarted探针之前记录宿主单调时间，停止完成后该完整上界必须小于从镜像内`getAiProviderTimeoutMs('signal-material')`读回的25000ms；起点早于实际fetch，覆盖DNS、连接和发送延迟，防止把自然任务超时记为主动关停取消。Provider接收后的年龄仍单独记录，但不是唯一的期限证据。原18组空闲检查保留10秒默认关停宽限，其成绩与这一合成配置分开。

## 本轮结果

最终 `run-9d8ce16c07dc078710d18a75-KgKZJC`：原18/18及新增4/4，sourceVerified=true、cleaned=true、外层exit0，无失败、清理失败或中断。证据位于该目录的`manifest.json`、`probe.json`、`active-shutdown.json`及两份active日志，外层为`test-results/api-active-shutdown-20261102-final.log`。

317份来源在运行后再次独立读回零漂移。最终完整工具门禁82/82、无失败/取消/跳过/todo、exit0，原预算未变，日志`test-results/api-active-tools-20261102.log`（12.10秒）。

| 检查 | 实际观察 |
| --- | --- |
| 真实受理 | 密码注册后HTTP发射进入持久任务，夹具收到首个材料请求，关停前仍active=1 |
| 首次关停 | SIGTERM约1482ms退出0，非OOM/强杀；从探针开始到停止完成的上界约2625ms，小于25秒；本地连接关闭，任务记为`FAILED / GENERATION_OUTCOME_UNKNOWN`，attempt=1，租约及owner为空 |
| 重启与新工作 | 同一容器自然重启后host PID由20880变21294；复用合成会话，旧失败记录不变，新控制任务受理；旧Provider请求仍仅一次 |
| 第二次关停 | 新控制请求仍挂起时再次SIGTERM，约1495ms退出0；探针到停止上界约2934ms，小于25秒，最终两请求均closed、active=0，两任务各仅一次且没有晚到完成回写 |

此前 `run-7928057058686048f0ed8fe0-6Ti8Ng` 也18+4通过，但只观察从Provider收完整请求后的年龄。复核补充上述更保守的宿主计时上界后完整续验，原通过及其精确范围保留，不将新断言转记到旧运行。

首次 `run-0b42d75bc9369bbdc4a33d98-y8OFB3` 的原18组通过，但新增年龄字段导致夹具初始整对象形状断言失败。现改为精确核对零请求、零关闭、零活动及空请求列表，保留新增年龄观察；原exit1、cleaned=true及失败日志不改写。

该范围验证真实成品内的本地HTTP取消、持久状态和重启，不证明远端供应商物理计算停止、实际计费结果、音频WS成品关停或生产设备表现。旧3.4.9的113项回退完整回归另见[回退故障记录](./rollback-faults-20261102.md)，二者不互相转记。
