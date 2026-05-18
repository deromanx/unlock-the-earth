#!/usr/bin/env bash
# weekly_update.sh
# 每週三 6am 自動執行：抓 RSS → 轉錄 → 萃取地標 → 重建全局資料
# cron: 0 6 * * 3 /Users/shangchieh/Downloads/shang-agent/podcast-website/scripts/weekly_update.sh

PODCAST_DIR="/Users/shangchieh/Downloads/shang-agent/podcast-website"
LOG_FILE="$PODCAST_DIR/logs/weekly_update.log"

PYTHON="/Library/Frameworks/Python.framework/Versions/3.14/bin/python3"
GEMINI="/Users/shangchieh/.local/bin/gemini"
PATH="/Library/Frameworks/Python.framework/Versions/3.14/bin:/Users/shangchieh/.local/bin:$PATH"
export PATH GEMINI

exec >> "$LOG_FILE" 2>&1
echo ""
echo "══════════════════════════════════════"
echo "  START  $(date '+%Y-%m-%d %H:%M:%S')"
echo "══════════════════════════════════════"

cd "$PODCAST_DIR"

# ── Step 1: 更新 episodes.json ──────────────────────────────────────────────
echo ""
echo "[1/5] fetch_rss.py"
$PYTHON scripts/fetch_rss.py || { echo "ERROR: fetch_rss 失敗"; exit 1; }

# 找最新一集集數
LATEST_EP=$($PYTHON -c "
import json
with open('data/episodes.json') as f:
    eps = json.load(f)
nums = [e['episode'] for e in eps if e.get('type') == 'main' and e.get('episode')]
print(max(nums))
")
EP_PAD=$(printf '%03d' "$LATEST_EP")
echo "  最新集數：Ep.$LATEST_EP (ep$EP_PAD)"

# ── Step 2: 下載 + 轉錄 ────────────────────────────────────────────────────
TRANSCRIPT="data/transcripts/ep${EP_PAD}.txt"
if [ -f "$TRANSCRIPT" ]; then
  echo ""
  echo "[2/5] 轉錄已存在，跳過：$TRANSCRIPT"
else
  echo ""
  echo "[2/5] 01_download_transcribe.py --ep $LATEST_EP"
  $PYTHON scripts/pipeline/01_download_transcribe.py --ep "$LATEST_EP" \
    || { echo "ERROR: 轉錄失敗"; exit 1; }
fi

# ── Step 3: 萃取地標 ───────────────────────────────────────────────────────
LANDMARKS="data/episode_landmarks/ep${EP_PAD}.json"
if [ -f "$LANDMARKS" ]; then
  echo ""
  echo "[3/5] 地標已存在，跳過：$LANDMARKS"
else
  echo ""
  echo "[3/5] 02_extract_landmarks.py --ep $LATEST_EP"
  $PYTHON scripts/pipeline/02_extract_landmarks.py --ep "$LATEST_EP" \
    || { echo "ERROR: 地標萃取失敗"; exit 1; }
fi

# ── Step 4: 補 Wikipedia 圖片 ──────────────────────────────────────────────
echo ""
echo "[4/5] 03_fetch_wikipedia_images.py --ep $LATEST_EP"
$PYTHON scripts/pipeline/03_fetch_wikipedia_images.py --ep "$LATEST_EP" \
  || echo "WARNING: Wikipedia 圖片抓取部分失敗（不影響地圖）"

# ── Step 5: 重建全局地標 ────────────────────────────────────────────────────
echo ""
echo "[5/5] 04_build_landmarks.py"
$PYTHON scripts/pipeline/04_build_landmarks.py \
  || { echo "ERROR: 重建 landmarks_global.json 失敗"; exit 1; }

# ── 統計 ────────────────────────────────────────────────────────────────────
LM_COUNT=$($PYTHON -c "
import json
with open('data/landmarks_global.json') as f:
    lms = json.load(f)
print(len(lms))
")

echo ""
echo "══════════════════════════════════════"
echo "  DONE   $(date '+%Y-%m-%d %H:%M:%S')"
echo "  Ep.$LATEST_EP 處理完成，共 $LM_COUNT 個地標"
echo "══════════════════════════════════════"

# ── Deploy：git commit + push（git remote 設定後自動生效）────────────────────
GIT="/usr/bin/git"
if $GIT -C "$PODCAST_DIR" rev-parse --is-inside-work-tree > /dev/null 2>&1; then
  echo ""
  echo "[deploy] git commit + push"
  $GIT -C "$PODCAST_DIR" add \
    data/episodes.json \
    data/landmarks_global.json \
    data/episode_landmarks/ep${EP_PAD}.json
  # 只有真的有變更時才 commit
  if ! $GIT -C "$PODCAST_DIR" diff --cached --quiet; then
    $GIT -C "$PODCAST_DIR" commit -m "auto: Ep.${LATEST_EP} 地標更新（${LM_COUNT} 個地標）"
    $GIT -C "$PODCAST_DIR" push \
      && echo "  ✓ push 完成" \
      || echo "  ERROR: push 失敗，請手動 push"
  else
    echo "  無變更，跳過 commit"
  fi
else
  echo ""
  echo "[deploy] git 尚未初始化，跳過（設定好 GitHub 後自動生效）"
fi
