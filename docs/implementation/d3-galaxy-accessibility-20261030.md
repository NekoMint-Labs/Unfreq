# D3 星图键盘阅读、焦点与减少动画（R08）

状态：D3 本地验收通过，已更新总进度；远程同步状态见进度表。实施依据为所有者提供的 `Unfreq_Implementation_Spec_v1.md` 的 D3。沿用 `E:\unfreq`，当前分支为 `codex/d3-galaxy-accessibility`。先将前几轮已验收的 C2、D1、D2 保存为 `e3c6c1c`，并已推送此提交；D3 在这个基线上单独提交。没有合并、生产部署、数据库迁移或收费调用。

## 问题与证据

D1 已提供同批样本的 DOM 列表，但旧阅读层是普通 `aside`，缺少完整的弹窗标题、Tab 限制与关闭焦点恢复。WebGL 创建失败或上下文丢失时没有自动提供列表入口，系统减少动画偏好也未作用于旋转、闪烁和相机缓动。

先补四项生产构建浏览器回归，在原 D2 构建上全部失败；记录为 `test-results/d3-browser-before-20261030.log` 与 `test-results/d3-runtime-before/`，保留失败 trace。本轮没有用只检查 canvas 存在的测试代替交互验收。

## 实现与边界

- 保留同一个经 C1 公开校验、D1 限制为最多 80 条的返回样本。列表支持 Tab 选择、Enter 阅读及 Escape 收起，收藏、共振和举报仍走现有动作接口，没有额外抓取隐藏或未返回内容。
- 阅读层使用原生 modal `dialog`，用可访问标题与简短操作说明关联。打开时聚焦关闭按钮，Tab 循环限制在当前可见控件；Escape、关闭按钮和空白处关闭后恢复触发位置。画布选点与 focus 链接进入时返回列表入口。原生模态同时限制页面背景焦点，阅读时锁定背景滚动。
- 保留嵌套举报弹窗的独立 Escape 和焦点恢复。关闭举报只返回阅读层的举报按钮，不关闭阅读层。
- 可以主动关闭三维视图。WebGL2 预检失败或上下文丢失时展开同批列表，绘制数显示为 0。预检在扩展可用时主动释放临时 GPU 上下文；上下文丢失监听安装在画布宿主的捕获阶段，覆盖画布可见但内部 effects 尚未完成的时机。保留 React 错误边界处理绘制子树错误。
- 系统减少动画偏好在服务端初始帧和客户端实时变化中生效。减少模式使用按需绘制，关闭自动旋转、节点闪烁与选中脉冲、星云漂移、相机缓动和阅读层位移；保留直接拖拽、缩放和列表操作。普通模式保留原有视觉与分档，不改变坐标、评分、采样或线关系。
- 长文允许断开连续字符串，正文独立滚动，关闭按钮留在固定的阅读层上；桌面采用安全居中，内容过高时从顶部排列。关闭与动作按钮至少 44px，增加可见焦点边框并提高正文附属信息与动作文字的对比度。

主要改动为 GalaxyCanvas、GalaxySignalSheet、GalaxyScene、GalaxySignalNode、GalaxyBackdrop、GalaxyLinks、globals.css，以及新增 GalaxyGraphicsBoundary 和 useGalaxyReducedMotion。配套改动为运行时合成夹具、生产浏览器测试、使用指南、FAQ、能力规范与本记录。无 API、DTO、依赖、环境变量或 schema 变更。

## 回归过程

首次 lint 发现对 hook 返回 DOM 引用的直接赋值与 cleanup 引用提示，修正后 lint、类型检查、119 项 Web 单测与构建通过。早期失败日志保留，没有将它们写为通过。

首轮完整浏览器为 14/16。键盘阅读、互动、嵌套举报和原有 C1/C2/D1/D2 流程通过；创建失败未触发 React 错误边界，因此改为初始化前预检。首轮静止截图也未排除画布区域叠加的页面 CSS 动画；后续两次截图同样禁用无关 CSS 动画，以隔离 WebGL 运动，同时保留普通模式图像必须变化的反例。

第二轮 D3 专项为 2/4：创建失败和键盘阅读通过；暴露上下文监听的初始化时机，以及尺寸测试把闭合举报弹窗内按钮计入可见控件的问题。监听移至宿主捕获阶段，尺寸和对比度检查限定当前可见控件。前两轮日志及 trace 分别保留在 `test-results/d3-browser-production-20261030-r1.log`、`test-results/d3-runtime-r1/` 和 `test-results/d3-browser-production-20261030-r2.log`、`test-results/d3-runtime-r2/`。

第三轮生产浏览器 16/16、开发 E2E 6/6，见 `test-results/d3-browser-production-20261030-final.log` 和 `test-results/d3-browser-development-20261030-final.log`。人工看图又发现长文滚动到底部会使关闭按钮离开屏幕，因此继续将正文滚动区与关闭按钮分开，并增加滚动后按钮仍在视口中的断言。这一轮通过不代替后续修复的最终验证。

最终完整前端检查见 `test-results/d3-web-check-20261030-verified.log`：lint、类型检查、15 个文件共 119 项单测和生产构建通过。修复固定关闭入口后的生产浏览器为 16/16、开发 E2E 为 6/6，分别见 `test-results/d3-browser-production-20261030-verified.log`、`test-results/d3-browser-development-20261030-verified.log`，产物目录为 `test-results/d3-runtime-verified/` 和 `test-results/d3-e2e-verified/`。

随后仅加深关闭按钮的普通/悬停底色，避免正文从按钮后透出，并收紧对比度测试背景上界。重新生产构建通过，日志 `test-results/d3-web-build-20261030-palette.log`；对应长文、200% 字号、按钮位置/尺寸、对比度及实时减少动画专项 1/1 通过，见 `test-results/d3-browser-palette-20261030.log` 和 `test-results/d3-runtime-palette/`。未在此后修改交互逻辑。

三张最终滚动布局截图已查看：390px 长文、200% 字号底部操作及桌面长文；最后配色下的 200% 字号截图也已查看。正文未横向溢出，滚动后关闭按钮仍在视口中，操作可以到达。截图位于上述运行目录中 `production-D3-reduced-moti-e848e-le-at-200-percent-text-size-chromium-production/`。

对比度使用计算后的前景色，对保守的暗背景上界 `#2c2e38` 检查至少 4.5:1；200% 指根字号放大，并非实体手机捏合缩放。画布截图静止/变化检查不是帧率或真实设备性能结论。源码指纹见 `test-results/d3-source-20261030.json`。本轮未改 API 或 contracts，没有把 D1 的 API/隔离集成成绩说成 D3 重跑结果。

## 回退与剩余边界

无数据迁移。D3 是 `e3c6c1c` 之后的独立代码提交，可单独 revert，再跑 Web 和浏览器检查；保留 C1/C2/D1/D2 的公开性、举报、覆盖和视觉说明。回退不操作任何用户数据。

自动化验证浏览器可访问名称、状态、焦点和键盘动作；截图另行人工查看。本轮不宣称完整 WCAG 合规，也不替代实体手机、NVDA、VoiceOver 等读屏器实测。后续按规范继续 D4 的轮询、续写上下文与历史统计。
