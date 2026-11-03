# C1 独立实现与 main 协调

基线为 main `e5b459cf0e067fa391befb095bf3e87b9370cc41`。本分支落实 [A3 后续评论](https://github.com/NekoMint-Labs/Unfreq/pull/3#issuecomment-6604180694)，供独立代码评审，不执行合并或生产操作。

## 提取来源与范围

依次重放已有 `a523c35`、`8f3e3e0`、`b1cefa0`、`34c1dde` 的 C1 实现。仅补入 `baf41d3` 中审核中内容的详情权限和后台授权回归。未复制旧维护基线，未引入 postgres v4、C2、D/E/F 功能、后续依赖覆盖或镜像验证框架。

- 作者查看完整发布预览后，使用当前 version 与正文、FM 代号、标签的 digest 确认发布。事务按账号、信号顺序加锁，复核作者、账号、审核与内容状态。
- 公开 DTO 使用确认快照及逐响应白名单；详情、Hall、随机、Galaxy、匹配、收藏、互动、SSR/metadata、OG 与音频均遵守可见性和发布版本。原始输入、完整分析、内部身份和系统复制摘要保持私密。
- 撤回保留作者私密副本，使公开入口与旧媒体版本失效；重新发布需要重新展示预览并确认。旧 publish/withdraw 请求及在途音频、匹配、PNG 不能恢复已撤回版本，也不能绕过审核。
- 非作者（包括匿名访问和通过普通详情路由访问的管理员）读取 REVIEWING 时，得到与不存在 ID 相同的 `404/NOT_FOUND`。作者私密读取与授权后台读取保留。

保留 main 的 generation owner、晚到写入栅栏、共享额度，以及受理 INSERT/关停交错和重启接续回归。运行来源清单合并 C1 模块与 main 已登记模块；不覆盖 main 的恢复夹具。合成浏览器继续使用正式 cookie 名 `unfreq_session`。

## 迁移与历史数据前提

仅增加 `0024_c1_publication_foundation.sql`，接在 main 既有 0023 后；保留全部既有 SQL 和 journal 顺序。API、contracts 与 Web 必须作为同一契约版本发布。

迁移新增撤回时间、发布版本、作者确认快照与确认时间。缺少有效确认的历史 PUBLISHED 行和无作者系统样例停止公开；不批量补写同意或推定历史确认。旧客户端不带 version/digest 的 publish 请求会被拒绝。历史内容须由相应作者重新查看预览并主动确认，系统样例的处置另行决定。

本分支不增加硬删除、保留期、备份销毁或生产数据恢复操作。撤回不能收回已发送响应、已下载文件或第三方已缓存副本。

## 本分支验证入口

四项既有 CI 门禁保持：`api checks`、`web checks`、`Deployment script tests`、`Isolated API integration`。Web 独立作业仅补充构建 contracts 的必要前置步骤。真实隔离集成继续创建临时 PostgreSQL/Redis，保留原故障/恢复预算和断言，并验证 C1 权限、公开投影、撤回/发布并发及在途任务失效。

新增 `C1 production browser`，在 Linux 上干净安装、构建真实生产 Web，并执行原生产浏览器套件及提取的 C1 用例。API 为回环合成夹具；它验证页面、SSR/metadata 和 OG 行为，不代表真实模型或生产环境验收。数据库与并发证据由真实隔离集成提供。

历史 C1 文档中的 78/78、7/7 等结果仅记录原版本。本次精确 Head 的运行结果和链接记录在 PR 描述及评论中，不继承旧维护栈成绩。
