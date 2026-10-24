#!/usr/bin/env python3
"""
最新一集的音量曲線 → data/waveform.json，首頁地球後面的聲紋環用。
每次上新集數，聲紋就換成那一集的形狀。

ffmpeg 直接讀 RSS 的音檔網址、轉成低取樣率單聲道，切 240 段算音量（RMS），不存音檔。
集數沒變就跳過；GitHub Actions 每天跑（runner 內建 ffmpeg）。

  python3 scripts/build_waveform.py
"""
import array
import json
import math
import re
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data/waveform.json'
RSS_URL = 'https://feed.firstory.me/rss/user/cjzryn64q34i607580oyblh1u'
BINS = 240
RATE = 200   # 每秒取樣數：只要音量輪廓，不需要聽得到


def latest_episode():
    with urlopen(Request(RSS_URL, headers={'User-Agent': 'Mozilla/5.0'}), timeout=30) as r:
        root = ET.fromstring(r.read())
    for item in root.find('channel').findall('item'):   # RSS 由新到舊
        m = re.match(r'Ep\.(\d+)', (item.findtext('title') or '').strip())
        enc = item.find('enclosure')
        if m and enc is not None and enc.get('url'):
            return int(m.group(1)), enc.get('url')
    raise SystemExit('RSS 裡找不到正集')


def main():
    ep, url = latest_episode()
    if OUT.exists() and json.loads(OUT.read_text()).get('ep') == ep:
        print(f'聲紋：Ep.{ep} 沒變，跳過')
        return
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', url, '-ac', '1', '-ar', str(RATE), '-f', 's16le', '-'],
                         capture_output=True, timeout=600, check=True).stdout
    samples = array.array('h', raw[:len(raw) // 2 * 2])
    size = max(1, len(samples) // BINS)
    rms = [math.sqrt(sum(x * x for x in samples[i * size:(i + 1) * size]) / size) for i in range(BINS)]
    # 用第 95 百分位數當滿格，少數爆音不會把其他段壓扁
    top = sorted(rms)[int(BINS * 0.95)] or 1
    bins = [round(min(1, v / top), 3) for v in rms]
    OUT.write_text(json.dumps({'ep': ep, 'bins': bins}, separators=(',', ':')))
    print(f'聲紋：Ep.{ep}，{len(samples) / RATE / 60:.0f} 分鐘 → {BINS} 段')


if __name__ == '__main__':
    main()
