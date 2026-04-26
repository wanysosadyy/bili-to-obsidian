/**
 * BiliToObsidian — 批量保存 B 站视频到 Obsidian
 * 
 * 通过 CDP 在浏览器内自动操控 Bilibili Obsidian Clipper 扩展
 * 
 * 使用方式（通过 browser-harness-js）：
 *   browser-harness-js <<'EOF'
 *   // 加载此脚本中的函数，然后调用
 *   // 或者将整个脚本作为 heredoc 传入
 *   EOF
 * 
 * 也可通过 HTTP API 调用：
 *   将脚本内容 POST 到 http://127.0.0.1:9876/eval
 */

// ============================================================
// 工具函数
// ============================================================

/**
 * 等待指定毫秒数
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 在浏览器页面内执行 JS 并返回值
 * @param {string} expression - 要在浏览器内执行的 JS 表达式
 * @returns {Promise<string>} 页面执行结果
 */
async function evalInPage(expression) {
  const { result } = await session.Runtime.evaluate({
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  return result ? result.value : null;
}

/**
 * 检查 BOC 扩展面板是否已加载
 */
async function isBocPanelReady() {
  try {
    const text = await evalInPage(`
      (function() {
        const root = document.querySelector('#boc-root');
        const refresh = document.querySelector('#boc-refresh-btn');
        const send = document.querySelector('#boc-send-btn');
        return JSON.stringify({
          hasRoot: !!root,
          hasRefresh: !!refresh,
          hasSend: !!send,
          text: root ? root.innerText.substring(0, 200) : ''
        });
      })()
    `);
    return JSON.parse(text || '{}');
  } catch (e) {
    return { hasRoot: false, error: e.message };
  }
}

/**
 * 从 UP 主空间页提取视频列表
 * @param {string} uid - UP 主的 UID
 * @param {number} count - 要提取的视频数量
 * @param {number} offset - 起始偏移量
 * @returns {Promise<Array<{bvid: string, title: string}>>}
 */
async function fetchVideoList(uid, count, offset = 0) {
  // 导航到空间视频页
  await session.Page.navigate({
    url: `https://space.bilibili.com/${uid}/upload/video`
  });
  
  // 等待页面加载
  await sleep(6000);
  
  // 滚动到底部触发懒加载
  await evalInPage(`window.scrollTo(0, document.body.scrollHeight)`);
  await sleep(2000);
  
  // 提取视频链接
  const jsonStr = await evalInPage(`
    (function() {
      const cards = document.querySelectorAll('a[href*="/video/"]');
      const seen = new Set();
      const videos = [];
      cards.forEach(a => {
        const href = a.getAttribute('href') || '';
        const match = href.match(/\\/video\\/(BV[a-zA-Z0-9]+)/);
        if (match && !seen.has(match[1])) {
          seen.add(match[1]);
          const title = (a.getAttribute('title') || a.textContent.trim()).substring(0, 80);
          videos.push({ bvid: match[1], title: title });
        }
      });
      return JSON.stringify(videos);
    })()
  `);
  
  try {
    const allVideos = JSON.parse(jsonStr || '[]');
    return allVideos.slice(offset, offset + count);
  } catch (e) {
    console.error('Failed to parse video list:', e);
    return [];
  }
}

/**
 * 处理单个视频：打开 → 刷新抓取 → 发送到 Obsidian
 * @param {string} bvid - 视频 BV 号
 * @returns {Promise<{ok: boolean, bvid: string, message: string}>}
 */
async function processVideo(bvid) {
  const url = `https://www.bilibili.com/video/${bvid}`;
  
  try {
    // 1. 导航到视频页
    await session.Page.navigate({ url });
    await sleep(5000);
    
    // 2. 等待 BOC 面板加载（最多 10 秒）
    let boc = await isBocPanelReady();
    let retries = 0;
    while (!boc.hasRoot && retries < 10) {
      await sleep(1000);
      boc = await isBocPanelReady();
      retries++;
    }
    
    if (!boc.hasRoot) {
      return { ok: false, bvid, message: 'BOC 面板未加载' };
    }
    
    // 3. 点击「刷新抓取」
    if (boc.hasRefresh) {
      await evalInPage(`document.querySelector('#boc-refresh-btn').click()`);
    }
    
    // 4. 轮询等待抓取完成（最长 30 秒）
    let captured = false;
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      const text = await evalInPage(`document.querySelector('#boc-root').innerText`);
      if (text && (text.includes('抓取完成') || text.includes('无字幕') || text.includes('暂无'))) {
        captured = true;
        break;
      }
    }
    
    if (!captured) {
      return { ok: false, bvid, message: '抓取超时（30s）' };
    }
    
    // 检查是否有字幕
    const statusText = await evalInPage(`document.querySelector('#boc-root').innerText`);
    if (statusText && (statusText.includes('无字幕') || statusText.includes('暂无'))) {
      return { ok: false, bvid, message: '视频无字幕/CC' };
    }
    
    // 5. 点击「发送到 Obsidian」
    await evalInPage(`document.querySelector('#boc-send-btn').click()`);
    
    // 6. 轮询等待发送完成（最长 20 秒）
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      const text = await evalInPage(`document.querySelector('#boc-root').innerText`);
      if (text && text.includes('已写入 Obsidian')) {
        return { ok: true, bvid, message: text.match(/已写入 Obsidian[：:]\s*\S+/)?.[0] || '已写入 Obsidian' };
      }
      if (text && (text.includes('发送失败') || text.includes('错误'))) {
        return { ok: false, bvid, message: '发送失败' };
      }
    }
    
    return { ok: false, bvid, message: '发送超时（20s）' };
    
  } catch (e) {
    return { ok: false, bvid, message: `异常: ${e.message}` };
  }
}

// ============================================================
// 主流程（当作为 browser-harness-js 脚本运行时）
// ============================================================

/**
 * 批量处理入口
 * @param {string} uid - UP 主 UID
 * @param {number} count - 视频数量
 * @param {number} offset - 起始偏移
 * @returns {Promise<Object>} 处理结果汇总
 */
async function batchProcess(uid, count, offset = 0) {
  // 确保已连接并选中标签页
  if (!globalThis.tid) {
    const tabs = await listPageTargets();
    globalThis.tid = tabs[0].targetId;
    await session.use(globalThis.tid);
  }
  
  // 获取视频列表
  const videos = await fetchVideoList(uid, count, offset);
  
  if (videos.length === 0) {
    return { total: 0, success: 0, failed: 0, results: [], error: '未找到视频' };
  }
  
  // 逐个处理
  const results = [];
  for (let i = 0; i < videos.length; i++) {
    const { bvid, title } = videos[i];
    console.log(`[${i + 1}/${videos.length}] Processing: ${bvid} - ${title}`);
    const result = await processVideo(bvid);
    result.title = title;
    results.push(result);
    console.log(`  → ${result.ok ? 'OK' : 'FAIL'}: ${result.message}`);
  }
  
  const success = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  
  return {
    uid,
    total: videos.length,
    success,
    failed,
    results
  };
}

// 导出函数名（供外部调用时参考）
// batchProcess(uid, count, offset)
// fetchVideoList(uid, count, offset)
// processVideo(bvid)
// isBocPanelReady()
// evalInPage(expression)
