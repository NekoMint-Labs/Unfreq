# 旧版本成组回退后的真实数据库与故障回归

日期：2026-11-02（北京时间）。本轮接续[源码与依赖组回退](./api-image-20261102.md#旧版本源码与依赖组回退)，在原独立副本补齐真实 PostgreSQL/Redis 业务及连接故障验证。没有切换主目录版本或修改该副本的冻结源码。

## 运行来源与结果

固定基线为 `c54f7e4e28d091954231f268665d1f13d9e1320a`，tree 为 `65912f17eeb413d2c4e0cf4a4324fc03eb9f9606`。副本位于 `E:\unfreq\test-results\postgres-rollback-20261102\source-canonical`，正常安装的 `postgres@3.4.9` 保留同一基线的四文件补丁。此前的542包安装、完整依赖树及幂等检查不在本轮重复执行。

在该副本原样执行 `npm run api:integration`：先构建 contracts，再由原托管运行器编译独立 runtime、创建临时 PG/Redis 并运行全部测试。源码无需 `.git` 元数据；没有改运行器、测试、30秒准备预算、测试超时或固定测试范围，也没有用预编译共享 dist 替代本轮 runtime。

运行标识为 `run-I9qPFM`，runId 为 `ea4609d185a7`，随机项目为 `unfreq-it-ea4609d185a7`。结果为8文件、113/113，失败/待执行/todo均为0，原运行器和外层包装器均exit0、interrupted=false、cleaned=true。原运行器含准备与清理的耗时约480.53秒，Vitest自身433.74秒；这些是本机合成演练耗时，不是生产性能承诺。

| 原测试文件 | 本轮通过 | 范围 |
| --- | ---: | --- |
| core-flow | 47/47 | 注册、身份镜像、发布/撤回、公开权限、匹配、来源与未知解释等实际 API/数据库行为 |
| abuse.integration | 21/21 | 多进程共享额度、Redis故障、真实本机HTTP/WS音频工作及取消栅栏 |
| postgres-eof | 19/19 | 原生ESM/CJS的启动FIN、类型加载FIN，query/reserve/begin/Drizzle事务、双槽五路工作、同池恢复及旧注册无晚到写入 |
| generation-checkpoints | 10/10 | 进程死亡、持久领取、派发前后栅栏、ABA、排队观察、实际挂起请求的关闭排空和SQL故障退避 |
| generation-reliability | 6/6 | 进程重启恢复、六路工作共享并发限制、管理员HIDDEN/DELETED及过期完成/失败写入栅栏 |
| f1-scheduler | 7/7 | 每日领取、业务时区、进程死亡不重放、挂起派发取消、晚SQL失败及持久预算 |
| f2-recovery | 1/1 | 合成SQL/媒体/config检查点恢复到空库，恢复检查及较新撤回状态重放后开放读取 |
| failures | 2/2 | PostgreSQL/Redis启动握手TCP RST时的存活探针及通用API错误契约 |

Node实际为 `22.22.2`。临时服务仍使用原 Compose 固定镜像：PG `sha256:7b822b0aac60967beb1ea5e576b8602c94c300a157d187f385ae3e0da199b90a`、Redis `sha256:6ba19c50b56777f5c11c58eff8ddb69d0d5f27ba131cffb63f180ccfd43c66af`。Provider仅为本机合成桩，未读取实际 `.env`、真实账号或生产数据，未调用收费模型。

## 来源、产物与清理读回

- 包装器运行前后逐一核对568份归档源码，变化为0；两份来源快照SHA256均为 `328e72bc0c8c6067f064f16bd61673794ffaf63647a4465aae527ebf696a607c`。新 contracts/runtime 产物不包含在“568份原源码不变”的声明中。
- 原运行器marker的101份来源和83份编译产物在结束后独立逐一核对，变化为0；安装的旧四文件补丁SHA仍与metadata一致。
- 主目录 `postgres@4.0.0` 的包标识及两份补丁目标在运行前后哈希不变；本轮没有对主目录依赖执行安装或回退。
- 原runner执行 `compose down --volumes` 后，再固定本机Docker endpoint并按该项目标签分别查询容器、网络、卷，三者均为空。

本机忽略证据根目录为 `test-results/postgres-rollback-20261102/`：`real-integration/` 保存包装命令、完整stdout/stderr、568来源快照和独立验证摘要；原runner的 manifest/vitest/runtime-marker 及F2报告保留在副本 `test-results/integration/run-I9qPFM/` 中。

| 证据 | SHA256 |
| --- | --- |
| `real-integration/verified-summary.json` | `6c373f1f82ade2ccf545a14e63ac7926330131bdaa74cd8033b66f84e9f1ea3e` |
| 原runner `manifest.json` | `d36d38a99385eb4711467fe4430a1bd5341a27d55a875bd5d31913ce791facd2` |
| 原runner `vitest.json` | `c8c7ecfc004424bec290fd463814c77ae505f382bc2aeaeda824dd3c95265e92` |
| 原runner `runtime-marker.json` | `aa262ab47d43026bdb40abc08b430ea5129c72800dd28f38265286cea6519aae` |

## Docker启动障碍及有限环境恢复

第一次检查时本机engine pipe不存在。正常 `docker desktop start --detach` 虽返回0，backend仍在启动时因无法移除 `sailor-ingest.sock` 而退出；该次没有启动任何集成测试或创建测试容器。

直接打开这些陈旧项时Node lstat和fsutil均返回访问错误。随后使用只读的Windows目录枚举API读取reparse tag，确认 `LocalAppData/Docker/run` 仅有四个零字节 `0x80000023`（AF_UNIX）项，`LocalAppData/docker-secrets-engine` 仅有一个同类 `engine.sock`；两个目录及祖先为普通目录，Docker相关进程均已退出。

在上述证据和明确的有限恢复范围下，将这两个运行目录各自在同一父目录完整改名保留为 `.stale-rollback-20261102T132312Z-bd9fc696`，逐项核对保留内容，再创建空运行目录并正常启动Docker。引擎随后恢复为29.7.2，起测前容器列表为空。没有删除旧目录、socket、VHD或数据卷，没有修改ACL、settings、全局WSL或其他应用。证据为 `docker-startup-error-excerpt.txt`、`docker-runtime-socket-inspection.json` 和 `docker-runtime-restoration.json`；有限运行目录恢复不证明所有Docker故障根因已消除。

## 验收边界

本结果验收旧3.4.9源码/依赖成组恢复后的完整合成业务和原有连接故障回归，包含临时数据库中的合成恢复演练。它不覆盖生产旧数据库/备份、目标部署、第三方副本、真实模型质量、费用或真实数据迁移。

旧版本113项与新v4成品的运行中任务关停场景属于不同来源、不同门禁。旧版本通过不转记为新v4镜像成绩；新镜像专项须按自身精确输入、实际场景与资源清理另记。
