# PostgreSQL v4 与连接生命周期补丁

此候选从当前 main `e5b459cf0e067fa391befb095bf3e87b9370cc41` 独立提取旧 [PR #8](https://github.com/NekoMint-Labs/Unfreq/pull/8) 的驱动改动。保留 main 已合入的 B1/B3 行为和回归；不包含 C1、D/E/F 功能、scheduler、F4 镜像运行器或其他依赖升级。关联 [issue #7](https://github.com/NekoMint-Labs/Unfreq/issues/7)，不关闭该跟踪项。

## 安装和模块契约

API 驱动精确固定为 `postgres@4.0.0`。锁文件只修改根 Node 范围、API 的 postgres 声明和 postgres 包条目；其他包的版本、下载地址和 SRI 不变。Node 范围收紧为 `^20.19.0 || >=22.12.0`，以支持真实 CommonJS `require(ESM)`；不再声明旧的 Node 20.9 下界。

原生 ESM 使用 `import postgres from "postgres"`；CommonJS 使用 `require("postgres").default`。独立 Node 进程回归验证实际模块路径、默认函数和 Drizzle 接入，不依赖 Vitest 转换后的加载结果。当前 main 的三个连接工厂（主 API、generation repository、audio repository）显式设置 `infer: true`，保留 v3 的值推断模式。不存在的 F1 scheduler 不在此 PR 中。

正常 `npm ci` 的 root `postinstall` 调用[安装器](../scripts/apply-postgres-lifecycle-patch.mjs)。两个 Dockerfile 的普通及生产依赖阶段复制同一安装器和 metadata。`--ignore-scripts` 会跳过补丁，不能作为正常验收安装。

## 仍需维护的本地补丁

v4 仍有 `src/pool.js`、`src/index.js` 两文件补丁，不能称为零本地补丁。[Metadata](../patches/postgres-4.0.0-lifecycle.json) 固定官方包 SRI、原始源码和修补结果 SHA256；[diff](../patches/postgres-4.0.0-lifecycle.patch) 是实际改动。安装器先核对所有输入和输出，未知版本、SRI、源码或补丁上下文均拒绝；已知修补状态只验证，已知部分修补状态可以补齐。逐文件原子替换并非跨文件磁盘事务，任何 I/O 失败都必须保留为安装失败。

补丁对照 metadata 中列出的上游提交，同时保留本项目的冷启动请求批次、计时器和类型加载 token 管理。它使当前批次未发送工作在连接/类型加载失败后有界结束，拒绝迟到结果，并允许新操作在同一个原生 pool 恢复。健康连接占用和排队不会变成冷启动超时；已发送 SQL、事务回调及收费任务不会自动重放。未知 COMMIT 回执仍不能证明数据库没有提交，业务 attempt 和条件写入栅栏继续生效。

真实隔离回归保留启动 FIN、类型加载 FIN、TCP RST、预留/事务/Drizzle、注册无晚到写入，并增加类型加载挂起、健康池排队、扩容槽 FIN、参数推断/日期/数组/JSON、后端回滚及子事务断连断言。原超时和行为断言不放宽。

## 迁移、回退与验收边界

本 PR 不增加或改写 SQL、schema、journal；main 现有 24 项迁移及顺序保持。生产 ORM migrator、kit 开发依赖边界和 Linux 镜像 runner 在独立维护 PR 中处理。

回退需成组恢复本 PR 的 package manifests/lock、3.4.9 安装器和四文件补丁、Docker COPY、模块入口及对应回归；不单独把驱动降级后保留 v4 补丁。回退后的正常安装和真实 FIN/RST/恢复验收仍须重新执行。旧 3.4.9 说明保留为[历史记录](./postgres-startup-patch.md)。

本次所有测试只用于相应提交、环境和受控数据。旧 #8 的 135/135、Node 下界及镜像成绩不计作新候选通过。新候选的本地安装/检查、四项必需 CI 和真实 PG/Redis 结果分别记录在 PR；生产迁移、部署、真实数据恢复和收费 Provider 调用保持独立决策。
