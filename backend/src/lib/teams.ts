/**
 * Lahman teamID → full team name mapping.
 * Covers franchises active 1961-2025.
 */

export const TEAM_NAMES: Record<string, string> = {
  // American League
  'ANA': 'Anaheim Angels',
  'BAL': 'Baltimore Orioles',
  'BOS': 'Boston Red Sox',
  'CAL': 'California Angels',
  'CHA': 'Chicago White Sox',
  'CLE': 'Cleveland Indians',
  'DET': 'Detroit Tigers',
  'HOU': 'Houston Astros',
  'KC1': 'Kansas City Athletics',
  'KCA': 'Kansas City Royals',
  'LAA': 'Los Angeles Angels',
  'MIN': 'Minnesota Twins',
  'ML1': 'Milwaukee Braves',
  'ML4': 'Milwaukee Brewers',
  'NYA': 'New York Yankees',
  'OAK': 'Oakland Athletics',
  'SEA': 'Seattle Mariners',
  'TBA': 'Tampa Bay Rays',
  'TEX': 'Texas Rangers',
  'TOR': 'Toronto Blue Jays',
  'WAS': 'Washington Nationals',
  'WS2': 'Washington Senators',

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
  'MON': 'Montreal Expos',
  'NYN': 'New York Mets',
  'PHI': 'Philadelphia Phillies',
  'PIT': 'Pittsburgh Pirates',
  'SDN': 'San Diego Padres',
  'SFN': 'San Francisco Giants',
  'SLN': 'St. Louis Cardinals',
  'ATH': 'Athletics',

  // Expansion / relocated
  'SE1': 'Seattle Pilots',
};

/** Get full team name from Lahman code, with fallback */
export function getTeamName(teamId: string): string {
  return TEAM_NAMES[teamId] || teamId;
}

/** Teams commonly used for themed challenges (large fanbases + history) */
export const THEME_TEAMS = [
  'NYA', // Yankees
  'SLN', // Cardinals
  'LAN', // Dodgers
  'BOS', // Red Sox
  'CHN', // Cubs
  'SFN', // Giants
  'ATL', // Braves
  'CIN', // Reds
  'DET', // Tigers
  'OAK', // Athletics
  'PHI', // Phillies
  'PIT', // Pirates
  'HOU', // Astros
  'CHA', // White Sox
  'MIN', // Twins
  'BAL', // Orioles
] as const;
