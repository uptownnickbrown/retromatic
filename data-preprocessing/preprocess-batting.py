import pandas as pd
import numpy as np
import os
from scipy.stats import zscore

# -------------------------------------------------------------------------
# 1) LOAD & MERGE BATTING, FIELDING, PEOPLE (OPTIONALLY TEAMS)
# -------------------------------------------------------------------------
def load_batting_data(data_dir: str) -> pd.DataFrame:
    """
    Loads Batting.csv and merges with Fielding.csv to determine
    position eligibility, plus merges People.csv to attach basic name info.
    Returns a DataFrame of 'playerID', 'yearID', 'stint', plus key batting
    stats, plus a multi-valued 'positions' field or repeated rows for each
    position.
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

    # Basic join to People so we have name info if needed
    batting = batting.merge(
        people[['playerID','nameFirst','nameLast']],
        how='left', on='playerID'
    )

    # Print the columns to help with debugging
    print("Fielding columns:", fielding.columns.tolist())
    
    # Use POS directly
    # Summarize fielding to find eligibility
    # E.g. "at least 20 games" at a position => eligibility.
    fielding_summ = (
        fielding
        .groupby(['playerID','yearID', 'POS'], as_index=False)['G']
        .sum()
    )

    # Filter to some minimal threshold (e.g. 20 G).
    fielding_summ = fielding_summ[fielding_summ['G'] >= 20]

    # We still have multiple positions per player-year. We'll keep them
    # if we want repeated rows for each position, OR we can store in a list.
    # Below, we flatten them so that for each (playerID, yearID, POS), we
    # merge with the batting stats.
    # However, that means we must sum over stints in batting:
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
            'SF':'sum'
        })
    )

    # Merge to create one row per player-year-POS
    batting_pos = fielding_summ.merge(
        batting_summ, on=['playerID','yearID'], how='inner'
    )

    # Now we can compute derived stats like AVG, OBP, etc.
    # ...
    batting_pos['AVG'] = batting_pos['H'] / batting_pos['AB'].replace(0, np.nan)
    # Safely fill or handle zero AB
    batting_pos['AVG'] = batting_pos['AVG'].fillna(0.0)

    # Example: handle OBP, etc.
    batting_pos['PA'] = (
        batting_pos['AB']
        + batting_pos['BB']
        + batting_pos['HBP']
        + batting_pos['SF'].fillna(0)
    )
    batting_pos['OBP'] = (
        (batting_pos['H'] + batting_pos['BB'] + batting_pos['HBP'])
        / batting_pos['PA'].replace(0, np.nan)
    ).fillna(0.0)

    # Merge name fields if you want them in final output
    # (We only have nameFirst/nameLast from the initial merge with batting)

    return batting_pos


# -------------------------------------------------------------------------
# 2) FILTER / EXCLUDE LOW-SAMPLE SEASONS
# -------------------------------------------------------------------------
def filter_batting(df: pd.DataFrame,
                   min_AB: int = 250,
                   min_HR_or_SB: int = 15) -> pd.DataFrame:
    """
    Example filter to remove partial or uninteresting seasons:
     - below 250 AB (if no speed/power to compensate),
     - if HR < 15 AND SB < 15, we drop them.
    You can tweak these rules at will.
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


# -------------------------------------------------------------------------
# 3) COMPUTE Z-SCORES
# -------------------------------------------------------------------------
def compute_batting_zscores(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute both 'overall' and 'position-relative' Z-scores for relevant
    counting stats. Then produce an aggregated total Z if desired.
    """

    # We might define these columns for the 5x5 roto categories plus
    # some extras for your "outs" approach
    stats_for_z = ['R','HR','RBI','SB','H']   # example
    # 'H' is a stand-in for "raw hits" – we can also do batting average differently

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

    # Summation of Z-scores as a naive approach:
    df['Total_Z'] = (df['R_Z'] + df['HR_Z'] + df['RBI_Z'] + df['SB_Z'] + df['H_Z']
                     - df['Outs_Z'])

    # Position-relative Z-scores
    # We'll groupby 'POS' and transform each stat
    for col in stats_for_z + ['Outs']:
        try:
            pos_z = df.groupby('POS')[col].transform(lambda s: zscore(s.fillna(0)))
            df[f'{col}_POS_Z'] = pos_z
        except Exception as e:
            print(f"Warning: Could not calculate position-relative Z-score for {col}: {str(e)}")
            print("Using overall Z-score instead.")
            df[f'{col}_POS_Z'] = df[f'{col}_Z']

    # Example combined position-based total
    df['Total_POS_Z'] = (df['R_POS_Z'] + df['HR_POS_Z'] + df['RBI_POS_Z']
                         + df['SB_POS_Z'] + df['H_POS_Z'] - df['Outs_POS_Z'])

    return df


# -------------------------------------------------------------------------
# 4) WRITE TO CSV OR DIRECTLY TO DB
# -------------------------------------------------------------------------
def save_final_batting(df: pd.DataFrame, out_file: str = 'BattingProcessed.csv'):
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


def main_batting_pipeline(data_dir: str, out_file: str = None):
    """
    Full pipeline for batting data: load, filter, compute Z-scores, save.
    """
    df = load_batting_data(data_dir)
    df = filter_batting(df)
    df = compute_batting_zscores(df)
    
    if not out_file:
        out_file = os.path.join(data_dir, 'BattingProcessed.csv')
    
    save_final_batting(df, out_file=out_file)
    print(f"Saved final batting data to {out_file}")
    
    return df


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python preprocess-batting.py <data_directory> [output_file]")
        sys.exit(1)
    
    data_directory = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else None
    
    main_batting_pipeline(data_directory, output_file)
