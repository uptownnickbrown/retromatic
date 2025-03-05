// Export services
import * as supabaseService from './supabase';
import * as localDataService from './localData';

// Determine which data service to use
// Set to true to use local data files, false to use Supabase
const USE_LOCAL_DATA = true;

// Export the appropriate service functions
export const {
  fetchPlayers,
  createDraft,
  savePick,
  completeDraft,
} = USE_LOCAL_DATA ? localDataService : supabaseService;

// For development/debugging purposes
export const dataSource = USE_LOCAL_DATA ? 'local' : 'supabase';