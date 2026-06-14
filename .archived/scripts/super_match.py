"""Super match: Wiki calibration for main story + cross-SRT dedup for sidelines/events."""
import json
import re
from difflib import SequenceMatcher

# ===== Version config =====
MAIN_VERSIONS = {
    '3.4': r'd:\cortex\3.4剧情.txt',
    '3.5': r'd:\cortex\3.5剧情.txt',
    '3.6': r'd:\cortex\3.6剧情.txt',
    '3.7': r'd:\cortex\3.7剧情.txt',
}

# All SRT-only version tags that need cross-SRT verification
SRT_ONLY_TAGS = [
    '3.4-sideline-01', '3.4-sideline-02', '3.4-sideline-03',
    '3.4-sideline-05', '3.4-sideline-06',
    '3.4-sideline-08', '3.4-sideline-09', '3.4-sideline-10',
    '3.4-sideline-11', '3.4-sideline-12', '3.4-sideline-13',
    '3.4-sideline-14', '3.4-sideline-15', '3.4-sideline-16',
    '3.4-sideline-17', '3.4-sideline-18',
    '3.5-ev-gold',
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
    ('提宝', '缇宝'), ('辉宝', '缇宝'),
    ('纳克夏', '那刻夏'), ('赛菲尔', '赛飞儿'), ('万迪', '万敌'),
    ('克里德拉', '刻律德菈'), ('玄风尘', '万敌'),
    ('麦德莫斯', '迈德漠斯'), ('小莲', '小涟'), ('奥赫马', '奥赫玛'),
]

poem_speakers = {
    '欧呵！恐惧令他的心震颤', '但一切皆为徒劳', '说啊，倘若刻法勒永志不忘',
    '听我说，你与她们无异', '英雄撕裂天空', '多么可敬',
    '去！尽管独自向前', '狂欢', '残缺的黄金裔',
    '奥赫玛人', '至于卡厄斯兰那', '相信我吧',
    '可悲的伶人', '倒是你，披着羊皮的救世主',
}

def clean_for_match(s):
    return re.sub(r'[，。！？、…—""''「」『』♪\\s]', '', s)

def similarity(a, b):
    ca = clean_for_match(a)
    cb = clean_for_match(b)
    if not ca or not cb:
        return 0
    return SequenceMatcher(None, ca, cb).ratio()

def is_skip_line(line):
    if not line.strip():
        return True
    for kw in ['剧情梗概', '折叠', '过场动画', '剧情选项', '图标-位置',
               '进入战斗', '获得胜利', '跟随', '觐见', '见证', '抓回',
               '施展', '时间开始流动', '距离世界毁灭', '最后一次',
               '我方释放', '的血量降低', '强力一击', '释放【', '你还记得',
               '额外对话', '调查', '接近', '等待', '探索', '回收',
               '寻找', '观察', '前往', '回到', '离开', '击败',
               '每场远征', '你试着触碰', '你感到', '不对劲',
               '别忘了带走', '…识刻锚', '与此同时']:
        if kw in line:
            return True
    if re.match(r'^>>>|^█|^—', line):
        return True
    if re.match(r'^第?\d+次永劫回归|^永劫回归', line):
        return True
    if line in ['……', '…']:
        return True
    if line.startswith('「'):
        return True
    return False

def parse_wiki(filepath):
    """Parse wiki text into [{speaker, text}]"""
    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.read().split('\n')
    dialogues = []
    for line in lines:
        line = line.strip()
        if is_skip_line(line):
            continue
        m = re.match(r'^(.+?)[：:](.+)$', line)
        if not m:
            continue
        speaker = m.group(1).strip()
        text = m.group(2).strip()
        if speaker in poem_speakers:
            continue
        if re.match(r'^[「].*[」]', speaker) and ('释放' in line or '血量' in line):
            continue
        dialogues.append({'speaker': speaker, 'text': text})
    return dialogues

def apply_ocr_fixes(text):
    for wrong, right in OCR_FIXES:
        if wrong != right:
            text = text.replace(wrong, right)
    return text

