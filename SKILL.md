---
name: bili-to-obsidian
description: 通过 CDP 自动化 Bilibili Obsidian Clipper 浏览器扩展，批量将 B 站 UP 主空间视频的字幕/文稿保存到 Obsidian。触发词：B站保存到Obsidian、BiliToObsidian、批量保存B站视频、收集B站视频、B站字幕导出、B站文稿保存
---

# BiliToObsidian — B 站视频批量保存到 Obsidian

通过 `browser-harness-js`（Bun HTTP CDP 服务器，端口 9876）操控 Bilibili Obsidian Clipper 浏览器扩展，批量将 UP 主空间的视频字幕抓取并保存为 Obsidian Markdown 文件。

## 前置条件

1. **Edge/Chrome 浏览器** 已安装 Bilibili Obsidian Clipper 扩展（ID: `fbeeapnjdjgacilaobonekidbfjcmdjo`）
2. **browser-harness-js** CDP 服务器已启动（默认端口 9876，health check: `GET http://127.0.0.1:9876/health`）
3. 系统可用 Python 命令（`python` 或 `python3`），用于解码 base64 并写入文件

## 核心原理

**不通过扩展的"发送到 Obsidian"按钮保存**（该按钮在扩展的 isolated world 中，CDP click 无法触发），而是：

1. 通过 CDP 在浏览器页面中操作 BOC 扩展面板：显示面板 → 点击"刷新抓取"
2. 等待抓取完成后，从 `#boc-panel textarea` 提取完整的 Markdown 字幕内容
3. 通过 base64 编码传输到本地，用 Python 解码并写入 Obsidian vault 的 .md 文件

## 触发时必须询问

1. **UP 主空间链接或 UID**：例如 `https://space.bilibili.com/46377861`
2. **视频数量**：默认取最新 3 个
3. **保存目录**：默认 `Clippings/Bilibili/`（相对于 Obsidian vault 根目录）

## 完整工作流

### Step 1: 确认 CDP 服务器运行

```powershell
Invoke-WebRequest -Uri "http://127.0.0.1:9876/health" -UseBasicParsing -TimeoutSec 5
```

返回 `connected: true` 即可继续。

### Step 2: 获取浏览器标签页并导航到 UP 主空间

```javascript
// 写入 .js 文件后执行
const tabs = await listPageTargets();
const target = tabs.find(t => t.url.includes('bilibili.com'));
await session.use(target.targetId);
await session.Page.navigate({url: 'https://space.bilibili.com/{UID}/upload/video'});
await new Promise(r => setTimeout(r, 5000));
```

通过 POST 到 `http://127.0.0.1:9876/eval` 执行。

### Step 3: 提取视频列表

```javascript
const {result} = await session.Runtime.evaluate({
  expression: `(function(){
    const cards=document.querySelectorAll('a[href*="/video/"]');
    const seen=new Set(); const videos=[];
    cards.forEach(a=>{
      const href=a.getAttribute('href')||'';
      const match=href.match(/\/video\/(BV[a-zA-Z0-9]+)/);
      if(match&&!seen.has(match[1])){
        seen.add(match[1]);
        videos.push({bvid:match[1]})
      }
    });
    return JSON.stringify(videos.slice(0,N));
  })()`,
  returnByValue: true
});
return result.value;
```

### Step 4: 逐个视频处理

对每个视频执行以下流程（在单个 eval 中完成，避免 session 重连导致 textarea 清空）：

