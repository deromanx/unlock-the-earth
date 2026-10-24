#!/usr/bin/env python3
"""
Pipeline Step 5: 從維基百科補地標的圖片與簡介。

步驟 3 只用「完全相同的條目名稱」查圖，大多查不到（約 3/4 地標沒圖）。
這一步改用維基百科搜尋，並用條目座標驗證：搜尋結果的座標要在地標附近才採用，避免同名誤配。

- 先搜英文維基（name_en），找不到再搜中文維基（name）
- 圖片：地標原本沒有圖才補，寫回 data/landmarks_global.json
- 簡介：中文維基導言的前一兩句（台灣正體），寫到 data/landmark_info.json，
  網頁點開地標時才載入，不拖慢首頁
- 查詢結果快取在 data/wiki_cache.json，之後只查新地標

必須在 04_build_landmarks.py 之後執行（04 會重建 landmarks_global.json）。

Usage:
  python3 scripts/pipeline/05_wikipedia_info.py
  python3 scripts/pipeline/05_wikipedia_info.py --limit 50     # 只查 50 個新地標（測試用）
"""
import argparse
import json
import math
import re
import time
import unicodedata
import urllib.parse
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent.parent
GLOBAL_F = ROOT / 'data' / 'landmarks_global.json'
INFO_F = ROOT / 'data' / 'landmark_info.json'
CACHE_F = ROOT / 'data' / 'wiki_cache.json'
HEADERS = {'User-Agent': 'unlock-the-earth-site/1.0 (https://deromanx.github.io/unlock-the-earth/; deromanx@gmail.com)'}
MAX_KM = 50          # 條目座標離地標多遠以內才算同一個地方
SUMMARY_CHARS = 90   # 簡介最多幾個字（取整句）


def api(lang, **params):
    url = f'https://{lang}.wikipedia.org/w/api.php?' + urllib.parse.urlencode({'format': 'json', 'formatversion': 2, **params})
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers=HEADERS), timeout=20) as r:
                return json.loads(r.read())
        except HTTPError as e:
            if e.code == 429:
                time.sleep(5 * (attempt + 1))
                continue
            return {}
        except (URLError, TimeoutError, json.JSONDecodeError):
            time.sleep(2)
    return {}


def km(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(a))


# 戰役、列表、歷史沿革這類條目常和地標同名、座標也在附近，但不是在講那個地方
SKIP_TITLE = re.compile(r'^(Battle|Siege|List|History|Timeline|Bombing|Attack|Invasion|Treaty|\d{3,4})\b|戰役|战役|列表|歷史|历史|圍城|围城|事件')


def norm(text):
    text = unicodedata.normalize('NFKD', text or '')
    return re.sub(r'[\W_]+', '', ''.join(c for c in text if not unicodedata.combining(c))).casefold()


def search(lang, query, lm):
    """搜尋前 5 筆，只看座標在地標附近的條目；標題和地標名稱一樣的優先，其次標題包含地標名稱的，再其次照搜尋排名。"""
    params = dict(action='query', generator='search', gsrsearch=query, gsrlimit=5,
                  prop='coordinates|pageimages', piprop='thumbnail', pithumbsize=480, redirects=1)
    if lang == 'en':
        params.update(prop='coordinates|pageimages|langlinks', lllang='zh')
    pages = api(lang, **params).get('query', {}).get('pages', [])
    q = norm(query)
    candidates = []
    for p in pages:
        c = (p.get('coordinates') or [None])[0]
        if not c or SKIP_TITLE.search(p['title']) or km(lm['lat'], lm['lon'], c['lat'], c['lon']) > MAX_KM:
            continue
        t = norm(p['title'])
        closeness = 0 if t == q else 1 if q in t else 2   # 標題比地標名稱短（城市名）的不加分，否則「吉薩」會贏過「吉薩金字塔群」
        candidates.append((closeness, p.get('index', 99), p))
    if not candidates:
        return None
    p = min(candidates, key=lambda x: x[:2])[2]
    zh = p['title'] if lang == 'zh' else next((l['title'] for l in p.get('langlinks', [])), None)
    return {'en': p['title'] if lang == 'en' else None, 'zh': zh,
            'image': (p.get('thumbnail') or {}).get('source', '').split('?')[0]}


