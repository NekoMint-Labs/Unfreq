# 发布整合候选（2026-11-04）

初始维护基线为 main `e5b459cf0e067fa391befb095bf3e87b9370cc41`，整合分支为 `codex/release-candidate-20261104`。C1 #14 合入 main 后，候选同步 main `28972268ecd2049cc87a3a8744b1b69e1de32a68`；当前 PR 的剩余差异为维护整合及依赖修复。此候选用于代码评审与隔离验收；生产迁移、部署、历史数据处置和真实付费调用尚未执行。

本次同步的四处冲突均涉及候选额外的 runtime 冻结清单及浏览器夹具/用例，保留 scheduler 校验、生成请求状态重置和全部 10 个浏览器测试。解决冲突后，整棵文件树逐项等于同步前 `a9d4cfe`；随后只更新本段基线记录。验收脚本中的固定 `e5b459c` 继续作为历史维护/回退对照，当前 main 为 `2897226`。新 Head 的检查仍须重新运行，不复用旧提交的绿灯。

## 固定输入

| PR | 范围 | 输入 Head |
| --- | --- | --- |
| #14 | C1 作者确认、撤回与公开字段 | `388bc5c5e69c9743dc6df81ca0179706ea8ef1bb` |
| #15 | 环境文件私密、原子更新 | `66a178b065ead85c2dbf812ea98bcd89ba5eb78d` |
| #16 | 页面就绪与 HTTPS 元数据 | `f749d16e0583b04d7de8e6b06b81cf9f66a3fe63` |
| #17 | postgres v4 与两文件生命周期补丁 | `1031f9bb7ef2ff7b67bd7eea16e51f12dac6ff4f` |
| #19 | 编译后的生产迁移 CLI | `bce3d4db57db54720cf8e7710b1c16f20c458575` |
| #18 | 无 Speech API 时播放 READY 音频 | `8b76d7b4d0a5ef12b2a01110cb4e669f7f4f1d27` |
| #20 | 生产与开发依赖 high 告警修复 | `22cb166a0dc907da437f353eba8d7da609f8046f` |

各输入通过 merge 保留来源，不包含旧 #8–#13 大维护基线的其余 C2/D/E/F 功能。独立审查已核对 C1 的 81 个文件和安全候选的 17 个文件；未发现阻止这两个独立补丁合并的确定源码缺陷。两者仍需人工正式评审；该结论不代表生产上线批准。

## 整合修正

