import { describe, it, expect } from 'vitest';
import { getTeamName, TEAM_NAMES, THEME_TEAMS } from './teams.js';

describe('getTeamName', () => {
  it('returns full name for known AL team codes', () => {
    expect(getTeamName('NYA')).toBe('New York Yankees');
    expect(getTeamName('BOS')).toBe('Boston Red Sox');
    expect(getTeamName('BAL')).toBe('Baltimore Orioles');
  });

  it('returns full name for known NL team codes', () => {
    expect(getTeamName('LAN')).toBe('Los Angeles Dodgers');
    expect(getTeamName('CHN')).toBe('Chicago Cubs');
    expect(getTeamName('SLN')).toBe('St. Louis Cardinals');
  });

  it('returns the code itself as fallback for unknown teams', () => {
    expect(getTeamName('UNKNOWN')).toBe('UNKNOWN');
    expect(getTeamName('')).toBe('');
  });

  it('handles historical franchise codes', () => {
    expect(getTeamName('MON')).toBe('Montreal Expos');
    expect(getTeamName('SE1')).toBe('Seattle Pilots');
    expect(getTeamName('MLN')).toBe('Milwaukee Braves');
  });
});

describe('TEAM_NAMES', () => {
  it('contains entries for all major franchises (1961-2025)', () => {
    // Should have at least 25+ teams
    expect(Object.keys(TEAM_NAMES).length).toBeGreaterThan(25);
  });
});

describe('THEME_TEAMS', () => {
  it('contains only valid team codes', () => {
    for (const code of THEME_TEAMS) {
      expect(TEAM_NAMES).toHaveProperty(code);
    }
  });

  it('includes major franchises', () => {
    expect(THEME_TEAMS).toContain('NYA'); // Yankees
    expect(THEME_TEAMS).toContain('BOS'); // Red Sox
    expect(THEME_TEAMS).toContain('LAN'); // Dodgers
  });
});
