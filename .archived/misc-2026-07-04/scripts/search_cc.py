"""
搜索B站崩铁剧情视频中带CC字幕的
"""
import json, urllib.request, urllib.parse

def search_videos(keyword, page=1, count=20):
    url = f"https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword={urllib.parse.quote(keyword)}&page={page}&page_size={count}"
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Referer": "https://www.bilibili.com/",
    })
    resp = urllib.request.urlopen(req, timeout=15)
    data = json.loads(resp.read())
    return data.get("data", {}).get("result", [])

def check_cc(bvid):
    """检测是否有CC字幕"""
    url = f"https://api.bilibili.com/x/player/v2?bvid={bvid}"
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Referer": f"https://www.bilibili.com/video/{bvid}",
    })
    try:
        resp = urllib.request.urlopen(req, timeout=15)
        data = json.loads(resp.read())
        subtitles = data.get("data", {}).get("subtitle", {}).get("subtitles", [])
        return len(subtitles) > 0, subtitles
    except:
        return False, []

keywords = ["崩铁主线剧情", "星穹铁道剧情", "崩坏星穹铁道剧情配音"]

found = []
for kw in keywords:
    print(f"\n搜索: {kw}")
    for page in range(1, 4):
        results = search_videos(kw, page=page, count=20)
        for v in results:
            bvid = v["bvid"]
            title = v["title"]
            has, subs = check_cc(bvid)
            if has:
                langs = [s.get("lan_doc", s.get("lan","")) for s in subs]
                found.append((bvid, title, len(subs), langs))
                print(f"  ✅ BV{bvid} | {title[:40]} | {langs}")
                if len(found) >= 10:
                    break
        if len(found) >= 10:
            break
    if len(found) >= 10:
        break
    
    # 短暂休息避免限流
    import time; time.sleep(1)

if not found:
    print("\n没搜到带CC的。试崩铁单个角色名关键词...")
    char_kw = ["崩铁昔涟", "星穹铁道昔涟", "崩铁流萤", "星穹铁道知更鸟"]
    for kw in char_kw:
        results = search_videos(kw, page=1, count=20)
        for v in results:
            has, subs = check_cc(v["bvid"])
            if has:
                langs = [s.get("lan_doc","") for s in subs]
                found.append((v["bvid"], v["title"], len(subs), langs))
                print(f"  ✅ {v['bvid']} | {v['title'][:40]} | {langs}")

print(f"\n=== 找到 {len(found)} 个带CC字幕的视频 ===")
for bvid, title, n, langs in found:
    print(f"  https://www.bilibili.com/video/{bvid}")
    print(f"    {title}")
    print(f"    语言: {langs}")
