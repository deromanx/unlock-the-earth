#!/usr/bin/env bash
# 新集數上地圖：放逐字稿 → 抽地標（Claude，訂閱額度）→ 收尾（補圖、重建、commit + push）
# /podcast-post 清理完逐字稿後自動呼叫；也可以手動跑。
#
#   bash scripts/add_episode.sh 289 "/path/to/Ep.289_v1_clean.txt"   # 用現成的逐字稿（不必重轉）
#   bash scripts/add_episode.sh 289                                    # 沒有逐字稿：從 RSS 下載音檔轉錄（集數要已上架）
#
# 集數還沒出現在 RSS 時，地標檔會先 commit；等 GitHub Actions 每天抓到 RSS 後自動重建，地球上才會出現。
set -u
cd "$(dirname "$0")/.." || exit 1
EP="${1:?用法：bash scripts/add_episode.sh <集數> [逐字稿路徑]}"
SRC="${2:-}"
TXT="data/transcripts/ep$(printf %03d "$EP").txt"

if [ -n "$SRC" ]; then
  cp "$SRC" "$TXT" || exit 1
  echo "[1/3] 逐字稿：$SRC → $TXT"
else
  echo "[1/3] 下載音檔並轉錄"
  python3 -u scripts/pipeline/01_download_transcribe.py --ep "$EP" --force || exit 1
fi

echo "[2/3] 抽地標（Claude）"
python3 -u scripts/pipeline/02_extract_landmarks.py --engine claude --force --ep "$EP" || exit 1
grep -qx "$EP" data/reextract_done.txt || echo "$EP" >> data/reextract_done.txt

echo "[3/3] 收尾"
bash scripts/finish_data_update.sh "data: Ep.$EP 地標"
