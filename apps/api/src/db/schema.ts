import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { pgVector } from "./vector.js";

export const roleEnum = pgEnum("role", ["USER", "ADMIN"]);

export const userStatusEnum = pgEnum("user_status", [
  "ACTIVE",
  "MUTED",
  "BANNED",
]);

export const frequencyStatusEnum = pgEnum("frequency_status", [
  "ACTIVE",
  "MUTED",
  "BANNED",
]);

export const channelEnum = pgEnum("channel", [
  "MIDNIGHT",
  "UNSENT",
  "STARMAP",
]);

export const voiceStatusEnum = pgEnum("voice_status", [
  "PUBLISHED",
  "REVIEWING",
  "HIDDEN",
  "DELETED",
]);

export const echoStatusEnum = pgEnum("echo_status", [
  "PUBLISHED",
  "REVIEWING",
  "HIDDEN",
  "DELETED",
]);

export const bottleStatusEnum = pgEnum("bottle_status", [
  "DRIFTING",
  "RECEIVED",
  "REPLIED",
  "KEPT",
  "REVIEWING",
  "HIDDEN",
  "DELETED",
]);

export const reportStatusEnum = pgEnum("report_status", [
  "PENDING",
  "RESOLVED",
  "REJECTED",
]);

export const dailyRadioReportStatusEnum = pgEnum("daily_radio_report_status", [
  "EMPTY",
  "READY",
]);

export const signalStatusEnum = pgEnum("signal_status", [
  "DRAFT",
  "PUBLISHED",
  "REVIEWING",
  "HIDDEN",
  "DELETED",
]);

export const signalGenerationStatusEnum = pgEnum("signal_generation_status", [
  "RECEIVED",
  "EXPANDING",
  "MATCHING",
  "WRITING",
  "COMPLETED",
  "FAILED",
]);

export const signalAudioStatusEnum = pgEnum("signal_audio_status", [
  "FAILED",
  "NOT_REQUESTED",
  "PENDING",
  "READY",
]);
export const signalSourceEnum = pgEnum("signal_source", [
  "ai_generated",
  "human",
  "seed",
]);

export const signalPrimaryBandEnum = pgEnum("signal_primary_band", [
  "self_mirror",
  "emotional_undercurrent",
  "relationship_nebula",
  "time_ring",
  "meaning_deep_space",
  "stagnant_orbit",
  "era_cluster",
]);

export const signalSubFeelingEnum = pgEnum("signal_sub_feeling", [
  "self_doubt",
  "identity_confusion",
  "self_acceptance",
  "fatigue",
  "anxiety",
  "numbness",
  "loneliness",
  "need_to_be_understood",
  "relationship_disappointment",
  "growth_anxiety",
  "nostalgia",
  "future_uncertainty",
  "effort_doubt",
  "goal_loss",
  "existential_questioning",
  "procrastination",
  "starting_difficulty",
  "fear_of_failure",
  "efficiency_anxiety",
  "work_alienation",
  "modern_loneliness",
]);

export const providerConfigKindEnum = pgEnum("provider_config_kind", [
  "chat",
  "embedding",
  "reranker",
  "tts",
]);

export const targetTypeEnum = pgEnum("target_type", [
  "VOICE",
  "ECHO",
  "BOTTLE",
  "BOTTLE_ECHO",
  "USER",
  "SIGNAL",
]);

export const limitTypeEnum = pgEnum("limit_type", [
  "VOICE_CREATE",
  "BOTTLE_CREATE",
  "BOTTLE_OPEN",
  "IMAGE_UPLOAD",
  "SHORTWAVE_CREATE",
]);

