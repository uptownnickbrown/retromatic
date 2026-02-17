#!/usr/bin/env python3
"""
Retromatic Data Pipeline - PostgreSQL Version
Processes Lahman baseball data and loads it into PostgreSQL.
"""

import pandas as pd
import numpy as np
import os
import sys
import json
import psycopg2
from psycopg2.extras import execute_values
from scipy.stats import zscore
from urllib.parse import urlparse


def get_db_connection(database_url: str = None):
    """
    Create a PostgreSQL database connection.
    """
    if database_url is None:
        database_url = os.environ.get(
            'DATABASE_URL',
            'postgresql://retromatic:retromatic_dev@localhost:5432/retromatic'
        )

    result = urlparse(database_url)
    conn = psycopg2.connect(
        database=result.path[1:],
        user=result.username,
        password=result.password,
        host=result.hostname,
        port=result.port
    )
    return conn


def create_tables(conn):
    """
    Create necessary tables if they don't exist.
    """
    cursor = conn.cursor()

    # Create players table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS players (
        id SERIAL PRIMARY KEY,
        player_id VARCHAR(20) NOT NULL,
        name_first VARCHAR(100),
        name_last VARCHAR(100),
        year INTEGER NOT NULL,
        team VARCHAR(10),
        player_type VARCHAR(10) NOT NULL,
        primary_position VARCHAR(10) NOT NULL,
        positions_eligible VARCHAR(50) NOT NULL,
        stats JSONB NOT NULL,
        z_score_overall DECIMAL(8, 4) NOT NULL,
        z_score_position DECIMAL(8, 4) NOT NULL,
        category_zscores JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
    )
    ''')

    # Create indexes
    cursor.execute('''
    CREATE INDEX IF NOT EXISTS idx_players_player_id_year
    ON players(player_id, year)
    ''')

    cursor.execute('''
    CREATE INDEX IF NOT EXISTS idx_players_name
    ON players(name_last, name_first)
    ''')

    cursor.execute('''
    CREATE INDEX IF NOT EXISTS idx_players_year
    ON players(year)
    ''')

    cursor.execute('''
    CREATE INDEX IF NOT EXISTS idx_players_type_position
    ON players(player_type, primary_position)
    ''')

    # Create team_pool table for simulated teams
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS team_pool (
        id SERIAL PRIMARY KEY,
        draft_id INTEGER,
        is_simulated BOOLEAN DEFAULT false,
        category_totals JSONB NOT NULL,
        total_score VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
    )
    ''')

    cursor.execute('''
    CREATE INDEX IF NOT EXISTS idx_team_pool_category
    ON team_pool USING GIN (category_totals)
    ''')

    # Create drafts table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS drafts (
        id SERIAL PRIMARY KEY,
        guest_token VARCHAR(100),
        status VARCHAR(20) DEFAULT 'in_progress',
        total_score VARCHAR(20),
        percentile INTEGER,
        category_scores JSONB,
        ai_commentary TEXT,
        roto_placement INTEGER,
        win_loss_record VARCHAR(20),
        outlier_facts JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP
    )
    ''')

    # Create picks table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS picks (
        id SERIAL PRIMARY KEY,
        draft_id INTEGER REFERENCES drafts(id),
        player_id INTEGER REFERENCES players(id),
        roster_slot VARCHAR(10) NOT NULL,
        pick_order INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
    )
    ''')

    conn.commit()
    print("Tables created successfully")


