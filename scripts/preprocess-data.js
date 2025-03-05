/**
 * Script to preprocess the Lahman Baseball Database data for use in Retromatic
 * 
 * This script processes both batting and pitching data, computing z-scores and 
 * position-relative scores for fantasy baseball categories, then pushes the data
 * to Supabase (if configured).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Paths to the Python scripts
const BATTING_SCRIPT = path.join(__dirname, '../data-preprocessing/preprocess-batting.py');
const PITCHING_SCRIPT = path.join(__dirname, '../data-preprocessing/preprocess-pitching.py');
const DB_PUSH_SCRIPT = path.join(__dirname, '../data-preprocessing/push-to-db.py');
const LAHMAN_DATA_DIR = path.join(__dirname, '../data-preprocessing/lahman_1871-2023_csv');
const OUTPUT_DIR = path.join(__dirname, '../public/data');

// Create output directory if it doesn't exist
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

console.log('Starting data preprocessing...');

// Define the Python executable path - MODIFY THIS TO YOUR ENVIRONMENT PATH
// For example: '/Users/your_username/miniconda3/envs/your_env_name/bin/python'
// or use 'python' if it's in your PATH and points to the correct environment
const PYTHON_PATH = process.env.PYTHON_PATH || 'python';

// Run the batting preprocessing script
console.log('Processing batting data...');
console.log(`Using Python at: ${PYTHON_PATH}`);
const battingOutput = path.join(OUTPUT_DIR, 'batting.json');
const battingResult = spawnSync(PYTHON_PATH, [
  BATTING_SCRIPT,
  LAHMAN_DATA_DIR,
  battingOutput
]);

if (battingResult.error) {
  console.error('Error processing batting data:', battingResult.error);
  process.exit(1);
} else {
  console.log('Batting data processed:', battingResult.stdout.toString());
  if (battingResult.stderr.length > 0) {
    console.error('Stderr:', battingResult.stderr.toString());
  }
}

// Run the pitching preprocessing script
console.log('Processing pitching data...');
const pitchingOutput = path.join(OUTPUT_DIR, 'pitching.json');
const pitchingResult = spawnSync(PYTHON_PATH, [
  PITCHING_SCRIPT,
  LAHMAN_DATA_DIR,
  pitchingOutput
]);

if (pitchingResult.error) {
  console.error('Error processing pitching data:', pitchingResult.error);
  process.exit(1);
} else {
  console.log('Pitching data processed:', pitchingResult.stdout.toString());
  if (pitchingResult.stderr.length > 0) {
    console.error('Stderr:', pitchingResult.stderr.toString());
  }
}

console.log('Data preprocessing complete.');

// Combine the data into a single file for easier consumption
try {
  console.log('Combining data files...');
  
  const battingData = JSON.parse(fs.readFileSync(battingOutput, 'utf8'));
  const pitchingData = JSON.parse(fs.readFileSync(pitchingOutput, 'utf8'));
  
  // Add a type field to distinguish batting from pitching
  battingData.forEach(player => player.type = 'batter');
  pitchingData.forEach(player => player.type = 'pitcher');
  
  // Combine the data
  const combinedData = [...battingData, ...pitchingData];
  
  // Write combined data to file
  const playersOutput = path.join(OUTPUT_DIR, 'players.json');
  fs.writeFileSync(
    playersOutput, 
    JSON.stringify(combinedData, null, 2)
  );
  
  console.log(`Combined data written to ${playersOutput}`);

  // Push data to Supabase if .env has credentials
  const envPath = path.join(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    console.log('Found .env file, attempting to push data to Supabase...');
    
    const dbPushResult = spawnSync(PYTHON_PATH, [
      DB_PUSH_SCRIPT,
      battingOutput,
      pitchingOutput
    ]);
    
    if (dbPushResult.error) {
      console.error('Error pushing data to Supabase:', dbPushResult.error);
    } else {
      console.log(dbPushResult.stdout.toString());
      if (dbPushResult.stderr.length > 0) {
        console.error('Stderr:', dbPushResult.stderr.toString());
      }
    }
  } else {
    console.log('No .env file found. Skipping Supabase upload.');
    console.log('To upload data to Supabase, create a .env file with SUPABASE_URL and SUPABASE_KEY variables.');
  }
  
} catch (error) {
  console.error('Error combining data files:', error);
}