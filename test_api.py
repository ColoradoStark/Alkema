#!/usr/bin/env python3
"""
Test script with working API requests for the LPC Character Generator API.
Run this after your Docker containers are up.
"""

import requests
import json
import sys
from pathlib import Path

API_URL = "http://localhost:8000"

def test_health():
    """Test if the API is running."""
    try:
        response = requests.get(f"{API_URL}/health")
        if response.status_code == 200:
            print("✓ API is healthy")
            return True
    except:
        pass
    
    print("✗ API is not responding. Make sure docker containers are running.")
    return False

def test_generate_basic_male():
    """Generate a basic male character."""
    print("\n1. Basic Male Character")
    print("-" * 40)
    
    request_data = {
        "body_type": "male",
        "selections": [
            {"type": "body", "item": "body", "variant": "light"},
            {"type": "heads", "item": "heads_human_male"},
            {"type": "hair", "item": "hair_plain", "variant": "blonde"},
            {"type": "legs", "item": "legs_pants", "variant": "teal"},
            {"type": "torso", "item": "torso_shirt", "variant": "white"}
        ]
    }
    
    print("Request:")
    print(json.dumps(request_data, indent=2))
    
    response = requests.post(
        f"{API_URL}/generate-sprite",
        json=request_data
    )
    
    if response.status_code == 200:
        # Save the image
        with open("character_male_basic.png", "wb") as f:
            f.write(response.content)
        print("✓ Generated: character_male_basic.png")
        return True
    else:
        print(f"✗ Failed: {response.status_code} - {response.text}")
        return False

def test_generate_female_warrior():
    """Generate a female warrior character."""
    print("\n2. Female Warrior Character")
    print("-" * 40)
    
    request_data = {
        "body_type": "female",
        "selections": [
            {"type": "body", "item": "body", "variant": "amber"},
            {"type": "heads", "item": "heads_human_female"},
            {"type": "hair", "item": "hair_ponytail", "variant": "brown"},
            {"type": "legs", "item": "legs_armour", "variant": "iron"},
            {"type": "torso", "item": "torso_armour", "variant": "iron"},
            {"type": "arms", "item": "arms_armour", "variant": "iron"}
        ]
    }
    
    print("Request:")
    print(json.dumps(request_data, indent=2))
    
    response = requests.post(
        f"{API_URL}/generate-sprite",
        json=request_data
    )
    
    if response.status_code == 200:
        with open("character_female_warrior.png", "wb") as f:
            f.write(response.content)
        print("✓ Generated: character_female_warrior.png")
        return True
    else:
        print(f"✗ Failed: {response.status_code} - {response.text}")
        return False

def test_generate_orc():
    """Generate an orc character."""
    print("\n3. Orc Character")
    print("-" * 40)
    
    request_data = {
        "body_type": "male",
        "selections": [
            {"type": "body", "item": "body", "variant": "green"},
            {"type": "heads", "item": "heads_orc_male"},
            {"type": "hair", "item": "hair_mohawk", "variant": "black"},
            {"type": "legs", "item": "legs_fur", "variant": "brown"},
            {"type": "weapon", "item": "weapon_axe_basic"}
        ]
    }
    
    print("Request:")
    print(json.dumps(request_data, indent=2))
    
    response = requests.post(
        f"{API_URL}/generate-sprite",
        json=request_data
    )
    
    if response.status_code == 200:
        with open("character_orc.png", "wb") as f:
            f.write(response.content)
        print("✓ Generated: character_orc.png")
        return True
    else:
        print(f"✗ Failed: {response.status_code} - {response.text}")
        return False

def test_available_options():
    """Test getting available options."""
    print("\n4. Get Available Options for Male Body")
    print("-" * 40)
    
    request_data = {
        "body_type": "male",
        "current_selections": [
            {"type": "body", "item": "body", "variant": "light"}
        ]
    }
    
    response = requests.post(
        f"{API_URL}/available-options",
        json=request_data
    )
    
    if response.status_code == 200:
        data = response.json()
        print(f"✓ Found {data['total_categories']} categories")
        
        # Show first few categories
        for category, items in list(data['available_options'].items())[:5]:
            print(f"  - {category}: {len(items)} items")
        
        return True
    else:
        print(f"✗ Failed: {response.status_code} - {response.text}")
        return False

def test_curl_commands():
    """Print curl commands for manual testing."""
    print("\n5. Curl Commands for Manual Testing")
    print("-" * 40)
    
    print("Basic male character:")
    print("""
curl -X POST http://localhost:8000/generate-sprite \\
  -H "Content-Type: application/json" \\
  -d '{
    "body_type": "male",
    "selections": [
      {"type": "body", "item": "body", "variant": "light"},
      {"type": "heads", "item": "heads_human_male"},
      {"type": "hair", "item": "hair_plain", "variant": "blonde"}
    ]
  }' --output character.png
""")
    
    print("\nGet available options:")
    print("""
curl -X POST http://localhost:8000/available-options \\
  -H "Content-Type: application/json" \\
  -d '{
    "body_type": "male",
    "current_selections": []
  }'
""")

def main():
    print("=" * 50)
    print("LPC Character Generator API Test")
    print("=" * 50)
    
    if not test_health():
        print("\nPlease ensure Docker containers are running:")
        print("  docker compose up")
        sys.exit(1)
    
    # Run all tests
    tests_passed = 0
    tests_total = 4
    
    if test_generate_basic_male():
        tests_passed += 1
    
    if test_generate_female_warrior():
        tests_passed += 1
    
    if test_generate_orc():
        tests_passed += 1
    
    if test_available_options():
        tests_passed += 1
    
    test_curl_commands()
    
    print("\n" + "=" * 50)
    print(f"Tests Complete: {tests_passed}/{tests_total} passed")
    print("=" * 50)
    
    if tests_passed > 0:
        print("\nGenerated images saved in current directory:")
        for png in Path(".").glob("character_*.png"):
            print(f"  - {png}")

if __name__ == "__main__":
    main()