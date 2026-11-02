# 生产迁移器与开发工具依赖边界

日期：2026-11-02。基线 `f906bd1`，分支 `codex/api-runtime-migrations-20261102`，与[PR #9](https://github.com/NekoMint-Labs/Unfreq/pull/9)的镜像/回退工作分开交付。没有改写已有SQL、迁移journal、业务schema或生产数据库。

## 改动与依据

API的生产迁移命令改为编译后的 `dist/scripts/migrate.js`，复用已安装 `drizzle-orm@0.45.2` 的postgres-js migrator；`drizzle-kit`保留在开发依赖，继续承担generate。Docker runner保留dist和原SQL目录，去掉不再使用的 `drizzle.config.ts`。本地先 `npm run api:build` 再 `npm run api:migrate`；根命令转发 `--` 后参数，`--help`不加载dotenv或连接数据库。

新脚本使用原DATABASE_URL fallback、SQL目录及 `drizzle.__drizzle_migrations` 账本，连接 `infer:true,max:1`，保留prepare默认值。明确拒绝空或纯空白的DATABASE_URL，防止postgres把空串解释为PGHOST/PGDATABASE环境默认连接；未设置该变量时仍保留原fallback。正常迁移及有界close都成功后才输出成功；失败固定stderr并exit1。`onnotice:false`抑制驱动直接输出原始数据库NOTICE，不加载无关API/Provider配置。

当前kit的postgres分支原本就导入同版ORM migrator。官方[迁移说明](https://orm.drizzle.team/docs/drizzle-kit-migrate)也说明按SQL目录和既有账本选择并执行迁移。该替换保持现有事务及账本语义，不新增跨进程迁移锁，也不宣称校验历史已应用SQL的checksum。

锁从 `cdf351ca90d8d3325c349c16abefa71e35327d8aabd07a78ec3dfab16b64b3b4` 变为 `88d968f7510c2feb3d86f992cd16b52295da0b161f914202291b0fff29c8501b`。结构差异仅API一条依赖分类和88条工具链/平台记录的dev标记；版本、resolved、SRI和依赖范围均未变化。正常npm11 lock-only解析会删除此前已修复的Vite近层esbuild及26平台记录，本轮保留原始输出，仅恢复这27条完全相同记录，没有override或新版本。证据为 `test-results/dependency-followup-20261102/runtime-lock-normalization.json`。

## 告警范围

改动前本轮独立完整审计仍20条moderate：16条dev-only、4条正式依赖树。两条直接advisory为[旧esbuild开发服务问题](https://github.com/advisories/GHSA-67mh-4wv8-2f99)和[minimatch模式放大问题](https://github.com/advisories/GHSA-g3hv-75wg-m249)。官方父包兼容范围没有同时移除这些链，本轮不采用跨主、降级或强制override。

候选完整官方audit仍20条moderate，全部dev-only；`--omit=dev`为0条、exit0。它表示正常生产依赖图裁剪了旧工具链，不表示全仓告警清零、应用漏洞利用验证或最终镜像已确认不含这些包。五份审计输入、独立请求和原始报告在 `test-results/dependency-followup-20261102/candidate-audit-{full,production}/`；最终成品安装与检查另记。

根命令参数转发完成后，又冻结当前最终五输入重新执行官方full/omitdev audit，仍分别为20条全部dev-only（exit1）和0条（exit0），报告完整且输入无漂移，不以候选原始JSON代替。`test-results/runtime-migration-final-20261102/final-summary.json` 为passed=true，SHA256 `4736a99708e361e85d4af3e6084d553de620bae92dac9b01e81a49d89315d5a1`。

## 已执行验证

| 范围 | 实际结果与证据 |
| --- | --- |
| 新旧迁移器真实兼容 | 临时旧API成品及真实PG的 `run-b94c6659a5e4327087ada308-5X8A8h`：5/5；KIT→runner、runner→KIT均保持27项账本，已应用账本并发no-op、故障DDL/数据/账本全回滚、不可达DB固定错误通过；外层exit0、sourceVerified/rootSqlUnchanged/cleaned=true，独立资源读回为空 |
| 正常安装 | `npm ci --no-audit --no-fund --prefer-offline`安装543包，postgres4 postinstall applied2/verified2；未忽略安装脚本，锁未变，日志 `runtime-migration-npm-ci-20261102.log` |
| 实际Windows树与原生加载 | 初树7条WASM多余记录保留，核对6目录116文件后完整保留移出；最终全树无问题，driver哈希/幂等0/2、原生ESM/CJS/Drizzle及11组原生操作通过。摘要 `runtime-migration-install-20261102/summary.json` SHA256 `43169867e84c74836a5992fce731e0b9dfefbd503c67dd47018cbc33822c1966` |
| 完整本地check | 工具84/84、API767/767、Web192/192，两端lint/类型/构建通过，exit0，日志 `runtime-migration-check-20261102.log` |
| 根命令帮助 | `npm run api:migrate -- --help`实际调用编译CLI显示帮助，未连接DB；日志 `runtime-migration-help-20261102.log` |
| 开发generate | 自有三字段配置、空dotenv、清除DB/Provider环境，在独立目录实际生成21表SQL（32682字节），SHA256 `a166434616d599d56090d463e90fbceaaa3d48b4f1148bce5707f497f2897d77`；原27 SQL+journal、schema和最终依赖输入均未变，证据同上final目录 |

安装读回在其9项输入前后不变的窗口独立执行；随后根命令参数转发与CLI空URL保护在源码层补齐，依赖声明和锁未变，由最终API检查及真实CLI回归覆盖，不将安装时的源码字节断言延伸到后续改动。候选首次真实PG检查因驱动NOTICE使固定输出断言失败，原exit1/cleaned=true保留；加入明确的NOTICE处理后重编译并重跑全部5组，未泛化吞掉任意stderr。

## 持续集成与最终成品

新增第9个真实集成文件 `migration-cli.test.ts`，4组覆盖本轮实际编译CLI的空库27迁移/幂等、追加私有迁移后的DDL/数据/账本整体回滚、不可达数据库的固定错误，以及空/空白URL不得迁移到受控PG环境默认库。回滚检查使用非事务sequence推进到2，证明两份故障前SQL确已执行；空URL用例先证明自有目标库可达，再确认失败后仍没有ledger或业务表。原8文件及预算不改。

runtime显式冻结27份SQL和journal，复制后逐字节核对并将CLI、测试与payload纳入来源/产物清单；未登记SQL或两侧篡改均拒绝。轻量guard9/9通过，32KB marker上限不变。

最终API检查仍为84工具、767单测及lint/类型/构建全部通过；最终完整集成 `run-Yjpd5T / 2ca2b1c981e0` 为9文件139/139，失败/待执行/todo均为0，外层exit0、cleaned=true。四个迁移CLI用例全部实际执行，原8文件及预算保持；来源/产物保护现覆盖136份输入、112份产物。证据为 `runtime-migration-api-check-final-20261102.log`、`runtime-migration-integration-final-20261102.log` 及对应run目录，串行执行记录 `runtime-migration-final-check-run-20261102.json` 两阶段退出均为0。

首轮9文件完整集成 `run-kBGox6 / f27320b05859` 已138/138，外层exit0、cleaned=true；首个新生产API成品 `run-f3b4c496335f1750161dbcdc-2NinB5` 也19/19、sourceVerified/cleaned=true、exit0，确认旧kit/loader确实不在成品中。其后复核从旧kit校验和postgres4 parseUrl源码发现空URL的默认连接差异，补回明确拒绝及第4个回归；上述138/19只保留修改前范围，不转记为最终139/20结果。修正后API完整检查再次84工具、767单测和lint/类型/构建通过；Web192及构建对应此前同锁完整check，其源码未变。

dev generate额外的网络度量首轮把tsx父进程命名管道IPC误当IP网络而失败，原记录保留。独立重验仍拒绝所有被钩住的API，确认唯一调用是被拒绝的本地Windows命名管道；HTTP/TCP IP请求为0，generate本身自然exit0，原SQL不变。该Node级guard不等于操作系统出口防火墙。

最终干净提交 `d470fae9c855aebef85e013fc425933bfef41ca4` 的Linux API完整构建 `run-ac8e873d8fe30c8e9c57f0b7-KCpip9` 为20/20、外层exit0、sourceVerified/cleaned=true；镜像 `sha256:e27c26b864fabd154008b92d5d386e66852c02e7c01c76528b9c19bde8e5cbd1`，27项迁移通过，实际不含kit、esm-loader、core-utils及旧配置，空/blank URL子进程确实拒绝。316份来源独立核对无漂移，容器/网络/卷独立读回为空。

同一最终API成品的 `run-8858d0fbd74b7f84024c7feb-qXbIVU` 再跑20组及4组进行中任务关停/重启，全部通过、外层exit0、sourceVerified/cleaned=true。两次停止约1.494/1.523秒，从探针开始的完整宿主窗口约2.728/2.930秒，均小于镜像内原25秒期限；重启宿主PID改变、旧请求不重放，之后新的受控请求实际到达。319份来源无漂移，自有资源独立读回为空；该成绩只证明合成本地Provider路径。

上述提交的[四项远端CI](https://github.com/NekoMint-Labs/Unfreq/actions/runs/41466874537)全部通过。后续Web宿主验证器修复只改变验证工具，不改变这两个API成品的构建输入或139项集成的受保护来源。

最终Web同锁成品的三阶段完整构建已完成，首轮在宿主waitHttp发生unsettled top-level await、未进入浏览器。修复有引用超时后，受限续验核对同一158份构建输入和固定镜像 `60b1bca5587d…`，`run-cb56e66fd506dc0b35cb0e1c-5krnkN` 实际38/38、外层exit0、sourceVerified/cleaned=true；当前13份验证来源也全部冻结，旧失败保留。成品165包按名及嵌套路径均无kit/loader/core-utils/esbuild，原生探针、中文及占位字形OG、两种停止通过，详见[Web补充记录](./web-runtime-readiness-20261102.md)。最终工具测试87/87；这次工具修复后再次独立核对API136输入/112产物无漂移。

Web工具修复后的代码提交 `453f9c6d010598ba8a618c3e3d9855cd69edcb78` 也已通过[四项远端CI](https://github.com/NekoMint-Labs/Unfreq/actions/runs/41474310409)。后续仅同步文档中的当前摘要与历史标识，不改变该代码或锁，也不重复构建成品。

回退需成组恢复manifest、lock、迁移脚本、Docker及测试接线至基线；不回退既有SQL或数据库账本。KIT与runner的双向幂等不构成生产恢复结论。本轮没有main合并、生产部署、真实数据迁移或收费模型调用。
