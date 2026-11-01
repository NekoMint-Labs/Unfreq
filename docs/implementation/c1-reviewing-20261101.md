# C1 补充：审核中内容的非作者读取

日期：2026-11-01。基线 `2ef7f1e4933e2f8dfc051267f1e68544a5575129`。

本轮落实 [A3 评审评论](https://github.com/NekoMint-Labs/Unfreq/pull/3#issuecomment-6555152452) 中的读取规则。该代码补丁独立于文档 PR #3；#3 仍只更新设计与未来验收要求。

## 行为

此前，匿名访问者和其他非作者读取 `REVIEWING` 内容时，会得到 `200/REVIEW_RESTRICTED` 及信号 ID、状态和时间。普通详情路由现在对这些访问统一返回与不存在信号相同的 `404/NOT_FOUND`，仅保留通用错误和请求追踪 ID；响应不包含信号存在性或审核元数据。管理员使用普通公开详情路由时也遵守这一规则。

作者仍可读取本人的私密内容及审核状态，不能发布审核中的内容。管理员通过原有鉴权后台列表读取审核中内容，未登录和普通用户仍分别被拒绝为 401、403。本轮没有改变审核操作、撤回、再发布、数据库 schema 或历史数据。

## 本地验证

| 检查 | 结果 |
| --- | --- |
| Signals 与 Admin 路由专项 | 2 个文件、51 项测试通过；包含三类非作者与不存在 ID 的同等 404、作者私密读取、后台授权读取 |
| API 完整 TypeScript 类型检查 | 通过，退出码 0 |
| 三个变更源码文件的 ESLint | 通过，退出码 0 |
| `git diff --check` | 通过 |

首次 Vitest 在沙箱临时目录写入缓存时遇到 `EPERM rename`，两个测试文件未执行；原日志保留。重跑将 `TEMP/TMP` 指向本轮工作目录，未改超时、重试或测试断言。通过运行耗时 29.80 秒。

本轮只读复用主工作区已安装依赖。两个工作区锁文件仅换行不同，统一 LF 后 SHA-256 均为 `fa3ee88449b4142f0c68b7e4f21fcdca66cf51910dd174947dc4157229a387b7`；未安装或更新依赖。日志位于本地忽略目录 `test-results/comment-fixes-20261101/c1-{routes,routes-local-temp,typecheck,lint}.log`。

这是内存仓库适配器上的真实 Fastify 路由回归，不代替 PostgreSQL/Redis 集成、完整 Web 浏览器或目标生产环境验收。本轮未运行 Docker、迁移、部署或收费 Provider，也未将补丁混入 A3 文档 PR。

## 复验命令

以下命令从本轮隔离工作区执行，使用主工作区已有工具；`TEMP/TMP` 只影响当前命令进程：

```powershell
$env:TEMP = 'E:\unfreq\test-results\comment-fixes-20261101\c1-temp'
$env:TMP = $env:TEMP
Push-Location apps/api
node E:\unfreq\node_modules\vitest\vitest.mjs run src/modules/signals/routes.test.ts src/modules/admin/routes.test.ts --reporter=dot
node E:\unfreq\node_modules\eslint\bin\eslint.js src/modules/signals/service-queries.ts src/modules/signals/routes.test.ts src/modules/admin/routes.test.ts
Pop-Location
node E:\unfreq\node_modules\typescript\bin\tsc --noEmit -p apps/api/tsconfig.json
git diff --check
```
