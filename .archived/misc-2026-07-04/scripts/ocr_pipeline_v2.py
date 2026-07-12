"""OCR流水线 v2 - 角色名+台词提取"""
import sys, re, json, subprocess, time
from pathlib import Path
from collections import defaultdict
import cv2
from rapidocr_onnxruntime import RapidOCR

sys.stdout.reconfigure(line_buffering=True)

# ===== 配置 =====
FFMPEG = r"C:\Users\origin\Downloads\ffmpeg-2026-05-25-git-34dfa8bf2b-essentials_build\ffmpeg-2026-05-25-git-34dfa8bf2b-essentials_build\bin\ffmpeg.exe"
VIDEO_DIR = Path(r"D:\cortex\bili_videos")
SRT_DIR = Path(r"C:\Users\origin\Downloads")
OUTPUT_DIR = Path(r"D:\cortex\bili_frames\ocr_output")
FRAME_CACHE = OUTPUT_DIR / "_frames"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
FRAME_CACHE.mkdir(parents=True, exist_ok=True)

CROP_TOP = 0.68
CROP_BOT = 0.85
FRAME_SCALE = 0.5
SKIP_N = 5

KNOWN_CHARS = ["昔涟","往昔的涟漪","开拓者","迷迷","白厄","阿格莱雅","万敌","赛飞儿",
               "三月七","丹恒","姬子","瓦尔特","知更鸟","花火","黑天鹅",
               "瑕蝶","提宝","那刻夏","风堇","金织","岁月祭司","阿卡迪亚","猫猫","白垩",
               "昔连","昔进","昔涟","符玄"]  # 含OCR误识别变体

def parse_srt(path):
    content = path.read_text(encoding="utf-8")
    blocks = re.split(r"\n\s*\n", content.strip())
    entries = []
    for block in blocks:
        lines = block.strip().split("\n")
        if len(lines) < 3:
            continue
        m = re.match(r"(\d+):(\d+):(\d+)[.,](\d+)\s*-->\s*(\d+):(\d+):(\d+)[.,](\d+)", lines[1])
        if not m:
            continue
        g = list(map(int, m.groups()))
        s = g[0]*3600+g[1]*60+g[2]+g[3]/1000
        e = g[4]*3600+g[5]*60+g[6]+g[7]/1000
        text = " ".join(lines[2:]).strip()
        entries.append({"mid":(s+e)/2, "text":text, "start":lines[1].split(" --> ")[0],
                        "end":lines[1].split(" --> ")[1]})
    return entries

def fuzzy_match(raw):
    if not raw:
        return ""
    raw = raw.strip().replace(" ", "")
    for name in KNOWN_CHARS:
        if raw == name:
            return name
    for name in KNOWN_CHARS:
        if name in raw or raw in name:
            return name
    # 模糊单字差异
    for name in KNOWN_CHARS:
        if 1 <= len(raw) <= len(name)+1 and abs(len(name)-len(raw)) <= 1:
            diff = sum(1 for a,b in zip(name,raw) if a!=b)
            if diff <= 1 and len(name) > 0:
                return name
    return raw

def extract_char(ocr_result):
    """从OCR结果提取角色名"""
    for box, txt, conf in (ocr_result[0] or []):
        cleaned = txt.strip()
        if conf < 0.4 or len(cleaned) > 8 or len(cleaned) < 1:
            continue
        if any(c.isdigit() for c in cleaned):
            continue
        return cleaned
    return ""

