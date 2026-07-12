"""为 3.4 音频文件按 迷迷/小昔涟 进行声线分类"""
import json, os

# 1. 加载文本索引，按位置标注声线
with open(r'd:\cortex\bili_frames\ocr_output\ocr_dialogue_wiki_corrected.json', 'r', encoding='utf-8') as f:
    texts = json.load(f)

v34_text = [t for t in texts if t['v'] == '3.4']
print(f"3.4 text entries: {len(v34_text)}")

# 标注声线 - 按 char 字段而非固定索引
for i, t in enumerate(v34_text):
    if t.get('char') == '往昔的涟漪':
        t['_voice_type'] = '迷迷'
    else:
        t['_voice_type'] = '小昔涟'

# 2. 加载 3.4 音频清单
with open(r'd:\cortex\bili_frames\ocr_output\split\3.4.json', 'r', encoding='utf-8') as f:
    audio = json.load(f)

print(f"3.4 audio entries: {len(audio)}")

# 3. 按文本匹配：音频 text ↔ 文本索引 text（精确匹配优先，模糊回退）
from difflib import SequenceMatcher

audio_with_text = [a for a in audio if a.get('text')]
print(f"  with mapped text: {len(audio_with_text)}")

matched = 0
fuzzy_matched = 0
unmatched = 0

for a in audio:
    atext = a.get('text')
    if not atext:
        a['_voice_type'] = '小昔涟'  # 无文本的默认小昔涟
        continue

    # 精确匹配
    found = None
    for t in v34_text:
        if t['text'] == atext:
            found = t
            break

    if found:
        a['_voice_type'] = found['_voice_type']
        matched += 1
        continue

    # 模糊匹配
    best_ratio = 0
    best_t = None
    for t in v34_text:
        ratio = SequenceMatcher(None, atext, t['text']).ratio()
        if ratio > best_ratio:
            best_ratio = ratio
            best_t = t

    if best_ratio >= 0.75 and best_t:
        a['_voice_type'] = best_t['_voice_type']
        fuzzy_matched += 1
    else:
        a['_voice_type'] = '小昔涟'  # 默认
        unmatched += 1

# 4. 统计
from collections import Counter
stats = Counter(a.get('_voice_type') for a in audio)
print(f"\n声线分布:")
for vt, cnt in sorted(stats.items()):
    print(f"  {vt}: {cnt}")

print(f"\n匹配方式:")
print(f"  精确匹配: {matched}")
print(f"  模糊匹配(≥0.75): {fuzzy_matched}")
print(f"  未匹配(默认小昔涟): {unmatched}")
print(f"  无文本: {len(audio) - len(audio_with_text)}")

# 5. 保存带 voice_type 的 CSV 和 JSON
out_dir = r'd:\cortex\bili_frames\ocr_output\split'
os.makedirs(out_dir, exist_ok=True)

# JSON with voice_type
json_out = os.path.join(out_dir, '3.4_voicetype.json')
with open(json_out, 'w', encoding='utf-8') as f:
    json.dump(audio, f, ensure_ascii=False, indent=2)

# CSV with voice_type  
csv_out = os.path.join(out_dir, '3.4_voicetype.csv')
with open(csv_out, 'w', encoding='utf-8') as f:
    f.write('filename,text,voice_type\n')
    for a in audio:
        if a.get('text'):
            txt = a['text'].replace(',', '，')
            f.write(f'{a["filename"]},{txt},{a["_voice_type"]}\n')

print(f"\nSaved: {json_out}")
print(f"Saved: {csv_out}")

# 打印一些迷迷样本
mimi = [a for a in audio if a.get('_voice_type') == '迷迷']
print(f"\n迷迷声线样本 (共{len(mimi)}条):")
for a in mimi[:10]:
    print(f"  {a['filename']}: {a.get('text','')[:40]}")
