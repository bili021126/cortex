"""Generate training manifest: audio file → text → source classification."""
import json
import re
from pathlib import Path
from collections import Counter

# ===== Source definitions =====
SOURCES = {
    'game_big': {
        'path': r'd:\models\voice',
        'source': 'game_extract',
        'voice': 'big_cyrene',
        'pattern': '**/*.wav',
        'match_type': 'game_id',
        'exclude_dirs': ['voice', 'player', 'sample_check', 'lykos'],
    },
    'game_mimi': {
        'path': r'd:\models\voice-mimi',
        'source': 'game_extract',
        'voice': 'mimi',
        'pattern': '**/*.wav',
        'match_type': 'game_id',
    },
    'online_big': {
        'path': r'C:\Users\origin\Downloads\昔涟',
        'source': 'online_download',
        'voice': 'big_cyrene',
        'pattern': '**/*.wav',
        'match_type': 'game_id',
        'exclude_dirs': ['带变量语音 - Placeholder', '其它语音 - Others'],
    },
    'archive_lib': {
        'path': r'D:\XT\voice\archive\cyrene',
        'source': 'archive_library',
        'voice': 'big_cyrene',
        'pattern': 'archive_cyrene_*.wav',
        'match_type': 'game_id',
    },
    'big_train': {
        'path': r'd:\models\cyrene-tts\training\big_cyrene',
        'source': 'video_extract',
        'voice': 'big_cyrene',
        'pattern': '*.wav',
        'match_type': 'version_seq',
    },
    'little_train': {
        'path': r'd:\models\cyrene-tts\training\little_cyrene',
        'source': 'video_extract',
        'voice': 'little_cyrene',
        'pattern': '*.wav',
        'match_type': 'version_seq',
    },
}

TRAIN_TO_SRT = {'3.4': '3.4', '3.5': '3.5', '3.6': '3.6', '3.7': '3.7'}

SUBTYPE_MAP = {
    'cyrenely': 'cyrenely',
    'cyrenejiyi': 'cyrenejiyi',
    'shitang': 'shitang',
    'ambient': 'ambient',
    'syss': 'system',
}


def _get_subtype(dirpath: str) -> str:
    """Detect subtype from directory path."""
    for key, tag in SUBTYPE_MAP.items():
        if key in dirpath.lower():
            return tag
    if 'archive' in dirpath.lower():
        return 'archive'
    if 'chapter' in dirpath.lower():
        return 'story'
    return 'other'


def scan_audio_sources():
    """Scan all audio sources and return flat list of audio entries."""
    entries = []

    for key, cfg in SOURCES.items():
        base = Path(cfg['path'])
        if not base.exists():
            print(f"  SKIP (not found): {cfg['path']}")
            continue

        files = sorted(base.glob(cfg['pattern']))

        # Filter excluded dirs
        exclude_dirs = cfg.get('exclude_dirs', [])
        if exclude_dirs:
            filtered = []
            for f in files:
                parts = f.relative_to(base).parts
                if parts and parts[0] in exclude_dirs:
                    continue
                filtered.append(f)
            files = filtered

        count = 0
        for f in files:
            subtype = _get_subtype(str(f.parent))
            entries.append({
                'path': str(f),
                'filename': f.name,
                'source': cfg['source'],
                'voice': cfg['voice'],
                'subtype': subtype,
                'match_type': cfg['match_type'],
                'source_key': key,
            })
            count += 1

        print(f"  {key}: {count} files")

    return entries


