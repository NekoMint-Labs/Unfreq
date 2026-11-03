# F2：合成恢复、副本追踪与日志

开始日期：2026-10-31，收尾日期：2026-11-01。基线 `aa05e64`，本地分支 `codex/f2-backup-replicas-logs`，对应 R19。仅使用运行器新建的 PG/Redis、合成账号、文本、配置和媒体；没有读取生产数据、真实 `.env` 或第三方协议，没有生产操作或收费调用。

本记录保留截至 `9c17074` 的实施与失败历史；后续任务观察复核、门禁口径修正及当前成绩见 [2026-11-01 补充记录](./f2-generation-observation-20261101.md)。

## 备份与恢复

原脚本使用固定临时文件，产生中间明文，并可能覆盖已有备份。恢复通过 gzip 管道交给未启用 ON_ERROR_STOP 的 psql，上游解压失败或 SQL 中途错误可能漏报。现备份在目标目录创建唯一私有临时目录，显式限制目录 700、文件 600；完整 dump/压缩成功后，以同文件系统硬链接原子发布，已有目标拒绝覆盖。退出清理本次临时文件，控制台只报告固定错误，不回显可能含正文的 SQL 错误。gzip 不提供加密。

恢复先完整解压，再用 psql `-X -v ON_ERROR_STOP=1 --single-transaction --file=-` 执行。输入只应是已核验的可信系统 dump；任意包含 COMMIT 或 psql 元命令的 SQL 不受完整回滚承诺。事务第一条 SQL 拒绝已有用户 schema、关系、函数、类型或非默认扩展的目标，不覆盖已有库。要求显式 `UNFREQ_RESTORE_ISOLATED=true`；它只是操作者的隔离声明，不能探测网络、反代或其他写入者。脚本不重写公开状态，也不开放服务。可处理的正常退出会清理临时文件；SIGKILL、断电等仍可能留下私有明文，需受控核对，不代表安全擦除。

`UNFREQ_PG_USER` / `UNFREQ_PG_DATABASE` 默认仍为 postgres / unfreq，覆盖值只允许最长 63 字符的简单 SQL 标识符。备份支持 `.sql` / `.sql.gz`，不包含媒体卷、Redis 持久化、容器镜像或 `.env`。原 PROVIDER_CONFIG_SECRET 必须单独保管，否则无法解密数据库中的 Provider Key。

## 合成演练与测值口径

`npm run api:integration` 的 F2 用例只使用托管运行器随机项目、非默认回环端口及两个新建随机库，不接受外部地址。

需要单独复跑时用 `npm run api:recovery:verify`：固定选择备份恢复与核心权限/副本链路两个文件，沿用同一新建资源/来源校验/清理机制，不接收任意测试路径或外部地址。默认完整集成仍包含全部八个文件。原有九项任务重启检查可用固定参数 `node scripts/run-api-integration.mjs --generation-checkpoints` 独立诊断，不能据此跳过默认完整集成门禁。

备份演练按以下步骤执行：

1. 真实迁移后写入两条合成表达、身份镜像、1024 维向量、合成发布快照、媒体记录及加密 Provider 配置。
2. 用实际部署脚本执行 pg_dump/gzip，单独 tar 归档媒体、复制合成配置并记录 SHA256；重复备份同路径应拒绝且原字节不变。
3. 在自有 Linux PG 容器执行同一脚本，检查临时目录 700、临时文件及最终备份 600，复核清理。权限专项以白名单 wrapper 将 Compose 传输替换为容器内真实 pg_dump；主链路仍使用真实 Compose exec。
4. 备份后新增一条合成记录，并撤回一条已备份的公开表达；较新状态单独保存，模拟旧快照缺失的最新依据。
5. 损坏 gzip 必须零写入；有效建表后接错误的 SQL 必须整次回滚；成功恢复后，用 SELECT-only 输入证明非空保护先行，避免把重复建表报错误认为保护生效。
6. 保持应用未启动，核对文件/配置字节、pgvector 扩展及向量查询，再重放已知较新的撤回版本。缺少最新依据时，不得直接开放旧 PUBLISHED 状态。
7. 在隔离目标启动关闭 worker/scheduler 的真实 API，验证深健康、密码登录、私密历史和原文、公开白名单、撤回后 404、媒体字节和原密钥解密；HTTP 边界拒绝全部 Provider 外发。

