#!/usr/bin/env python3
"""
Pipeline Step 3: Fetch Wikipedia thumbnail images for landmarks.
Reads data/episode_landmarks/ep{num:03d}.json (from step 2),
adds 'image' field to each landmark entry using Wikipedia REST API.
Outputs to same file (in-place update).

Wikipedia REST API:
  https://en.wikipedia.org/api/rest_v1/page/summary/{title}
  Returns: thumbnail.source (image URL, typically 320px wide)

Falls back to searching the Chinese Wikipedia if English returns no image.

Usage:
  python3 scripts/pipeline/03_fetch_wikipedia_images.py              # all episodes
  python3 scripts/pipeline/03_fetch_wikipedia_images.py --ep 266     # single episode
"""
import json, sys, argparse, re, time, urllib.parse
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import HTTPError, URLError

ROOT        = Path(__file__).parent.parent.parent
LM_DIR      = ROOT / 'data' / 'episode_landmarks'

WIKI_EN_API = "https://en.wikipedia.org/api/rest_v1/page/summary/{}"
WIKI_ZH_API = "https://zh.wikipedia.org/api/rest_v1/page/summary/{}"
HEADERS     = {'User-Agent': 'podcast-website-bot/1.0 (educational project)'}

def wiki_image(title: str, lang: str = 'en') -> str | None:
    """Fetch thumbnail URL from Wikipedia summary API."""
    base = WIKI_EN_API if lang == 'en' else WIKI_ZH_API
    encoded = urllib.parse.quote(title.replace(' ', '_'))
    url = base.format(encoded)
    try:
        req = Request(url, headers=HEADERS)
        with urlopen(req, timeout=10) as r:
            data = json.loads(r.read())
        return data.get('thumbnail', {}).get('source')
    except (HTTPError, URLError, json.JSONDecodeError):
        return None

def get_image_for_landmark(lm: dict) -> str | None:
    """Try English name first, then Chinese name on zh.wikipedia."""
    name_en = lm.get('name_en', '').strip()
    name_zh = lm.get('name', '').strip()

    if name_en:
        img = wiki_image(name_en, 'en')
        if img:
            return img

    if name_zh:
        img = wiki_image(name_zh, 'zh')
        if img:
            return img

    return None

def process_episode(ep_num: int) -> bool:
    path = LM_DIR / f"ep{ep_num:03d}.json"
    if not path.exists():
        print(f"  No landmark file for Ep.{ep_num}, skipping")
        return False

    landmarks = json.loads(path.read_text(encoding='utf-8'))
    if not landmarks:
        print(f"  Ep.{ep_num}: empty (0 landmarks)")
        return True

    changed = 0
    for lm in landmarks:
        if lm.get('image'):
            continue  # already has image
        img = get_image_for_landmark(lm)
        if img:
            lm['image'] = img
            changed += 1
        time.sleep(0.3)  # be polite to Wikipedia

    path.write_text(json.dumps(landmarks, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"  ✓ Ep.{ep_num}: {changed}/{len(landmarks)} images fetched")
    return True

def get_available_eps():
    eps = []
    for f in LM_DIR.glob("ep*.json"):
        m = re.match(r'ep(\d+)\.json', f.name)
        if m:
            eps.append(int(m.group(1)))
    return sorted(eps)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ep',    type=int, help='Single episode number')
    parser.add_argument('--start', type=int, default=1, help='Start from episode number')
    parser.add_argument('--force', action='store_true', help='Re-fetch even if image already set')
    args = parser.parse_args()

    available = get_available_eps()
    if not available:
        print("No episode landmark files found. Run 02_extract_landmarks.py first.")
        sys.exit(1)

    print(f"Found {len(available)} episode landmark files")

    if args.ep:
        eps = [args.ep]
    else:
        eps = [e for e in available if e >= args.start]

    if args.force:
        # Clear existing images
        for ep_num in eps:
            path = LM_DIR / f"ep{ep_num:03d}.json"
            if path.exists():
                lms = json.loads(path.read_text(encoding='utf-8'))
                for lm in lms:
                    lm.pop('image', None)
                path.write_text(json.dumps(lms, ensure_ascii=False, indent=2), encoding='utf-8')

    print(f"Processing {len(eps)} episodes...\n")
    success = fail = 0
    for i, ep_num in enumerate(eps):
        print(f"[{i+1}/{len(eps)}] Ep.{ep_num}")
        if process_episode(ep_num):
            success += 1
        else:
            fail += 1

    print(f"\n✓ Done: {success} succeeded, {fail} failed")

if __name__ == '__main__':
    main()
