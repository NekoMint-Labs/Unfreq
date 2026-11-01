# postgres.js v4 升级与生命周期补丁候选

批次：2026-11-01；准备记录写于 2026-11-02（北京时间）。基线 `c54f7e4e28d091954231f268665d1f13d9e1320a`，工作目录为 `C:\Users\zrjdx\.codex\worktrees\unfreq-v4-upgrade\unfreq`，对应 [issue #7](https://github.com/NekoMint-Labs/Unfreq/issues/7)。本页记录候选、准备结果及已完成的完整本地检查；真实数据库与平台验收由主执行者后续补齐，当前不能称整个升级完成、已合并或已部署。

## 候选范围与锁

API 精确固定 `postgres@4.0.0`。相对本轮基线的 lock 对象只改变 `apps/api`、`node_modules/postgres` 两条记录；当前 lock SHA256 为：

```text
cdf351ca90d8d3325c349c16abefa71e35327d8aabd07a78ec3dfab16b64b3b4
```

这只描述 lock 差异，源代码还包括四连接工厂的 `infer: true`、原生 CommonJS `.default` 接入、模块回归、驱动生命周期补丁及安装/镜像清单。没有在本批生成或重写业务数据库迁移，也没有加入整个应用的参数语义迁移。根 Node 范围为 `^20.19.0 || >=22.12.0`。

本候选成组退役旧 `apply-postgres-startup-patch.mjs`、`postgres-3.4.9-startup.json` 和 `postgres-3.4.9-startup.patch`，同时接入新 `apply-postgres-lifecycle-patch.mjs`、`postgres-4.0.0-lifecycle.json` 和 `postgres-4.0.0-lifecycle.patch`。root postinstall、两个 Dockerfile 和集成/镜像来源清单仍保留新补丁接线。不能写成“v4 已无本地补丁”。

补丁移植的官方依据、本地冷启动请求批次补充、两文件输入/输出哈希及安装失败边界见[当前驱动说明](../postgres-driver.md)。候选保留健康排队行为，不重放已发送 SQL/回调，不以重建池或修改原错误类别代替同池恢复验证。

## 既有负评保留

[上一轮 v4 记录](./postgres-v4-20261101.md) 对应其他基线与锁。其 `run-jKUDtH / 6e581f5dcf40` 为 119 项中 100 通过、19 失败：三项是旧 REVIEWING 夹具与已获批 404 契约冲突，其余 16 项涉及 EOF、有界失败和恢复。原始 exit1、cleaned=true、来源/产物哈希和资源读回不改。测试主动结束超预算请求不能证明自然失败后的无迟到写入已经通过。

旧候选的工具74、API767、Web192、Node 下界或构建通过，也不转记成本轮成绩。新补丁是否解决原缺陷，须由本轮新来源、原预算和副作用断言的独立运行确认。

## 准备阶段已签收的结果

| 范围 | 本轮已确认结果 | 结论范围 |
| --- | --- | --- |
| 正常依赖安装 | 543 包；新 postinstall `applied=2 / verified=2` | 证明当前安装接线及已知补丁输入可以应用，不代替完整依赖/平台/运行验收 |
| 自有 TCP 协议诊断 | 17/17 | 仅合成 PostgreSQL 协议端点；不含真实 PostgreSQL、API、Redis 或收费 Provider |
| 完整本地检查 | 工具79、API767、Web192；两端lint/类型/构建通过，exit0 | 对应本轮选定108份来源，未把真实PG/Redis、Node下界或Linux结果并入 |
| 最终锁完整官方 audit | exit1，完整报告为20条 moderate | exit1表示仍有告警；本轮报告已完整生成，不是超时或审计零告警 |

补丁与 TCP 的本地准备材料在候选工作区被忽略的 `test-results/v4-lifecycle-patch-20261101/`。最终安装、全部检查、来源冻结和资源收尾应记录各自实际命令及输入，不能仅凭本表摘要或旧目录名称签收整套候选。

## 完整检查的来源与日志

完整 `npm run check` 于 `2026-11-01T15:59:50.883Z` 至 `16:09:42.256Z` 执行，exit0，未超时；lock仍为本页的 `cdf351ca…`。108份纳入门禁的来源文件前后变化列表为空；这是本次明确选择的输入，不表示全部工作目录、历史证据或所有安装文件都已冻结。精确记录在 `E:\unfreq\test-results\v4-final-check-20261101\check-run.json`，对应工具79、API767、Web192及两端lint、类型和构建。

真实集成已由主执行者另起本轮原运行器，证据目录为候选工作区 `test-results/integration/run-u3gw8N`，项目 `unfreq-it-e0cb6725b23d`。本准备记录写入时仍在执行，尚无可签收的计数、退出或清理结论；后续应按实际读回追加，不预填通过。

## 最终锁的独立完整 audit

本轮使用官方 npm `11.19.1`，于 `2026-11-01T15:26:17.822Z` 至 `15:26:37.384Z` 独立运行完整 audit，约19.6秒。报告在本机：

```text
E:\unfreq\test-results\full-audit-20261101\final-v4\
```

`audit.json` 是本轮原始报告，`classified-report.json` 是分类清单，`completion-summary.json` 记录独立请求及与 D 的对照，`inputs-before.json`、`audit-run.json` 和 `tool-verification.json` 记录输入及命令；`report.md` 为说明。不能拿 D 的原始 JSON 复制成新锁结果。

实际为20条 moderate 包记录，0 low/high/critical；其中16条 dev-only、4条正式依赖树，5条直接、15条传递，共21个安装路径，对应2条直接 advisory。这些维度不能相加当作另一份漏洞总数。正式依赖链仍有 drizzle-kit → esm-loader → core-utils → esbuild `0.18.20`，不能把20条全部归为开发依赖。

本轮新的官方 bulk 请求实际包含 postgres `4.0.0` 并收到 HTTP 200；包名、级别、路径及 fixAvailable 与 D 相同。`@typescript-eslint/type-utils` 的计算命中范围变动，锁中版本仍为 `8.59.2` 且两份范围均命中，未建立该输出差异的唯一原因，不能据此说 v4 改变了这个包。剩余告警涉及 minimatch/ESLint 和 kit 旧 loader 两条链；fixAvailable 均标为跨主方案，包含不适合本项目的降级建议。本轮没有用 force、override 或任意降级消除计数，包命中也不等于已经证实应用可利用。

本次 audit 只冻结并读回 lock、root/API/Web/contracts 四份 manifest、npm CLI 与配置指纹，命令前后无漂移。应用源码、安装器和补丁仍在并行修改，**没有冻结或证明全部源码未变**。audit 不检验新补丁行为；后续交付仍须重新读回最终输入。

## 后续验收与记录方式

以下项目尚待主执行者完成本轮运行或最终读回，不在本准备记录中写成通过：

- 真实隔离 PG/Redis：原 FIN/RST、类型加载、两槽五路、健康队列、同池新请求恢复、预留/释放、事务/子事务、旧注册无晚到写入及新的批次归属回归。计数以实际 runner 为准，不把17项 TCP 诊断当作真实门禁。
- Node `20.19.0` 与 `22.12.0` 下的真实 ESM/CommonJS/Drizzle、补丁幂等、原生工具、离线 generate 与工具冒烟；任何单个阶段成功都不替代整组验收。
- 两个 Dockerfile 的开发/生产依赖阶段和最终 Linux 成品：记录真实 Node、musl SWC/sharp、补丁读回、锁与来源、停止/清理结果。静态 COPY 或 Windows 成功不代替 Linux 运行。
- 成组回退：manifest、lock、驱动选项、安装器/补丁和 Docker 接线一起处理，保留 FIN/恢复行为回归。没有生产数据迁移或生产配置操作。

最终运行须另记精确提交或源文件指纹、lock、补丁输入/输出、实际计数、未执行项、失败、退出及清理。生产迁移、部署、真实模型质量与费用均不由本候选准备记录推出；issue #7保持未完成，直到其验收条件实际满足。
