import pandas as pd
import numpy as np
import os
import sys
import sqlite3
from scipy.stats import zscore

def create_sqlite_db(db_path):
    """
    Create a new SQLite database with necessary tables
    """
    conn = sqlite3.connect(db_path)
    c = conn.cursor()

    # Enable compression for maximum space savings
    c.execute("PRAGMA page_size = 4096")
    c.execute("PRAGMA journal_mode = OFF")  # Disable journaling for smaller size
    c.execute("PRAGMA synchronous = OFF")   # Less durability but smaller size
    
    # Create consolidated players table with positions_eligible field
    c.execute('''
    CREATE TABLE IF NOT EXISTS players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        playerID TEXT,
        nameFirst TEXT,
        nameLast TEXT,
        primary_position TEXT,       -- The player's main position
        positions_eligible TEXT,     -- All positions the player is eligible for, stored as a comma-separated string
        year INTEGER,
        player_type TEXT,
        team TEXT,
        zScore REAL,
        posZScore REAL,
        stats TEXT
    )
    ''')
    
    # Create index on playerID and year for faster lookups
    c.execute('''
    CREATE INDEX IF NOT EXISTS idx_player_year 
    ON players(playerID, year)
    ''')
    
    # Create index for name-based searches
    c.execute('''
    CREATE INDEX IF NOT EXISTS idx_player_name
    ON players(nameLast, nameFirst)
    ''')
    
    # Create index for year-based filtering
    c.execute('''
    CREATE INDEX IF NOT EXISTS idx_year
    ON players(year)
    ''')
    
    conn.commit()
    conn.close()
    print(f"Created SQLite database at {db_path}")
    return db_path

def load_batting_data(data_dir: str) -> pd.DataFrame:
    """
    Loads Batting.csv and merges with Fielding.csv to determine
    position eligibility, plus merges People.csv to attach basic name info.
    Returns a DataFrame of 'playerID', 'yearID', plus key batting stats,
    plus a multi-valued 'positions' field or repeated rows for each position.
    """
    # Load Lahman CSVs - try different encodings since there are special characters in the data
    try:
        batting = pd.read_csv(os.path.join(data_dir, 'Batting.csv'), encoding='utf-8')
    except UnicodeDecodeError:
        batting = pd.read_csv(os.path.join(data_dir, 'Batting.csv'), encoding='latin1')
    
    try:
        fielding = pd.read_csv(os.path.join(data_dir, 'Fielding.csv'), encoding='utf-8')
    except UnicodeDecodeError:
        fielding = pd.read_csv(os.path.join(data_dir, 'Fielding.csv'), encoding='latin1')
    
    try:
        people = pd.read_csv(os.path.join(data_dir, 'People.csv'), encoding='utf-8')
    except UnicodeDecodeError:
        people = pd.read_csv(os.path.join(data_dir, 'People.csv'), encoding='latin1')

    # Filter data to start from 1961 as originally intended
    batting = batting[batting['yearID'] >= 1961]
    fielding = fielding[fielding['yearID'] >= 1961]
        
    # Basic join to People so we have name info
    batting = batting.merge(
        people[['playerID','nameFirst','nameLast']],
        how='left', on='playerID'
    )
    
    # Summarize fielding to find eligibility
    # E.g. "at least 20 games" at a position => eligibility.
    fielding_summ = (
        fielding
        .groupby(['playerID','yearID', 'POS'], as_index=False)['G']
        .sum()
    )

    # Filter to some minimal threshold (e.g. 20 G).
    fielding_summ = fielding_summ[fielding_summ['G'] >= 20]

    # Since we're summarizing over stints in batting:
    batting_summ = (
        batting
        .groupby(['playerID','yearID'], as_index=False)
        .agg({
            'AB':'sum',
            'R':'sum',
            'H':'sum',
            'HR':'sum',
            'RBI':'sum',
            'SB':'sum',
            'CS':'sum',
            'BB':'sum',
            'SO':'sum',
            'IBB':'sum',
            'HBP':'sum',
            'SH':'sum',
            'SF':'sum',
            'nameFirst': 'first',  # Keep name fields
            'nameLast': 'first',
            'teamID': 'first'      # Take first team if multiple
        })
    )

    # Merge to create one row per player-year-POS
    batting_pos = fielding_summ.merge(
        batting_summ, on=['playerID','yearID'], how='inner'
    )

    # Compute derived stats like AVG, OBP, etc.
    batting_pos['AVG'] = batting_pos['H'] / batting_pos['AB'].replace(0, np.nan)
    batting_pos['AVG'] = batting_pos['AVG'].fillna(0.0)

    # Handle OBP, etc.
    batting_pos['PA'] = (
        batting_pos['AB']
        + batting_pos['BB']
        + batting_pos['HBP'].fillna(0)
        + batting_pos['SF'].fillna(0)
    )
    batting_pos['OBP'] = (
        (batting_pos['H'] + batting_pos['BB'] + batting_pos['HBP'].fillna(0))
        / batting_pos['PA'].replace(0, np.nan)
    ).fillna(0.0)

    return batting_pos


