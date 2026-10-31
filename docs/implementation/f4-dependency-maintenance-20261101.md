# F4：依赖分组评估与 API 安全维护

日期：2026-11-01；基线 `1ba1c73`；本地分支 `codex/f4-dependency-maintenance`。对应 R22 常规部分。完整分组、官方来源、实际启用判断、镜像版本/digest 和许可证初查见[依赖维护表](../dependency-maintenance.md)。

本轮核对根/API/Web/contracts 的 manifest、lock、安装、CI、Dockerfile 与 Compose。初始官方 registry 审计报告 34 个受影响包记录：9 high、24 moderate、1 low。计数包含同一 advisory 在传递链上的多个包，不等于应用有 34 个可利用漏洞。Fastify 的部分具体前提没有在本应用启用，Zod 集合耗尽也没有做利用实验；本轮按已知版本缺口维护，不宣称验证了攻击可达性。

## 实际改动

API 两项直接依赖固定为 Fastify `5.12.7`、Zod `4.6.7`，原为 `5.8.5` / `4.4.3`。cors 保留 `11.2.0`，官方兼容表支持 Fastify 5；其行为仍需本轮回归。按父依赖允许范围更新 find-my-way `9.6.0 → 9.10.0`、fast-uri `3.1.2 → 3.1.9`。Fastify 必要带入 process-warning `5.1.1`，以及嵌套 ajv `8.20.0`、fast-json-stringify `7.2.0`、fast-uri `4.2.3`、json-schema-traverse `1.0.0`。fast-json-stringify 为必要传递跨主，不能把整个锁变更描述成只有补丁版本。

除 API manifest 与这些必要锁项外，没有无关版本漂移。npm 重写时删除了 42 处 Linux libc 元数据；逐项核对原/新 version、resolved、integrity 相同后恢复原字段，保留 Next/SWC、sharp、Tailwind 等多平台选择信息。初始差异与最终结构差异分别保留在 `f4-lock-diff-initial-20261101.json`、`f4-lock-diff-final-20261101.json`。

没有更新 Next/React/3D、ORM、TypeScript 或 lint 主版本，没有迁移文件。新版 Fastify 弃用顶层 `disableRequestLogging`，原静默日志回归确实失败；现 `app.ts` 和两个测试替身改用 `new LogController({ disableRequestLogging: true })`，保持自有结构化日志与脱敏，不屏蔽警告或放宽测试。保留 postgres `3.4.9` 与严格四文件补丁；React `19.3.1` 不满足已锁 fiber 的 `<19.3` peer，不单独升级。

`Dockerfile.web` 的两次依赖安装后新增 Alpine SWC 与 sharp 加载门禁，缺失或无法加载即构建失败，不能靠后续 Next 联网下载回退掩盖。API Dockerfile 不受 Web 编译器门禁约束。

## 验证记录

日志均在被忽略的 `test-results/f4-*20261101*`。不继承 F3 或 F2 的历史通过记录作为依赖升级验收。

