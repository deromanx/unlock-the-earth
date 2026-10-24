#!/usr/bin/env python3
"""
逐字稿品質檢查：找出 Whisper 幻覺迴圈（同一個字連打幾百次，例如「嗯嗯嗯…」）把內容吃掉的集數。
這種逐字稿抽出來的地標會少很多（Ep.208 紐西蘭整集只抽到 1 個地點）。

  python3 scripts/transcript_quality.py            # 列出所有可疑集數
  python3 scripts/transcript_quality.py --severe   # 只列嚴重的（要重轉），一行一個集數，給批次腳本用
"""
import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEVERE_LOOP = 0.30     # 迴圈占全文 30% 以上
SEVERE_CPM = 180       # 或扣掉迴圈後每分鐘不到 180 字（正常對談約 250–400 字）


def quality(text, minutes):
    total = len(re.sub(r'\s', '', text))
    loop = sum(len(m.group(0)) for m in re.finditer(r'(.)\1{9,}', text))   # 同一字連續 10 次以上
    cpm = (total - loop) / minutes if minutes else 0
    return {'loop': loop / max(total, 1), 'cpm': cpm}


def is_severe(q):
    return q['loop'] >= SEVERE_LOOP or q['cpm'] < SEVERE_CPM


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--severe', action='store_true')
    args = ap.parse_args()

    eps = {e['episode']: e for e in json.loads((ROOT / 'data/episodes.json').read_text()) if e.get('type') == 'main'}
    rows = []
    for n, e in sorted(eps.items()):
        f = ROOT / f'data/transcripts/ep{n:03d}.txt'
        if not f.exists():
            continue
        q = quality(f.read_text(encoding='utf-8'), (e.get('duration') or 0) / 60)
        if q['loop'] > 0.03 or q['cpm'] < 200:
            rows.append((n, q))
    if args.severe:
        print('\n'.join(str(n) for n, q in rows if is_severe(q)))
        return
    for n, q in rows:
        print(f"Ep.{n:<4} 迴圈 {q['loop']:>4.0%}  有效字/分 {q['cpm']:>4.0f}  {'← 嚴重' if is_severe(q) else ''}")
    print(f'{len(rows)} 集可疑，{sum(1 for _, q in rows if is_severe(q))} 集嚴重')


if __name__ == '__main__':
    main()
