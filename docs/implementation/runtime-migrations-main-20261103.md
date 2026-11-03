# 独立生产迁移器与 postgres v4 集成

基线为基于当前 main `e5b459c` 提取的独立 postgres v4 PR #17，精确 Head `1031f9bb7ef2ff7b67bd7eea16e51f12dac6ff4f`。本候选只提取原 #10 的运行时迁移器，以及 #9 中与生产入口直接相关的 LF 和 exec 修正；保留 #17 的 postgres `4.0.0` 与两文件生命周期补丁。依赖顺序为 main → #17 → 本 PR，不引入 C1 或其他 D/E/F 功能。

生产入口仍先迁移，迁移成功后进入 `apps/api` 并 `exec node dist/server.js`。编译后的 CLI 复用当前 Drizzle ORM 的 postgres-js migrator、原 0000–0023 共 24 份 SQL、journal 和 `drizzle.__drizzle_migrations` 账本。SQL、schema、迁移顺序和旧账本未改。未设置 DATABASE_URL 时保留原本机开发默认值；空或纯空白值明确拒绝，避免使用 PG 环境默认库。错误固定输出并返回 1，连接有界关闭完成后才报告成功。

`drizzle-kit` 改列开发依赖，继续用于生成迁移；Docker 成品不再需要它或 drizzle.config.ts。锁保留 main 的版本、resolved、integrity 和原有元数据，只采用 npm lock-only 解析所得的开发依赖分类，没有在 #17 之上再次改变驱动版本或强制 override。新 CLI 工厂与 #17 其他连接工厂一致，明确启用 `infer: true`，并用 `onnotice: false` 抑制原始数据库信息。

来源冻结新增编译 CLI、对应测试、原 SQL 和 journal；未登记的迁移或两侧篡改均拒绝。保留 main 原六个集成文件、所有故障/恢复断言、超时和 32KB marker 上限。新增真实 CLI 回归覆盖空库、幂等、DDL/数据/账本整体回滚、不可达数据库、空 URL 默认库保护，以及 toolkit 与 runner 两个方向的账本兼容。

专属 Linux 工作流独立构建真实 Dockerfile.api：验证实际 omit-dev 成品、Node PID 1、24 项迁移及幂等、进行中合成 Provider 请求期间 SIGTERM、同容器重启不重放与资源清理。该验证器不使用 F4 builder 或 resume 框架。开发 generate 在临时目录执行并校验原 SQL、schema、manifest 和锁未变。通过结果须在最终 Head 的 CI 完成后记录，不继承旧候选成绩。

本地来源冻结回归已 8/8 通过；CLI 和两份独立验证器已完成语法检查。完整四 CI、真实 PG/Redis、kit 兼容、generate 和 Linux 成品结果尚待本候选运行。所有本地及远端测试只使用临时库、合成账号和固定隔离 Provider，没有生产迁移、部署或真实模型调用。

回退需成组恢复命令、manifest/lock、CLI、Docker 和验证接线，不回退已有 SQL 或数据库账本。既有无跨进程迁移锁、不重验历史已应用 SQL checksum 的边界保持。本 PR 不决定生产数据恢复或配置。

首轮独立镜像工作流 [41658671633](https://github.com/NekoMint-Labs/Unfreq/actions/runs/41658671633) 在 generate 验证器查找 toolkit 时失败：该包未导出 package.json 子路径。实际安装与原四文件补丁已通过，尚未执行镜像构建；修正为使用根工作区固定安装位置的 bin.cjs，保留此原始失败并重跑最终 Head。

本候选最初直接从 main 提取；为使新增连接工厂遵守 postgres v4 的显式参数推断约定，随后将整个小 PR 重放到 #17。上述 main/PG3 的本地 guard 和首轮失败只保留历史范围，最终通过必须来自 PG4 组合精确 Head 的完整 CI、真实兼容与镜像验收，不能代替未来与 C1 合并后的复验。
