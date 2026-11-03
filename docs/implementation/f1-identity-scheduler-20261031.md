# F1：身份镜像一致性与每日调度

日期：2026-10-31。基线 `ca6b79d`，本地分支 `codex/f1-identity-scheduler`。对应 R17/R18。本轮处理注册/凭证、后台权限镜像和每日系统 AI 调度；没有合表、删除历史身份、生产迁移、部署或收费调用。

## 身份权威源与事务

users 是认证与权限的权威源，frequencies 是同 UUID 的频率镜像。原先 createUser、createGuestUser、createPasswordFrequencyUser 和 updateUserFrequencyCredentials 先提交 users，再独立写 frequencies，第二次写入失败会留下半份身份。现两次写入在同一事务中完成；邮箱冲突时在事务中锁定实际 users 行，再复制当前状态，避免旧快照覆盖并发的凭证或权限变更。

共享的 syncFrequencyMirror 使用 PostgreSQL INSERT SELECT 复制镜像字段。createdAt/updatedAt 不经过 JavaScript Date 往返，保留数据库微秒精度。后台两个状态入口和管理员提升也统一先写或锁 users，再同步镜像；第二写失败会回滚。后台频率状态操作遇到没有 users 的历史孤立频率时返回未找到，不反向创建账号或单独激活镜像。

原“标记回响已读”还会单独修改 frequencies.updatedAt，造成正常活动后的镜像漂移。现该入口只推进 lastSeenAt，保留两表账号更新时间及其精度。凭证更新保留频率侧的 lastSeenAt/deviceHash，不把它们覆盖为账号数据。

| 字段 | 归属和规则 |
| --- | --- |
| id、freqCode/code | 同一身份的 UUID 与 FM 代码 |
| frequencyName、passwordHash、isGuest、role、status | 从 users 同步到 frequencies |
| createdAt、updatedAt | 原数据库精度同步 |
| email、emotionProfile | 只属于 users |
| lastSeenAt、deviceHash | 只属于 frequencies，不属于镜像差异 |

## 只读审计

```powershell
npm run api:build
npm --workspace @unfreq/api run identity:audit -- --help
npm --workspace @unfreq/api run identity:audit -- --limit 50
```

查询使用当前命令环境的数据库配置；本轮验证只连接运行器新建的隔离库。命令输出 users/frequencies 总数、完全一致、缺镜像、孤立镜像、字段不同的计数，以及最多 1–200 条 UUID/差异字段名。limit 限制样本数量，全量计数仍会扫描相应表。计数与样本来自同一条 SQL 的一致快照，不输出邮箱、密码散列、设备信息或差异字段值。错误信息固定，不回显数据库错误内容。

退出码 0 表示未发现差异，2 表示发现差异，1 表示参数或执行失败。命令没有修复功能。历史孤立频率可能来自旧身份或系统内容，历史 updatedAt 差异也可能来自旧版已读活动写入，需结合来源判断；不能把审计清单直接当作删除、合并或权限回填授权。

## 每日调度与预算

原调度按每个进程的本地 03:00 和固定 24 小时计时，没有跨实例领取记录。现在使用 0026 新增的 ai_signal_scheduler_batches，以 job_key + business_date 唯一索引领取当天一次批次，任何 Provider 外发前先持久提交 RUNNING 和 owner token。不同进程竞争同一天时，只有取得批次的一方执行。

| 环境变量 | 默认值 | 含义 |
| --- | --- | --- |
| AI_SIGNAL_SCHEDULER_ENABLED | false | 显式启用；更改后重启实例 |
| AI_SIGNAL_SCHEDULER_TIME_ZONE | Asia/Shanghai | IANA 业务时区；所有实例应一致 |
| AI_SIGNAL_SCHEDULER_TIME | 03:00 | 业务时区当天触发时刻 |
| AI_SIGNAL_SCHEDULER_COUNT | 1 | 本批次计划生成数量，1–10 |
| AI_SIGNAL_SCHEDULER_DAILY_SIGNAL_BUDGET | 1 | 当天批次的数量预算，1–10，COUNT 不得超过它 |
| AI_SIGNAL_SCHEDULER_DAILY_DISPATCH_BUDGET | 30 | chat/embedding/reranker 的派发预留上限，1–500，含重试 |
| AI_SIGNAL_SCHEDULER_POLL_INTERVAL_MS | 60000 | 检查当天是否到时；不使用固定 24 小时轮转 |
| AI_SIGNAL_SCHEDULER_BATCH_TIMEOUT_MS | 180000 | 整批截止时间 |
| AI_SIGNAL_SCHEDULER_SHUTDOWN_GRACE_MS | 10000 | 取消后等待实际工作结束的宽限期 |