def filter_batting(df: pd.DataFrame,
                   min_AB: int = 250,  # Restored to original value
                   min_HR_or_SB: int = 15) -> pd.DataFrame:  # Restored to original value
    """
    Filter to remove partial or uninteresting seasons:
     - below 250 AB (if no speed/power to compensate),
     - if HR < 15 AND SB < 15, we drop them.
    """
    df['keep_row'] = True
    # If AB < min_AB AND HR < min_HR AND SB < min_SB => drop
    condition = (
        (df['AB'] < min_AB)
        & (df['HR'] < min_HR_or_SB)
        & (df['SB'] < min_HR_or_SB)
    )
    df.loc[condition, 'keep_row'] = False
    return df[df['keep_row'] == True].drop(columns=['keep_row'])


def compute_batting_zscores(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute both 'overall' and 'position-relative' Z-scores for relevant
    counting stats. Then produce an aggregated total Z.
    """
    # Define columns for the 5x5 roto categories plus outs approach
    stats_for_z = ['R','HR','RBI','SB','H']

    # Overall Z-scores (across entire set)
    for col in stats_for_z:
        zname = f'{col}_Z'
        try:
            df[zname] = zscore(df[col].fillna(0))
        except:
            print(f"Warning: Could not calculate Z-score for {col}. Setting to 0.")
            df[zname] = 0

    # "Outs" approach: Outs = AB - H
    df['Outs'] = df['AB'] - df['H']
    try:
        df['Outs_Z'] = zscore(df['Outs'].fillna(0))
    except:
        print("Warning: Could not calculate Z-score for Outs. Setting to 0.")
        df['Outs_Z'] = 0

    # Summation of Z-scores
    df['Total_Z'] = (df['R_Z'] + df['HR_Z'] + df['RBI_Z'] + df['SB_Z'] + df['H_Z']
                     - df['Outs_Z'])

    # Position-relative Z-scores
    for col in stats_for_z + ['Outs']:
        try:
            pos_z = df.groupby('POS')[col].transform(lambda s: zscore(s.fillna(0)))
            df[f'{col}_POS_Z'] = pos_z
        except Exception as e:
            print(f"Warning: Could not calculate position-relative Z-score for {col}: {str(e)}")
            print("Using overall Z-score instead.")
            df[f'{col}_POS_Z'] = df[f'{col}_Z']

    # Combined position-based total
    df['Total_POS_Z'] = (df['R_POS_Z'] + df['HR_POS_Z'] + df['RBI_POS_Z']
                         + df['SB_POS_Z'] + df['H_POS_Z'] - df['Outs_POS_Z'])

    return df


def main_batting_pipeline(data_dir: str):
    """
    Full pipeline for batting data: load, filter, compute Z-scores, return processed data.
    """
    df = load_batting_data(data_dir)
    df = filter_batting(df)
    df = compute_batting_zscores(df)
    
    return df


def load_pitching_data(data_dir: str) -> pd.DataFrame:
    """
    Load and merge Pitching.csv with People.csv.
    Then group by (playerID, yearID) to sum multi-stint data.
    Return one row per pitcher-year.
    """
    # Load Lahman CSVs
    try:
        pitching = pd.read_csv(os.path.join(data_dir, 'Pitching.csv'), encoding='utf-8')
    except UnicodeDecodeError:
        pitching = pd.read_csv(os.path.join(data_dir, 'Pitching.csv'), encoding='latin1')
    
    try:
        people = pd.read_csv(os.path.join(data_dir, 'People.csv'), encoding='utf-8')
    except UnicodeDecodeError:
        people = pd.read_csv(os.path.join(data_dir, 'People.csv'), encoding='latin1')

    # Filter data to start from 1961 as originally intended
    pitching = pitching[pitching['yearID'] >= 1961]
    
    # Check which columns are available
    agg_dict = {}
    for col in ['W', 'L', 'G', 'GS', 'CG', 'SHO', 'SV', 'IPouts', 'IP', 'H', 'ER', 'HR', 'BB', 'IBB', 'SO']:
        if col in pitching.columns:
            agg_dict[col] = 'sum'
    
    if 'teamID' in pitching.columns:
        agg_dict['teamID'] = 'first'  # Take first team if multiple
            
    if not agg_dict:
        raise ValueError("No required columns found in pitching data")
    
    # Basic sum over stints
    pitch_summ = (
        pitching
        .groupby(['playerID','yearID'], as_index=False)
        .agg(agg_dict)
    )
    
    # Print columns to debug
    print("Available columns in pitching data:", pitch_summ.columns.tolist())
    
    # Convert IPouts to IP if it exists (note correct case in Lahman data)
    if 'IPouts' in pitch_summ.columns:
        print("Computing IP from IPouts")
        pitch_summ['IP'] = pitch_summ['IPouts'] / 3.0
    elif 'IP' not in pitch_summ.columns:
        # Neither field exists - serious problem with data
        print("ERROR: Neither IP nor IPouts found in data. Check the source file.")
        raise ValueError("IP or IPouts columns must be present in the pitching data")
    
    # Make sure all required columns exist
    for col in ['W', 'L', 'G', 'GS', 'SV', 'H', 'ER', 'HR', 'BB', 'SO']:
        if col not in pitch_summ.columns:
            print(f"WARNING: Column {col} not found. Adding with default values.")
            pitch_summ[col] = 0

    # Merge basic name info
    pitch_summ = pitch_summ.merge(
        people[['playerID','nameFirst','nameLast']],
        how='left', on='playerID'
    )

    # Calculate ERA - ensure we're using actual IP values
    pitch_summ['ERA'] = np.where(
        pitch_summ['IP'] > 0,
        round((pitch_summ['ER'] * 9) / pitch_summ['IP'], 2),
        99.99
    )
    
    # Calculate WHIP
    pitch_summ['WHIP'] = np.where(
        pitch_summ['IP'] > 0,
        round((pitch_summ['BB'] + pitch_summ['H']) / pitch_summ['IP'], 2),
        99.99
    )
    
    # Print summary stats to verify ERA and WHIP are reasonable
    print(f"ERA summary: Min={pitch_summ['ERA'].min():.2f}, Max={pitch_summ['ERA'].max():.2f}, Mean={pitch_summ['ERA'].mean():.2f}")
    print(f"WHIP summary: Min={pitch_summ['WHIP'].min():.2f}, Max={pitch_summ['WHIP'].max():.2f}, Mean={pitch_summ['WHIP'].mean():.2f}")

    return pitch_summ


def filter_pitching(df: pd.DataFrame,
                    min_innings: float = 40.0,  # Restored to original value
                    min_wins_or_sv: int = 5):  # Restored to original value
    """
    Filter pitchers. If IP < min_innings AND W < min_wins AND SV < min_wins, drop.
    This cuts out minimal usage pitchers.
    """
    # Make sure we have the required columns
    for col in ['IP', 'W', 'SV']:
        if col not in df.columns:
            print(f"WARNING: Column {col} not found in dataframe. Creating with default values.")
            if col == 'IP':
                df[col] = 0.0
            else:
                df[col] = 0
    
    df['keep_row'] = True
    
    # Apply the filter condition
    condition = (
        (df['IP'] < min_innings) &
        (df['W'] < min_wins_or_sv) &
        (df['SV'] < min_wins_or_sv)
    )
    
    df.loc[condition, 'keep_row'] = False
    
    filtered_df = df[df['keep_row'] == True].copy()
    filtered_df = filtered_df.drop(columns=['keep_row'])
    
    print(f"Filtered to {len(filtered_df)} rows after applying criteria")
    
    return filtered_df


def assign_pitcher_positions(df: pd.DataFrame,
                             sp_gs_threshold=10,  # Restored to original value
                             rp_relief_threshold=15):  # Restored to original value
    """
    Determines whether a pitcher is an SP or RP (or both).
    E.g. If GS >= sp_gs_threshold => SP. If (G - GS) >= rp_relief_threshold => RP.
    Return repeated rows if a pitcher qualifies for both.
    """
    # Check if we have the required columns
    required_cols = ['G', 'GS']
    missing_cols = [col for col in required_cols if col not in df.columns]
    
    if missing_cols:
        print(f"WARNING: Missing required columns: {missing_cols}")
        print("Creating default values for missing columns")
        for col in missing_cols:
            if col == 'GS':
                # Default GS to 0 - we'll assume relievers if we don't know
                df['GS'] = 0
            elif col == 'G':
                # Default G to some reasonable value like 20
                df['G'] = 20

    def find_positions(row):
        pos_list = []
        gs = row.get('GS', 0)  # Get GS or default to 0
        g = row.get('G', 0)    # Get G or default to 0
        
        if gs >= sp_gs_threshold:
            pos_list.append('SP')
        if g > 0 and (g - gs) >= rp_relief_threshold:
            pos_list.append('RP')
        if not pos_list:
            # Default to 'P' for generic pitcher if they don't meet thresholds
            pos_list.append('P')
        return pos_list

    # We explode the list of positions into repeated rows
    df['POS_list'] = df.apply(find_positions, axis=1)
    
    print("Position distribution:")
    pos_counts = df['POS_list'].apply(lambda x: ', '.join(x)).value_counts()
    print(pos_counts)
    
    df_exploded = df.explode('POS_list').rename(columns={'POS_list':'POS'})
    
    print(f"Final dataframe has {len(df_exploded)} rows.")
    print("Position distribution in final dataframe:")
    print(df_exploded['POS'].value_counts())
    
    return df_exploded


def compute_pitching_zscores(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute overall and position-relative Z-scores for standard categories:
      W, SV, K, ERA, WHIP
    """
    # Overall log transform for W
    df['W_LOG'] = np.log(df['W'] + 0.001)
    stats_for_z = ['W_LOG','SV','SO','ERA','WHIP','IP']

    # Overall Z-scores
    for col in stats_for_z:
        z_col = f"{col}_Z"
        try:
            df[z_col] = zscore(df[col].fillna(0))
        except:
            print(f"Warning: Could not calculate Z-score for {col}. Setting to 0.")
            df[z_col] = 0

    # Invert ERA and WHIP Z-scores (lower is better)
    df['ERA_Z'] = df['ERA_Z'] * -1.0
    df['WHIP_Z'] = df['WHIP_Z'] * -1.0

    # Weighted sum approach for an overall "Total_Z"
    df['Total_Z'] = (0.7 * (df['W_LOG_Z'] + df['SV_Z'])
                     + df['SO_Z']
                     + 1.0 * df['IP_Z']
                     + 2.0 * df['ERA_Z']
                     + 2.0 * df['WHIP_Z'])

    # Position-relative Z-scores (SP vs RP)
    if len(df['POS'].unique()) > 1:
        for col in stats_for_z:
            try:
                pos_z = df.groupby('POS')[col].transform(lambda s: zscore(s.fillna(0)))
                df[f"{col}_POS_Z"] = pos_z
            except Exception as e:
                print(f"Warning: Could not calculate position-relative Z-score for {col}: {e}")
                print("Using overall Z-score instead.")
                df[f"{col}_POS_Z"] = df[f"{col}_Z"]
    else:
        print("Only one position value found, using overall Z-scores for position Z-scores")
        for col in stats_for_z:
            df[f"{col}_POS_Z"] = df[f"{col}_Z"]
            
    # Invert the ERA and WHIP again
    df['ERA_POS_Z'] = df['ERA_POS_Z'] * -1.0
    df['WHIP_POS_Z'] = df['WHIP_POS_Z'] * -1.0

    # Weighted sum by position
    df['Total_POS_Z'] = (
        0.7*(df['W_LOG_POS_Z'] + df['SV_POS_Z'])
        + df['SO_POS_Z'] + df['IP_POS_Z']
        + 2.0*df['ERA_POS_Z'] + 2.0*df['WHIP_POS_Z']
    )

    return df


def main_pitching_pipeline(data_dir: str):
    """
    Full pipeline for pitching data: load, filter, compute Z-scores, return processed data.
    """
    df = load_pitching_data(data_dir)
    df = filter_pitching(df)
    df = assign_pitcher_positions(df)
    df = compute_pitching_zscores(df)
    
    return df


def prepare_player_data(batting_df, pitching_df):
    """
    Prepare player data for SQLite by reformatting it to match our schema.
    Consolidates positions to reduce database size.
    """
    # Add player type to the dataframes
    batting_df['player_type'] = 'batter'
    pitching_df['player_type'] = 'pitcher'
    
    # Verify Z-scores are present
    print(f"Verifying Z-scores:")
    print(f"  Batters: {batting_df['Total_Z'].count()} Z-scores, {batting_df['Total_POS_Z'].count()} position Z-scores")
    print(f"  Pitchers: {pitching_df['Total_Z'].count()} Z-scores, {pitching_df['Total_POS_Z'].count()} position Z-scores")
    
    # Consolidate positions by player and year
    print("Consolidating batter positions...")
    batting_positions = {}
    batting_best_positions = {}
    
    # Group batting positions
    for _, row in batting_df.iterrows():
        player_id = row['playerID']
        year = row['yearID']
        pos = row['POS']
        z_score = row['Total_POS_Z']
        key = (player_id, year)
        
        if key not in batting_positions:
            batting_positions[key] = []
            batting_best_positions[key] = (pos, z_score, row)
        else:
            batting_positions[key].append(pos)
            # Track the position with the highest Z-score
            if z_score > batting_best_positions[key][1]:
                batting_best_positions[key] = (pos, z_score, row)
    
    # Group pitching positions
    print("Consolidating pitcher positions...")
    pitching_positions = {}
    pitching_best_positions = {}
    
    for _, row in pitching_df.iterrows():
        player_id = row['playerID']
        year = row['yearID']
        pos = row['POS']
        z_score = row['Total_POS_Z']
        key = (player_id, year)
        
        if key not in pitching_positions:
            pitching_positions[key] = []
            pitching_best_positions[key] = (pos, z_score, row)
        else:
            pitching_positions[key].append(pos)
            # Track the position with the highest Z-score
            if z_score > pitching_best_positions[key][1]:
                pitching_best_positions[key] = (pos, z_score, row)
    
    # Create the consolidated player list
    all_players = []
    
    # Process batters
    print(f"Processing {len(batting_best_positions)} batter seasons")
    for key, (primary_pos, _, record) in batting_best_positions.items():
        player_id, year = key
        all_positions = list(set([primary_pos] + batting_positions.get(key, [])))
        all_positions.sort()  # Sort positions alphabetically
        
        # Basic player info
        player = {
            'playerID': player_id,
            'nameFirst': record.get('nameFirst', 'Unknown'),
            'nameLast': record.get('nameLast', 'Player'),
            'primary_position': primary_pos,
            'positions_eligible': ','.join(all_positions),
            'year': int(year),
            'player_type': 'batter',
            'team': record.get('teamID', ''),
            'zScore': float(record.get('Total_Z', 0) or 0),
            'posZScore': float(record.get('Total_POS_Z', 0) or 0),
        }
        
        # Construct stats JSON (minimal version)
        stats = {
            'r': int(record.get('R', 0) or 0),
            'hr': int(record.get('HR', 0) or 0),
            'rb': int(record.get('RBI', 0) or 0),
            'sb': int(record.get('SB', 0) or 0),
            'avg': round(float(record.get('AVG', 0) or 0), 3),
            # Only include essential stats, removing H, AB, BB, OBP
        }
        
        player['stats'] = stats
        all_players.append(player)
    
    # Process pitchers
    print(f"Processing {len(pitching_best_positions)} pitcher seasons")
    na_z_count = 0
    
    for key, (primary_pos, _, record) in pitching_best_positions.items():
        player_id, year = key
        all_positions = list(set([primary_pos] + pitching_positions.get(key, [])))
        all_positions.sort()  # Sort positions alphabetically
        
        # Check for missing Z-scores and warn
        if pd.isna(record.get('Total_Z')):
            na_z_count += 1
            if na_z_count <= 5:  # Only print first 5 warnings
                print(f"WARNING: Missing Total_Z for {player_id} in {year}")
        
        # Basic player info
        player = {
            'playerID': player_id,
            'nameFirst': record.get('nameFirst', 'Unknown'),
            'nameLast': record.get('nameLast', 'Player'),
            'primary_position': primary_pos,
            'positions_eligible': ','.join(all_positions),
            'year': int(year),
            'player_type': 'pitcher',
            'team': record.get('teamID', ''),
            'zScore': float(record.get('Total_Z', 0) or 0),
            'posZScore': float(record.get('Total_POS_Z', 0) or 0),
        }
        
        # Construct stats JSON (minimal version)
        stats = {
            'w': int(record.get('W', 0) or 0),
            'sv': int(record.get('SV', 0) or 0),
            'k': int(record.get('SO', 0) or 0),  # SO is K in Lahman
            'era': round(float(record.get('ERA', 0) or 0), 2),
            'whip': round(float(record.get('WHIP', 0) or 0), 2),
            # Only include essential stats, removing IP, G, GS, L
        }
        
        player['stats'] = stats
        all_players.append(player)
    
    if na_z_count > 0:
        print(f"WARNING: {na_z_count} pitcher records have missing Z-scores")
    
    print(f"Prepared {len(all_players)} total player records (consolidated from multi-position eligibility)")
    return all_players


def insert_players_to_sqlite(players, db_path):
    """
    Insert player data into SQLite database
    """
    import json
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Insert each player
    count = 0
    for player in players:
        # Convert stats dict to JSON string
        stats_json = json.dumps(player['stats'])
        
        cursor.execute(
            '''INSERT INTO players 
               (playerID, nameFirst, nameLast, primary_position, positions_eligible, 
                year, player_type, team, zScore, posZScore, stats)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (
                player['playerID'],
                player['nameFirst'],
                player['nameLast'],
                player['primary_position'],
                player['positions_eligible'],
                player['year'],
                player['player_type'],
                player['team'],
                player['zScore'],
                player['posZScore'],
                stats_json
            )
        )
        
        count += 1
        if count % 1000 == 0:
            print(f"Inserted {count}/{len(players)} records...")
            conn.commit()  # Commit every 1000 records for performance
    
    # Final commit
    conn.commit()
    conn.close()
    
    print(f"Successfully inserted {count} player records into SQLite database")
    return count


def main():
    """
    Main function to process data and store in SQLite
    """
    if len(sys.argv) < 2:
        print("Usage: python preprocess-to-sqlite.py <data_directory> [output_db_path]")
        return False
    
    data_directory = sys.argv[1]
    
    # Default output DB path if not provided
    output_db = sys.argv[2] if len(sys.argv) > 2 else os.path.join(data_directory, 'retromatic.db')
    
    # Create the SQLite database
    create_sqlite_db(output_db)
    
    # Process batting data
    print("\n=== Processing batting data ===")
    batting_df = main_batting_pipeline(data_directory)
    print(f"Processed {len(batting_df)} batting records")
    
    # Process pitching data
    print("\n=== Processing pitching data ===")
    pitching_df = main_pitching_pipeline(data_directory)
    print(f"Processed {len(pitching_df)} pitching records")
    
    # Prepare data for SQLite
    print("\n=== Preparing data for SQLite ===")
    prepared_players = prepare_player_data(batting_df, pitching_df)
    
    # Insert data into SQLite
    print("\n=== Inserting data into SQLite ===")
    insert_players_to_sqlite(prepared_players, output_db)
    
    print(f"\n=== Data processing complete ===")
    
    # Compress the database
    print("Compressing the database with VACUUM...")
    conn = sqlite3.connect(output_db)
    conn.execute("VACUUM")
    conn.close()
    
    # Get the final file size
    import os
    db_size_mb = os.path.getsize(output_db) / (1024 * 1024)
    
    print(f"SQLite database saved to: {output_db}")
    print(f"Total records: {len(prepared_players)}")
    print(f"Final database size: {db_size_mb:.2f} MB")
    
    return True


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)