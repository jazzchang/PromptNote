/**
 * 咒语便签 - PromptNote  v1.2.5
 * Popup Script
 *
 * 架构：
 * - scripting.executeScript 只从页面提取数据（图片URL、标题、提示词）
 * - Eagle API 在 popup 上下文直接调用（无 Origin 头 → 不触发 Eagle 401）
 *
 * 提取策略（用户确认的精确 CSS 类名）：
 * - 提示词：span[class*="prompt-value-container"]
 * - 标题：div[class*="title-wrapper"]，找不到则取提示词第一个中文词
 */

// ─── DOM ─────────────────────────────────────────────────────────────────────
const eagleStatus = document.getElementById('eagleStatus');
const eagleStatusTxt = document.getElementById('eagleStatusText');
const notJimeng = document.getElementById('notJimengWarning');
const mainContent = document.getElementById('mainContent');
const mainFooter = document.getElementById('mainFooter');
const folderSelect = document.getElementById('folderSelect');
const folderCount = document.getElementById('folderCount');
const refreshBtn = document.getElementById('refreshFolderBtn');
const saveCurrentBtn = document.getElementById('saveCurrentBtn');
const saveAllBtn = document.getElementById('saveAllBtn');
const statusBar = document.getElementById('statusBar');
const statusIcon = document.getElementById('statusIcon');
const statusText = document.getElementById('statusText');
const autoAnnotation = document.getElementById('autoAnnotation');
const autoTags = document.getElementById('autoTags');
const rememberFolder = document.getElementById('rememberFolder');
const openJimengBtn = document.getElementById('openJimengBtn');
const eagleOffline = document.getElementById('eagleOfflineNotice');
const tokenInput = document.getElementById('eagleApiToken');
const tokenEyeBtn = document.getElementById('tokenEyeBtn');
const tokenStatus = document.getElementById('tokenStatus');

let isOnJimeng = false;
let isEagleRunning = false;
let currentFolders = [];
let currentTab = null;

// ─── 初始化 ──────────────────────────────────────────────────────────────────
async function init() {
    await loadSettings();
    await checkCurrentTab();
    await checkEagle();
    if (isOnJimeng && isEagleRunning) await loadFolders();
    setupEvents();
}

async function checkCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;
    isOnJimeng = !!tab?.url?.includes('jimeng.jianying.com');
    if (isOnJimeng) {
        notJimeng.classList.remove('show');
        mainContent.style.display = 'flex';
        mainFooter.style.display = 'flex';
    } else {
        notJimeng.classList.add('show');
        mainContent.style.display = 'none';
    }
}

async function checkEagle() {
    try {
        const ctrl = new AbortController();
        setTimeout(() => ctrl.abort(), 3000);
        const res = await fetch('http://localhost:41595/api/application/info', { signal: ctrl.signal });
        if (res.ok) {
            isEagleRunning = true;
            eagleStatus.className = 'eagle-status connected';
            eagleStatusTxt.textContent = 'Eagle已连接';
            eagleOffline.classList.remove('show');
            return;
        }
    } catch { }
    isEagleRunning = false;
    eagleStatus.className = 'eagle-status disconnected';
    eagleStatusTxt.textContent = 'Eagle未连接';
    if (isOnJimeng) eagleOffline.classList.add('show');
}

async function loadFolders() {
    folderCount.textContent = '加载中...';
    try {
        const res = await fetch('http://localhost:41595/api/folder/list');
        const data = await res.json();
        if (data.status !== 'success') throw new Error('获取文件夹失败');
        currentFolders = flattenFolders(data.data || []);
        renderFolders();
        folderCount.textContent = `${currentFolders.length} 个文件夹`;
        const { selectedFolderId } = await chrome.storage.local.get('selectedFolderId');
        if (selectedFolderId) folderSelect.value = selectedFolderId;
    } catch (err) {
        folderCount.textContent = '加载失败';
        showStatus('文件夹加载失败: ' + err.message, 'error');
    }
}

function flattenFolders(arr, depth = 0) {
    let r = [];
    for (const f of arr) {
        r.push({ id: f.id, name: f.name, depth, displayName: '　'.repeat(depth) + f.name });
        if (f.children?.length) r = r.concat(flattenFolders(f.children, depth + 1));
    }
    return r;
}

function renderFolders() {
    while (folderSelect.options.length > 1) folderSelect.remove(1);
    const sep = document.createElement('option');
    sep.disabled = true; sep.textContent = '─────────────────';
    folderSelect.appendChild(sep);
    currentFolders.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.id; opt.textContent = '📁 ' + f.displayName;
        folderSelect.appendChild(opt);
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Step 1: scripting.executeScript 从页面提取数据
// ═══════════════════════════════════════════════════════════════════════
async function extractFromPage(mode) {
    if (!currentTab) return null;
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId: currentTab.id },
            func: extractPageData,
            args: [mode]
        });
        return results?.[0]?.result || null;
    } catch (err) {
        return { error: err.message };
    }
}

