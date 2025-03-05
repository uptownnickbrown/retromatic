/**
 * Script to prepare the Lahman data for local use in the app
 * This bypasses the Supabase upload and creates JSON files in the public/data folder
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Paths
const DATA_DIR = path.join(__dirname, '../data-preprocessing/lahman_1871-2023_csv');
const OUTPUT_DIR = path.join(__dirname, '../public/data');
const BATTING_SCRIPT = path.join(__dirname, '../data-preprocessing/preprocess-batting.py');
const PITCHING_SCRIPT = path.join(__dirname, '../data-preprocessing/preprocess-pitching.py');

// Create output directory if it doesn't exist
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`Created output directory: ${OUTPUT_DIR}`);
}

// Run the preprocessing scripts to generate the JSON files
try {
  console.log('Running batting preprocessing script...');
  const battingOutput = path.join(OUTPUT_DIR, 'batting.json');
  execSync(`python ${BATTING_SCRIPT} ${DATA_DIR} ${battingOutput}`, { stdio: 'inherit' });
  
  console.log('Running pitching preprocessing script...');
  const pitchingOutput = path.join(OUTPUT_DIR, 'pitching.json');
  execSync(`python ${PITCHING_SCRIPT} ${DATA_DIR} ${pitchingOutput}`, { stdio: 'inherit' });
  
  // Combine and format the data
  console.log('Combining data into players.json...');
  
  // Read the processed data
  const battingData = JSON.parse(fs.readFileSync(battingOutput, 'utf8'));
  const pitchingData = JSON.parse(fs.readFileSync(pitchingOutput, 'utf8'));
  
  // Add player_type field
  battingData.forEach(player => player.player_type = 'batter');
  pitchingData.forEach(player => player.player_type = 'pitcher');
  
  // Format the data for the app
  const processedPlayers = [...battingData, ...pitchingData].map(record => {
    // Base player object
    const player = {
      id: record.playerID + '-' + record.yearID + '-' + record.POS,
      playerID: record.playerID,
      nameFirst: record.nameFirst || 'Unknown',
      nameLast: record.nameLast || 'Player',
      position: record.POS,
      year: record.yearID,
      team: record.teamID || '',
      zScore: record.Total_Z || 0,
      posZScore: record.Total_POS_Z || 0
    };
    
    // Add stats based on player type
    if (record.player_type === 'batter') {
      player.stats = {
        R: record.R || 0,
        HR: record.HR || 0,
        RBI: record.RBI || 0,
        SB: record.SB || 0,
        AVG: record.AVG || 0,
        // Additional stats
        H: record.H || 0,
        AB: record.AB || 0,
        BB: record.BB || 0,
        OBP: record.OBP || 0
      };
    } else { // pitcher
      player.stats = {
        W: record.W || 0,
        SV: record.SV || 0,
        K: record.SO || 0, // SO in Lahman is K
        ERA: record.ERA || 0,
        WHIP: record.WHIP || 0,
        // Additional stats
        IP: record.IP || 0,
        G: record.G || 0,
        GS: record.GS || 0,
        L: record.L || 0
      };
    }
    
    return player;
  });
  
  // Clean up any potential NaN or inf values by converting to null
  const cleanedPlayers = JSON.parse(
    JSON.stringify(processedPlayers, (key, value) => {
      // Handle NaN and Infinity (which cannot be serialized in JSON)
      if (typeof value === 'number' && (isNaN(value) || !isFinite(value))) {
        return null;
      }
      return value;
    })
  );
  
  // Write the combined data to players.json
  const playersOutput = path.join(OUTPUT_DIR, 'players.json');
  fs.writeFileSync(playersOutput, JSON.stringify(cleanedPlayers, null, 2));
  
  console.log(`Successfully created ${playersOutput} with ${cleanedPlayers.length} players`);
  console.log('Data preparation complete. The files are ready for local use in the app.');
  
} catch (error) {
  console.error('Error during data preparation:', error);
  process.exit(1);
}