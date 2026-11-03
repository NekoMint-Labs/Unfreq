# 能力与遗留入口清单

核对日期：2026-11-01；源码基线：`bc9c7b1`。本表对应总实施规范 F3 / R20，依据仓库里的页面、API 注册、调用者、schema、后台、任务和部署配置核对。没有读取生产访问日志、真实账号、实际 `.env` 或数据库内容，因此“未发现调用者”只指当前仓库中的静态调用；不能据此推定生产无人使用，更不能据此删表。

## 分类与冻结规则

| 分类 | 本清单中的含义 | 演示与维护规则 |
| --- | --- | --- |
| 正式可用 | 当前普通页面实际接入，有对应 API 和测试代码 | 可按具体页面演示；配置、真实模型效果及目标设备限制另行说明 |
| 内部管理 | 管理员页面、运维 CLI 或进程任务实际接入 | 不作为普通主流程；后台生成、配置测试和重建可能产生外部费用，不能自动执行 |
| 实验中 | API 或组件仍存在，但没有普通页面调用，或完整使用条件未获验收 | 冻结新增功能、主导航和正式演示；继续允许修复权限、数据保护和既有回归 |
| 历史兼容 | 历史数据、枚举和内部代码保留，旧产品 HTTP 入口已移除 | 仅表示数据/实现保留，不承诺旧客户端兼容；禁止恢复兼容路由 |

本轮只登记和统一描述，不新增导航、不关闭现有 API、不启用调度、不调用 Provider、不做迁移或删除。没有页面入口的模块按上表冻结，不能因源码存在就宣称产品已接入。今后如要启用，应先有单独产品决策、显式契约、权限与生命周期设计、测试和回滚记录。

## 正式页面与内部入口

| 能力 / 分类 | 页面和调用证据 | API / schema / 任务证据 | 权限和数据边界 | 测试代码证据 |
| --- | --- | --- | --- | --- |
| 登录、seed、私密预览、确认发布 / 正式可用 | `/login`、`/`、`/signal/[id]/transmitting`、`/result/[id]`；`HomeFrequencyEntry`、`SignalTransmittingClient`、发布/撤回按钮 | `auth/routes.ts`、`signals/routes.ts`；`users` 为身份权威，`frequencies` 为镜像；`signals` 保存生成状态和确认快照；`generation-worker.ts` 持久领取 | 写入需登录；生成、原句、完整分析及未确认正文只对作者；公开绑定作者确认的当前版本，撤回立即停止公开入口 | `auth/routes.test.ts`、`signals/routes.test.ts`、`service-publication-confirmation.test.ts`、`service-withdrawal.test.ts`；`tests/e2e/core-flow.spec.ts` 与 `tests/e2e/runtime/production.spec.ts` |
| 同频匹配、星图、共振、私密收藏、信号举报 / 正式可用 | `/result/[id]`、`/galaxy`、`/me`；匹配面板、Galaxy 阅读弹窗及操作按钮 | `/api/signals/:id/matches`、`/galaxy`、`/:id/resonance`、`/:id/save`、`/api/reports`；`signals`、`signal_resonances`、`signal_saves`、`reports` | 候选须通过公开资格与版本检查；收藏仅本人读取；共振和举报需登录；星图坐标为艺术布局，匹配分数不代表心理诊断或效果证明 | `service-match-projection.test.ts`、`repository.test.ts`、`reports/routes.test.ts`；生产浏览器套件含空匹配、来源、键盘与撤回案例 |
| 已公开正文朗读与分享图 / 正式可用，依配置降级 | 结果页 `SignalPlaybackButton`、`ShareSignalCardPreview`；Web `/api/og/[signalId]` | `GET/POST /api/signals/:id/audio`、`GET /:id/audio/:side`；`audio-worker.ts` 仅合成确认后的 `expandedText`，保存 main 音频；OG 和音频绑定 `publicationVersion` | GET 状态只读；显式 POST 才申请 TTS；访问和晚到写入受公开版本约束；媒体卷保留不等于撤回后仍可由 API 访问。浏览器语音与远程 TTS 是不同能力 | `audio-worker.test.ts`、`ai/tts-lifecycle.test.ts`、`signals/routes.test.ts`、Web 音频策略/URL 测试；生产浏览器套件含撤回后停止朗读和 OG 竞态 |
| 本人轨迹与月度回顾 / 正式可用 | `/me`、`/me/recap/[yearMonth]`；`MonthlyRecapEntry`、`SignalTimeline` | `/api/me/recaps/latest`、`POST /api/me/recaps`、`/:yearMonth`；`monthly_recaps`；无自动月报任务 | 回顾需本人会话，响应 `private, no-store`；生成以已完成且未逻辑删除的本人样本统计，样本不足拒绝。已保存回顾仍是私密历史快照，不随随后撤回/删除自动重写 | `monthly-recaps/service.test.ts`、D4 `core-flow` 集成案例、生产浏览器套件的本人历史案例 |
| 审核、账号状态、Provider 配置、审计与 Demo 指标 / 内部管理 | `/admin`、`AdminDashboard` 及各后台 section | `/api/admin/*`；`provider_configs`、`admin_actions`、`ai_reviews`、`reports`；管理员权限由服务层复核 | 仅 ADMIN；密钥写入后仅回显状态/末四位；配置测试可产生远程调用；Demo 规则夹具不冒充真人标注或真实模型验收 | `admin/routes.test.ts`、`ai/provider-config.test.ts`、`admin/ai-evaluation.test.ts`、Web 后台工作流测试 |
| 系统 AI 内容生成与每日调度 / 内部管理，默认关闭自动调度 | `/admin` 的 AI 信号管理；`POST /api/admin/ai-signals/generate`；`seed-signals.ts` CLI；不在主导航 | `service-generated.ts`、`scheduler.ts`；`app.ts` 的 `onReady` 启动 scheduler 对象；`AI_SIGNAL_SCHEDULER_ENABLED` 默认 `false`；`ai_signal_scheduler_batches` 保存单日领取和预算 | 管理生成需 ADMIN；调度依显式配置和预算。无作者的系统/seed 记录即使历史状态为 PUBLISHED，也没有真人确认，不能因此进入公开候选；不得冒充真人内容 | `scheduler.test.ts`、`admin/routes.test.ts`、`service.test.ts`；F1 隔离证据见实施记录 |

