import { Player, Draft, Pick, BattingStats, PitchingStats, PlayerPosition } from '../types';

// Store drafts in localStorage
const STORAGE_KEY_DRAFTS = 'retromatic_drafts';
const STORAGE_KEY_PICKS = 'retromatic_picks';

/**
 * Load player data from local JSON files
 */
export async function fetchPlayers(position?: PlayerPosition): Promise<Player[]> {
  try {
    // Fetch the combined players data from the public folder
    const response = await fetch('/data/players.json');
    
    if (!response.ok) {
      console.error('Failed to fetch players data:', response.statusText);
      return [];
    }
    
    const allPlayers: Player[] = await response.json();
    
    // Filter by position if specified
    if (position) {
      return allPlayers.filter(player => player.position === position);
    }
    
    return allPlayers;
  } catch (error) {
    console.error('Error fetching players:', error);
    return [];
  }
}

/**
 * Create a new draft in localStorage
 */
export function createDraft(userId?: string, guestId?: string): Draft {
  // Get existing drafts or initialize an empty array
  const drafts: Draft[] = JSON.parse(localStorage.getItem(STORAGE_KEY_DRAFTS) || '[]');
  
  // Create a new draft
  const newDraft: Draft = {
    id: Date.now(), // Use timestamp as ID
    status: 'created',
    picks: [],
    createdAt: new Date(),
    userId,
    guestId
  };
  
  // Save the draft
  drafts.push(newDraft);
  localStorage.setItem(STORAGE_KEY_DRAFTS, JSON.stringify(drafts));
  
  return newDraft;
}

/**
 * Get a draft by ID
 */
export function getDraft(draftId: number): Draft | null {
  const drafts: Draft[] = JSON.parse(localStorage.getItem(STORAGE_KEY_DRAFTS) || '[]');
  const draft = drafts.find(d => d.id === draftId);
  
  if (!draft) {
    return null;
  }
  
  // Load picks for this draft
  draft.picks = getPicksForDraft(draftId);
  
  return draft;
}

/**
 * Update draft status
 */
export function updateDraftStatus(draftId: number, status: 'in_progress' | 'completed'): boolean {
  const drafts: Draft[] = JSON.parse(localStorage.getItem(STORAGE_KEY_DRAFTS) || '[]');
  const draftIndex = drafts.findIndex(d => d.id === draftId);
  
  if (draftIndex === -1) {
    return false;
  }
  
  drafts[draftIndex].status = status;
  localStorage.setItem(STORAGE_KEY_DRAFTS, JSON.stringify(drafts));
  
  return true;
}

/**
 * Save a pick for a draft
 */
export async function savePick(draftId: number, playerId: string, pickNumber: number, round: number): Promise<Pick | null> {
  try {
    // Find the player in the cached data
    const allPlayers = await fetchPlayers();
    const player = allPlayers.find(p => p.id === playerId);
    
    if (!player) {
      console.error('Player not found:', playerId);
      return null;
    }
    
    // Create the pick
    const pick: Pick = {
      id: Date.now(),
      draftId,
      player,
      pickNumber,
      round,
      timestamp: new Date()
    };
    
    // Get existing picks or initialize an empty array
    const picks: Pick[] = JSON.parse(localStorage.getItem(STORAGE_KEY_PICKS) || '[]');
    
    // Add the new pick
    picks.push(pick);
    
    // Save picks
    localStorage.setItem(STORAGE_KEY_PICKS, JSON.stringify(picks));
    
    return pick;
  } catch (error) {
    console.error('Error saving pick:', error);
    return null;
  }
}

/**
 * Get all picks for a draft
 */
export function getPicksForDraft(draftId: number): Pick[] {
  const picks: Pick[] = JSON.parse(localStorage.getItem(STORAGE_KEY_PICKS) || '[]');
  return picks.filter(p => p.draftId === draftId);
}

/**
 * Complete a draft and calculate score
 */
export function completeDraft(draftId: number, finalScore: number): Draft | null {
  const drafts: Draft[] = JSON.parse(localStorage.getItem(STORAGE_KEY_DRAFTS) || '[]');
  const draftIndex = drafts.findIndex(d => d.id === draftId);
  
  if (draftIndex === -1) {
    return null;
  }
  
  // Update draft
  drafts[draftIndex].status = 'completed';
  drafts[draftIndex].score = finalScore;
  drafts[draftIndex].completedAt = new Date();
  
  // Calculate percentile (for now just use a random value)
  drafts[draftIndex].percentile = Math.floor(Math.random() * 100);
  
  // Save updated drafts
  localStorage.setItem(STORAGE_KEY_DRAFTS, JSON.stringify(drafts));
  
  // Get the updated draft with picks
  return getDraft(draftId);
}

/**
 * Get leaderboard data
 */
export function getLeaderboard(limit: number = 10): {score: number, percentile: number, userId?: string, createdAt: Date}[] {
  const drafts: Draft[] = JSON.parse(localStorage.getItem(STORAGE_KEY_DRAFTS) || '[]');
  
  // Filter completed drafts with scores
  const completedDrafts = drafts
    .filter(d => d.status === 'completed' && d.score !== undefined)
    .map(d => ({
      score: d.score || 0,
      percentile: d.percentile || 0,
      userId: d.userId,
      createdAt: new Date(d.createdAt)
    }))
    .sort((a, b) => b.percentile - a.percentile)
    .slice(0, limit);
  
  return completedDrafts;
}