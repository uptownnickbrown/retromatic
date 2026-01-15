import { db } from '../db/index.js';
import { teamPool, players, type Player } from '../db/schema.js';
import { sql, desc } from 'drizzle-orm';

// Scoring categories
const BATTING_CATEGORIES = ['R', 'HR', 'RBI', 'SB', 'AVG'];
const PITCHING_CATEGORIES = ['W', 'SV', 'K', 'ERA', 'WHIP'];
const ALL_CATEGORIES = [...BATTING_CATEGORIES, ...PITCHING_CATEGORIES];

// Categories where lower is better
const INVERTED_CATEGORIES = ['ERA', 'WHIP'];

interface CategoryTotals {
  R: number;
  HR: number;
  RBI: number;
  SB: number;
  AVG: number;
  W: number;
  SV: number;
  K: number;
  ERA: number;
  WHIP: number;
  [key: string]: number;
}

interface TeamScoreResult {
  totalScore: number;
  percentile: number;
  categoryTotals: CategoryTotals;
  categoryPercentiles: Record<string, number>;
}

interface RotoResult {
  placement: number;
  scoreboard: Array<{
    rank: number;
    teamName: string;
    points: number;
    isUser: boolean;
  }>;
}

// Calculate team score from player list
export async function calculateTeamScore(playerList: Player[]): Promise<TeamScoreResult> {
  // Separate batters and pitchers
  const batters = playerList.filter(p => p.playerType === 'batter');
  const pitchers = playerList.filter(p => p.playerType === 'pitcher');

  // Calculate batting totals
  const battingTotals = {
    R: 0, HR: 0, RBI: 0, SB: 0,
    H: 0, AB: 0, // For AVG calculation
  };

  for (const batter of batters) {
    const stats = batter.stats as Record<string, number>;
    battingTotals.R += stats.R || 0;
    battingTotals.HR += stats.HR || 0;
    battingTotals.RBI += stats.RBI || 0;
    battingTotals.SB += stats.SB || 0;
    battingTotals.H += stats.H || 0;
    battingTotals.AB += stats.AB || 0;
  }

  const AVG = battingTotals.AB > 0 ? battingTotals.H / battingTotals.AB : 0;

  // Calculate pitching totals
  const pitchingTotals = {
    W: 0, SV: 0, K: 0,
    ER: 0, IP: 0, // For ERA calculation
    BB: 0, H: 0, // For WHIP calculation
  };

  for (const pitcher of pitchers) {
    const stats = pitcher.stats as Record<string, number>;
    pitchingTotals.W += stats.W || 0;
    pitchingTotals.SV += stats.SV || 0;
    pitchingTotals.K += stats.K || stats.SO || 0;
    pitchingTotals.ER += stats.ER || 0;
    pitchingTotals.IP += stats.IP || 0;
    pitchingTotals.BB += stats.BB || 0;
    pitchingTotals.H += stats.H || 0;
  }

  const ERA = pitchingTotals.IP > 0 ? (pitchingTotals.ER * 9) / pitchingTotals.IP : 99.99;
  const WHIP = pitchingTotals.IP > 0 ? (pitchingTotals.BB + pitchingTotals.H) / pitchingTotals.IP : 99.99;

  const categoryTotals: CategoryTotals = {
    R: battingTotals.R,
    HR: battingTotals.HR,
    RBI: battingTotals.RBI,
    SB: battingTotals.SB,
    AVG: Math.round(AVG * 1000) / 1000,
    W: pitchingTotals.W,
    SV: pitchingTotals.SV,
    K: pitchingTotals.K,
    ERA: Math.round(ERA * 100) / 100,
    WHIP: Math.round(WHIP * 100) / 100,
  };

  // Calculate total score (sum of position z-scores)
  const totalScore = playerList.reduce((sum, p) => {
    return sum + parseFloat(p.zScorePosition as string);
  }, 0);

  // Calculate percentile based on team pool
  const percentile = await calculatePercentile(totalScore);

  // Calculate category percentiles
  const categoryPercentiles = await calculateCategoryPercentiles(categoryTotals);

  return {
    totalScore: Math.round(totalScore * 100) / 100,
    percentile,
    categoryTotals,
    categoryPercentiles,
  };
}

// Calculate percentile against team pool
async function calculatePercentile(score: number): Promise<number> {
  const poolStats = await db.select({
    total: sql<number>`count(*)`,
    belowCount: sql<number>`count(*) filter (where ${teamPool.totalScore} < ${score})`,
  }).from(teamPool);

  if (poolStats[0].total === 0) return 50; // Default if no teams in pool yet

  const percentile = Math.round((poolStats[0].belowCount / poolStats[0].total) * 100);
  return Math.min(99, Math.max(1, percentile));
}

// Calculate percentile for each category
async function calculateCategoryPercentiles(totals: CategoryTotals): Promise<Record<string, number>> {
  const percentiles: Record<string, number> = {};

  const poolTeams = await db.select({
    categoryTotals: teamPool.categoryTotals,
  }).from(teamPool).limit(10000);

  if (poolTeams.length === 0) {
    // Default percentiles if no pool
    ALL_CATEGORIES.forEach(cat => percentiles[cat] = 50);
    return percentiles;
  }

  for (const category of ALL_CATEGORIES) {
    const teamValue = totals[category];
    const isInverted = INVERTED_CATEGORIES.includes(category);

    let betterCount = 0;
    for (const poolTeam of poolTeams) {
      const poolTotals = poolTeam.categoryTotals as CategoryTotals;
      const poolValue = poolTotals[category] || 0;

      if (isInverted) {
        if (teamValue < poolValue) betterCount++;
      } else {
        if (teamValue > poolValue) betterCount++;
      }
    }

    percentiles[category] = Math.round((betterCount / poolTeams.length) * 100);
  }

  return percentiles;
}

