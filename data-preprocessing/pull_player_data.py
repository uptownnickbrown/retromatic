#!/usr/bin/env python3
"""
Pull player data from Railway prod DB and cache locally as parquet.
Usage: railway run python pull_player_data.py
"""
import os
import sys
import json
import psycopg2
import pandas as pd
from pathlib import Path

DATA_DIR = Path(__file__).parent / 'sim-data'
DATA_DIR.mkdir(exist_ok=True)
OUTPUT_FILE = DATA_DIR / 'players.parquet'

database_url = os.environ.get('DATABASE_PUBLIC_URL') or os.environ.get('DATABASE_URL')
if not database_url:
    print('ERROR: DATABASE_PUBLIC_URL or DATABASE_URL not set.')
    print('Run with: railway service Postgres && railway run python pull_player_data.py')
    sys.exit(1)

print(f'Connecting to prod DB...')
conn = psycopg2.connect(database_url)

query = """
SELECT id, player_id, name_first, name_last, year, team,
       player_type, primary_position, positions_eligible,
       stats, z_score_overall, z_score_position, category_zscores
FROM players
ORDER BY id
"""

print('Querying all player-seasons...')
df = pd.read_sql(query, conn)
conn.close()

# Convert jsonb columns to dicts (psycopg2 may return strings)
for col in ['stats', 'category_zscores']:
    df[col] = df[col].apply(lambda x: json.loads(x) if isinstance(x, str) else x)

# Convert to JSON strings for parquet storage
df['stats'] = df['stats'].apply(json.dumps)
df['category_zscores'] = df['category_zscores'].apply(json.dumps)

df.to_parquet(OUTPUT_FILE, index=False)

print(f'\nSaved {len(df):,} player-seasons to {OUTPUT_FILE}')
print(f'Player types: {df.player_type.value_counts().to_dict()}')
print(f'Positions: {df.primary_position.value_counts().to_dict()}')
print(f'Years: {df.year.min()}-{df.year.max()}')
print(f'File size: {OUTPUT_FILE.stat().st_size / 1024 / 1024:.1f} MB')
