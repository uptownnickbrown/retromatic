/**
 * Safe, non-interactive database migration.
 * Runs on every deploy before the server starts.
 * Each migration is idempotent (uses IF NOT EXISTS / IF EXISTS).
 */
import postgres from 'postgres';
import dotenv from 'dotenv';

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://retromatic:retromatic_dev@localhost:5432/retromatic';

async function migrate() {
  const sql = postgres(DATABASE_URL);

  console.log('[migrate] Running migrations...');

  // Add queue_position column to challenges (PR #6)
  await sql`
    ALTER TABLE challenges
    ADD COLUMN IF NOT EXISTS queue_position INTEGER
  `;
  console.log('[migrate] ✓ queue_position column');

  // Add unique constraint on game_sessions (guest_token, challenge_id)
  // Use a DO block to check if it already exists
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'unique_guest_challenge'
      ) THEN
        ALTER TABLE game_sessions
        ADD CONSTRAINT unique_guest_challenge UNIQUE (guest_token, challenge_id);
      END IF;
    END $$
  `;
  console.log('[migrate] ✓ unique_guest_challenge constraint');

  console.log('[migrate] Done.');
  await sql.end();
}

migrate().catch((err) => {
  console.error('[migrate] FAILED:', err.message || err);
  // Don't exit with error — let the server start even if migration fails
  // so we can debug via logs rather than being stuck in a restart loop
});
