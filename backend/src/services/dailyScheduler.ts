import { db } from '../db/index.js';
import { challenges } from '../db/schema.js';
import { eq, and, lt } from 'drizzle-orm';
import { getTodayET } from '../lib/date.js';

function today(): string {
  return getTodayET();
}

// Activate today's scheduled challenge, complete yesterday's
export async function activateTodaysChallenge(): Promise<{
  activated: number | null;
  completed: number;
}> {
  const todayStr = today();
  let activated: number | null = null;
  let completed = 0;

  // Complete any past active challenges
  const pastActive = await db.update(challenges)
    .set({ status: 'completed' })
    .where(and(
      eq(challenges.status, 'active'),
      lt(challenges.challengeDate, todayStr)
    ))
    .returning();
  completed = pastActive.length;

  // Activate today's scheduled challenge
  const [todayChallenge] = await db.update(challenges)
    .set({ status: 'active' })
    .where(and(
      eq(challenges.challengeDate, todayStr),
      eq(challenges.status, 'scheduled')
    ))
    .returning();

  if (todayChallenge) {
    activated = todayChallenge.id;
  }

  return { activated, completed };
}

// Get today's active challenge
export async function getTodaysActiveChallenge() {
  const todayStr = today();

  const [active] = await db.select()
    .from(challenges)
    .where(and(
      eq(challenges.challengeDate, todayStr),
      eq(challenges.status, 'active')
    ))
    .limit(1);

  return active || null;
}
