import asyncio
import csv
import json
import hashlib
import time
import urllib.parse
from pathlib import Path

import aiohttp

# ===================== 配置区域 =====================
SESSDATA = "dfb40ed5%2C1789863649%2C61e4c%2A31CjDOpsdL8M45xsMp7S3yeRJMU711eXbKJlP7BRaD5LalKoWI5X9oEC4kG08f3rixgacSVkVfd3YtR3hETjY4WTd3REdSai1IaHJXLWdnZlRFTDVmNWx2dEN6eENUVWhoRjFLQWduU0NZcjVPOUVNOWo2LWxybWpJV3V2UVhXak5mYVFldHVNZDhRIIEC"
BILI_JCT = "33e2f82d04b55bd55dcaf78cd8a556e6"
TARGET_UID = 346344298
# ===================================================


SCRIPT_DIR = Path(__file__).parent
IMAGE_DIR = SCRIPT_DIR / "bili_images"
IMAGE_DIR.mkdir(exist_ok=True)

COOKIE = f"SESSDATA={SESSDATA}; bili_jct={BILI_JCT}"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Cookie": COOKIE,
    "Referer": "https://message.bilibili.com/",
}


# ── WBI 签名（B站新版API需要） ──
MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 52, 44, 34,
]


def get_mixin_key(orig: str) -> str:
    """对 img_key 和 sub_key 进行字符顺序打乱编码"""
    return "".join(orig[i] for i in MIXIN_KEY_ENC_TAB if i < len(orig))[:32]


def wbi_sign(params: dict, img_key: str, sub_key: str) -> dict:
    """WBI 签名：添加 w_rid 和 wts"""
    mixin = get_mixin_key(img_key + sub_key)
    params = dict(params)
    params["wts"] = int(time.time())
    # 按 key 排序后拼接
    sorted_params = sorted(params.items(), key=lambda x: x[0])
    query = urllib.parse.urlencode(sorted_params)
    sign_str = query + mixin
    params["w_rid"] = hashlib.md5(sign_str.encode()).hexdigest()
    return params


async def get_nav(session: aiohttp.ClientSession) -> dict:
    """获取导航信息（含 wbi_img）"""
    async with session.get("https://api.bilibili.com/x/web-interface/nav") as resp:
        return await resp.json()


async def fetch_msgs(
    session: aiohttp.ClientSession,
    talker_id: int,
    begin_seqno: int = 0,
    size: int = 100,
    img_key: str = "",
    sub_key: str = "",
) -> dict:
    """直接调B站私信API，支持翻页"""
    params = {
        "talker_id": talker_id,
        "session_type": 1,
        "size": size,
        "begin_seqno": begin_seqno,
    }
    if img_key and sub_key:
        params = wbi_sign(params, img_key, sub_key)

    url = "https://api.vc.bilibili.com/svr_sync/v1/svr_sync/fetch_session_msgs"
    async with session.get(url, params=params) as resp:
        return await resp.json()


async def download_image(session: aiohttp.ClientSession, url: str, filename: str) -> str:
    """下载图片"""
    try:
        async with session.get(url, headers={"Referer": "https://message.bilibili.com/"}) as resp:
            if resp.status == 200:
                path = IMAGE_DIR / filename
                path.write_bytes(await resp.read())
                return str(path)
    except Exception:
        pass
    return ""


def extract_text(content_raw: str) -> str:
    """从 content JSON 中提取纯文本"""
    try:
        parsed = json.loads(content_raw)
        return parsed.get("content", content_raw)
    except (json.JSONDecodeError, TypeError):
        return content_raw


async def main():
    print("开始获取私信记录...")
    print(f"目标 UID: {TARGET_UID}")

    async with aiohttp.ClientSession(headers=HEADERS) as session:
        # 获取 WBI 密钥
        nav = await get_nav(session)
        wbi_img = nav.get("data", {}).get("wbi_img", {})
        img_key = wbi_img.get("img_key", "")
        sub_key = wbi_img.get("sub_key", "")
        print(f"  WBI 密钥获取: img_key={'✓' if img_key else '✗'} sub_key={'✓' if sub_key else '✗'}")

        seen_seqnos = set()
        all_messages = []
        begin_seqno = 0
        # 第二页起用 end_seqno 往回翻
        use_end = False
        max_pages = 500
        page_count = 0

        while page_count < max_pages:
            page_count += 1

            params = {
                "talker_id": TARGET_UID,
                "session_type": 1,
                "size": 100,
            }
            if use_end and all_messages:
                params["end_seqno"] = all_messages[-1].get("msg_seqno", 0)
            else:
                params["begin_seqno"] = begin_seqno

            if img_key and sub_key:
                params = wbi_sign(params, img_key, sub_key)

            url = "https://api.vc.bilibili.com/svr_sync/v1/svr_sync/fetch_session_msgs"
            async with session.get(url, params=params) as resp:
                data = await resp.json()

            code = data.get("code", -1)
            if code != 0:
                print(f"  API 返回错误: code={code}, message={data.get('message', '')}")
                break

            messages = data.get("data", {}).get("messages", [])
            if not messages:
                print(f"  第 {page_count} 页: 空, 拉取结束")
                break

            new_count = 0
            for m in messages:
                seq = m.get("msg_seqno")
                if seq not in seen_seqnos:
                    seen_seqnos.add(seq)
                    all_messages.append(m)
                    new_count += 1

            print(f"  第 {page_count} 页: 返回 {len(messages)} 条, 新增 {new_count} 条, 累计 {len(all_messages)} 条")

            # 没有新增说明翻到底了
            if new_count == 0:
                print(f"  无新增消息，拉取结束")
                break

            # 第一页结束后切换到 end_seqno 往回翻
            use_end = True
            # 用本批最小 seqno（最旧那条）作为下次 end_seqno
            begin_seqno = messages[-1].get("msg_seqno", 0)

        if not all_messages:
            print("没有获取到任何消息，请检查 Cookie 是否正确。")
            return

        # 按时间正序
        all_messages.sort(key=lambda m: m.get("timestamp", 0))

        print(f"\n共获取到 {len(all_messages)} 条消息，开始写入 CSV...")

    # 写 CSV
    csv_path = SCRIPT_DIR / "bilibili_messages.csv"
    with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(["sender_uid", "timestamp", "msg_type", "content_text", "raw_json"])

        for msg in all_messages:
            sender_uid = msg.get("sender_uid")
            timestamp = msg.get("timestamp")
            msg_type = msg.get("msg_type")
            content_raw = msg.get("content", "")

            if msg_type == 1:
                display = extract_text(content_raw)
            elif msg_type == 2:
                try:
                    img_info = json.loads(content_raw)
                    img_url = img_info.get("url", "")
                    if img_url:
                        fname = f"{sender_uid}_{timestamp}.jpg"
                        # 图片下载是同步的，这里异步处理
                        display = f"[图片] {img_url}"
                    else:
                        display = "[图片:无URL]"
                except Exception:
                    display = f"[图片解析失败] {content_raw[:100]}"
            else:
                display = f"[type={msg_type}] {content_raw[:100]}"

            writer.writerow([sender_uid, timestamp, msg_type, display, json.dumps(msg, ensure_ascii=False)])

    print(f"  ✓ 已写入 {len(all_messages)} 条")
    print(f"\n✅ 全部完成！")
    print(f"📄 聊天记录: {csv_path}")
    print(f"🖼️  图片文件夹: {IMAGE_DIR}")


if __name__ == "__main__":
    asyncio.run(main())