启用后若已过当天触发时间，会补当天一次，不补过去日期。业务日期同时用于 persona 选择，不再由每台机器的本地日期决定。数量与预算在领取时固化，运行中的配置变更不会追加当天批次。

每次派发先检查 owner、RUNNING 与数据库截止时间，再通过原子更新预留预算。该计数是保守的派发预留，不等于远端收到的请求数或账单；本地取消、网络失败或站点预算拒绝可能已消耗预留。现有 Redis 站点 Provider 预算继续约束这些请求。后台人工触发生成仍是独立的显式操作，不受这张自动日批次账本替代或授权。

终态为 COMPLETED、FAILED 或 CANCELLED，记录进度、结果 ID 与固定失败代码。COMPLETED 在 SQL 条件中再次核对数据库截止时间；过期后仍可记录失败或取消。生成尝试与结果进度在阶段完成后刷入，进程死亡或阶段异常时可能不完整，不能将零进度解释为没有调用或没有产生部分副作用。

当天的 RUNNING（包括进程死亡后未知结果）、FAILED 和 CANCELLED 都不自动重放，即使可能尚未外发也不重新领取。它优先避免重复费用，可能少生成；需要人工核对账本、实际 AI 审计与结果记录。不能通过删除账本行来“重试”。新的一天按新的业务日期领取，所有实例需共享数据库、时区和预算配置。

## 关闭与健康检查

scheduler 在 app.onReady 启动；preClose 同时停止 scheduler、生成 worker 和音频 worker，再关闭 Redis 与应用数据库。调度停止新领取，传播 AbortSignal，等待真实生成和同步 embedding 收尾。超过宽限期会关闭受控 SQL 连接与应用数据库连接；仍未排空则报错并要求进程恢复，不把观察超时当作已经取消。

全局进程 watchdog 以生成 worker 预算为基础，并覆盖已启用 scheduler 的更长关闭宽限期。默认配置与 Compose 的 40 秒 stop_grace_period 相容；提高关闭/数据库预算时需同步提高部署宽限期。远端物理计算是否停止仍由 Provider 决定，本地取消不等于免单。

/health 已是存活检查，/health/deep 已区分 PG/Redis 就绪；Compose API 探针使用 /health，部署 smoke 同时查两者。本轮保留该行为，隔离套件继续验证依赖断连时存活 200、深健康 503。

## 迁移、切换与回退

0026 只新增批次表、唯一索引和预算/状态检查，不改旧身份或信号数据。升级需先在获批环境应用迁移，再统一升级所有写入实例，最后按实际费用额度选择是否启用。混用旧进程会绕过新调度账本与开关，不能据此承诺多副本防重。

回退先停调度并等待进程排空，保留 0026 表和已领取记录，不删表或清空当天账本。F1 前的旧版本没有新开关且默认自动调度；仅设置 AI_SIGNAL_SCHEDULER_ENABLED=false 无法关闭旧版本的入口。运行旧代码前需在受控回退方案中关闭旧自动入口，不能直接恢复多副本旧调度。

## 验证记录

