---
name: bili-to-obsidian
description: 通过 CDP 自动化 Bilibili Obsidian Clipper 浏览器扩展，批量将 B 站 UP 主空间视频的字幕/文稿保存到 Obsidian。触发词：B站保存到Obsidian、BiliToObsidian、批量保存B站视频、收集B站视频、B站字幕导出、B站文稿保存
---

# BiliToObsidian — B 站视频批量保存到 Obsidian

通过 Chrome DevTools Protocol (CDP) 自动操控 "Bilibili Obsidian Clipper" 浏览器扩展，批量将指定 UP 主空间内的视频字幕/文稿抓取并保存到 Obsidian vault。

## 前置条件

1. **Edge/Chrome 浏览器** 已安装并启动（需带 `--remote-debugging-port=9222` 参数）
2. **Bilibili Obsidian Clipper 扩展** 已安装（扩展 ID: `fbeeapnjdjgacilaobonekidbfjcmdjo`）
3. **browser-harness-js** CDP 工具可用（依赖 cdp skill）
4. **Obsidian** 已运行且 Obsidian Clipper 扩展的 Local REST API 插件已启用

## 工作流程

### 触发时的第一步

当用户调用此技能时，**必须先询问用户以下信息**（除非已在请求中提供）：

1. **UP 主空间链接或 UID**：例如 `https://space.bilibili.com/28321599` 或仅 UID `28321599`
2. **要收集的视频数量**：**必须询问用户**，如果用户没说，默认 **5** 个
3. **保存目录**（可选）：默认 `Clippings/Bilibili/`，可让用户自定义

### 完整流程

```
1. 确认浏览器已带调试端口运行
2. 通过 CDP 连接浏览器（session.connect()）
3. 导航到 UP 主空间页 → 提取视频列表（BV号 + 标题）
4. 展示列表给用户确认
5. 逐个视频执行自动化：
   a. 导航到视频页面
   b. 等待 BOC 扩展面板注入（#boc-root）
   c. 点击「刷新抓取」按钮
   d. 轮询等待抓取完成（最长 30s）
   e. 点击「发送到 Obsidian」按钮
   f. 轮询等待发送完成，记录结果
6. 汇总报告：成功数/失败数/文件路径列表
```

## 关键实现细节

### 扩展面板选择器

Bilibili Obsidian Clipper 在视频页面注入的面板结构：

| 元素 | 选择器 | 用途 |
|------|--------|------|
| 面板容器 | `#boc-root` | 检测扩展是否加载 |
| 状态文本 | `#boc-root p, #boc-root span` | 判断当前状态 |
| 刷新抓取按钮 | `#boc-refresh-btn` | 触发字幕抓取 |
| 发送到 Obsidian 按钮 | `#boc-send-btn` | 发送抓取结果到 Obsidian |

### 状态判断逻辑

- 页面刚加载：状态文本包含 `"检测到页面变化"` → 需要点击刷新
- 抓取中：状态文本包含 `"抓取中"` → 等待
- 抓取完成：状态文本包含 `"抓取完成"` → 可以点击发送
- 发送中：按钮 disabled → 等待
- 发送完成：状态文本包含 `"已写入 Obsidian"` → 成功

### 从空间页提取视频列表

空间视频页 URL 格式：`https://space.bilibili.com/{UID}/upload/video`

```javascript
// 在浏览器内执行，提取视频列表
const cards = document.querySelectorAll('a[href*="/video/"]');
const seen = new Set();
const videos = [];
cards.forEach(a => {
  const href = a.getAttribute('href') || '';
  const match = href.match(/\/video\/(BV[a-zA-Z0-9]+)/);
  if (match && !seen.has(match[1])) {
    seen.add(match[1]);
    videos.push({ bvid: match[1], title: a.textContent.trim().substring(0, 50) });
  }
});
return videos.slice(0, count);
```

### 批量自动化核心逻辑

对每个视频执行以下操作（在浏览器内通过 `session.Runtime.evaluate` 运行）：

```javascript
// 1. 导航到视频页
await session.Page.navigate({ url: `https://www.bilibili.com/video/${bvid}` });
await new Promise(r => setTimeout(r, 5000)); // 等待扩展注入

// 2. 点击刷新抓取
await session.Runtime.evaluate({
  expression: `document.querySelector('#boc-refresh-btn').click()`,
  awaitPromise: false
});

// 3. 轮询等待抓取完成（最长 30s）
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const { result } = await session.Runtime.evaluate({
    expression: `document.querySelector('#boc-root').innerText`,
    returnByValue: true
  });
  if (result.value.includes('抓取完成')) break;
}

// 4. 点击发送到 Obsidian
await session.Runtime.evaluate({
  expression: `document.querySelector('#boc-send-btn').click()`,
  awaitPromise: false
});

// 5. 等待发送完成，提取结果消息
for (let i = 0; i < 20; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const { result } = await session.Runtime.evaluate({
    expression: `document.querySelector('#boc-root').innerText`,
    returnByValue: true
  });
  if (result.value.includes('已写入 Obsidian')) {
    // 提取文件路径
    return result.value;
  }
}
```

## CDP 调用方式

使用 cdp skill 的 `browser-harness-js` CLI：

```bash
# 启动并连接
browser-harness-js 'await session.connect()'

# 选取标签页
browser-harness-js 'const tabs = await listPageTargets(); globalThis.tid = tabs[0].targetId; await session.use(globalThis.tid); return globalThis.tid'

# 在浏览器内执行 JS（关键：所有页面操作必须用 Runtime.evaluate）
browser-harness-js <<'EOF'
const { result } = await session.Runtime.evaluate({
  expression: 'document.title',
  returnByValue: true
});
return result.value;
EOF
```

**重要**：`browser-harness-js` 的 eval 在服务器端执行，浏览器 DOM 操作必须通过 `session.Runtime.evaluate({expression: '...', returnByValue: true})` 在浏览器内运行。直接写 `document.querySelector()` 会报 `location is not defined`。

## 错误处理

| 场景 | 处理方式 |
|------|----------|
| 浏览器未启动调试端口 | 提示用户用 `--remote-debugging-port=9222` 重启浏览器 |
| BOC 面板未注入 | 等待最多 10 秒，仍未出现则跳过该视频并记录 |
| 抓取超时（30s） | 跳过该视频，记录失败 |
| 发送超时（20s） | 跳过该视频，记录失败 |
| 无字幕/CC 字幕 | 扩展会提示无字幕，记录为跳过 |

## 注意事项

- B 站空间页视频列表是懒加载的，页面需要完全渲染后才能提取所有链接
- 每个视频处理约需 10-15 秒（含页面加载 + 抓取 + 发送）
- 扩展只在 `bilibili.com/video/` 页面生效，空间页不会注入面板
- 如果用户中途关闭浏览器或断开连接，已成功的视频不会重复处理（Obsidian 文件已存在）
- **视频数量必须询问用户，未指定时默认 5 个**
- **保存目录默认 `Clippings/Bilibili/`，可让用户自定义输入**