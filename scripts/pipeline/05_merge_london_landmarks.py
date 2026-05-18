#!/usr/bin/env python3
"""
Merge Craig episode landmarks into london_landmarks.json.

- Reads episode_landmarks/ep{num:03d}.json for all Craig episodes
- Filters to UK/London landmarks by country or bounding box
- Merges into london_landmarks.json:
    - Enriches existing entries with transcript quotes
    - Adds new landmarks not yet in the file
- For episodes without landmark files (e.g. ep22), uses Gemini to produce
  topic-based associations from episode title.

Usage:
  python3 scripts/pipeline/05_merge_london_landmarks.py
  python3 scripts/pipeline/05_merge_london_landmarks.py --dry-run
"""
import json, math, subprocess, re, argparse
from pathlib import Path

ROOT       = Path(__file__).parent.parent.parent
LM_DIR     = ROOT / 'data' / 'episode_landmarks'
LONDON_F   = ROOT / 'data' / 'london_landmarks.json'
EPISODES_F = ROOT / 'data' / 'episodes.json'

CRAIG_EPS  = [22, 23, 77, 82, 108, 109, 149, 150, 184, 223, 225, 226, 265, 266]

# London bounding box + broader UK check
LONDON_BOX = dict(lat_min=51.3, lat_max=51.7, lon_min=-0.5, lon_max=0.3)
UK_COUNTRIES = {'英國', '英格蘭', 'United Kingdom', 'England', 'UK', 'Britain', '大英帝國'}

def in_london_box(lat, lon):
    return (LONDON_BOX['lat_min'] <= lat <= LONDON_BOX['lat_max'] and
            LONDON_BOX['lon_min'] <= lon <= LONDON_BOX['lon_max'])

def is_uk(lm):
    return lm.get('country', '') in UK_COUNTRIES

def haversine_m(lat1, lon1, lat2, lon2):
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlam/2)**2
    return R * 2 * math.asin(math.sqrt(a))

def same_landmark(a, b):
    """True if two landmark dicts refer to the same place."""
    name_a = (a.get('landmark') or a.get('name', '')).lower().strip()
    name_b = (b.get('landmark') or b.get('name', '')).lower().strip()
    en_a   = (a.get('landmark_en') or a.get('name_en', '')).lower().strip()
    en_b   = (b.get('landmark_en') or b.get('name_en', '')).lower().strip()
    if name_a and name_a == name_b:
        return True
    if en_a and en_a == en_b:
        return True
    try:
        dist = haversine_m(a['lat'], a['lon'], b['lat'], b['lon'])
        if dist < 200 and (name_a[:4] == name_b[:4] or en_a[:4] == en_b[:4]):
            return True
    except (KeyError, TypeError):
        pass
    return False

def load_london():
    if LONDON_F.exists():
        return json.loads(LONDON_F.read_text())
    return []

def load_episodes():
    return json.loads(EPISODES_F.read_text())

def gemini_topic_landmarks(ep_num, title):
    """Ask Gemini to generate topic-based London landmarks for an episode without a transcript."""
    prompt = f"""這是一集倫敦主題的旅遊 Podcast，集數 Ep.{ep_num}，標題：「{title}」。

請根據標題推測這集可能提到的倫敦地標（最多 5 個），以 JSON 陣列回傳：
[
  {{
    "name": "地標中文名",
    "name_en": "Landmark English Name",
    "lat": 緯度數字,
    "lon": 經度數字,
    "country": "英國",
    "context": "與本集主題的關聯說明（20字以內）"
  }}
]

只回傳純 JSON，不要 markdown。若無明確地標請回傳 []。"""
    try:
        r = subprocess.run(['gemini', '-p', prompt], capture_output=True, text=True, timeout=120)
        raw = r.stdout.strip()
        raw = re.sub(r'^```(?:json)?\s*', '', raw, flags=re.MULTILINE)
        raw = re.sub(r'```\s*$', '', raw, flags=re.MULTILINE)
        start, end = raw.find('['), raw.rfind(']')
        if start == -1 or end == -1:
            return []
        return json.loads(raw[start:end+1])
    except Exception as e:
        print(f'  Gemini error for ep{ep_num}: {e}')
        return []

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    london = load_london()
    episodes = {e['episode']: e for e in load_episodes()}

    added = enriched = 0

    for ep_num in CRAIG_EPS:
        ep_meta = episodes.get(ep_num, {})
        title = ep_meta.get('title', f'Ep.{ep_num}')
        lm_file = LM_DIR / f'ep{ep_num:03d}.json'

        if lm_file.exists():
            raw_lms = json.loads(lm_file.read_text())
            uk_lms = [l for l in raw_lms if is_uk(l) or in_london_box(l.get('lat', 0), l.get('lon', 0))]
            source = 'transcript'
            print(f'Ep.{ep_num}: {len(raw_lms)} landmarks → {len(uk_lms)} UK/London')
        else:
            print(f'Ep.{ep_num}: no landmark file, using Gemini topic mode')
            raw_lms = gemini_topic_landmarks(ep_num, title)
            uk_lms = raw_lms
            source = 'topic'

        for lm in uk_lms:
            appearance = {
                'ep':      ep_num,
                'quote':   lm.get('quote') or None,
                'context': lm.get('context', ''),
                'source':  source,
            }

            # Find matching existing landmark
            match = next((l for l in london if same_landmark(lm, l)), None)

            if match:
                existing_eps = {a['ep'] for a in match.get('appearances', [])}
                if ep_num not in existing_eps:
                    if not args.dry_run:
                        match.setdefault('appearances', []).append(appearance)
                    print(f'  + enriched: {match["landmark"]} ← Ep.{ep_num}')
                    enriched += 1
                elif source == 'transcript':
                    # Upgrade topic → transcript if we now have a quote
                    for a in match.get('appearances', []):
                        if a['ep'] == ep_num and a['source'] == 'topic' and appearance.get('quote'):
                            if not args.dry_run:
                                a.update(appearance)
                            print(f'  ↑ upgraded to transcript: {match["landmark"]} Ep.{ep_num}')
                            enriched += 1
            else:
                new_entry = {
                    'landmark':    lm.get('name', ''),
                    'landmark_en': lm.get('name_en', ''),
                    'lat':         lm.get('lat'),
                    'lon':         lm.get('lon'),
                    'appearances': [appearance],
                }
                if not args.dry_run:
                    london.append(new_entry)
                print(f'  ++ new: {new_entry["landmark"]} ({new_entry["landmark_en"]})')
                added += 1

    print(f'\n결과: {added} 新增, {enriched} 豐富化')
    print(f'Total: {len(london)} 地標')

    if not args.dry_run:
        tmp = LONDON_F.with_suffix('.tmp')
        tmp.write_text(json.dumps(london, ensure_ascii=False, indent=2))
        tmp.replace(LONDON_F)
        print(f'✓ Saved: {LONDON_F}')
    else:
        print('(dry-run, 未寫入)')

if __name__ == '__main__':
    main()
