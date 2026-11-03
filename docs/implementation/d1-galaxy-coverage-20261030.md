# D1 星图覆盖与定位（R03）

状态：D1 本地验收通过，进度表已更新。依据 `Unfreq_Implementation_Spec_v1.md` 的 D1；基线为 `34c1dde` 加上一轮已验收、尚未提交的 C2 本地改动。工作目录及分支沿用 `E:\unfreq` / `feat/c1-withdrawal-privacy`。保留 C2 改动；本轮没有推送、合并、部署、迁移生产数据或调用收费 Provider。

## 问题与修复前证据

原 repository 按 `createdAt ASC LIMIT 80` 取星图，最新本人信号可能不在返回中；移动端再从样本中绘制最多 72 个点，即使返回本人信号，也可能被较多高热度的本人信号挤掉。原 HUD 的 SIGNALS 数字没有区分样本和总量。

新增真实隔离案例分别构造 81 和 520 条明确合成、已确认公开的表达，另含草稿、隐藏、待审核、未确认、撤回和坏 digest 反例。修复前 `run-Z31IOe` 共 83 项，原有 81 项通过、新增 2 项均因本人最新信号不在结果中失败；exit 1、cleaned true。证据为 `test-results/d1-integration-before-20261030.log` 与对应目录的 JSON / manifest。移动纯函数回归先为 8 通过 / 1 失败，日志 `test-results/d1-web-before-20261030.log`。

## 选择与范围

- API 最多仍返回 80 点，移动端最多绘制 72 点。先保留合法的指定信号和当前频率在筛选内最新公开的一条，再取近期 40 条、按已确认频段轮转的稳定样本，最后以近期信号补满。所有阶段按 ID 去重；时间相同以 ID 排序，频段样本以固定 SHA-256(ID) 排序，不使用每次刷新的随机值。算法标识为 `recent-band-v1`。
- 符合筛选的总数包含完整确认快照及 digest 验证。读取在只读 repeatable-read 事务内按主键分批进行，每批 128 条，只取快照和必要元数据；不为统计读取全量原句、节目、向量或指纹。采样器最多保留 80 条近期元数据、8 组各 12 条频段候选及两个优先引用；只为最终最多 80 个 ID 读取完整内部记录。
- 事务后继续使用 C1 的原版本公开复核。撤回或换版本的点及其定位元数据被移除；连线只指向本次实际公开点。总量是查询快照计数，不能保证与随后提交的撤回实时同步；展示样本不会绕过最终检查。
- 本人标记以 `authorId ?? frequencyId` 判断，已有实际作者时不因旧 frequency 镜像误标为本人。移动端同时保留当前选中点和最新本人点。
- 图内连线只复用同一次同步投影中已整理的频率资料，避免每对点重复计算。不改变既有分值或权重，不影响其他未传入预计算资料的匹配调用，不增加跨请求缓存或 Provider 调用。

## 接口与界面

`GET /api/signals/galaxy` 保留原 `band`、`theme`，新增可选 UUID `focus`。非法 UUID 返回 400。band 优先于旧 theme；指定点仍必须满足相同筛选、确认、完成和未撤回条件，不能借 focus 读取私密表达。拒绝的 focus 不在响应里回显 ID，也不区分不存在、私密或已撤回。

响应追加 `coverage`：

| 字段 | 含义 |
| --- | --- |
| `totalEligibleCount` | 该只读快照中通过公开与筛选验证的总数 |
| `returnedCount` / `sampleLimit` | 最终可读样本数 / 80 点预算 |
| `samplingVersion` | 稳定取样规则版本 |
| `filters` | 实际使用的 band 或旧 theme |
| `latestOwnSignalId` | 当前会话在筛选内最新公开且已返回的本人信号；匿名不返回 |
| `focusStatus` / `focusSignalId` | 无指定、可定位或不可用；仅可定位时返回其公开 ID |

Web 校验数量与点集一致、优先 ID 属于同一个公开点集，并拒绝多余敏感字段。兼容没有 coverage 的旧 API 时只显示已返回样本/绘制数，不推算总量，也不假定已找到本人最新信号。

HUD 明确“符合筛选 / 返回样本 / 绘制”。“找到我的信号”打开筛选内最新公开内容；可选样本列表仍只含同批最多 80 条，包含移动端未绘制的样本。列表可阅读或通过固定 focus 链接定位；公开结果页进入星图也携带当前信号 ID。保留现有星图视觉与渲染分档，不将列表改成主信息流。完整阅读层的读屏、焦点生命周期和降运动改造仍属于 D3。

## 验证与性能

首轮跨层检查通过 API 568、Web 115 单测以及 lint、类型检查和构建。首轮修复后隔离 `run-aynzi8` 为 83/83、exit 0、cleaned true，日志 `test-results/d1-integration-20261030.log`；随后仅为本次星图同步计算复用频率资料，因此最终代码须以新的检查为准。

