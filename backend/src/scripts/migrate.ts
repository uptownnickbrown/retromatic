/**
 * Safe, non-interactive database migration.
 * Runs on every deploy before the server starts.
 * Each migration is idempotent (uses IF NOT EXISTS / IF EXISTS).
 */
import postgres from 'postgres';

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    const relevant = Object.keys(process.env).filter(k => k.includes('DATABASE') || k.includes('PG') || k.includes('RAILWAY'));
    console.error('[migrate] FATAL: DATABASE_URL is not set. Related env vars:', relevant.join(', ') || '(none)');
    process.exitCode = 1;
    throw new Error('DATABASE_URL is required');
  }
  return url;
}

async function migrate() {
  const sql = postgres(getDatabaseUrl());

  try {
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

    // Queue any remaining 'draft' challenges (eliminate draft status)
    const drafts = await sql`
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn
        FROM challenges
        WHERE status = 'draft'
      )
      UPDATE challenges c
      SET status = 'scheduled',
          queue_position = COALESCE(
            (SELECT MAX(queue_position) FROM challenges WHERE status = 'scheduled'), 0
          ) + ranked.rn,
          published_at = NOW()
      FROM ranked
      WHERE c.id = ranked.id
      RETURNING c.id
    `;
    if (drafts.length > 0) {
      console.log(`[migrate] ✓ Queued ${drafts.length} draft challenges`);
    }

    // Update portrait URLs from .png to .webp (portrait optimization)
    const portraits = await sql`
      UPDATE round_options
      SET portrait_url = REGEXP_REPLACE(portrait_url, '\.png', '.webp')
      WHERE portrait_url LIKE '%.png%'
    `;
    if (portraits.count > 0) {
      console.log(`[migrate] ✓ Updated ${portraits.count} portrait URLs (.png → .webp)`);
    } else {
      console.log('[migrate] ✓ portrait URLs already webp (no changes)');
    }

    // Create portraits table for validation tracking
    await sql`
      CREATE TABLE IF NOT EXISTS portraits (
        player_id VARCHAR(20) PRIMARY KEY,
        validated BOOLEAN NOT NULL DEFAULT FALSE,
        validated_at TIMESTAMP,
        portrait_url VARCHAR(500)
      )
    `;
    console.log('[migrate] ✓ portraits table');

    console.log('[migrate] Done.');
  } catch (err) {
    console.error('[migrate] FAILED:', (err as Error).message || err);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

migrate();
