# 部署指南

这份文档适合把 Unfreq 部署到一台服务器上。

默认部署方式是 Docker Compose。它会启动 Web、API、PostgreSQL、Redis 和 Caddy。Caddy 接入已有 Nginx Proxy Manager 网络 `npm_default`，Web、API、PostgreSQL、Redis 留在内部 `app` 网络。

## 快速开始

```bash
cp .env.example .env
```

编辑 `.env`：

```env
WEB_ORIGIN=https://你的域名
UNFREQ_PROXY_NETWORK=npm_default
```

启动：

```bash
docker compose up --build -d
```

## 环境变量

根 `.env.example` 是服务器部署模板。正式部署前设置非占位的 `SESSION_SECRET`、`PROVIDER_CONFIG_SECRET`，并为实际启用的 Provider 配置地址、模型及所需凭证。不要提交 `.env`。不要把真实 AI Key 写进仓库。

生产还必须设置 `ABUSE_PROTECTION_ENABLED=true` 和完整的 `ABUSE_LIMITS_JSON`。字段模板见 `deploy/abuse-policy.example.json`：其中所有额度为零，会拒绝对应入口，它只列出配置结构。先按预计流量、实测误封情况和 Provider 预算填写，再压成一行写入 `.env`；仓库尚无经业务基线确认的生产额度。所有 API 副本必须共用 Redis、命名空间、HMAC 密钥和相同策略。更换密钥或命名空间会开始新的计数空间，应按一次额度重置处理。

策略包含注册 IP/全站、密码请求和失败 IP/FM+IP、邮箱请求与校验 IP/全站、生成用户请求/用户日/全站日、音频读取/请求/新增 IP/新增全站日、诊断 IP/全站，以及 chat、embedding、reranker 调用次数和 TTS UTF-16 字符单位。`limit=0` 表示拒绝；窗口按 Redis 时钟对齐，日额度应填写 `windowMs=86400000`。`pendingPerUser` 约束该作者已接收和运行中的生成任务，`ttsConcurrency` 约束共享有效音频租约，`ttsTaskTimeoutMs` 约束整次音频任务。调用额度包含每次重试及备用 Provider，属于费用上界控制，不能直接当作供应商账单金额。

C2 新增三个必填预算：`reportRequestUser`、`reportRequestIp`、`reportReadUser`。升级前按示例结构补齐全部 API 副本的策略；缺字段拒绝启动，不静默采用生产阈值。回退到旧 API 时同步恢复旧策略结构。举报接口只接受当前已确认公开的 SIGNAL，旧 USER 举报保留在后台处理；创建响应已收窄为私密状态回执。

`ABUSE_HMAC_SECRET` 可留空以使用 `SESSION_SECRET`，也可配置至少 32 字符的独立密钥。Redis 不可用时，受保护入口和远端 Provider 派发返回安全失败。策略未配置完整或调用额度不足时，不派发受保护的远端调用，也不能通过备用 Provider、重试或本地 fallback 绕过保护。辅助能力有本地规则不代表主生成能在该配置下完成。

生产邮箱验证码登录默认关闭，且禁止 `local-log` 与验证码响应回显。当前尚未实现生产邮件发送，部署时保持 `AUTH_LOGIN_DELIVERY_MODE=disabled`、`AUTH_LOGIN_CODE_RESPONSE=disabled`，使用 FM 代号和密码注册登录。

常用字段：

```text
WEB_ORIGIN                 公网访问地址，生产必须是 https://
UNFREQ_PROXY_NETWORK       已存在的反代 Docker 网络，默认 npm_default
SESSION_SECRET             会话签名密钥，生产必须是非占位强随机值
PROVIDER_CONFIG_SECRET     Provider Key 加密密钥，生产必须是非占位强随机值
AI_BASE_URL / AI_API_KEY   主生成需可用聊天 Provider；也可由后台配置，缺少可用配置会失败
EMBEDDING_API_KEY          可选 embedding；缺少时匹配可回到规则或返回空结果
TTS_API_KEY                可选服务端 TTS；为空时保留浏览器朗读 fallback
```

主生成的素材与正文扩写需要可用的聊天 Provider，当前不以本地文学模板兜底。API 接收请求只表示任务已排队，不表示生成已完成；缺少 Provider 时会记录 `AI_UNAVAILABLE/config_missing`，受持久任务重试上限约束，最终可能为 `FAILED/GENERATION_RETRY_EXHAUSTED`。部分指纹、分类、审核和月度回顾具有各自的本地规则或模板，不能据此承诺无 Key 的完整生成闭环；[本机隔离验收](./implementation/local-stack-20261103.md)保留了相应实际失败。

API 容器启动时会先执行数据库迁移。生产模式会拒绝占位 `SESSION_SECRET`、占位 `PROVIDER_CONFIG_SECRET`、占位域名和非 HTTPS `WEB_ORIGIN`。

