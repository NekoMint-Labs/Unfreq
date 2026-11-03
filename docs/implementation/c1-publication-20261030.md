# C1 发布确认、撤回与公开读取（2026-10-30）

工作目录为 `E:\unfreq`，沿用 `feat/c1-withdrawal-privacy`，本轮从 `b1cefa0` 接续。原交接记录保留在 [c1-handoff-20261029.md](./c1-handoff-20261029.md)。本次只修改和验证本地代码，没有生产迁移、部署、推送或真实收费 Provider 调用。

## 接口与状态

- `GET /api/signals/:id/publication-preview`：只供 ACTIVE 作者读取当前完整公开候选，返回正文、FM 代号、最多三个标签，以及绑定这些字段的 digest 和当前 version。
- `POST /api/signals/:id/publish`：必须提交 `expectedVersion` 与 `digest`。事务按账号、信号的顺序加锁，复核实际作者、账号和审核状态；旧请求不能覆盖新版本。空请求不再构成发布同意。
- `POST /api/signals/:id/withdraw`：必须提交 `expectedVersion`。撤回保留内容、确认历史和互动关系，并使公开版本递增。已撤回时的重复请求不再修改状态；重新发布后，旧撤回请求返回冲突。
- 作者结果标为 `PRIVATE_OWNER`；公开结果标为 `PUBLIC`，只使用确认快照投影。审核受限结果仍不包含正文。后台隐藏及逻辑删除继续保持普通详情不可达，作者不能自行重新发布。
- 再发布必须重新展示完整预览并由作者确认，不能绕过待审核、隐藏、删除或账号限制。撤回期间保留收藏、共振和回声关系，再发布后可继续读取这些历史互动。

升级时须应用已有的 0024 迁移，并同步更新 API、contracts 和 Web。旧客户端的空 publish 请求会被拒绝；缺少确认的历史 PUBLISHED 内容不会继续公开，无作者样例仍待另行人工确认。

## 公开字段及用途

公开正文、FM 代号和标签来自同一份确认快照。公开 DTO 不包含 `rawInput`、`seedText`、`fingerprint`、`frequencyProfile`、`program`、内部账号 ID、`guestKey`、父对象 ID 或历史匹配对象 ID。原始输入字段不公开，不代表确认正文一定不含与原句相同的文字；页面要求作者检查实际正文。

| 元数据 | 用途与范围 |
| --- | --- |
| `id` | 信号定位和互动目标；不返回作者内部身份 ID。 |
| 创建、更新、确认时间 | 列表排序、私密页状态与公开发布时间。 |
| `publicationVersion` | 识别发布世代，拒绝旧任务、旧音频和在途响应中的旧对象。 |
| `status` / `visibility` | 区分公开 DTO、作者私密 DTO 和无正文的审核提示。 |
| 共振、回声计数 | 展示当前互动数量；不返回参与者身份列表。 |
| `hasSaved` / `savedAt` | 仅向相应访问者返回其收藏状态或收藏时间。 |
| `source` | 表示既有 human / seed / ai_generated 内容来源，不构成确认依据。 |
| 匹配分值、候选 ID | 展示关联并跳转；每个候选必须仍属于当前公开版本。 |
| 星图位置、`isMine`、连线 ID | 绘制星图及本人标记；只连接本次可见点，不返回完整向量或分析。 |
| `primaryBand` | 仅为已显示在确认标签中的频段提供筛选和颜色索引。 |

详情、Hall、随机、星图点线及主题、匹配、收藏、回声父对象和互动事务均检查公开条件：PUBLISHED、COMPLETED、未撤回、有效作者确认快照、有效版本。旧 PUBLISHED 数据和未确认系统样例先停止公开，不批量补写确认。

公共响应使用白名单。整份 `program` 被排除，因此历史 `rightSignalSummary` 等系统复制内容不能从公共节目或分享字段继续返回。作者的独立续写仍按独立作品处理，不宣称自动撤销人工引用。

匹配在异步调用后重新检查父信号和每个候选的原版本；向重排 Provider 发送的候选正文也来自确认快照。收藏、共振及回声写入在事务中锁定父信号，使撤回事务提交后不能继续新增公开互动。

## 音频与缓存

朗读任务绑定发布版本和 audio attempt，只朗读确认正文。申请任务、调用 Provider、写文件及写 READY 前均受当前任务和公开条件约束；撤回使旧 token 失效，新确认重置旧缓存状态。

