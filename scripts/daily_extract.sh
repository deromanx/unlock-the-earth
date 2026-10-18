#!/usr/bin/env bash
# daily_extract.sh
# 全量重新萃取地標（2026-10 起，取消逐字稿截斷）的每日批次。
# Gemini 免費額度每個模型每天約 20 次：先用 Flash，額度用完再換 Flash-Lite。
# 已重跑過的集數記在 data/reextract_done.txt，會跳過；沒有任何地標資料的集數優先處理。
# 跑完後補圖、重建 landmarks_global.json、commit + push（GitHub Pages 自動部署）。
#
# 手動執行：bash scripts/daily_extract.sh

set -u
PODCAST_DIR="/Users/shangchieh/Downloads/shang-agent/podcast-website"
DONE_FILE="data/reextract_done.txt"
cd "$PODCAST_DIR" || exit 1

echo "[1/5] 萃取（gemini-2.5-flash）"
python3 -u scripts/pipeline/02_extract_landmarks.py --force --done-file "$DONE_FILE" --workers 2 --model gemini-2.5-flash
if [ $? -eq 2 ]; then
  echo "[1/5] Flash 額度用完，改用 gemini-2.5-flash-lite"
  python3 -u scripts/pipeline/02_extract_landmarks.py --force --done-file "$DONE_FILE" --workers 2 --model gemini-2.5-flash-lite
fi

echo "[2/5] Wikipedia 圖片（有快取）"
python3 -u scripts/pipeline/03_fetch_wikipedia_images.py > /dev/null || echo "WARNING: 圖片抓取部分失敗"

echo "[3/5] 重建 landmarks_global.json"
python3 scripts/pipeline/04_build_landmarks.py | grep -E "繁體|Total" || { echo "ERROR: 重建失敗"; exit 1; }

echo "[4/5] 進度"
python3 - "$DONE_FILE" <<'EOF'
import glob, json, os, sys
done_set = {int(x) for x in open(sys.argv[1]).read().split()}
tr = sorted(int(os.path.basename(f)[2:5]) for f in glob.glob('data/transcripts/ep*.txt'))
done = [e for e in tr if e in done_set]
L = json.load(open('data/landmarks_global.json'))
covered = {a['ep'] for l in L for a in l['appearances']}
print(f"  重跑進度：{len(done)}/{len(tr)} 集")
print(f"  地圖涵蓋：{len([e for e in tr if e in covered])}/{len(tr)} 集，{len(L)} 個地標，"
      f"{sum(1 for l in L if l.get('image'))} 個有圖")
EOF

echo "[5/5] commit + push"
git add data/episode_landmarks data/landmarks_global.json data/image_cache.json data/transcripts "$DONE_FILE"
if git diff --cached --quiet; then
  echo "  無變更"
else
  git commit -q -m "data: 地標每日重跑批次 $(date +%Y-%m-%d)" && git pull -q --rebase && git push -q && echo "  ✓ push 完成"
fi
