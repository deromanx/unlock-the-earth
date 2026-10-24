#!/usr/bin/env bash
# 抽完地標後的共用收尾：補圖 → 重建地標總表 → 維基簡介 → 每集分享頁 → 資料版本號 → 檢查 → commit + push
# add_episode.sh、retranscribe_broken.sh、daily_extract.sh 都會呼叫
#
#   bash scripts/finish_data_update.sh "commit 訊息"
set -u
cd "$(dirname "$0")/.." || exit 1
MSG="${1:-data: 更新地標資料}"

echo "[收尾 1/6] Wikipedia 圖片（有快取）"
python3 -u scripts/pipeline/03_fetch_wikipedia_images.py > /dev/null || echo "  WARNING: 圖片抓取部分失敗"
echo "[收尾 2/6] 重建 landmarks_global.json"
python3 scripts/pipeline/04_build_landmarks.py | grep -E "Total landmarks|Written" || { echo "ERROR: 重建失敗"; exit 1; }
echo "[收尾 3/6] 維基百科補圖＋簡介（只查新地標）"
python3 -u scripts/pipeline/05_wikipedia_info.py | tail -2
echo "[收尾 4/6] 每集分享頁、封面配色與縮圖、最新一集聲紋"
python3 scripts/build_ep_pages.py
python3 scripts/build_episode_colors.py | tail -1
python3 scripts/build_cover_thumbs.py | tail -1
python3 scripts/build_waveform.py
echo "[收尾 5/6] 資料版本號"
python3 scripts/stamp_data_version.py
echo "[收尾 6/6] 資料檢查"
python3 scripts/check_site_data.py || { echo "ERROR: 資料檢查沒過，不 commit"; exit 1; }

git add data/episode_landmarks data/transcripts data/*.json data/*.txt ep/ assets/covers index.html
if git diff --cached --quiet; then
  echo "  無變更"
else
  git commit -q -m "$MSG" && git pull -q --rebase --autostash && git push -q && echo "  ✓ push 完成（GitHub Pages 約 1 分鐘後更新）"
fi