def load_batting_data(data_dir: str) -> pd.DataFrame:
    """
    Loads Batting.csv and merges with Fielding.csv to determine
    position eligibility, plus merges People.csv to attach basic name info.
    """
    # Load Lahman CSVs
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

    # Filter data to start from 1961, MLB leagues only (AL/NL)
    batting = batting[batting['yearID'] >= 1961]
    fielding = fielding[fielding['yearID'] >= 1961]
    batting = batting[batting['lgID'].isin(['AL', 'NL'])]
    fielding = fielding[fielding['lgID'].isin(['AL', 'NL'])]
    print(f"  Batting: {len(batting)} rows, years {batting['yearID'].min()}-{batting['yearID'].max()}, leagues {sorted(batting['lgID'].unique())}")
    print(f"  Fielding: {len(fielding)} rows, years {fielding['yearID'].min()}-{fielding['yearID'].max()}")

    # Basic join to People for name info
    batting = batting.merge(
        people[['playerID', 'nameFirst', 'nameLast']],
        how='left', on='playerID'
    )

    # Summarize fielding to find eligibility (at least 20 games at position)
    fielding_summ = (
        fielding
        .groupby(['playerID', 'yearID', 'POS'], as_index=False)['G']
        .sum()
    )
    fielding_summ = fielding_summ[fielding_summ['G'] >= 20]

    # Summarize batting over stints
    batting_summ = (
        batting
        .groupby(['playerID', 'yearID'], as_index=False)
        .agg({
            'AB': 'sum',
            'R': 'sum',
            'H': 'sum',
            'HR': 'sum',
            'RBI': 'sum',
            'SB': 'sum',
            'CS': 'sum',
            'BB': 'sum',
            'SO': 'sum',
            'IBB': 'sum',
            'HBP': 'sum',
            'SH': 'sum',
            'SF': 'sum',
            'nameFirst': 'first',
            'nameLast': 'first',
            'teamID': 'first'
        })
    )

    # Merge to create one row per player-year-POS
    batting_pos = fielding_summ.merge(
        batting_summ, on=['playerID', 'yearID'], how='inner'
    )

    # Add UTIL position for DH-only batters (no fielding position with 20+ games)
    has_pos = batting_pos[['playerID', 'yearID']].drop_duplicates()
    has_pos['_has_pos'] = True
    util_batters = batting_summ.merge(has_pos, on=['playerID', 'yearID'], how='left')
    util_batters = util_batters[util_batters['_has_pos'].isna()].drop(columns=['_has_pos']).copy()
    if len(util_batters) > 0:
        util_batters['POS'] = 'UTIL'
        util_batters['G'] = 0  # No fielding games
        batting_pos = pd.concat([batting_pos, util_batters], ignore_index=True)
        print(f"  Added {len(util_batters)} UTIL (DH-only) batter-seasons")

    # Compute derived stats
    batting_pos['AVG'] = batting_pos['H'] / batting_pos['AB'].replace(0, np.nan)
    batting_pos['AVG'] = batting_pos['AVG'].fillna(0.0)

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


def filter_batting(df: pd.DataFrame, min_AB: int = 250, min_HR_or_SB: int = 15) -> pd.DataFrame:
    """
    Filter to remove partial seasons.
    """
    df['keep_row'] = True
    condition = (
        (df['AB'] < min_AB)
        & (df['HR'] < min_HR_or_SB)
        & (df['SB'] < min_HR_or_SB)
    )
    df.loc[condition, 'keep_row'] = False
    return df[df['keep_row'] == True].drop(columns=['keep_row'])


