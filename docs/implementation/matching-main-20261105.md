# E2/E3 独立提取：来源、分数与可复算评估

本候选依赖 #22 的 `555c5a8`，保留公开读取和发布响应零 Provider 派发。来源为归档 #13，未整体导入旧 E1/E4 或依赖树。

公开发现只比较作者确认的分类与标签，不使用未确认的指纹编辑。数据库在 LIMIT 前按确认分类、标签重合及稳定时间/ID 排序；当前候选上限 50，最终最多三条。只推荐有已知作者的 human（用户发起）内容，排除父表达作者及已登录访问者。匿名访问不能识别现实中的访客身份。候选与父表达在异步读取后复核公开版本、来源和作者；不读取未返回的隐藏内容，也不为填满卡片伪造候选。

匹配 DTO 仅追加来自当前数据库的 contentSource；前端严格白名单同步验证，不从 PUBLISHED 状态猜测创作来源。卡片显示“用户发起 / 系统 AI 生成 / 演示样本 / 来源未标注”，不再展示未经校准的数值或概率。来源标签不表示正文由纯人工创作。

生成阶段保留现有语义召回，重排输出必须覆盖完整候选批次、ID 唯一且分数合法；否则整批走原降级路径。SiliconFlow 显式请求 top_n 为候选数量，return_documents=false；字段已对照[官方 Rerank 文档](https://docs.siliconflow.cn/docs/api/rerank-post)。配置 extraJson.scoreScale 或 RERANKER_SCORE_SCALE 明确声明 zero_to_one / zero_to_hundred，兼容默认是 zero_to_one。范围无效时不派发。统一换算到 0–1，再按原有 0.6 检索项与最多 40 分规则项组合，公开契约限定 0–100；这些数值仍不是概率。没有移植旧分支暂定的 K=12/24 或 80 分生产门槛，也没有宣称已完成人工校准。

冻结保留 e3-matches.v1.json 及其 SHA256，四组标签明确为 synthetic-presets-not-human。离线 `npm --workspace @unfreq/api run matches:evaluate -- --file <capture.json>` 只汇总已捕获的候选 ID、标签和计数，不加载 Provider 配置或发起请求。Recall 先去重，nDCG@3 使用指数增益；空真值查询单列误匹配率，不为其捏造 nDCG。人评相关性、货币成本为 null，modelQualityValidated=false。

真实 PostgreSQL 用例验证旧时间窗口之外的相关候选、本人/访客/系统排除及当前来源字段。指标公式、冻结字节、重复结果和异常范围另有单测。合成标签与本地网络故障测试只验证工程机制，不能代替模型质量、真实样本标注、性能或费用验收。

API/Web 需同步发布：旧 Web 的严格白名单会拒绝新增的 contentSource。回退时成对恢复 API/Web，保留 C1 的确认与撤回边界。没有自动重嵌入、改写历史快照或删除数据。
