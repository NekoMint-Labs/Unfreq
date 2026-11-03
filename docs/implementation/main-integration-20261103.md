# 面向 main 的集成候选与交接

日期：2026-11-03（北京时间）。交付为 [PR #13](https://github.com/NekoMint-Labs/Unfreq/pull/13)，分支 `codex/main-integration-20261103`。代码验收提交为 `776b01c018738df3b0680e0d1977c683a0e40c0d`；随后文档收尾不改变构建、运行或测试输入。本候选没有合入 main，也没有生产操作或真实模型调用。

## 已完成的工程工作

- 在原 `c69898a` 候选中整合 main `e5b459c`。main 的 A/B 历史采用压缩合并；对照原 B3 `34c2ae3`，实际新增差异为16文件。保留较新的 C1/E4 隐私契约，合入请求 INSERT 等待期间关停、重启后恢复同一 signalId 的回归、夹具和来源清单。合并提交为 `e9b8e83`。
- 仅在 typescript-estree 链使用 minimatch 11.0.3，在 core-utils 链使用已有 esbuild 0.25.12。根 minimatch 3.1.5 的 callable、Minimatch、makeRe 和路径行为保留；Postgres4版本、两文件补丁、迁移SQL和生产迁移器不改。依赖提交为 `71e3ed6`。
- 新增4项永久依赖回归，并接入真实 Dockerfile.api/web 的容器 CI。锁定受 Playwright1.60 支持的 Ubuntu24.04；跨浏览上下文的键盘检查先激活操作页，原焦点、Enter、42项范围和预算保留。工作流只使用隔离服务及合成数据。
- #5 已合入 main；旧进度表中的 Draft 说明已更新。#8～#12 保留分阶段审查和历史证据，当前直接对 main 的汇总入口为 #13；空评审不表示批准。

## 验证结果与来源

代码776的 [CI](https://github.com/NekoMint-Labs/Unfreq/actions/runs/41652411375) 四项全绿；[容器验收](https://github.com/NekoMint-Labs/Unfreq/actions/runs/41652411305) 两项全绿。CI实际 checkout 为 `0c4bb2b9335ace7ed4f4999a33aa0b3ff33ff191`，其树与代码776相同：`c3e3a21cec994abffd8dcd6452c3ca6ef844ed2b`。

| 范围 | 本轮实际结果 |
| --- | --- |
| API/Web检查 | 工具91、API767、Web192；lint、类型和两端构建均通过 |
| 真实隔离PG/Redis | 9文件140/140，包含本轮合入的准入/关停交错回归；不是合成模型质量测试 |
| 部署脚本 | 原完整Linux回归通过 |
| API镜像 | 完整三阶段构建、20/20、27项迁移、kit/旧loader排除、关停与清理通过；image `6c374bff179f…da03` |
| Web镜像 | 完整三阶段构建、42/42，0失败/跳过/flaky；SWC、sharp、contracts及关停/清理通过；image `ab7fb697b9ef…aef1` |
| 来源与成品读回 | GitHub ZIP摘要匹配；API316份、Web171份Git blob字节哈希全部匹配，三阶段metadata与实际image config相符，两个manifest均exit0、sourceVerified/cleaned=true |
| 依赖触发与合法对照 | 旧glob 7段输入扩增为128条，修复后按配置限制为64；25,312组正常匹配一致。esbuild两类恶意Origin不再获得ACAO，正常GET、TS/TSX、同步/异步转换与source map通过 |
| 支持的Node下界 | 20.19.0、22.12.0分别执行新依赖回归4/4；不是每个下界重跑全部项目检查 |
| 官方audit | full 20→15条moderate，均dev-only，exit1；omitdev 0条、exit0，high/critical均0，五份输入无漂移 |

成品原始报告、ZIP、独立哈希读回及失败日志在主目录忽略路径 `test-results/main-integration-20261103/`；CI上传的也是合成验收产物。公开摘要保留CI链接，不依赖本机忽略文件进行评审。真实模型、目标服务器和设备范围见下文。

补充回归提交 `a13c51b` 在[固定CI](https://github.com/NekoMint-Labs/Unfreq/actions/runs/41656868274)执行真实当前schema的 Drizzle generate，实际生成users/signals SQL，并检查全部原迁移文件未变；工具门禁为92/92、API767通过。该提交只增加一项测试，未改变上述已验镜像的487份来源。

## 依赖告警的准确结论

本轮修复两个实际依赖触发边界，不宣称发现或复现了应用公网可利用链。minimatch公告的扩增算法只存在于现代预处理实现，保留的v3源码不包含该算法；其官方affected range仍会使ESLint父链产生15条包记录。旧调用者需要v11已移除的makeRe，因此没有全局强制覆盖、改版本号或隐藏审计结果。剩余计数须由上游修正范围、发布兼容父包，或经另行决策完成整组迁移。

官方依据：[minimatch公告](https://github.com/advisories/GHSA-g3hv-75wg-m249)、[esbuild公告](https://github.com/advisories/GHSA-67mh-4wv8-2f99)。完整安装树命令exit0，但记录9条extraneous：7条WASM和2条已保留的Vite可选esbuild包；未将它写成全树零问题，也没有为消除提示删掉Vite所需的可选peer。

## 失败和环境限制

- 本机Docker启动失败于不可访问的旧 `sailor-ingest.sock`；确认backend退出后，删除、改名和reparse查询也失败。没有删除镜像/卷、重置Docker或改系统配置。容器成绩来自上述独立Linux CI。
- 首轮容器CI在Ubuntu26.04安装浏览器前失败；第二轮Web41/42，跨上下文焦点检查失败。固定Ubuntu24.04并恢复活动页前置条件后，第三轮完整42项单次通过；没有把原失败改写成成功。
- 本机全量检查保留API首个用例5秒超时、plain CJS探针10秒超时。后一次运行期间，主目录被另一项C1工作切换分支，Web类型检查读到缺失文件；该运行不能作为固定候选的完整Windows验收。原目录及其未提交变更未被恢复或覆盖，本任务改用独立工作区；上述Linux CI是固定提交的完整门禁。
- 辅助审计首轮超时、generate夹具缺少vector、命名管道误分类和独立准备超时分别保留；不把辅助脚本exit0当成生成成功。最终generate结果另附于本轮安全验证记录。

## 需要他人提供条件或作决定

| 负责人 | 需要完成或提供 |
| --- | --- |
| 维护者 | 正式独立评审#13，决定合并/发布，以及旧分阶段PR的处置；Issue#7仍开放，v4仍有两文件补丁 |
| 项目负责人 | 明确真实模型、费用范围和脱敏样本；提供后可继续执行自动捕获、评测和校准 |
| 两位独立评测者、作者 | 双人盲评、相关性标注及作者认可；流程见[忠实性评测](../faithfulness-evaluation.md) |
| 实际使用者 | 实体手机、读屏器及语音听感验收；浏览器模拟不代替这些体验 |
| 部署/数据负责人 | 提供目标服务器访问、代理/IP/CIDR和额度配置、获准旧备份及操作范围，才能执行真实迁移、恢复和发布 |
| 数据/产品负责人 | 决定A3保留期、硬删除、注销、备份销毁，以及冻结实验能力的启用/退役；见[生命周期设计](../data-lifecycle.md) |
| 团队负责人 | 提供届别、学校/赛区、成员、权属与实际贡献依据；见[参赛事实清单](../competition-evidence.md) |
| 本机使用者或管理员 | 如需继续本机Docker验收，修复Desktop的不可访问socket；远端Linux代码验收已完成 |

这些条件具备后，部署、迁移、恢复和模型测试中的工程操作仍可由助手执行；此表不将尚未获准的数据处置、费用或人为评价代为决定。
