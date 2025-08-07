import os
import json

base_path = "/generator/sheet_definitions"

def extract_strings(variants):
    result = []
    if isinstance(variants, dict):
        result.extend(list(variants.keys()))
    elif isinstance(variants, list):
        for item in variants:
            if isinstance(item, str):
                result.append(item)
            elif isinstance(item, dict) and "name" in item:
                result.append(item["name"])
            elif isinstance(item, list):
                result.extend(extract_strings(item))
    return result

all_keys = set()
all_values = set()
file_counts = {}

for f in os.listdir(base_path):
    if f.endswith(".json"):
        file_path = os.path.join(base_path, f)
        with open(file_path, encoding="utf-8") as file:
            data = json.load(file)
            # Count all top-level keys
            all_keys.update(data.keys())
            # Count all variant values
            variants = data.get("variants", [])
            values = extract_strings(variants)
            file_counts[f] = len(values)
            all_values.update(values)

print(f"Total JSON files: {len(file_counts)}")
print(f"Total unique top-level keys: {len(all_keys)} ({sorted(all_keys)})")
print(f"Total unique values across all variants: {len(all_values)}")
print("Top 10 files by number of variant values:")
for fname, count in sorted(file_counts.items(), key=lambda x: x[1], reverse=True)[:10]:
    print(f"  {fname}: {count} values")