"""Build full Game TextMap bridge → update training_manifest.json with text."""
import json
import re
from pathlib import Path
from collections import Counter

# ===== Load game data =====
print("=== Loading Game Data ===")

with open(r'd:\cortex\tmp\hsr_configs\VoiceConfig.json', 'r', encoding='utf-8') as f:
    voice_cfg = json.load(f)
print(f"  VoiceConfig: {len(voice_cfg)} entries")

with open(r'd:\cortex\tmp\hsr_configs\TalkSentenceConfig.json', 'r', encoding='utf-8') as f:
    talk_cfg = json.load(f)
print(f"  TalkSentenceConfig: {len(talk_cfg)} entries")

with open(r'd:\cortex\tmp\TextMapCHS_3.7.json', 'r', encoding='utf-8') as f:
    text_map = json.load(f)
print(f"  TextMapCHS: {len(text_map)} entries")

# ===== Build lookup chains =====
print("\n=== Building Lookups ===")

# VoicePath → VoiceID
voicepath_to_id = {}
voiceid_to_path = {}
cyrene_ids = []  # ordered list of (VoicePath, VoiceID) for cyrene only
for v in voice_cfg:
    path = v.get('VoicePath', '')
    vid = v['VoiceID']
    voicepath_to_id[path] = vid
    voiceid_to_path[vid] = path
    # Also match cyrene, mem, memberA (all 昔涟/迷迷 voice lines)
    path_lower = path.lower()
    if any(kw in path_lower for kw in ('cyrene', '_mem_', 'membera')):
        cyrene_ids.append((path, vid))

cyrene_ids.sort(key=lambda x: x[0])  # sort by path for sequential mapping
print(f"  cyrene VoicePaths: {len(cyrene_ids)}")

# TalkSentenceID → TextKey
# Also: TalkSentenceID → VoiceID (some entries have separate VoiceID)
talk_to_textkey = {}
talk_sid_to_voiceid = {}
for t in talk_cfg:
    sid = t.get('TalkSentenceID')
    if not sid:
        continue
    hk = t.get('TalkSentenceText', {}).get('Hash')
    if hk:
        talk_to_textkey[sid] = str(hk)
    vid = t.get('VoiceID', sid)  # default VoiceID = TalkSentenceID
    talk_sid_to_voiceid[sid] = vid

print(f"  TalkSentence → TextKey: {len(talk_to_textkey)} entries")

# TextKey → Text (from TextMap)
textkey_to_text = {}
for k, v in text_map.items():
    # Clean up text: remove markup tags
    clean = re.sub(r'<[^>]+>', '', v)
    clean = clean.replace('\\n', '').strip()
    textkey_to_text[k] = clean

print(f"  TextKey → Text: {len(textkey_to_text)} entries")

# ===== Build the full chain: VoicePath → Text =====
# VoicePath → VoiceID → TalkSentence(VoiceID match) → TextKey → Text
voicepath_to_text = {}
voiceid_to_textkey = {}  # VoiceID → TextKey
for t in talk_cfg:
    sid = t.get('TalkSentenceID')
    if not sid:
        continue
    vid = t.get('VoiceID', sid)
    hk = t.get('TalkSentenceText', {}).get('Hash')
    if hk:
        voiceid_to_textkey[vid] = str(hk)

voicepath_chain_hits = 0
voicepath_chain_miss = 0
for path, vid in cyrene_ids:
    textkey = voiceid_to_textkey.get(vid)
    if textkey:
        text = textkey_to_text.get(textkey, '')
        if text:
            voicepath_to_text[path] = text
            voicepath_chain_hits += 1
        else:
            voicepath_chain_miss += 1
    else:
        voicepath_chain_miss += 1

print(f"\n  Full chain VoicePath→Text: {voicepath_chain_hits} hits, {voicepath_chain_miss} miss")

# VoiceID → Text (for archive files)
voiceid_to_text = {}
for vid, path in voiceid_to_path.items():
    if 'cyrene' in path.lower():
        textkey = voiceid_to_textkey.get(vid)
        if textkey:
            text = textkey_to_text.get(textkey, '')
            if text:
                voiceid_to_text[vid] = (path, text)

print(f"  VoiceID→Text (archive): {len(voiceid_to_text)} entries")


def resolve_text(filename, filepath_str):
    """Resolve text for a game voice file."""
    # Case 1: chapter4_XX_YYY_NNN.wav → VoicePath directly
    # Strip .wav extension to get VoicePath
    name_no_ext = filename.replace('.wav', '')

    # Try exact VoicePath match
    if name_no_ext in voicepath_to_text:
        return voicepath_to_text[name_no_ext]

    # Case 2: archive_cyrene_N.wav → sequential or VoiceID
    m = re.match(r'archive_cyrene_(\d+)', name_no_ext)
    if m:
        n = int(m.group(1))
        # Try VoiceID = n (for small IDs)
        if n in voiceid_to_text:
            return voiceid_to_text[n][1]
        # Try sequential: Nth cyrene entry in sorted order
        if 1 <= n <= len(cyrene_ids):
            path, vid = cyrene_ids[n - 1]
            if path in voicepath_to_text:
                return voicepath_to_text[path]

    # Case 3: other naming → try extracting path from directory structure
    # e.g. vo/syss/cyrene/01/auth_101 → look for matching VoicePath
    parts = filepath_str.lower().replace('\\', '/')
    cyrene_pos = parts.find('cyrene')
    if cyrene_pos >= 0:
        # Try to find closest VoicePath match
        sub = parts[cyrene_pos:]
        for vp in voicepath_to_text:
            if sub in vp or vp in sub:
                return voicepath_to_text[vp]

    return None


# ===== Load manifest =====
print("\n=== Loading Manifest ===")
manifest_path = r'd:\cortex\bili_frames\ocr_output\training_manifest.json'
with open(manifest_path, 'r', encoding='utf-8') as f:
    manifest = json.load(f)
print(f"  Manifest: {len(manifest)} entries")

# ===== Apply text to game_extract and online_download entries =====
print("\n=== Mapping Game Voice Lines ===")
game_mapped = 0
game_miss = 0

for entry in manifest:
    if entry['match_type'] != 'game_id':
        continue
    if entry.get('mapped'):
        continue  # already has text

    filename = entry['filename']
    filepath = entry['path']

    text = resolve_text(filename, filepath)
    if text:
        entry['text'] = text
        entry['text_char'] = '昔涟'
        entry['mapped'] = True
        game_mapped += 1
    else:
        game_miss += 1

print(f"  Mapped: {game_mapped}")
print(f"  Miss:   {game_miss}")

# ===== Summary =====
print("\n=== Updated Summary ===")
source_counts = Counter(e['source'] for e in manifest)
for src, cnt in source_counts.most_common():
    mapped = sum(1 for e in manifest if e['source'] == src and e.get('mapped'))
    print(f"  {src}: {cnt} files ({mapped} text-mapped, {mapped/cnt*100:.1f}%)")

# ===== Save =====
with open(manifest_path, 'w', encoding='utf-8') as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)
print(f"\nSaved updated manifest to {manifest_path}")