前端也将音频相对地址解析到与 JSON 请求相同的 API 地址，兼容前后端分端口运行及 `/api` 代理。新音频及分享图地址带 `?v=<publicationVersion>`，避免应用在重新发布后继续使用同一个历史缓存地址。音频下载会核对请求版本，并在读取文件后再次核对公开状态；分享图会在 PNG 渲染完成后再次核对版本和公开状态。旧版本地址不能从源站取得新世代内容。音频、公开信号 API、作者 API、月度回顾和 OG 使用 `private, no-store`。Web metadata 与 OG 独立匿名读取，作者 cookie 不能使私密内容进入分享输出。浏览器收到明确的访问或版本拒绝后，不再回退为朗读旧页面缓存文字。

新的缓存指令不能追溯清除浏览器或第三方已经缓存、下载的旧副本。平台不能收回已经发出的网络响应，也没有在本轮执行硬删除、保留期清理、注销或备份销毁。

## 验证记录

- 最终 API 检查：`test-results/c1-api-check-20261030-final.log`，559 项单元测试通过，lint、类型检查和构建通过。
- 首次接线集成：`run-gQiP5r`，78 项中 68 通过，10 失败，exit 1，清理完成。失败证据保留。四个 B3 朗读用例被夹具的旧 URL 白名单拦截；其余涉及旧音频夹具未确认或缺少版本、幂等断言误比较 requestId，以及前一个失败留下公开控制行后造成的连带断言失败。
- 修正夹具后的整轮：`run-OHAVhD`，78/78 通过，exit 0，清理完成。它尚不包含随后补充的带版本音频 URL；不能把这一轮证据直接转给后续代码。
- 最终隔离集成：`run-kX2pMT`，78/78 通过，failed / pending / todo 均为 0，exit 0，cleaned true。证据为 `test-results/integration/run-kX2pMT/vitest.json`、`manifest.json` 和 `test-results/c1-integration-20261030-final.log`；运行时 entry SHA-256 为 `a363581200c1d1275bad3ae148ffe395dd1afdb2deef5b6e6ee68d00516644aa`。这轮包含带版本音频地址及旧版本拒读；完整源码及模块哈希见同目录 `runtime-marker.json`，entry 哈希只代表入口文件。
- 最终 Web 检查：`test-results/c1-web-check-20261030-complete.log`，96 项单元测试、lint、类型检查及生产构建全部通过。
- 生产模式浏览器：`test-results/c1-browser-production-20261030-final.log`，7/7 通过，包括作者发布、撤回、重新确认、匿名详情、metadata/OG、PNG 卡片和复制链接，以及 390px 星图筛选、旧页面拒读后不朗读缓存文字和 PNG 渲染途中撤回。
- 开发模式浏览器：`test-results/c1-browser-development-20261030-final.log`，6/6 通过。首轮 5/6 的失败是旧文本定位同时命中私密正文和新增发布预览，已改为验证预览区域；首轮日志保留。
- 页面截图：`test-results/runtime/production-author-withdraw-0b17d-isible-preview-to-republish-chromium-production/` 下的 `c1-preview-desktop.png` 与 `c1-withdrawn-mobile.png` 已人工查看。截图均为合成内容。
- Web 首轮新增契约测试曾因同目录 `@/lib` 别名无法被 Vitest 解析而失败，已改用同目录相对导入；原日志 `test-results/c1-web-check-20261030.log` 保留。

新增验收覆盖完整发布、收藏与互动、撤回后全部公开入口拒读、作者私密保留、再次明确确认恢复历史互动、旧版本冲突、旧内容及无作者系统样例非公开、在途生成及朗读不能使内容复活。匹配单元测试另覆盖配置等待期间撤回、重排期间换版本，以及 Provider 输入只使用已确认候选正文。

原先两项冷启动和 closeearly 完成观察失败在本轮串行隔离运行中通过；20 秒冷启动和 5 秒完成观察预算没有放宽。B3 增加了导入、构建和 ready 的分阶段时间证据。最终一轮 40 个 B3 子进程的最大 ready 耗时为 5434 ms，证据位于 `test-results/b3/boot-ce0445f07ab3-*.json`。这说明当前串行环境通过，不能据此承诺高负载机器上的启动 SLA。

浏览器验收使用回环合成 API；真实 Fastify、PostgreSQL、Redis、并发与任务失效由隔离集成验证。这两类证据分别记录，不冒充生产部署验收或真实模型质量评估。
