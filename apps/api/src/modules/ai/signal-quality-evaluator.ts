import { signalQualityFixtures } from "./signal-quality-fixtures.js";
import type { AiSignalQuality } from "./signal-types.js";

export type SignalQualityCheckKey =
  | "concrete-anchor"
  | "distinctive-expression"
  | "first-person"
  | "fluent-chinese"
  | "gesture-detail"
  | "restrained-subtext"
  | "safe-nondiagnostic";

export type SignalQualityCheck = {
  key: SignalQualityCheckKey;
  label: string;
  passed: boolean;
  reason: string;
};

export type SignalQualityEvaluation = AiSignalQuality & {
  checks: SignalQualityCheck[];
  passed: boolean;
  reasons: string[];
  text: string;
  triggeredTerms: string[];
};

export type SignalQualityReportItemInput = {
  fixtureName: string;
  seedText?: string;
  text: string;
};

export type SignalQualityReportItem = SignalQualityReportItemInput & {
  evaluation: SignalQualityEvaluation;
};

export type SignalQualityBatchEvaluation = {
  averageScore: number;
  passCount: number;
  results: SignalQualityReportItem[];
  sampleSize: number;
};

type PatternRule = {
  label: string;
  pattern: RegExp;
};

const concreteAnchorPattern =
  /地铁|工位|电话|车站|厨房|水槽|客厅|群聊|办公室|作业|画板|电梯|路口|聊天记录|公交站|医院|药盒|账单|自习室|成绩|寝室|桌|灯|杯|手机|门|钥匙|屏幕|窗|床|邮件|日历|消息|外套|镜子|碗|书|纸|伞|雨|楼道|走廊|键盘|椅|扶手|水龙头|袖口|相册|合照|指尖|清单|笔尖|鼠标|咖啡/u;

const gesturePattern =
  /按|删|合上|停|走|坐|回|发|收|放|拿|转|站|等|翻|写|擦|关|开|点|盯|攥|折|改|存|退出|搭|捏|握|拧|扣|压|抄|命名|整理/u;

const clicheRules: PatternRule[] = [
  { label: "不是X，而是Y", pattern: /不是.+而是/u },
  { label: "不是X，只是Y", pattern: /不是.+只是/u },
  { label: "真正重要的是", pattern: /真正.+是/u },
  { label: "我把这句话留在心里", pattern: /我把这句话留在心里/u },
  { label: "我把这句种子", pattern: /我把这句种子/u },
  { label: "我没有急着把它说出口", pattern: /我没有急着把它说出口/u },
  { label: "真实感受放到前面", pattern: /真实感受放到前面/u },
  { label: "被看见", pattern: /被看见/u },
  { label: "接住", pattern: /接住/u },
  { label: "和解", pattern: /和解/u },
  { label: "答案", pattern: /答案/u },
  { label: "松弛", pattern: /松弛/u },
  { label: "内耗", pattern: /内耗/u },
  { label: "情绪价值", pattern: /情绪价值/u },
  { label: "温柔以待", pattern: /温柔以待/u },
  { label: "允许自己", pattern: /允许自己/u },
  { label: "认真生活", pattern: /认真生活/u },
  { label: "宇宙", pattern: /宇宙/u },
  { label: "灵魂", pattern: /灵魂/u },
  { label: "光", pattern: /(^|[^指])光([^标]|$)/u },
];

const adviceRules: PatternRule[] = [
  { label: "建议口吻", pattern: /你应该|你要|要学会|请相信|给自己一点|慢慢来|别怕|加油/u },
  { label: "人生总结", pattern: /人生|成长|值得更好|一切都会|成为更好的自己/u },
];

const diagnosticRules: PatternRule[] = [
  { label: "诊断", pattern: /诊断|症状|患者|病态/u },
  { label: "心理疾病标签", pattern: /抑郁症|焦虑症|创伤|PTSD|人格障碍/u },
  { label: "治疗口吻", pattern: /心理咨询|治疗|疗愈/u },
];

const unsafeRules: PatternRule[] = [
  { label: "联系方式", pattern: /微信|加我|QQ|电话|手机号|1[3-9]\d{9}/u },
  { label: "广告引流", pattern: /广告|引流|私信|下单|购买/u },
  { label: "自伤风险", pattern: /自杀|轻生|想死|伤害自己/u },
];

