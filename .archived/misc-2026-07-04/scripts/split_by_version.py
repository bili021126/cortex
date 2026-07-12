"""Split training manifest by version: 3.4 / 3.4支线 / 3.5 / 3.5活动 / 3.6 / 3.7"""
import json, re, os
from collections import defaultdict

def classify(e):
    fn = e['filename']
    fnl = fn.lower()
    src = e['source']
    sv = e.get('srt_version', '')
    
    # 3.5活动: shitang (黄金迷境大饭店)
    if 'shitang' in fnl:
        return '3.5活动'
    
    # 3.4支线: side4 but non-shitang (终将再起的涟漪) - 目前无独立音频
    if 'side4' in fnl and 'shitang' not in fnl:
        return '3.4支线'
    
    # Video_extract: extract version from filename pattern (3.4_decho, 3.5_decho, etc.)
    if src == 'video_extract':
        m = re.search(r'(\d\.\d)[_-]?decho', fnl)
        if m:
            return m.group(1)
    
    # For video_extract with explicit srt_version (fallback)
    if src == 'video_extract' and sv in ('3.4', '3.5', '3.6', '3.7'):
        return sv
    
    # For merged video clips (multi-version stack)
    if fnl.startswith('merged_decho'):
        return 'merged'
    
    # Chapter3/Chapter4 main story mapping
    m = re.search(r'chapter([34])[_-](\d+)', fnl)
    if m:
        ch = int(m.group(2))
        if m.group(1) == '3':
            return '3.4'
        if ch <= 20:
            return '3.4'
        elif ch <= 40:
            return '3.5'
        elif ch <= 61:
            return '3.6'
        else:
            return '3.7'
    
    # Try chapter4 from path
    voice_path = e.get('path', fn)
    m = re.search(r'chapter4[_-](\d+)', voice_path.lower())
    if m:
        ch = int(m.group(1))
        if ch <= 20: return '3.4'
        elif ch <= 40: return '3.5'
        elif ch <= 61: return '3.6'
        else: return '3.7'
    
    # Ambient files: extract version from v340/v350 etc.
    if fnl.startswith('vo_ambient'):
        m = re.search(r'v(\d)(\d)(\d)', fnl)
        if m:
            maj = int(m.group(1))
            if maj <= 4: return '3.4'
            elif maj <= 5: return '3.5'
            elif maj <= 6: return '3.6'
            else: return '3.7'
        return '3.4'
    
    # System voices (vo_syss) - extract version from v3xx
    if fnl.startswith('vo_syss'):
        m = re.search(r'v(\d)(\d{2})', fnl)
        if m:
            v = int(m.group(1))
            if v == 3: return '3.4'
            elif v == 4: return '3.5'
            elif v == 5: return '3.6'
            elif v == 6: return '3.7'
        return 'system'
    
    # Archive library
    if 'archive_cyrene' in fnl:
        return '3.4'
    
    if src == 'video_extract' and sv == 'merged':
        return 'merged'
    
    return 'other'

# Load
path = r'd:\cortex\bili_frames\ocr_output\training_manifest.json'
with open(path, 'r', encoding='utf-8') as f:
    man = json.load(f)

# Split
groups = defaultdict(list)
for e in man:
    ver = classify(e)
    e['_version'] = ver
    groups[ver].append(e)

# Stats
total = len(man)
print(f"Total: {total}\n")
for ver in ['3.4', '3.4支线', '3.5', '3.5活动', '3.6', '3.7', 'merged', 'system', 'other']:
    items = groups.get(ver, [])
    mapped = sum(1 for x in items if x.get('mapped'))
    if items:
        print(f"  {ver:10s} {len(items):5d}  (mapped: {mapped})")

# Save individual files to split/ directory
out_dir = r'd:\cortex\bili_frames\ocr_output\split'
os.makedirs(out_dir, exist_ok=True)

csv_lines = ['version,filename,path,voice,text,mapped']
for ver in ['3.4', '3.4支线', '3.5', '3.5活动', '3.6', '3.7', 'merged', 'system', 'other']:
    items = groups.get(ver, [])
    if not items:
        continue
    
    # Save JSON
    json_path = os.path.join(out_dir, f'{ver}.json')
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    
    # Also save text-only CSV for training
    csv_path = os.path.join(out_dir, f'{ver}.csv')
    with open(csv_path, 'w', encoding='utf-8') as f:
        f.write('filename,text\n')
        for e in items:
            if e.get('mapped') and e.get('text'):
                txt = e['text'].replace(',', '，')
                f.write(f'{e["filename"]},{txt}\n')
    
    csv_lines.append(f'{ver},{len(items)},{os.path.join(out_dir, f"{ver}.json")}')

with open(os.path.join(out_dir, '_index.csv'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(csv_lines))

print(f"\nSaved to: {out_dir}")
print(f"  JSON: 3.4.json, 3.4支线.json, 3.5.json, 3.5活动.json, 3.6.json, 3.7.json ...")
print(f"  CSV:  3.4.csv, 3.4支线.csv, 3.5.csv, 3.5活动.csv, 3.6.csv, 3.7.csv ...")
