# Data Preprocessing

This directory contains scripts for processing the [Lahman Baseball Database](http://www.seanlahman.com/baseball-archive/statistics/) into the format used by Retromatic.

## Getting the Source Data

1. Download the Lahman Baseball Database CSV files from:
   - **Official site**: http://www.seanlahman.com/baseball-archive/statistics/
   - **GitHub mirror**: https://github.com/chadwickbureau/baseballdatabank

2. Extract the CSV files into `lahman_1871-2023_csv/` in this directory.

The database is released under a Creative Commons Attribution-ShareAlike 3.0 license.
See `readme2023.txt` for full documentation of the data tables.

## Setup

```bash
python -m venv .data-preprocessing
source .data-preprocessing/bin/activate
pip install -r requirements.txt
```

## Scripts

- **`exploratory-data-analysis.ipynb`** - Jupyter notebook exploring the raw data
- **`preprocess-batting.py`** - Process batting statistics with z-score normalization
- **`preprocess-pitching.py`** - Process pitching statistics with z-score normalization
- **`preprocess-to-sqlite.py`** - Full pipeline outputting to SQLite for local development
- **`push-to-db.py`** - Upload processed data to Supabase/PostgreSQL

## Usage

For local SQLite development:
```bash
python preprocess-to-sqlite.py lahman_1871-2023_csv ../data/retromatic.db
```

For PostgreSQL (requires DATABASE_URL in .env):
```bash
python ../data-pipeline/preprocess-to-postgres.py lahman_1871-2023_csv
```
