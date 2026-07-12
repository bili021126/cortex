import csv

keywords = ['灵魂分裂','三结局','HE','一言堂','烧鸡','燒雞','改剧情','临改','3.6改','原始','删了两','删了2','一小时','两小时','内鬼','🦌','鹿','csf','审核制度','拍板','高层','决策权','开会','加班','员工','内部','美术组','BGM','音乐','葬','葬礼','棺','玫瑰','麦田','死而复生','活过来','复活','小昔涟','大昔涟','迷迷','流星','仪式','完成心愿']

with open('d:/cortex/scripts/bilibili_messages.csv', encoding='utf-8-sig') as f:
    reader = csv.DictReader(f)
    count = 0
    for r in reader:
        txt = r.get('content_text', '')
        if any(kw in txt for kw in keywords):
            ts = r['timestamp']
            uid = r['sender_uid'][-4:]
            print(f"[{ts}] {uid}: {txt[:200]}")
            count += 1
            if count >= 80:
                break