上表中的 API 模块路径均相对 `apps/api/src/modules/`，组件和页面相对 `apps/web/src/`。schema 定义统一见 [schema.ts](../apps/api/src/db/schema.ts)。测试链接表示可检查的已有断言，不表示本轮重新运行过所有历史套件；本轮实际验证结果以 F3 实施记录为准。

## 尚未接入的六类能力

| 能力 / 分类 | 页面、API、后台与调用状态 | 数据、读写权限和副本 | 冻结范围与退役前提 |
| --- | --- | --- | --- |
| 主题电台 / 实验中（管理 API 保留） | `app.ts` 注册 `themeRadioRoutes` 和 `adminThemeRadioRoutes`；匿名 `GET /api/theme-radio/current`、ADMIN `GET/POST /api/admin/theme-radio-days`。Web `lib/theme-radio-data.ts#getCurrentThemeRadioDay` 仅定义，未发现页面调用；`AdminDashboard` 未接入配置表单；无独立定时任务 | `theme_radio_days` 保存主题、说明、起止和 active 状态；公开接口按有效时间读取，后台写入需 ADMIN。测试：`theme-radio/routes.test.ts` 与 `repository.test.ts` | 不演示“今日主题入口”或自动主题节目。保留既有 API；退役前核对外部调用、既有主题数据、运营依赖和 API 消费者通知/回退方案 |
| 自动 persona 共振/留言 / 实验中，当前无触发入口 | `service-interactions.ts#generateSignalInteractions`、`scheduleSignalInteractions` 仍保留，并从 `service.ts` 导出；当前生产源码未发现调用者。后者若被调用会建立进程内 timer，但没有从发布、查询、worker 或 app 生命周期调用；不是上表的每日 AI 内容 scheduler | persona 来源 `config/personas.json`；潜在写入 `signal_resonances`、`signal_echoes`，`guestKey=ai-persona:*`，与真人行共表；生成前重新读取公开信号；定时器/Set 不构成持久任务恢复 | 不接回发布流程、不填充假互动、不把潜在能力描述为已运行。退役须先盘点历史 persona 行、计数/来源展示、约束和引用；明确保留/删除策略、计数重算及回滚，不能混删真人互动 |
| 信号留言（echo） / 实验中，API 活跃 | `signals/routes.ts` 注册 `GET/POST /:id/echoes`；Web `SignalEchoPanel` 和 `lib/signal-data.ts#getSignalEchoes` 保留，但当前结果页、星图页和主导航无调用；`/me` 的历史回声/共振摘要不等于留言输入入口 | `signal_echoes`；公开读取前后复核信号资格；POST 需 ACTIVE 登录账号；潜在 persona 留言同表。`signals/routes.test.ts` 含创建/读取，C1/F2 集成包含撤回资格检查 | 不作为正式评论/留言功能演示；不新增页面输入框。保留读写 API；退役须核实外部客户端、本人历史摘要和旧留言、审核状态、作者数据访问与回滚要求 |
| 双声道节目 / 实验中，保留结构和读取侧别 | Web `DualSignalRadioProgram`、`SignalProgramCard` 仅定义无页面调用；主生成链使用 `service-mappers.ts#buildMinimalSignalProgram`，没有调用 `ai/service.ts#generateSignalProgramWithFallback`；音频路由仍接受 `main/left/right`，实际 worker 生成 main 正文音频 | `signals.program_json`、左右音频 URL/storage key 等历史列和音频卷保留；公开 DTO 白名单不开放完整 program；音频读取仍受确认版本限制；Provider 配置的 voiceLeft/voiceRight 不能证明双声道已接入 | 正式演示只说明正文朗读；不宣称双人节目或两条真实语音轨。退役前核对旧媒体键/客户端侧别、私密 program 数据、单声道别名关系和播放器回退；不能删 main 音频能力 |
| Hall / 实验中，API 活跃 | `GET /api/signals/hall` 实际注册；`SignalHall`、`lib/signal-data.ts#getSignalHall` 保留但没有页面调用；没有 `/hall` 页面，首页是发射器 | 读取 `signals` 的公开投影，受 C1 资格与版本检查；不产生新表、任务或媒体。`signals/routes.test.ts` 含 Hall 公开与草稿隐藏断言 | 不演示“大厅页面”，不加入主导航。退役前核对外部 JSON API 客户端、回归和正式公开读取替代路径；不因 Hall 无 UI 而删除共用的公开查询/投影 |
| 图片上传与托管 / 实验中，独立公开资产 API 活跃 | `app.ts` 注册 `imageRoutes`；`POST /api/images`、`GET /api/images/:id` 可用；当前 Web 没有调用上传 API 的页面/后台表单；分享 OG 是另一路动态 PNG，不使用上传表 | `images` 仅有 uploaderId，没有 signalId 或公开状态；上传需 ACTIVE 会话，每日 20 次并校验 MIME/大小/文件签名；匿名 GET 返回一年 immutable 缓存；`daily_limits` 的 IMAGE_UPLOAD 仍被实际写入；`api-image-storage` 卷保存文件。无普通删除接口 | 不声称随信号撤回失效，也不演示图片发射。不能自动关接口、删卷或删除 daily_limits。退役前确认外部访问、缓存副本、作者权限、孤立文件/记录、保留期限和可恢复迁移；A3 待决事项必须单独决定 |

