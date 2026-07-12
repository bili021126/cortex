"""Batch import SRT-only sources into unified corrected JSON index."""
import json
import re
import os

# ===== Configuration =====
SRT_SOURCES = [
    # (srt_path, version_tag, description)
    # 3.4 支线合集 (from昔涟全剧情 BV1ak3WzwEPW)
    (r"C:\Users\origin\Downloads\【3.4支线①】送给开拓者的见面礼_哔哩哔哩_bilibili_BV1ak3WzwEPW_字幕.srt",
     "3.4-sideline-01", "送给开拓者的见面礼"),
    (r"C:\Users\origin\Downloads\【3.4支线②】为开拓者留影_哔哩哔哩_bilibili_BV1ak3WzwEPW_字幕.srt",
     "3.4-sideline-02", "为开拓者留影"),
    (r"C:\Users\origin\Downloads\【3.4支线③】同开拓者看风景_哔哩哔哩_bilibili_BV1ak3WzwEPW_字幕.srt",
     "3.4-sideline-03", "同开拓者看风景"),
    (r"C:\Users\origin\Downloads\【3.4支线⑤】一起钓鱼_哔哩哔哩_bilibili_BV1ak3WzwEPW_字幕.srt",
     "3.4-sideline-05", "一起钓鱼"),
    (r"C:\Users\origin\Downloads\【3.4支线⑥】小海豹的比试_哔哩哔哩_bilibili_BV1ak3WzwEPW_字幕.srt",
     "3.4-sideline-06", "小海豹的比试"),
    (r"C:\Users\origin\Downloads\【3.4支线⑧】小奇美拉_哔哩哔哩_bilibili_BV1ak3WzwEPW_字幕.srt",
     "3.4-sideline-08", "小奇美拉"),
    (r"C:\Users\origin\Downloads\【3.4支线⑨】小奇美拉（后续）_哔哩哔哩_bilibili_BV1ak3WzwEPW_字幕.srt",
     "3.4-sideline-09", "小奇美拉（后续）"),
    (r"C:\Users\origin\Downloads\【3.4支线⑩】偷袭睡觉的开拓者_哔哩哔哩_bilibili_BV1ak3WzwEPW_字幕.srt",
     "3.4-sideline-10", "偷袭睡觉的开拓者"),
    (r"C:\Users\origin\Downloads\【3.4支线⑪】风铃上的魔法_哔哩哔哩_bilibili_BV1ak3WzwEPW_字幕.srt",
     "3.4-sideline-11", "风铃上的魔法"),
    (r"C:\Users\origin\Downloads\【3.4支线⑫】大地兽_哔哩哔哩_bilibili_BV1ak3WzwEPW_字幕.srt",
     "3.4-sideline-12", "大地兽"),
    (r"C:\Users\origin\Downloads\【3.4支线⑬】迷路迷境中的经历_哔哩哔哩_bilibili_BV1ak3WzwEPW_字幕.srt",
     "3.4-sideline-13", "迷路迷境中的经历"),
    (r"C:\Users\origin\Downloads\【3.4支线⑭】同床共枕（1）_哔哩哔哩_bilibili_BV1ak3WzwEPW_字幕.srt",
     "3.4-sideline-14", "同床共枕（1）"),
    (r"C:\Users\origin\Downloads\【3.4支线⑮】同床共枕（2）_哔哩哔哩_bilibili_BV1ak3WzwEPW_字幕.srt",
     "3.4-sideline-15", "同床共枕（2）"),
    (r"C:\Users\origin\Downloads\【3.4支线⑯】海的那边_哔哩哔哩_bilibili_BV1ak3WzwEPW_字幕.srt",
     "3.4-sideline-16", "海的那边"),
    (r"C:\Users\origin\Downloads\【3.4支线⑰】金色的湖面_哔哩哔哩_bilibili_BV1ak3WzwEPW_字幕.srt",
     "3.4-sideline-17", "金色的湖面"),
    (r"C:\Users\origin\Downloads\【3.4支线⑱】终将再起的涟漪_哔哩哔哩_bilibili_BV1ak3WzwEPW_字幕.srt",
     "3.4-sideline-18", "终将再起的涟漪"),
    # 3.5 活动
    (r"C:\Users\origin\Downloads\【星穹铁道4K】3.5版本-活动「黄金迷境大饭店」全剧情流程_BV1cUbBzKEYT_字幕.srt",
     "3.5-ev-gold", "黄金迷境大饭店"),
]

