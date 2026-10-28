export type AiMonthlyRecap = {
  summary: string;
  themeWords: string[];
};

export type AiSignalRiskLevel = "HIGH" | "LOW" | "MEDIUM";

export type AiSignalFingerprint = {
  coreNeed: string;
  displayText: string;
  energy: number;
  emotionTone: string;
  frequency: string;
  hiddenNeed: string;
  innerConflict: string;
  narrativeConflict: string;
  openness: number;
  primaryEmotion: string;
  primaryBand:
    | "emotional_undercurrent"
    | "era_cluster"
    | "meaning_deep_space"
    | "relationship_nebula"
    | "self_mirror"
    | "stagnant_orbit"
    | "time_ring";
  resonanceKeywords: string[];
  riskLevel: AiSignalRiskLevel;
  secondaryEmotions: string[];
  signalType: string;
  subFeeling:
    | "anxiety"
    | "efficiency_anxiety"
    | "effort_doubt"
    | "existential_questioning"
    | "fatigue"
    | "fear_of_failure"
    | "future_uncertainty"
    | "goal_loss"
    | "growth_anxiety"
    | "identity_confusion"
    | "loneliness"
    | "modern_loneliness"
    | "need_to_be_understood"
    | "nostalgia"
    | "numbness"
    | "procrastination"
    | "relationship_disappointment"
    | "self_acceptance"
    | "self_doubt"
    | "starting_difficulty"
    | "work_alienation";
  tags: string[];
  theme: string;
  title: string;
};

export type AiSignalMatchSource = "FALLBACK" | "PUBLISHED" | "SEEDED";

export type AiSignalProgramMatch = {
  id: string;
  primaryEmotion: string;
  signalType: string;
  source: AiSignalMatchSource;
  summary: string;
  tags: string[];
  title: string;
};

export type AiSignalProgramInput = {
  fingerprint: AiSignalFingerprint;
  match?: AiSignalProgramMatch;
  rawInput: string;
};

export type AiSignalProgram = {
  bridgeNarration: string;
  closingQuestion: string;
  hostIntro: string;
  leftSignalSummary: string;
  programTitle: string;
  rightSignalSummary?: string;
  shareQuote: string;
};

export type AiSignalExpansionInput = {
  classification: AiSignalSeedClassification;
  rewriteInstruction?: string;
  seedText: string;
};

export type AiSignalExpansion = {
  expandedText: string;
  followUpQuestion: string;
};

export type AiSignalMaterial = {
  classification: AiSignalSeedClassification;
  expansion: AiSignalExpansion;
  fingerprint: AiSignalFingerprint;
};

export type AiSignalSeedType =
  | "absurd"
  | "daily_wish"
  | "emotion"
  | "food"
  | "memory"
  | "observation"
  | "poetry"
  | "question"
  | "sports"
  | "unknown";

export type AiSignalInputKind =
  | "absurd"
  | "classic_poem"
  | "fragment"
  | "joke"
  | "original_thought"
  | "question"
  | "quote"
  | "unknown"
  | "wish";

export type AiSignalUserAct =
  | "ask_question"
  | "invite"
  | "joke"
  | "make_wish"
  | "quote_for_aftertaste"
  | "record_fragment"
  | "state_feeling"
  | "state_opinion";

export type AiSignalExpansionMode =
  | "aftertaste"
  | "ask_detail"
  | "clarify_thought"
  | "continue_image"
  | "joke_extension"
  | "light_scene";

export type AiSignalInventionLevel = "low" | "medium" | "none";

export type AiSignalSeedClassification = {
  allowedInventions: string[];
  confidence: number;
  energy: "high" | "low" | "medium";
  expansionMode: AiSignalExpansionMode;
  forbiddenInventions: string[];
  inputKind: AiSignalInputKind;
  intendedFocus: string;
  inventionLevel: AiSignalInventionLevel;
  keywords: string[];
  mood: string;
  mustAvoid: string[];
  preserve: string[];
  sceneHint: string;
  shouldBeNegative: boolean;
  type: AiSignalSeedType;
  userAct: AiSignalUserAct;
};

export type AiSignalExpansionReviewInput = {
  classification: AiSignalSeedClassification;
  expandedText: string;
  seedText: string;
};

export type AiSignalExpansionReview = {
  hasConcreteObjects: boolean;
  hasSensoryDetails: boolean;
  isForcedNegative: boolean;
  isGenericLiteraryTemplate: boolean;
  matchesSeedType: boolean;
  pass: boolean;
  preservesOriginalDirection: boolean;
  problems: string[];
  rewriteInstruction: string;
  score: number;
};

export type AiSignalContentInput = {
  age: number;
  commonScenes: string[];
  currentConcern: string;
  fmName: string;
  occupation: string;
  style: string;
};

export type AiSignalContent = {
  rawInput: string;
};

export type AiSignalQualityInput = {
  content: string;
};

export type AiSignalQuality = {
  reason: string;
  score: number;
};