这六类没有新增主导航。唯一的主导航定义仍是 [copy.ts](../apps/web/src/lib/copy.ts) 中的发射 `/`、星图 `/galaxy`、我的频率 `/me`，由 `RadioShell` 消费。

## 历史产品表与内部 AI 遗留

| 对象 / 分类 | 当前读写证据与权限 | 数据关系与退役限制 |
| --- | --- | --- |
| voices / 旧 resonances / 旧 echoes / 历史兼容 | `app.ts` 不注册 `/api/voices`、`/api/channels`；没有对应 Web 页面和运行时 repository；当前模块未发现这三表的业务读写。旧路由按缺失返回 404 | `voices.author_id → users`；`resonances.user_id/voice_id`、`echoes.author_id/voice_id` 有外键；旧正文、分析、标签、审核状态和互动仍可能存在，不能等同当前 signal 互动后直接合并/删除 |
| bottles / bottle_echoes / 历史兼容 | `/api/bottles` 不注册；没有旧页面或当前业务 repository | 作者、拾取者、保留者关联 users；bottle_echoes 关联 bottles/users。须先获准生命周期方案、逐类备份与恢复验证、引用和权限盘点后另立迁移 |
| daily_radio_reports / 历史兼容 | `/api/radio-report` 不注册；无当前服务/任务读写；与 `monthly_recaps` 和 `theme_radio_days` 不是同一能力 | 保留日期、频道摘要、旧 voice/bottle 计数与文本；不可用当前月报覆盖，不因没有入口销毁历史记录 |
| channel / target_type / limit_type 枚举和 daily_limits / 部分历史、部分仍用 | `channel` 用于旧 voices；target_type 仍含旧枚举值，但当前公开举报创建仅接受 SIGNAL；`reports`、`ai_reviews`、`admin_actions` 仍用共享列。`daily_limits` 正被图片上传事务写 IMAGE_UPLOAD | 不能整体删除共享枚举或表。旧 report/AI-review target 要先保留原始语义和可审计性；是否隐藏/映射见当前 service，不能伪造 SIGNAL 归属 |
| `/api/translate`、产品 `/api/ai/*` 和旧 AI 内部 helper / 历史兼容 | 旧 HTTP 路由未注册；`modules/ai/legacy-types.ts`、`schemas.ts`、`provider.ts`、`service.ts` 仍有 channel 分类/标签/分析/echo helper。旧 classify/tags/moderate fallback 被 `admin/ai-evaluation.ts` 的 Demo 夹具实际使用；`summarizeMonthlyRecapWithFallback` 被当前月度回顾实际调用；旧 moderate service helper 不能因名称被误认为已接入主链 | 冻结无调用 helper；不能直接删除整个 ai 模块、legacy-types 或 prompt 字典。先按符号查全调用及测试，分清后台 Demo、当前回顾/信号生成，保留 AI 审计记录；HTTP 复活需新产品决策和新 DTO |

