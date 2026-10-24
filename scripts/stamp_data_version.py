#!/usr/bin/env python3
"""
依網頁會讀的資料檔內容算出版本號，寫進 index.html 的 <meta name="data-version">。
js/globe/app.js 抓資料時會帶 ?v=<版本>，資料一變網址就變，瀏覽器和 CDN 不會給舊快取。

每次資料更新後執行（GitHub Actions 與 scripts/add_episode.sh 都會呼叫）：
  python3 scripts/stamp_data_version.py
  python3 scripts/stamp_data_version.py --check   # 只檢查是否一致
"""
import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES = ['data/episodes.json', 'data/landmarks_global.json', 'data/countries.json', 'data/landmark_info.json',
         'data/extracted_eps.json', 'data/episode_tags.json']


def main():
    check = '--check' in sys.argv   # 只比對、不改檔（check_site_data.py 用）
    h = hashlib.sha1()
    for f in FILES:
        p = ROOT / f
        if p.exists():
            h.update(p.read_bytes())
    for p in sorted((ROOT / 'data/episode_landmarks').glob('ep*.json')):
        h.update(p.read_bytes())
    version = h.hexdigest()[:10]

    index = ROOT / 'index.html'
    html = index.read_text(encoding='utf-8')
    new = re.sub(r'(<meta name="data-version" content=")[^"]*(">)', rf'\g<1>{version}\g<2>', html)
    if check:
        print(f'data-version: {version}' + ('' if new == html else '（index.html 不一致）'))
        sys.exit(0 if new == html else 1)
    if new != html:
        index.write_text(new, encoding='utf-8')
    print(f'data-version: {version}')


if __name__ == '__main__':
    main()