```javascript
// 1. 导航到视频页
await session.Page.navigate({url: 'https://www.bilibili.com/video/' + bvid + '/'});
await new Promise(r => setTimeout(r, 3000));

// 2. 显示 BOC 面板
await session.Runtime.evaluate({
  expression: `
    var root = document.getElementById('boc-root');
    root.style.display = 'block';
    root.style.position = 'fixed';
    root.style.top = '0'; root.style.left = '0';
    root.style.zIndex = '999999';
    root.removeAttribute('aria-hidden');
    var panel = document.getElementById('boc-panel');
    panel.style.display = 'block';
    panel.style.visibility = 'visible';
    panel.style.opacity = '1';
    panel.removeAttribute('aria-hidden');
  `,
  returnByValue: true
});

// 3. 点击刷新抓取
await session.Runtime.evaluate({
  expression: `document.getElementById('boc-refresh-btn').click()`,
  returnByValue: true
});

// 4. 轮询等待内容就绪
for (let i = 0; i < 15; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const {result} = await session.Runtime.evaluate({
    expression: `JSON.stringify({len: document.querySelector('#boc-panel textarea').value.length})`,
    returnByValue: true
  });
  if (JSON.parse(result.value).len > 100) break;
}

// 5. 提取元数据 + base64 内容
const {result} = await session.Runtime.evaluate({
  expression: `
    (function(){
      var panel = document.getElementById('boc-panel');
      var metaItems = panel.querySelectorAll('.boc-meta-item');
      var meta = {};
      for (var i = 0; i < metaItems.length; i++) {
        var item = metaItems[i];
        var strong = item.querySelector('strong');
        if (strong) {
          var rawKey = strong.textContent.trim();
          var key = rawKey.replace(/[\uff1a:]/g, '');
          var val = item.innerText.substring(rawKey.length).replace(/^[\uff1a:\s]+/, '').trim();
          meta[key] = val;
        }
      }
      var urlMatch = window.location.href.match(/\/video\/(BV[a-zA-Z0-9]+)/);
      var bvid = urlMatch ? urlMatch[1] : 'unknown';
      var ta = panel.querySelector('textarea');
      if (!ta || !ta.value) return JSON.stringify({error:'empty',bvid:bvid,meta:meta});
      var content = ta.value;
      var bytes = new TextEncoder().encode(content);
      var binary = '';
      for (var j = 0; j < bytes.length; j++) binary += String.fromCharCode(bytes[j]);
      return JSON.stringify({bvid:bvid,meta:meta,len:content.length,base64:btoa(binary)});
    })()
  `,
  returnByValue: true
});
return result.value;
```

### Step 5: 保存到 Obsidian vault

用 Python 将 base64 解码并写入 .md 文件：

```python
# save_bili.py <json_path> <output_dir>
import json, base64, os, re, sys

json_path = sys.argv[1]
output_dir = sys.argv[2]

with open(json_path, 'r', encoding='utf-8-sig') as f:
    data = json.load(f)

content_bytes = base64.b64decode(data['base64'])
content = content_bytes.decode('utf-8')

meta = data.get('meta', {})
title = meta.get('标题', meta.get('标题：', 'untitled'))
author = meta.get('作者', meta.get('作者：', ''))
date = meta.get('日期', meta.get('日期：', '2026-01-01'))
url = meta.get('URL', meta.get('URL：', ''))
bvid = data['bvid']

safe_title = re.sub(r'[<>:"/\\|?*]', '', title)[:80]
filename = f'{date} - {safe_title} ({bvid}).md'
filepath = os.path.join(output_dir, filename)

# 写入带 frontmatter 的 Markdown
# ...（见 scripts/save_bili.py 完整实现）
```

### PowerShell 调用模板

```powershell
# 写 JS 到文件 → eval → 保存 JSON → Python 解码保存
$js = [System.IO.File]::ReadAllText("path/to/script.js")
$r = Invoke-WebRequest -Uri "http://127.0.0.1:9876/eval" -Method POST -Body $js -ContentType "text/plain" -UseBasicParsing -TimeoutSec 45
$json = $r.Content.Trim()
[System.IO.File]::WriteAllText("path/to/data.json", $json, [System.Text.UTF8Encoding]::new($false))
python "scripts/save_bili.py" "path/to/data.json" "output_dir"
```

## 关键经验（踩坑记录）

- **browser-harness (Python)** 在 Windows 上不可用（依赖 Unix socket），必须用 **browser-harness-js**（Bun HTTP，端口 9876）
- **"发送到 Obsidian"按钮无法通过 CDP 点击**：扩展在 isolated world 中运行，`dispatchEvent`、`Input.dispatchMouseEvent`、`element.click()` 均无效
- **正确方案**：直接从 DOM textarea 提取内容，写入 vault 文件
- **面板默认 `aria-hidden="true"`**：必须手动移除并设置 display/visibility 才能操作
- **`session.use()` 后 textarea 会清空**：导航+刷新+提取必须在同一个 eval 中完成
- **PowerShell 保存文件编码**：用 `[System.Text.UTF8Encoding]::new($false)` 避免 BOM
- **BOC meta key 带中文冒号**：如 `标题：` 而非 `标题`，需用 `replace(/[\uff1a:]/g, '')` 清理
- **JS 代码用文件传递**：PowerShell here-string 会在 JS 中引入换行符，导致语法错误；应写入 .js 文件再读取

## 错误处理

| 场景 | 处理方式 |
|------|----------|
| CDP 服务器未启动 | 提示启动 browser-harness-js |
| BOC 面板不存在 | 跳过（非视频页面不注入面板） |
| 刷新抓取超时（15s） | 跳过该视频，记录失败 |
| textarea 为空 | 可能页面未加载完成，重试一次 |
| 无字幕 | BOC 会提示无字幕，记录为跳过 |
