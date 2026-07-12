"""
SRT与LAB修正结果粗比对：找出被LAB错误覆盖的条目，还原为SRT原文。
策略：逐时间戳匹配SRT，文本相似度<0.5 或 长度差异>2x 则判定为错配。
"""
import sys, json, re
from pathlib import Path
from difflib import SequenceMatcher

sys.stdout.reconfigure(line_buffering=True)

SRT_DIR = Path(r"C:\Users\origin\Downloads")
FIXED_JSON = Path(r"D:\cortex\bili_frames\ocr_output\ocr_dialogue_fixed.json")
OUTPUT_JSON = Path(r"D:\cortex\bili_frames\ocr_output\ocr_dialogue_fixed.json")
OUTPUT_TXT = Path(r"D:\cortex\bili_frames\ocr_output\ocr_dialogue_fixed.txt")
REPORT = Path(r"D:\cortex\bili_frames\ocr_output\srt_crosscheck_report.txt")

def load_srt(filepath):
    """加载SRT -> {mid_seconds: text}"""
    content = Path(filepath).read_text(encoding="utf-8")
    blocks = re.split(r"\n\s*\n", content.strip())
    entries = {}
    for block in blocks:
        lines = block.strip().split("\n")
        if len(lines) < 3:
            continue
        m = re.match(r"(\d+):(\d+):(\d+)[.,](\d+)\s*-->\s*(\d+):(\d+):(\d+)[.,](\d+)", lines[1])
        if not m:
            continue
        g = list(map(int, m.groups()))
        start = g[0]*3600 + g[1]*60 + g[2] + g[3]/1000
        end = g[4]*3600 + g[5]*60 + g[6] + g[7]/1000
        mid = (start + end) / 2
        text = " ".join(lines[2:]).strip()
        entries[mid] = text
    return entries

def clean_text(text):
    return re.sub(r'[，。！？、；：""''（）《》【】…—\-,\.!\?;:\(\)\[\]\"\'~\\/@#$%^&*+=|<>`\s]', '', text)

def time_to_sec(ts):
    """00:00:00,000 -> seconds"""
    m = re.match(r"(\d+):(\d+):(\d+)[.,](\d+)", ts)
    g = list(map(int, m.groups()))
    return g[0]*3600 + g[1]*60 + g[2] + g[3]/1000

print("1. 加载SRT...")
srt_files = {
    "3.4": sorted(SRT_DIR.glob("*3.4*主线*.srt"))[0],
    "3.5": sorted(SRT_DIR.glob("*3.5*主线*.srt"))[0],
    "3.6": sorted(SRT_DIR.glob("*3.6*主线*.srt"))[0],
    "3.7": sorted(SRT_DIR.glob("*3.7*主线*.srt"))[0],
}
srt_data = {}
for v, f in srt_files.items():
    srt_data[v] = load_srt(f)
    print(f"   {v}: {len(srt_data[v])} 条")

print("2. 加载修正结果...")
data = json.loads(FIXED_JSON.read_text(encoding="utf-8"))
print(f"   共 {len(data)} 条")

print("3. 逐时间戳比对...")
report_lines = []
mismatches_by_version = {}
reverted_total = 0

for i, entry in enumerate(data):
    v = entry["v"]
    if v not in srt_data:
        continue
    
    mid = time_to_sec(entry["start"])
    srt_dict = srt_data[v]
    
    # 找最接近的时间戳（容差1s内）
    best_mid = None
    best_dist = 999
    for smid in srt_dict:
        dist = abs(smid - mid)
        if dist < best_dist:
            best_dist = dist
            best_mid = smid
    
    if best_dist > 2.0:  # 超过2秒没匹配到
        continue
    
    srt_text = srt_dict[best_mid]
    fixed_text = entry["text"]
    
    # 完全一致跳过
    if srt_text == fixed_text:
        continue
    
    ct1 = clean_text(srt_text)
    ct2 = clean_text(fixed_text)
    
    sim = SequenceMatcher(None, ct1, ct2).ratio()
    len_ratio = max(len(ct1), len(ct2)) / max(1, min(len(ct1), len(ct2)))
    
    # 判定错配：相似度<0.5 或 长度比>2.5
    is_mismatch = sim < 0.5 or len_ratio > 2.5
    
    if is_mismatch:
        # 还原为SRT原文
        entry["text"] = srt_text
        if "lab_match" in entry:
            del entry["lab_match"]
        if "match_score" in entry:
            del entry["match_score"]
        reverted_total += 1
        mismatches_by_version.setdefault(v, []).append((i, srt_text, fixed_text, sim))
    
    if (i + 1) % 500 == 0:
        print(f"   {i+1}/{len(data)} reverted={reverted_total}")

# 输出报告
print(f"\n4. 生成报告... 共还原 {reverted_total} 条")
with open(REPORT, "w", encoding="utf-8") as f:
    f.write(f"SRT交叉比对报告\n{'='*60}\n")
    f.write(f"总计还原: {reverted_total} 条\n\n")
    for v in ["3.4", "3.5", "3.6", "3.7"]:
        items = mismatches_by_version.get(v, [])
        f.write(f"\n## {v}: {len(items)} 条错配\n")
        f.write(f"{'-'*60}\n")
        for idx, srt_t, fixed_t, sim in items[:50]:  # 只写前50条
            f.write(f"  [#{idx}] sim={sim:.2f}\n")
            f.write(f"    SRT:   {srt_t[:60]}\n")
            f.write(f"    LAB:   {fixed_t[:60]}\n")
        if len(items) > 50:
            f.write(f"  ... 还有 {len(items)-50} 条省略\n")

# 统计
print(f"\n=== 错配统计 ===")
for v in ["3.4", "3.5", "3.6", "3.7"]:
    items = mismatches_by_version.get(v, [])
    total_in_v = sum(1 for d in data if d["v"] == v)
    print(f"  {v}: {len(items)}/{total_in_v} ({len(items)/max(1,total_in_v)*100:.1f}%)")

# 保存
print("\n5. 保存...")
with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

with open(OUTPUT_TXT, "w", encoding="utf-8") as f:
    for r in data:
        f.write(f"[{r['v']}] {r['char']} | {r['text']} | {r['start']} --> {r['end']}\n")

print(f"\n[REPORT] {REPORT}")
print(f"[JSON] {OUTPUT_JSON}")
print(f"[TXT] {OUTPUT_TXT}")
print("完成!")
