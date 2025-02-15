import pandas as pd
import numpy as np
import os
from scipy.stats import zscore

def load_pitching_data(data_dir: str) -> pd.DataFrame:
    """
    Load and merge Pitching.csv with People.csv.
    Then group by (playerID, yearID) to sum multi-stint data.
    Return one row per pitcher-year.
    """
    # Load Lahman CSVs - try different encodings since there are special characters in the data
    try:
        pitching = pd.read_csv(os.path.join(data_dir, 'Pitching.csv'), encoding='utf-8')
    except UnicodeDecodeError:
        pitching = pd.read_csv(os.path.join(data_dir, 'Pitching.csv'), encoding='latin1')
    
    try:
        people = pd.read_csv(os.path.join(data_dir, 'People.csv'), encoding='utf-8')
    except UnicodeDecodeError:
        people = pd.read_csv(os.path.join(data_dir, 'People.csv'), encoding='latin1')

    # Print column names to help with debugging
    print("Pitching columns:", pitching.columns.tolist())
    
    # Check which columns are available
    agg_dict = {}
    for col in ['W', 'L', 'G', 'GS', 'CG', 'SHO', 'SV', 'IPOuts', 'IP', 'H', 'ER', 'HR', 'BB', 'IBB', 'SO']:
        if col in pitching.columns:
            agg_dict[col] = 'sum'
    
    if not agg_dict:
        raise ValueError("No required columns found in pitching data")
    
    print("Using columns for aggregation:", list(agg_dict.keys()))
    
    # Basic sum over stints
    pitch_summ = (
        pitching
        .groupby(['playerID','yearID'], as_index=False)
        .agg(agg_dict)
    )
    
    # Check if we need to calculate IP from IPOuts or vice versa
    if 'IP' in pitch_summ.columns and 'IPOuts' not in pitch_summ.columns:
        print("Converting IP to IPOuts")
        pitch_summ['IPOuts'] = pitch_summ['IP'] * 3
    elif 'IPOuts' in pitch_summ.columns and 'IP' not in pitch_summ.columns:
        print("Computing IP from IPOuts")
        pitch_summ['IP'] = pitch_summ['IPOuts'] / 3.0
    else:
        # If neither exists, create a default IP
        print("WARNING: Neither IP nor IPOuts found. Creating default values.")
        pitch_summ['IP'] = 50.0  # Default to a reasonable number of innings
        pitch_summ['IPOuts'] = pitch_summ['IP'] * 3
    
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

    # Compute derived stats (ERA, WHIP, etc.)
    # IP should already be set from above code
    
    # Ensure ER is available
    if 'ER' not in pitch_summ.columns:
        print("WARNING: ER column not found. Using a default value.")
        pitch_summ['ER'] = 0
    
    # Calculate ERA
    pitch_summ['ERA'] = np.where(
        pitch_summ['IP'] > 0,
        round((pitch_summ['ER'] * 9) / pitch_summ['IP'], 3),
        99.99
    )
    
    # Ensure BB and H are available
    if 'BB' not in pitch_summ.columns:
        print("WARNING: BB column not found. Using a default value.")
        pitch_summ['BB'] = 0
    
    if 'H' not in pitch_summ.columns:
        print("WARNING: H column not found. Using a default value.")
        pitch_summ['H'] = 0
    
    # Calculate WHIP
    pitch_summ['WHIP'] = np.where(
        pitch_summ['IP'] > 0,
        round((pitch_summ['BB'] + pitch_summ['H']) / pitch_summ['IP'], 3),
        99.99
    )

    return pitch_summ


def filter_pitching(df: pd.DataFrame,
                    min_innings: float = 40.0,
                    min_wins_or_sv: int = 5):
    """
    Example filter. If IP < min_innings AND W < min_wins AND SV < min_wins, drop.
    This cuts out minimal usage pitchers.
    """
    print(f"Starting with {len(df)} rows before filtering")
    
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
    print(f"Removed {len(df) - len(filtered_df)} rows")
    
    return filtered_df


