# PostgreSQL 驱动 v4 与连接生命周期补丁

本页描述 `postgres@4.0.0` 的新候选，实施状态见[本轮记录](./implementation/postgres-v4-upgrade-20261101.md)。候选仍带项目维护的两文件补丁；旧 3.4.9 安装器及四文件补丁已经在本候选退役，历史问题和当时成绩保留在[旧补丁说明](./postgres-startup-patch.md)。新候选的完整本地检查已经通过；真实数据库恢复、Node 下界和 Linux 安装仍待各自最终验收。

## 上游依据与本地补充

本轮读取并对照了官方仓库的三个提交，当前依赖仍精确固定在发布包 `4.0.0`，没有把这些提交直接当作另一个已发布版本：

- [e417a836](https://github.com/porsager/postgres/commit/e417a83657154da57030ed615058b27c9a904a4e)：连接在类型加载时关闭，要计入连接失败；连接真正可用前不提前清除重连失败状态，避免持续类型加载断连无限重试。
- [00dd3164](https://github.com/porsager/postgres/commit/00dd3164c40914ab0904efe8ef2f722c3bd0d2b3)：保留 `connect_timeout=0` 禁用该期限的语义，并为受影响的等待查询保存独立错误副本。
- [2e52628f](https://github.com/porsager/postgres/commit/2e52628f2c88b790e86006e238b26779625e567c)：连接在子事务回调期间失效时，`savepoint()` 和嵌套 `begin()` 应拒绝，不能只凭回调返回就报告成功。

本地补丁另外处理“当前连接和类型仍未就绪的一批请求”。连接池没有可用连接时，仍未发送的请求归入同一批（cold acquisition cohort），由这批请求持有连接预算、启动尝试和类型加载标记。失败时先使本批失效并取出其未发送请求，再结束该批拥有的启动连接，清除过时的失败缓存和重连等待状态；较晚返回的连接或类型加载结果不能重新接管这批工作。新请求仍使用同一个原生 pool，不靠重建整个池或 Proxy 适配器恢复。

这些批次归属、计时器和类型 token 是本项目的额外补充，不能全部归为官方提交，也不能由官方提交存在就认定本地补丁已经通过真实数据库验收。两项补丁目标为 `src/pool.js`、`src/index.js`。

## 保持的业务约束

健康连接即使正在执行工作或被 `reserve()` 占用，也不会因此被当成冷启动池。本轮没有给健康连接池的等待队列新增 `queue_timeout`，没有把健康检查预算改成所有业务请求的排队期限，也没有使用零 backoff 热循环。

补丁只终结其拥有的未发送工作，不重放已经发送的 SQL、事务回调或收费任务。已发送请求遇到断连、未知 COMMIT 回执时仍可能无法判断数据库是否提交；要继续依靠服务端超时、事务结果、持久任务 attempt 和业务状态栅栏，不把 socket 关闭解释为“肯定没有写入”。普通查询、预留、事务以及恢复后的新请求都须通过原生 pool 的真实回归。

应用的四个连接工厂都显式使用 `infer: true`，先保留 v3 的值推断兼容行为：

| 连接工厂 | 用途 |
| --- | --- |
| `apps/api/src/db/client.ts` | 主 API / Drizzle |
| `apps/api/src/modules/signals/generation-repository.ts` | 生成任务元数据与领取 |
| `apps/api/src/modules/signals/audio-repository.ts` | 音频任务归属与条件写入 |
| `apps/api/src/modules/signals/scheduler-repository.ts` | 每日调度领取与执行权 |

参数默认模式、显式 cast、日期/时区、数组、JSON 和事务回滚仍要单独验证。保留 `infer: true` 不等于这些兼容性已经自动成立。

## 版本、模块与安装

候选根 `engines` 为 `^20.19.0 || >=22.12.0`。Node 原生 ESM 使用 `import postgres from 'postgres'`；CommonJS 使用 `require('postgres').default`，不再依赖旧 `cjs/src` 路径。两个 Node 下界需要分别核对实际模块、Drizzle、原生工具及离线迁移生成；此前另一轮 v4 的下界成绩不转记到本候选。

官方 tarball 为 `https://registry.npmjs.org/postgres/-/postgres-4.0.0.tgz`，固定 SRI：

```text
sha512-kBh8qXtcvvIAc00DftQyOxz7M/3Zxww1tRMXZPLzipNXXl5PIzHml+9zB3Mrge2U8ldc0WF1ZdLp1iYQi7Kh3A==
```

正常 `npm ci` 通过 root `postinstall` 调用[新安装器](../scripts/apply-postgres-lifecycle-patch.mjs)。[补丁 metadata](../patches/postgres-4.0.0-lifecycle.json) 固定包名、精确版本、lock integrity，以及两目标文件的原始/修补后 SHA256；[diff](../patches/postgres-4.0.0-lifecycle.patch) 是实际变更。npm 校验包的 SRI，安装器再核对这两份已安装源码，不能把两文件检查说成所有安装文件的逐文件签名。

安装器先核验全部输入和计算出的输出，再逐文件写临时文件并重命名。已知修补状态只验证，已知原始/修补混合状态可以补齐；未知版本、integrity、上下文或内容一律失败。逐文件重命名不是跨文件磁盘事务，中途 I/O 失败必须保留失败，不能忽略错误启动应用。

两个 Dockerfile 的开发与生产依赖安装阶段，以及镜像/集成来源清单，已改为引用这组新资产；这只是接线状态，Linux 安装与成品检查仍须实际运行。`--ignore-scripts` 会跳过补丁，不能把这样的安装当作本候选正常安装。

## 当前证据与待验收范围

准备阶段已确认正常 `npm ci` 安装 543 包，postinstall `applied=2 / verified=2`；自有 TCP 协议诊断 17/17；最终锁的完整官方 audit 已独立完成。TCP 诊断使用合成协议端点，没有真实 PostgreSQL、API 或 Provider，不能替代恢复验收。

完整 `npm run check` 已以当前锁通过：工具79、API767、Web192及两端lint/类型/构建；纳入这次门禁的108份来源文件前后无变化。108是本次选定输入，不代表全仓文件签名。真实 PG/Redis 集成、Node 下界和 Linux 依赖/镜像门禁仍以各自最终记录为准，本页不把中间日志签收为通过。真实门禁须保留 FIN/RST、类型加载、健康池排队、同池恢复、预留/事务、原错误类别和旧注册无晚到写入断言；不能靠放宽预算或改错误码换取通过。

[旧 v4 负评](./implementation/postgres-v4-20261101.md) 中的 100/119 与 16 项 EOF/恢复失败仍有效对应当时的无本轮补丁候选。新候选没有覆盖、删除或重新标记那些失败；是否解决须由新的独立运行回答。