def load_text_index():
    """Load the unified corrected text index."""
    path = r'd:\cortex\bili_frames\ocr_output\ocr_dialogue_wiki_corrected.json'
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def map_video_clips(audio_entries, text_index):
    """Map training clips to SRT text — speaker-aware: big=昔涟, little=迷迷."""
    for key in ['big_train', 'little_train']:
        entries = [e for e in audio_entries if e['source_key'] == key]
        if not entries:
            continue

        # Separate mixed-in game voice files
        video_clips = []
        game_lines = []
        for e in entries:
            if e['filename'].startswith('archive_cyrene_'):
                e['match_type'] = 'game_id'
                game_lines.append(e)
            else:
                video_clips.append(e)

        if game_lines:
            print(f"  {key}: {len(game_lines)} game voice lines found in training dir (will match by game ID)")

        # Speaker filter — 昔涟 tagged well (3641 entries), 迷迷 too sparse (46 only in 3.6)
        if key == 'big_train':
            speaker_filter = ['昔涟', '往昔的涟漪']
        else:
            # little_train clips are 3.4+3.5 迷迷 voice but SRT lacks迷迷 tags there
            speaker_filter = None  # no filter, use full pool

        # Group by version
        version_groups = {}
        unknown_clips = []
        for e in video_clips:
            fn = e['filename']
            ver_match = re.search(r'(\d\.\d)_decho_', fn)
            if ver_match:
                ver = ver_match.group(1)
                version_groups.setdefault(ver, []).append(e)
            elif 'merged_decho_' in fn:
                unknown_clips.append(e)
            else:
                version_groups.setdefault('unknown', []).append(e)

        mapped = 0
        for ver, group in version_groups.items():
            srt_ver = TRAIN_TO_SRT.get(ver, ver)
            # Filter by version (and speaker if applicable)
            if speaker_filter:
                srt_entries = [
                    t for t in text_index
                    if t['v'] == srt_ver and t.get('char', '') in speaker_filter
                ]
            else:
                srt_entries = [t for t in text_index if t['v'] == srt_ver]
            if not srt_entries:
                tag = f"'{speaker_filter}' " if speaker_filter else ""
                print(f"  {key}/{ver}: no {tag}SRT entries for version {srt_ver}")
                continue
            group.sort(key=lambda e: e['filename'])
            for i, entry in enumerate(group):
                if i < len(srt_entries):
                    entry['text'] = srt_entries[i]['text']
                    entry['text_char'] = srt_entries[i].get('char', '昔涟')
                    entry['srt_start'] = srt_entries[i].get('start', '')
                    entry['srt_version'] = srt_ver
                    entry['mapped'] = True
                    mapped += 1
                else:
                    entry['text'] = ''
                    entry['mapped'] = False

        # Map merged clips — all main story (with speaker filter if applicable)
        if unknown_clips:
            unknown_clips.sort(key=lambda e: e['filename'])
            if speaker_filter:
                pool = [
                    t for t in text_index
                    if t['v'] in ('3.4', '3.5', '3.6', '3.7') and t.get('char', '') in speaker_filter
                ]
            else:
                pool = [t for t in text_index if t['v'] in ('3.4', '3.5', '3.6', '3.7')]
            for i, entry in enumerate(unknown_clips):
                if i < len(pool):
                    entry['text'] = pool[i]['text']
                    entry['text_char'] = pool[i].get('char', '昔涟')
                    entry['srt_start'] = pool[i].get('start', '')
                    entry['srt_version'] = 'merged'
                    entry['mapped'] = True
                    mapped += 1
                else:
                    entry['text'] = ''
                    entry['mapped'] = False

        print(f"  {key}: mapped {mapped}/{len(video_clips)} clips to text (speaker: {speaker_filter})")


def generate_manifest():
    print("=== Scanning Audio Sources ===")
    audio = scan_audio_sources()
    print(f"\nTotal audio files: {len(audio)}")

    print("\n=== Loading Text Index ===")
    text_index = load_text_index()
    print(f"Text entries: {len(text_index)}")

    print("\n=== Mapping Video Clips ===")
    map_video_clips(audio, text_index)

    # Summary
    print("\n=== Source Summary ===")
    source_counts = Counter(e['source'] for e in audio)
    for src, cnt in source_counts.most_common():
        mapped = sum(1 for e in audio if e['source'] == src and e.get('mapped'))
        print(f"  {src}: {cnt} files ({mapped} text-mapped)")

    voice_counts = Counter(e['voice'] for e in audio)
    print("\n  By voice type:")
    for vc, cnt in voice_counts.most_common():
        print(f"    {vc}: {cnt}")

    subtype_counts = Counter(e['subtype'] for e in audio)
    print("\n  By subtype:")
    for st, cnt in subtype_counts.most_common():
        print(f"    {st}: {cnt}")

    # Save
    output_path = r'd:\cortex\bili_frames\ocr_output\training_manifest.json'
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(audio, f, ensure_ascii=False, indent=2)
    print(f"\nSaved manifest to {output_path}")


if __name__ == '__main__':
    generate_manifest()
