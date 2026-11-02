# 依赖分组维护与回退

2026-11-02后续：[生产迁移器与开发工具依赖边界](./implementation/runtime-migrations-20261102.md)使用相同版本/SRI，将kit移出正常生产安装；最终锁88d968f…独立full audit仍20条moderate、全部dev-only，omitdev为0。已正常安装、通过完整API检查和139项真实隔离回归；新的最终成品仍按该记录逐项验收。下文各日期的30/28/20及旧镜像成绩保留各自原范围，不改写成新锁成绩。

核查日期：2026-11-01。本页的初始清单对应 `bc9c7b1` 的 manifests、lockfile v3 与本机安装；版本查询使用官方 `https://registry.npmjs.org/`。后续升级须另记实际提交、检查和剩余告警，不能把候选版本写成已验收版本。

## 本次读取和安装边界

初始盘点使用 Node.js `22.22.2`、npm `10.9.7`。CI 与两个 Dockerfile 使用 Node 22，Docker 基础标签是可移动的 `node:22-alpine`。当时根 `engines` 仅声明 `>=20.9.0`，低于完整开发工具链中 Vite `8.0.11` 的 `^20.19.0 || >=22.12.0` 要求；初始本机版本满足该要求。当前 v4 候选根范围已为 `^20.19.0 || >=22.12.0`，两个下界仍须按新候选分别验收，不能继承早期安装成绩。

以下只读检查已完成，原始文件在被忽略的 `test-results/`：

- `f4-lock-inventory-20261101.json`：44 项 workspace 直接声明；692 个 `node_modules/` 记录含 3 个 workspace 链接，排除后为 689 个第三方记录。根与 `apps/*`、`packages/*` 的源 manifest 条目另计，不混入第三方包数；同包的嵌套/平台版本分别记录。
- `f4-installed-20261101.json`：`npm ls --depth=0 --json` 返回 0；另报告 6 个 extraneous 的 wasm/sharp 辅助包。该安装不是干净安装的证明，不能以退出码 0 抹去这些条目。本轮未删除它们。
- `f4-outdated-20261101.json`：`npm outdated --json` 返回 1，报告 34 个包名有较新版本；`wanted` 是 manifest 范围允许值，`latest` 是 registry 标签，两者都不是本项目已验证的升级目标。
- `f4-audit-20261101.json`、`f4-audit-summary-20261101.json`：`npm audit --json` 返回 1；初始 lock 有 34 个受影响包记录（9 high、24 moderate、1 low、0 critical）。同一 advisory 的上游和传递包会分别计数，不表示 34 个已证实可利用的应用漏洞。第二次采用 30 秒单次请求超时、零重试，也保留为 `f4-audit-bounded-20261101.json`；该参数不限制 npm 整个分析的总耗时。

本次查询没有执行 `npm update`、`npm audit fix` 或 `--force`。查询结果随时间变化；真实发布时须基于最终 lock 再查。两个 Dockerfile 的生产安装使用根 workspace 的 `npm ci --omit=dev`，没有按 API/Web 工作区裁剪，不能把未在某服务源码中 import 的生产依赖直接认定为“不在该镜像中”。

## 分组与版本决策

