#!/usr/bin/env python3
"""
Pipeline Step 2: Extract landmarks from transcripts using Gemini CLI.
Reads data/transcripts/ep{num:03d}.txt, outputs data/episode_landmarks/ep{num:03d}.json.

Output format per episode:
[
  {
    "name": "景點中文名",
    "name_en": "Landmark English Name",
    "lat": 25.0330,
    "lon": 121.5654,
    "country": "台灣",
    "region": "亞洲",
    "quote": "逐字稿原文片段（50字以內）",
    "context": "簡短摘要（30字以內）"
  },
  ...
]

Usage:
  python3 scripts/pipeline/02_extract_landmarks.py              # all episodes
  python3 scripts/pipeline/02_extract_landmarks.py --ep 266     # single episode
  python3 scripts/pipeline/02_extract_landmarks.py --start 200  # from ep 200
"""
import json, os, subprocess, sys, argparse, re, time, tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT            = Path(__file__).parent.parent.parent
TRANSCRIPT_DIR  = ROOT / 'data' / 'transcripts'
OUTPUT_DIR      = ROOT / 'data' / 'episode_landmarks'
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
# Gemini CLI 會掃描 cwd 載入專案脈絡；在空目錄執行避免拖慢
GEMINI_CWD      = tempfile.mkdtemp(prefix='gemini_cwd_')
# 禁用工具：Gemini 會自行呼叫 google_web_search 查座標，一集吃掉多次請求、燒光每日免費額度
_settings_dir = Path(GEMINI_CWD) / '.gemini'
_settings_dir.mkdir()
_NO_TOOLS = ['google_web_search', 'web_fetch', 'run_shell_command', 'read_file', 'read_many_files',
             'list_directory', 'glob', 'search_file_content', 'write_file', 'replace', 'save_memory']
(_settings_dir / 'settings.json').write_text(json.dumps({'tools': {'exclude': _NO_TOOLS}, 'excludeTools': _NO_TOOLS}))
GEMINI_MODEL    = 'gemini-2.5-flash'

REGIONS = ['亞洲', '歐洲', '美洲', '非洲', '大洋洲', '極地', '台灣']

GEMINI_PROMPT_TEMPLATE = """你是地理知識專家。以下是一集旅遊 Podcast 的逐字稿（繁體中文/簡體中文混合）。

請從逐字稿中找出**具體的地理地標**，包括：
- 特定景點、廣場、建築物、街道、市場、公園、教堂、博物館
- 特定社區、街區、城區（如：布里克斯頓、唐人街）
- 可在地圖上標示的地名（排除國家、省份、大城市等過於廣泛的地名）

對每個地標輸出 JSON 陣列，格式如下（只回覆純 JSON，不要 markdown code block）：
[
  {{
    "name": "景點中文名稱",
    "name_en": "Landmark English Name",
    "lat": 緯度數字,
    "lon": 經度數字,
    "country": "所在國家（中文）",
    "region": "亞洲|歐洲|美洲|非洲|大洋洲|極地|台灣 之一",
    "quote": "逐字稿原文中最能體現此地標的一句話（50字以內，直接截取原文）",
    "context": "此地標在節目中的重要性或討論內容（30字以內）",
    "relevance": 1
  }}
]

**relevance 欄位定義（必填，整數 1–3）：**
- 3 = 核心地標：本集主要討論的地點，有詳細的故事、歷史、文化或旅遊脈絡
- 2 = 實質提及：有具體描述或說明，但非本集主軸
- 1 = 隨口帶過：僅作為比喻、舉例或一句話帶過，無實質內容（例：「就像東京那樣」）

規則：
- lat/lon 必須是精確的數字（小數點後至少 3 位）
- region 只能是上列 7 個選項之一
- 若逐字稿沒有提到具體地標，回傳空陣列 []
- 排除：整個國家、整個城市（除非是小城市）、大陸洲際地名
- 最多回傳 30 個地標（優先保留 relevance 2–3）
- 不要使用任何工具或網路搜尋，座標直接依你的地理知識給出
- quote 必須是逐字稿中的原文，不要改寫內容；但逐字稿若為簡體字，quote 一律轉為繁體中文（台灣用字）
- name、country、context 一律使用繁體中文（台灣用字）

逐字稿（集數 {ep_num}）：
{transcript}
"""