音频任务新增的 `audio_attempt_id` 为可空字段，迁移保留历史记录。更新前暂停新任务并等待旧进程退出，所有写入进程再统一升级；带任务归属的音频仍在运行时，不应回滚到按 ID 无条件回写的旧版本。新任务采用共享额度、任务归属条件写回和独立文件名。进程崩溃后的未知 `PENDING` 暂不自动重发，以避免重复收费；其目标环境恢复仍待单独验收，F1 的每日批次验证不改变这个边界。共享租约过期不能证明供应商远端计算已停止。

## F1 身份镜像与每日系统调度

F1 的 0026 迁移只增加每日批次账本。注册、凭证和权限镜像修复不批量改写历史身份。发布时统一升级全部 API 实例，并核对 [F1 配置与切换说明](./implementation/f1-identity-scheduler-20261031.md)；旧实例不识别新调度账本，不能混跑来承诺跨实例防重。

`AI_SIGNAL_SCHEDULER_ENABLED` 默认 false。需要自动生成时，再按实际模型和费用范围选择业务时区、触发时间、数量和派发预算；所有实例使用同一配置。启动已过触发时刻会补当天一次，已领取、失败或取消的当天批次不自动重放。新增环境变量见 `.env.example`，不替代已有 Redis 站点 Provider 限额。

默认关闭宽限期与 Compose 的 40 秒 `stop_grace_period` 相容；提高 scheduler/生成或数据库关闭预算时一并提高部署宽限期。回退前先停止并排空调度，保留账本。F1 前版本默认自动调度且没有新开关，不能只设置新变量就直接恢复旧版多副本调度。

## F2 日志与只读匹配

F2 新增分数来源理由 read_only，部署时先更新兼容的 Web 校验或同步更新 API/Web。浏览公开/作者详情和 matches 不再自动派发 Provider，缺少有效存量向量时使用规则或返回空；显式生成/backfill 仍受原预算控制。

五个 Compose 服务默认 json-file 轮转为每文件 10m、最多 3 份，可由 UNFREQ_LOG_MAX_SIZE / UNFREQ_LOG_MAX_FILES 调整。这是容量配置，不代表按天数的保留政策，也不会修改已运行容器或外部收集器。备份恢复保护及开放条件见[运维手册](./operations.md)；本地演练不能代替发布环境验收。

## 反代配置

Nginx Proxy Manager 转发到：

```text
Scheme:              http
Forward Hostname/IP: unfreq-proxy
Forward Port:        80
```

公网入口必须使用 HTTPS，`server preflight` 也要求 `WEB_ORIGIN` 为 `https://`；NPM 到项目 Caddy 的这一跳仍是 HTTP。仓库 `deploy/Caddyfile` 因此在所有 Web 上游路由覆盖 `X-Forwarded-Proto: https`，向 Web 传递这一固定的 server 部署约定，不直接相信客户端传入的协议头。容器间的 `web:3000` 连接仍为 HTTP，这项设置不会为它启用 TLS，也不替代 API 的可信代理 CIDR 配置。

[后续本机局部验收](./implementation/remaining-local-20261103.md)已实际使用固定NPM2.16.0、自有证书、当前Caddy和已验Web成品，核对HTTPS公开地址、接口分流和伪造头处理；它使用只读合成API，不代替生产部署。发布时仍须在目标入口核对HTTPS、会话及Web SSR/canonical/OG，真实访客IP、可信CIDR及生产额度也需单独验收。

如果反代网络不叫 `npm_default`，改 `.env`：

```env
UNFREQ_PROXY_NETWORK=你的网络名
```

API 默认不信任 `X-Forwarded-For`。需要按访客 IP 限流时，将 `TRUSTED_PROXY_CIDRS` 配为实际代理链的固定地址/CIDR，并确保这些地址只有代理能使用、入口会覆盖客户端伪造的转发头；不要使用布尔值或跳数。地址留空时，API 按直连代理的 IP 计数，同一代理后的用户会共用 IP 额度。当前 Caddy/NPM 部署应先核实实际转发链，再填写信任范围。

非零额度提案、NPM→Caddy→API 转发头边界及启用前验收步骤见 [B3 pilot 预算与代理链验收边界](./implementation/b3-pilot-boundaries-20261101.md)；其中数值尚未启用，目标环境仍待验收。

## 为什么这样部署

- Docker Compose 适合单机部署和迁移。
- Caddy 只做项目内部反代，不直接负责公网证书。
- Nginx Proxy Manager 继续负责域名和证书入口。
- Web、API、PostgreSQL、Redis 不暴露到公网反代网络。
- 数据库、Redis、图片和音频都用 volume 保存，便于迁移和备份。

## 部署检查

```bash
./scripts/deployment-stack.sh server preflight
UNFREQ_BASE_URL=https://你的域名 ./scripts/deployment-stack.sh server smoke
```
