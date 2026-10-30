# D2 星图视觉语义校正（R02）

状态：D2 本地验收通过，已更新总进度。依据所有者提供的 `Unfreq_Implementation_Spec_v1.md` 的 D2。基线为 `34c1dde` 加上已经本地验收、尚未提交的 C2 和 D1 改动；沿用 `E:\unfreq` / `feat/c1-withdrawal-privacy`。本轮范围为星图说明、阅读面板及配套文档，没有推送、合并、部署、迁移或收费调用。

## 当前来源与规范中的历史描述

当前坐标路径为 `service-mappers.ts` 的有限存储坐标复用或稳定哈希生成，再经 `galaxy-layout.ts` 做轨道、景深、缩放等艺术变换。绘制路径没有执行语义向量降维，最终距离不表示语义相似程度。历史存储坐标的来源不能仅凭字段名推定。

规范提到的“已存首个匹配与图内补位”不再准确描述当前代码。当前 `service-queries.ts` 在同批公开样本内调用既有频率资料规则评分，每点选取最多三个正分候选。前端只从这些 `matchIds` 中取线，去重并应用预算和视觉筛选，不按几何邻近补线；本轮没有恢复历史算法。

颜色区分公开主频段，并单独标记本人。`getStarVisualProfile` 的亮度和大小还混合共振分档、景深、确定性装饰取样及闪烁等因素；选中状态也会影响显示。因此点大小、亮度及线长都不能当成相似度或排名。

图内规则的加分项及字段已写入架构说明，可对照 `scoreSignalMatch` 逐项核实。公开面板只说明规则来源及记录数量，不暴露逐条私密资料值。

## 界面与文案

- HUD 新增默认收起的“星图图例”，说明可点开的公开表达、仅作装饰的背景星尘与远星、艺术位置、规则连线，以及颜色和亮度等含义。采用原生 `details/summary`，可用键盘展开；手机长图例在自身区域滚动。
- 首次进入及空状态不再要求用户“读距离”。提示直接说明艺术排布及公开阅读入口，保留原有视觉、动画和渲染分档。
- 阅读面板新增“关联说明”。只使用当前返回样本中的关联记录，合并两个方向并按表达 ID 去重；忽略自身、重复和缺失 ID，不额外请求内容。即使面板传入旧点对象，也以当前样本的关联记录为准。
- 候选记录数明确区别于实际绘制线数和匹配概率。零记录有明确说明；没有根据距离、完整私密指纹或推测生成具体连接理由，也没有增加百分比。

README、使用指南、FAQ、架构说明、能力规范及演示脚本使用同一口径。演示脚本还纠正了旧 SQL 样例可直接变成公开内容的说法：该脚本没有当前确认快照，字段兼容性也未实测；保留历史脚本和命令供参考，当前演示通过应用预览并确认合成表达，不批量补确认。没有执行该 SQL、配置真实 Provider 或改动实际数据。

中文文案经 humanizer-zh 审校，英文演示文案经 humanizer 审校；审校保留代码、命令、路径及事实边界。

主要界面文件为 `GalaxyCanvas.tsx`、`GalaxySignalSheet.tsx`、新增 `galaxy-semantics.ts` 及 `globals.css`；配套测试为 `galaxy-semantics.test.ts` 和 `tests/e2e/runtime/production.spec.ts`。未新增 API、DTO、环境变量或数据库表字段。

## 验证

修复前，新增 D2 生产浏览器案例因缺少图例失败。日志为 `test-results/d2-browser-before-20261030.log`，trace 保留在 `test-results/d2-runtime-before/`。这次失败没有被后续成功覆盖。

首轮 `npm run web:check` 通过 lint、类型检查、119 项单测和生产构建，日志为 `test-results/d2-web-check-20261030.log`；首轮生产浏览器 12/12，开发 E2E 6/6，分别见 `test-results/d2-browser-production-20261030.log` 和 `test-results/d2-browser-development-20261030.log`。随后补充同 ID 旧点对象的边界处理，最终结果单独记录。

最终 `npm run web:check` 为 15 个文件、119 项单测通过，lint、类型检查及生产构建通过，日志为 `test-results/d2-web-check-20261030-final.log`。最终生产浏览器 12/12、开发 E2E 6/6，日志为 `test-results/d2-browser-production-20261030-final.log` 与 `test-results/d2-browser-development-20261030-final.log`，产物分别保留在 `test-results/d2-runtime-verified/`、`test-results/d2-e2e-verified/`。源码指纹为 `test-results/d2-source-20261030.json`。测试结束后清除了 Next dev 自动增加的类型引用路径，没有修改业务代码。

新增四项关联说明单测，覆盖重复与缺失 ID、单向传入、双向去重、同坐标无关联，以及旧点不冒充当前记录。生产浏览器验证图例的 Enter 展开、桌面及 390px 页面宽度、实际画布选点后打开关联说明，并回归 C1/C2/D1 的公开、举报和定位流程。

首轮三张截图已查看，位于 `test-results/d2-runtime-final/production-D2-explains-art-8dd47-s-and-decorative-appearance-chromium-production/`：桌面图例、390px 图例和关联说明。未见横向溢出或图例遮挡底部筛选；截图是合成 Chromium 环境，不是实体手机验收。

`test-results/d2-visual-baseline-20261030.json` 与 `test-results/d2-visual-unchanged-20261030.json` 对比十个文件：七个前端坐标、场景、点线、背景及纹理文件，以及三个 API 查询、坐标和评分文件，全部 SHA-256 相同。变化集中在图例、阅读面板、说明辅助函数、样式和测试，没有整体重做星图。

本轮未改 API 或 contracts，不将 D1 的 API 570 项单测及隔离 83/83 说成本轮重跑结果。D2 的验证不建立真实模型质量、真实人际关系或语义布局效果。

## 迁移与回退

无数据迁移或新接口，沿用 D1 的公开样本。回退时逐块撤去 D2 的图例、说明辅助函数、阅读面板参数、专用样式及配套文案和测试即可；这些文件同时包含已验收的 C2/D1 改动，不能直接用 Git HEAD 整文件覆盖。回退后重跑 Web 检查与浏览器回归，不处理任何用户数据。

## 后续边界

自动化证明说明文字可见、可展开及规则计数符合样本记录，不能证明所有用户已经理解；本轮没有用户理解度研究。完整键盘阅读、阅读层 dialog 与焦点恢复、WebGL 异常降级、减少动画及对比度仍属 D3，不能凭图例能用键盘展开就视为完成。下一项按原规范顺序为 D3。
