#!/usr/bin/env python3
"""
每集封面的代表色 → data/episode_colors.json（{"集數": "#rrggbb"}）。
網頁打開某一集時，介面強調色換成這個顏色（冰島偏冷藍、埃及偏沙金）。

Firstory 的封面圖不允許網頁程式讀取像素（沒有 CORS），所以在這裡先算好。
用 ffmpeg 把封面縮成 24×24 再挑「最鮮明的色相群」，不需要額外安裝 Python 套件。
算過的封面網址存在 data/cover_color_cache.json，之後只算新封面。

  python3 scripts/build_episode_colors.py
"""
import colorsys
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data/episode_colors.json'
CACHE = ROOT / 'data/cover_color_cache.json'
N = 24


def pixels(url):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', url, '-vf', f'scale={N}:{N}:flags=area',
                          '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, timeout=60).stdout
    return [tuple(raw[i:i + 3]) for i in range(0, len(raw) - 2, 3)]


def vivid_color(px):
    """把夠鮮豔的像素依色相分 12 群，取「飽和度總和」最大的一群取平均；整張灰撲撲就回傳 None。"""
    bins = [[] for _ in range(12)]
    for r, g, b in px:
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        deg = h * 360
        if not (s > 0.22 and 0.2 < v < 0.97):
            continue
        # 每集封面固定有黃色大標和人物：排除標題黃、膚色，取背景風景的顏色
        if 38 <= deg <= 62 and s > 0.45 and v > 0.6:
            continue
        if deg < 38 and s < 0.62 and v > 0.35:
            continue
        bins[int(h * 12) % 12].append((r, g, b, s))
    best = max(bins, key=lambda xs: sum(x[3] for x in xs))
    if len(best) < len(px) * 0.04:
        return None
    w = sum(x[3] for x in best)
    r, g, b = (sum(x[i] * x[3] for x in best) / w for i in range(3))
    return '#%02x%02x%02x' % (round(r), round(g), round(b))


def main():
    episodes = [e for e in json.loads((ROOT / 'data/episodes.json').read_text()) if e.get('type') == 'main']
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    todo = sorted({e['image'] for e in episodes if e.get('image') and e['image'] not in cache})
    for i, url in enumerate(todo, 1):
        try:
            cache[url] = vivid_color(pixels(url))
        except Exception as err:   # noqa: BLE001 — 單張封面失敗不影響其他
            print(f'  ✗ {url[-30:]}: {err}')
            continue
        if i % 25 == 0:
            print(f'  {i}/{len(todo)}')
    CACHE.write_text(json.dumps(cache, separators=(',', ':'), sort_keys=True))
    colors = {str(e['episode']): cache[e['image']] for e in episodes if cache.get(e.get('image'))}
    OUT.write_text(json.dumps(colors, separators=(',', ':')))
    print(f'封面代表色：{len(colors)}/{len(episodes)} 集（新算 {len(todo)} 張）')


if __name__ == '__main__':
    main()
