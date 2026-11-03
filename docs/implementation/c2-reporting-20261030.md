# C2 普通频率举报闭环（R06）

状态：C2 本地验收通过。基线 `34c1dde`，沿用 `feat/c1-withdrawal-privacy`；本轮范围仅为 C2。未推送、合并或部署。

## 原行为与设计

原结果页和星图阅读面板没有举报入口。原 `createReportRecord` 直接插入，无目标公开条件、并发去重或端点预算；创建响应复用后台完整详情。回归单测 `c2-report-unit-before-20261030.log` 复现两项行为差异：返回审核文本/举报者代号、允许没有公开阅读入口的账号目标。旧服务的 MUTED 禁止提交规则保留。

新入口复用已有 `/api/reports`、`reports` 表和管理员队列，不引入新举报对象。页面只举报当前公开信号；服务端在事务中按举报账号、目标信号的顺序锁定并复核 ACTIVE、确认快照、版本、完成状态、撤回及审核状态。同一账号对同一信号尚未处理的举报返回同一回执，首次原因和说明不会被重试覆盖；处理后可提交新的问题。

普通提交不自动隐藏内容，也不调用 AI。后台继续通过原队列读取完整原因/说明并处理、隐藏目标。举报人状态响应只含回执、目标信号 ID、处理状态和时间，不含举报人身份、原说明或内部处理备注。被举报方及其他账号不能查询他人的回执。

## 接口与兼容

- `POST /api/reports`：ACTIVE 会话；`targetType=SIGNAL`、UUID `targetId`、2–80 字符 `reason`、可选最多 500 字符 `note`。保留 201；重复待处理提交仍为 201，并返回原回执。所有成功和失败响应禁用持久缓存。
- `GET /api/reports/signal/:id`：只读取当前会话自己对该信号最近一次举报的状态；没有记录时返回 `{}`。撤回后仍能查自己的历史处理状态，不返回目标正文，也不要求目标重新公开。
- 新共享 DTO 位于 `packages/contracts/src/reports.ts`；Web 在网络边界验证目标 ID、状态、时间和字段白名单。
- 创建响应从后台详情收窄为回执。旧客户端不能再读取 `note/reason/reporterFreqCode/resolution`；已有后台接口保持原契约。
- 普通创建不再接受 `USER`。当前产品没有可举报的公开账号阅读入口，C1 也不公开内部作者 ID；旧 USER 举报仍在后台可读、可处理。本轮没有新增账号举报 UI 或恢复遗留对象。

## 界面

公开结果页和 Galaxy 阅读面板均提供“举报”。原生 modal dialog 具备标题关联、键盘焦点限制、Escape 关闭及回到触发按钮；Galaxy 中关闭举报不会关闭底层阅读面板。支持原因、说明、提交中、失败、私密回执、刷新状态及登录入口。不将说明写入 URL、浏览器持久存储或诊断。390px 与键盘操作须以最终浏览器记录为准。

## 配置、迁移与回退

没有数据库 schema 或数据迁移。并发提交使用既有目标行锁串行化，不增加历史唯一约束，也不删除或合并旧举报。

共享 Redis 策略增加 `reportRequestUser`、`reportRequestIp`、`reportReadUser` 三个必填预算，分别约束提交账号、提交 IP 和查询账号。所有 API 副本必须同步代码及配置；旧生产策略缺字段会拒绝启动。新旧举报写入者混跑不具备本轮去重和公开过滤保证。示例中的零额度表示拒绝，不能当作生产推荐数字。

界面回退可先恢复旧 Web 并保留新 API；若必须回退 API，应先在入口关闭 `/api/reports`，再同时恢复旧 API/contracts 和旧策略结构，旧解析器也会拒绝新字段。旧 API 不具备 C2 的新约束，不能仅隐藏按钮就声称回退后仍有同样保护。保留举报记录，不回滚或擦除审核历史。本轮只记录方案，没有执行生产切换。

## 验证

首轮回归单测 2 失败 / 1 通过，证据保留。首轮 `api:check` 561 通过 / 1 失败，失败为既有路由测试仍要求返回已移除的后台字段；断言已同步。

首次真实隔离集成为 `run-4lMrBL`：81 项中 80 通过、1 失败，exit 1，cleaned true。新增跨 PID 举报例在创建信号时返回 503，未进入举报断言：夹具漏将 `reports` 案例加入生成 worker 开关，同时新路由也未进入该案例的调用白名单。已补齐夹具，并增加 INFO 级日志的合成说明 marker 检查；不改变生产代码或放宽业务断言。首次日志为 `test-results/c2-integration-20261030.log`。

首次生产模式浏览器为 9/10 通过。键盘反向 Tab 会将焦点移出原生 dialog，已增加首尾 Tab/Shift+Tab 显式环绕；此项是交互修复，没有削弱测试。首轮日志为 `test-results/c2-browser-production-20261030.log`，原始 trace 另存为 `test-results/c2-report-focus-before.trace.zip`。

- `npm run check`：API 45 个测试文件、564 项单测，Web 13 个测试文件、112 项单测，14 项隔离工具测试，以及 contracts/API/Web lint、类型检查和构建通过。日志为 `test-results/c2-check-20261030-final.log`。
- `npm run api:integration` 最终轮 `run-RPRv2N`：6 个文件、81/81 通过，failed/pending/todo 均为 0，exit 0、cleaned true。证据为 `test-results/c2-integration-20261030-final.log`、`test-results/integration/run-RPRv2N/{vitest.json,manifest.json,runtime-marker.json}`。这是串行隔离测试，使用真实 Fastify/PG/Redis 与回环 Provider。包含 5 个并发举报去重、本人/他人/匿名回执边界、后台队列处理、目标状态拒收、跨 PID 的账号/IP/查询预算，以及 INFO 日志无合成说明/凭据 marker。源码基线和本轮修改文件 SHA-256 另见 `test-results/c2-source-20261030.json`。
- 焦点环绕修复只涉及 Web；修后 `npm run web:check` 再次通过，112 项单测及生产构建通过。日志为 `test-results/c2-web-check-20261030-final.log`。
- `npx playwright test --config playwright.runtime.config.ts --output test-results/c2-runtime-final`：10/10 通过。日志为 `test-results/c2-browser-production-20261030-final.log`。覆盖真实浏览器键盘选择/提交、Tab/Shift+Tab 环绕、Escape/按钮关闭及焦点恢复、刷新页面后的回执恢复、处理状态更新、匿名登录提示、429 反馈，以及实际 canvas raycast 打开阅读面板后的举报操作。
- `npm run e2e`：原有开发模式浏览器 6/6 通过，日志为 `test-results/c2-browser-development-20261030.log`；运行后恢复 `next-env.d.ts` 原生产类型导入，并移除 Next 自动附加的 `.next/dev/dev/types` include，没有保留开发模式配置漂移。
- 已查看 `test-results/c2-runtime-final/production-reporting-suppo-b62ba-nd-mobile-focus-restoration-chromium-production/c2-report-mobile.png` 和 Galaxy 举报弹窗截图。内容均为合成数据。上述浏览器使用回环合成 API，不能代替真实 SQL/Redis 权限及并发验证。

本轮未更改依赖或锁文件，未重复 `npm ci`；未更改部署 shell，未运行 `deploy:test`。沙箱首次单测因临时目录 rename EPERM 未执行，随后使用本机权限完成真实检查。物理手机及屏幕阅读器未实测；390px Chromium 和键盘记录不能替代这些设备证据。

下一项为 D1 Galaxy 覆盖与“找到自己”。C2 验收不代表 D/E/F、参赛资格或生产发布已完成。
