#!/usr/bin/env python3
"""
網站資料健檢：資料更新後、commit 前跑一次；GitHub Actions 每次更新也會跑，出錯就讓 workflow 失敗（GitHub 會寄信）。
不開瀏覽器，只檢查資料檔本身。

  python3 scripts/check_site_data.py
"""
import json
import math
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
errors, warnings = [], []


def load(name):
    try:
        return json.loads((ROOT / name).read_text(encoding='utf-8'))
    except Exception as e:   # noqa: BLE001 — 任何讀檔／格式錯誤都要回報
        errors.append(f'{name} 讀不到或不是合法 JSON：{e}')
        return None


episodes = load('data/episodes.json') or []
landmarks = load('data/landmarks_global.json') or []
countries = load('data/countries.json') or {}
extracted = load('data/extracted_eps.json') or []
tags = load('data/episode_tags.json') or {}
info = load('data/landmark_info.json') or {}

main = {e['episode'] for e in episodes if e.get('type') == 'main' and e.get('episode')}
if len(main) < 280:
    errors.append(f'正集只有 {len(main)} 集，RSS 可能抓壞了')
for e in episodes:
    if not e.get('title') or not e.get('pubDate'):
        errors.append(f'集數資料缺標題或日期：{e}')

for lm in landmarks:
    name = lm.get('name')
    lat, lon = lm.get('lat'), lm.get('lon')
    if not name:
        errors.append(f'地標沒有名稱：{lm}')
    if not (isinstance(lat, (int, float)) and isinstance(lon, (int, float))
            and math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180):
        errors.append(f'地標座標不合法：{name} ({lat}, {lon})')
    if not lm.get('appearances'):
        errors.append(f'地標沒有出現集數：{name}')
    for a in lm.get('appearances', []):
        if a.get('ep') not in main:
            errors.append(f'地標 {name} 指向不存在的集數 Ep.{a.get("ep")}')
    if lm.get('image') and not lm['image'].startswith('https://'):
        warnings.append(f'地標 {name} 圖片網址不是 https：{lm["image"][:60]}')

if len(landmarks) < 1500:
    errors.append(f'地標只有 {len(landmarks)} 個，重建可能出錯（之前約 1,900 個）')
if len(countries.get('features', [])) < 200:
    errors.append('countries.json 國家數量異常')

for n in extracted:
    if n not in main:
        warnings.append(f'extracted_eps.json 有不在 RSS 的集數 Ep.{n}')

vocab = set(tags.get('tags', []))
for n, ts in tags.get('episodes', {}).items():
    if int(n) not in main:
        warnings.append(f'episode_tags.json 有不在 RSS 的集數 Ep.{n}')
    for t in ts:
        if t not in vocab:
            errors.append(f'Ep.{n} 的主題標籤「{t}」不在標籤清單裡')
untagged = sorted(main - {int(n) for n in tags.get('episodes', {})} - {10})
if untagged:
    warnings.append(f'{len(untagged)} 集還沒有主題標籤：{untagged[:10]}')

names = {lm.get('name') for lm in landmarks}
orphan = [k for k in info if k not in names]
if len(orphan) > 50:
    warnings.append(f'landmark_info.json 有 {len(orphan)} 筆對不到地標（跑一次 05_wikipedia_info.py 會重整）')

for n in main:
    if not (ROOT / f'ep/{n}.html').exists():
        errors.append(f'缺少分享頁 ep/{n}.html（跑 scripts/build_ep_pages.py）')

html = (ROOT / 'index.html').read_text(encoding='utf-8')
m = re.search(r'<meta name="data-version" content="([^"]*)">', html)
if not m:
    errors.append('index.html 缺少 <meta name="data-version">')
else:
    out = subprocess.run([sys.executable, str(ROOT / 'scripts/stamp_data_version.py'), '--check'], capture_output=True, text=True)
    if out.returncode != 0:
        errors.append(f'index.html 的資料版本號沒更新（跑 scripts/stamp_data_version.py）：{out.stdout.strip()}')

for w in warnings:
    print('⚠️ ', w)
for e in errors[:50]:
    print('❌', e)
if len(errors) > 50:
    print(f'…另有 {len(errors) - 50} 個錯誤')
print(f'檢查完成：{len(main)} 集、{len(landmarks)} 個地標，{len(errors)} 個錯誤、{len(warnings)} 個提醒')
sys.exit(1 if errors else 0)
