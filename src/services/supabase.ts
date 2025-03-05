import { createClient } from '@supabase/supabase-js';
import { Player, BattingStats, PitchingStats, PlayerPosition, Draft, Pick } from '../types';

// Get Supabase credentials from environment variables
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || '';
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials missing. Set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY env variables.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Define database table row types (matching the actual DB schema)
export type PlayerRow = {
  id: number;
  playerID: string;
  nameFirst: string;
  nameLast: string;
  position: string;
  year: number;
  team?: string;
  player_type: 'batter' | 'pitcher';
  zScore: number;
  posZScore: number;
  stats: {
    // Batting stats for batters
    R?: number;
    HR?: number;
    RBI?: number;
    SB?: number;
    AVG?: number;
    H?: number;
    AB?: number;
    BB?: number;
    OBP?: number;
    
    // Pitching stats for pitchers
    W?: number;
    SV?: number;
    K?: number; // SO in Lahman is K 
    ERA?: number;
    WHIP?: number;
    IP?: number;
    G?: number;
    GS?: number;
    L?: number;
  };
  Total_POS_Z?: number;
  R_Z?: number;
  HR_Z?: number;
  RBI_Z?: number;
  SB_Z?: number;
  AVG_Z?: number;
  W_Z?: number;
  SV_Z?: number;
  SO_Z?: number;
  ERA_Z?: number;
  WHIP_Z?: number;
};

export type DraftRow = {
  id: number;
  created_at: string;
  status: 'created' | 'in_progress' | 'completed';
  user_id?: string;
  guest_id?: string;
  final_score?: number;
  percentile?: number;
};

export type PickRow = {
  id: number;
  draft_id: number;
  player_id: string;
  pick_number: number;
  round: number;
  created_at: string;
};

// Convert DB row to app type
function convertPlayerRowToPlayer(row: PlayerRow): Player {
  const player: Player = {
    id: row.playerID,
    playerID: row.playerID,
    nameFirst: row.nameFirst,
    nameLast: row.nameLast,
    position: row.position as PlayerPosition,
    year: row.year,
    team: row.team,
    zScore: row.zScore || 0,
    posZScore: row.posZScore || 0,
    stats: {} as BattingStats | PitchingStats,
  };

  if (row.player_type === 'batter') {
    const stats = row.stats || {};
    const battingStats: BattingStats = {
      R: stats.R || 0,
      HR: stats.HR || 0,
      RBI: stats.RBI || 0,
      SB: stats.SB || 0,
      AVG: stats.AVG || 0,
      H: stats.H,
      AB: stats.AB,
      BB: stats.BB,
      OBP: stats.OBP,
    };
    player.stats = battingStats;
  } else {
    const stats = row.stats || {};
    const pitchingStats: PitchingStats = {
      W: stats.W || 0,
      SV: stats.SV || 0,
      K: stats.K || 0,
      ERA: stats.ERA || 0,
      WHIP: stats.WHIP || 0,
      IP: stats.IP,
      G: stats.G,
      GS: stats.GS,
      L: stats.L,
    };
    player.stats = pitchingStats;
  }

  return player;
}

// API functions for data access
export async function fetchPlayers(position?: PlayerPosition): Promise<Player[]> {
  // Fetch both batting and pitching players for better organization and performance
  if (position) {
    // If position specified, only fetch from the appropriate player type
    if (['C', '1B', '2B', '3B', 'SS', 'OF', 'UTIL'].includes(position)) {
      // Batting positions
      let query = supabase
        .from('players_batting')
        .select('*')
        .order('zScore', { ascending: false });
        
      if (position !== 'UTIL') {
        query = query.eq('position', position);
      }
      
      const { data, error } = await query.limit(300);
      
      if (error) {
        console.error('Error fetching batting players:', error);
        return [];
      }
      
      return (data || []).map(row => convertPlayerRowToPlayer(row as PlayerRow));
    } else {
      // Pitching positions
      let query = supabase
        .from('players_pitching')
        .select('*')
        .order('zScore', { ascending: false });
        
      if (position !== 'P') {
        query = query.eq('position', position);
      }
      
      const { data, error } = await query.limit(300);
      
      if (error) {
        console.error('Error fetching pitching players:', error);
        return [];
      }
      
      return (data || []).map(row => convertPlayerRowToPlayer(row as PlayerRow));
    }
  } else {
    // If no position specified, fetch top players from both tables
    const [battingPlayers, pitchingPlayers] = await Promise.all([
      fetchBattingPlayers(),
      fetchPitchingPlayers()
    ]);
    
    return [...battingPlayers, ...pitchingPlayers].sort((a, b) => b.zScore - a.zScore);
  }
}

// Get players from separate tables for potentially better performance
export async function fetchBattingPlayers(): Promise<Player[]> {
  const { data, error } = await supabase
    .from('players_batting')
    .select('*')
    .order('zScore', { ascending: false })
    .limit(500); // Limit to top players for performance
  
  if (error) {
    console.error('Error fetching batting players:', error);
    return [];
  }
  
  return (data || []).map(row => convertPlayerRowToPlayer(row as PlayerRow));
}

