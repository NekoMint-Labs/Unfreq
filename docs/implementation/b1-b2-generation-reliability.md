# B1 / B2 生成可靠性验收记录

状态：**B1 新纳管任务本地验收通过；B2 生成 / 管理员栅栏局部通过，C1 作者撤回待实施。第三轮 46 / 46 集成通过。** 2026-10-29 已二次核对原始 JSON / manifest、15 个案例的资源清理及最终 API lint / typecheck；本文保留前两轮失败，未执行生产迁移或部署。

## 1. 范围和证据基线

B1 面向新纳管的 pending 任务：PostgreSQL 持久领取、租约 / attempt、并发上限、有限安全重试、恢复及有序关闭。第三轮集成已验证本轮 B1 范围及 B2 的生成回写 / 现有管理员状态栅栏；B2 涉及作者撤回的剩余部分须由 C1 接入真实端点后验收。

边界保持明确：

- `generation_attempt_count IS NULL` 的历史记录未自动领取、重试或终态化；本轮不能称为历史 pending 已恢复。
- 外部请求已派发但结果未知时不自动重发整个生成；有效 lease 容量不等于远程物理计算或费用的绝对上限。
- C1 作者撤回端点尚未实施，真实撤回 / 再发布与栅栏接入仍待后续；管理员隐藏回归不能替代它。
- 本轮交付为独立分支，合并与部署另行授权。验收时核对 A1 / A2 的 PR 均为 open draft、未合并，heads 未变化；A2 的 PR #2 已通过 CI。

[修复前基线报告](./b1-b2-generation-baseline.md)冻结了六个真实业务失败，不在本稿改写。当前配置、备份、升级及回退流程见 [B1 运维说明](./b1-generation-operations.md)；该文档与示例已记录于 `a2117fa`，操作流程本身不等于部署已执行。

## 2. 第一轮修复后集成：未通过

首轮记录为 `run-MTbMvV`，运行标识 `122ffa2c6fbb`，运行代码来自 `0c4e4fd`，当时分支 HEAD 为仅新增 worker 单测的 `f2e96e8`。后者不改变这一轮集成所测行为。

| 项目 | 实际结果 |
| --- | --- |
| 总数 / 通过 / 失败 | 36 / 30 / 6 |
| pending / todo | 0 / 0 |
| 退出码 | 1 |
| runner 清理 | `cleaned: true` |

六个失败按本轮定位分为：

| 数量 | 定位结果 | 后续处理 |
| --- | --- | --- |
| 2 | HIDDEN / DELETED 尚未进入审核断言，创建响应未满足严格 RECEIVED 夹具；原轮未记录响应枚举，无法据此唯一归因。源码检查另发现 INSERT 后 SELECT 可与扫描领取竞争 | 改用 INSERT RETURNING 返回原子快照，保留原严格断言并增加安全响应诊断，后续重新验证 |
| 2 | raw timestamp 尚未解码即调用 `toISOString` | 补齐 raw timestamp 解码 |
| 1 | core 用例把畸形状态写入 managed 行，被新 CHECK 拒绝 | 旧 NULL 畸形夹具单独构造；新增 managed CHECK 独立用例 |
| 1 | 前一用例未进入 finally，残留 PUBLISHED 记录影响后序 random 断言 | 修正夹具及清理路径，后续须重新验证无跨用例残留 |

这轮保留失败结果，不以“多数通过”或环境已清理替代验收。`pending=0` 是测试运行字段，不表示业务数据库没有 pending。

## 3. 后续修正与已完成的专项证据

`ef4d18e` 包含创建原子快照、日期解码及以下修正；第三轮集成已通过本轮覆盖范围，保留下面的专项证据。

