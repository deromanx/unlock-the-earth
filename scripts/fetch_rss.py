#!/usr/bin/env python3
"""Fetch Firstory RSS and write data/episodes.json"""
import json
import re
import xml.etree.ElementTree as ET
from urllib.request import urlopen, Request
from pathlib import Path
from datetime import datetime

RSS_URL = "https://feed.firstory.me/rss/user/cjzryn64q34i607580oyblh1u"
PODCAST_COVER = "https://d3mww1g1pfq2pt.cloudfront.net/Avatar/cjzryn64q34i607580oyblh1u/1616036848631.jpg"

NS = {
    'itunes':     'http://www.itunes.com/dtds/podcast-1.0.dtd',
    'googleplay': 'http://www.google.com/schemas/play-podcasts/1.0',
    'dc':         'http://purl.org/dc/elements/1.1/',
    'content':    'http://purl.org/rss/1.0/modules/content/',
}

def get(el, tag, ns_key=None, attr=None, default=''):
    if ns_key:
        found = el.find(f'{{{NS[ns_key]}}}{tag}')
    else:
        found = el.find(tag)
    if found is None:
        return default
    if attr:
        return found.get(attr, default)
    return (found.text or default).strip()

def parse_ep_number(title):
    m = re.match(r'Ep\.(\d+)', title)
    return int(m.group(1)) if m else None

def parse_ep_type(title):
    if re.match(r'Ep\.\d+', title): return 'main'
    if '幕後' in title: return 'behind'
    if '明信片' in title: return 'postcard'
    if '無濾鏡' in title: return 'unfiltered'
    return 'special'

def clean_title(title):
    return re.sub(r'^(Ep\.\d+\s*[|｜]?\s*|《[^》]+》\s*)', '', title).strip()

def parse_duration(s):
    if not s: return 0
    parts = s.strip().split(':')
    try:
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        if len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1])
        return int(s)
    except ValueError:
        return 0

def parse_date(s):
    if not s: return ''
    for fmt in ('%a, %d %b %Y %H:%M:%S %z', '%a, %d %b %Y %H:%M:%S GMT'):
        try:
            return datetime.strptime(s.strip(), fmt).strftime('%Y-%m-%d')
        except ValueError:
            continue
    return s[:10]

def fetch():
    req = Request(RSS_URL, headers={'User-Agent': 'Mozilla/5.0'})
    with urlopen(req) as r:
        xml = r.read()

    root = ET.fromstring(xml)
    channel = root.find('channel')

    episodes = []
    for item in channel.findall('item'):
        full_title = get(item, 'title') or get(item, 'title', 'itunes')
        link = get(item, 'link')
        guid = get(item, 'guid')
        ep_id = guid.split('/')[-1] if '/' in guid else guid

        pub_date = parse_date(get(item, 'pubDate'))

        img_el = item.find(f'{{{NS["itunes"]}}}image')
        image = (img_el.get('href', '') if img_el is not None else '') or PODCAST_COVER

        duration = parse_duration(get(item, 'duration', 'itunes'))
        ep_num = parse_ep_number(full_title)
        ep_type = parse_ep_type(full_title)
        title = clean_title(full_title)

        episodes.append({
            'id':        ep_id,
            'episode':   ep_num,
            'type':      ep_type,
            'title':     title,
            'fullTitle': full_title,
            'pubDate':   pub_date,
            'link':      link,
            'duration':  duration,
            'image':     image,
        })

    return episodes

def main():
    out = Path(__file__).parent.parent / 'data' / 'episodes.json'
    out.parent.mkdir(parents=True, exist_ok=True)

    print('Fetching RSS…')
    episodes = fetch()

    with open(out, 'w', encoding='utf-8') as f:
        json.dump(episodes, f, ensure_ascii=False, indent=2)

    print(f'✓ {len(episodes)} episodes → {out}')

if __name__ == '__main__':
    main()