export const users = pgTable(
  "users",
  {
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    email: text("email"),
    emotionProfile: jsonb("emotion_profile").$type<Record<string, unknown>>(),
    frequencyName: varchar("frequency_name", { length: 32 }),
    freqCode: varchar("freq_code", { length: 8 }).notNull(),
    id: uuid("id").defaultRandom().primaryKey(),
    isGuest: boolean("is_guest").default(true).notNull(),
    passwordHash: text("password_hash"),
    role: roleEnum("role").default("USER").notNull(),
    status: userStatusEnum("status").default("ACTIVE").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    uniqueIndex("users_frequency_name_unique").on(table.frequencyName),
    uniqueIndex("users_freq_code_unique").on(table.freqCode),
    index("users_status_idx").on(table.status),
  ],
);

export const frequencies = pgTable(
  "frequencies",
  {
    code: text("code").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    deviceHash: text("device_hash"),
    frequencyName: varchar("frequency_name", { length: 32 }),
    id: uuid("id").defaultRandom().primaryKey(),
    isGuest: boolean("is_guest").default(true).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    passwordHash: text("password_hash"),
    role: roleEnum("role").default("USER").notNull(),
    status: frequencyStatusEnum("status").default("ACTIVE").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("frequencies_code_unique").on(table.code),
    uniqueIndex("frequencies_frequency_name_unique").on(table.frequencyName),
    index("frequencies_device_hash_idx").on(table.deviceHash),
    index("frequencies_status_idx").on(table.status),
  ],
);