class QuotaExceeded(Exception):
    pass

def already_done(ep_num, since=None):
    path = OUTPUT_DIR / f"ep{ep_num:03d}.json"
    if not path.exists():
        return False
    # --since：只把該時間點之後寫入的檔案視為完成（供 --force 全量重跑時續跑）
    return since is None or path.stat().st_mtime >= since

def get_available_eps():
    eps = []
    for f in TRANSCRIPT_DIR.glob("ep*.txt"):
        m = re.match(r'ep(\d+)\.txt', f.name)
        if m:
            eps.append(int(m.group(1)))
    return sorted(eps)

def extract_landmarks(ep_num, prompt_template=GEMINI_PROMPT_TEMPLATE, min_relevance=2):
    transcript_path = TRANSCRIPT_DIR / f"ep{ep_num:03d}.txt"
    output_path = OUTPUT_DIR / f"ep{ep_num:03d}.json"

    text = transcript_path.read_text(encoding='utf-8').strip()
    if not text:
        print(f"  Empty transcript for Ep.{ep_num}, skipping")
        output_path.write_text('[]', encoding='utf-8')
        return True

    prompt = prompt_template.format(ep_num=ep_num, transcript=text)

    # Clear NODE_OPTIONS to prevent Claude Code's temp file from breaking Gemini CLI
    clean_env = {k: v for k, v in os.environ.items() if k != 'NODE_OPTIONS'}
    try:
        result = subprocess.run(
            ['gemini', '-m', GEMINI_MODEL, '--sandbox=false', '-p', prompt],
            capture_output=True, text=True, timeout=300,
            env=clean_env, input='\n', cwd=GEMINI_CWD,
        )
        if result.returncode != 0:
            err = result.stderr
            print(f"  Gemini error: {err[:200]}")
            if re.search(r'429|quota|RESOURCE_EXHAUSTED|rate limit', err, re.I):
                raise QuotaExceeded(err[:200])
            return False
    except subprocess.TimeoutExpired:
        print(f"  Timeout for Ep.{ep_num}")
        return False

    raw = result.stdout.strip()

    # Strip interactive prompts that leak to stdout in non-TTY mode (e.g. "[Y/n]")
    raw = re.sub(r'\[Y/n\]', '', raw)
    # Strip markdown code blocks if present
    raw = re.sub(r'^```(?:json)?\s*', '', raw, flags=re.MULTILINE)
    raw = re.sub(r'```\s*$', '', raw, flags=re.MULTILINE)
    raw = raw.strip()

    # Find JSON array
    start = raw.find('[')
    end = raw.rfind(']')
    if start == -1 or end == -1:
        print(f"  No JSON array found in Gemini output for Ep.{ep_num}")
        print(f"  Raw output: {raw[:300]}")
        return False

    json_str = raw[start:end+1]
    try:
        landmarks = json.loads(json_str)
    except json.JSONDecodeError as e:
        print(f"  JSON parse error for Ep.{ep_num}: {e}")
        print(f"  JSON string: {json_str[:300]}")
        return False

    # Validate and clean entries
    valid = []
    for lm in landmarks:
        if not all(k in lm for k in ('name', 'lat', 'lon')):
            continue
        try:
            lat = float(lm['lat'])
            lon = float(lm['lon'])
        except (TypeError, ValueError):
            continue
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            continue
        # Ensure region is valid
        if lm.get('region') not in REGIONS:
            lm['region'] = '亞洲'  # default
        relevance = int(lm.get('relevance', 2))
        if relevance < min_relevance:
            continue
        valid.append({
            'name':    lm.get('name', ''),
            'name_en': lm.get('name_en', ''),
            'lat':     round(lat, 5),
            'lon':     round(lon, 5),
            'country': lm.get('country', ''),
            'region':  lm['region'],
            'quote':   lm.get('quote', ''),
            'context': lm.get('context', ''),
        })

    skipped = len(landmarks) - len(valid)
    tmp_path = output_path.with_suffix('.tmp')
    tmp_path.write_text(json.dumps(valid, ensure_ascii=False, indent=2), encoding='utf-8')
    tmp_path.replace(output_path)  # atomic rename
    skip_msg = f"，過濾掉 {skipped} 個低關聯地標" if skipped else ""
    print(f"  ✓ Ep.{ep_num}: {len(valid)} landmarks{skip_msg} → {output_path.name}")
    return True