- 首次沙箱 `npm ci` 长时间停留、依赖不完整，核对 PID/命令后只停止该安装。正常本机权限同锁重试，10 分钟后 exit 0，安装 538 包，postgres applied=4 / verified=4；Windows SWC/sharp 可加载。Zod 官方精确 tgz 的 SHA512 与 lock 一致后补入正常缓存，没有换 registry、版本或手放 node_modules。两次安装日志保留。
- 正常安装仍报告 WASM 清理 EPERM，`npm ls` 保留六个 extraneous。确认 Windows 原生包正常后，只清理这些多余 WASM 包和残留 rolldown WASI 目录；七个绝对目标先核验在工作区 node_modules 内。最终 `f4-installed-clean-20261101.json` 中 problems/extraneous 均为空，未动业务数据。
- 第一轮根检查：运行器 15/15、API 744/745；唯一失败是上述 Fastify 弃用输出破坏静默日志断言，未进入 Web。见 `f4-check-20261101.log`。适配后 `npm run check` exit 0：运行器 15/15、API 745/745、Web 138/138、两端 lint/类型/构建全部通过，见 `f4-check-final-20261101.log`。随后两个测试替身同步后，日志、错误与诊断隐私专项 3 文件 20/20，无弃用输出；最终 API lint/类型再次通过。完整隔离结果收尾补充。
- 正常权限的最终官方审计 JSON 为 `f4-audit-after-api-verified-20261101.json`：30 个包记录，5 high、24 moderate、1 low；Fastify、Zod、find-my-way、fast-uri 不再报告。中间沙箱报告也保留，不覆盖原始结果；不宣称全项目零漏洞。
- 第一份 Linux API 生产依赖镜像 exit 0，183 包、postgres 四文件补丁通过；实际 Node `22.23.4`、Fastify `5.12.7`、cors `11.2.0`、Zod `4.6.7`、sharp `0.35.5` 可读取/加载，但 SWC 缺失，不能算 Web 原生验收。lock、musl/架构/engine 检查均通过；成品不含 cache mount 内日志，没有唯一确定失败原因。
- 保留首个镜像；按最终 lock 下载官方 musl SWC，34,539,510 字节，核对 SHA512，在固定 Node digest、禁网临时构建中离线补同一 BuildKit 缓存并按 integrity 读回。证据在 `f4-native-cache/`。随后实际重建带严格加载门禁的 Web prod-deps，exit 0、184 包、postgres applied=4 / verified=4，镜像 index 为 `sha256:b6d0d5e199e56246f0d708f75b602ebfc1b46db1b588e0252b3bb2d0ab9e291f`。禁网只读容器再次实际加载 SWC/sharp，通过；见 `f4-linux-web-prod-deps-20261101.log`、`f4-linux-runtime-probe-final-20261101.log`。没有构建完整 Linux Web runner 或验证生产部署；deps 阶段的同样门禁未另做完整构建。
- 初次默认 Git Bash 路径不存在，未执行脚本；使用实测 `D:\git\Git\bin\bash.exe` 后部署脚本替身回归 exit 0，见 `f4-deploy-scripts-verified-20261101.log`。Windows 文件系统不能验证 POSIX 模式，Linux 权限仍由隔离恢复专项验证。
- 最终完整真实隔离运行 `run-ShnoQV` / `b7c94a954f86`：8 文件 111/111，403.75 秒，failed/pending/todo 全为 0，exitCode=0、interrupted=false、cleaned=true。发布/撤回、鉴权、共享预算、双进程任务、实际关闭、恢复、scheduler 与 EOF 均执行，没有用专项替代完整套件。临时 PG/Redis 容器和网络已清理。见 `f4-integration-20261101.log` 与该轮 manifest/vitest/runtime-marker。
- 收尾核对运行器 87 个来源输入、76 个构建产物及本轮 11 个关键源码/锁/镜像文件，哈希全部一致，见 `f4-source-final-20261101.json`、`f4-hash-verification-20261101.json`。本轮未改页面/交互，没有重跑生产浏览器、开发 E2E 或实体设备，不挪用旧成绩。

## 回退与剩余范围

回退成组恢复本轮 API manifest、lock 与日志 API 适配后干净安装，保留 postgres 补丁及当前数据；旧版本安全缺口会随回退重新出现。回退 Web 原生门禁会恢复可选包遗漏仍可能安装成功的旧行为。本轮没有 schema、配置或公开 DTO 变更，不需要数据库回退。

镜像表是本机/官方 registry 查得的候选和本地隔离环境信息，不是生产实际部署版本。本轮不修改有状态镜像标签、不连接生产、不启用 scheduler、不调用真实 Provider。真实手机、生产镜像/配置、第三方条款和最终分发物料仍不能由依赖安装结果代替验收。
