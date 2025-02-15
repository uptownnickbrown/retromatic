import pandas as pd
import numpy as np
import os
import json
import sys
import requests
from sqlalchemy import create_engine
from dotenv import load_dotenv

# Make sure numpy is available for NaN handling
try:
    import numpy as np
except ImportError:
    print("Warning: numpy not found. NaN handling may not work correctly.")
    # Define basic functions for NaN detection
    class NumpySubstitute:
        def isnan(self, val):
            return val != val
        def isinf(self, val):
            return val == float('inf') or val == float('-inf')
    np = NumpySubstitute()

# Load environment variables from .env file
load_dotenv()

def upload_to_db(df, table_name, db_url):
    """
    Upload a pandas DataFrame to a SQL database using SQLAlchemy
    """
    engine = create_engine(db_url)
    df.to_sql(table_name, con=engine, index=False, if_exists='replace')
    print(f"Uploaded {len(df)} rows to table '{table_name}'")


def clean_nan_values(obj):
    """
    Recursively replace NaN values with None in a dictionary or list
    """
    if isinstance(obj, dict):
        return {k: clean_nan_values(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [clean_nan_values(item) for item in obj]
    elif isinstance(obj, float) and (np.isnan(obj) or np.isinf(obj)):
        return None
    else:
        return obj

def check_supabase_auth(supabase_url, supabase_key):
    """
    Check if Supabase credentials are valid and RLS is disabled.
    """
    print("Verifying Supabase credentials...")
    print("Supabase URL:", supabase_url)
    print("API Key (first 10 chars):", supabase_key[:10] + "..." if len(supabase_key) > 10 else supabase_key)
    
    # Try to access the players table
    check_url = f"{supabase_url}/rest/v1/players?limit=1"
    headers = {
        'apikey': supabase_key,
        'Authorization': f'Bearer {supabase_key}',
        'Content-Type': 'application/json'
    }
    
    try:
        response = requests.get(check_url, headers=headers)
        print(f"GET response status code: {response.status_code}")
        
        # Now try a simple POST to check write permissions
        test_post_url = f"{supabase_url}/rest/v1/players"
        test_post_data = [{
            "playerID": "test_delete_me", 
            "nameFirst": "Test", 
            "nameLast": "User",
            "position": "TEST",
            "year": 2025,
            "player_type": "test"
        }]
        
        test_post_response = requests.post(
            test_post_url,
            headers={**headers, 'Prefer': 'return=minimal'},
            json=test_post_data
        )
        
        print(f"POST test response status code: {test_post_response.status_code}")
        
        if test_post_response.status_code >= 400:
            print("\n⚠️ WARNING: Cannot write to the players table!")
            print("This likely means Row Level Security (RLS) is still enabled.")
            print("\nPlease make sure you have DISABLED Row Level Security for the 'players' table:")
            print("1. Go to Supabase dashboard → Table Editor → 'players' table")
            print("2. Click on 'Auth policies' tab in the right sidebar")
            print("3. Turn OFF the 'Enable RLS' toggle")
            print("4. Try running this script again")
            
            # Ask if they want to proceed anyway
            confirm = input("\nDo you want to try to continue anyway? (y/n): ")
            if confirm.lower() != 'y':
                return False
        else:
            print("✅ Successfully verified write access to the players table!")
            
            # Clean up test data
            try:
                requests.delete(
                    f"{supabase_url}/rest/v1/players?playerID=eq.test_delete_me",
                    headers=headers
                )
            except:
                # It's okay if cleanup fails
                pass
    except Exception as e:
        print(f"Error checking authentication: {e}")
        confirm = input("Do you want to continue anyway? (y/n): ")
        if confirm.lower() != 'y':
            return False
    
    return True

def check_supabase_table(table_name, supabase_url, supabase_key):
    """
    Check if a table exists in Supabase.
    """
    print(f"Checking if table '{table_name}' exists...")
    
    # Check if the table exists
    check_url = f"{supabase_url}/rest/v1/{table_name}?limit=1"
    headers = {
        'apikey': supabase_key,
        'Authorization': f'Bearer {supabase_key}',
        'Content-Type': 'application/json'
    }
    
    response = requests.get(check_url, headers=headers)
    
    if response.status_code == 404:
        print(f"ERROR: Table '{table_name}' doesn't exist. Please create it in the Supabase dashboard.")
        print("Go to your Supabase project → Table Editor → New Table")
        print(f"Name it '{table_name}' with at least these columns:")
        
        if table_name == 'players':
            print("- id (auto-increment integer, primary key)")
            print("- playerID (text)")
            print("- nameFirst (text)")
            print("- nameLast (text)")
            print("- position (text)")
            print("- year (integer)")
            print("- player_type (text - 'batter' or 'pitcher')")
            print("- zScore (float)")
            print("- posZScore (float)")
            print("- stats (JSON)")
        elif table_name == 'drafts':
            print("- id (auto-increment integer, primary key)")
            print("- status (text - 'created', 'in_progress', 'completed')")
            print("- user_id (text)")
            print("- guest_id (text)")
            print("- created_at (timestamp)")
            print("- final_score (float)")
            print("- percentile (float)")
        elif table_name == 'picks':
            print("- id (auto-increment integer, primary key)")
            print("- draft_id (integer, foreign key to drafts.id)")
            print("- player_id (text)")
            print("- pick_number (integer)")
            print("- round (integer)")
            print("- created_at (timestamp)")
        
        # Ask if they want to create the table or continue
        action = input(f"Do you want to (1) try anyway or (2) quit? Enter 1 or 2: ")
        if action == '2':
            return False
    else:
        print(f"Table '{table_name}' exists!")
    
    return True

def upload_to_supabase(data, table_name, supabase_url, supabase_key, use_bearer=True):
    """
    Upload data to Supabase using the REST API
    """
    # Check if the table exists first
    if not check_supabase_table(table_name, supabase_url, supabase_key):
        print(f"Skipping upload to '{table_name}'")
        return False
    
    if isinstance(data, pd.DataFrame):
        # Convert DataFrame to records list
        records = data.to_dict(orient='records')
    else:
        # Assume it's already a list of dicts
        records = data
    
    # Clean NaN values to avoid JSON serialization issues
    print(f"Cleaning NaN values in {len(records)} records...")
    records = clean_nan_values(records)
    
    # Prepare the API endpoint URL
    api_url = f"{supabase_url}/rest/v1/{table_name}"
    
    # Set headers for the request
    headers = {
        'apikey': supabase_key,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal'
    }
    
    # Add Authorization header if needed
    if use_bearer:
        headers['Authorization'] = f'Bearer {supabase_key}'
        
    print(f"Using headers for upload: {headers}")
    
    # For large datasets, split into batches to avoid request size limits
    batch_size = 1000
    total_records = len(records)
    successful_batches = 0
    
    for i in range(0, total_records, batch_size):
        batch = records[i:i + batch_size]
        response = None
        try:
            response = requests.post(
                api_url, 
                headers=headers,
                json=batch
            )
            response.raise_for_status()
            successful_batches += 1
            print(f"Uploaded batch {i//batch_size + 1}/{(total_records+batch_size-1)//batch_size} to '{table_name}'")
        except requests.exceptions.RequestException as e:
            print(f"Error uploading batch to Supabase: {e}")
            if response and hasattr(response, 'text'):
                print(f"Response: {response.text}")
            
            # Try uploading one by one to identify problematic records
            print("Trying to upload records individually to identify problems...")
            for j, record in enumerate(batch):
                try:
                    individual_response = requests.post(
                        api_url,
                        headers=headers,
                        json=[record]
                    )
                    individual_response.raise_for_status()
                except Exception as e2:
                    print(f"Problem with record {i+j}: {e2}")
                    print(f"Problematic record: {record}")
                    # Continue with the next record
            
            # Continue with the next batch
            continue
    
    success_rate = successful_batches / ((total_records + batch_size - 1) // batch_size)
    if success_rate >= 0.9:  # If at least 90% of batches were successful
        print(f"Uploaded {successful_batches * batch_size} of {total_records} records to table '{table_name}'")
        return True
    else:
        print(f"Failed to upload many records to '{table_name}'. Success rate: {success_rate:.0%}")
        return False


def load_json_data(file_path):
    """
    Load data from a JSON file
    """
    try:
        with open(file_path, 'r') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading JSON file {file_path}: {e}")
        return None


def load_processed_data(batting_file, pitching_file):
    """
    Load processed batting and pitching data from files
    """
    batting_data = load_json_data(batting_file)
    pitching_data = load_json_data(pitching_file)
    
    if batting_data is None or pitching_data is None:
        return None
    
    # Add type field to distinguish between batting and pitching
    for player in batting_data:
        player['player_type'] = 'batter'
    
    for player in pitching_data:
        player['player_type'] = 'pitcher'
    
    # Combine the data
    all_players = batting_data + pitching_data
    
    return all_players


def prepare_player_data(records):
    """
    Prepare player data for Supabase by reformatting it to match our schema.
    """
    prepared_data = []
    total_records = len(records)
    processed = 0
    
    print(f"Preparing {total_records} records for upload...")
    
    for record in records:
        # Extract and validate the required fields
        player_id = record.get('playerID', '')
        if not player_id:
            # Skip records without a player ID
            continue
            
        # Basic player info with fallbacks for required fields
        player = {
            'playerID': player_id,
            'nameFirst': record.get('nameFirst', ''),
            'nameLast': record.get('nameLast', ''),
            'position': record.get('POS', 'UTIL'),
            'year': record.get('yearID', 0),
            'player_type': record.get('player_type', 'unknown'),
            'team': record.get('teamID', ''),
            'zScore': 0,
            'posZScore': 0,
        }
        
        # Only use fallbacks if absolutely needed
        if not player['nameFirst']:
            print(f"Warning: Missing nameFirst for player {player_id}, using available data")
            player['nameFirst'] = 'Unknown'
            
        if not player['nameLast']:
            print(f"Warning: Missing nameLast for player {player_id}, using available data")
            player['nameLast'] = 'Player'
        
        # Safely convert z-scores
        try:
            z_score = record.get('Total_Z')
            pos_z_score = record.get('Total_POS_Z')
            
            player['zScore'] = float(z_score) if z_score is not None and not np.isnan(z_score) and not np.isinf(z_score) else 0
            player['posZScore'] = float(pos_z_score) if pos_z_score is not None and not np.isnan(pos_z_score) and not np.isinf(pos_z_score) else 0
        except (ValueError, TypeError):
            # If conversion fails, use default values
            player['zScore'] = 0
            player['posZScore'] = 0
        
        # Construct stats object based on player type
        if record.get('player_type') == 'batter':
            # Safely convert numeric values, with fallbacks
            try:
                stats = {
                    'R': int(record.get('R', 0) or 0),
                    'HR': int(record.get('HR', 0) or 0),
                    'RBI': int(record.get('RBI', 0) or 0),
                    'SB': int(record.get('SB', 0) or 0),
                    'AVG': float(record.get('AVG', 0) or 0),
                    # Additional stats
                    'H': int(record.get('H', 0) or 0),
                    'AB': int(record.get('AB', 0) or 0),
                    'BB': int(record.get('BB', 0) or 0),
                    'OBP': float(record.get('OBP', 0) or 0),
                }
            except (ValueError, TypeError):
                # Provide default stats if conversion fails
                stats = {
                    'R': 0, 'HR': 0, 'RBI': 0, 'SB': 0, 'AVG': 0.0,
                    'H': 0, 'AB': 0, 'BB': 0, 'OBP': 0.0
                }
        else:  # pitcher
            try:
                stats = {
                    'W': int(record.get('W', 0) or 0),
                    'SV': int(record.get('SV', 0) or 0),
                    'K': int(record.get('SO', 0) or 0),  # SO is K in Lahman
                    'ERA': float(record.get('ERA', 0) or 0),
                    'WHIP': float(record.get('WHIP', 0) or 0),
                    # Additional stats
                    'IP': float(record.get('IP', 0) or 0),
                    'G': int(record.get('G', 0) or 0),
                    'GS': int(record.get('GS', 0) or 0),
                    'L': int(record.get('L', 0) or 0),
                }
            except (ValueError, TypeError):
                # Provide default stats if conversion fails
                stats = {
                    'W': 0, 'SV': 0, 'K': 0, 'ERA': 0.0, 'WHIP': 0.0,
                    'IP': 0.0, 'G': 0, 'GS': 0, 'L': 0
                }
        
        # Add stats as a field (will be converted to JSON)
        player['stats'] = stats
        
        # Add to the prepared data
        prepared_data.append(player)
        
        # Show progress
        processed += 1
        if processed % 5000 == 0:
            print(f"Processed {processed}/{total_records} records...")
    
    print(f"Prepared {len(prepared_data)} valid records for upload")
    return prepared_data


def main():
    """
    Main function to push processed data to Supabase
    """
    # Get Supabase credentials from environment variables
    supabase_url = os.getenv('SUPABASE_URL')
    supabase_key = os.getenv('SUPABASE_KEY')
    
    if not supabase_url or not supabase_key:
        print("Error: Supabase credentials not found in environment variables.")
        print("Please make sure SUPABASE_URL and SUPABASE_KEY are set.")
        return False
    
    # Verify Supabase credentials
    auth_result = check_supabase_auth(supabase_url, supabase_key)
    if not auth_result:
        print("Cannot continue with invalid Supabase credentials")
        return False
        
    # Determine if we should use Bearer token
    use_bearer = auth_result != 'no-bearer'
    
    # Check command line arguments
    if len(sys.argv) < 3:
        print("Usage: python push-to-db.py <batting_json_file> <pitching_json_file>")
        return False
    
    batting_file = sys.argv[1]
    pitching_file = sys.argv[2]
    
    # Load the processed data
    all_players = load_processed_data(batting_file, pitching_file)
    if all_players is None:
        return False
    
    # Prepare the player data for Supabase
    print("Preparing player data for Supabase...")
    formatted_players = prepare_player_data(all_players)
    
    print(f"Prepared {len(formatted_players)} player records for upload")
    
    # Upload to the players table
    print("Uploading all players to 'players' table...")
    players_success = upload_to_supabase(formatted_players, 'players', supabase_url, supabase_key, use_bearer)
    
    if not players_success:
        print("Failed to upload player data.")
        return False
    
    # Ask if user wants to also create empty drafts and picks tables
    create_other_tables = input("Do you want to check/create drafts and picks tables? (y/n): ")
    
    if create_other_tables.lower() == 'y':
        check_supabase_table('drafts', supabase_url, supabase_key)
        check_supabase_table('picks', supabase_url, supabase_key)
    
    print("Data upload to Supabase complete!")
    return True


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)