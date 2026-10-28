# B1 生成任务配置与运维

状态：本文依据当前本地 B1 实现编写。**尚未取得修复后完整验收通过记录，B1/B2 不在本文中宣布完成或上线。** 下列切换、关闭和恢复流程仍须在隔离环境验证；生产迁移、部署、历史任务处理和收费 Provider 调用分别需要相应授权。

[修复前基线](./b1-b2-generation-baseline.md)记录了六个真实失败场景及原有 30 项通过结果；它是冻结的修复前证据，不能用来证明新 worker 已验收。作者撤回与公开字段按 A3 决定后续实施，C1 的真实撤回入口尚需接入栅栏，管理员隐藏测试不能替代它。

## 1. 当前实现的工作范围

每条新 pending 信号在 `signals` 中保存排队状态。worker 领取后获得本次执行标识（attempt）和有期限的租约；只有仍持有有效标识、租约且业务状态允许的执行才能提交进度或结果。重启后从 PostgreSQL 扫描恢复，不依赖旧进程的 Set。

以下是当前代码事实，正确性仍以修复后测试为准：

- 新创建在同一次 INSERT 写入 `generation_attempt_count=0` 和数据库时间的 nextAttemptAt；不增加 Seed 副本。正常结果为私密 DRAFT，风险结果可为 REVIEWING，worker 不写 PUBLISHED。
- claim 使用同数据库的固定事务级 advisory lock、有效租约计数和 `FOR UPDATE SKIP LOCKED`。生成期间不持有该锁、行锁或事务。
- 进度、派发标记、心跳、完成与失败都检查 attempt / owner / phase / lease / deadline / DRAFT；管理员状态变化原子使旧执行失效。
- 新 pending 链在最终提交前等待坐标和可选 embedding 工作。取消贯通 chat、改写、审查、匹配及 Provider fallback 是本轮验收目标，仍须通过故障测试证明。
- app.ready 后开始消费。worker 关闭、尚未启动、停止中或 fatal 时，新创建返回 503，拒绝静默接收无人处理的任务。纯 mock 单测的 stub 不构成 worker 验证；真实集成入口显式启用同一实现。

源码入口：[配置](../../apps/api/src/config/env.ts)、[worker](../../apps/api/src/modules/signals/generation-worker.ts)、[repository](../../apps/api/src/modules/signals/generation-repository.ts)、[0022 迁移](../../apps/api/src/db/migrations/0022_signal_generation_leases.sql)。

## 2. 配置与并发保证的条件

根 `.env.example`、`apps/api/.env.example`、`deploy/demo.env.example`、`deploy/prod.env.example` 显式列出核心项，其余使用下表中的当前代码默认值。复制模板不代表生产凭据、域名或服务已可用；实际 `.env` 不提交仓库。

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `SIGNAL_GENERATION_WORKER_ENABLED` | development / production 为 `true`，test 为 `false` | 是否消费并接收新的生成任务；集成测试显式启用 |
| `SIGNAL_GENERATION_CONCURRENCY` | `2` | 同一队列的全局有效 lease 容量 C，同时约束本进程工作数 |
| `SIGNAL_GENERATION_SCAN_INTERVAL_MS` | `1000` | 空闲 / 失败后的周期扫描间隔；创建 wake 只作加速 |
| `SIGNAL_GENERATION_LEASE_MS` | `30000` | 单次租约长度，续租不能超过 attempt deadline |
| `SIGNAL_GENERATION_HEARTBEAT_MS` | `5000` | 续租间隔 |
| `SIGNAL_GENERATION_ATTEMPT_TIMEOUT_MS` | `180000` | 整个 attempt 的期限，包含各阶段与内部 fallback |
| `SIGNAL_GENERATION_MAX_ATTEMPTS` | `3` | 领取次数上限；不等于实际 HTTP 请求次数或收费额度 |
| `SIGNAL_GENERATION_RETRY_BASE_MS` | `1000` | 可安全重试时的指数退避起点 |
| `SIGNAL_GENERATION_RETRY_MAX_MS` | `30000` | 退避上限 |
| `SIGNAL_GENERATION_SHUTDOWN_GRACE_MS` | `10000` | 停止领取后，正常排空的宽限 |
| `SIGNAL_GENERATION_DB_STATEMENT_TIMEOUT_MS` | `5000` | worker 专属 PG 池的服务端 statement timeout |
| `SIGNAL_GENERATION_DB_LOCK_TIMEOUT_MS` | `1000` | 同池服务端 lock timeout |

启动还要求 `heartbeat × 2 < lease ≤ attempt timeout`、`retry base ≤ retry max`、`DB lock timeout < DB statement timeout`。无效值会拒绝启动。worker 元数据池每个实例最多 2 个连接，独立于主 API 的 `DB_POOL_MAX`；生成并发数不是 PostgreSQL 连接数。