def tidy(text):
    """導言 → 一兩句短簡介：去掉括號裡的外文原名、讀音，取不超過 SUMMARY_CHARS 的整句。"""
    text = re.sub(r'（[^（）]*）|\([^()]*\)', '', text or '').replace('\n', '')
    text = re.sub(r'\s+', ' ', text).strip()
    out = ''
    for sentence in re.findall(r'[^。！？]+[。！？]?', text):
        if out and len(out) + len(sentence) > SUMMARY_CHARS:
            break
        out += sentence
    return out if len(out) <= SUMMARY_CHARS * 1.5 else ''


def zh_extracts(titles):
    """中文維基導言（台灣正體），一次最多 20 條。"""
    out = {}
    for i in range(0, len(titles), 20):
        batch = titles[i:i + 20]
        r = api('zh', action='query', prop='extracts', exintro=1, explaintext=1, exlimit=20,
                titles='|'.join(batch), redirects=1, converttitles=1, variant='zh-tw')
        q = r.get('query', {})
        alias = {}
        for kind in ('normalized', 'converted', 'redirects'):
            for x in q.get(kind, []):
                alias[x['to']] = alias.get(x['from'], x['from'])
        for p in q.get('pages', []):
            src = p['title']
            while src in alias and alias[src] != src:
                src = alias[src]
            out[src] = tidy(p.get('extract', ''))
        time.sleep(0.2)
    return out


def cache_key(lm):
    return f"{(lm.get('name_en') or lm.get('name') or '').strip().lower()}@{lm['lat']:.2f},{lm['lon']:.2f}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, help='最多查幾個新地標')
    args = ap.parse_args()

    landmarks = json.loads(GLOBAL_F.read_text(encoding='utf-8'))
    cache = json.loads(CACHE_F.read_text(encoding='utf-8')) if CACHE_F.exists() else {}

    todo = [lm for lm in landmarks if cache_key(lm) not in cache]
    if args.limit:
        todo = todo[:args.limit]
    print(f'維基百科：{len(landmarks)} 個地標，{len(todo)} 個要查（其餘有快取）')
    for i, lm in enumerate(todo, 1):
        hit = None
        if lm.get('name_en'):
            hit = search('en', lm['name_en'], lm)
        if not hit and lm.get('name'):
            hit = search('zh', lm['name'], lm)
        cache[cache_key(lm)] = hit or {}
        if i % 50 == 0:
            print(f'  {i}/{len(todo)}')
            CACHE_F.write_text(json.dumps(cache, ensure_ascii=False, separators=(',', ':'), sort_keys=True), encoding='utf-8')
        time.sleep(0.1)

    # 中文簡介：只查還沒查過的條目
    need = sorted({h['zh'] for h in cache.values() if h and h.get('zh') and 'summary' not in h})
    if need:
        print(f'中文簡介：查 {len(need)} 條')
        got = zh_extracts(need)
        for h in cache.values():
            if h and h.get('zh') in got:
                h['summary'] = got[h['zh']]
    CACHE_F.write_text(json.dumps(cache, ensure_ascii=False, separators=(',', ':'), sort_keys=True), encoding='utf-8')

    info, added_img = {}, 0
    for lm in landmarks:
        h = cache.get(cache_key(lm)) or {}
        if not lm.get('image') and h.get('image'):
            lm['image'] = h['image']
            added_img += 1
        entry = {}
        if h.get('summary'):
            entry['s'] = h['summary']
        if h.get('zh'):
            entry['w'] = 'https://zh.wikipedia.org/zh-tw/' + urllib.parse.quote(h['zh'].replace(' ', '_'))
        elif h.get('en'):
            entry['w'] = 'https://en.wikipedia.org/wiki/' + urllib.parse.quote(h['en'].replace(' ', '_'))
        if entry:
            info[lm['name']] = entry

    GLOBAL_F.write_text(json.dumps(landmarks, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    INFO_F.write_text(json.dumps(info, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    with_img = sum(1 for lm in landmarks if lm.get('image'))
    print(f'圖片：新補 {added_img}，共 {with_img}/{len(landmarks)} 有圖')
    print(f'簡介：{sum(1 for v in info.values() if "s" in v)}/{len(landmarks)} 有簡介，{len(info)} 有維基連結')


if __name__ == '__main__':
    main()
