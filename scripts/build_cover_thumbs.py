#!/usr/bin/env python3
"""
每集封面縮圖 → assets/covers/<集數>.jpg（120×120，約 5KB），封面拼貼世界地圖用。
直接用 Firstory 原圖要下載 288 張、約 47MB；縮圖全部加起來約 1.5MB。
已有縮圖的集數跳過（封面換了就刪掉那張再跑）。GitHub Actions 每天跑，新集數自動補上。

  python3 scripts/build_cover_thumbs.py
"""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets/covers'
SIZE = 120


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    episodes = [e for e in json.loads((ROOT / 'data/episodes.json').read_text()) if e.get('type') == 'main' and e.get('image')]
    made = failed = 0
    for e in episodes:
        dst = OUT / f"{e['episode']}.jpg"
        if dst.exists():
            continue
        r = subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', e['image'],
                            '-vf', f'scale={SIZE}:{SIZE}:force_original_aspect_ratio=increase:flags=lanczos,crop={SIZE}:{SIZE}',
                            '-q:v', '5', str(dst)], capture_output=True, timeout=60)
        if r.returncode == 0 and dst.exists():
            made += 1
        else:
            failed += 1
            print(f"  ✗ Ep.{e['episode']}: {r.stderr.decode()[:120]}")
    have = len(list(OUT.glob('*.jpg')))
    print(f'封面縮圖：新做 {made}，失敗 {failed}，共 {have}/{len(episodes)} 集')


if __name__ == '__main__':
    main()
