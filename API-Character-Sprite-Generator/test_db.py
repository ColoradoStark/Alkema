#!/usr/bin/env python3
"""Simple script to test database connectivity."""

import os
import sys
import psycopg2
from sqlalchemy import create_engine, text

def test_connection():
    """Test database connection."""
    db_url = os.getenv('DATABASE_URL', 'postgresql://alkema_user:alkema_pass@localhost:5432/alkema_db')
    
    print(f"Testing connection to: {db_url}")
    
    # Test with psycopg2
    try:
        # Parse the URL
        if db_url.startswith("postgresql://"):
            conn_str = db_url
        else:
            conn_str = f"postgresql://{db_url}"
            
        conn = psycopg2.connect(conn_str)
        print("✓ psycopg2 connection successful")
        conn.close()
    except Exception as e:
        print(f"✗ psycopg2 connection failed: {e}")
        return False
    
    # Test with SQLAlchemy
    try:
        engine = create_engine(db_url)
        with engine.connect() as conn:
            result = conn.execute(text("SELECT 1"))
            print("✓ SQLAlchemy connection successful")
    except Exception as e:
        print(f"✗ SQLAlchemy connection failed: {e}")
        return False
    
    # Test table existence
    try:
        with engine.connect() as conn:
            result = conn.execute(text("""
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public'
                ORDER BY table_name
            """))
            tables = [row[0] for row in result]
            if tables:
                print(f"✓ Found {len(tables)} tables: {', '.join(tables[:5])}...")
            else:
                print("! No tables found - database needs initialization")
    except Exception as e:
        print(f"✗ Could not query tables: {e}")
    
    return True

if __name__ == "__main__":
    if test_connection():
        print("\nDatabase connection test PASSED")
        sys.exit(0)
    else:
        print("\nDatabase connection test FAILED")
        sys.exit(1)