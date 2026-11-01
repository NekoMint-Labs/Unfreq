# A1 / R22：Next.js 安全维护升级

状态：本地实施与自动回归完成，待代码评审。实际生产镜像和真实 API / 数据库链路仍按下文边界处理。

## 版本与范围

- 核查日期：2026-10-28（Asia/Shanghai）。
- Base SHA：`5f56ec511e5840e06e46d4baded8b4ab92aff0c4`。
- Head SHA（已验收的实现提交）：`951d61990a101462f065d5380a9fca8ea7c849c6`；本报告随后独立提交，PR 最新 Head 以 GitHub 记录为准。
- 本地分支：`fix/a1-next-security`。
- 原锁文件：Next.js / eslint-config-next / @next/* `16.2.6`，React / React DOM `19.2.6`，sharp `0.34.5`。
- 目标锁文件：Next.js / eslint-config-next / @next/* `16.4.3`，React / React DOM 保留 `19.2.6`，sharp `0.35.5`。
- 本机：Windows，Node `v22.22.2`，npm `10.9.7`。

## 原风险与最小修改

[Next.js 2026-10-14 官方公告](https://nextjs.org/blog/nextjs-security-update-october-14-2026) 给出 Next 16 修复版 `16.4.1`，涵盖 Cache Components、图片优化上游依赖和 Server Actions 的安全问题。核查时 npm 的 Next stable 为 `16.4.3`，对应[官方发布记录](https://github.com/vercel/next.js/releases/tag/v16.4.3)。

将 Next 与其 ESLint 配置固定为 `16.4.3`，由包管理器更新成组的 SWC、环境读取和图片处理依赖。React / React DOM 固定为原实际锁版本 `19.2.6`，避免原来的宽范围声明在重新解析时混入不同版本：首次锁更新尝试曾选择 React DOM `19.3.1` 并报告 peer 冲突，没有使用 `--force` 或 `--legacy-peer-deps`。

npm 10 重新生成锁文件时去掉了 42 处 Linux `libc` 平台元数据。逐个查询精确版本的官方 npm 原始元数据，核对 version 与 integrity 后，只补回这些字段；22 处属于未升级包、20 处属于新版 SWC/sharp。全部 8 个 SWC 平台包和 sharp 声明的 25 个 optional 依赖条目保留在锁文件中，没有全量升级其他依赖。

不改变业务状态、权限、数据库 schema、生成机制或页面设计。根质量门禁接入 Web 单测属于下一项 A2。

## 修改文件与契约

| 文件 | 改动 |
| --- | --- |
| `apps/web/package.json`、`package-lock.json` | 成组升级 Next、保留原 React 配对和全部平台元数据 |
| `apps/web/next-env.d.ts` | 官方构建生成的新 `root-params` 类型入口 |
| `playwright.config.ts` | 保留原 6 项模拟 E2E，使用跨平台 Node 启动入口 |
| `playwright.runtime.config.ts`、`tests/e2e/runtime/` | 独立生产 Web 回归、合成 API 和运行说明 |
| `docs/implementation/a1-next-security.md` | 本次证据、验收边界和回滚说明 |

API、共享 contracts、数据库 schema 和 migration 没有变化。

## 安全适用性边界

| 公告条件 | 当前源码证据 | 尚不能断言的事项 |
| --- | --- | --- |
| App Router + Cache Components + 返回多个 typed arrays 的 `use cache` | 使用 App Router；`apps/web/next.config.mjs` 为空配置；Web 源码未发现 `use cache` 或 Cache Components 配置 | 未运行漏洞利用；未确认任何线上构建配置 |
| glibc Linux 下图片优化的上游漏洞 | 未发现 `next/image` 或 `<Image>` 使用；两份 Dockerfile 均基于 `node:22-alpine`；目标 sharp 为 `0.35.5` | 源码无法证明线上实际镜像或任意请求路径均不适用 |
| App Router + 至少一个 Server Action 的拒绝服务 | 未发现 `use server`；表单使用客户端调用独立 API | 不把没有 Server Actions 推广成所有 RSC 风险均不存在 |

这些检查支持升级与风险范围说明，不是已经发生攻击或已验证可利用性的证据。

## 回归测试补充

保留原有六条开发模式模拟 E2E。将 Next 启动命令改为直接调用 Node 入口，以兼容 Windows；限定原测试文件，避免意外混入生产模式测试。

新增独立 `playwright.runtime.config.ts` 和 `tests/e2e/runtime/`，启动真实 `next start` 与仅监听 loopback 的合成 API，检查：

1. 实际 FM 登录表单、HttpOnly 合成 Cookie、SSR 导航和刷新。
2. 作者预览、匿名和非作者不可读私密内容、私密元数据与 OG 排除、作者确认发布后公开阅读。
3. 公开 OG 的 PNG 签名和 1200×630 尺寸、分享链接复制、无效 ID。
4. 390px Galaxy 的 WebGL 视口和频段筛选。

模拟 API 不替代真实 Fastify / PostgreSQL / Redis 集成测试，不能以其权限实现证明后端鉴权正确。Galaxy 这些检查也不证明键盘可访问性、星点选择体验、真机帧率或性能。

生产套件要求构建时设置 `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:4200`，详见该目录 README。不要同时运行会改写 `apps/web/.next` 的开发服务器或另一次构建。

## 测试记录

日志保存在本地忽略目录 `test-results/a1/`，不将日志、下载包或环境配置提交到仓库。

| 项目 | 当前结果 |
| --- | --- |
| 原版本首次 `npm ci` | 未通过：Windows 沙箱不允许创建 workspace 链接，`EPERM` |
| 原版本获准安装重试 | 未通过：下载中连接中断，`ECONNRESET`；未得到完整基线测试结果 |
| 最小锁更新 | 通过：固定原 React 配对后正常解析；无强制忽略 peer |
| 新锁文件首次 `npm ci` | 命令通过：531 packages；但下载中断导致 Windows SWC 可选依赖被跳过，尚不足以证明可构建 |
| 官方 SWC 下载与 SHA-512 核对 | 通过；已按锁文件 integrity 校验并加入 npm 缓存，未使用替代版本或第三方包 |
| 恢复平台元数据后的离线干净 `npm ci --offline --no-audit --no-fund` | 通过：532 packages；Windows SWC 与 sharp `require()` 均成功 |
| 根 `npm run check` | 首次 214/220 API 测试通过、6 项首次启动超时；浏览器解包完成后原命令重跑通过（26 文件 / 220 API 测试），Web lint / typecheck / 生产 build 均通过；未修改 timeout 或 API 测试配置 |
| 独立 Web Vitest | 通过：8 文件 / 38 测试 |
| 原模拟 E2E `npm run e2e -- --reporter=list` | 通过：6 测试；设置 `CI=true` 强制启动独立服务，未复用已有端口服务 |
| 生产模式回归 | 通过：4 测试；包括键盘 Enter 登录、SSR Cookie、私密访问、发布、PNG/卡片打开/链接复制与 390px 星海筛选 |
| `npm run deploy:test` | 通过：5 项脚本回归；需在获准权限下运行 Git Bash，沙箱内启动因系统对象权限被拒 |
| `npm ls next react react-dom sharp eslint-config-next` | 通过：Next / ESLint 配置 16.4.3，React / DOM 19.2.6，sharp 0.35.5，无 peer 错误 |
| 最终生成类型后的 `npm run web:typecheck` | 通过；开发回归产生的临时类型路径用官方 `next typegen apps/web --webpack` 重新生成，未保留额外的 `.next/dev/dev` include |

首次 API 超时与冷启动、并行浏览器解包的资源争用相符，但没有阶段计时，不能断言精确原因；保留首次失败和原命令成功重跑两份日志。静态复核还发现 signals 单测可能尝试本地 Provider 配置数据库后回退，需在 A2 完善隔离；不能以这些单测声称已验证真实数据库链路。

Next 构建自动在 `apps/web/next-env.d.ts` 中增加 `root-params.d.ts` 引用，属于新框架生成的类型入口。构建提示 Edge Runtime 弃用；本轮 OG 生产回归通过，暂保留现有 runtime，后续维护时再评估迁移。

## 验收条件逐项

| 条件 | 结论 |
| --- | --- |
| 安全维护版、React 配对、SWC/sharp 实际安装与可加载 | 通过 |
| 干净锁文件安装、根检查、Web 单测、模拟 E2E、部署脚本 | 通过 |
| 生产构建与 `next start`，登录 / Cookie / SSR / 预览 / 发布 / 公开详情 / OG / 分享 / 390px Galaxy | 通过 Web + 合成 API 的自动回归 |
| 公告实际攻击条件或线上事故 | 未验证；不作可利用或已发生的断言 |
| 真实 Fastify / PostgreSQL / Redis 权限与状态链 | 本项未运行，A2 建设并验证 |
| 容器实际构建镜像、线上版本、物理手机性能、完整键盘星海阅读 | 本项未验证；不能以现有自动回归替代 |

## 镜像、迁移和回滚

Dockerfile 的基础镜像为 `node:22-alpine`，Compose 还引用 `pgvector/pgvector:pg16`、`redis:7-alpine`、`caddy:2-alpine`，均为可移动标签，源码没有固定 digest。此次仅记录这一可复现性限制，不擅自变更有状态服务镜像。Docker CLI 可用，但初查 daemon 未运行，尚未进行容器构建或镜像运行验证；线上实际镜像未知。

本次无数据库迁移和生产数据操作。代码回滚应还原 `apps/web/package.json` 与 `package-lock.json` 的同一版本组合，再执行 `npm ci`、重新构建并重跑回归；部署回滚须由所有者使用已验证的旧镜像完成。旧 Next `16.2.6` 低于本轮修复线，不建议将回滚旧包当作长期方案。

## 交付边界与下一步

实现位于独立修复分支，按草稿 PR 交付评审。没有推送或合并 main，没有部署线上、读取真实用户数据、调用收费 Provider。使用的账号、Cookie、表达与发布状态均为测试夹具；不将本报告作为生产安全或模型效果认证。

下一项为 A2：接入根 Web 单测门禁，并建设独立真实 API / PostgreSQL / Redis 集成测试。