const directEmotionPattern =
  /孤独|焦虑|难过|崩溃|疲惫|痛苦|委屈|害怕|迷茫|悲伤|绝望|自卑|空虚/u;

const abstractPattern = /情绪|感受|关系|自我|世界|生活|意义|价值|未来|内心/u;

function countMatches(content: string, pattern: RegExp): number {
  return content.match(new RegExp(pattern.source, "gu"))?.length ?? 0;
}

function findRuleLabels(content: string, rules: PatternRule[]): string[] {
  return rules.filter((rule) => rule.pattern.test(content)).map((rule) => rule.label);
}

function isLengthReasonable(content: string): boolean {
  return content.length >= 30 && content.length <= 160;
}

function hasMostlyChinese(content: string): boolean {
  const chineseCount = content.match(/[\u4e00-\u9fff]/gu)?.length ?? 0;

  return chineseCount >= 20 && chineseCount / Math.max(content.length, 1) >= 0.55;
}

function hasBrokenPunctuation(content: string): boolean {
  return /[。！？!?]{3,}|[,，.。]{4,}|\s{4,}/u.test(content);
}

function buildChecks(content: string, triggeredTerms: string[]): SignalQualityCheck[] {
  const cliches = findRuleLabels(content, clicheRules);
  const advice = findRuleLabels(content, adviceRules);
  const diagnostics = findRuleLabels(content, diagnosticRules);
  const unsafe = findRuleLabels(content, unsafeRules);
  const concreteAnchor = concreteAnchorPattern.test(content);
  const gesture = gesturePattern.test(content);
  const directEmotionCount = countMatches(content, directEmotionPattern);
  const abstractCount = countMatches(content, abstractPattern);
  const firstPerson = /我|自己|心里|手里|身上/u.test(content);
  const fluent = isLengthReasonable(content) && hasMostlyChinese(content) && !hasBrokenPunctuation(content);
  const restrained =
    diagnostics.length === 0 &&
    advice.length === 0 &&
    directEmotionCount <= 2 &&
    (concreteAnchor || abstractCount <= 2);
  const distinctive =
    cliches.length === 0 &&
    advice.length === 0 &&
    (concreteAnchor || gesture) &&
    !(abstractCount >= 4 && !concreteAnchor);
  const safe = diagnostics.length === 0 && unsafe.length === 0;

  triggeredTerms.push(...cliches, ...advice, ...diagnostics, ...unsafe);

  return [
    {
      key: "fluent-chinese",
      label: "中文流畅",
      passed: fluent,
      reason: fluent ? "长度和中文比例正常。" : "长度、中文比例或标点不适合信号文本。",
    },
    {
      key: "first-person",
      label: "第一人称",
      passed: firstPerson,
      reason: firstPerson ? "文本站在我或自身感受里说话。" : "缺少第一人称视角。",
    },
    {
      key: "concrete-anchor",
      label: "具体锚点",
      passed: concreteAnchor,
      reason: concreteAnchor ? "包含场景、物件或空间锚点。" : "缺少可感知的场景或物件。",
    },
    {
      key: "gesture-detail",
      label: "动作细节",
      passed: gesture,
      reason: gesture ? "包含小动作或身体动作。" : "缺少能承载情绪的动作。",
    },
    {
      key: "restrained-subtext",
      label: "情绪克制",
      passed: restrained,
      reason: restrained ? "情绪藏在动作里，没有说教或诊断。" : "表达偏解释、建议或诊断。",
    },
    {
      key: "distinctive-expression",
      label: "表达辨识度",
      passed: distinctive,
      reason:
        cliches.length === 0 && advice.length === 0
          ? "没有明显套话模板。"
          : `命中套话或建议口吻：${[...cliches, ...advice].join("、")}。`,
    },
    {
      key: "safe-nondiagnostic",
      label: "安全非诊断",
      passed: safe,
      reason: safe ? "没有诊断、治疗、引流或自伤风险表述。" : "存在诊断、引流或自伤风险表述。",
    },
  ];
}

function clampScore(score: number): number {
  return Math.min(5, Math.max(1, score));
}