| 批次 | 初始锁版本 | 本次查得的候选 | 决策与主要验证 |
| --- | --- | --- | --- |
| Next 安全组 | Next / eslint-config-next `16.4.3`；React / React DOM `19.2.6` | Next 未出现在本次 outdated；React / DOM latest `19.3.1` | A1 已独立更新 Next，继续成对保留；重新检查 SSR、OG、登录 cookie、私密/撤回页面以及 Windows/Linux SWC 后再升级。Next 的 eslint 传递告警见下文，不能据此把运行时 Next 判为命中同一问题 |
| API 请求组 | Fastify `5.8.5`、cors `11.2.0`、fastify-plugin `5.1.0`、Zod `4.4.3` | Fastify `5.12.7`、cors `11.3.1`、Zod `4.6.7` | 优先处理同主安全版本。拟实施最小批次 Fastify `5.12.7` + Zod `4.6.7`，cors 无本次直接安全告警，先保留 11.x 并验证。检查负向授权、cookie/CORS、非法 JSON/参数、Provider 结构输出及关闭生命周期；不能只跑 happy path |
| ORM 与迁移组 | drizzle-orm `0.45.2`、drizzle-kit `0.31.10` | `0.45.4`、`0.31.11` | 后续独立补丁批次；ORM 与 kit 联合验证类型、事务、已有迁移、干净库迁移和备份恢复。不因 npm 建议而降到 kit `0.18.1`；未经审查不生成、重写或应用生产迁移 |
| PostgreSQL 驱动组 | postgres `3.4.9` + 项目四文件哈希补丁 | 新候选精确 `4.0.0` + 两文件生命周期补丁 | 成组退役旧安装器/补丁并接入新组，保留新postinstall与Docker接线；不新增健康队列期限、不重放已发送工作。本地检查、Node下界、真实PG/Redis135及新Linux依赖/Web38已验收，新补丁仍须独立审查；见[当前驱动说明](./postgres-driver.md)及[本轮记录](./implementation/postgres-v4-upgrade-20261101.md)，旧说明保留为历史 |
| 3D 与 React 渲染组 | three `0.184.0`、types `0.184.1`、fiber `9.6.1`、drei `10.7.7` | `0.187.0`、`0.187.0`、`9.8.2`、`10.7.9` | 暂保留，后续四者联动。three `0.x` 的 minor 可能改变 API；验证星图坐标、命中、相机、图例、键盘列表、WebGL 降级及减少动画，并以实际浏览器检查材质与弃用提示 |
| 测试工具组 | Vitest `4.1.5`、其 Vite `8.0.11`、Playwright `1.60.0` | Vitest wanted `4.1.12` / latest `5.0.5`，Playwright `1.64.1` | 后续先做 Vitest 4.x 与其允许的 Vite 修复版；重跑 API/Web 单测、运行器及真实隔离。Playwright 单独升级并安装对应浏览器，浏览器结果不能跨版本继承。无需因最新标签直接跨到 Vitest 5 |
| TypeScript 与 lint 组 | TypeScript `5.9.3`、ESLint `9.39.4`、typescript-eslint `8.59.2` | TS latest `7.0.2`；ESLint wanted `9.39.5` / latest `10.14.0`；typescript-eslint `8.72.1` | 保留 TS 5；跨主升级须先有明确收益和迁移验证。lint 与插件成组审查，包含 glob 传递告警；不采用 audit 给出的 ESLint 4、config-next `0.2.4` 等破坏现有配置的降级 |
| 样式、字体与其余运行时 | Tailwind / PostCSS 插件 `4.3.0`、postcss `8.5.23`；三套字体 `5.2.8` / `5.2.9`；motion `12.38.0`、ioredis `5.10.1`、ws `8.22.0`、dotenv `17.4.2` | Tailwind组 `4.3.3`、postcss `8.5.32`；字体 `5.3.0` / `5.3.1`；motion wanted `12.43.0`、ioredis wanted `5.11.1`、ws `8.22.1` | 按用途后续分别处理。PostCSS/source-map 与字体可能改变构建和排版；motion/ioredis/dotenv 不因存在跨主 latest 而混入安全批次。ws 固定与类型成对核对，并重测 TTS 取消/排空 |

