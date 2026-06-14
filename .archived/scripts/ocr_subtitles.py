"""
Extract subtitles from B站 Cyrene main story videos using OCR.
Optimization: only run OCR when subtitle content changes (frame diff detection).
"""
from rapidocr_onnxruntime import RapidOCR
import cv2
import os
import re
import numpy as np
from pathlib import Path

FRAMES_DIR = Path(r"D:\cortex\bili_frames")
OUTPUT_DIR = Path(r"D:\cortex\bili_frames\ocr_output")
OUTPUT_DIR.mkdir(exist_ok=True)

reader = RapidOCR()

VERSIONS = ['3.4', '3.5', '3.6', '3.7']

CHANGE_THRESHOLD = 0.03  # 3% pixel difference = subtitle changed

def frame_diff(prev, curr):
    """Return ratio of changed pixels between two frames."""
    if prev is None:
        return 1.0
    diff = cv2.absdiff(prev, curr)
    gray = cv2.cvtColor(diff, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, 30, 255, cv2.THRESH_BINARY)
    return np.sum(thresh > 0) / thresh.size

def ocr_text(img):
    """Run RapidOCR and return concatenated text."""
    results, _ = reader(img)
    if not results:
        return ''
    texts = [r[1] for r in results if r[2] > 0.5]
    return ' '.join(texts).strip()

def process_version(version):
    frame_dir = FRAMES_DIR / version
    output_file = OUTPUT_DIR / f"{version}_subtitles.txt"
    
    frames = sorted(frame_dir.glob("frame_*.jpg"))
    if not frames:
        print(f"[{version}] No frames found")
        return
    
    print(f"[{version}] Processing {len(frames)} frames...")
    
    prev_frame = None
    prev_text = ""
    results = []
    ocr_count = 0
    
    for i, fpath in enumerate(frames):
        img = cv2.imread(str(fpath))
        if img is None:
            continue
        
        diff = frame_diff(prev_frame, img)
        
        if diff > CHANGE_THRESHOLD:
            text = ocr_text(img)
            ocr_count += 1
            
            # Deduplicate: skip if same as previous
            if text and text != prev_text:
                results.append(text)
                prev_text = text
                if len(results) % 50 == 0:
                    print(f"  [{version}] {len(results)} unique texts (OCR runs: {ocr_count})")
        
        prev_frame = img
        
        if i % 500 == 0 and i > 0:
            print(f"  [{version}] {i}/{len(frames)} frames scanned...")
    
    # Write output
    with open(output_file, 'w', encoding='utf-8') as f:
        for text in results:
            f.write(text + '\n')
    
    print(f"[{version}] DONE: {len(results)} unique subtitles from {ocr_count} OCR runs ({len(frames)} total frames)")
    return results

# Process all versions
all_results = {}
for v in VERSIONS:
    all_results[v] = process_version(v)

# Summary
print("\n=== SUMMARY ===")
total = sum(len(r) for r in all_results.values() if r)
for v in VERSIONS:
    if all_results[v]:
        print(f"  {v}: {len(all_results[v])} unique subtitles")
print(f"  Total: {total}")
