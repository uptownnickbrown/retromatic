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
]);

// Users table - for future auth
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }),
  displayName: varchar('display_name', { length: 100 }),
  authProvider: varchar('auth_provider', { length: 50 }),
  guestToken: varchar('guest_token', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Drafts table
export const drafts = pgTable('drafts', {
  id: serial('id').primaryKey(),
  guestToken: varchar('guest_token', { length: 255 }),
  status: varchar('status', { length: 20 }).notNull().default('in_progress'),
  totalScore: decimal('total_score', { precision: 10, scale: 4 }),
  percentile: integer('percentile'),
  categoryScores: jsonb('category_scores'),
  aiCommentary: text('ai_commentary'),
  rotoPlacement: integer('roto_placement'),
  winLossRecord: varchar('win_loss_record', { length: 50 }),
  outlierFacts: jsonb('outlier_facts'),
  createdAt: timestamp('created_at').defaultNow(),
  completedAt: timestamp('completed_at'),
}, (table) => [
  index('idx_drafts_guest').on(table.guestToken),
  index('idx_drafts_status').on(table.status),
]);

// Picks table
export const picks = pgTable('picks', {
  id: serial('id').primaryKey(),
  draftId: integer('draft_id').notNull().references(() => drafts.id, { onDelete: 'cascade' }),
  playerId: integer('player_id').notNull().references(() => players.id),
  rosterSlot: varchar('roster_slot', { length: 10 }).notNull(),
  pickOrder: integer('pick_order').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  unique('unique_draft_slot').on(table.draftId, table.rosterSlot),
  unique('unique_draft_player').on(table.draftId, table.playerId),
  index('idx_picks_draft').on(table.draftId),
]);

// Team pool - pre-generated + real user teams
export const teamPool = pgTable('team_pool', {
  id: serial('id').primaryKey(),
  draftId: integer('draft_id').references(() => drafts.id),
  isSimulated: boolean('is_simulated').default(false),
  categoryTotals: jsonb('category_totals').notNull(),
  totalScore: decimal('total_score', { precision: 10, scale: 4 }).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('idx_team_pool_score').on(table.totalScore),
]);

// Types for TypeScript
export type Player = typeof players.$inferSelect;
export type NewPlayer = typeof players.$inferInsert;
export type Draft = typeof drafts.$inferSelect;
export type NewDraft = typeof drafts.$inferInsert;
export type Pick = typeof picks.$inferSelect;
export type NewPick = typeof picks.$inferInsert;
export type TeamPoolEntry = typeof teamPool.$inferSelect;
export type NewTeamPoolEntry = typeof teamPool.$inferInsert;
