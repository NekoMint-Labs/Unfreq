# A2 / R10：统一门禁与隔离 API 集成

状态：本地实施、真实集成、干净安装、最终完整门禁和容器安装验证完成，待草稿 PR 评审。

## 基线与行为

- Base：`e72727e8b1aa943a452d0e6e246920d200731c7c`（A1 已验证提交，未自行合并 main）。
- 已验收实现 SHA：`676aca5a94a9457fe3f70937821389a51083789d`；本报告随后独立提交，最新分支 Head 以 Git 记录为准。
- 分支：`test/a2-isolated-integration`。
- 原根 `check` 未执行 Web Vitest；已有 CI 单独执行 Web 单测，原浏览器 E2E 使用模拟 API。
- 现在 `web:test` 并入 `web:check`，根检查真实运行 Web 单测；CI 删除重复执行并增加独立真实 API 集成 job。
- API 默认单测只收集 `src/**/*.test.ts`，隔离 env 和 Provider 配置；signals route 单测补齐配置替身，消除无密钥时仍隐式查询本机 PG 的路径。

## 新增隔离链路

托管 runner 使用随机 Docker 项目、固定测试 Compose / 镜像 digest、空 env 文件和 loopback 随机端口，拒绝既有连接参数、TCP Docker host 与远端 UNC npipe。测试端再次验证身份及空库，运行真实历史迁移。AI 仅允许本地 HTTP 桩，阻止其他 fetch。

使用真实 Fastify inject、PostgreSQL、Redis、鉴权、唯一约束、存储、生成编排和审计路径。Redis 邮箱认证的透传观察不替换业务返回值；AI 输出是合成契约夹具，不代表模型效果。

结束时等待后台任务、关闭应用和客户端；检查本项目容器标签后清理，再复核容器与网络均不存在。清理期间不因普通中断杀掉 `down`。测试失败、报告失败 / 跳过 / todo、资源未清理都会返回失败。

## 真实故障发现与 F1 提前修复

首轮 9 项核心流程通过，但 FIN 夹具下注册等待超过 20 秒；独立诊断在 1.3 秒内仍 pending，并有 103 次连接尝试。该数字来自单次合成故障，不是线上损害或性能测量。

确认当前 `postgres@3.4.9` 的初始重连缺陷后，没有通过放宽超时或改成 RST 来宣称问题已解决。RST 与 FIN 分开测试；提前处理 F1 的这一个依赖恢复阻塞点，其他 F1 事项保持原计划。

固定依赖版本，通过严格版本 / integrity / 四文件哈希安装可回滚的 Node ESM/CJS 补丁。关闭连接时真正结算旧请求并释放池槽；修复预留请求重复排队、内部类型加载拒绝及启动计时范围。详见[补丁说明](../postgres-startup-patch.md)。

补丁后独立诊断一次连接即拒绝，真实 API、事务 / 预留连接、排队、类型加载与恢复也通过默认集成回归。没有仅在 HTTP 层添加超时；恢复后旧注册未补写，新请求可以成功。

## 验证记录

| 验证 | 当前结果 |
| --- | --- |
| API lint / 扩展类型检查 | 通过 |
| 根 `npm run check`（首次门禁接入） | 通过：API 220、Web 38，证明 Web 单测已进入根检查 |
| 真实集成 | 通过：3 文件 / 30 测试；0 failed / pending / todo，runner exitCode 0，cleaned true |
| 安装器与 runner 工具测试 | 通过：8 项，无 skipped / todo |
| EOF 原始失败诊断 | 已保留：exit 1、pending、强制收尾后无自有 socket 残留 |
| EOF 修复后诊断 | 通过驱动诊断：CONNECTION_CLOSED、1 次连接、0 残留；完整 API 验收以默认 30 项套件为准 |
| 部署脚本 | 通过：5 项；使用替身命令，未部署 |
| `npm ci --offline --no-audit --no-fund` | 通过：532 packages，postinstall 自动 applied 4 / verified 4 |
| Docker API `prod-deps` 构建及无网络容器补丁核验 | 通过：`npm ci --omit=dev` 安装 179 packages，自动 applied 4 / verified 4；随后 `--network none` 容器复核 applied 0 / verified 4，证明干净安装已完成补丁 |
| 修复后的最终根检查 | 通过：API 26 文件 / 220 项、Web 8 文件 / 38 项、工具测试 8 项，lint / typecheck / build 全通过，exit 0 |

本轮中间还遇到 Windows Compose 插件路径遗漏、Fastify inject 请求类型，以及代理 close 事件等待问题，均保留失败日志并修正。最终干净安装后的根检查在并行容器下载时有 4 项首次应用启动超时；现限制 API 单测最多 2 个 worker，控制冷启动资源争用，保留 5 秒超时及全部用例。没有阶段计时，不将资源争用当作已证明的唯一原因；保留失败和调整后的完整记录，没有放宽业务断言、增加测试超时或删除失败用例。

容器依赖阶段前两次安装因 `ECONNRESET` 中断。按同一锁文件的 SHA512 核验官方包后补充本地 BuildKit npm 缓存；未更换 registry、依赖版本或锁文件。

本机 Node `22.22.2`、npm `10.9.7`。本次 Linux 安装阶段解析到 `node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914`；Dockerfile 的生产基础镜像标签仍可移动，本次依赖阶段验证不等于完整生产镜像验收。现有 Edge Runtime 弃用提示保留，没有将构建提示当作失败或修复证明。

三张辅助验证镜像均先核对确切标签及本任务标记再删除，并复核标签不存在；没有全局镜像 / 容器 prune，保留安装缓存。真实集成 runner 的容器和网络也已独立核验清理完成。

本地证据在忽略目录 `test-results/a2/`，成功集成 manifest / JSON 在 `test-results/integration/run-YSVGqt/`。不提交原始日志、下载包、Cookie 或环境文件。

## 影响、回滚与剩余范围

修改质量脚本、Vitest / CI、隔离测试与文档；为可复现的启动断连修复增加安装后补丁、精确依赖固定和 Docker 安装阶段 COPY。API/schema/contracts/生产 migration 没有变化。

回滚须成组恢复 package 清单 / 锁、postinstall、补丁与 Docker COPY，再干净安装；仅撤去补丁会重新出现 EOF 缺陷。测试容器、数据库、音频均为合成和临时数据，没有生产操作或真实收费 Provider 调用。

作者撤回仍待 C1；本轮后台隐藏不是作者撤回。生产基础镜像 / 配置、完整应用容器运行、浏览器接真实 API 的联合链路、物理手机与模型效果未由本套测试证明。已执行事务或未知 COMMIT 结果不在启动修复保证内。

完成本轮最终安装验证后，下一项为 A3 数据生命周期规则；未经所有者决策，不实现高风险硬删除或数据保留清理。
