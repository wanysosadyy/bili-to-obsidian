"""
BiliToObsidian — 解码并保存 B 站视频字幕到 Obsidian vault

使用方式:
  python save_bili.py <json_data_path> <output_dir>

JSON 输入格式（由 JS eval 生成）:
  {"bvid": "BVxxx", "meta": {"标题": "...", "作者": "...", "日期": "2026-04-24", "URL": "..."}, "len": 11009, "base64": "..."}

输出: {date} - {title} ({bvid}).md
"""

import json, base64, os, re, sys


def save_video(json_path: str, output_dir: str) -> str:
    """解码 JSON 并保存为 Obsidian Markdown 文件。返回保存的文件路径。"""
    with open(json_path, 'r', encoding='utf-8-sig') as f:
        data = json.load(f)

    if 'error' in data:
        print(f"ERROR: {data['error']}")
        sys.exit(1)

    # 解码内容
    content_bytes = base64.b64decode(data['base64'])
    content = content_bytes.decode('utf-8')

    # 提取元数据（兼容带/不带中文冒号的 key）
    meta = data.get('meta', {})
    title = meta.get('\u6807\u9898', meta.get('\u6807\u9898\uff1a', 'untitled'))
    author = meta.get('\u4f5c\u8005', meta.get('\u4f5c\u8005\uff1a', ''))
    date = meta.get('\u65e5\u671f', meta.get('\u65e5\u671f\uff1a', '2026-01-01'))
    url = meta.get('URL', meta.get('URL\uff1a', ''))
    bvid = data['bvid']

    # 清理文件名
    safe_title = re.sub(r'[<>:"/\\|?*]', '', title)[:80]
    filename = f'{date} - {safe_title} ({bvid}).md'
    filepath = os.path.join(output_dir, filename)

    # 构建 Markdown（含 frontmatter）
    fm_title = title.replace('"', '\\"')
    fm_author = author.replace('"', '\\"')
    lines = [
        '---',
        f'title: "{fm_title}"',
        f'author: "{fm_author}"',
        f'date: {date}',
        f'url: {url}',
        f'bvid: {bvid}',
        'source: bilibili',
        'type: clip',
        '---',
        '',
        f'# {title}',
        '',
        f'> \u4f5c\u8005\uff1a{author} | \u65e5\u671f\uff1a{date} | [\u539f\u6587\u94fe\u63a5]({url})',
        '',
        '---',
        '',
        content
    ]

    os.makedirs(output_dir, exist_ok=True)
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

    print(f'OK: {os.path.basename(filepath)}')
    print(f'len={len(content)} bvid={bvid} date={date}')
    return filepath


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(f'Usage: {sys.argv[0]} <json_path> <output_dir>')
        sys.exit(1)
    save_video(sys.argv[1], sys.argv[2])