export async function fetchPitchingPlayers(): Promise<Player[]> {
  const { data, error } = await supabase
    .from('players_pitching')
    .select('*')
    .order('zScore', { ascending: false })
    .limit(500); // Limit to top players for performance
  
  if (error) {
    console.error('Error fetching pitching players:', error);
    return [];
  }
  
  return (data || []).map(row => convertPlayerRowToPlayer(row as PlayerRow));
}

export async function fetchPlayerById(playerId: string): Promise<Player | null> {
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('playerID', playerId)
    .single();
  
  if (error) {
    console.error('Error fetching player by ID:', error);
    return null;
  }
  
  return convertPlayerRowToPlayer(data as PlayerRow);
}

export async function createDraft(userId?: string, guestId?: string): Promise<Draft | null> {
  const { data, error } = await supabase
    .from('drafts')
    .insert({
      status: 'created',
      user_id: userId,
      guest_id: guestId
    })
    .select()
    .single();
  
  if (error) {
    console.error('Error creating draft:', error);
    return null;
  }
  
  const draftRow = data as DraftRow;
  
  return {
    id: draftRow.id,
    status: draftRow.status,
    picks: [],
    createdAt: new Date(draftRow.created_at),
    userId: draftRow.user_id,
    guestId: draftRow.guest_id,
  };
}

export async function fetchDraftById(draftId: number): Promise<Draft | null> {
  // First get the draft
  const { data: draftData, error: draftError } = await supabase
    .from('drafts')
    .select('*')
    .eq('id', draftId)
    .single();
  
  if (draftError) {
    console.error('Error fetching draft:', draftError);
    return null;
  }
  
  const draftRow = draftData as DraftRow;
  
  // Then get all picks for this draft
  const { data: picksData, error: picksError } = await supabase
    .from('picks')
    .select('*')
    .eq('draft_id', draftId)
    .order('pick_number', { ascending: true });
  
  if (picksError) {
    console.error('Error fetching picks:', picksError);
    return null;
  }
  
  // For each pick, get the player details
  const picks: Pick[] = [];
  
  for (const pickRow of (picksData || []) as PickRow[]) {
    const player = await fetchPlayerById(pickRow.player_id);
    
    if (player) {
      picks.push({
        id: pickRow.id,
        draftId: pickRow.draft_id,
        player,
        pickNumber: pickRow.pick_number,
        round: pickRow.round,
        timestamp: new Date(pickRow.created_at),
      });
    }
  }
  
  return {
    id: draftRow.id,
    status: draftRow.status,
    picks,
    createdAt: new Date(draftRow.created_at),
    completedAt: draftRow.status === 'completed' ? new Date(draftRow.created_at) : undefined,
    score: draftRow.final_score,
    percentile: draftRow.percentile,
    userId: draftRow.user_id,
    guestId: draftRow.guest_id,
  };
}

export async function savePick(draftId: number, playerId: string, pickNumber: number, round: number): Promise<Pick | null> {
  // First save the pick to the database
  const { data, error } = await supabase
    .from('picks')
    .insert({
      draft_id: draftId,
      player_id: playerId,
      pick_number: pickNumber,
      round: round
    })
    .select()
    .single();
  
  if (error) {
    console.error('Error saving pick:', error);
    return null;
  }
  
  const pickRow = data as PickRow;
  
  // Get the player details
  const player = await fetchPlayerById(playerId);
  
  if (!player) {
    console.error('Error fetching player for pick:', playerId);
    return null;
  }
  
  return {
    id: pickRow.id,
    draftId: pickRow.draft_id,
    player,
    pickNumber: pickRow.pick_number,
    round: pickRow.round,
    timestamp: new Date(pickRow.created_at),
  };
}

export async function updateDraftStatus(draftId: number, status: 'in_progress' | 'completed'): Promise<boolean> {
  const { error } = await supabase
    .from('drafts')
    .update({
      status
    })
    .eq('id', draftId);
  
  if (error) {
    console.error('Error updating draft status:', error);
    return false;
  }
  
  return true;
}

export async function completeDraft(draftId: number, finalScore: number): Promise<Draft | null> {
  // In a full implementation, this would calculate the percentile on the server
  // For now, we'll use a random value between 0 and 100
  const percentile = Math.floor(Math.random() * 100);
  
  const { data, error } = await supabase
    .from('drafts')
    .update({
      status: 'completed',
      final_score: finalScore,
      percentile
    })
    .eq('id', draftId)
    .select()
    .single();
  
  if (error) {
    console.error('Error completing draft:', error);
    return null;
  }
  
  // Fetch the full draft with picks
  return fetchDraftById(draftId);
}

// Fetch the top scores for the leaderboard
export async function fetchLeaderboard(limit: number = 10): Promise<{score: number, percentile: number, userId?: string, createdAt: Date}[]> {
  const { data, error } = await supabase
    .from('drafts')
    .select('final_score, percentile, user_id, created_at')
    .eq('status', 'completed')
    .order('percentile', { ascending: false })
    .limit(limit);
  
  if (error) {
    console.error('Error fetching leaderboard:', error);
    return [];
  }
  
  return (data || []).map(row => ({
    score: row.final_score,
    percentile: row.percentile,
    userId: row.user_id,
    createdAt: new Date(row.created_at)
  }));
}