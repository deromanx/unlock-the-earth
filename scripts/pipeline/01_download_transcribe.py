#!/usr/bin/env python3
"""
Pipeline Step 1: Download episode audio and transcribe with mlx-whisper.
Processes in batches — deletes audio after transcription to save disk space.
Skips episodes that already have a transcript.

Usage:
  python3 scripts/pipeline/01_download_transcribe.py              # all episodes
  python3 scripts/pipeline/01_download_transcribe.py --ep 266     # single episode
  python3 scripts/pipeline/01_download_transcribe.py --batch 10   # batch size
"""
import json, re, subprocess, sys, argparse, xml.etree.ElementTree as ET
from pathlib import Path
from urllib.request import urlopen, Request, urlretrieve

ROOT        = Path(__file__).parent.parent.parent
TRANSCRIPT_DIR = ROOT / 'data' / 'transcripts'
AUDIO_TMP   = Path('/tmp/podcast_audio')
RSS_URL     = "https://feed.firstory.me/rss/user/cjzryn64q34i607580oyblh1u"
WHISPER_MODEL = "mlx-community/whisper-large-v3-turbo"

TRANSCRIPT_DIR.mkdir(parents=True, exist_ok=True)
AUDIO_TMP.mkdir(parents=True, exist_ok=True)

def fetch_episodes():
    req = Request(RSS_URL, headers={'User-Agent': 'Mozilla/5.0'})
    with urlopen(req) as r:
        root = ET.fromstring(r.read())
    eps = []
    for item in root.find('channel').findall('item'):
        title = (item.findtext('title') or '').strip()
        m = re.match(r'Ep\.(\d+)', title)
        if not m:
            continue
        ep_num = int(m.group(1))
        enc = item.find('enclosure')
        audio_url = enc.get('url', '') if enc is not None else ''
        if audio_url:
            eps.append({'ep': ep_num, 'title': title, 'audio_url': audio_url})
    return sorted(eps, key=lambda x: x['ep'])

def already_done(ep_num):
    return (TRANSCRIPT_DIR / f"ep{ep_num:03d}.txt").exists()

def transcribe(ep_num, audio_url):
    audio_path = AUDIO_TMP / f"ep{ep_num:03d}.mp3"
    srt_out    = AUDIO_TMP / f"ep{ep_num:03d}.srt"
    txt_out    = TRANSCRIPT_DIR / f"ep{ep_num:03d}.txt"

    print(f"  Downloading Ep.{ep_num}…", end=' ', flush=True)
    try:
        result = subprocess.run(
            ['curl', '-sL', '-A', 'Mozilla/5.0', '-o', str(audio_path), audio_url],
            timeout=600
        )
        if result.returncode != 0 or not audio_path.exists() or audio_path.stat().st_size < 1_000:
            print(f"FAILED (curl returncode={result.returncode})")
            audio_path.unlink(missing_ok=True)
            return False
        print(f"({audio_path.stat().st_size // 1_000_000}MB)", flush=True)
    except subprocess.TimeoutExpired:
        print(f"FAILED: download timeout")
        audio_path.unlink(missing_ok=True)
        return False
    except Exception as e:
        print(f"FAILED: {e}")
        return False

    print(f"  Transcribing Ep.{ep_num}…", flush=True)
    try:
        result = subprocess.run([
            'mlx_whisper', str(audio_path),
            '--model', WHISPER_MODEL,
            '--language', 'zh',
            '--output-format', 'txt',
            '--output-dir', str(AUDIO_TMP),
        ], capture_output=True, text=True, timeout=7200)
        if result.returncode != 0:
            print(f"  Whisper error: {result.stderr[:200]}")
            return False
    except subprocess.TimeoutExpired:
        print(f"  Timeout for Ep.{ep_num}")
        return False

    # Move transcript to data/transcripts/
    tmp_txt = AUDIO_TMP / f"ep{ep_num:03d}.txt"
    if tmp_txt.exists():
        tmp_txt.rename(txt_out)
    else:
        # whisper names output after input file
        candidates = list(AUDIO_TMP.glob(f"ep{ep_num:03d}*.txt"))
        if candidates:
            candidates[0].rename(txt_out)
        else:
            print(f"  No transcript found for Ep.{ep_num}")
            return False

    # Delete audio to save space
    audio_path.unlink(missing_ok=True)
    print(f"  ✓ Ep.{ep_num} done → {txt_out.name}")
    return True

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ep',    type=int, help='Single episode number')
    parser.add_argument('--batch', type=int, default=20, help='Batch size')
    parser.add_argument('--start', type=int, default=1, help='Start from episode number')
    args = parser.parse_args()

    print("Fetching episode list from RSS…")
    episodes = fetch_episodes()
    print(f"Found {len(episodes)} main episodes")

    if args.ep:
        episodes = [e for e in episodes if e['ep'] == args.ep]
        if not episodes:
            print(f"Episode {args.ep} not found"); sys.exit(1)
    else:
        episodes = [e for e in episodes if e['ep'] >= args.start]

    todo = [e for e in episodes if not already_done(e['ep'])]
    print(f"To process: {len(todo)} (skipping {len(episodes)-len(todo)} already done)\n")

    success = fail = 0
    for i, ep in enumerate(todo):
        print(f"[{i+1}/{len(todo)}] Ep.{ep['ep']}: {ep['title'][:50]}")
        if transcribe(ep['ep'], ep['audio_url']):
            success += 1
        else:
            fail += 1
        print()

    print(f"\n✓ Done: {success} succeeded, {fail} failed")
    print(f"Transcripts in: {TRANSCRIPT_DIR}")

if __name__ == '__main__':
    main()
