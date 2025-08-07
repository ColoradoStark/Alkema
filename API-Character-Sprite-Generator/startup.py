#!/usr/bin/env python3
"""
Startup script for the Alkema API container.
Ensures database is ready and populated before starting the API.
"""

import os
import sys
import time
import subprocess

def wait_for_postgres(max_attempts=30):
    """Wait for PostgreSQL to be ready."""
    import psycopg2
    
    db_url = os.getenv('DATABASE_URL', 'postgresql://alkema_user:alkema_pass@postgres:5432/alkema_db')
    print(f"Waiting for PostgreSQL at: {db_url}")
    
    for attempt in range(1, max_attempts + 1):
        try:
            conn = psycopg2.connect(db_url)
            conn.close()
            print("PostgreSQL is ready!")
            return True
        except Exception as e:
            if attempt < max_attempts:
                print(f"Waiting for PostgreSQL... ({attempt}/{max_attempts})")
                time.sleep(2)
            else:
                print(f"PostgreSQL connection failed after {max_attempts} attempts: {e}")
                return False
    
    return False

def run_ingestion():
    """Run the data ingestion script."""
    print("Checking database initialization...")
    
    # First check if database has data
    try:
        from models import create_session, Item
        session = create_session()
        item_count = session.query(Item).count()
        session.close()
        
        if item_count > 0:
            print(f"Database already populated with {item_count} items")
            return True
        else:
            print("Database is empty, running ingestion...")
    except Exception as e:
        print(f"Could not check database state: {e}")
        print("Will attempt ingestion anyway...")
    
    # Run ingestion
    try:
        result = subprocess.run(
            [sys.executable, "ingest_lpc_data.py"],
            capture_output=True,
            text=True,
            timeout=300  # 5 minute timeout
        )
        
        if result.returncode == 0:
            print("Database initialization completed successfully")
        else:
            print(f"Database initialization had issues")
            if result.stderr:
                print(f"Error details: {result.stderr}")
            if result.stdout:
                print(f"Output: {result.stdout}")
        
        return True
    except subprocess.TimeoutExpired:
        print("Database initialization timed out - this might be normal for large datasets")
        return True
    except Exception as e:
        print(f"Could not run ingestion: {e}")
        return False

def start_api():
    """Start the API server."""
    print("Starting Alkema API...")
    cmd = ["uvicorn", "main_v2:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
    
    # Execute the command, replacing this process
    os.execvp(cmd[0], cmd)

def main():
    """Main startup logic."""
    print("Starting Alkema Character Generator API")
    print("-" * 40)
    
    # Wait for PostgreSQL
    if not wait_for_postgres():
        print("ERROR: Could not connect to PostgreSQL")
        sys.exit(1)
    
    # Ensure database is populated
    run_ingestion()
    
    # Start the API
    start_api()

if __name__ == "__main__":
    main()