def assign_pitcher_positions(df: pd.DataFrame,
                             sp_gs_threshold=10,
                             rp_relief_threshold=15):
    """
    Determines whether a pitcher is an SP or RP (or both).
    E.g. If GS >= sp_gs_threshold => SP. If (G - GS) >= rp_relief_threshold => RP.
    Return repeated rows if a pitcher qualifies for both, or store them in a single column.
    """
    print(f"Starting pitcher position assignment. DataFrame has {len(df)} rows.")
    print(f"Sample of first few rows: {df.head(2)}")
    print(f"Columns: {df.columns.tolist()}")
    
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
    print("Assigning positions to pitchers...")
    df['POS_list'] = df.apply(find_positions, axis=1)
    
    print("Position distribution:")
    pos_counts = df['POS_list'].apply(lambda x: ', '.join(x)).value_counts()
    print(pos_counts)
    
    print("Exploding position list into rows...")
    df_exploded = df.explode('POS_list').rename(columns={'POS_list':'POS'})
    
    # Keep all pitchers, even if they don't meet SP or RP thresholds
    # They'll be labeled as 'P' instead of 'Unknown'
    print(f"Final dataframe has {len(df_exploded)} rows.")
    print("Position distribution in final dataframe:")
    print(df_exploded['POS'].value_counts())
    
    return df_exploded


def compute_pitching_zscores(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute overall and position-relative Z-scores for some standard categories:
      W, SV, K, ERA, WHIP
    Possibly incorporate a weighting approach for SP vs RP.
    """
    # For ERA and WHIP, we might invert them so that "lower" => higher Z
    # but a simpler approach is to zscore them normally, then multiply by -1.
    # Or we can do a direct zscore.
    # Let’s do a combined approach like in your notebook.

    # Overall log transform for W if you like
    df['W_LOG'] = np.log(df['W'] + 0.001)
    stats_for_z = ['W_LOG','SV','SO','ERA','WHIP','IP']
    # IP or IPOuts might help you weigh the significance.

    # Overall
    for col in stats_for_z:
        z_col = f"{col}_Z"
        try:
            df[z_col] = zscore(df[col].fillna(0))
        except:
            print(f"Warning: Could not calculate Z-score for {col}. Setting to 0.")
            df[z_col] = 0

    # In some fantasy contexts, low ERA / low WHIP => "positive." 
    # So we might invert them:
    df['ERA_Z'] = df['ERA_Z'] * -1.0
    df['WHIP_Z'] = df['WHIP_Z'] * -1.0

    # Weighted sum approach for an overall "Total_Z"
    # e.g. weighting IP so that heavier usage is more valuable
    # This is just an example:
    df['Total_Z'] = (0.7 * (df['W_LOG_Z'] + df['SV_Z'])
                     + df['SO_Z']
                     + 1.0 * df['IP_Z']
                     + 2.0 * df['ERA_Z']
                     + 2.0 * df['WHIP_Z'])

    # Check if there's a POS column
    if 'POS' not in df.columns:
        print("ERROR: POS column not found in dataframe.")
        print("Available columns:", df.columns.tolist())
        print("Adding POS column with a default value of 'P'")
        df['POS'] = 'P'
        
    # Now for position-relative (SP vs RP)
    print("Calculating position-relative Z-scores")
    print("Position counts:", df['POS'].value_counts())
    
    # Only proceed with groupby if we have multiple position values
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


def save_final_pitching(df: pd.DataFrame, out_file='PitchingProcessed.csv'):
    """
    Saves the final DataFrame to CSV or JSON. Or could use DB connection for direct insert.
    """
    if out_file.endswith('.json'):
        # Convert to JSON with desired format
        result = df.to_dict(orient='records')
        with open(out_file, 'w') as f:
            import json
            json.dump(result, f, indent=2)
    else:
        df.to_csv(out_file, index=False)


def main_pitching_pipeline(data_dir: str, out_file: str = None):
    """
    Full pipeline for pitching data: load, filter, compute Z-scores, save.
    """
    df = load_pitching_data(data_dir)
    df = filter_pitching(df)
    df = assign_pitcher_positions(df)
    df = compute_pitching_zscores(df)
    
    if not out_file:
        out_file = os.path.join(data_dir, 'PitchingProcessed.csv')
        
    save_final_pitching(df, out_file=out_file)
    print(f"Saved final pitching data to {out_file}")
    
    return df


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python preprocess-pitching.py <data_directory> [output_file]")
        sys.exit(1)
    
    data_directory = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else None
    
    main_pitching_pipeline(data_directory, output_file)