# ===== Load current corrected data =====
input_path = r'd:\cortex\bili_frames\ocr_output\ocr_dialogue_wiki_corrected.json'
with open(input_path, 'r', encoding='utf-8') as f:
    data = json.load(f)

print(f"Loaded {len(data)} total entries")

# ===== Phase 1: Wiki calibration for main story =====
print("\n=== Phase 1: Wiki Calibration ===")
wiki_calibrated = 0
wiki_replaced = 0

for version, wiki_path in MAIN_VERSIONS.items():
    wiki = parse_wiki(wiki_path)
    print(f"\n  {version}: wiki has {len(wiki)} dialogues, SRT has {sum(1 for e in data if e['v'] == version)} entries")
    
    for entry in data:
        if entry['v'] != version:
            continue
        
        srt_text = entry['text']
        best_sim = 0
        best_wiki = None
        
        for wd in wiki:
            sim = similarity(srt_text, wd['text'])
            if sim > best_sim:
                best_sim = sim
                best_wiki = wd
        
        # Apply OCR fixes first
        entry['text'] = apply_ocr_fixes(entry['text'])
        
        if best_sim >= 0.75 and best_wiki:
            old_text = entry['text']
            entry['text'] = best_wiki['text']
            if old_text != best_wiki['text']:
                wiki_replaced += 1
            wiki_calibrated += 1

print(f"\n  Wiki calibrated: {wiki_calibrated}, text replaced: {wiki_replaced}")

# ===== Phase 2: Cross-SRT dedup for SRT-only sources =====
print("\n=== Phase 2: Cross-SRT Dedup ===")
srt_entries = [e for e in data if e['v'] in SRT_ONLY_TAGS]
print(f"  SRT-only entries: {len(srt_entries)}")

# Build pool of "trusted" text from main story wiki
wiki_pool = []
for version, wiki_path in MAIN_VERSIONS.items():
    wiki = parse_wiki(wiki_path)
    wiki_pool.extend(wiki)

dedup_fixed = 0
for entry in srt_entries:
    entry['text'] = apply_ocr_fixes(entry['text'])
    
    # First, try to match against wiki pool (cross-source verification)
    srt_text = entry['text']
    best_wiki_sim = 0
    best_wiki_text = None
    
    for wd in wiki_pool:
        sim = similarity(srt_text, wd['text'])
        if sim > best_wiki_sim:
            best_wiki_sim = sim
            best_wiki_text = wd['text']
    
    if best_wiki_sim >= 0.9 and best_wiki_text:
        # Near-perfect match to wiki - use wiki text as ground truth
        if srt_text != best_wiki_text:
            entry['text'] = best_wiki_text
            dedup_fixed += 1
        continue
    
    # If no wiki match, cross-check against OTHER SRT-only entries with same text
    for other in srt_entries:
        if other is entry or other['v'] == entry['v']:
            continue
        sim = similarity(srt_text, other['text'])
        if sim >= 0.95:
            # Near-identical: keep the longer one
            if len(other['text']) > len(entry['text']):
                entry['text'] = other['text']
                dedup_fixed += 1
                break

print(f"  Cross-SRT dedup fixes: {dedup_fixed}")

# ===== Phase 3: Final OCR pass on ALL entries =====
print("\n=== Phase 3: Final OCR Pass ===")
ocr_fixed_count = 0
for entry in data:
    old = entry['text']
    entry['text'] = apply_ocr_fixes(old)
    if old != entry['text']:
        ocr_fixed_count += 1

print(f"  OCR fixes applied: {ocr_fixed_count}")

# ===== Save =====
output_path = input_path  # overwrite same file
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

# ===== Summary =====
print(f"\n{'='*50}")
print(f"=== FINAL SUMMARY ===")
ver_counts = {}
for e in data:
    v = e['v']
    ver_counts[v] = ver_counts.get(v, 0) + 1
for v in sorted(ver_counts.keys()):
    print(f"  {v}: {ver_counts[v]}")
print(f"  TOTAL: {len(data)}")