OCR_FIXES = [
    ('温法罗斯', '翁法罗斯'), ('温法螺丝', '翁法罗斯'), ('光法罗丝', '翁法罗斯'),
    ('艾力密歇', '哀丽秘榭'), ('爱丽密谢', '哀丽秘榭'), ('埃利密歇', '哀丽秘榭'),
    ('艾利密歇', '哀丽秘榭'), ('爱力密歇', '哀丽秘榭'),
    ('白娥', '白厄'), ('看饿斯兰娜', '卡厄斯兰那'),
    ('希林', '昔涟'), ('希联', '昔涟'), ('希莲', '昔涟'), ('希怜', '昔涟'), ('西莲', '昔涟'),
    ('刻律德拉', '刻律德菈'), ('克里德拉', '刻律德菈'),
    ('烛火之旅', '逐火之旅'), ('烛火', '逐火'),
    ('心神', '星神'), ('父世', '负世'), ('批示', '瞥视'),
    ('岁月半神', '岁月"半神'), ('进步的梦', '近乎永恒'),
    ('米路米进', '迷鹿迷境'), ('麋鹿迷境', '迷鹿迷境'), ('迷路迷境', '迷鹿迷境'),
    ('埃利密歇', '哀丽秘榭'),
    ('提宝', '缇宝'), ('辉宝', '缇宝'),
    ('纳克夏', '那刻夏'), ('赛菲尔', '赛飞儿'), ('万迪', '万敌'), ('万敌', '万敌'),
    ('克里德拉', '刻律德菈'),
    ('玄风尘', '万敌'),
    ('麦德莫斯', '迈德漠斯'),
    ('阿格莱雅', '阿格莱雅'),
    ('小莲', '小涟'),
    ('奥赫马', '奥赫玛'),
    ('米', '迷'),  # NPC妖精语气词修正
]

# SRT timestamp format: HH:MM:SS,mmm
SRT_RE = re.compile(r'(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})')

def parse_srt(filepath):
    """Parse a single SRT file into [{'start': ts, 'text': line}, ...]"""
    entries = []
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Split by double newline (SRT block separator)
    blocks = re.split(r'\n\s*\n', content.strip())
    
    for block in blocks:
        lines = block.strip().split('\n')
        if len(lines) < 3:
            continue
        # Line 0: index (skip), Line 1: timestamps, Lines 2+: text
        ts_match = SRT_RE.search(lines[1])
        if not ts_match:
            continue
        start_ts = ts_match.group(1).replace(',', '.')
        text = ' '.join(lines[2:]).strip()
        # Skip empty/whitespace-only texts
        if not text or text.isspace():
            continue
        entries.append({'start': start_ts, 'text': text})
    
    return entries

def apply_fixes(text):
    fixed = text
    for wrong, right in OCR_FIXES:
        if wrong != right:
            fixed = fixed.replace(wrong, right)
    return fixed

# ===== Load existing corrected data =====
output_path = r'd:\cortex\bili_frames\ocr_output\ocr_dialogue_wiki_corrected.json'
with open(output_path, 'r', encoding='utf-8') as f:
    existing = json.load(f)

existing_count = len(existing)
print(f"Existing entries: {existing_count}")

# ===== Process each SRT source =====
total_added = 0
for srt_path, version_tag, desc in SRT_SOURCES:
    if not os.path.exists(srt_path):
        print(f"  SKIP (not found): {desc}")
        continue
    
    entries = parse_srt(srt_path)
    count = 0
    for e in entries:
        fixed_text = apply_fixes(e['text'])
        existing.append({
            'v': version_tag,
            'char': '昔涟',
            'start': e['start'],
            'text': fixed_text,
        })
        count += 1
    
    print(f"  {desc}: {count} entries")
    total_added += count

print(f"\nTotal added: {total_added}")
print(f"Total in output: {len(existing)}")

# ===== Save =====
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(existing, f, ensure_ascii=False, indent=2)

print(f"\nSaved to {output_path}")

# ===== Summary by version =====
ver_counts = {}
for e in existing:
    v = e['v']
    ver_counts[v] = ver_counts.get(v, 0) + 1
print("\n=== Full Index Summary ===")
for v in sorted(ver_counts.keys()):
    print(f"  {v}: {ver_counts[v]}")
