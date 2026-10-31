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

根 `.env.example` 是服务器部署模板。正式部署前把 `SESSION_SECRET`、`PROVIDER_CONFIG_SECRET` 和 provider key 换成真实值。不要提交 `.env`。不要把真实 AI Key 写进仓库。

生产还必须设置 `ABUSE_PROTECTION_ENABLED=true` 和完整的 `ABUSE_LIMITS_JSON`。字段模板见 `deploy/abuse-policy.example.json`：其中所有额度为零，会拒绝对应入口，它只列出配置结构。先按预计流量、实测误封情况和 Provider 预算填写，再压成一行写入 `.env`；仓库尚无经业务基线确认的生产额度。所有 API 副本必须共用 Redis、命名空间、HMAC 密钥和相同策略。更换密钥或命名空间会开始新的计数空间，应按一次额度重置处理。

策略包含注册 IP/全站、密码请求和失败 IP/FM+IP、邮箱请求与校验 IP/全站、生成用户请求/用户日/全站日、音频读取/请求/新增 IP/新增全站日、诊断 IP/全站，以及 chat、embedding、reranker 调用次数和 TTS UTF-16 字符单位。`limit=0` 表示拒绝；窗口按 Redis 时钟对齐，日额度应填写 `windowMs=86400000`。`pendingPerUser` 约束该作者已接收和运行中的生成任务，`ttsConcurrency` 约束共享有效音频租约，`ttsTaskTimeoutMs` 约束整次音频任务。调用额度包含每次重试及备用 Provider，属于费用上界控制，不能直接当作供应商账单金额。

C2 新增三个必填预算：`reportRequestUser`、`reportRequestIp`、`reportReadUser`。升级前按示例结构补齐全部 API 副本的策略；缺字段拒绝启动，不静默采用生产阈值。回退到旧 API 时同步恢复旧策略结构。举报接口只接受当前已确认公开的 SIGNAL，旧 USER 举报保留在后台处理；创建响应已收窄为私密状态回执。

`ABUSE_HMAC_SECRET` 可留空以使用 `SESSION_SECRET`，也可配置至少 32 字符的独立密钥。Redis 不可用时，受保护入口和远端 Provider 派发返回安全失败。开发环境未填写完整策略时，可使用本地生成 fallback，但不能派发远端 Provider。

生产邮箱验证码登录默认关闭，且禁止 `local-log` 与验证码响应回显。当前尚未实现生产邮件发送，部署时保持 `AUTH_LOGIN_DELIVERY_MODE=disabled`、`AUTH_LOGIN_CODE_RESPONSE=disabled`，使用 FM 代号和密码注册登录。

常用字段：

```text
WEB_ORIGIN                 公网访问地址，生产必须是 https://
UNFREQ_PROXY_NETWORK       已存在的反代 Docker 网络，默认 npm_default
SESSION_SECRET             会话签名密钥，生产必须是非占位强随机值
PROVIDER_CONFIG_SECRET     Provider Key 加密密钥，生产必须是非占位强随机值
AI_BASE_URL / AI_API_KEY   可选 AI 服务；为空时使用本地 fallback
EMBEDDING_API_KEY          可选 embedding；为空时回到关键词/标签匹配
TTS_API_KEY                可选服务端 TTS；为空时保留浏览器朗读 fallback
```

API 容器启动时会先执行数据库迁移。生产模式会拒绝占位 `SESSION_SECRET`、占位 `PROVIDER_CONFIG_SECRET`、占位域名和非 HTTPS `WEB_ORIGIN`。

音频任务新增的 `audio_attempt_id` 为可空字段，迁移保留历史记录。更新前暂停新任务并等待旧进程退出，所有写入进程再统一升级；带任务归属的音频仍在运行时，不应回滚到按 ID 无条件回写的旧版本。新任务采用共享额度、任务归属条件写回和独立文件名。进程崩溃后的未知 `PENDING` 暂不自动重发，以避免重复收费；其目标环境恢复仍待单独验收，F1 的每日批次验证不改变这个边界。共享租约过期不能证明供应商远端计算已停止。

## F1 身份镜像与每日系统调度

F1 的 0026 迁移只增加每日批次账本。注册、凭证和权限镜像修复不批量改写历史身份。发布时统一升级全部 API 实例，并核对 [F1 配置与切换说明](./implementation/f1-identity-scheduler-20261031.md)；旧实例不识别新调度账本，不能混跑来承诺跨实例防重。

`AI_SIGNAL_SCHEDULER_ENABLED` 默认 false。需要自动生成时，再按实际模型和费用范围选择业务时区、触发时间、数量和派发预算；所有实例使用同一配置。启动已过触发时刻会补当天一次，已领取、失败或取消的当天批次不自动重放。新增环境变量见 `.env.example`，不替代已有 Redis 站点 Provider 限额。

默认关闭宽限期与 Compose 的 40 秒 `stop_grace_period` 相容；提高 scheduler/生成或数据库关闭预算时一并提高部署宽限期。回退前先停止并排空调度，保留账本。F1 前版本默认自动调度且没有新开关，不能只设置新变量就直接恢复旧版多副本调度。

## 反代配置

Nginx Proxy Manager 转发到：

```text
Scheme:              http
Forward Hostname/IP: unfreq-proxy
Forward Port:        80
```

如果反代网络不叫 `npm_default`，改 `.env`：

```env
UNFREQ_PROXY_NETWORK=你的网络名
```

API 默认不信任 `X-Forwarded-For`。需要按访客 IP 限流时，将 `TRUSTED_PROXY_CIDRS` 配为实际代理链的固定地址/CIDR，并确保这些地址只有代理能使用、入口会覆盖客户端伪造的转发头；不要使用布尔值或跳数。地址留空时，API 按直连代理的 IP 计数，同一代理后的用户会共用 IP 额度。当前 Caddy/NPM 部署应先核实实际转发链，再填写信任范围。

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
