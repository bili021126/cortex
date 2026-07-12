"""
OCR流水线：从视频帧提取角色名 + SRT台词配对
输入：视频 + 对应SRT → 输出：标注好的对话列表 [角色, 台词, 时间]

策略：
- 每个SRT字幕取一帧（中点时间），裁剪顶部角色名区域，OCR识别角色名
- 角色名 + SRT原文 + 时间戳 → 结构化输出
- 采样间隔可调，同名角色连续则不重复OCR
"""
import sys
sys.stdout.reconfigure(line_buffering=True)

import re
import json
import time
from pathlib import Path
from collections import defaultdict

import cv2
import numpy as np
from rapidocr_onnxruntime import RapidOCR

# ============ 配置 ============
VIDEO_DIR = Path(r"D:\cortex\bili_videos")
SRT_DIR = Path(r"C:\Users\origin\Downloads")
OUTPUT_DIR = Path(r"D:\cortex\bili_frames\ocr_output")

# 视频 → SRT 映射（按版本号，glob自动发现）
def discover_mapping():
    """自动发现视频和SRT文件"""
    videos = {}
    for v in VIDEO_DIR.glob("*.mp4"):
        name = v.name
        # 文件名格式: "3.4_昔涟主线语音.XXXXX.mp4"
        for ver in ["3.4", "3.5", "3.6", "3.7"]:
            if name.startswith(ver):
                videos[ver] = v
                break

    srts = {}
    for s in SRT_DIR.glob("*主线*.srt"):
        name = s.name
        for ver in ["3.4", "3.5", "3.6", "3.7"]:
            if ver in name and "昔涟" in name:
                # 优先选 _P字幕 版本（带标点）
                if ver not in srts or "_P字幕" in name:
                    srts[ver] = s

    mapping = {}
    for ver in ["3.4", "3.5", "3.6", "3.7"]:
        v = videos.get(ver)
        s = srts.get(ver)
        if v and s:
            mapping[ver] = {"video": v, "srt": s}
            print(f"  {ver}: vid={v.name}")
            print(f"       srt={s.name}")
        else:
            print(f"  {ver}: MISSING vid={v} srt={s}")
    return mapping


VERSION_MAP = {}  # 运行时填入

# 角色名候选（用于OCR结果模糊匹配，提高准确率）
KNOWN_CHARACTERS = [
    "昔涟", "往昔的涟漪", "开拓者", "迷迷",
    "白厄", "阿格莱雅", "万敌", "赛飞儿",
    "三月七", "丹恒", "姬子", "瓦尔特",
    "知更鸟", "花火", "黑天鹅",
    "瑕蝶", "提宝", "那刻夏", "风堇",
    "金织", "岁月祭司", "阿卡迪亚",
    "猫猫", "白垩",
]

# OCR区域：角色名在画面底部75%左右（B站视频：顶部是UP主信息，底部是游戏对话UI）
CROP_TOP_RATIO = 0.68
CROP_BOTTOM_RATIO = 0.85
FRAME_SCALE = 0.5  # 缩放到50%加速OCR

# 角色名不变时跳过OCR的连续字幕数
SKIP_CONSECUTIVE = 5

# ffmpeg路径
FFMPEG = str(Path(r"C:\Users\origin\Downloads") / "ffmpeg-2026-05-25-git-34dfa8bf2b-essentials_build" / "ffmpeg-2026-05-25-git-34dfa8bf2b-essentials_build" / "bin" / "ffmpeg.exe")

# 临时帧缓存目录
FRAME_CACHE = OUTPUT_DIR / "_frames"
FRAME_CACHE.mkdir(parents=True, exist_ok=True)