报告记录备份、SQL 恢复及从故障检查开始至 API 验证结束的耗时。RPO（可恢复到哪个时间点）报告实际检查点：备份前两条记录恢复、备份后新增一条缺失、较新撤回由单独依据重放。没有导出 pg_dump 的精确内部快照时刻，只记录备份开始/结束和较新写入时间，不编造精确 RPO 或生产 SLA。RTO（恢复服务耗时）只代表本机合成演练，包含失败检查和手工步骤的脚本化执行。

媒体验证只证明 API 可读相同字节。音频为合成 ID3 夹具，不代表音质或解码验收。Redis 是新实例，未演练旧 AOF 恢复。SQL 与媒体不是原子联合快照，实际迁移需冻结相关写入并记录同一检查点。Windows Git Bash 的 NTFS noacl 不能验证 POSIX 权限，因此权限结论必须来自 Linux 专项。

## 表达副本清单

```powershell
npm run api:build
npm --workspace @unfreq/api run replicas:audit -- --help
npm --workspace @unfreq/api run replicas:audit -- <signal UUID> --limit 50
```

命令连接当前环境配置的数据库。help/非法参数先于配置与数据库导入；退出码 0 为清单生成、2 为信号不存在、1 为参数或执行失败。工具只读、不修复或删除，输出 UUID、状态、版本、布尔值、计数和有限 ID 样本，不输出正文、摘要、散列、密钥、媒体 key 或路径。

| 对象 | 可证关联与保留边界 |
| --- | --- |
| signals | 原文、扩写、指纹、program、发布快照和向量在原行；只报告存在性和公开资格 |
| 其他表达 | matchSignalId、非空右侧摘要和 parentSignalId 分别计数；parent 是独立创作，不构成删除授权 |
| AI 审计 | SIGNAL target 与 operation.signalId 分别计数，同一审计可同时计入，不将引用数当成独立副本数 |
| 互动与治理 | 收藏、共振、回声、举报、后台操作按显式 ID 关联；撤回不物理清理 |
| 私密月报 | 只证明 topSignalId 引用，无法找齐非 top 输入或重建历史摘要血缘 |
| 每日批次 | 结果 ID 数组可关联批次；落行前的调用只关联批次，不能逐条归给结果信号 |
| 音频 | 三路关联安全文件名的元数据，报告存在/缺失/不安全/无法验证/未引用；不遍历目录、不读内容或跟随符号链接 |
| 图片、日志、备份、Redis、客户端和第三方 | 不能由单个 signalId 完整查明，须单独盘点，不能推定清除完成 |

数据库计数与样本来自同一条 SQL 快照，媒体检查在其后，不承诺跨存储原子性。无 target/operation 的旧审计只给全局数量，不归给该表达。program 摘要没有复制时的公开版本，独立图片没有 signalId，不以文本相似性猜血缘。

用户 worker 的可信上下文新增 schemaVersion/signalId/attemptId；审计保存 execution_json.operation，无显式 target 时自动关联 SIGNAL。系统生成在落行前使用 batchId/owner attempt。不新增表或迁移、不回填历史、不改变后台审计正文权限或保留规则。

## 日志和 GET 成本

Redis/启动、Embedding/TTS、管理和回填脚本统一记录固定错误类型或应用错误码，不反射原始 message、stack 或自定义 name。脱敏覆盖凭据、整个请求 body、Seed/扩写字段、prompt/messages 和原始 err/error；不能据此认为任意散文都能被正则识别，新增日志仍须采用允许字段。

登录验证码和邮箱不再写日志。local-log 是保留的非生产兼容配置名，不再表示日志投递；开发环境使用已有显式 code response。测试改用仅 test 环境生效的内存回调。生产仍拒绝本地投递和 code response，正式邮件传输未接入。前端诊断原来只记 HMAC、长度和枚举，本轮补完整合成 Seed/密码/验证码的真实日志回归。

五个 Compose 服务增加 json-file 轮转容量配置，默认 UNFREQ_LOG_MAX_SIZE=10m、UNFREQ_LOG_MAX_FILES=3；不代表保留天数。当前未操作运行中的容器或日志；实际重建可能随旧容器移除其日志，部署前需按批准规则保管所需记录并核对外部收集器。本轮只验证配置解析，没有用生产日志验证轮转或选择隐私保留期。历史清理和备份销毁仍未批准。