function scoreFromChecks(checks: SignalQualityCheck[], content: string): number {
  const passedCount = checks.filter((check) => check.passed).length;
  const failedKeys = new Set(
    checks.filter((check) => !check.passed).map((check) => check.key),
  );
  const hasCliche = findRuleLabels(content, clicheRules).length > 0;
  const hasAdvice = findRuleLabels(content, adviceRules).length > 0;
  const hasDiagnostic = findRuleLabels(content, diagnosticRules).length > 0;
  const hasUnsafe = findRuleLabels(content, unsafeRules).length > 0;
  const baseScore = passedCount >= 7
    ? 5
    : passedCount >= 5
      ? 4
      : passedCount >= 4
        ? 3
        : passedCount >= 2
          ? 2
          : 1;
  const caps = [
    failedKeys.has("fluent-chinese") ? 2 : 5,
    failedKeys.has("first-person") ? 3 : 5,
    failedKeys.has("concrete-anchor") && failedKeys.has("gesture-detail") ? 2 : 5,
    failedKeys.has("concrete-anchor") || failedKeys.has("gesture-detail") ? 3 : 5,
    hasCliche || hasAdvice ? 2 : 5,
    hasDiagnostic || hasUnsafe ? 1 : 5,
  ];

  return clampScore(Math.min(baseScore, ...caps));
}

function buildReasons(checks: SignalQualityCheck[]): string[] {
  const failedReasons = checks
    .filter((check) => !check.passed)
    .map((check) => `${check.label}：${check.reason}`);

  if (failedReasons.length > 0) {
    return failedReasons.slice(0, 4);
  }

  return [
    "文本有第一人称、具体锚点和动作细节。",
    "情绪表达克制，未命中常见 AI 套话。",
  ];
}

export function evaluateSignalQuality(content: string): SignalQualityEvaluation {
  const text = content.trim();
  const triggeredTerms: string[] = [];
  const checks = buildChecks(text, triggeredTerms);
  const score = scoreFromChecks(checks, text);
  const reasons = buildReasons(checks);

  return {
    checks,
    passed: score >= 3 && checks.find((check) => check.key === "safe-nondiagnostic")?.passed === true,
    reason: reasons.join(" "),
    reasons,
    score,
    text,
    triggeredTerms: Array.from(new Set(triggeredTerms)),
  };
}

export function evaluateSignalQualityBatch(
  items: SignalQualityReportItemInput[],
): SignalQualityBatchEvaluation {
  const results = items.map((item) => {
    return {
      ...item,
      evaluation: evaluateSignalQuality(item.text),
    };
  });
  const totalScore = results.reduce((sum, item) => sum + item.evaluation.score, 0);

  return {
    averageScore:
      results.length === 0 ? 0 : Number((totalScore / results.length).toFixed(2)),
    passCount: results.filter((item) => item.evaluation.passed).length,
    results,
    sampleSize: results.length,
  };
}

export function evaluateDefaultSignalQualityFixtures(): SignalQualityBatchEvaluation {
  return evaluateSignalQualityBatch(
    signalQualityFixtures.map((fixture) => {
      return {
        fixtureName: fixture.name,
        seedText: fixture.seedText,
        text: fixture.sampleText,
      };
    }),
  );
}

function checkbox(passed: boolean): string {
  return passed ? "[x]" : "[ ]";
}

function statusLabel(passed: boolean): string {
  return passed ? "PASS" : "FAIL";
}

export function buildSignalQualityMarkdownReport(
  evaluation: SignalQualityBatchEvaluation,
): string {
  const lines = [
    "# AI Signal Quality Evaluation",
    "",
    `Samples: ${evaluation.sampleSize}`,
    `Passed: ${evaluation.passCount}/${evaluation.sampleSize}`,
    `Average score: ${evaluation.averageScore}/5`,
  ];

  for (const item of evaluation.results) {
    lines.push(
      "",
      `## ${item.fixtureName}`,
      "",
      item.seedText === undefined ? "" : `Seed: ${item.seedText}`,
      `Score: ${item.evaluation.score}/5 ${statusLabel(item.evaluation.passed)}`,
      "",
      "Text:",
      item.text,
      "",
      "Checks:",
      ...item.evaluation.checks.map((check) => {
        return `- ${checkbox(check.passed)} ${check.label}: ${check.reason}`;
      }),
      "",
      "Reasons:",
      ...item.evaluation.reasons.map((reason) => `- ${reason}`),
    );
  }

  return lines.filter((line, index, allLines) => {
    return !(line.length === 0 && allLines[index - 1]?.length === 0);
  }).join("\n");
}