// Run 12-team roto simulation
export async function runRotoSimulation(teamTotals: CategoryTotals): Promise<RotoResult> {
  // Get 11 random teams from pool
  const opponents = await db.select({
    id: teamPool.id,
    categoryTotals: teamPool.categoryTotals,
  })
    .from(teamPool)
    .orderBy(sql`RANDOM()`)
    .limit(11);

  // Create league with user's team
  const league: Array<{ name: string; totals: CategoryTotals; isUser: boolean }> = [
    { name: 'Your Team', totals: teamTotals, isUser: true },
    ...opponents.map((o, i) => ({
      name: `Team ${i + 1}`,
      totals: o.categoryTotals as CategoryTotals,
      isUser: false,
    })),
  ];

  // Calculate roto points for each team
  const teamPoints: Array<{ name: string; points: number; isUser: boolean }> = [];

  for (const team of league) {
    let points = 0;

    for (const category of ALL_CATEGORIES) {
      const isInverted = INVERTED_CATEGORIES.includes(category);

      // Rank teams in this category
      const ranked = [...league].sort((a, b) => {
        const aVal = a.totals[category] || 0;
        const bVal = b.totals[category] || 0;
        return isInverted ? aVal - bVal : bVal - aVal;
      });

      const rank = ranked.findIndex(t => t.name === team.name) + 1;
      points += (13 - rank); // 12 pts for 1st, 1 pt for 12th
    }

    teamPoints.push({ name: team.name, points, isUser: team.isUser });
  }

  // Sort by points
  teamPoints.sort((a, b) => b.points - a.points);

  // Create scoreboard
  const scoreboard = teamPoints.map((t, i) => ({
    rank: i + 1,
    teamName: t.name,
    points: t.points,
    isUser: t.isUser,
  }));

  const userPlacement = scoreboard.find(s => s.isUser)?.rank || 6;

  return {
    placement: userPlacement,
    scoreboard,
  };
}

// Calculate win-loss record against all teams
export async function calculateWinLoss(teamTotals: CategoryTotals): Promise<string> {
  const poolTeams = await db.select({
    categoryTotals: teamPool.categoryTotals,
  }).from(teamPool).limit(10000);

  if (poolTeams.length === 0) return '0-0';

  let wins = 0;
  let losses = 0;

  for (const opponent of poolTeams) {
    const oppTotals = opponent.categoryTotals as CategoryTotals;

    let userWins = 0;
    let oppWins = 0;

    for (const category of ALL_CATEGORIES) {
      const isInverted = INVERTED_CATEGORIES.includes(category);
      const userVal = teamTotals[category] || 0;
      const oppVal = oppTotals[category] || 0;

      if (isInverted) {
        if (userVal < oppVal) userWins++;
        else if (userVal > oppVal) oppWins++;
      } else {
        if (userVal > oppVal) userWins++;
        else if (userVal < oppVal) oppWins++;
      }
    }

    if (userWins > oppWins) wins++;
    else if (oppWins > userWins) losses++;
    // Ties don't count
  }

  return `${wins}-${losses}`;
}

// Detect interesting outliers about the team
export async function detectOutliers(
  teamTotals: CategoryTotals,
  playerList: Player[]
): Promise<string[]> {
  const facts: string[] = [];

  // Get pool for comparison
  const poolTeams = await db.select({
    categoryTotals: teamPool.categoryTotals,
  }).from(teamPool).limit(10000);

  // Check if team leads any category
  for (const category of ALL_CATEGORIES) {
    const isInverted = INVERTED_CATEGORIES.includes(category);
    const teamValue = teamTotals[category];

    let rank = 1;
    for (const poolTeam of poolTeams) {
      const poolTotals = poolTeam.categoryTotals as CategoryTotals;
      const poolValue = poolTotals[category] || 0;

      if (isInverted) {
        if (poolValue < teamValue) rank++;
      } else {
        if (poolValue > teamValue) rank++;
      }
    }

    if (rank === 1) {
      facts.push(`Best ${category} in the entire database!`);
    } else if (rank <= 3) {
      facts.push(`${rank}${rank === 2 ? 'nd' : 'rd'} best ${category} ever assembled!`);
    } else if (rank <= 10) {
      facts.push(`Top 10 all-time in ${category}!`);
    }
  }

  // Check for team clusters (multiple players from same team/year)
  const teamYearCounts = new Map<string, number>();
  for (const player of playerList) {
    const key = `${player.team}-${player.year}`;
    teamYearCounts.set(key, (teamYearCounts.get(key) || 0) + 1);
  }

  for (const [teamYear, count] of teamYearCounts) {
    if (count >= 3) {
      const [team, year] = teamYear.split('-');
      facts.push(`You drafted ${count} players from the ${year} ${team}!`);
    }
  }

  // Check for 5-star players
  const fiveStarCount = playerList.filter(p => parseFloat(p.zScorePosition as string) > 2.0).length;
  if (fiveStarCount >= 5) {
    facts.push(`Stacked roster with ${fiveStarCount} elite (5-star) players!`);
  }

  return facts.slice(0, 5); // Limit to 5 facts
}