星图 GET 仅计算确定性缺失位置，不排队写库。公开/作者详情及 matches GET 仅读取有效存量向量或规则候选，不派发 Embedding/Reranker、不写审计或回填。新增 read_only 分数理由，保留原门槛，缺少向量时可能更少或空匹配。生成和显式后台回填仍使用原权限和站点预算。

既有 E3 合成材料中 older-rule-only 在显式生成的重排阶段仍能过门槛，但公开 GET 的规则分低于 80，现在应为空。对应回归单独断言这个空结果，并断言全部 GET 验证零外发；没有降低门槛或把显式生成的合成评测当作只读页面质量证据。

恢复演练进一步发现合法快照可以没有频段/标签；原规则候选查询的缺省排序写成裸整数 0，被 PostgreSQL 当作无效列序号，详情返回 500。现改为 `0::integer` 表达式，不改变评分公式；合成恢复使用无频段、空标签的确认快照，验证这两个缺省路径。

## 验证记录

- 审计关联/副本专项 60/60，日志/GET 专项修正夹具后 172/172；新增日志 fixture 调整为 beforeAll 准备后 6/6。原用例业务超时未提高，旧用例未批量修改。原始日志分别为 f2-logging-get-targeted.log、f2-logging-get-verified.log、f2-logger-fixtures-verified.log 等，均在 test-results。
- 部署脚本最终 11 组替身回归通过，见 test-results/f2-deployment-scripts-final.log；NTFS noacl 不做 POSIX 权限结论。真实 Compose 配置解析确认五个服务均为 json-file / 10m / 3，见 f2-compose-logging.json，没有启动生产服务。
- 前置检查先后发现新恢复夹具使用不存在的 Provider getter、finally 内抛错及动态 stdio 的可空类型问题，均已修正。第一次 check 停在 lint，第二次停在类型检查；原始 f2-typecheck-first.log、f2-check.log、f2-check-second.log 保留，不记为通过。
- 首轮完整隔离 run-bi89v9 / a01471407c06：107/110，8 个文件中 2 个失败，704.18 秒，exitCode=1、cleaned=true。两处新增 SQL 夹具直接传 JSON 对象编码失败，改为明确的序列化文本 ::jsonb；另一处 E3 GET 断言仍期待付费重排，改为上述明确的只读空结果与零外发约束，显式生成评测没有降低门槛。日志 f2-integration.log 及该轮 manifest/vitest 保留。
- 后一轮并行运行完整 check、单独 Web check 与隔离测试，出现多个原有/新增测试准备超时；没有据此认定生产逻辑失败或直接归因环境。该 check 与 Web 构建主动中止，隔离 run-ytGTsQ / b319f229e2cb 的 core hook 使 45 项未执行，恢复进程也超时失败，未产生完整成绩。中止后核对随机项目标签并手动清理，另存该轮 interruption-cleanup.json；未将它伪装为 runner 正常完成。相关 f2-check-final.log、f2-web-check.log、f2-integration-second.log 保留。
- 复核发现空库检查的 pg_% 把下划线当通配符，可能漏过 pgcustom 用户 schema；已精确限制系统 pg_ 前缀，真实恢复专项证明仅有该 schema 时 SELECT-only 输入仍被拒绝。
- 串行完整隔离 run-05lHMQ / 3f610ff6368e：107/110，808.89 秒，exitCode=1、cleaned=true。core-flow 45/45；恢复夹具随后 raw SQL 传 Date 失败。已核实安装的 Drizzle 驱动构造器将同一迁移客户端的时间/JSON 序列化改为透传，裸 SQL 因而改用 ISO 文本 ::timestamptz 和文本 ::jsonb，不改驱动。另两项原有任务重启在 5 秒观察终点仍为 MATCHING，真实 attempt 尚余约 4.9/5.7 秒，不记为通过。见 f2-integration-serial.log。
- 随后的窄化诊断 run-FtTJXv / 65fa775bfe6b 为 7/10，133.87 秒，cleaned=true：前述两个重启场景通过，capacity/close 准备观察失败，恢复夹具误把密码登录请求发到邮箱验证码端点。改为 /api/auth/frequency/login。后续 run-mlCsup、run-CdQEl5、run-hC3ZJS 的恢复单项均未通过且已清理：登录/历史读取已过，详情 500；补完整 program 夹具后仍可复现，固定类型/字段路径/栈位置诊断最终定位上述真实 ORDER BY 0 缺陷，没有用更换标签绕过。
- 修复后 run-qzQtfn / 8d255fa7d482 的恢复单项 1/1，17.47 秒，exitCode=0、cleaned=true。实际备份 1838ms、SQL 恢复 1916ms、从故障检查至 API 验证结束 11732ms；两条检查点表达恢复、备份后新增一条缺失、较新撤回版本重放，所有十三类检查通过，Linux 权限 700/600 且已清理。见 f2-backup-restore-edge-verified.log 及该轮 f2-recovery/recovery-report.json。这个单项不是整个 110 项全绿。
- 查询修复后的最终 `npm run check` 在 f2-check-verified.log 通过：运行器 15/15、API 732/732（64 文件）、Web 138/138（19 文件），lint、类型与两端构建通过。补强原文恢复断言后类型检查再次通过，见 f2-typecheck-verified.log。编译后的副本 CLI help/非法 UUID/非法 limit 在故意无效的数据库环境下按预期退出，见 f2-replicas-cli.log。既有 Edge Runtime 弃用提示保留，没有在 F2 迁移 OG 运行时。
- 最终 F2 范围 run-c5Ikne / 35ffb14b4521：46/46，两个文件全部执行且无失败/待执行/TODO，78.58 秒，scope=f2-recovery、exitCode=0、cleaned=true。core-flow 为 45/45，恢复为 1/1。最终实测备份 4339ms、SQL 恢复 3117ms、恢复检查合计 13654ms；RPO 检查点、十三类检查、Linux 700/600 和媒体/配置/向量/API 均通过。见 f2-scoped-final.log 及该轮 manifest/vitest/f2-recovery/recovery-report.json。最终 51 个变更源码/测试、运行器 87 个输入和 76 个产物哈希均已与当前文件逐一核对。这个范围成绩不替代 110 项完整集成。

