# PostgreSQL 驱动维护

本轮独立实验候选将 `postgres` 从带本地启动补丁的 `3.4.9` 更新为官方 `4.0.0`，对应 [issue #7](https://github.com/NekoMint-Labs/Unfreq/issues/7)。候选本地检查通过，但真实FIN/恢复门禁失败，已停止补丁退役交付；[实际结果](./implementation/postgres-v4-20261101.md)保留原失败、来源及清理证据。不能据此移除主工作区的旧补丁或发布生产环境。历史缺陷和修复证据保留在原提交及 A2 实施记录中。

## 兼容选择

官方 v4 重写连接池和启动层，并改变参数默认推断、事务约束及模块加载。参见[升级说明](https://github.com/porsager/postgres/blob/v4.0.0/README.md#upgrading-from-v3)。上游声明不代替本项目的恢复验证。

- 四个生产连接工厂显式使用 `infer: true`，保留 v3 从值推断参数类型的行为。本轮不同时迁移所有 SQL 到 v4 默认的 `infer: false`。无上下文的参数仍应使用明确 cast；隔离回归同时覆盖默认模式与兼容模式。
- 日期测试覆盖 UTC 瞬间与 `Asia/Shanghai` 会话的跨日边界；数组、JSON 和 Drizzle 参数分别验证，不用类型检查代替数据库读回。
- 项目 Node 支持范围为 `^20.19.0 || >=22.12.0`，以支持 v4 的真实 CommonJS 消费方式 `require('postgres').default`。不再假设独立 `cjs/src/index.js` 构建；必须对两个版本下界分别实际加载并核对官方二进制哈希。
- Drizzle 的 peer 范围容许 v4，但仍须验证运行时 parser/serializer 适配、普通和嵌套事务及真实迁移。peer 满足不等于兼容性通过。

## 必须保留的行为门禁

`postgres-eof.test.ts` 继续覆盖启动握手 FIN、真实类型加载 FIN、ESM/CommonJS、普通查询、`reserve()`、`begin()`、Drizzle 事务、两槽五路并发、失败后无晚到回调或注册写入、同一连接池恢复。`failures.test.ts` 保留 TCP RST 回归。模块工具回归在独立原生 Node 子进程加载真实驱动及 Drizzle，不启动数据库连接。

v4 新增兼容回归验证参数 cast、日期/时区、数组和 JSON，释放后的预留/事务对象拒绝继续执行，以及捕获服务器错误仍回滚事务中的先前写入。内部模块布局断言只用于确认真实入口，不能替代这些业务行为。

## 成组退役与回滚

仅当 API lint/类型/单测/构建、完整隔离集成、干净安装、两个 Dockerfile 的开发与生产依赖安装、Node 下界及迁移工具验证全部通过，才交付该升级组。升级组同时移除旧补丁、哈希元数据、安装器、root postinstall、Docker COPY、镜像冻结中的补丁输入以及安装器专用测试。FIN/RST 和恢复行为回归继续执行。

若候选失败，保留失败证据，不把补丁退役当作已完成。回滚需成组还原原 `3.4.9` lock、安装器、补丁、postinstall、Docker COPY 及相关验证入口，重新干净安装；只把版本号退回原始未补丁的 `3.4.9` 会重新引入已知启动问题。本项不包含生产迁移、真实数据恢复或收费 Provider 调用。