已锁 fiber `9.6.1` 的 peer 范围要求 React / DOM `>=19 <19.3`，因此不能单独把 React 提到 `19.3.1`。官方 registry 查得 fiber `9.8.2` 放宽到 `<19.4`，但该新组合仍须实测。官方也要求 [fiber 9 对应 React 19](https://r3f.docs.pmnd.rs/getting-started/introduction)。[cors 官方兼容表](https://github.com/fastify/fastify-cors#compatibility) 将 11.x 与 Fastify 5.x 配对；同主不等于无需回归，[Fastify 说明安全 minor 也可能包含行为变化](https://fastify.dev/docs/latest/Reference/LTS/)。

## 告警与实际路径

以下是依赖维护评估，不是全仓安全扫描或利用验证。初始审计没有报告 `next` / `react` / `react-dom` / `postgres` / `ws` 自身命中，但这不构成完整安全证明。

| 初始命中 | 依赖位置及实际用途 | 对应用的判断与下一步 |
| --- | --- | --- |
| Fastify：schema、malformed URL、HTTP/2 等 advisory | API 直接生产依赖；例如 [header schema <5.12.2](https://github.com/fastify/fastify/security/advisories/GHSA-9q9j-q6p8-xq58)、[私密 not-found >=4 <5.12.2](https://github.com/fastify/fastify/security/advisories/GHSA-p68q-wchp-6fh7) | 当前 `app.ts` 未启用 HTTP/2，源码未注册 Fastify JSON Schema 或自定义 not-found；路由手动调用 Zod。未证实这些具体前提启用，仍优先维护已命中版本。新 propertyNames advisory 的范围为 `>=5.12.2 <5.12.6`，当前 5.8.5 不命中该条；候选须至少覆盖后续修复 |
| Fastify trustProxy advisory | `app.ts` 使用 false 或受信 CIDR 列表 | [hop-count 告警](https://github.com/fastify/fastify/security/advisories/GHSA-3m5p-2c4r-xxw2) 命中包版本，但本项目没有使用数字 trustProxy；其更早 CIDR 问题在 5.8.3 已修复。继续验证真实代理与直接连接负向路径 |
| Zod `4.4.3`，受影响 `<4.6.6` | API 路由输入、Provider 输出和响应校验 | [advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) 涉及超大集合逐元素累积错误引发内存耗尽。当前匿名/普通账号请求主体以带上限的标量字段为主，未发现直接接受任意长数组的普通写入 schema；数组主要见响应及 Provider 结构输出，管理员 `extraJson` 另用 record。没有执行内存耗尽试验，也没有据此认定整个应用不受影响。升级后验证非法类型、长度约束、AI JSON 校验及既有回退 |
| find-my-way `9.6.0`（high）、fast-uri `3.1.2`（high） | Fastify → router；Fastify → ajv-compiler / fast-json-stringify → URI 解析 | 前者本次 advisory 针对 HTTP/2；应用未启用。fast-uri 未被业务直接用于外发 URL 校验，不可把“存在解析库”直接写成已证实 SSRF。与 API 安全批次一起更新允许范围的传递锁项，并核对新 lock 中是否仍命中 |
| Vitest / mocker（moderate）、其 Vite（high） | 仅开发依赖；`vitest run` 与隔离运行器，不是 API 生产监听器 | [Vitest 上游](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9) 的远程读取前提涉及可达 dev server 与 standalone mock 插件；本项目未配置这些插件。保留告警，后续升级 4.x；Vite Windows 路径/编辑器告警也不能当作 Next 生产接口的漏洞 |
| 旧 esbuild / esbuild-kit / drizzle-kit（moderate） | kit → esm-loader → core-utils → esbuild `0.18.20`；tsx → esbuild `0.27.7` | kit 在 dependencies 中，API entrypoint 调用它迁移，生产镜像含相关包；不能简单归类为纯 dev。告警涉及 esbuild serve 开发服务；源码及启动命令未启用该服务。不靠删除迁移器或强制覆盖不兼容 esbuild 消除计数，后续 kit/tsx 批次处理 |
| fflate（moderate） | types/three → `0.8.2`；drei → three-stdlib → `0.6.10` | advisory 需要处理畸形 ZIP64。星图仅使用几何、贴图、OrbitControls 和 PerspectiveCamera，未发现 ZIP/GLTF/FBX 载入入口；包命中与执行命中分别记录。3D 批次更新同支修复并核对实际 bundle |
| source-map-js `1.2.1`（high）、baseline-browser-mapping `2.10.29`（moderate） | postcss / Tailwind → source-map-js；Next、browserslist → baseline mapping | lock 标为生产可达，并不意味着普通请求直接提供 source map 或任意浏览器查询；当前用途主要是构建工具。后续样式/构建传递补丁，保持 Next 主版本固定也可单独核验允许范围内的 lock 更新 |
| browserslist `4.28.2`、js-yaml `4.1.1`、brace-expansion `1.1.14` / `5.0.6`（high）；minimatch、ESLint 插件链（moderate）；Babel core `7.29.0`（low） | Babel → browserslist；ESLint → eslintrc → YAML / minimatch → brace-expansion；TS lint另有嵌套 glob | 这些命中记录在开发链，主要处理项目配置与源码，未发现生产 API 接收此类 glob/YAML 的路径。补丁修复优先；minimatch advisory 的修复范围跨到 11.x，与多个父包现有范围不相容，须等父包兼容更新或单独适配，不能 force override 代替验证 |

`npm audit` 的 `fixAvailable` 包含把 drizzle-kit 从 `0.31.10` 降到 `0.18.1`、ESLint 从 9 降到 4、eslint-config-next 从 16 降到 `0.2.4` 的建议。它们不是可接受的项目迁移方案。本页保留未处理项与原因，不以任意降级或强制覆盖换取零告警。审计对已安装/lock 包与 advisory 做匹配，[不证明漏洞在实际服务中可利用](https://docs.npmjs.com/cli/v10/commands/npm-audit/)。

## 镜像版本与不可变标识

以下是本轮读取结果，不是生产机器的实际运行版本。Compose 和 Dockerfile 仍保留可移动标签；本轮没有修改镜像标签、执行生产 pull/recreate 或升级数据库。

| 声明标签 | 实测范围与版本 | 本轮记录的标识 |
| --- | --- | --- |
| `node:22-alpine` | 本地不存在；只读取 Docker 官方 registry 的 index、Linux amd64 manifest 和 image config。该 config 为 Node `22.23.4`，index 注明 Alpine `3.24`；未运行该镜像内的 node | index `sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914`；amd64 manifest `sha256:025b8e975a61d94e33abeafaad1255ef44e4898cf1a1b6446860009c72e6d284` |
| `pgvector/pgvector:pg16` | 本地 Linux amd64 镜像环境为 PostgreSQL `16.15-1.pgdg12+2`；镜像内 vector.control 的默认扩展版本为 `0.8.7`。这不等于生产数据库已安装/升级该扩展 | 本地 RepoDigest `pgvector/pgvector@sha256:7b822b0aac60967beb1ea5e576b8602c94c300a157d187f385ae3e0da199b90a` |
| `redis:7-alpine` | 本地 Linux amd64 镜像环境为 Redis `7.4.12` | 本地 RepoDigest `redis@sha256:6ba19c50b56777f5c11c58eff8ddb69d0d5f27ba131cffb63f180ccfd43c66af` |
| `caddy:2-alpine` | 本地不存在；只读取 Docker 官方 registry 的 index、Linux amd64 manifest 和 image config。该 config 为 Caddy `v2.11.7`，index 注明 Alpine `3.23`；未启动反代验证 | index `sha256:e70b164da81ef698b3ad19af799ea6086ce6d9e48ed4079eb9fe26f6fbf14ee5`；amd64 manifest `sha256:04913b1da43339a40ad1ea87827d70a576ac5aa6cf674c6e24fdca675887533a` |

原始证据为 `f4-local-images-20261101.json`、`f4-node-registry-image-verified-20261101.json`、`f4-caddy-registry-image-verified-20261101.json`、两份 `f4-*-image-config-20261101.json` 和 `f4-vector-image-version-20261101.txt`。最初两份不带 `verified` 的 registry 文件为空，不作为查证结果。官方镜像来源见 [Node](https://github.com/nodejs/docker-node)、[pgvector](https://github.com/pgvector/pgvector)、[Redis](https://hub.docker.com/_/redis)、[Caddy](https://github.com/caddyserver/caddy-docker)。

后续发布应在目标架构重新解析标签，记录实际部署 digest、构建与应用提交后再决定是否固定版本；多架构 index digest 与单架构 manifest digest不能混写。Node 版本要与 CI/本地检查分别报告。PostgreSQL、pgvector、Redis 的版本变更另需持久卷兼容、扩展状态、备份恢复和回退验证，不能以 registry 可读替代数据验收。

## 许可证与分发范围初查

`f4-license-inventory-20261101.json` 从初始 lock 的 692 个 `node_modules/` 记录统计，包含 3 个 workspace 链接；第三方为 689 个记录，其中 lock 标记 dev 的为 410，其余为 279。这个划分包含 optional、多平台和嵌套版本，不是当前 Windows 实际安装数，也不是最终镜像或浏览器 bundle 的完整物料清单。root 与三个 workspace 自有源码的权属和许可证另核。

| 对象 | 查得的许可证与用途 | 分发前需核对的材料 |
| --- | --- | --- |
| 大多数 JS 依赖，包括 Next/React、Fastify、Drizzle、three 等 | 初始元数据主要为 MIT、Apache-2.0、ISC、BSD 等；包级声明不涵盖一切内嵌资产或系统库 | 保存实际版本的 LICENSE/NOTICE、版权与来源；根据最终镜像、JS bundle 和源码交付范围逐项核验，不能只保留一张包名表 |
| 三套 Fontsource 字体 | JetBrains Mono `5.2.8`、Noto Sans SC / Noto Serif SC `5.2.9` 均声明 `OFL-1.1`；字体会随 Web 资产提供。本地 Noto 包 LICENSE 与声明一致 | 保留字体版权和 OFL 正文，修改字体时另核保留字体名称限制。[OFL 官方文本](https://openfontlicense.org/open-font-license-official-text/) 明确字体再分发的许可/通知要求；字体输出成文档与重新分发字体是不同情况 |
| sharp 与预编译 libvips / 平台包 | sharp JS 为 Apache-2.0；lock 中 libvips 包为 `LGPL-3.0-or-later`，部分 sharp 平台包是 Apache/LGPL/MIT 的 AND 组合。Windows 本机不具备所有 Linux optional 文件，不能只检查本机目录得出 Linux 镜像清单 | 按最终目标平台取齐随包许可、第三方通知与对应源码/构建来源，核对实际二进制及链接方式；不将 sharp 的 JS 许可证代替其原生依赖。参见 [sharp 上游许可](https://sharp.pixelplumbing.com/#licensing) 与具体平台包材料 |
| lightningcss 平台组、axe-core | lock 共 13 个 `MPL-2.0` 记录，均标记开发用途；是否出现在交付镜像/资产中须检查成品 | 保留对应许可和源码来源，若分发修改后的 MPL 文件应单独核对要求。[Mozilla FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/) 将内部使用、对外分发、修改及组合程序分开说明；不据包名推定全部项目须采用同一许可证 |
| caniuse-lite | `CC-BY-4.0`，lock 未标 dev；属于浏览器兼容数据链 | 对实际分发的数据保留来源、许可证和适用的署名/修改说明，见 [CC BY 4.0 官方说明](https://creativecommons.org/licenses/by/4.0/) |
| webgl-constants `1.1.1` | lock 缺少 license 字段；本地该包 `LICENSE` 明确为 MIT，版权人为 Tim van Scherpenzeel | 记录“元数据缺失、实际许可已读”，保留其 LICENSE；不把三个 workspace 的 UNKNOWN 一并算成四个无授权第三方包 |

本次完成的是依赖许可元数据和重点文件初查，没有生成交付物的完整法律合规结论，也没有核验所有图片、音频、模型服务条款或作品权属。正式分发时，应以该成品的实际包、原生库、字体和通知文件另存清单；参赛素材与成员贡献仍按 [R21 证据表](./competition-evidence.md) 登记。

## 安装、验证与回退规则

每组单独保存 manifest 与 lock，并检查锁变化是否只覆盖预期组和必要传递项。不混入跨主工具、无关字体、数据库迁移或数据处置。干净安装需运行 root `npm ci`，不能忽略 postinstall；随后按对应批次核对 postgres 补丁哈希和 `npm ls` 的真实问题。历史 3.4.9 为四文件，当前 v4 候选为 `pool.js/index.js` 两文件，包 SRI 与输入/输出 SHA 均固定；正常安装的 `applied/verified` 不能替代真实数据库恢复验收。Windows SWC 成功不替代 Linux musl 安装，两个生产依赖阶段也需分别确认。

API 组至少运行 `npm run api:check`、共享 contracts 检查及真实隔离套件；API DTO/校验边界受影响时补 Web 类型与单测。Web/3D 组运行完整 `npm run web:check` 并检查生产构建浏览器中的实际交互。脚本/镜像改动另运行部署脚本检查和镜像准备。迁移组使用新建隔离数据库验证，不连接生产、不运行 `push` 改库。[Drizzle 官方说明](https://orm.drizzle.team/docs/kit-overview) 将 generate、migrate、push 和 Studio 明确区分，不能把 CLI 可启动当迁移成功。

回退以该组前一提交为准，成组恢复 manifest、lock、配置和适配代码，再干净安装。postgres 组还须同步恢复安装器、补丁及 Docker COPY，不能只恢复版本号。依赖回退不自动回退数据库：保留已经存在的数据和迁移账本，若发生 schema 变更须另有专门方案。已知安全告警可能随版本回退重新出现，回退记录必须说明该风险。

## 本轮实施状态

上文的初始查询和候选是基线记录。后续已实际执行最小 API 安全组，保留其他组；Fastify `5.12.7`、Zod `4.6.7` 及必要传递锁项、LogController 适配和 Web 原生安装门禁见[实际实施记录](./implementation/f4-dependency-maintenance-20261101.md)。最终正常权限审计为 30 个包记录（5 high、24 moderate、1 low），不将候选全表写成已升级或已验收。Windows 干净安装后清理确认多余的 WASM 包，当时浅层 npm ls 无问题；Linux 首次漏装 SWC 的记录、按原锁修复缓存和实际门禁重建分别保留。镜像和许可证初查仍不代表生产或分发合规验收。

### 2026-11-01 构建传递补丁与 esbuild peer 修复（验证中）

本轮在隔离候选中使用官方 `https://registry.npmjs.org/`，将 `source-map-js 1.2.1 → 1.2.2`、`baseline-browser-mapping 2.10.29 → 2.11.34` 两项传递补丁纳入主锁，四份 manifest 的依赖声明不变，root 仅增加验证命令；未引入 override 或新增直接依赖。两项的精确版本、tarball URL 与 integrity 均已向官方 registry 读回核对。它们主要服务于 PostCSS、Tailwind、Next 和浏览器兼容数据；source-map-js 也可由 API 测试工具的 Vitest → Vite → PostCSS 链到达，因此不能笼统称作只属于 Web。此批次未改 API DTO、数据库驱动、迁移或数据。

两补丁候选的官方 `npm audit --json` 从 30 个受影响包记录（5 high、24 moderate、1 low）降为 28 个（4 high、23 moderate、1 low）；只移除了上述两包，未新增命中。另有 9 个既有记录的 `fixAvailable` / `effects` 元数据变化，未应用其建议，也未把它们算作新的 advisory 或修复。28 是该候选的包记录计数，不是已证实可利用的漏洞数，不代表零告警、完整安全扫描或最终 esbuild 补树后的审计结果。原始和差异证据保留在 `test-results/f4-transitive-candidate-20261101/`。

这次全层级检查还发现基线锁的既有 peer 缺陷：`vitest/node_modules/vite 8.0.11` 要求可选 peer `esbuild ^0.27.0 || ^0.28.0`，实际却向上解析到根 `0.25.12`。此前 `npm ls --depth=0` 的退出码不能证明全部嵌套依赖有效；上段历史记录中的“npm ls 无问题”只涵盖当时的浅层检查，不能作为全层级通过证据。普通 `npm install --package-lock-only --ignore-scripts` 的 cwd 对照候选未修复此边；带显式 `--prefix` 的 install 还产生了本地 self-link，已拒绝，未纳入主锁。

随后使用正常 npm resolver 的命名 `npm update esbuild --save=false --package-lock-only --ignore-scripts --no-audit --no-fund`，只增加 `node_modules/vitest/node_modules/esbuild 0.28.2` 及其 26 个可选平台记录，共 27 个 dev 记录，满足 Vite 的既有范围。全部新增记录均已核对官方精确版本、resolved、integrity 和平台/依赖元数据；所有既有包记录保持原值，根 esbuild `0.25.12`、tsx 近层 `0.27.7` 和 core-utils 近层 `0.18.20` 均保留。没有借此更新 Vitest、Vite、Drizzle 或其他维护组。候选锁 SHA-256 为 `12b3298aa62463677ef225c9a4290d8e6e2469b7f27bbb53e12072efa187f44b`；主锁按原字段顺序合并相同 27 条记录后为 `fa3ee88449b4142f0c68b7e4f21fcdca66cf51910dd174947dc4157229a387b7`，两者结构相同。应用前的主锁及四份 manifest 哈希核验无漂移。

npm 10.9.7 对两补丁候选及 esbuild 候选的原始重写均丢失了基线的 42 个 `libc` 字段；只在该记录的 version、resolved、integrity 完全相同时恢复原字段，未借恢复操作修改版本或来源。最终两补丁候选仅改变两条包记录，esbuild 候选在其基线上仅新增上述 27 条。原始 npm 输出、恢复清单、精确 argv/cwd/prefix、结构差异、官方来源与应用读回保留在两个候选目录中；esbuild 汇总为 `test-results/f4-esbuild-peer-candidate-20261101/summary.json`。

全平台虚拟树检查仍返回 1，已单独保留结果，不能写成全部通过。基线可选开发包 `@tailwindcss/oxide-wasm32-wasi 4.3.0`（`cpu: [wasm32]`）要求 `@napi-rs/wasm-runtime ^1.1.4`，却解析到根 `0.2.12`；该问题未由本轮引入。Rolldown 的同类包已有自己的 `1.1.4`，unrs 的 `^0.2.11` 则允许根版本。该 wasm32 父包不属于本轮 Windows x64 / Linux amd64 原生安装目标，本轮保留该虚拟边，不扩充升级组；原候选 esbuild invalid 已消失。实际平台安装后的 `npm ls --all` 与原生加载结果须另外记录。

最终主锁正常 `npm ci` 实装540包、postgres四文件补丁验证通过；Windows平台多余WASM后代经逐个路径/包身份核验后完整保留移出，实际 `npm ls --all` 为exit0、problems为空，SWC/sharp/字体和四套esbuild原生编译通过。完整 `npm run check` exit0，工具41、API765、Web184及两端lint/类型/构建通过。最终官方审计仍28条，见 `f4-peer-final-audit-20261101.json`。完整Linux runner四次Docker环境失败，尚无成品/镜像浏览器通过成绩，见[补充记录](./implementation/f4-linux-web-runner-20261101.md)；平台虚拟树、候选、实际安装和成品验收分别记录，不能互相代替。其余测试工具、lint、ORM、3D、字体、运行时及有状态镜像维护组继续按前述边界独立推进。


### 2026-11-01 v4 候选与独立完整 audit

新候选基于 `c54f7e4`，锁 `cdf351ca90d8d3325c349c16abefa71e35327d8aabd07a78ec3dfab16b64b3b4` 相对该基线只改 API workspace 和 postgres 两条包记录。四连接工厂保留 `infer: true`；v4 使用新的两文件生命周期补丁，不能称为已无项目补丁。正常安装543包、postinstall applied2/verified2及轻量 TCP17/17已确认。完整本地检查工具79/79、API767/767、Web192/192及两端lint/类型/构建通过，选定108份来源前后清单相同，清单 SHA256 为 `aa1561c37a3f308fb6a1331264275a5a7b123c0e6f4a85b49c6e71949b67c61a`。

本轮 Node `20.19.0`、`22.12.0` 已各自通过补丁幂等0/2、真实 ESM/CommonJS/Drizzle 模块2/2、Windows 原生工具、tsx `.mts/.cts`、17项合成 TCP 诊断、离线 generate 和 Vitest 6/6。两份 SQL 哈希相同，既有迁移与8项安装输入未变；这些是当前 C 候选的独立日志。7条不适用 WASM 残留对应6个目录，经祖先/后代无链接、包身份及116文件哈希核验后完整保留移出；随后完整 `npm ls --all --json` 的顶层和递归 `problems/extraneous` 均为空。

首次完整真实 PG/Redis `run-u3gw8N / e0cb6725b23d` 为88通过、47跳过/135，core `beforeAll` 超过原30000ms，exit1、cleaned=true；该次失败与旧100/119均保留。同源、同锁、原预算的独立完整重跑 `run-Z8LGD3 / a9ded2fc5068` 已135/135、无失败/跳过/todo，exit0、cleaned=true。两次108份来源未变、83份编译产物有冻结记录，独立容器/网络/卷读回均为0。新v4的Linux API依赖阶段 `c7e41ee21c733688970366c9` 与Web成品 `876dc359ed169e6e5dad38d9` 已独立验收，后者浏览器38/38；两者exit0、cleaned=true。API阶段不包含完整API runner，Web证据不沿用旧3.4.9镜像。

这份最终锁已用官方 npm11.19.1独立完成完整 audit，exit1且报告有效：20条 moderate 包记录，16 dev-only / 4 正式依赖树，5直接 / 15传递，对应2条直接 advisory。正式链含 kit → esm-loader → core-utils → esbuild0.18.20，不能写成全是开发依赖，也没有以跨主或降级建议换取零告警。实际报告在 `E:\unfreq\test-results\full-audit-20261101\final-v4\`；冻结范围仅 lock、四份 manifest及npm CLI/配置，不含仍在编辑的应用/安装器/补丁全部源码。完整状态及旧100/119负评的保留方式见[v4升级记录](./implementation/postgres-v4-upgrade-20261101.md)。