export const voices = pgTable(
  "voices",
  {
    allowEcho: boolean("allow_echo").default(true).notNull(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    channel: channelEnum("channel").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    echoCount: integer("echo_count").default(0).notNull(),
    aiAnalysis: jsonb("ai_analysis").$type<Record<string, unknown>>(),
    id: uuid("id").defaultRandom().primaryKey(),
    moodTags: text("mood_tags").array().notNull(),
    resonanceCount: integer("resonance_count").default(0).notNull(),
    status: voiceStatusEnum("status").default("PUBLISHED").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("voices_author_created_at_idx").on(table.authorId, table.createdAt),
    index("voices_channel_status_created_at_idx").on(
      table.channel,
      table.status,
      table.createdAt,
    ),
  ],
);

export const resonances = pgTable(
  "resonances",
  {
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    voiceId: uuid("voice_id")
      .notNull()
      .references(() => voices.id),
  },
  (table) => [
    uniqueIndex("resonances_user_voice_unique").on(table.userId, table.voiceId),
    index("resonances_voice_created_at_idx").on(table.voiceId, table.createdAt),
  ],
);

export const echoes = pgTable(
  "echoes",
  {
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    id: uuid("id").defaultRandom().primaryKey(),
    status: echoStatusEnum("status").default("PUBLISHED").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    voiceId: uuid("voice_id")
      .notNull()
      .references(() => voices.id),
  },
  (table) => [
    index("echoes_author_created_at_idx").on(table.authorId, table.createdAt),
    index("echoes_voice_status_created_at_idx").on(
      table.voiceId,
      table.status,
      table.createdAt,
    ),
  ],
);

export const dailyLimits = pgTable(
  "daily_limits",
  {
    count: integer("count").default(0).notNull(),
    id: uuid("id").defaultRandom().primaryKey(),
    limitDate: date("limit_date").notNull(),
    limitType: limitTypeEnum("limit_type").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
  },
  (table) => [
    uniqueIndex("daily_limits_user_type_date_unique").on(
      table.userId,
      table.limitType,
      table.limitDate,
    ),
  ],
);

export const bottles = pgTable(
  "bottles",
  {
    allowEcho: boolean("allow_echo").default(true).notNull(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    aiAnalysis: jsonb("ai_analysis").$type<Record<string, unknown>>(),
    id: uuid("id").defaultRandom().primaryKey(),
    keptAt: timestamp("kept_at", { withTimezone: true }),
    keptById: uuid("kept_by_id").references(() => users.id),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    openedById: uuid("opened_by_id").references(() => users.id),
    replyCount: integer("reply_count").default(0).notNull(),
    status: bottleStatusEnum("status").default("DRIFTING").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("bottles_author_created_at_idx").on(table.authorId, table.createdAt),
    index("bottles_opened_by_created_at_idx").on(table.openedById, table.createdAt),
    index("bottles_status_created_at_idx").on(table.status, table.createdAt),
  ],
);

export const bottleEchoes = pgTable(
  "bottle_echoes",
  {
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    bottleId: uuid("bottle_id")
      .notNull()
      .references(() => bottles.id),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    id: uuid("id").defaultRandom().primaryKey(),
    status: echoStatusEnum("status").default("PUBLISHED").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("bottle_echoes_author_created_at_idx").on(table.authorId, table.createdAt),
    index("bottle_echoes_bottle_status_created_at_idx").on(
      table.bottleId,
      table.status,
      table.createdAt,
    ),
  ],
);

export const reports = pgTable(
  "reports",
  {
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    id: uuid("id").defaultRandom().primaryKey(),
    note: text("note"),
    reason: text("reason").notNull(),
    reporterId: uuid("reporter_id")
      .notNull()
      .references(() => users.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedById: uuid("resolved_by_id").references(() => users.id),
    resolution: text("resolution"),
    status: reportStatusEnum("status").default("PENDING").notNull(),
    targetId: uuid("target_id").notNull(),
    targetType: targetTypeEnum("target_type").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("reports_reporter_created_at_idx").on(table.reporterId, table.createdAt),
    index("reports_status_created_at_idx").on(table.status, table.createdAt),
    index("reports_target_type_target_id_idx").on(table.targetType, table.targetId),
  ],
);

export const dailyRadioReports = pgTable(
  "daily_radio_reports",
  {
    channelHighlights: jsonb("channel_highlights")
      .$type<Array<{ channel: "MIDNIGHT" | "STARMAP" | "UNSENT"; count: number; summary: string }>>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
    id: uuid("id").defaultRandom().primaryKey(),
    radioLine: text("radio_line").notNull(),
    reportDate: date("report_date").notNull(),
    sourceCounts: jsonb("source_counts")
      .$type<{ bottles: number; total: number; voices: number }>()
      .notNull(),
    status: dailyRadioReportStatusEnum("status").default("READY").notNull(),
    summary: text("summary").notNull(),
    topEmotions: text("top_emotions").array().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("daily_radio_reports_report_date_unique").on(table.reportDate),
    index("daily_radio_reports_status_generated_at_idx").on(table.status, table.generatedAt),
  ],
);

export const signals = pgTable(
  "signals",
  {
    authorId: uuid("author_id").references(() => users.id),
    audioError: text("audio_error"),
    audioStatus: signalAudioStatusEnum("audio_status").default("NOT_REQUESTED").notNull(),
    audioStorageKey: text("audio_storage_key"),
    audioStorageKeyLeft: text("audio_storage_key_left"),
    audioStorageKeyRight: text("audio_storage_key_right"),
    audioUrl: text("audio_url"),
    audioUrlLeft: text("audio_url_left"),
    audioUrlRight: text("audio_url_right"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    echoCount: integer("echo_count").default(0).notNull(),
    embedding: pgVector("embedding"),
    embeddingDimensions: integer("embedding_dimensions"),
    embeddingModel: text("embedding_model"),
    embeddingProvider: text("embedding_provider"),
    embeddingVersion: text("embedding_version"),
    expandedText: text("expanded_text").notNull(),
    fingerprintJson: jsonb("fingerprint_json").$type<Record<string, unknown>>().notNull(),
    followUpQuestion: text("follow_up_question"),
    frequencyId: uuid("frequency_id").references(() => frequencies.id),
    galaxyPosition: jsonb("galaxy_position").$type<{ x: number; y: number; z: number }>(),
    generationError: text("generation_error"),
    generationStatus: signalGenerationStatusEnum("generation_status")
      .default("COMPLETED")
      .notNull(),
    guestKey: text("guest_key"),
    id: uuid("id").defaultRandom().primaryKey(),
    coreNeed: text("core_need"),
    emotionTone: text("emotion_tone"),
    innerConflict: text("inner_conflict"),
    matchSignalId: uuid("match_signal_id"),
    parentSignalId: uuid("parent_signal_id").references((): AnyPgColumn => signals.id),
    primaryBand: signalPrimaryBandEnum("primary_band"),
    programJson: jsonb("program_json").$type<Record<string, unknown>>().notNull(),
    qualityReason: text("quality_reason"),
    qualityScore: integer("quality_score"),
    rawInput: text("raw_input").notNull(),
    resonanceCount: integer("resonance_count").default(0).notNull(),
    resonanceKeywords: jsonb("resonance_keywords").$type<string[]>(),
    seedText: text("seed_text").notNull(),
    source: signalSourceEnum("source").default("human").notNull(),
    status: signalStatusEnum("status").default("DRAFT").notNull(),
    subFeeling: signalSubFeelingEnum("sub_feeling"),
    isKept: boolean("is_kept").default(false).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("signals_author_created_at_idx").on(table.authorId, table.createdAt),
    index("signals_frequency_created_at_idx").on(table.frequencyId, table.createdAt),
    index("signals_generation_status_created_at_idx").on(
      table.generationStatus,
      table.createdAt,
    ),
    index("signals_match_signal_id_idx").on(table.matchSignalId),
    index("signals_parent_signal_id_idx").on(table.parentSignalId),
    index("signals_primary_band_status_created_at_idx").on(
      table.primaryBand,
      table.status,
      table.createdAt,
    ),
    index("signals_source_created_at_idx").on(table.source, table.createdAt),
    index("signals_status_created_at_idx").on(table.status, table.createdAt),
  ],
);

export const monthlyRecaps = pgTable(
  "monthly_recaps",
  {
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    frequencyId: uuid("frequency_id")
      .notNull()
      .references(() => frequencies.id),
    generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
    id: uuid("id").defaultRandom().primaryKey(),
    signalCount: integer("signal_count").notNull(),
    summary: text("summary").notNull(),
    themeWords: text("theme_words").array().notNull(),
    topSignalId: uuid("top_signal_id").references(() => signals.id),
    totalResonanceCount: integer("total_resonance_count").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    yearMonth: varchar("year_month", { length: 7 }).notNull(),
  },
  (table) => [
    uniqueIndex("monthly_recaps_frequency_month_unique").on(
      table.frequencyId,
      table.yearMonth,
    ),
    index("monthly_recaps_frequency_generated_at_idx").on(
      table.frequencyId,
      table.generatedAt,
    ),
  ],
);

export const themeRadioDays = pgTable(
  "theme_radio_days",
  {
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    description: text("description"),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    id: uuid("id").defaultRandom().primaryKey(),
    isActive: boolean("is_active").default(true).notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).defaultNow().notNull(),
    theme: varchar("theme", { length: 48 }).notNull(),
    title: varchar("title", { length: 80 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("theme_radio_days_active_starts_at_idx").on(table.isActive, table.startsAt),
    index("theme_radio_days_theme_idx").on(table.theme),
  ],
);

export const providerConfigs = pgTable(
  "provider_configs",
  {
    apiKeyCiphertext: text("api_key_ciphertext"),
    apiKeyLast4: varchar("api_key_last4", { length: 4 }),
    baseUrl: text("base_url").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    extraJson: jsonb("extra_json").$type<Record<string, unknown>>(),
    id: uuid("id").defaultRandom().primaryKey(),
    isEnabled: boolean("is_enabled").default(true).notNull(),
    kind: providerConfigKindEnum("kind").notNull(),
    model: text("model").notNull(),
    priority: integer("priority").default(100).notNull(),
    provider: text("provider").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id),
  },
  (table) => [
    index("provider_configs_kind_priority_idx").on(table.kind, table.priority),
    index("provider_configs_updated_by_idx").on(table.updatedBy),
  ],
);

export const signalSaves = pgTable(
  "signal_saves",
  {
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    frequencyId: uuid("frequency_id")
      .notNull()
      .references(() => frequencies.id),
    id: uuid("id").defaultRandom().primaryKey(),
    signalId: uuid("signal_id")
      .notNull()
      .references(() => signals.id),
  },
  (table) => [
    uniqueIndex("signal_saves_frequency_signal_unique").on(
      table.frequencyId,
      table.signalId,
    ),
    index("signal_saves_frequency_created_at_idx").on(table.frequencyId, table.createdAt),
    index("signal_saves_signal_created_at_idx").on(table.signalId, table.createdAt),
  ],
);

export const signalEchoes = pgTable(
  "signal_echoes",
  {
    authorId: uuid("author_id").references(() => users.id),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    guestKey: text("guest_key"),
    id: uuid("id").defaultRandom().primaryKey(),
    signalId: uuid("signal_id")
      .notNull()
      .references(() => signals.id),
    status: echoStatusEnum("status").default("PUBLISHED").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("signal_echoes_author_created_at_idx").on(table.authorId, table.createdAt),
    index("signal_echoes_signal_status_created_at_idx").on(
      table.signalId,
      table.status,
      table.createdAt,
    ),
  ],
);

export const signalResonances = pgTable(
  "signal_resonances",
  {
    actorKey: text("actor_key").notNull(),
    authorId: uuid("author_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    frequencyId: uuid("frequency_id").references(() => frequencies.id),
    guestKey: text("guest_key"),
    id: uuid("id").defaultRandom().primaryKey(),
    signalId: uuid("signal_id")
      .notNull()
      .references(() => signals.id),
  },
  (table) => [
    index("signal_resonances_author_created_at_idx").on(table.authorId, table.createdAt),
    index("signal_resonances_frequency_created_at_idx").on(
      table.frequencyId,
      table.createdAt,
    ),
    index("signal_resonances_signal_created_at_idx").on(table.signalId, table.createdAt),
    uniqueIndex("signal_resonances_signal_actor_unique").on(table.signalId, table.actorKey),
  ],
);

export const images = pgTable(
  "images",
  {
    altText: text("alt_text"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    id: uuid("id").defaultRandom().primaryKey(),
    mimeType: varchar("mime_type", { length: 32 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    uploaderId: uuid("uploader_id")
      .notNull()
      .references(() => users.id),
  },
  (table) => [
    uniqueIndex("images_storage_key_unique").on(table.storageKey),
    index("images_uploader_created_at_idx").on(table.uploaderId, table.createdAt),
  ],
);

export const adminActions = pgTable(
  "admin_actions",
  {
    action: text("action").notNull(),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    details: jsonb("details"),
    id: uuid("id").defaultRandom().primaryKey(),
    targetId: uuid("target_id").notNull(),
    targetType: targetTypeEnum("target_type").notNull(),
  },
  (table) => [
    index("admin_actions_admin_created_at_idx").on(table.adminId, table.createdAt),
    index("admin_actions_target_type_target_id_idx").on(table.targetType, table.targetId),
  ],
);

export const aiReviews = pgTable(
  "ai_reviews",
  {
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    id: uuid("id").defaultRandom().primaryKey(),
    inputText: text("input_text").notNull(),
    model: text("model").notNull(),
    outputJson: jsonb("output_json").notNull(),
    provider: text("provider").notNull(),
    reviewType: text("review_type").notNull(),
    status: text("status").notNull(),
    targetId: uuid("target_id"),
    targetType: targetTypeEnum("target_type"),
  },
  (table) => [
    index("ai_reviews_review_type_created_at_idx").on(table.reviewType, table.createdAt),
    index("ai_reviews_target_type_target_id_idx").on(table.targetType, table.targetId),
  ],
);
