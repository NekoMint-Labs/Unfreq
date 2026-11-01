# Main 必需集成检查验收

日期：2026-11-01。对应 [issue #6](https://github.com/NekoMint-Labs/Unfreq/issues/6) 和 [A2 评审要求](https://github.com/NekoMint-Labs/Unfreq/pull/2#issuecomment-6555152133)。

#2 经维护者独立批准后 squash 合入 main，合并提交为 `c80fef65fa9f18a71305569ed5b1ee5e76a7fe61`；该提交的 API、Web、部署脚本和 `Isolated API integration` 四项检查均成功。没有在 #2 合并前提前启用新要求。

维护者于北京时间 20:01:09 更新规则集 `Main`（ID `26036072`）。执行端只读验收：

- enforcement 仍为 active，目标仍是默认分支，exclude 为空。
- 必需检查为 `api checks`、`web checks`、`Deployment script tests`、`Isolated API integration`，均绑定 GitHub Actions 的 integration_id `15368`。
- strict_required_status_checks_policy 仍为 true，do_not_enforce_on_create 仍为 false。
- 原禁止删除、非快进限制、线性历史、一次审批、最后推送批准、过期审批失效、线程解决和仅 squash 等参数保持。
- 从修改后 JSON 中移除新增检查后，name、target、enforcement、conditions、rules 的可读取字段与修改前逐项相同。
- `GET /repos/NekoMint-Labs/Unfreq/rules/branches/main` 返回的实际生效状态规则也包含上述四项，来源为该仓库的规则集 `26036072`。后续 #3 的同名四项作业均已成功。

前后 JSON、比较结果及实际生效规则保存在本地忽略目录 `test-results/ruleset-20261101/`，分别为 `before-public.json`、`after-owner.json`、`verification.json` 和 `effective-main-rules.json`。仅对接口可读取的字段作比较，不推定未返回的设置。

执行端现有认证没有仓库管理权限；浏览器工具因无法可靠确定当前 URL 停止网页操作，所以设置由维护者完成。执行端没有修改角色、创建凭据、绕过保护或继续使用被停止的浏览器控制。设置后通过接口验收，issue #6 已按完成关闭。