# ============ SRT解析 ============
def parse_srt(filepath: Path) -> list[dict]:
    """解析SRT -> [{index, start, end, text, start_sec, end_sec}]"""
    content = filepath.read_text(encoding="utf-8")
    blocks = re.split(r"\n\s*\n", content.strip())
    entries = []
    for block in blocks:
        lines = block.strip().split("\n")
        if len(lines) < 3:
            continue
        m = re.match(r"(\d+):(\d+):(\d+)[.,](\d+)\s*-->\s*(\d+):(\d+):(\d+)[.,](\d+)", lines[1])
        if not m:
            continue
        h1, m1, s1, ms1, h2, m2, s2, ms2 = map(int, m.groups())
        start_sec = h1 * 3600 + m1 * 60 + s1 + ms1 / 1000
        end_sec = h2 * 3600 + m2 * 60 + s2 + ms2 / 1000
        text = " ".join(lines[2:]).strip()
        if text:
            entries.append({
                "index": int(lines[0]),
                "start": lines[1].split(" --> ")[0],
                "end": lines[1].split(" --> ")[1],
                "text": text,
                "start_sec": start_sec,
                "end_sec": end_sec,
                "mid_sec": (start_sec + end_sec) / 2,
            })
    return entries


# ============ 角色名OCR ============
def find_character_name(text_results, frame_height):
    """从OCR结果中找出角色名（裁剪区域已对准角色名气泡）"""
    candidates = []
    for box, text, conf in text_results:
        if not text or conf < 0.4:
            continue
        cleaned = text.strip()
        # 排除明显非角色名的：过长、含数字/英文/特殊符号
        if len(cleaned) > 8 or len(cleaned) < 1:
            continue
        if any(c.isdigit() for c in cleaned):
            continue
        if any(c in "@#%*+=|<>/:\\" for c in cleaned):
            continue
        candidates.append((cleaned, conf))
    # 取置信度最高的
    candidates.sort(key=lambda x: -x[1])
    if candidates:
        return candidates[0][0]
    return ""


def fuzzy_match_character(ocr_text: str) -> str:
    """OCR结果模糊匹配到已知角色名"""
    if not ocr_text:
        return ""
    ocr_text = ocr_text.replace(" ", "")
    # 精确匹配
    for name in KNOWN_CHARACTERS:
        if ocr_text == name:
            return name
    # 子串匹配
    for name in KNOWN_CHARACTERS:
        if name in ocr_text or ocr_text in name:
            return name
    # 模糊：单字差异
    for name in KNOWN_CHARACTERS:
        if len(name) == len(ocr_text):
            diff = sum(1 for a, b in zip(name, ocr_text) if a != b)
            if diff <= 1:
                return name
    # 无匹配，返回原始OCR结果
    return ocr_text