**全局容量条件**：所有消费者必须连接同一个数据库、使用相同 claim 锁及相同 C，并遵守同一领取协议。当前启动校验只检查本地数值，不查询其他进程的 C。若一台设 2、另一台设 5，锁不会自动把总量限制到 2。启用前逐实例核对代码版本和同一配置产物；调整 C 时先停止旧领取者并排空，再一致更新。降低配置不会立即终止已有工作。

有效 lease 数也不等于远程物理计算的绝对上限。网络分区、进程被强杀或请求取消后，供应商可能继续处理。应分别观察有效 lease、本进程未结束工作、本地受控 HTTP 峰值和未知外发结果；不能将其中一个数解释为实际模型计算数或账单保证。

## 3. 恢复与重试的费用边界

| 持久状态 | 当前处理规则 |
| --- | --- |
| 新纳管 RECEIVED，尚未领取 | 周期扫描可领取，同一 signal 不另建副本 |
| 租约过期，尚无 dispatch 标记 | 有限次数内退避重排；次数耗尽为 FAILED |
| 已有 dispatch 标记，执行 / 返回 / 提交结果未知 | 收敛为 `FAILED / GENERATION_OUTCOME_UNKNOWN`，不自动重发整个生成 |
| 正文已经 COMPLETED，客户端没收到提交确认 | 按 signalId + attemptId 读终态核验；后续管理员隐藏不抹掉已完成事实 |
| 旧 token、管理员状态已改变或租约已失效 | 停止该执行，不再用旧 token 写 FAILED / 结果 |

dispatch 标记在可能收费的 HTTP 前持久化。标记成功后、实际发送前被中断，也可能保守地成为未知结果；这不会被当作“供应商肯定没执行”而自动重发。原有 Provider fallback、分步生成和 embedding 内部重试仍可能产生多次请求，MAX_ATTEMPTS 不能用来估算费用上限。

不通过 SQL 清空 dispatch / attempt 字段来强迫重试。需要再次生成时，先确认该任务是否已经外发、是否已有终态，以及所有者是否接受可能的重复费用；本轮未提供通用人工重试入口或供应商幂等保证。

## 4. 旧 NULL pending 与只读观察

0022 仅追加 nullable 元数据、索引和 CHECK，没有历史 UPDATE / DELETE。`generation_attempt_count IS NULL` 的旧记录保持未纳管，所有新 claim / recovery 均排除它们；迁移不会自动调用 Provider，也不会把旧 pending 变成终态。

上线前由所有者查看必要的旧任务清单，再决定保留待处理、授权安全终态化，或对个别任务授权重新生成及其费用。不能把“新 worker 不领取”写成“历史任务已恢复 / 全库已无 pending”。

以下仅是获准环境中的只读排查示例，本文编写时未执行生产查询；输出不含 Seed、邮箱、Cookie 或模型正文：

```sql
-- 新纳管队列概况
SELECT generation_status, status, count(*) AS row_count,
       min(created_at) AS oldest_created_at
FROM signals
WHERE generation_attempt_count IS NOT NULL
GROUP BY generation_status, status;

-- 旧未纳管 pending，数量保持可见，不自动改写
SELECT generation_status, status, count(*) AS row_count,
       min(created_at) AS oldest_created_at
FROM signals
WHERE generation_attempt_count IS NULL
  AND generation_status IN ('RECEIVED', 'EXPANDING', 'MATCHING', 'WRITING')
GROUP BY generation_status, status;
```

排查日志可按 `signal.generation.dispatch / completed / failed / scan_paused / outcome_unconfirmed / fatal_io` 与 signalId / attemptId 关联。`scan_paused` 是扫描失败后等待恢复，`outcome_unconfirmed` 需要 DB 恢复后核验；不要据此直接补写 FAILED 或再次派发。分享证据时保留案例与清理结果，移除环境文件、凭据、会话和 Provider 请求体。

## 5. 升级、备份与启用顺序

本节是待演练的操作流程，**没有执行生产迁移或部署**。执行前确认操作环境、代码版本、迁移目标、备份位置、旧任务处理范围和回退方案均获授权。

