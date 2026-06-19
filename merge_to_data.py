"""
merge_to_data.py — patches data.json["announcedDates"] from bulk_test_results.csv

Mirrors agent.py's caution rules:
  - only writes status == "found"
  - only writes if new date is AFTER existing co["lastAnnouncement"]
  - only overwrites announcedDates[name] if new date is newer than what's there
  - never touches companies[] (that's agent.py's job)

Run locally or as a separate GitHub Action step, AFTER bulk_agent_v2.py.
"""

import csv
import json
from datetime import datetime

CSV_FILE  = 'bulk_test_results.csv'
DATA_JSON = 'data.json'
TODAY     = datetime.now().strftime('%Y-%m-%d')


def load_csv(path):
    rows = []
    with open(path, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
    return rows


def main():
    rows = load_csv(CSV_FILE)
    found_rows = [r for r in rows if r.get('status') == 'found' and r.get('extracted_date')]
    print(f"CSV: {len(rows)} total rows, {len(found_rows)} status=found")

    with open(DATA_JSON, 'r', encoding='utf-8') as f:
        data = json.load(f)

    companies = data.get('companies', [])
    announced = data.get('announcedDates', {})

    # name -> lastAnnouncement lookup, for "is this date newer" checks
    last_ann = {co.get('name', ''): co.get('lastAnnouncement', '') for co in companies}

    updated, skipped_stale, skipped_partial, skipped_unknown = [], [], [], []

    for row in found_rows:
        name = row['company']
        new_date = row['extracted_date'].strip()

        # Reject partial dates (YYYY-MM only) — same rule Groq prompt enforces upstream
        if len(new_date) != 10 or new_date.count('-') != 2:
            skipped_partial.append((name, new_date))
            continue

        if name not in last_ann:
            # Company not in data.json["companies"] at all — log it, don't silently drop
            skipped_unknown.append((name, new_date))
            continue

        existing_last = last_ann.get(name, '')
        existing_announced = announced.get(name, {}).get('date', '')

        # Skip if not after lastAnnouncement (same logic as agent.py's update_data_json)
        if existing_last and new_date <= existing_last:
            skipped_stale.append((name, new_date, existing_last))
            continue

        # Skip if announcedDates already has an equal-or-newer date for this company
        if existing_announced and new_date <= existing_announced:
            skipped_stale.append((name, new_date, existing_announced))
            continue

        announced[name] = {
            'date': new_date,
            'url': row.get('url') or None,
            'timestamp': datetime.now().strftime('%d/%m/%Y %H:%M:%S'),
            'source': f"bulk_agent ({row.get('source', 'unknown')}, conf={row.get('confidence', '')})",
        }
        updated.append((name, new_date))

    data['announcedDates'] = announced
    data['lastBulkMergeRun'] = TODAY

    with open(DATA_JSON, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"\nUpdated:  {len(updated)}")
    for n, d in updated:
        print(f"  + {n}: {d}")

    print(f"\nSkipped (not newer): {len(skipped_stale)}")
    for n, d, existing in skipped_stale:
        print(f"  - {n}: {d} <= existing {existing}")

    if skipped_partial:
        print(f"\nSkipped (partial date, no day): {len(skipped_partial)}")
        for n, d in skipped_partial:
            print(f"  - {n}: {d}")

    if skipped_unknown:
        print(f"\nSkipped (company not in data.json): {len(skipped_unknown)}")
        for n, d in skipped_unknown:
            print(f"  - {n}: {d}")

    print(f"\ndata.json saved. announcedDates now has {len(announced)} entries.")


if __name__ == '__main__':
    main()