def process_video(video_path, srt_path, version, ocr):
    print(f"\n>>> [{version}] 开始...")
    entries = parse_srt(srt_path)
    print(f"  字幕: {len(entries)} 条")

    # 硬编码尺寸 (B站转码视频都是852x480或1280x720)
    fw, fh = (1280, 720) if "3.7" in str(video_path) else (852, 480)
    crop_h = int(fh * (CROP_BOT - CROP_TOP))
    crop_y = int(fh * CROP_TOP)
    new_w = int(fw * FRAME_SCALE)
    new_h = int(crop_h * FRAME_SCALE)

    frame_file = FRAME_CACHE / f"tmp_{version}.png"
    results = []
    last_char = ""
    skip = 0
    ocr_n = 0
    fail_n = 0

    t_start = time.time()
    for i, e in enumerate(entries):
        # 跳过检查
        if last_char and skip < SKIP_N:
            skip += 1
            results.append({"v":version,"char":last_char,"text":e["text"],
                            "start":e["start"],"end":e["end"],"conf":-1})
            continue

        # ffmpeg提取帧
        ts = f"{e['mid']:.3f}"
        cmd = [FFMPEG,"-y","-nostdin","-loglevel","error","-ss",ts,"-i",str(video_path),
               "-vframes","1","-q:v","2","-update","1",
               "-vf",f"crop={fw}:{crop_h}:0:{crop_y},scale={new_w}:{new_h}",
               str(frame_file)]
        r = subprocess.run(cmd, capture_output=True, timeout=5)
        
        if r.returncode != 0 or not frame_file.exists():
            fail_n += 1
            results.append({"v":version,"char":last_char or "???","text":e["text"],
                            "start":e["start"],"end":e["end"],"conf":-2})
            continue

        frame = cv2.imread(str(frame_file))
        if frame is None:
            fail_n += 1
            continue

        ocr_result = ocr(frame)
        ocr_n += 1
        
        raw = extract_char(ocr_result)
        char = fuzzy_match(raw) if raw else ""
        
        if char:
            last_char = char
            skip = 0
        else:
            skip = SKIP_N + 1

        results.append({"v":version,"char":char or last_char or "???","text":e["text"],
                        "start":e["start"],"end":e["end"],"conf":round(1.0 if char else 0.0, 2),
                        "ocr_raw":raw})

        if (i+1) % 100 == 0:
            elapsed = time.time() - t_start
            eta = elapsed / (i+1) * len(entries) - elapsed
            print(f"  {i+1}/{len(entries)} ocr={ocr_n} fail={fail_n} elapsed={elapsed:.0f}s eta={eta:.0f}s")

    if frame_file.exists():
        frame_file.unlink()

    elapsed = time.time() - t_start
    print(f"  完成: {len(results)}条 ocr={ocr_n} fail={fail_n} time={elapsed:.0f}s")
    return results


def main():
    print("=" * 60)
    print("昔涟视频 OCR 角色名+台词提取 v2")
    print("=" * 60)
    
    # 发现文件
    print("\n>>> 发现文件...")
    videos = {}
    for v in VIDEO_DIR.glob("*.mp4"):
        for ver in ["3.4","3.5","3.6","3.7"]:
            if v.name.startswith(ver):
                videos[ver] = v
    srts = {}
    for s in SRT_DIR.glob("*主线*.srt"):
        for ver in ["3.4","3.5","3.6","3.7"]:
            if ver in s.name and "昔涟" in s.name:
                if ver not in srts or "_P字幕" in s.name:
                    srts[ver] = s
    
    mapping = {}
    for ver in ["3.4","3.5","3.6","3.7"]:
        v, s = videos.get(ver), srts.get(ver)
        if v and s:
            mapping[ver] = (v, s)
            print(f"  {ver}: OK")
    
    ocr = RapidOCR()
    all_results = []
    
    for ver in ["3.4","3.5","3.6","3.7"]:
        if ver in mapping:
            v, s = mapping[ver]
            results = process_video(v, s, ver, ocr)
            all_results.extend(results)
    
    # 保存
    json_path = OUTPUT_DIR / "ocr_dialogue.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(all_results, f, ensure_ascii=False, indent=2)
    
    txt_path = OUTPUT_DIR / "ocr_dialogue.txt"
    with open(txt_path, "w", encoding="utf-8") as f:
        for r in all_results:
            f.write(f"[{r['v']}] {r['char']} | {r['text']} | {r['start']} --> {r['end']}\n")
    
    # 统计
    stats = defaultdict(int)
    for r in all_results:
        stats[r["char"]] += 1
    print(f"\n=== 角色分布 ({len(all_results)}条) ===")
    for char, cnt in sorted(stats.items(), key=lambda x: -x[1]):
        print(f"  {char}: {cnt} ({cnt/len(all_results)*100:.1f}%)")
    
    print(f"\n[JSON] {json_path}")
    print(f"[TXT] {txt_path}")
    print("完成!")

if __name__ == "__main__":
    main()
