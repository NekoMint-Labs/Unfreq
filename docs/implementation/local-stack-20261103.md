# 本机隔离全栈验收与登录表单水合问题

日期：2026-11-03（北京时间）；基线 `d843461`，分支 `codex/local-stack-acceptance-20261103`。用户选择本机 Docker 隔离验收。本记录保留首次失败和诊断；修复后的新 Linux Web 成品及完整真实浏览器流程尚待执行，不能据此宣布本轮通过。

## 范围与隔离

实际路径为宿主 Chromium → 回环 HTTPS edge Caddy → 仓库 Caddy → Web/API → 新建 PostgreSQL/Redis；使用真实生产成品、会话、迁移和 worker，数据均为本轮合成数据，未用浏览器 API 替身代替后端。

该双 Caddy 链不是实际 Nginx Proxy Manager，也不验证生产 TLS、访客 IP 归属、生产额度或真实模型效果。API/Web/PG/Redis 只连接本轮 internal 网络，不映射宿主端口；edge 的 TLS 端口仅绑定 `127.0.0.1`。proxy/edge 另有本轮桥接网络，不能把整个拓扑写成全部 internal。

第五轮存活期间另由只读 Docker 查询核对六个容器、镜像 ID、拥有标签、网络、卷和实际 API 配置：worker 开启、每日 scheduler 关闭、Provider 密钥及 URL 为空、四项付费额度为0，数据库/Redis只指向本轮服务。该检查不输出秘密值；未读取实际 `.env`、连接生产或调用收费模型。

## TLS 与客户端夹具的首四次失败

证据根目录为 `test-results/local-stack-20261103/`，`run-index.json` 保存各轮目录、原退出码与 manifest 指纹。以下四轮均 exit1、cleaned=true，sourceVerified=false；未完成的来源验证不补填成功。

| runId / 目录后缀 | 原失败 | 范围 |
| --- | --- | --- |
| `ebd19af8ca7792452c609687-Uhs7Tv` | Local HTTPS stack not ready | 尚未进入浏览器；后续独立 TLS 对照定位无 SNI 的 IP 客户端握手问题 |
| `280bf9ed8faa87b7e7b0cb20-9CLgbC` | Docker 命令 exit1 | 六容器已健康；从 tmpfs 导出公开 CA 的夹具需要调整 |
| `5e631c303524e39b5907f2d9-r4AWJo` | 原部署 smoke exit60 | Windows curl 的 CA/Schannel 验证未通过 |
| `9d059d0938761b61c8325b8e-2Cxepc` | 原部署 smoke exit60 | 客户端路径和本地 CA 吊销信息处理仍未满足，不是业务流程通过 |

三个 `tls-probe-*` 的原 summary 均保留。无 `default_sni` 时，不显式发送 SNI 的 IP 请求为 EPROTO，显式 SNI 为200；设置本轮 edge 的 `default_sni` 后两者均200。未据单次 readiness 超时直接推定应用故障。

`docker cp` 无法读取该 tmpfs 中的公开根证书，改为 `docker exec … cat` 导出该公开 CA；没有导出私钥。Git Bash 中固定本轮 curl 包装器的 POSIX PATH，显式指定本轮 CA；仅针对该本地 CA 缺少吊销信息的情形使用 Schannel `--ssl-revoke-best-effort`，保留证书链及主机名检查。最终对照为正确 CA 退出0、错误 CA 退出60，没有使用 `--insecure` 或修改系统信任库。

配置及命令依据：[Caddy 全局选项](https://caddyserver.com/docs/caddyfile/options)、[Docker cp](https://docs.docker.com/reference/cli/docker/container/cp/)、[curl 证书验证](https://curl.se/docs/sslcerts.html)、[curl 吊销信息 best-effort 选项](https://curl.se/docs/manpage.html#--ssl-revoke-best-effort)。这些夹具修正不等于生产代理/TLS配置已经验收。

## 第五轮：真实 smoke 通过，浏览器流程失败

`run-b1aeed134c93b1eb08e8d6ea-8Dqz4T` 已通过仓库原 preflight、六容器健康和原部署 smoke，真实 PG 已应用27项迁移。API深健康、Web健康及匿名首页均200。

浏览器 `browser-2026-11-02T17-16-47-390Z-2dd825f179/summary.json` 为3通过、1失败、12阻塞，exit1：作者通过页面注册时，等待注册响应20秒超时；后续登录、生成、发布、撤回、OG、星图和权限链因前置身份未建立而阻塞，不能当成这些功能分别失败或通过。非作者合成账号的直接 API 注册201、页面无外部请求/未捕获异常等已执行项单列保留。

整轮最终 exit1、sourceVerified=true、cleaned=true。独立 `independent-live-inspection.json` 核对上述实际配置，并在结束后读回本轮容器/网络/卷均为空；其 SHA256 为 `0c10c81435938b582999231be766cb5e12cfdb4a4a0f06236254c37dafb1c4d2`。原 manifest SHA256 为 `df9360ad27eaa7de615f17cff572450ec2addd743fe5960da336138de6411521`。

浏览器为本地私有 CA 设置 `ignoreHTTPSErrors=true`，因此浏览器通过本身不证明 CA 信任链；正确/错误 CA 的拒绝对照由上文真实 curl 单独执行。

## 第六轮：在旧成品上定位水合丢失输入

`run-736aca8ad188c07c8e555ca4-PwxX2A` 使用同一旧 Web 成品，仅运行受控诊断，不代替完整16组流程。实际拦住7份静态 JS，在 SSR 页面已显示、客户端事件尚未接管时观察注册表单：密码框和提交按钮可用，合成输入长度52；释放 JS 后，水合过程的 value setter 写入长度0，输入丢失且原生有效性检查失败。

`browser-hydration-8d61931f0fa1c01a/summary.json` 为2通过、2失败：两项失败分别是客户端未就绪时控件仍可用、已接受的早期输入未保留；水合后重新填写并通过真实 UI 注册返回201，另一项确认没有原生密码查询参数导航或外部请求。诊断未在水合前点击提交，不能把潜在原生 GET 风险写成已观察到密码泄露。

整轮 exit1、sourceVerified/cleaned=true，本轮容器/网络/卷均为空；manifest SHA256 为 `7b59da3bee0b0fb8af6ad48147026912fd2f9522b8c8c50cb5542c9f936b2a62`。

## 已实施修复与尚待验证

最小产品修复仅改 `FrequencyLoginForm.tsx`：以 SSR 为false、客户端为true的就绪快照禁用两张凭据表单的输入与提交，事件接管后再启用；表单显式 `method="post"`。没有引入任意延迟，也没有修改注册 API 或认证契约。

`tests/e2e/runtime/production.spec.ts` 新增生产回归：实际拦住静态 JS，检查水合前两张表单禁用、POST方法，释放后可交互，并检查登录、httpOnly会话、SSR导航和刷新。该项使用生产 Web 与合成 API 夹具，与上面的真实后端全栈流程分开报告。

修复后的本机 Web 完整检查已 exit0：lint、类型、192项单测及生产构建通过。新增回归后的 Linux Web39项、新成品的真实隔离全栈16组及相应来源/清理尚待执行。旧成品的受控失败和历史38项成绩均不转记为修复后通过。最终应另记精确提交/来源、实际成品、完整失败/阻塞计数及清理读回；本轮不包含实机、读屏器、真实模型、人评、生产部署或 A3 数据处置。
