import { db } from '../db/index.js';
import { challenges } from '../db/schema.js';
import { eq, and, sql, asc } from 'drizzle-orm';
import { getTodayET } from '../lib/date.js';

/**
 * Promote the next challenge in the queue.
 * 1. Complete any active challenge from a previous day.
 * 2. If today already has an active challenge, skip.
 * 3. Otherwise, activate the next "scheduled" challenge (FIFO by id).
 */
export async function promoteNextChallenge(): Promise<{
  activated: number | null;
  completed: number;
}> {
  const todayStr = getTodayET();

  // Complete any active challenges that are NOT from today
  const pastActive = await db.update(challenges)
    .set({ status: 'completed' })
    .where(and(
      eq(challenges.status, 'active'),
      sql`${challenges.challengeDate} != ${todayStr}`
    ))
    .returning();
  const completedCount = pastActive.length;

  // Check if there's already an active challenge for today
  const [todayActive] = await db.select()
    .from(challenges)
    .where(eq(challenges.status, 'active'))
    .limit(1);

  if (todayActive) {
    return { activated: todayActive.id, completed: completedCount };
  }

  // Find the next scheduled (queued) challenge — by queue position, then id
  const [nextChallenge] = await db.select()
    .from(challenges)
    .where(eq(challenges.status, 'scheduled'))
    .orderBy(sql`${challenges.queuePosition} ASC NULLS LAST`, asc(challenges.id))
    .limit(1);

  if (!nextChallenge) {
    return { activated: null, completed: completedCount };
  }

  // Activate it with today's date.
  // The target may already own a future date (e.g. "2026-04-14"), and another
  // challenge may already hold today's date. Swap dates to avoid unique-constraint
  // violations: give the old date-holder the target's original date (or a
  // placeholder), then assign today's date to the target.
  const oldDate = nextChallenge.challengeDate;

  // Clear the target's date first (temp placeholder) to free the slot for the swap
  const tempDate = `promoting-${nextChallenge.id}`;
  await db.update(challenges)
    .set({ challengeDate: tempDate })
    .where(eq(challenges.id, nextChallenge.id));

  // If another challenge holds today's date, give it the target's old date
  await db.update(challenges)
    .set({ challengeDate: oldDate })
    .where(sql`${challenges.challengeDate} = ${todayStr} AND ${challenges.id} != ${nextChallenge.id}`);

  // Now assign today's date to the target
  await db.update(challenges)
    .set({
      status: 'active',
      challengeDate: todayStr,
      queuePosition: null,
    })
    .where(eq(challenges.id, nextChallenge.id));

  return { activated: nextChallenge.id, completed: completedCount };
}

// Keep backward compatibility — old name delegates to new logic
export const activateTodaysChallenge = promoteNextChallenge;

/**
 * Get the currently active challenge (regardless of date).
 */
export async function getTodaysActiveChallenge() {
  const [active] = await db.select()
    .from(challenges)
    .where(eq(challenges.status, 'active'))
    .limit(1);

  return active || null;
}

/**
 * Midnight scheduler: checks every 30 seconds if the date has changed,
 * and automatically promotes the next queued challenge.
 */
let lastPromotionDate = '';

export function startMidnightScheduler(): void {
  // Run immediately to set the baseline date
  lastPromotionDate = getTodayET();

  const interval = setInterval(async () => {
    const today = getTodayET();
    if (today !== lastPromotionDate) {
      lastPromotionDate = today;
      try {
        const result = await promoteNextChallenge();
        if (result.activated) {
          console.log(`[Midnight Scheduler] Activated challenge #${result.activated} for ${today}`);
        }
        if (result.completed) {
          console.log(`[Midnight Scheduler] Completed ${result.completed} past challenge(s)`);
        }
        if (!result.activated) {
          console.log(`[Midnight Scheduler] No queued challenges to activate for ${today}`);
        }
      } catch (err) {
        console.error('[Midnight Scheduler] Error:', err);
        lastPromotionDate = ''; // Reset so it retries on next tick
      }
    }
  }, 30_000); // Check every 30 seconds

  // Prevent the timer from keeping the process alive if everything else shuts down
  interval.unref?.();

  console.log('[Midnight Scheduler] Started — will auto-promote at midnight ET');
}
