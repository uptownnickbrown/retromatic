import { describe, it, expect } from 'vitest';
import { validateSqlQuery } from './agentChallengeBuilder.js';

describe('validateSqlQuery', () => {
  it('accepts a simple SELECT query', () => {
    expect(validateSqlQuery('SELECT * FROM players LIMIT 10')).toEqual({ valid: true });
  });

  it('accepts CTEs with WITH', () => {
    expect(validateSqlQuery('WITH cte AS (SELECT player_id FROM players) SELECT * FROM cte LIMIT 10')).toEqual({ valid: true });
  });

  it('accepts subqueries from players', () => {
    expect(validateSqlQuery('SELECT * FROM (SELECT * FROM players WHERE year > 2000) sub LIMIT 10')).toEqual({ valid: true });
  });

  it('accepts window functions', () => {
    const query = `SELECT player_id, ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY year) as season_num FROM players LIMIT 50`;
    expect(validateSqlQuery(query)).toEqual({ valid: true });
  });

  it('accepts JSONB access patterns', () => {
    const query = `SELECT player_id FROM players WHERE (stats->>'HR')::int >= 40 LIMIT 20`;
    expect(validateSqlQuery(query)).toEqual({ valid: true });
  });

  it('rejects empty query', () => {
    const result = validateSqlQuery('');
    expect(result).toEqual({ valid: false, error: 'sql parameter is required' });
  });

  it('rejects INSERT statements', () => {
    const result = validateSqlQuery("INSERT INTO players (name_first) VALUES ('test')");
    expect(result.valid).toBe(false);
    expect((result as { error: string }).error).toContain('must start with SELECT');
  });

  it('rejects DELETE statements', () => {
    const result = validateSqlQuery('DELETE FROM players WHERE id = 1');
    expect(result.valid).toBe(false);
  });

  it('rejects DROP statements', () => {
    const result = validateSqlQuery('DROP TABLE players');
    expect(result.valid).toBe(false);
  });

  it('rejects UPDATE statements', () => {
    const result = validateSqlQuery("UPDATE players SET name_first = 'x' WHERE id = 1");
    expect(result.valid).toBe(false);
  });

  it('rejects SELECT with embedded DROP keyword', () => {
    const result = validateSqlQuery('SELECT * FROM players; DROP TABLE players; -- LIMIT 10');
    expect(result.valid).toBe(false);
    expect((result as { error: string }).error).toContain('DROP');
  });

  it('rejects EXPLAIN', () => {
    const result = validateSqlQuery('EXPLAIN SELECT * FROM players LIMIT 10');
    expect(result.valid).toBe(false);
  });

  it('rejects TRUNCATE hidden in a SELECT', () => {
    const result = validateSqlQuery('SELECT 1; TRUNCATE players; -- LIMIT 1');
    expect(result.valid).toBe(false);
    expect((result as { error: string }).error).toContain('TRUNCATE');
  });

  it('accepts CTEs with column-list syntax', () => {
    expect(validateSqlQuery(
      "WITH champs(team, year) AS (VALUES ('NYA', 1998)) SELECT * FROM players p JOIN champs c ON p.team = c.team LIMIT 10"
    )).toEqual({ valid: true });
  });

  it('rejects queries without LIMIT', () => {
    const result = validateSqlQuery('SELECT * FROM players');
    expect(result.valid).toBe(false);
    expect((result as { error: string }).error).toContain('LIMIT');
  });

  it('accepts complex CTE queries with multiple FROM players', () => {
    const query = `
      WITH career AS (
        SELECT player_id, year, z_score_position::numeric as z,
          ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY year) as season_num
        FROM players
      ),
      early AS (
        SELECT player_id FROM career WHERE season_num <= 7 GROUP BY player_id
        HAVING MAX(z) < 3.33
      )
      SELECT DISTINCT c.player_id, c.season_num
      FROM career c JOIN early e ON c.player_id = e.player_id
      LIMIT 50
    `;
    expect(validateSqlQuery(query)).toEqual({ valid: true });
  });

  it('rejects SET statements', () => {
    const result = validateSqlQuery("SET statement_timeout = '0'; SELECT 1 FROM players LIMIT 1");
    expect(result.valid).toBe(false);
  });

  it('rejects GRANT statements', () => {
    const result = validateSqlQuery('GRANT ALL ON players TO public');
    expect(result.valid).toBe(false);
  });
});