def main():
    global GEMINI_MODEL
    parser = argparse.ArgumentParser()
    parser.add_argument('--ep',            type=int,   help='Single episode number')
    parser.add_argument('--start',         type=int,   default=1,   help='Start from episode number')
    parser.add_argument('--delay',         type=float, default=2.0, help='Delay between Gemini calls (seconds)')
    parser.add_argument('--prompt-file',   type=str,   help='Path to a custom Gemini prompt template')
    parser.add_argument('--min-relevance', type=int,   default=2,   help='Filter out landmarks below this relevance (1–3, default 2)')
    parser.add_argument('--force',         action='store_true',     help='Reprocess even if output already exists')
    parser.add_argument('--model',         type=str,   default=GEMINI_MODEL, help='Gemini model')
    parser.add_argument('--workers',       type=int,   default=1,   help='Parallel Gemini calls')
    parser.add_argument('--done-file',     type=str,                help='With --force: skip episodes listed in this file; append each success (resume)')
    parser.add_argument('--since',         type=float,              help='With --force: skip files written after this epoch time (resume)')
    args = parser.parse_args()

    custom_prompt = None
    if args.prompt_file:
        p = Path(args.prompt_file)
        if p.exists():
            custom_prompt = p.read_text(encoding='utf-8')
            print(f"Using custom prompt from: {args.prompt_file}")
        else:
            print(f"Error: Prompt file not found: {args.prompt_file}")
            sys.exit(1)

    prompt_template = custom_prompt if custom_prompt else GEMINI_PROMPT_TEMPLATE
    GEMINI_MODEL = args.model

    available = get_available_eps()
    if not available:
        print("No transcripts found in data/transcripts/. Run 01_download_transcribe.py first.")
        sys.exit(1)

    print(f"Found {len(available)} transcripts")

    if args.ep:
        eps = [args.ep]
    else:
        eps = [e for e in available if e >= args.start]

    done_file = Path(args.done_file) if args.done_file else None
    done_set = set()
    if done_file and done_file.exists():
        done_set = {int(x) for x in done_file.read_text().split()}
    if args.force and done_file:
        todo = [e for e in eps if e not in done_set]
    elif args.force:
        todo = [e for e in eps if args.since is not None and not already_done(e, args.since)] \
            if args.since is not None else eps
    else:
        todo = [e for e in eps if not already_done(e)]

    # 優先處理目前沒有任何地標資料的集數（檔案不存在或為空陣列）
    def has_data(e):
        f = OUTPUT_DIR / f"ep{e:03d}.json"
        return f.exists() and f.read_text(encoding='utf-8').strip() not in ('', '[]')
    todo.sort(key=lambda e: (has_data(e), e))
    print(f"To process: {len(todo)} (skipping {len(eps)-len(todo)} already done)\n")

    success = fail = 0
    failed = []
    quota_hit = False

    def run(ep_num):
        if quota_hit:
            return ep_num, None
        time.sleep(args.delay)
        return ep_num, extract_landmarks(ep_num, prompt_template, min_relevance=args.min_relevance)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(run, e) for e in todo]
        for i, fut in enumerate(as_completed(futures)):
            try:
                ep_num, ok = fut.result()
            except QuotaExceeded:
                quota_hit = True
                continue
            if ok is None:
                continue
            if ok:
                success += 1
                if done_file:
                    with done_file.open('a') as f:
                        f.write(f"{ep_num}\n")
            else:
                fail += 1
                failed.append(ep_num)
            print(f"[{i+1}/{len(todo)}] Ep.{ep_num} {'ok' if ok else 'FAILED'}", flush=True)

    if failed:
        print(f"Failed: {sorted(failed)}")
    if quota_hit:
        print(f"\n✗ Gemini 配額用盡（{success} 成功、{fail} 失敗）。之後用同一個 --since 續跑。")
        sys.exit(2)

    print(f"\n✓ Done: {success} succeeded, {fail} failed")
    print(f"Landmark files in: {OUTPUT_DIR}")

if __name__ == '__main__':
    main()
