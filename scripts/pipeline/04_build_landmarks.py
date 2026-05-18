#!/usr/bin/env python3
"""
Pipeline Step 4: Merge per-episode landmark files into global landmarks_global.json.

Reads:  data/episode_landmarks/ep{num:03d}.json  (from steps 2+3)
        data/episodes.json                         (for episode metadata)
Output: data/landmarks_global.json

Global landmark format (deduplication by proximity + name):
[
  {
    "name": "景點中文名",
    "name_en": "Landmark English Name",
    "lat": 25.0330,
    "lon": 121.5654,
    "country": "台灣",
    "region": "亞洲",
    "image": "https://...",          // Wikipedia thumbnail, may be absent
    "appearances": [
      {
        "ep": 266,
        "quote": "逐字稿原文",
        "context": "摘要",
        "source": "transcript"
      }
    ]
  }
]

Two landmarks are considered the same if:
  - Their names (en or zh) match (case-insensitive), OR
  - Distance < 200m AND first 4 chars of name match

Usage:
  python3 scripts/pipeline/04_build_landmarks.py
  python3 scripts/pipeline/04_build_landmarks.py --dry-run
"""
import json, argparse, re, math
from pathlib import Path

ROOT        = Path(__file__).parent.parent.parent
LM_DIR      = ROOT / 'data' / 'episode_landmarks'
EPISODES_F  = ROOT / 'data' / 'episodes.json'
OUTPUT_F    = ROOT / 'data' / 'landmarks_global.json'

def haversine_m(lat1, lon1, lat2, lon2):
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlam/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

def names_match(a: dict, b: dict) -> bool:
    """True if two landmark dicts refer to the same place."""
    an = (a.get('name_en') or '').lower().strip()
    bn = (b.get('name_en') or '').lower().strip()
    if an and bn and an == bn:
        return True

    az = (a.get('name') or '').strip()
    bz = (b.get('name') or '').strip()
    if az and bz and az == bz:
        return True

    # Proximity check (< 200m) + first 4 chars match
    dist = haversine_m(a['lat'], a['lon'], b['lat'], b['lon'])
    if dist < 200:
        if az and bz and az[:4] == bz[:4]:
            return True

    return False

def get_available_eps():
    eps = []
    for f in LM_DIR.glob("ep*.json"):
        m = re.match(r'ep(\d+)\.json', f.name)
        if m:
            eps.append(int(m.group(1)))
    return sorted(eps)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    # Load episode metadata for episode numbers lookup
    ep_meta = {}
    if EPISODES_F.exists():
        for ep in json.loads(EPISODES_F.read_text(encoding='utf-8')):
            if ep.get('episode'):
                ep_meta[ep['episode']] = ep

    available = get_available_eps()
    if not available:
        print("No episode landmark files found. Run steps 2 and 3 first.")
        return

    print(f"Merging {len(available)} episode files...")

    # global_landmarks: list of merged landmark dicts
    global_landmarks: list[dict] = []

    total_appearances = 0

    for ep_num in available:
        path = LM_DIR / f"ep{ep_num:03d}.json"
        lms = json.loads(path.read_text(encoding='utf-8'))

        for lm in lms:
            if not lm.get('name') or lm.get('lat') is None:
                continue

            appearance = {
                'ep':      ep_num,
                'quote':   lm.get('quote', ''),
                'context': lm.get('context', ''),
                'source':  'transcript',
            }
            total_appearances += 1

            # Try to find existing landmark to merge into
            matched = None
            for existing in global_landmarks:
                if names_match(lm, existing):
                    matched = existing
                    break

            if matched:
                matched['appearances'].append(appearance)
                # Update image if not yet set
                if not matched.get('image') and lm.get('image'):
                    matched['image'] = lm['image']
            else:
                new_lm = {
                    'name':        lm.get('name', ''),
                    'name_en':     lm.get('name_en', ''),
                    'lat':         lm['lat'],
                    'lon':         lm['lon'],
                    'country':     lm.get('country', ''),
                    'region':      lm.get('region', '亞洲'),
                    'appearances': [appearance],
                }
                if lm.get('image'):
                    new_lm['image'] = lm['image']
                global_landmarks.append(new_lm)

    # Sort by number of appearances desc, then alphabetically
    global_landmarks.sort(key=lambda x: (-len(x['appearances']), x.get('name', '')))

    print(f"Total landmarks: {len(global_landmarks)}")
    print(f"Total appearances: {total_appearances}")
    print(f"Avg appearances per landmark: {total_appearances/max(len(global_landmarks),1):.1f}")

    # Region breakdown
    from collections import Counter
    region_counts = Counter(lm['region'] for lm in global_landmarks)
    print("\nRegion breakdown:")
    for region, count in sorted(region_counts.items(), key=lambda x: -x[1]):
        print(f"  {region}: {count}")

    if args.dry_run:
        print("\n(dry-run: not writing output)")
        return

    OUTPUT_F.write_text(
        json.dumps(global_landmarks, ensure_ascii=False, indent=2),
        encoding='utf-8'
    )
    print(f"\n✓ Written: {OUTPUT_F}")

if __name__ == '__main__':
    main()