/**
 * 注入到页面中执行，完全自包含。
 * 使用用户确认的精确 CSS 类名（部分匹配，兼容 hash 后缀变化）：
 *   - 提示词：span[class*="prompt-value-container"]
 *   - 标题：div[class*="title-wrapper"]
 */
function extractPageData(mode) {

    function isIconLike(url) {
        return !url || /avatar|\/icon|logo|emoji|placeholder|default|\.ico/.test(url);
    }
    function cleanUrl(url) {
        if (!url || url.startsWith('data:') || url.startsWith('blob:')) return null;
        return url.replace(/(aigc_resize)[_:](\d+)[_:](\d+)/g, '$1:2048:2048');
    }
    function findMainImg() {
        const all = Array.from(document.querySelectorAll('img[src]'))
            .filter(i => (i.src.includes('byteimg.com') || i.src.includes('dreamina'))
                && !isIconLike(i.src) && i.naturalHeight > 50);
        if (!all.length) return null;
        const hd = all.filter(i => i.src.includes('aigc_resize') || i.src.includes('aigc_'));
        const list = hd.length ? hd : all;
        list.sort((a, b) => b.naturalHeight - a.naturalHeight);
        return list[0]?.src || null;
    }
    function findAllImgs() {
        return Array.from(document.querySelectorAll('img[src]'))
            .filter(i => !isIconLike(i.src) && i.naturalWidth >= 80 &&
                (i.src.includes('byteimg.com') || i.src.includes('dreamina')
                    || i.src.includes('lf3') || i.src.includes('lf26')))
            .map(i => cleanUrl(i.src)).filter(Boolean);
    }

    // ── 提示词：用精确类名（部分匹配） ─────────────────────────────────────
    function extractPrompt() {
        // 用户确认：提示词在 span[class*="prompt-value-container"]
        const el = document.querySelector('[class*="prompt-value-container"]');
        if (el) {
            const t = (el.innerText || el.textContent || '').trim();
            if (t.length > 0) return t;
        }
        return '';
    }

    // ── 标题：用精确类名（部分匹配），找不到则取提示词首词 ────────────────
    function extractTitle(prompt) {
        // 用户确认：标题在 div[class*="title-wrapper"]
        const el = document.querySelector('[class*="title-wrapper"]');
        if (el) {
            const t = (el.innerText || el.textContent || '').trim();
            if (t.length > 0 && t.length <= 60) return t;
        }
        // 兜底：取提示词第一个中文词（逗号/顿号前的内容）
        if (prompt) {
            const firstWord = prompt.split(/[，,、。\s]/)[0].trim();
            if (firstWord.length >= 2 && firstWord.length <= 20) return firstWord;
        }
        return '';
    }

    if (mode === 'current') {
        const url = cleanUrl(findMainImg());
        if (!url) return { error: '未找到图片，请在即梦图片详情页使用' };
        const prompt = extractPrompt();
        const title = extractTitle(prompt);
        return { url, title, prompt, pageUrl: location.href };
    } else {
        const urls = findAllImgs();
        if (!urls.length) return { error: '页面未找到AI图片' };
        return { urls, pageUrl: location.href };
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Step 2: popup 上下文直接调 Eagle API（无 Origin 头 → 无 401）
// ═══════════════════════════════════════════════════════════════════════
async function callEagleApi(imageUrl, name, annotation, folderId, websiteUrl) {
    const { eagleApiToken, autoTags: at } = await chrome.storage.local.get(['eagleApiToken', 'autoTags']);
    const token = eagleApiToken || '';
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${String(token).replace(/[^\x20-\x7E]/g, '')}`;

    const body = {
        url: imageUrl,
        name: name || '即梦AI作品',
        website: websiteUrl || 'https://jimeng.jianying.com',
        annotation: annotation || '',
        tags: at !== false ? ['即梦', 'PromptNote', 'AI生成'] : [],
        headers: { referer: 'https://jimeng.jianying.com/' }
    };
    if (folderId) body.folderId = folderId;

    const res = await fetch('http://localhost:41595/api/item/addFromURL', {
        method: 'POST', headers, body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.status !== 'success') throw new Error(data.message || 'Eagle返回错误');
    return data;
}



// ─── 事件绑定 ─────────────────────────────────────────────────────────────────
function setupEvents() {
    openJimengBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: 'https://jimeng.jianying.com/ai-tool/home' });
        window.close();
    });

    refreshBtn.addEventListener('click', async () => {
        refreshBtn.style.opacity = '0.5'; refreshBtn.style.pointerEvents = 'none';
        await checkEagle(); await loadFolders();
        refreshBtn.style.opacity = ''; refreshBtn.style.pointerEvents = '';
        showStatus('文件夹列表已刷新', 'success');
    });

    folderSelect.addEventListener('change', () => {
        if (rememberFolder.checked) chrome.storage.local.set({ selectedFolderId: folderSelect.value });
    });

    // 保存当前图片
    saveCurrentBtn.addEventListener('click', async () => {
        if (!isEagleRunning) { showStatus('请先启动 Eagle 软件', 'error'); return; }
        saveCurrentBtn.classList.add('loading'); saveCurrentBtn.disabled = true;

        try {
            const data = await extractFromPage('current');
            if (!data || data.error) throw new Error(data?.error || '提取图片失败');

            const { autoAnnotation: aa } = await chrome.storage.local.get('autoAnnotation');
            const annotation = aa !== false ? (data.prompt || '') : '';

            // 文件名：① 图片标题 ② 提示词前60字 ③ 默认
            let name = '即梦AI作品';
            if (data.title && data.title.length > 0) {
                name = data.title;
            } else if (annotation.length > 0) {
                name = annotation.substring(0, 60).replace(/\s+/g, ' ').trim();
            }

            await callEagleApi(data.url, name, annotation, folderSelect.value, data.pageUrl);
            showStatus(`已保存「${name}」！`, 'success');

            // UI Feedback that lasts until window closes
            const btnTexts = saveCurrentBtn.querySelector('.action-btn-texts') || saveCurrentBtn;
            if (btnTexts.querySelector('.action-btn-label')) {
                btnTexts.querySelector('.action-btn-label').textContent = '已保存 ✓';
                saveCurrentBtn.style.background = 'var(--success)';
            }

            setTimeout(() => window.close(), 1000); // clear feedback by closing
        } catch (err) {
            showStatus('保存失败：' + err.message, 'error');
        } finally {
            saveCurrentBtn.classList.remove('loading'); saveCurrentBtn.disabled = false;
        }
    });



    autoAnnotation.addEventListener('change', saveSettings);
    autoTags.addEventListener('change', saveSettings);
    rememberFolder.addEventListener('change', saveSettings);

    let tokenTimer;
    tokenInput.addEventListener('input', () => {
        clearTimeout(tokenTimer);
        const v = tokenInput.value.trim();
        tokenInput.classList.toggle('has-value', v.length > 0);
        tokenStatus.textContent = '未保存'; tokenStatus.style.color = 'var(--warning)';
        tokenTimer = setTimeout(async () => {
            await chrome.storage.local.set({ eagleApiToken: v });
            tokenStatus.textContent = v ? '已保存 ✓' : '';
            tokenStatus.style.color = v ? 'var(--success)' : 'var(--text-muted)';
        }, 600);
    });

    tokenEyeBtn.addEventListener('click', () => {
        const shown = tokenInput.type === 'text';
        tokenInput.type = shown ? 'password' : 'text';
        tokenEyeBtn.querySelector('svg').innerHTML = shown
            ? `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>`
            : `<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19M1 1l22 22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" opacity="0.3"/>`;
    });
}

// ─── 设置 ─────────────────────────────────────────────────────────────────────
async function loadSettings() {
    const s = await chrome.storage.local.get(['autoAnnotation', 'autoTags', 'rememberFolder', 'eagleApiToken']);
    autoAnnotation.checked = s.autoAnnotation !== false;
    autoTags.checked = s.autoTags !== false;
    rememberFolder.checked = s.rememberFolder !== false;
    const token = s.eagleApiToken || '';
    tokenInput.value = token;
    tokenInput.classList.toggle('has-value', token.length > 0);
    if (token) { tokenStatus.textContent = '已保存 ✓'; tokenStatus.style.color = 'var(--success)'; }
}

async function saveSettings() {
    await chrome.storage.local.set({
        autoAnnotation: autoAnnotation.checked,
        autoTags: autoTags.checked,
        rememberFolder: rememberFolder.checked
    });
}

let statusTimeout;
function showStatus(msg, type = 'info') {
    clearTimeout(statusTimeout);
    statusBar.className = `status-bar show ${type}`;
    statusIcon.textContent = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
    statusText.textContent = msg;
    statusTimeout = setTimeout(() => statusBar.classList.remove('show'), 5000);
}

init().catch(console.error);