最终 API 检查 `test-results/d1-api-check-20261030-final.log`：46 个文件、570 项单测，14 项隔离工具测试，lint、类型检查和构建通过。最终 Web 检查 `test-results/d1-web-check-20261030-final.log`：14 个文件、115 项单测，lint、类型检查和生产构建通过。根门禁此前也已通过，日志 `test-results/d1-check-20261030-final.log`；其后细小的 UUID/手机间距修改由上述分层检查复核。

生产浏览器首轮 10/11 通过，唯一失败为旧测试仍查找 `SIGNALS 001`；已同步为三个独立计数。失败日志和 trace 保留在 `test-results/d1-browser-production-20261030.log` 及 `test-results/d1-runtime/`。最终 `npx playwright test --config playwright.runtime.config.ts --output test-results/d1-runtime-final` 为 11/11 通过，日志 `test-results/d1-browser-production-20261030-final.log`。新增用例覆盖 390px 的最新本人定位、80 项列表、固定 focus 链接、筛选拒绝、72/80 点预算及全屏画布宽度；桌面和手机 PNG 已查看，位于 `test-results/d1-runtime-final/production-D1-keeps-latest-24942-bile-and-API-sample-budgets-chromium-production/`。

原始性能文件为 `test-results/d1/galaxy-<runId>-<81|520>.json`，每个规模记录 4 次真实 Fastify 请求、响应体字节数和进程堆差值。修复前 runId 为 `2732143b32f3`；首轮修复后为 `0f9ea4c1b194`。520 条下耗时从约 181–197 ms 变为 200–215 ms，首次观测堆差值也较高，故继续消除图内重复整理。保留这一轮，不用后续数据覆盖它。

最终隔离轮为 `run-XB5qvZ`（runId `31da607934fe`）：83/83 通过，failed / pending / todo 均为 0，exit 0，cleaned true。证据为 `test-results/d1-integration-20261030-final.log` 与 `test-results/integration/run-XB5qvZ/{manifest.json,vitest.json,runtime-marker.json}`；源码文件指纹见 `test-results/d1-source-20261030.json`。最终轮同时验证计数、坏确认排除、匿名不返回本人 ID、频段和旧 theme 筛选、大小写 UUID 定位、越界/私密/撤回 focus 拒绝及稳定重复结果。

相同方法下每个规模各 4 次请求的实际观测如下，未取代或覆盖前两轮：

| 公开合成行数 | 旧版耗时范围 | 最终版耗时范围 | 旧版 / 最终版堆差值 | 最终返回点 / 响应字节 |
| --- | --- | --- | --- | --- |
| 81 | 115.1–186.3 ms | 126.5–184.5 ms | +22.9 / -3.9 MiB | 80 / 61,267 |
| 520 | 181.1–196.8 ms | 151.5–165.2 ms | +15.7 / +14.1 MiB | 80 / 61,318 |

旧版两轮都只有 79 个有效点：坏确认曾占用截断名额，读取时才被剔除。新版从有效候选中取样，返回 80 个合法点，并增加完整的公开计数。当前夹具下最终耗时没有明显退化，520 条数据请求反而较低；响应大小和图计算仍由返回预算约束。堆差值受 V8 垃圾回收影响，负值不代表负占用，也不是峰值、常驻内存或泄漏结论。不把少量本机请求推作生产 SLA、压力测试或真机帧率证据。

开发模式 E2E 首轮为 4/6，两处仍查旧计数文案，日志及 trace 保留在 `test-results/d1-browser-development-20261030.log` 和 `test-results/e2e/`。剩余断言已按实际新文案同步；最终 `npm run e2e -- --output test-results/d1-e2e-final` 为 6/6 通过，日志 `test-results/d1-browser-development-20261030-final.log`，覆盖原有生成、确认发布、移动星图及保留 onboarding 的 focus 链接。运行后恢复 Next 自动修改的类型路径和 tsconfig include。

本轮无依赖改动，未重复 `npm ci`；无部署 shell 改动，未运行 `deploy:test`。真实手机、读屏器、长时内存和实际帧率未测试；完整焦点/降运动仍待 D3。所有测试仅使用合成资料，未读取真实账号、原文或生产配置。

## 兼容、迁移与回退

无数据库或依赖迁移，无新生产配置。新增查询/响应为可兼容扩展；旧客户端可忽略 coverage，新客户端对旧 API 采用上述降级。应用回退恢复本轮 API/contracts/Web 及 runtime 校验清单即可，保留全部信号、确认和撤回历史。回退会恢复旧取样覆盖限制，不应据此重置确认或公开私密内容。

精确确认计数需要扫描符合 SQL 公开条件的快照，总工作量随有效记录数线性增长；128 批次与 80 点预算限制应用持有的数据及图计算量，不代表数据库工作与总量无关。更大数据量需要另测索引、计数维护和延迟，不能用 520 条证明任意规模性能。

下一项为 D2 视觉语义校正；D3、D4、E、F 和参赛资格未因本轮自动完成。