- 审计 / 配置上下文 fail closed：已执行的红例曾出现 2 次 HTTP / 2 次 audit，修后对应计数为 1 / 1；另有三种配置失败原会绕过上下文，已纳入回归。
- 最终审核失败日志由自由文本 `problems` 改为 `problemCount`。合成 Seed / credential marker 回归先红后绿，验证实际失败分支不把敏感 marker 写入 warn。
- 旧 NULL 畸形行与 managed 数据分开验证；新增 CHECK 用例用于验证 managed 状态形态，不以削弱约束迁就旧夹具。

以上专项红绿证据只能支持相应用例，不能外推为整个生成链、关闭或生产故障已全部通过。

| 检查 | 当前已知状态 | 证据 / 限定 |
| --- | --- | --- |
| API 完整单测 | 30 files，268 / 268 PASS | `test-results/b1/api-unit.log` |
| Web lint / typecheck / 单测 / build | `npm run web:check` exit 0，38 / 38 单测通过 | `test-results/b1/web-check.log`；保留既有 Edge Runtime 弃用提示 |
| API lint / typecheck / build | 三项 exit 0；最终新增测试后再次运行完整 lint / typecheck，exit 0 | API 业务源码自 `ef4d18e` 后未变，未重复运行已通过的业务单测或 Web 构建 |
| tools 门禁 | 最新 14 / 14 通过，exit 0 | `runtime-tools.log`；实际执行 `npm run test:integration-tools` |
| 部署脚本 | 5 组通过 | 实际使用 `D:/git/Git/bin/bash.exe scripts/test-deployment-scripts.sh` |
| `npm run deploy:test` | Windows 因缺少 `sh` 未启动脚本 | 不能写成该 npm 入口已通过；与上行实际 Bash 执行区分 |
| Compose 示例渲染 | 确认 API 停止宽限 40s，对应默认 server 预算 29s | 仅使用 demo 示例，未解析实际运行 env；未验证真实容器 SIGTERM |

## 4. 第二轮修复后集成：未通过

源码为 `60e7ea4f2360794b3ad92ae8dce0e699bb7682e3`，命令为 `npm run api:integration`，运行记录 `run-WqXgF8`，runId 为 `d4d9d7607087`。`second-after-fix-source.json` 记录了运行前代码工作区无差异。

| 项目 | 实际结果 |
| --- | --- |
| 文件数 / collected | 5 / 46 |
| 通过 / 失败 / pending / todo | 32 / 4 / 10 / 0 |
| failed suite | 1；core 的 beforeAll 达到 30000 ms，导致该套件 10 项未执行 |
| 退出码 / runner 清理 | 1 / `cleaned: true` |
| 15 个 generation 案例的 cleanupErrors | 全部为 0 |
| 15 个 generation 案例的 experimentErrors | 仅 closeearly 为 1，其余为 0 |

四个失败的证据边界如下：

| 场景 | 实际观察 | 可得结论 |
| --- | --- | --- |
| preclaim | 截止 5s 完成观察时仍为 MATCHING | 真实业务验收失败；根因尚未唯一确认 |
| parallel | 截止 5s 完成观察时仍为 MATCHING | 真实业务验收失败；不能只据该结果归因为容量或领取逻辑错误 |
| ABA | 3s 内尚未到达 before-complete 门闩，随后终止本案例 owned 进程 | 未执行到目标旧 CAS 验证；不能称 ABA 逻辑已实测错误或已通过 |
| closeearly | app-import 冷 bootstrap 在 20s 内未 ready，记录 experimentErrors=1 | 尚无提前关闭路径的业务结论 |

通过的 32 项包括：原 restart / hidden / deleted / stale / failure 五项，新 preDispatch / preWrite / twoPIDs / close / retry / exhaust 六项，以及 EOF 19 项和 failures 2 项。core 的 10 项为套件准备失败后未执行，不能算作通过；因此本轮也未重新取得完整 core 链路的通过证据。

全部临时 owned 进程、自有数据库、媒体目录及外层容器 / 网络已清理。资源清理成功与业务验收失败分别记录，不互相抵消。当前证据尚不能唯一确认剩余失败的根因，也不将其概括为偶发或环境波动。

## 5. 第三轮运行方式与观测边界