“历史兼容”的数据保留规则来自 [退役入口决策](../specs/decisions/retired-surfaces-no-compat-routes.md) 与 [生命周期设计](./data-lifecycle.md)。旧表保留不意味着任何旧 HTTP 接口应恢复；迁移文件和 snapshot 是历史建库证据，不是运行时调用者。

## 部署、任务和统一退役门槛

[compose.yaml](../compose.yaml) 当前只部署 proxy、web、api、postgres、redis。没有独立 Hall、主题电台、persona 留言或双声道服务/cron。API 进程实际拥有生成 worker、显式音频任务和默认关闭的每日 AI 内容 scheduler；PostgreSQL、Redis、图片、音频各自持久卷仍须按 F2 清单保留。不存在入口的组件不因部署容器存在就变为已接入。

如需退役上述实验/历史对象，实施前须补齐：

1. 当前仓库全调用、公开 API/外部消费者和目标环境访问证据；只看静态无调用不足以关接口。
2. 各表、外键、审核/审计、计数、媒体和缓存副本清单；区分真人、系统 AI 和演示记录；明确作者读取与处置权限。
3. 获准的保留期/数据处置决定；前向迁移、备份与恢复验证、客户端兼容和失败回滚。不得通过 drop 表、清卷或重写旧确认状态完成整理。
4. 单独变更和最小回归：未登录/非作者/撤回/审核/删除状态、旧数据读取和当前主流程；目标生产操作仍单独授权。

当前已完成的是能力登记和冻结新增范围。实体手机、读屏器、真实模型、人评、生产使用量和目标环境恢复的缺口继续保留在 [总进度](./implementation/progress.md) 及各项实施记录中。
