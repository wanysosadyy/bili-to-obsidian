# BiliToObsidian

通过 Chrome DevTools Protocol (CDP) 自动化 [Bilibili Obsidian Clipper](https://github.com/youyooolf/bilibili-obsidian-clipper) 浏览器扩展，批量将 B 站 UP 主空间视频的字幕/文稿保存到 Obsidian。

## 工作原理

利用 `browser-harness-js` CDP 工具连接已开启调试端口的 Edge/Chrome 浏览器，在浏览器内自动执行以下操作：

1. 导航到 UP 主空间页，提取视频列表
2. 逐个打开视频页面
3. 点击 BOC 扩展的「刷新抓取」按钮抓取字幕
4. 点击「发送到 Obsidian」按钮保存到 vault

## 前置条件

- **Edge/Chrome** 带调试端口启动：`--remote-debugging-port=9222`
- [Bilibili Obsidian Clipper](https://github.com/youyooolf/bilibili-obsidian-clipper) 扩展已安装
- [browser-harness-js](https://github.com/nicosql/browser-harness-js)（CDP 工具）可用
- Obsidian 运行中且 Local REST API 插件已启用

## 作为 WorkBuddy 技能使用

将 `bili-to-obsidian/` 目录放入 `~/.workbuddy/skills/`，然后告诉 AI：

> 帮我把 https://space.bilibili.com/{space.id} 的最近 5 个视频保存到 Obsidian

AI 会自动询问 UP 主链接和视频数量，然后批量处理。存储路径为扩展程序的保存地址，默认 Clippings/Bilibili/，可自定义。

## 文件结构

```
bili-to-obsidian/
├── SKILL.md              # 技能定义（触发词、工作流程、实现细节）
├── scripts/
│   └── bili_batch.js     # 核心自动化脚本（CDP 调用逻辑）
├── README.md
└── LICENSE
```

## 技术栈

- **CDP (Chrome DevTools Protocol)** — 浏览器自动化
- **browser-harness-js** — CDP 连接工具
- **Bilibili Obsidian Clipper** — 字幕抓取与 Obsidian 集成

## License

MIT
