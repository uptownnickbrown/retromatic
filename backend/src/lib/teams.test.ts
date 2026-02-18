import { describe, it, expect } from 'vitest';
import { getTeamName, TEAM_NAMES, THEME_TEAMS } from './teams.js';

describe('getTeamName', () => {
  it('returns the code itself as fallback for unknown teams', () => {
    expect(getTeamName('UNKNOWN')).toBe('UNKNOWN');
    expect(getTeamName('')).toBe('');
  });
});

describe('THEME_TEAMS', () => {
  it('contains only valid team codes that exist in TEAM_NAMES', () => {
    // This catches the real bug: someone adds a team code to THEME_TEAMS
    // that doesn't exist in the lookup table, causing silent failures
    for (const code of THEME_TEAMS) {
      expect(TEAM_NAMES, `THEME_TEAMS code "${code}" missing from TEAM_NAMES`).toHaveProperty(code);
    }
  });
});