第三轮冻结记录为 `2d5197cf0c806fd462f98c32af288beb6a02f0cf`。生产业务代码保持 `ef4d18e` 的修正，本轮变化为测试、阶段观测及 runtime 准备；没有再次改变业务处理逻辑。

本轮加入不含 Seed / 凭据的阶段耗时记录，从同一代码树单次编译 runtime，避免每个 PID 重复装载 TypeScript。编译耗时 27,038 ms。compile marker 仅记录 9 个关键 source 和 8 个关键 output 的 hash，不是全源码树或全构建输出签名。

preclaim 这一例中，两个 PID 的 import 分别为 4310 / 3269 ms，ready 分别为 5987 / 5651 ms。这只是有限的单例观测，不是性能基准，也不能单独证明第二轮所有失败的唯一根因。

第三轮通过的覆盖包括：

- CP1 pending 已写、CP2 领取后、CP4 最终回写前中断，连同原 CP3 AI 中断验证恢复；用真实 PID 变化证明进程重启。
- 两个 PID 的领取与容量约束；管理员 ABA 取消后仍提交真实捕获的旧 CAS，证明数据库拒绝迟到写入，不能仅以 HTTP 已取消代替。
- `app.close` 自然退出与提前关闭路径，检查真实工作收敛、进程关闭和资源清理。
- 真实 SQL 的有限退避 200 / 300 ms 及耗尽终态；这些是合成测试参数，不是生产 SLA 或收费预算。

原六个常规场景不额外持有 claim 锁来制造串行，也不放宽原有 3s 恢复观察、3s Provider 门闩和 5s 完成观察。冷启动 20s 与 core hook 30s 保持不变；两个冷启动场景仍使用 90s 外层实验预算，区分启动开销与业务断言期限。

## 6. 第三轮本地验收记录

| 字段 | 实际结果 |
| --- | --- |
| 冻结源码 / 测试提交 | `2d5197cf0c806fd462f98c32af288beb6a02f0cf` |
| 命令 / 运行记录 / runId | `npm run api:integration` / `run-AMIdxl` / `51ff238f6f2c` |
| 文件数 / 实际收集数 | 5 / 46 |
| 通过 / 失败 / pending / todo | 46 / 0 / 0 / 0 |
| 总耗时 / 退出码 | 329.51 s / 0 |
| 15 个 generation 案例 | 全部 `workFailed: false`，experimentErrors=0、cleanupErrors=0 |
| JSON / runner manifest 二次核对 | `success: true`、exit 0、`cleaned: true`，计数与运行源码核对通过 |
| 资源清理 | 15 个案例逐一核对 database-dropped、media-directory-removed、Provider inFlight=0；外层容器和网络已清理 |
| API / Web / tools 门禁 | API 单测 268、Web 38，lint / type / build 检查 exit 0；tools 14 / 14；最终 API lint / typecheck 再次通过 |
| 原始证据路径 | `test-results/integration/run-AMIdxl/*`、`test-results/b1/baseline-51ff238f6f2c*.json`；仅提交脱敏摘要 |
| 脱敏复核摘要 | `test-results/b1/final-integration-verified.json`；报告提交与代码验收提交分开保存 |

| 通过的分组 | 数量 / 记录耗时 |
| --- | --- |
| 原 generation 场景 | 6 / 70,822 ms |
| 新 generation 场景 | 9 / 145,693 ms |
| core | 10 / 59,790 ms；prepare trace 为 26,639 ms，低于未改变的 30s hook 预算 |
| PostgreSQL EOF | 19 / 32,069 ms |
| failures | 2 / 1,978 ms |

分组和阶段耗时按各自报告口径记录，不作为可直接相加的性能指标。第一、二轮失败及其归因限制继续保留。第三轮结果支持本轮 B1 新纳管任务和 B2 生成 / 管理员栅栏的本地结论；公开发布、生产迁移、历史任务处置及 C1 作者撤回仍分别保留其授权与实施边界。
