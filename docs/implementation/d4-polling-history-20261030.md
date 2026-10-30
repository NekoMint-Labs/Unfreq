# D4 轮询、续写上下文与历史统计（R15/R16）

状态：D4 本地验收通过，进度已更新；远程同步状态见总进度表。依据所有者提供的 `Unfreq_Implementation_Spec_v1.md` 的 D4；基线 `926a6e3`，分支 `codex/d4-polling-history`。沿用 `E:\unfreq`，不合并、部署、修改生产数据或调用收费 Provider。

## 问题和修复前证据

旧生成页使用 1300ms 的 `setInterval`，没有等待上一次请求结束，成功后也未清除旧错误。旧首页的登录链接固定跳转到 onboarding，丢失 seed 和 parent。旧历史总计及最高记录从最新 80 条计算。

真实隔离回归 `run-rH0D4l` 为 83 通过、2 失败：85 条已完成合成历史应累计 584 次共鸣，旧接口只返回 80；月度回顾查询把 WRITING/FAILED 也纳入，返回 3 条而不是 1 条。exit 1、cleaned true。证据为 `test-results/d4-integration-before-20261030.log` 及该运行的 manifest/JSON。

浏览器修复前记录 `test-results/d4-browser-before-20261030.log` 保留三项失败，其中续写与历史 UI 暴露缺项；轮询案例首先碰到 Next 路由播报器也使用 alert 的选择器歧义，不能把这一失败说成旧页面的慢网实测。旧轮询的重叠风险由源码时序确认，后续以慢请求浏览器测试和生命周期单测验收。

## 改动

- 轮询以请求结束为下一次计时起点，单次超时 8 秒；连续失败最多 4 次，退避上限 8 秒，随后暂停并提供“继续查询状态”。成功清除旧错；完成、失败、取消和卸载都停止调度，卸载中止 fetch，忽略晚到结果。恢复查询不重建信号，明确失败后的“重新发射”仍是独立动作。信号 ID 作为组件 key，避免新 ID 沿用旧状态。
- 续写只在当前标签页的 sessionStorage 保存至多一份 seed/parent，不保存凭据或导航目标。seed 上限 200，父 ID 校验 UUID；登录后可继续编辑、刷新，提交成功或主动清除后移除。新的续写/登录 URL 只携带受控标记；兼容旧 URL 输入时载入后移除 seed/parent。禁用暂存时不会回退为包含正文的 URL。没有新增服务端保留期、草稿表或跨设备同步。
- 登录跳转在客户端和服务端共同限制到已知站内路径与允许的查询参数，剔除正文、父 ID 和未知参数，拒绝外部地址、编码分隔符及控制字符。已登录时也遵守合法返回目标。
- 历史以现有作者私密口径统计：`authorId` 属于当前频率、`COMPLETED`、非 `DELETED`，包含撤回、审核等私密历史。只读 repeatable-read 事务同时读取全量 count/sum、最高记录和当前页，返回最多 80 条，内部仅多读一条判断下一页。最高记录按共鸣、创建时间、ID 降序处理并列；列表按创建时间、ID 降序。游标保留数据库的六位小数时间，不经 JavaScript Date 截断。
- `/api/me/signals` 保留原字段，新增 `totalSignalCount`、`topSignal?`、`page`；共享客户端类型允许缺少新元数据，以兼容旧服务器。当前 API 始终提供分页/全量统计；非法 limit/cursor/未知参数返回 400。每页重新检查作者范围，游标不是访问凭证。
- `/me` 区分本页和全量统计，提供较早/最新记录；频段及想法树标注为本页。回访摘要不再从 80 条推算全量最高。新月度回顾输入补充 COMPLETED 条件，既有私密月报快照不自动重写。撤回不丢私密计数；逻辑删除在后续统计中排除，不执行物理擦除。

主要影响 signals/auth 查询、contracts、生成等待页、首页/登录/结果页、本人轨迹及相关测试；没有 schema、依赖、全局状态库或生产配置变更。

## 验证过程

首轮根检查通过 API 572、Web 128 单测及 lint/类型检查/构建。补充客户端元数据校验测试后 Web 为 130 项。最终结果以单独日志为准。

首轮修复后隔离 `run-LdujwV` 为 84/85：全量计数、微秒边界、最高记录、撤回和逻辑删除断言已通过，唯一失败在错误分页参数被原始 Zod 异常报为 500。改为请求边界 safeParse 并抛出应用 VALIDATION_ERROR；响应契约错误仍保留为内部错误。失败记录见 `test-results/d4-integration-20261030-r1.log`，没有覆盖。

首轮 D4 浏览器 4/6，登录保留、编辑刷新、清除草稿、历史分页及外链拒绝通过；两项轮询测试暴露了 Next 播报器选择器歧义和 Service Worker 绕过 page.route 拦截。修正测试作用域，并仅在 D4 网络拦截组阻止 Service Worker，未修改应用的 PWA 行为。原日志/trace 在 `test-results/d4-browser-production-20261030-r1.log`、`test-results/d4-runtime-r1/`。

五项轮询单测覆盖慢请求不重叠、成功后退避复位、终态停止、连续失败上限、超时和取消后忽略晚到结果。续写解析、受控跳转和有界历史响应另有单测。真实数据库覆盖 85 条历史、首屏之外最高记录、同微秒时间排序、撤回保留、删除最高及游标边界记录、跨频率隔离和非法参数。

最终根检查 `test-results/d4-check-20261030-final.log` 通过 14 项隔离工具检查、API 47 个文件共 572 项单测、Web 18 个文件共 130 项单测，以及 lint、类型检查和构建。

修正 Service Worker 作用域后的整套浏览器先为 21/22，剩余失败仅为生成完成后同一正文同时出现在作者私密预览与发布预览，导致最后一条文本断言不唯一；网络串行、清错及结果跳转此前均已通过。收紧到发布预览区域后，同一应用构建的最终生产浏览器为 22/22，见 `test-results/d4-browser-production-20261030-verified.log`；原失败保留在 `test-results/d4-browser-production-20261030-final.log`。开发 E2E 6/6，见 `test-results/d4-browser-development-20261030-final.log`。

已查看 390px 的较早历史页截图：本页 5 条、全部 85 条、总共鸣 584、历史最高 500 同时显示；没有用本页数字覆盖全量统计。截图为 `test-results/d4-runtime-verified/production-D4-request-life-5b170-est-top-record-across-pages-chromium-production/d4-history-mobile.png`。浏览器统计由合成 API 提供，不替代真实 SQL 验证；所有测试均无真实模型质量或生产性能结论。

最后独立运行的隔离集成为 `run-MBcPYs`，runId `2f3f8c9abce1`：6 个文件、85/85 通过，exit 0、interrupted false、cleaned true。日志 `test-results/d4-integration-20261030-final.log`，原始 manifest、JSON 和运行标记位于 `test-results/integration/run-MBcPYs/`。该轮包括非法参数 400、删除游标边界后继续读取四条较早记录，以及原有连接故障、进程恢复与共享预算回归。源码指纹见 `test-results/d4-source-20261030.json`。

## 兼容与回退

无数据库迁移。新字段为追加，默认仍最多 80 条；旧客户端可忽略元数据，新客户端面对旧服务器时只显示本页口径。游标带版本并校验日期/ID，内容仅为分页位置，权限始终由当前会话决定。

D4 单独提交，可整体 revert 并重跑检查，保留 C1–D3。回退不改用户数据或历史月报；旧客户端不会使用新的标签页续写格式，草稿可主动清除或随标签页关闭结束。下一项为 E1：实际 Provider 血缘与向量版本契约。