- 完整检查 `npm run check` 在 `test-results/f1-check-second.log` 通过：运行器 14/14、API 701/701、Web 136/136，lint、类型检查及两端构建通过。补活动水位修正后，最终 `npm run api:check` 再次通过同样 701 项及运行器、lint、类型和构建，见 `test-results/f1-api-final-check.log`。Web 源码未修改，没有把旧 API 的成绩当作新 API 的验收。
- 身份专项 22/22，见 `test-results/f1-identity-targeted.log`。scheduler、现有 service 与 env 首轮 60/60，追加强制排空边界后 scheduler 12/12，见 `test-results/f1-scheduler-targeted.log`、`f1-scheduler-final.log`。全局退出预算的三项回归已并入最终 API 单测。
- 原有开发浏览器 6/6，见 `test-results/f1-browser-development.log`；只使用合成 API，不能证明真实双表事务。还原 Next dev 自动修改的类型导入与重复目录。本轮未重跑生产构建浏览器套件，没有沿用 E4 的 27 项结果冒充 F1 验收。
- 部署脚本替身回归通过，见 `test-results/f1-deployment-scripts.log`；没有实际部署。审计 CLI 的 help 及非法 limit 拒绝通过，见 `test-results/f1-identity-cli.log`，这两条命令不访问数据库；有效审计查询由真实 SQL 集成覆盖。
- 首轮统一检查停在运行器自测 10/14：新加第三个 scheduler 入口后，校验函数仍把入口数固定为 2。已改为严格核对已知入口集合大小和每个路径，并补第三个真实 PID 验证及额外/错配入口拒绝；第二轮 14/14。首轮日志 `test-results/f1-check.log` 保留，没有放宽来源或源码哈希保护。
- 首轮隔离 `run-ilAPai`，runId `e842836a3c53`：101/105，退出码 1，cleaned=true，773.36 秒。三个身份夹具的 FM 代号超过 users.freq_code 的 8 字符限制，尚未进入目标断言；另一个既有 generation-checkpoints retry 用例在原 5 秒完成观察时仍为 MATCHING。没有将整轮变慢直接归因为环境或模型。见 `test-results/f1-integration.log` 和该轮 manifest/vitest。
- 修正夹具后隔离 `run-o5sBFI`，runId `c78893b81d0d`：105/105、退出码 0、cleaned=true，453.86 秒，见 `test-results/f1-integration-second.log`。夹具从数据库实际未占用的标准 FM NN.NN 中取值，所有预期失败逐层核对触发器原因，防止其他约束错误造成假通过；补齐前置失败清理与审计截断检查。既有 retry 观察仍使用 5 秒，没有改生产匹配/用户生成路径或放宽超时。
- 第二轮通过后，扫描其余身份写入发现上述活动水位漂移，补修并新增真实 POST/GET 已读接口回归。第三轮 `run-Crqh2z`、runId `b5a997820620` 为 105/106，退出码 1、cleaned=true，511.65 秒：SQL 已确认时间戳保留、水位推进及两次 HTTP 200，测试最后将裸 SQL 驱动返回的时间字符串当作 Date 调用 toISOString，属于新夹具类型错误。见 `test-results/f1-integration-final.log`。已改为数据库 epoch 毫秒文本与接口 ISO 时间的统一数值比较，保留有限值检查；lint/类型检查再次通过，见 `test-results/f1-time-fixture-check.log`。
- 最终完整隔离 `run-hebWFa`，runId `e0112e08e3d7`：106/106，7 个文件全部通过，无失败、待执行或 TODO，退出码 0、cleaned=true，423.31 秒。身份回滚、审计及活动水位用例所在 core-flow 为 42/42；每日抢占、业务日期、进程死亡不重放、取消排空、真实 SQL 失败、派发预算与 owner/截止栅栏为 7/7。见 `test-results/f1-integration-verified.log` 和该轮 manifest/vitest；此前轮次不替代这个最终结果。

四轮隔离均新建 PG/Redis，使用回环合成 Provider，退出后清理其随机项目。各轮源码指纹分别保存在 `test-results/f1-source-first-20261031.json`、`f1-source-second-20261031.json`、`f1-source-third-20261031.json`；最终代码/测试的 37 个变更文件指纹为 `test-results/f1-source-20261031.json`，收尾时已与当前文件逐一核对。最终运行器清单中的所有源码和编译产物指纹也已重新核对；入口哈希只代表该入口文件，不代替整份清单。原始日志和子进程证据仅放在被忽略的 test-results，未提交真实账号数据或模型输出。

没有依赖变更，复用已有安装与锁文件，未重新执行 npm ci。没有真实模型质量、远端费用、生产镜像/配置、实体手机或读屏器验收结论。

## 剩余范围

没有修复或删除历史差异，没有执行生产迁移或启用生产自动生成。迁移后的目标环境配置、Provider 配额与账单仍需实际发布流程确认。E3/E4 的模型质量、人评和作者认可仍按各自记录待验收；F1 的合成 Provider 只验证调用控制、权限与持久性。

本轮代码、回归与记录保存为独立本地提交，尚未推送、合并或部署。后续 F2 的恢复与副本验证可先使用合成数据推进；保留期、硬删除、注销和备份销毁仍需遵守 A3 的待决边界。