- 浏览器夹具同时保留 C1 撤回/版本控制和首页生成请求/冷加载行为，保留全部 10 个生产浏览器用例。
- 安装脚本保留 postgres v4 补丁；runtime 冻结清单同时包含 C1、迁移 CLI、日志控制器及 scheduler，并加入 0024 SQL。
- 镜像及迁移 CLI 验收从固定 24 条升级为精确的原 24 条加 C1 0024。原 journal 前缀、每份 SQL 来源、C1 追加均有固定哈希；真实账本逐项比较 SQL 哈希和时间戳。故障迁移使用后续唯一序号，保留整体事务回滚、幂等、关停和未知外发不重放断言。
- `AI_SIGNAL_SCHEDULER_ENABLED` 现在由配置读取并实际控制定时器，默认关闭。禁用测试跨过 03:00 并确认无计时器/无派发；显式启用测试保留原调度行为及停止后不再派发。此处仅补禁用路径，未引入 F1 持久领取或多实例调度。
- 部署与运维文档新增 C1 同步发布、历史内容及回退条件。已撤回内容保留 `PUBLISHED`，因此不能直接回退 pre-C1 公共接口。
- 本机实际开发迁移生成暴露 Windows 反斜杠被当作 glob 转义的问题；验证脚本将 schema 路径转换为正斜杠，并在现有三个 Node/系统矩阵中执行真实 generate。此修正不更改 SQL、schema 或生产迁移入口。
- fflate 收尾提交 `e2d42ee` 处理生产包告警 [GHSA-px8p-9vwx-vf98](https://github.com/advisories/GHSA-px8p-9vwx-vf98)：两条 fflate 分别从 0.8.2/0.6.10 升到现有约束允许的 0.8.3/0.6.11，该提交中其余锁条目不变。独立有界子进程覆盖异常 ZIP64 拒绝、普通 ZIP 和有效 ZIP64 控制，并接入既有三平台矩阵。本次不新增外部 ZIP/模型加载入口，也不将包告警表述为已证实的公网可利用漏洞。

## 开发依赖收尾

Vitest 与配套 mocker 升到 4.1.12，Babel core 升到 7.29.6，tsx 升到 4.23.15。Drizzle kit 保留 0.31.10 及原迁移协议；仅限定 kit/core-utils 使用 esbuild 0.28.2，并把 TypeScript-ESTree 的独立 minimatch 副本升到 11.0.4。ESLint 使用的根 minimatch 3.1.5 和 Vite 8.1.6 保留，全部既有生产包锁条目不变。整图检查还补齐 Tailwind 可选 WASM 的私有 runtime 版本边，未升级 unrs-resolver 共用的旧 runtime。

旧依赖基线已实际复现 mocker 越界读文件/代码生成注入、Babel 外部 source map 读取、esbuild CORS/Windows 回溯和 minimatch 扩增；候选用同份输入及正常控制复验。Windows 实测还发现 esbuild 0.25.12 留有回溯读取，故没有仅凭审计范围把它当成安全终点。所有复现只在隔离副本使用回环服务与合成数据，子进程、HTTP 和清理都有期限。

完整官方审计仍有 15 条 moderate 包记录，全部追溯到根 minimatch 3.1.5 的同一公告；生产审计保持零。发布者[原始公告](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249)描述 10.x 的 firstPhasePreProcess 扩增，[数据库聚合范围](https://github.com/advisories/GHSA-g3hv-75wg-m249)却覆盖所有小于 11.0.1 的版本。已独立校验官方 3.1.5 tarball/SRI 与源码；它没有该预处理阶段，因此不为此机制更改旧接口。不能把这个结论泛化为 v3 对所有问题都安全。

`scripts/check-development-audit.mjs` 保留完整原始 JSON，只接受唯一根 3.1.5、副本 SRI/源码指纹、指定公告及其完整传播链；新增公告、不同版本、其他副本或严重度均失败。它没有让 `npm audit` 假装清零：普通完整 audit 仍 exit 1，处置结果单独上传。旧报告因含受影响的 nested 副本被检查拒绝，合法根链才通过。

首轮 Windows Node 22.12 验证保留了一次正常 mock 重定向失败。Vite 的 Windows 文件服务明确拒绝含 `~` 的路径；测试夹具现使用真实长路径，保留全部拒绝断言和普通成功控制，并记录原始临时目录、有效根和转换错误。另对 TypeScript visitor-keys 8.59.2 定向使用官方 eslint-visitor-keys 4.2.1：它与 5.0.1 的 89 组遍历键、顺序、类型声明和实际 API 逻辑相同，却正式支持 22.12；矩阵对全部开发条目逐项核验当前 Node engine。生产树原有 camera-controls 的 Node >=22 声明及特定平台可选包保持原样，不据此扩大本轮开发依赖范围或宣称全树 engine-strict 支持 Node 20。

## 本候选验收

所有结果须绑定本候选的最终提交和文件树。独立 PR 的既有绿灯、#20 与固定 #19 的临时组合，以及旧维护栈的成绩均不代替此候选。

应运行现有 CI、C1 生产浏览器、Web 成品镜像与 Caddy 探针、postgres 下界及依赖镜像、API 迁移成品，以及跨平台安全回归和完整官方审计。API 迁移成品直接执行本候选，不重用固定 #19 的临时合成作为候选身份。完整审计保留剩余告警；high/critical 为零也不等于无风险。

实际运行结果、失败和资源清理将在本次 PR 中记录。没有结果的检查不计为通过。

## 目标环境尚需完成

正式上线前仍需确定目标环境和发布窗口，演练备份/隔离恢复及保留 C1 边界的回退，核对真实 Nginx Proxy Manager → Caddy → API 信任链、双公网客户端与跨副本额度。真实 Provider 成本、质量、允许预算和停止条件由负责人确认；当前不启用生产付费额度。历史无作者样例、保留期、删除及第三方副本不在本次默认处置范围内。