没有依赖变更，复用已有安装与锁文件，未重跑 npm ci。Web 仅扩展分数来源枚举和对应校验，未重跑开发/生产浏览器、实体手机或读屏器；不沿用旧轮次浏览器成绩。最终源码清单保存在 test-results/f2-source-final-20261101.json；前几轮 source-first/source-second/source-third/source-fourth/source-fifth 清单保留，各运行器还各自保存源码/编译产物哈希。原始证据只放被忽略的 test-results，不提交合成密钥或媒体产物。

## 尚未清零的任务观察门禁

在该提交时，未放宽原有 3 秒 Provider checkpoint 或 5 秒完成观察窗，也未改本轮集成夹具的 10 秒 attempt 截止；生产默认 attempt 为 180 秒。第四轮 capacity 是 C=2 同时处理六条，前四条已完成，最后两条在 MATCHING 且各剩约 7.7/7.9 秒真实执行预算；close 在 accepted 后 3010ms 未到 Provider gate 即强杀，尚未调用 app.close。它们不能证明业务截止已违反或排空失败，也不能据此推定随后必定成功。只读源码核对未发现 F2 增加生成路径外发或 SQL 次数；新审计沿用原单次 INSERT。

完整集成因此仍有未澄清的时序门禁，不将最终 F2 范围成绩写成完整套件通过。后续应先补 checkpoint 的固定时序诊断，分清入队、派发和完成的观察条件；不能仅提高常数凑通过。

## 剩余边界

未实施过期清理、硬删除、注销、备份销毁或未知副本的自动修复，仍遵守 A3 待决规则。Provider 可能在确认公开前接收任务文本；实际名称、地域、保留时间、训练用途和删除机制需按生产配置与协议核实，不能宣称合规验收。

API 新增 read_only 理由需与 Web 校验同步升级，或先部署兼容 Web。恢复脚本现在拒绝非空库和未声明隔离的调用，须使用更新运维步骤。没有生产迁移、部署、推送或合并。

本轮实现、回归与记录保存为独立本地提交。后续先澄清上述任务观察门禁；F3 能力登记和 F4 依赖评估仍是独立范围，不把本轮本地工程结果当作整个 F2 或生产合规验收完成。
