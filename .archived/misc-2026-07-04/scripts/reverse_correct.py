"""Reverse-correction: use TextMap clean text to fix SRT OCR garbled entries."""
import json
import re
from difflib import SequenceMatcher

def clean_for_match(s):
    return re.sub(r'[，。！？、…—""''「」『』♪\s]', '', s)

def similarity(a, b):
    ca = clean_for_match(a)
    cb = clean_for_match(b)
    if not ca or not cb:
        return 0
    return SequenceMatcher(None, ca, cb).ratio()

# Load SRT text index
srt_path = r'd:\cortex\bili_frames\ocr_output\ocr_dialogue_wiki_corrected.json'
with open(srt_path, 'r', encoding='utf-8') as f:
    srt_texts = json.load(f)
print(f"SRT text entries: {len(srt_texts)}")

# Load training manifest (has TextMap texts for game voice files)
manifest_path = r'd:\cortex\bili_frames\ocr_output\training_manifest.json'
with open(manifest_path, 'r', encoding='utf-8') as f:
    manifest = json.load(f)

# Collect game-mapped texts: (text, voice_type, source)
game_texts = []
for e in manifest:
    if e.get('mapped') and e.get('text') and e['source'] in ('game_extract', 'online_download'):
        # Skip very short system prompts
        txt = e['text'].strip()
        if len(txt) >= 3 and txt not in ('……', '…', '…!'):
            game_texts.append({
                'text': txt,
                'voice': e['voice'],
                'source': e['source'],
                'filename': e['filename'],
            })

print(f"Game reference texts: {len(game_texts)}")

# Dedup game texts (same text may appear in multiple voice variants)
seen = set()
unique_game = []
for g in game_texts:
    if g['text'] not in seen:
        seen.add(g['text'])
        unique_game.append(g)
print(f"Unique game texts: {len(unique_game)}")

# Match against SRT
replaced = 0
verified = 0
no_match = 0
replacement_log = []

for g in unique_game:
    best_sim = 0
    best_srt = None
    
    for srt in srt_texts:
        sim = similarity(g['text'], srt['text'])
        if sim > best_sim:
            best_sim = sim
            best_srt = srt
    
    if best_sim >= 0.75 and best_srt:
        old_text = best_srt['text']
        if old_text != g['text']:
            best_srt['text'] = g['text']
            best_srt['_corrected_by'] = 'textmap'
            replaced += 1
            if replaced <= 20:
                replacement_log.append((old_text[:50], g['text'][:50], best_sim))
                print(f"  [{best_sim:.2f}] {old_text[:40]} → {g['text'][:40]}")
        else:
            verified += 1
    elif best_sim >= 0.65 and best_srt:
        verified += 1  # close enough, verified
    else:
        no_match += 1

print(f"\n=== Result ===")
print(f"  Replaced: {replaced}")
print(f"  Verified (same or close): {verified}")
print(f"  No match: {no_match}")

# Save
with open(srt_path, 'w', encoding='utf-8') as f:
    json.dump(srt_texts, f, ensure_ascii=False, indent=2)
print(f"\nSaved corrected SRT to {srt_path}")
