#!/usr/bin/env python3
"""
產生每集的分享頁 ep/{集數}.html。

GitHub Pages 是靜態網站，`?ep=287` 這種網址貼到 LINE／FB 只會抓到首頁的預覽卡。
每集一個靜態頁，帶自己的 og:title／og:image（集數封面），打開後立刻轉到地球上的那一集。

Usage:
  python3 scripts/build_ep_pages.py
"""
import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE_URL = 'https://deromanx.github.io/unlock-the-earth/'
FALLBACK_IMAGE = SITE_URL + 'assets/banner-2400.jpg'

TEMPLATE = """<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title} — 解鎖地球</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{url}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="解鎖地球">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:image" content="{image}">
<meta property="og:url" content="{url}">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url=../?ep={ep}">
<script>location.replace('../?ep={ep}' + location.hash);</script>
</head>
<body>
<p><a href="../?ep={ep}">前往《解鎖地球》{title}</a></p>
</body>
</html>
"""


def main():
    episodes = json.loads((ROOT / 'data/episodes.json').read_text())
    landmarks = json.loads((ROOT / 'data/landmarks_global.json').read_text())

    lm_by_ep = {}
    for lm in landmarks:
        for ep in {a['ep'] for a in lm.get('appearances', [])}:
            lm_by_ep.setdefault(ep, []).append(lm)

    out_dir = ROOT / 'ep'
    out_dir.mkdir(exist_ok=True)
    written = 0
    for ep in episodes:
        num = ep.get('episode')
        if ep.get('type') != 'main' or not num:
            continue
        lms = lm_by_ep.get(num, [])
        countries = list(dict.fromkeys(l['country'] for l in lms if l.get('country')))
        if lms:
            desc = f"跟著這集走過 {len(lms)} 個地方：{'、'.join(l['name'] for l in lms[:5])}" + ('…' if len(lms) > 5 else '')
            if countries:
                desc += f"（{'、'.join(countries[:4])}）"
        else:
            desc = '《解鎖地球》Podcast：旅行、歷史、文化。'
        page = TEMPLATE.format(
            title=html.escape(f"Ep.{num} {ep['title']}", quote=True),
            desc=html.escape(desc, quote=True),
            image=html.escape(ep.get('image') or FALLBACK_IMAGE, quote=True),
            url=f'{SITE_URL}ep/{num}.html',
            ep=num,
        )
        path = out_dir / f'{num}.html'
        if not path.exists() or path.read_text() != page:
            path.write_text(page)
            written += 1
    print(f'ep pages: {written} written/updated')


if __name__ == '__main__':
    main()