1. 先在隔离环境完成修复后验证，记录真实命令、代码版本、失败 / 跳过和资源清理结果。至少覆盖原 A2 链路、真实 claim、多 worker、四个中断点、管理员 ABA、迟到失败、未知外发不重发、取消和关闭；不能只以 `/health` 200 代替。
2. 阻止旧系统继续接收新的生成请求，等待可确认的旧工作完成；未确认的旧 pending 单独列入清单。停止全部旧 API / 旧调度写入者，确认没有旧二进制继续写库。旧版本不认识新租约，**不能与新 worker 混跑**。
3. 保持 PostgreSQL 可用，备份数据库，并按范围保存配置和图片 / 音频等持久卷。现有 `./scripts/deployment-stack.sh server backup` 只导出 PostgreSQL；其他数据按[服务器迁移说明](../server-migration.md)另存。限制备份访问，检查文件完整性，并在隔离库验证恢复；备份存在不等于恢复已验收。
4. 核对真实 `DATABASE_URL` 和迁移 journal 后，按批准的部署流程执行增量迁移。当前 `scripts/api-entrypoint.sh` 会在 API 启动前执行 `npm run api:migrate`，因此启动新容器本身会触发迁移；不要在备份或审批前试启动生产 API。本文没有运行该命令。
5. 仅启动使用新领取协议的消费者，逐实例核对 C、时间参数和版本；核验迁移、健康、受控新任务终态和旧 NULL 记录未被改写。真实业务或收费 Provider 验收另行授权，不能用一次真实请求作无成本探针。
6. 验收后再开放创建入口；保留前后状态计数、版本和回退记录。出现未知结果先核验租约 / token，不批量重发或清空元数据。

本地 / CI 验证入口为 `npm run check`、`npm run api:integration` 与 `npm run deploy:test`。集成入口使用托管的临时 PostgreSQL / Redis 和本地 HTTP Provider 桩；部署脚本测试验证脚本行为，不能代替真实 Compose 渲染及容器停止时序。另须在隔离环境确认 API 的 `stop_grace_period` 生效、SIGTERM 不被外层提前强杀。这些均为待执行清单，未宣称修复后已通过。

## 6. 关闭与数据库 I/O 故障

当前关闭路径先停止领取及每日调度，在 PostgreSQL 仍可用时排空；宽限到达后 abort 受控 HTTP 并等待真实工作。若数据库 I/O 在独立收尾预算内仍不结束，则真正关闭 owned worker 池，并在应用整体关闭路径关闭主池，再等待真实 Promise 收敛。观察排空期限的 Promise.race 不等于取消，也不能提前释放活跃槽位。

永久 I/O 卡死走 fatal：停止接收 / 领取，触发应用关闭，server 非零退出，待重启后按租约恢复。正常初始 / 短暂 PG 故障可暂停扫描后恢复；不把每次连接错误都当成 fatal。A2 修补的是初始 EOF 重连悬挂，不能据此宣布已连接查询、行锁或网络故障全部解决。

服务端 statement / lock timeout 可限制 PG 执行和等锁；网络断开时仍可能无法确认 commit 是否发生。关闭 socket 后也不能推断提交失败：先按 token 核验，无法核验时留给持久租约收敛，避免迟到写入和重复生成。

当前 server 的总退出预算计算为：

```text
I/O 收尾预算 = DB statement timeout + DB lock timeout + 1000 ms
server 总预算 = shutdown grace + 2 × I/O 收尾预算 + 5000 ms
```

默认配置对应 29000 ms。实际服务器 / demo 共用的根 `compose.yaml` 已为 API 显式设置 `stop_grace_period: 40s`，比默认总预算多出余量；开发依赖栈 `apps/api/compose.yaml` 和测试数据库栈没有 API service，无需添加该项。

如果增大 shutdown grace 或 DB timeout，必须重新计算总预算，并相应调高 API 的 `stop_grace_period` 与任何外部停止命令宽限。40s 是 Compose 配置，不由 API `env_file` 自动联动；需要改 Compose 或使用经过审阅的 override，不能只改环境变量后仍假定 40s 足够。现有部署脚本通过 `UNFREQ_COMPOSE_FILES` 选择 Compose 文件，使用 override 时也须检查实际渲染结果。

若外层提前强杀，剩余工作只能走租约恢复。SIGKILL 和远程 Provider 继续计算的边界仍须通过隔离故障测试分别记录。

## 7. 回退和备份恢复

0022 为 additive schema，旧代码可以继续读取旧业务字段；这不代表旧写入者具备新栅栏。回退前关闭新创建入口、停止新领取并完成排空 / 安全收敛，确认没有活跃 lease 或已接受而无人接手的 managed pending，再启动旧版本。若仍有任务未收敛，先保持维护状态并由所有者决定处置，不能直接降级后宣称无损。

保留执行列、最后 attempt 和终态，不删除 0022 元数据或把 managed 记录批量改回 NULL。旧版本没有新队列恢复器；仅更换二进制不能修复尚在排队的任务，也不能证明曾外发的请求未收费。

恢复整库备份是独立操作，可能覆盖备份之后已接受的数据。先停止所有写入者、备份当前状态，并确认需要保留的新任务 / 结果及目标库，再按获批恢复方案执行。不能用自动恢复旧备份代替应用回退；具体保留期、硬删除和备份销毁不在本轮决定。

后续验收报告应分别给出：新纳管任务是否收敛、历史 NULL 待处理数量、C 的配置一致性、未知外发数量、真正退出 / 资源清理结果，以及 C1 仍待补的作者撤回回归。
