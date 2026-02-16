import { pgTable, serial, varchar, integer, decimal, text, timestamp, boolean, jsonb, uuid, index, unique } from 'drizzle-orm/pg-core';

// Players table - read-only after data pipeline
export const players = pgTable('players', {
  id: serial('id').primaryKey(),
  playerId: varchar('player_id', { length: 20 }).notNull(),
  nameFirst: varchar('name_first', { length: 100 }),
  nameLast: varchar('name_last', { length: 100 }),
  year: integer('year').notNull(),
  team: varchar('team', { length: 10 }),
  playerType: varchar('player_type', { length: 10 }).notNull(), // 'batter' or 'pitcher'
  primaryPosition: varchar('primary_position', { length: 10 }).notNull(),
  positionsEligible: varchar('positions_eligible', { length: 50 }).notNull(),
  stats: jsonb('stats').notNull(),
  zScoreOverall: decimal('z_score_overall', { precision: 8, scale: 4 }).notNull(),
  zScorePosition: decimal('z_score_position', { precision: 8, scale: 4 }).notNull(),
  categoryZscores: jsonb('category_zscores').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  unique('unique_player_year').on(table.playerId, table.year),
  index('idx_players_name').on(table.nameLast, table.nameFirst),
  index('idx_players_year').on(table.year),
  index('idx_players_position').on(table.primaryPosition),
  index('idx_players_zscore_pos').on(table.zScorePosition),
]);

// Daily challenges
export const challenges = pgTable('challenges', {
  id: serial('id').primaryKey(),
  challengeDate: varchar('challenge_date', { length: 10 }).notNull().unique(), // YYYY-MM-DD
  positionOrder: jsonb('position_order').notNull(), // string[] of 10 positions
  status: varchar('status', { length: 20 }).notNull().default('draft'), // draft | scheduled | active | completed
  theme: varchar('theme', { length: 200 }), // e.g. "Oops, All Phillies!" or null
  createdAt: timestamp('created_at').defaultNow(),
  publishedAt: timestamp('published_at'),
});

// Each round in a challenge (10 per challenge)
export const challengeRounds = pgTable('challenge_rounds', {
  id: serial('id').primaryKey(),
  challengeId: integer('challenge_id').notNull().references(() => challenges.id, { onDelete: 'cascade' }),
  roundNumber: integer('round_number').notNull(), // 1-10
  position: varchar('position', { length: 10 }).notNull(), // C, 1B, 2B, SS, 3B, OF, UTIL, SP, RP, P
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  unique('unique_challenge_round').on(table.challengeId, table.roundNumber),
  index('idx_rounds_challenge').on(table.challengeId),
]);

// Player options within a round (3 per round, each with 3 year choices)
export const roundOptions = pgTable('round_options', {
  id: serial('id').primaryKey(),
  roundId: integer('round_id').notNull().references(() => challengeRounds.id, { onDelete: 'cascade' }),
  playerSlot: integer('player_slot').notNull(), // 1, 2, or 3
  playerId: varchar('player_id', { length: 20 }).notNull(), // Lahman player_id (not FK to players.id since multiple years)
  playerName: varchar('player_name', { length: 200 }).notNull(), // Display name
  yearOptions: jsonb('year_options').notNull(), // number[] - exactly 3 years
  portraitUrl: varchar('portrait_url', { length: 500 }),
  blurbs: jsonb('blurbs'), // Record<year, string> - AI blurb per year option
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  unique('unique_round_player_slot').on(table.roundId, table.playerSlot),
  index('idx_options_round').on(table.roundId),
]);

// Game sessions (one per user per challenge)
export const gameSessions = pgTable('game_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  challengeId: integer('challenge_id').notNull().references(() => challenges.id),
  guestToken: varchar('guest_token', { length: 255 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('in_progress'), // in_progress | completed
  currentRound: integer('current_round').notNull().default(1),
  totalLegendScore: decimal('total_legend_score', { precision: 6, scale: 1 }),
  percentile: integer('percentile'),
  createdAt: timestamp('created_at').defaultNow(),
  completedAt: timestamp('completed_at'),
}, (table) => [
  unique('unique_guest_challenge').on(table.guestToken, table.challengeId),
  index('idx_sessions_challenge').on(table.challengeId),
  index('idx_sessions_guest').on(table.guestToken),
]);

// Individual picks within a game session
export const userPicks = pgTable('user_picks', {
  id: serial('id').primaryKey(),
  sessionId: uuid('session_id').notNull().references(() => gameSessions.id, { onDelete: 'cascade' }),
  roundId: integer('round_id').notNull().references(() => challengeRounds.id),
  selectedPlayerId: integer('selected_player_id').notNull().references(() => players.id),
  selectedYear: integer('selected_year').notNull(),
  legendScore: decimal('legend_score', { precision: 4, scale: 1 }).notNull(),
  wasTimeout: boolean('was_timeout').default(false),
  pickedAt: timestamp('picked_at').defaultNow(),
}, (table) => [
  unique('unique_session_round').on(table.sessionId, table.roundId),
  index('idx_picks_session').on(table.sessionId),
]);

// Aggregated pick statistics for "X% picked this"
export const pickStats = pgTable('pick_stats', {
  id: serial('id').primaryKey(),
  roundId: integer('round_id').notNull().references(() => challengeRounds.id),
  playerId: integer('player_id').notNull().references(() => players.id),
  selectedYear: integer('selected_year').notNull(),
  pickCount: integer('pick_count').notNull().default(0),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  unique('unique_round_option_stat').on(table.roundId, table.playerId, table.selectedYear),
  index('idx_stats_round').on(table.roundId),
]);

// Type exports
export type Player = typeof players.$inferSelect;
export type NewPlayer = typeof players.$inferInsert;
export type Challenge = typeof challenges.$inferSelect;
export type NewChallenge = typeof challenges.$inferInsert;
export type ChallengeRound = typeof challengeRounds.$inferSelect;
export type RoundOption = typeof roundOptions.$inferSelect;
export type GameSession = typeof gameSessions.$inferSelect;
export type UserPick = typeof userPicks.$inferSelect;
export type PickStat = typeof pickStats.$inferSelect;