def compute_batting_zscores(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute both 'overall' and 'position-relative' Z-scores for batting stats.
    """
    stats_for_z = ['R', 'HR', 'RBI', 'SB', 'H']

    # Overall Z-scores
    for col in stats_for_z:
        zname = f'{col}_Z'
        try:
            df[zname] = zscore(df[col].fillna(0))
        except:
            df[zname] = 0

    # "Outs" approach: Outs = AB - H
    df['Outs'] = df['AB'] - df['H']
    try:
        df['Outs_Z'] = zscore(df['Outs'].fillna(0))
    except:
        df['Outs_Z'] = 0

    # Summation of Z-scores
    df['Total_Z'] = (
        df['R_Z'] + df['HR_Z'] + df['RBI_Z'] + df['SB_Z'] + df['H_Z'] - df['Outs_Z']
    )

    # Position-relative Z-scores
    for col in stats_for_z + ['Outs']:
        try:
            pos_z = df.groupby('POS')[col].transform(lambda s: zscore(s.fillna(0)))
            df[f'{col}_POS_Z'] = pos_z
        except:
            df[f'{col}_POS_Z'] = df[f'{col}_Z']

    # Combined position-based total
    df['Total_POS_Z'] = (
        df['R_POS_Z'] + df['HR_POS_Z'] + df['RBI_POS_Z']
        + df['SB_POS_Z'] + df['H_POS_Z'] - df['Outs_POS_Z']
    )

    return df


def main_batting_pipeline(data_dir: str):
    """
    Full pipeline for batting data.
    """
    df = load_batting_data(data_dir)
    df = filter_batting(df)
    df = compute_batting_zscores(df)
    return df


def load_pitching_data(data_dir: str) -> pd.DataFrame:
    """
    Load and merge Pitching.csv with People.csv.
    """
    try:
        pitching = pd.read_csv(os.path.join(data_dir, 'Pitching.csv'), encoding='utf-8')
    except UnicodeDecodeError:
        pitching = pd.read_csv(os.path.join(data_dir, 'Pitching.csv'), encoding='latin1')

    try:
        people = pd.read_csv(os.path.join(data_dir, 'People.csv'), encoding='utf-8')
    except UnicodeDecodeError:
        people = pd.read_csv(os.path.join(data_dir, 'People.csv'), encoding='latin1')

    # Filter data to start from 1961, MLB leagues only (AL/NL)
    pitching = pitching[pitching['yearID'] >= 1961]
    pitching = pitching[pitching['lgID'].isin(['AL', 'NL'])]
    print(f"  Pitching: {len(pitching)} rows, years {pitching['yearID'].min()}-{pitching['yearID'].max()}, leagues {sorted(pitching['lgID'].unique())}")

    agg_dict = {}
    for col in ['W', 'L', 'G', 'GS', 'CG', 'SHO', 'SV', 'IPouts', 'IP', 'H', 'ER', 'HR', 'BB', 'IBB', 'SO']:
        if col in pitching.columns:
            agg_dict[col] = 'sum'

    if 'teamID' in pitching.columns:
        agg_dict['teamID'] = 'first'

    # Sum over stints
    pitch_summ = (
        pitching
        .groupby(['playerID', 'yearID'], as_index=False)
        .agg(agg_dict)
    )

    # Convert IPouts to IP if needed
    if 'IPouts' in pitch_summ.columns:
        pitch_summ['IP'] = pitch_summ['IPouts'] / 3.0

    for col in ['W', 'L', 'G', 'GS', 'SV', 'H', 'ER', 'HR', 'BB', 'SO']:
        if col not in pitch_summ.columns:
            pitch_summ[col] = 0

    pitch_summ = pitch_summ.merge(
        people[['playerID', 'nameFirst', 'nameLast']],
        how='left', on='playerID'
    )

    # Calculate ERA
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

    return pitch_summ


def filter_pitching(df: pd.DataFrame, min_innings: float = 40.0, min_wins_or_sv: int = 5):
    """
    Filter pitchers by minimum innings or wins/saves.
    """
    for col in ['IP', 'W', 'SV']:
        if col not in df.columns:
            df[col] = 0 if col != 'IP' else 0.0

    df['keep_row'] = True
    condition = (
        (df['IP'] < min_innings) &
        (df['W'] < min_wins_or_sv) &
        (df['SV'] < min_wins_or_sv)
    )
    df.loc[condition, 'keep_row'] = False

    filtered_df = df[df['keep_row'] == True].copy()
    return filtered_df.drop(columns=['keep_row'])


def assign_pitcher_positions(df: pd.DataFrame, sp_gs_threshold=10, rp_relief_threshold=15):
    """
    Determines whether a pitcher is SP or RP (or both).
    """
    if 'GS' not in df.columns:
        df['GS'] = 0
    if 'G' not in df.columns:
        df['G'] = 20

    def find_positions(row):
        pos_list = []
        gs = row.get('GS', 0)
        g = row.get('G', 0)

        if gs >= sp_gs_threshold:
            pos_list.append('SP')
        if g > 0 and (g - gs) >= rp_relief_threshold:
            pos_list.append('RP')
        if not pos_list:
            pos_list.append('P')
        return pos_list

    df['POS_list'] = df.apply(find_positions, axis=1)
    df_exploded = df.explode('POS_list').rename(columns={'POS_list': 'POS'})

    return df_exploded


def compute_pitching_zscores(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute overall and position-relative Z-scores for pitching stats.
    """
    df['W_LOG'] = np.log(df['W'] + 0.001)
    stats_for_z = ['W_LOG', 'SV', 'SO', 'ERA', 'WHIP', 'IP']

    for col in stats_for_z:
        z_col = f"{col}_Z"
        try:
            df[z_col] = zscore(df[col].fillna(0))
        except:
            df[z_col] = 0

    # Invert ERA and WHIP (lower is better)
    df['ERA_Z'] = df['ERA_Z'] * -1.0
    df['WHIP_Z'] = df['WHIP_Z'] * -1.0

    # Weighted sum for overall Z
    df['Total_Z'] = (
        0.7 * (df['W_LOG_Z'] + df['SV_Z'])
        + df['SO_Z']
        + 1.0 * df['IP_Z']
        + 2.0 * df['ERA_Z']
        + 2.0 * df['WHIP_Z']
    )

    # Position-relative Z-scores
    if len(df['POS'].unique()) > 1:
        for col in stats_for_z:
            try:
                pos_z = df.groupby('POS')[col].transform(lambda s: zscore(s.fillna(0)))
                df[f"{col}_POS_Z"] = pos_z
            except:
                df[f"{col}_POS_Z"] = df[f"{col}_Z"]
    else:
        for col in stats_for_z:
            df[f"{col}_POS_Z"] = df[f"{col}_Z"]

    # Invert again for position z-scores
    df['ERA_POS_Z'] = df['ERA_POS_Z'] * -1.0
    df['WHIP_POS_Z'] = df['WHIP_POS_Z'] * -1.0

    df['Total_POS_Z'] = (
        0.7 * (df['W_LOG_POS_Z'] + df['SV_POS_Z'])
        + df['SO_POS_Z'] + df['IP_POS_Z']
        + 2.0 * df['ERA_POS_Z'] + 2.0 * df['WHIP_POS_Z']
    )

    return df


def main_pitching_pipeline(data_dir: str):
    """
    Full pipeline for pitching data.
    """
    df = load_pitching_data(data_dir)
    df = filter_pitching(df)
    df = assign_pitcher_positions(df)
    df = compute_pitching_zscores(df)
    return df


def prepare_player_data(batting_df, pitching_df):
    """
    Prepare player data for PostgreSQL.
    """
    # Consolidate positions by player and year
    print("Consolidating batter positions...")
    batting_positions = {}
    batting_best_positions = {}

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
            if z_score > batting_best_positions[key][1]:
                batting_best_positions[key] = (pos, z_score, row)

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
            if z_score > pitching_best_positions[key][1]:
                pitching_best_positions[key] = (pos, z_score, row)

    all_players = []

    # Process batters
    print(f"Processing {len(batting_best_positions)} batter seasons")
    for key, (primary_pos, _, record) in batting_best_positions.items():
        player_id, year = key
        all_positions = list(set([primary_pos] + batting_positions.get(key, [])))
        all_positions.sort()

        # Stats in uppercase for consistency with backend
        stats = {
            'R': int(record.get('R', 0) or 0),
            'HR': int(record.get('HR', 0) or 0),
            'RBI': int(record.get('RBI', 0) or 0),
            'SB': int(record.get('SB', 0) or 0),
            'H': int(record.get('H', 0) or 0),
            'AB': int(record.get('AB', 0) or 0),
            'AVG': round(float(record.get('AVG', 0) or 0), 3),
            'BB': int(record.get('BB', 0) or 0),
        }

        # Category z-scores for detailed breakdown
        category_zscores = {
            'R': float(record.get('R_Z', 0) or 0),
            'HR': float(record.get('HR_Z', 0) or 0),
            'RBI': float(record.get('RBI_Z', 0) or 0),
            'SB': float(record.get('SB_Z', 0) or 0),
            'H': float(record.get('H_Z', 0) or 0),
        }

        player = {
            'player_id': player_id,
            'name_first': record.get('nameFirst', 'Unknown'),
            'name_last': record.get('nameLast', 'Player'),
            'year': int(year),
            'team': record.get('teamID', ''),
            'player_type': 'batter',
            'primary_position': primary_pos,
            'positions_eligible': ','.join(all_positions),
            'stats': stats,
            'z_score_overall': float(record.get('Total_Z', 0) or 0),
            'z_score_position': float(record.get('Total_POS_Z', 0) or 0),
            'category_zscores': category_zscores,
        }

        all_players.append(player)

    # Process pitchers
    print(f"Processing {len(pitching_best_positions)} pitcher seasons")
    for key, (primary_pos, _, record) in pitching_best_positions.items():
        player_id, year = key
        all_positions = list(set([primary_pos] + pitching_positions.get(key, [])))
        all_positions.sort()

        stats = {
            'W': int(record.get('W', 0) or 0),
            'SV': int(record.get('SV', 0) or 0),
            'K': int(record.get('SO', 0) or 0),
            'SO': int(record.get('SO', 0) or 0),
            'ERA': round(float(record.get('ERA', 0) or 0), 2),
            'WHIP': round(float(record.get('WHIP', 0) or 0), 2),
            'IP': round(float(record.get('IP', 0) or 0), 1),
            'G': int(record.get('G', 0) or 0),
            'GS': int(record.get('GS', 0) or 0),
            'H': int(record.get('H', 0) or 0),
            'BB': int(record.get('BB', 0) or 0),
            'ER': int(record.get('ER', 0) or 0),
        }

        category_zscores = {
            'W': float(record.get('W_LOG_Z', 0) or 0),
            'SV': float(record.get('SV_Z', 0) or 0),
            'K': float(record.get('SO_Z', 0) or 0),
            'ERA': float(record.get('ERA_Z', 0) or 0),
            'WHIP': float(record.get('WHIP_Z', 0) or 0),
        }

        player = {
            'player_id': player_id,
            'name_first': record.get('nameFirst', 'Unknown'),
            'name_last': record.get('nameLast', 'Player'),
            'year': int(year),
            'team': record.get('teamID', ''),
            'player_type': 'pitcher',
            'primary_position': primary_pos,
            'positions_eligible': ','.join(all_positions),
            'stats': stats,
            'z_score_overall': float(record.get('Total_Z', 0) or 0),
            'z_score_position': float(record.get('Total_POS_Z', 0) or 0),
            'category_zscores': category_zscores,
        }

        all_players.append(player)

    print(f"Prepared {len(all_players)} total player records")
    return all_players


def insert_players_to_postgres(players, conn):
    """
    Insert player data into PostgreSQL database using batch insert.
    """
    cursor = conn.cursor()

    # Clear existing data
    cursor.execute("TRUNCATE players RESTART IDENTITY CASCADE")

    # Prepare data for batch insert
    values = []
    for player in players:
        values.append((
            player['player_id'],
            player['name_first'],
            player['name_last'],
            player['year'],
            player['team'],
            player['player_type'],
            player['primary_position'],
            player['positions_eligible'],
            json.dumps(player['stats']),
            player['z_score_overall'],
            player['z_score_position'],
            json.dumps(player['category_zscores']),
        ))

    # Batch insert
    execute_values(
        cursor,
        '''INSERT INTO players
           (player_id, name_first, name_last, year, team, player_type,
            primary_position, positions_eligible, stats, z_score_overall,
            z_score_position, category_zscores)
           VALUES %s''',
        values,
        page_size=1000
    )

    conn.commit()
    print(f"Successfully inserted {len(players)} player records into PostgreSQL")
    return len(players)


def get_elite_pool(conn, positions_per_type=250):
    """
    Get the top ~250 player-seasons per position by position z-score.
    These form the "elite pool" for generating simulated teams.
    """
    cursor = conn.cursor()

    elite_pool = {}

    # Batting positions
    batting_positions = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF']
    for pos in batting_positions:
        cursor.execute('''
            SELECT id, player_id, name_first, name_last, year, stats, z_score_position
            FROM players
            WHERE player_type = 'batter'
              AND positions_eligible LIKE %s
            ORDER BY z_score_position DESC
            LIMIT %s
        ''', (f'%{pos}%', positions_per_type))

        elite_pool[pos] = cursor.fetchall()
        print(f"  {pos}: {len(elite_pool[pos])} elite players")

    # Pitching positions
    pitching_positions = ['SP', 'RP']
    for pos in pitching_positions:
        cursor.execute('''
            SELECT id, player_id, name_first, name_last, year, stats, z_score_position
            FROM players
            WHERE player_type = 'pitcher'
              AND positions_eligible LIKE %s
            ORDER BY z_score_position DESC
            LIMIT %s
        ''', (f'%{pos}%', positions_per_type))

        elite_pool[pos] = cursor.fetchall()
        print(f"  {pos}: {len(elite_pool[pos])} elite players")

    return elite_pool


def generate_simulated_team(elite_pool):
    """
    Generate one simulated team by randomly selecting from the elite pool.
    Returns category totals for the team.
    """
    import random

    team_stats = {
        'R': 0, 'HR': 0, 'RBI': 0, 'SB': 0, 'H': 0, 'AB': 0,
        'W': 0, 'SV': 0, 'K': 0, 'ER': 0, 'IP': 0, 'P_H': 0, 'P_BB': 0
    }

    # Roster configuration
    roster_slots = [
        ('C', 'C'), ('1B', '1B'), ('2B', '2B'), ('3B', '3B'), ('SS', 'SS'),
        ('OF', 'OF'), ('OF', 'OF'), ('OF', 'OF'),  # 3 OF slots
        ('UTIL', None),  # Can be any batter
    ]

    pitcher_slots = [
        ('SP', 'SP'), ('SP', 'SP'), ('SP', 'SP'),  # 3 SP slots
        ('RP', 'RP'), ('RP', 'RP'),  # 2 RP slots
        ('P', None), ('P', None),  # 2 flexible pitcher slots
    ]

    used_players = set()

    # Fill batting slots
    for slot_name, required_pos in roster_slots:
        if required_pos and required_pos in elite_pool and elite_pool[required_pos]:
            available = [p for p in elite_pool[required_pos] if p[0] not in used_players]
            if available:
                player = random.choice(available)
                used_players.add(player[0])
                stats = json.loads(player[5]) if isinstance(player[5], str) else player[5]
                team_stats['R'] += stats.get('R', 0)
                team_stats['HR'] += stats.get('HR', 0)
                team_stats['RBI'] += stats.get('RBI', 0)
                team_stats['SB'] += stats.get('SB', 0)
                team_stats['H'] += stats.get('H', 0)
                team_stats['AB'] += stats.get('AB', 0)
        elif slot_name == 'UTIL':
            # Pick from any batting position
            all_batters = []
            for pos in ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF']:
                if pos in elite_pool:
                    all_batters.extend(elite_pool[pos])
            available = [p for p in all_batters if p[0] not in used_players]
            if available:
                player = random.choice(available)
                used_players.add(player[0])
                stats = json.loads(player[5]) if isinstance(player[5], str) else player[5]
                team_stats['R'] += stats.get('R', 0)
                team_stats['HR'] += stats.get('HR', 0)
                team_stats['RBI'] += stats.get('RBI', 0)
                team_stats['SB'] += stats.get('SB', 0)
                team_stats['H'] += stats.get('H', 0)
                team_stats['AB'] += stats.get('AB', 0)

    # Fill pitching slots
    for slot_name, required_pos in pitcher_slots:
        if required_pos and required_pos in elite_pool and elite_pool[required_pos]:
            available = [p for p in elite_pool[required_pos] if p[0] not in used_players]
            if available:
                player = random.choice(available)
                used_players.add(player[0])
                stats = json.loads(player[5]) if isinstance(player[5], str) else player[5]
                team_stats['W'] += stats.get('W', 0)
                team_stats['SV'] += stats.get('SV', 0)
                team_stats['K'] += stats.get('K', stats.get('SO', 0))
                team_stats['ER'] += stats.get('ER', 0)
                team_stats['IP'] += stats.get('IP', 0)
                team_stats['P_H'] += stats.get('H', 0)
                team_stats['P_BB'] += stats.get('BB', 0)
        elif slot_name == 'P':
            # Pick from any pitcher
            all_pitchers = []
            for pos in ['SP', 'RP']:
                if pos in elite_pool:
                    all_pitchers.extend(elite_pool[pos])
            available = [p for p in all_pitchers if p[0] not in used_players]
            if available:
                player = random.choice(available)
                used_players.add(player[0])
                stats = json.loads(player[5]) if isinstance(player[5], str) else player[5]
                team_stats['W'] += stats.get('W', 0)
                team_stats['SV'] += stats.get('SV', 0)
                team_stats['K'] += stats.get('K', stats.get('SO', 0))
                team_stats['ER'] += stats.get('ER', 0)
                team_stats['IP'] += stats.get('IP', 0)
                team_stats['P_H'] += stats.get('H', 0)
                team_stats['P_BB'] += stats.get('BB', 0)

    # Calculate derived stats
    AVG = team_stats['H'] / team_stats['AB'] if team_stats['AB'] > 0 else 0
    ERA = (team_stats['ER'] * 9) / team_stats['IP'] if team_stats['IP'] > 0 else 99.99
    WHIP = (team_stats['P_BB'] + team_stats['P_H']) / team_stats['IP'] if team_stats['IP'] > 0 else 99.99

    category_totals = {
        'R': team_stats['R'],
        'HR': team_stats['HR'],
        'RBI': team_stats['RBI'],
        'SB': team_stats['SB'],
        'AVG': round(AVG, 3),
        'W': team_stats['W'],
        'SV': team_stats['SV'],
        'K': team_stats['K'],
        'ERA': round(ERA, 2),
        'WHIP': round(WHIP, 2),
    }

    # Calculate total score (sum of z-scores approximation)
    total_score = sum([
        team_stats['R'] / 100,
        team_stats['HR'] / 30,
        team_stats['RBI'] / 100,
        team_stats['SB'] / 30,
        (AVG - 0.260) * 100,
        team_stats['W'] / 15,
        team_stats['SV'] / 30,
        team_stats['K'] / 200,
        (4.00 - ERA) * 2,
        (1.30 - WHIP) * 5,
    ])

    return category_totals, round(total_score, 2)


def generate_team_pool(conn, num_teams=10000):
    """
    Generate simulated teams and insert them into the team_pool table.
    """
    print(f"\nGenerating {num_teams} simulated teams...")

    # Get elite pool
    print("Building elite pool...")
    elite_pool = get_elite_pool(conn)

    cursor = conn.cursor()

    # Clear existing simulated teams
    cursor.execute("DELETE FROM team_pool WHERE is_simulated = true")

    teams_data = []
    for i in range(num_teams):
        if (i + 1) % 1000 == 0:
            print(f"  Generated {i + 1}/{num_teams} teams...")

        category_totals, total_score = generate_simulated_team(elite_pool)
        teams_data.append((
            True,  # is_simulated
            json.dumps(category_totals),
            str(total_score)
        ))

    # Batch insert
    execute_values(
        cursor,
        '''INSERT INTO team_pool (is_simulated, category_totals, total_score)
           VALUES %s''',
        teams_data,
        page_size=1000
    )

    conn.commit()
    print(f"Successfully generated {num_teams} simulated teams")


def main():
    """
    Main function to process data and store in PostgreSQL.
    """
    if len(sys.argv) < 2:
        print("Usage: python preprocess-to-postgres.py <data_directory>")
        print("Example: python preprocess-to-postgres.py ../data-preprocessing/lahman_1871-2025_csv")
        return False

    data_directory = sys.argv[1]

    # Connect to PostgreSQL
    print("Connecting to PostgreSQL...")
    conn = get_db_connection()

    # Create tables
    print("\nCreating tables...")
    create_tables(conn)

    # Process batting data
    print("\n=== Processing batting data ===")
    batting_df = main_batting_pipeline(data_directory)
    print(f"Processed {len(batting_df)} batting records")

    # Process pitching data
    print("\n=== Processing pitching data ===")
    pitching_df = main_pitching_pipeline(data_directory)
    print(f"Processed {len(pitching_df)} pitching records")

    # Prepare data for PostgreSQL
    print("\n=== Preparing data for PostgreSQL ===")
    prepared_players = prepare_player_data(batting_df, pitching_df)

    # Insert data into PostgreSQL
    print("\n=== Inserting data into PostgreSQL ===")
    insert_players_to_postgres(prepared_players, conn)

    # Generate simulated team pool
    print("\n=== Generating simulated team pool ===")
    generate_team_pool(conn, num_teams=10000)

    # Get final counts
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM players")
    player_count = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM team_pool")
    team_count = cursor.fetchone()[0]

    print(f"\n=== Data processing complete ===")
    print(f"Total players: {player_count}")
    print(f"Total teams in pool: {team_count}")

    conn.close()
    return True


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
