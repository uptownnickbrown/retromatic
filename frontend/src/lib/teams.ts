/**
 * Lahman teamID → full team name mapping.
 * Covers franchises active 1961-2025.
 * Copied from backend/src/lib/teams.ts — display use only.
 */

const TEAM_NAMES: Record<string, string> = {
  // American League
  'ANA': 'Anaheim Angels',
  'BAL': 'Baltimore Orioles',
  'BOS': 'Boston Red Sox',
  'CAL': 'California Angels',
  'CHA': 'Chicago White Sox',
  'CLE': 'Cleveland Indians',
  'DET': 'Detroit Tigers',
  'HOU': 'Houston Astros',
  'KCA': 'Kansas City Athletics',
  'KCR': 'Kansas City Royals',
  'LAA': 'Los Angeles Angels',
  'MIN': 'Minnesota Twins',
  'ML4': 'Milwaukee Brewers',
  'NYA': 'New York Yankees',
  'OAK': 'Oakland Athletics',
  'SEA': 'Seattle Mariners',
  'TBA': 'Tampa Bay Rays',
  'TEX': 'Texas Rangers',
  'TOR': 'Toronto Blue Jays',
  'WAS': 'Washington Senators',

  // National League
  'ARI': 'Arizona Diamondbacks',
  'ATL': 'Atlanta Braves',
  'CHN': 'Chicago Cubs',
  'CIN': 'Cincinnati Reds',
  'COL': 'Colorado Rockies',
  'FLO': 'Florida Marlins',
  'LAN': 'Los Angeles Dodgers',
  'MIA': 'Miami Marlins',
  'MIL': 'Milwaukee Brewers',
  'MLN': 'Milwaukee Braves',
  'MON': 'Montreal Expos',
  'NYN': 'New York Mets',
  'PHI': 'Philadelphia Phillies',
  'PIT': 'Pittsburgh Pirates',
  'SDN': 'San Diego Padres',
  'SFN': 'San Francisco Giants',
  'SLN': 'St. Louis Cardinals',
  'WS1': 'Washington Senators',
  'WSN': 'Washington Nationals',

  // Expansion / relocated
  'SE1': 'Seattle Pilots',
};

/** Get full team name (e.g. "Philadelphia Phillies"). Falls back to raw code. */
export function getTeamFullName(teamId: string): string {
  return TEAM_NAMES[teamId] ?? teamId;
}

/** Get just the nickname (e.g. "Phillies"). Falls back to raw code. */
export function getTeamNickname(teamId: string): string {
  const full = TEAM_NAMES[teamId];
  if (!full) return teamId;
  // Special case: "Red Sox", "White Sox", "Blue Jays" — last two words
  const parts = full.split(' ');
  const twoWord = parts.slice(-2).join(' ');
  if (['Red Sox', 'White Sox', 'Blue Jays'].includes(twoWord)) return twoWord;
  return parts[parts.length - 1];
}

/** Get just the city (e.g. "Philadelphia"). Falls back to raw code. */
export function getTeamCity(teamId: string): string {
  const full = TEAM_NAMES[teamId];
  if (!full) return teamId;
  const parts = full.split(' ');
  const twoWord = parts.slice(-2).join(' ');
  if (['Red Sox', 'White Sox', 'Blue Jays'].includes(twoWord)) {
    return parts.slice(0, -2).join(' ');
  }
  return parts.slice(0, -1).join(' ');
}
