#!/usr/bin/env bash
# daily_extract.sh
# 全量重新萃取地標（2026-10 起，取消逐字稿截斷）的每日批次。
# 2026-10-18 起全部改用 Claude（無頭 claude -p，訂閱額度）；Gemini 免費額度每模型每天僅約 20 次。
# 先前 Gemini 跑過的集數（reextract_done_gemini.txt）排最後重跑，統一模型。
# 已重跑過的集數記在 data/reextract_done.txt，會跳過；沒有任何地標資料的集數優先處理。
# 跑完後補圖、重建 landmarks_global.json、commit + push（GitHub Pages 自動部署）。
#
# 手動執行：bash scripts/daily_extract.sh        （LIMIT=30 bash ... 限制本批集數）

set -u
PODCAST_DIR="/Users/shangchieh/Downloads/shang-agent/podcast-website"
DONE_FILE="data/reextract_done.txt"
cd "$PODCAST_DIR" || exit 1

echo "[1/5] 萃取（Claude Sonnet，訂閱額度；用量上限時自動停止，下次續跑）"
python3 -u scripts/pipeline/02_extract_landmarks.py --engine claude --force --done-file "$DONE_FILE" \
  --deprioritize data/reextract_done_gemini.txt --workers 3 ${LIMIT:+--limit "$LIMIT"}

echo "[2/5] Wikipedia 圖片（有快取）"
python3 -u scripts/pipeline/03_fetch_wikipedia_images.py > /dev/null || echo "WARNING: 圖片抓取部分失敗"

echo "[3/5] 重建 landmarks_global.json"
python3 scripts/pipeline/04_build_landmarks.py | grep -E "繁體|Total" || { echo "ERROR: 重建失敗"; exit 1; }

echo "[4/5] 進度"
python3 - "$DONE_FILE" <<'EOF'
import glob, json, os, sys
done_set = {int(x) for x in open(sys.argv[1]).read().split()}
tr = sorted(e for e in (int(os.path.basename(f)[2:5]) for f in glob.glob('data/transcripts/ep[0-9][0-9][0-9].txt')) if e != 999)
done = [e for e in tr if e in done_set]
L = json.load(open('data/landmarks_global.json'))
covered = {a['ep'] for l in L for a in l['appearances']}
print(f"  重跑進度：{len(done)}/{len(tr)} 集")
print(f"  地圖涵蓋：{len([e for e in tr if e in covered])}/{len(tr)} 集，{len(L)} 個地標，"
      f"{sum(1 for l in L if l.get('image'))} 個有圖")
EOF

echo "[5/5] commit + push"
git add data/episode_landmarks data/landmarks_global.json data/image_cache.json data/transcripts/ep[0-9][0-9][0-9].txt "$DONE_FILE" data/reextract_done_gemini.txt
if git diff --cached --quiet; then
  echo "  無變更"
else
  git commit -q -m "data: 地標每日重跑批次 $(date +%Y-%m-%d)" && git pull -q --rebase --autostash && git push -q && echo "  ✓ push 完成"
fi