# ============ 主流程 ============
def process_version(version: str, config: dict, ocr: RapidOCR):
    """处理单个版本 - 用ffmpeg逐帧提取"""
    import subprocess
    import tempfile

    video_path = str(config["video"])
    srt_path = config["srt"]

    if not config["video"].exists():
        print(f"  [SKIP] {version}: 视频不存在")
        return []
    if not srt_path.exists():
        print(f"  [SKIP] {version}: SRT不存在")
        return []

    print(f"  [{version}] 解析SRT...")
    entries = parse_srt(srt_path)
    print(f"    字幕条目: {len(entries)}")

    # 视频尺寸（B站三个视频都是852x480@30fps，3.7可能是1280x720）
    frame_w, frame_h, fps = 852, 480, 30.0
    if version == "3.7":
        frame_w, frame_h = 1280, 720

    crop_y1 = int(frame_h * CROP_TOP_RATIO)
    crop_y2 = int(frame_h * CROP_BOTTOM_RATIO)
    crop_h = crop_y2 - crop_y1
    print(f"    视频: {frame_w}x{frame_h}, {fps:.1f}fps")

    results = []
    last_character = ""
    skip_counter = 0
    ocr_count = 0
    failure_count = 0

    # 临时帧文件
    frame_path = FRAME_CACHE / f"_tmp_{version}.png"

    for i, entry in enumerate(entries):
        mid_sec = entry["mid_sec"]

        # 如果连续N条同角色，跳过OCR复用上次结果
        if last_character and skip_counter < SKIP_CONSECUTIVE:
            skip_counter += 1
            results.append({
                "version": version,
                "character": last_character,
                "text": entry["text"],
                "start": entry["start"],
                "end": entry["end"],
                "ocr_confidence": -1,
            })
            continue

        # ffmpeg提取帧（裁剪到角色名区域）
        ts = f"{mid_sec:.3f}"
        cmd = [
            FFMPEG, "-y", "-nostdin", "-loglevel", "error", "-ss", ts, "-i", video_path,
            "-vframes", "1", "-q:v", "2", "-update", "1",
            "-vf", f"crop={frame_w}:{crop_h}:0:{crop_y1},scale={int(frame_w*FRAME_SCALE)}:{int(crop_h*FRAME_SCALE)}",
            str(frame_path)
        ]
        try:
            subprocess.run(cmd, capture_output=True, timeout=5)
        except Exception:
            failure_count += 1
            results.append({
                "version": version,
                "character": last_character or "???",
                "text": entry["text"],
                "start": entry["start"],
                "end": entry["end"],
                "ocr_confidence": -2,
            })
            continue

        if not frame_path.exists():
            failure_count += 1
            continue

        # 读取帧并OCR
        frame = cv2.imread(str(frame_path))
        if frame is None:
            failure_count += 1
            continue

        result = ocr(frame)
        ocr_count += 1

        char_raw = ""
        if result and result[0]:
            char_raw = find_character_name(result[0], frame.shape[0])
            character = fuzzy_match_character(char_raw)
        else:
            character = ""

        if character:
            last_character = character
            skip_counter = 0
        else:
            skip_counter = SKIP_CONSECUTIVE + 1

        results.append({
            "version": version,
            "character": character or last_character or "???",
            "text": entry["text"],
            "start": entry["start"],
            "end": entry["end"],
            "ocr_raw": char_raw,
            "ocr_confidence": round(1.0 if character else 0.0, 2),
        })

        if (i + 1) % 100 == 0:
            print(f"    {i+1}/{len(entries)} (OCR: {ocr_count}, fail: {failure_count})")

    # 清理临时帧
    if frame_path.exists():
        frame_path.unlink()

    print(f"    完成: {len(results)} 条, OCR执行 {ocr_count} 次, 失败 {failure_count} 帧")
    return results


def main():
    print("=" * 60)
    print("昔涟视频 OCR 角色名+台词提取流水线")
    print("=" * 60)

    print("\n>>> 发现文件...")
    global VERSION_MAP
    VERSION_MAP = discover_mapping()

    ocr = RapidOCR()
    all_results = []

    for version, config in VERSION_MAP.items():
        print(f"\n>>> 处理 {version}")
        results = process_version(version, config, ocr)
        all_results.extend(results)

    # ============ 输出 ============
    # JSON完整输出
    json_path = OUTPUT_DIR / "ocr_dialogue.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(all_results, f, ensure_ascii=False, indent=2)
    print(f"\n[JSON] {json_path} ({len(all_results)} 条)")

    # 文本格式：角色名 | 台词 | 开始时间 --> 结束时间
    txt_path = OUTPUT_DIR / "ocr_dialogue.txt"
    with open(txt_path, "w", encoding="utf-8") as f:
        for r in all_results:
            f.write(f"[{r['version']}] {r['character']} | {r['text']} | {r['start']} --> {r['end']}\n")
    print(f"[TXT] {txt_path}")

    # 统计
    char_stats = defaultdict(int)
    for r in all_results:
        char_stats[r["character"]] += 1
    print(f"\n=== 角色分布 ===")
    for char, count in sorted(char_stats.items(), key=lambda x: -x[1]):
        pct = count / len(all_results) * 100
        print(f"  {char}: {count} ({pct:.1f}%)")

    print("\n完成！")


if __name__ == "__main__":
    main()
