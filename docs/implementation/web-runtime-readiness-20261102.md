# Web同成品运行续验与宿主等待修复

日期：2026-11-02。本轮生产依赖边界与API结果见[迁移器记录](./runtime-migrations-20261102.md)，交付为[草稿PR #10](https://github.com/NekoMint-Labs/Unfreq/pull/10)，基于[草稿PR #9](https://github.com/NekoMint-Labs/Unfreq/pull/9)。没有合并main、部署或调用收费模型。

## 保留的首次失败

干净 `d470fae9c855aebef85e013fc425933bfef41ca4` 的 `run-1f4107d248add6f442bc5369-OxisGE` 完成deps、prod-deps、runner三阶段构建及构建器释放；158份Docker输入和12份验证来源已冻结。Linux原生探针通过，成品 `sha256:60b1bca5587dd1396603c89df3b520d0621ab8ec7373b36129070c8fb6faa9b8`，BUILD_ID为 `XeE7GJxsEKQ21q0ro7QEO`。

宿主Node22.22.2随后在waitHttp处报告 `Detected unsettled top-level await`，提前退出，未进入38项浏览器或OG测试，也未运行finally清理。独立读回看到镜像内Next已Ready，`/web-health`实际200。首次记录不改为成功；原manifest保持不变，恢复记录为该目录 `recovery-cleanup.json` 和 `independent-build-readback.json`。核对拥有标签与精确ID后，保留日志并停止/移除自有容器和网络；容器143非OOM，旧容器、网络、卷及builder实际为空。

## 修复与续验约束

`AbortSignal.timeout()`的计时器不保持事件循环存活。新的 `runWithReferencedTimeout` 使用有引用计时器和Promise.race，覆盖fetch及响应判定，成功或失败后均清理计时器并abort。waitHttp仍为原60秒总窗口、单次最多1500ms和200ms轮询；最后identity请求也使用1500ms上限。未增加浏览器、构建或数据库测试预算。

真实独立Node子进程验证无其他句柄的请求超时、永不完成的响应判定超时，以及成功时清理60秒计时器并自然退出。CLI还拒绝路径/短ID/额外参数和远程Docker。最终工具门禁87/87，无失败/取消/跳过/todo，日志 `test-results/runtime-migration-final-20261102/web-final-tool-tests.log`。

`--resume-runtime=<24位自有runId>`只复用本机已构建成品，不接受镜像、URL或项目覆盖。它要求原三阶段真实构建及metadata/log、来源标签和固定image ID一致，158份当前输入及旧context逐字节匹配，并拒绝原资源残留。原12份验证来源中，11份非宿主来源仍须匹配；原来实际复制的6份运行夹具逐一核对，不声称旧host/spec快照存在。仅允许宿主验证器与新计时helper变化，写入buildReference；本轮13份验证来源全部实际冻结。

此次修改不在API139项集成的136份保护输入中；再次独立核对136输入、112产物仍无漂移，记录 `test-results/integration/run-Yjpd5T/web-tool-followup-sources.json`。

## 运行与图片范围

同成品续验 `run-cb56e66fd506dc0b35cb0e1c-5krnkN` 已实际38/38，无跳过、失败或flaky，浏览器389.67秒；外层exit0，sourceVerified/cleaned=true。158份Docker来源及13份验证来源的当前字节和本轮冻结副本均核对通过，buildReference仍指向上述同一个镜像和原构建。

直接Next启动后SIGTERM约3.596秒退出143；受监督runtime约3.279秒退出0，均非OOM且停止前确实running。受保护的Next外部fetch为0。实际成品清单165个包（含17个嵌套包），按名称及各层node_modules路径均未发现drizzle-kit、@esbuild-kit/esm-loader、@esbuild-kit/core-utils或esbuild；SWC、sharp和contracts真实探针通过。该库存不是完整分发合规结论。

原始日志为 `test-results/runtime-migration-final-20261102/web-image.log`，续验日志为 `web-runtime-verified.log`。首次manifest SHA256仍为 `71460b3f42dd932f912d04a48d0649ce10c1e341b0362f34e5a56721ef918ce3`，首次宿主失败和随后成功分开保存，不把原完整构建命令改写成exit0。

独立最终读回为同run目录的 `independent-final-readback.json`，SHA256 `a347f4e6d334fffabd8b22ecad8c1708b12a7016590223686384b74777100076`：15项检查通过，13条正常权限只读Docker查询均exit0，新旧run各六类资源均为空。首次sandbox npipe权限失败另存，不覆盖为成功。对应代码提交 `453f9c6` 的[四项CI](https://github.com/NekoMint-Labs/Unfreq/actions/runs/41474310409)全部通过。

浏览器为宿主Chromium访问Linux Web和合成API，不代表Linux浏览器、实体手机、真实Provider或生产部署。实际查看的中文OG卡字形清楚、换行和省略正常；emoji/稀字为既定 `[?]` 占位，页脚有说明，不宣称完整Unicode字形支持。Next的fetch guard和DNS限制不等于系统出口防火墙。
