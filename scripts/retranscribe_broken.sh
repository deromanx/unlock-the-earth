#!/usr/bin/env bash
# 重轉幻覺迴圈吃掉內容的逐字稿（transcript_quality.py --severe 列出的集數），再重抽地標。
# 每集下載＋轉錄約 15–20 分鐘，31 集約 8–10 小時，建議背景跑或放過夜。可中斷，重跑會跳過已修好的集數。
#
#   bash scripts/retranscribe_broken.sh            # 全部嚴重集數
#   LIMIT=5 bash scripts/retranscribe_broken.sh    # 這次只處理 5 集
set -u
cd "$(dirname "$0")/.." || exit 1
EPS=$(python3 scripts/transcript_quality.py --severe | head -n "${LIMIT:-999}")
[ -z "$EPS" ] && { echo "沒有需要重轉的集數"; exit 0; }
echo "要重轉：$(echo $EPS | wc -w | tr -d ' ') 集（$(echo $EPS | tr '\n' ' ')）"

fixed=0
for ep in $EPS; do
  echo "══ Ep.$ep  $(date '+%H:%M')"
  python3 -u scripts/pipeline/01_download_transcribe.py --ep "$ep" --force || continue
  python3 -u scripts/pipeline/02_extract_landmarks.py --engine claude --force --ep "$ep" && fixed=$((fixed + 1))
done

echo "重轉並重抽成功 $fixed 集"
[ "$fixed" -gt 0 ] && bash scripts/finish_data_update.sh "data: 重轉 $fixed 集幻覺迴圈的逐字稿並重抽地標"
python3 scripts/transcript_quality.py | tail -1
