import { Router } from 'express';
import { db } from '../db/index.js';
import { players } from '../db/schema.js';
import { ilike, or, eq, sql } from 'drizzle-orm';

const router = Router();

// Search players - returns limited info (NO stats during draft)
router.get('/search', async (req, res) => {
  try {
    const { q, position, year } = req.query;

    let query = db.select({
      id: players.id,
      playerId: players.playerId,
      nameFirst: players.nameFirst,
      nameLast: players.nameLast,
      year: players.year,
      team: players.team,
      primaryPosition: players.primaryPosition,
      positionsEligible: players.positionsEligible,
      playerType: players.playerType,
      // Intentionally NOT including stats, zScores during draft
    }).from(players);

    const conditions = [];

    // Name search
    if (q && typeof q === 'string' && q.length > 0) {
      const searchTerm = `%${q}%`;
      conditions.push(
        or(
          ilike(players.nameFirst, searchTerm),
          ilike(players.nameLast, searchTerm),
          sql`CONCAT(${players.nameFirst}, ' ', ${players.nameLast}) ILIKE ${searchTerm}`
        )
      );
    }

    // Position filter
    if (position && typeof position === 'string') {
      conditions.push(
        sql`${players.positionsEligible} LIKE ${'%' + position + '%'}`
      );
    }

    // Year filter
    if (year && typeof year === 'string') {
      conditions.push(eq(players.year, parseInt(year)));
    }

    if (conditions.length > 0) {
      query = query.where(sql`${sql.join(conditions, sql` AND `)}`);
    }

    const results = await query.limit(100);

    // Group by player to show career summary
    const playerMap = new Map<string, {
      id: number;
      name: string;
      years: number[];
      teams: Set<string>;
      positions: Set<string>;
      playerType: string;
      seasons: Array<{ id: number; year: number; team: string; positions: string }>;
    }>();

    for (const row of results) {
      const key = row.playerId;
      if (!playerMap.has(key)) {
        playerMap.set(key, {
          id: row.id,
          name: `${row.nameFirst} ${row.nameLast}`,
          years: [],
          teams: new Set(),
          positions: new Set(),
          playerType: row.playerType,
          seasons: [],
        });
      }
      const player = playerMap.get(key)!;
      player.years.push(row.year);
      if (row.team) player.teams.add(row.team);
      row.positionsEligible.split(',').forEach(p => player.positions.add(p.trim()));
      player.seasons.push({
        id: row.id,
        year: row.year,
        team: row.team || '',
        positions: row.positionsEligible,
      });
    }

    const response = Array.from(playerMap.values()).map(p => ({
      id: p.id,
      name: p.name,
      yearRange: p.years.length > 1
        ? `${Math.min(...p.years)}-${Math.max(...p.years)}`
        : `${p.years[0]}`,
      teams: Array.from(p.teams),
      positions: Array.from(p.positions),
      playerType: p.playerType,
      seasons: p.seasons.sort((a, b) => b.year - a.year),
    }));

    res.json({ players: response });
  } catch (error) {
    console.error('Player search error:', error);
    res.status(500).json({ error: 'Failed to search players' });
  }
});

// Get full player details (only for results display)
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    const result = await db.select().from(players).where(eq(players.id, id)).limit(1);

    if (result.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }

    const player = result[0];

    // Calculate star rating from position z-score
    const zScore = parseFloat(player.zScorePosition as string);
    let starRating: number;
    if (zScore > 2.0) starRating = 5;
    else if (zScore > 1.0) starRating = 4;
    else if (zScore > 0.0) starRating = 3;
    else if (zScore > -1.0) starRating = 2;
    else starRating = 1;

    res.json({
      ...player,
      starRating,
    });
  } catch (error) {
    console.error('Get player error:', error);
    res.status(500).json({ error: 'Failed to get player' });
  }
});

export default router;
