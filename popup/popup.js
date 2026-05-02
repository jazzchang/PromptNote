/**
 * 咒语便签 - PromptNote v2.0
 * Popup Script
 *
 * 功能：
 * - Eagle 连接检测与状态显示
 * - 页面图片提取（支持列表页/瀑布流）
 * - 多选模式与批量保存
 * - 提示词格式化与复制
 * - 历史记录显示与搜索
 * - 自定义标签与备注编辑
 * - 导出功能
 */

// ─── DOM Elements ─────────────────────────────────────────────────────────────
// Header
const eagleStatus = document.getElementById('eagleStatus');
const eagleStatusText = document.getElementById('eagleStatusText');
const eaglePortDisplay = document.getElementById('eaglePortDisplay');
const refreshBtn = document.getElementById('refreshBtn');
const settingsBtn = document.getElementById('settingsBtn');

// Not Jimeng
const notJimengWarning = document.getElementById('notJimengWarning');
const mainContent = document.getElementById('mainContent');
const mainFooter = document.getElementById('mainFooter');
const openJimengBtn = document.getElementById('openJimengBtn');

// Eagle offline
const eagleOffline = document.getElementById('eagleOfflineNotice');

// Tabs
const tabBtns = document.querySelectorAll('.tab-btn');
const tabCurrent = document.getElementById('tab-current');
const tabHistory = document.getElementById('tab-history');
const currentCount = document.getElementById('currentCount');
const historyCount = document.getElementById('historyCount');

// Current Tab
const folderSelect = document.getElementById('folderSelect');
const folderCount = document.getElementById('folderCount');
const popupTagInput = document.getElementById('popupTagInput');
const popupTagsDisplay = document.getElementById('popupTagsDisplay');
const popupNoteInput = document.getElementById('popupNoteInput');
const imageList = document.getElementById('imageList');
const selectAllBtn = document.getElementById('selectAllBtn');
const deselectAllBtn = document.getElementById('deselectAllBtn');
const formatPromptBtn = document.getElementById('formatPromptBtn');
const copyPromptBtn = document.getElementById('copyPromptBtn');
const saveSelectedBtn = document.getElementById('saveSelectedBtn');
const selectionInfo = document.getElementById('selectionInfo');

// History Tab
const historySearch = document.getElementById('historySearch');
const formatSelect = document.getElementById('formatSelect');
const historyList = document.getElementById('historyList');
const exportHistoryBtn = document.getElementById('exportHistoryBtn');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const copyAllPromptsBtn = document.getElementById('copyAllPromptsBtn');

// Batch Progress
const batchProgress = document.getElementById('batchProgress');
const progressCount = document.getElementById('progressCount');
const progressFill = document.getElementById('progressFill');

// Status Bar
const statusBar = document.getElementById('statusBar');
const statusIcon = document.getElementById('statusIcon');
const statusText = document.getElementById('statusText');

// ─── State ─────────────────────────────────────────────────────────────────────
let isOnJimeng = false;
let isEagleRunning = false;
let currentTabId = null;
let currentFolders = [];
let pageImages = [];
let selectedImageIndices = new Set();
let popupTags = [];
let currentHistory = [];

// ─── Constants ─────────────────────────────────────────────────────────────────
const DEFAULT_EAGLE_PORT = '41595';

// ─── Initialization ────────────────────────────────────────────────────────────
async function init() {
    await loadSettings();
    await checkCurrentTab();
    await checkEagle();
    if (isOnJimeng) {
        await loadFolders();
        await extractPageImages();
    }
    await loadHistory();
    setupEventListeners();
}

async function loadSettings() {
    const settings = await chrome.storage.local.get([
        'eaglePort',
        'eagleApiToken',
        'customTags',
        'rememberFolder',
        'selectedFolderId'
    ]);

    const port = settings.eaglePort || DEFAULT_EAGLE_PORT;
    eaglePortDisplay.textContent = port;

    popupTags = settings.customTags || [];
    renderPopupTags();
}

async function checkCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = tab?.id;
    isOnJimeng = !!tab?.url?.includes('jimeng.jianying.com');

    if (isOnJimeng) {
        notJimengWarning.classList.remove('show');
        mainContent.style.display = 'block';
        mainFooter.style.display = 'flex';
    } else {
        notJimengWarning.classList.add('show');
        mainContent.style.display = 'none';
    }
}

async function checkEagle() {
    const settings = await chrome.storage.local.get(['eaglePort', 'eagleApiToken']);
    const port = settings.eaglePort || DEFAULT_EAGLE_PORT;
    const token = settings.eagleApiToken || '';

    try {
        const result = await chrome.runtime.sendMessage({
            type: 'EAGLE_CHECK_CONNECTION',
            payload: { port, token }
        });

        if (result && result.success) {
            isEagleRunning = true;
            eagleStatus.className = 'eagle-status connected';
            eagleStatusText.textContent = 'Eagle已连接';
            eagleOffline.classList.remove('show');
            return;
        }
    } catch { }

    isEagleRunning = false;
    eagleStatus.className = 'eagle-status disconnected';
    eagleStatusText.textContent = 'Eagle未连接';
    if (isOnJimeng) eagleOffline.classList.add('show');
}

async function loadFolders() {
    folderCount.textContent = '加载中...';
    try {
        const settings = await chrome.storage.local.get(['eagleApiToken']);
        const result = await chrome.runtime.sendMessage({
            type: 'FETCH_FOLDERS',
            payload: { token: settings.eagleApiToken }
        });

        if (result && result.success) {
            currentFolders = result.folders || [];
            renderFolders();
            folderCount.textContent = `${currentFolders.length} 个文件夹`;

            const { selectedFolderId, rememberFolder } = await chrome.storage.local.get(['selectedFolderId', 'rememberFolder']);
            if (selectedFolderId && rememberFolder !== false) {
                folderSelect.value = selectedFolderId;
            }
        } else {
            folderCount.textContent = '加载失败';
        }
    } catch (err) {
        folderCount.textContent = '加载失败';
        showStatus('文件夹加载失败: ' + err.message, 'error');
    }
}

function renderFolders() {
    while (folderSelect.options.length > 1) {
        folderSelect.remove(1);
    }

    if (currentFolders.length > 0) {
        const sep = document.createElement('option');
        sep.disabled = true;
        sep.textContent = '─────────────────';
        folderSelect.appendChild(sep);

        currentFolders.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f.id;
            opt.textContent = '📁 ' + f.displayName;
            folderSelect.appendChild(opt);
        });
    }
}

// ─── Page Image Extraction ─────────────────────────────────────────────────────
async function extractPageImages() {
    if (!currentTabId) return;

    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId: currentTabId },
            func: extractAllImagesWithPrompts
        });

        pageImages = results?.[0]?.result || [];
        selectedImageIndices.clear();
        renderImageList();
        currentCount.textContent = pageImages.length.toString();
        updateSelectionInfo();
    } catch (err) {
        console.error('Failed to extract images:', err);
        imageList.innerHTML = '<div class="history-empty">提取图片失败<br><span style="font-size:10px;color:var(--text-muted)">请刷新页面后重试</span></div>';
    }
}

function extractAllImagesWithPrompts() {
    function isIconLike(url) {
        return !url || /avatar|\/icon|logo|emoji|placeholder|default|\.ico|favicon/.test(url);
    }

    function hasSignatureParams(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.searchParams.has('x-signature') || 
                   urlObj.searchParams.has('lk3s') ||
                   urlObj.searchParams.has('sign') ||
                   urlObj.searchParams.has('x-expires');
        } catch {
            return /x-signature|lk3s=|sign=|x-expires/.test(url);
        }
    }

    function cleanUrl(url) {
        if (!url || url.startsWith('data:') || url.startsWith('blob:')) return null;
        if (hasSignatureParams(url)) {
            return url;
        }
        return url.replace(/(aigc_resize)[_:](\d+)[_:](\d+)/g, '$1:2048:2048');
    }

    function extractPromptFromContext(img) {
        let prompt = '';
        let title = '';

        let el = img.parentElement;
        for (let i = 0; i < 10; i++) {
            if (!el || el === document.body) break;

            const pEl = el.querySelector('[class*="prompt-value-container"], [class*="prompt-text"], [class*="desc-prompt"]');
            if (pEl) {
                const t = (pEl.innerText || pEl.textContent || '').trim();
                if (t.length > 5) {
                    prompt = t;
                    break;
                }
            }

            const tEl = el.querySelector('[class*="title-wrapper"], [class*="img-title"], [class*="work-title"]');
            if (tEl && !title) {
                const t = (tEl.innerText || tEl.textContent || '').trim();
                if (t.length > 0 && t.length <= 60) {
                    title = t;
                }
            }

            el = el.parentElement;
        }

        if (!prompt) {
            const globalPrompt = document.querySelector('[class*="prompt-value-container"], [class*="prompt-text"]');
            if (globalPrompt) {
                const t = (globalPrompt.innerText || globalPrompt.textContent || '').trim();
                if (t.length > 5) prompt = t;
            }
        }

        if (!prompt && img.alt && img.alt.length > 5) {
            prompt = img.alt.trim();
        }

        if (!title && prompt) {
            const firstWord = prompt.split(/[，,、。\s]/)[0].trim();
            if (firstWord.length >= 2 && firstWord.length <= 20) {
                title = firstWord;
            } else {
                title = prompt.substring(0, 40).trim();
            }
        }

        return { prompt, title: title || '即梦AI作品' };
    }

    function findPageUrl(img) {
        let el = img.parentElement;
        for (let i = 0; i < 10; i++) {
            if (!el || el === document.body) break;
            if (el.tagName === 'A' && el.href && !el.href.includes('javascript:')) {
                return el.href;
            }
            el = el.parentElement;
        }
        return location.href;
    }

    const allImgs = Array.from(document.querySelectorAll('img[src]'));
    const results = [];
    const seenUrls = new Set();

    const sortedImgs = allImgs
        .filter(img => {
            if (isIconLike(img.src)) return false;
            if (img.naturalWidth < 80 && img.naturalWidth !== 0) return false;
            if (img.offsetWidth < 50) return false;
            if (!(img.src.includes('byteimg.com') || img.src.includes('dreamina') ||
                  img.src.includes('lf3') || img.src.includes('lf26'))) return false;
            return true;
        })
        .sort((a, b) => {
            const aIsHd = a.src.includes('aigc_resize') || a.src.includes('aigc_');
            const bIsHd = b.src.includes('aigc_resize') || b.src.includes('aigc_');
            if (aIsHd !== bIsHd) return aIsHd ? -1 : 1;
            return b.naturalHeight - a.naturalHeight;
        });

    for (const img of sortedImgs) {
        const url = cleanUrl(img.src);
        if (!url || seenUrls.has(url)) continue;
        seenUrls.add(url);

        const { prompt, title } = extractPromptFromContext(img);
        const website = findPageUrl(img);

        results.push({
            url,
            title,
            prompt,
            website,
            thumbnail: img.src
        });

        if (results.length >= 50) break;
    }

    return results;
}

function renderImageList() {
    if (pageImages.length === 0) {
        imageList.innerHTML = '<div class="history-empty">未找到图片<br><span style="font-size:10px;color:var(--text-muted)">请在即梦页面使用，或点击刷新按钮</span></div>';
        return;
    }

    imageList.innerHTML = pageImages.map((img, index) => `
        <div class="image-item ${selectedImageIndices.has(index) ? 'selected' : ''}" data-index="${index}">
            <div class="image-checkbox">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <path d="M5 12l5 5L20 7" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </div>
            <img class="image-thumb" src="${img.thumbnail || img.url}" alt="" onerror="this.style.display='none'">
            <div class="image-info">
                <div class="image-name">${escapeHtml(img.title)}</div>
                <div class="image-prompt">${img.prompt ? escapeHtml(img.prompt.substring(0, 50)) : '暂无提示词'}</div>
            </div>
            <div class="image-actions">
                <button class="mini-btn copy-prompt-btn" data-index="${index}" title="复制提示词">📋</button>
                <button class="mini-btn save-single-btn" data-index="${index}" title="单独保存">💾</button>
            </div>
        </div>
    `).join('');

    imageList.querySelectorAll('.image-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.mini-btn')) return;
            const index = parseInt(item.dataset.index);
            toggleImageSelection(index);
        });
    });

    imageList.querySelectorAll('.copy-prompt-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const index = parseInt(btn.dataset.index);
            copySinglePrompt(index);
        });
    });

    imageList.querySelectorAll('.save-single-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const index = parseInt(btn.dataset.index);
            saveSingleImage(index);
        });
    });
}

function toggleImageSelection(index) {
    if (selectedImageIndices.has(index)) {
        selectedImageIndices.delete(index);
    } else {
        selectedImageIndices.add(index);
    }

    const item = imageList.querySelector(`[data-index="${index}"]`);
    if (item) {
        item.classList.toggle('selected', selectedImageIndices.has(index));
    }

    updateSelectionInfo();
}

function updateSelectionInfo() {
    const count = selectedImageIndices.size;
    selectionInfo.textContent = `已选择 ${count} 张图片`;
    saveSelectedBtn.disabled = count === 0 || !isEagleRunning;
}

// ─── History ───────────────────────────────────────────────────────────────────
async function loadHistory() {
    try {
        const result = await chrome.runtime.sendMessage({
            type: 'GET_HISTORY',
            payload: { limit: 100 }
        });

        if (result && result.success) {
            currentHistory = result.items || [];
            renderHistoryList(currentHistory);
            historyCount.textContent = result.total.toString();
        }
    } catch (err) {
        console.error('Failed to load history:', err);
    }
}

function renderHistoryList(items) {
    if (items.length === 0) {
        historyList.innerHTML = '<div class="history-empty">暂无保存记录<br><span style="font-size:10px;color:var(--text-muted)">保存的图片会显示在这里</span></div>';
        return;
    }

    historyList.innerHTML = items.map((item, index) => `
        <div class="history-item" data-index="${index}">
            <div class="history-header">
                <div class="history-name">${escapeHtml(item.name || '即梦AI作品')}</div>
                <div class="history-date">${formatDate(item.savedAt)}</div>
            </div>
            ${item.prompt ? `<div class="history-prompt">${escapeHtml(item.prompt)}</div>` : ''}
            ${item.tags && item.tags.length > 0 ? `
                <div class="history-tags">
                    ${item.tags.slice(0, 5).map(t => `<span class="history-tag">${escapeHtml(t)}</span>`).join('')}
                    ${item.tags.length > 5 ? `<span class="history-tag">+${item.tags.length - 5}</span>` : ''}
                </div>
            ` : ''}
        </div>
    `).join('');

    historyList.querySelectorAll('.history-item').forEach(item => {
        item.addEventListener('click', () => {
            const index = parseInt(item.dataset.index);
            const historyItem = items[index];
            if (historyItem?.prompt) {
                navigator.clipboard.writeText(historyItem.prompt)
                    .then(() => showStatus('提示词已复制到剪贴板', 'success'))
                    .catch(() => showStatus('复制失败', 'error'));
            }
        });
    });
}

function formatDate(timestamp) {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    const now = new Date();
    const diff = now - d;

    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`;

    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ─── Tags Management ───────────────────────────────────────────────────────────
function renderPopupTags() {
    if (popupTags.length === 0) {
        popupTagsDisplay.innerHTML = '<span style="font-size:11px;color:var(--text-muted)">从设置页面添加常用标签</span>';
        return;
    }

    popupTagsDisplay.innerHTML = popupTags.map(tag => `
        <span class="tag-item">
            ${escapeHtml(tag)}
            <span class="tag-remove" data-tag="${escapeHtml(tag)}">×</span>
        </span>
    `).join('');

    popupTagsDisplay.querySelectorAll('.tag-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const tagToRemove = btn.dataset.tag;
            popupTags = popupTags.filter(t => t !== tagToRemove);
            renderPopupTags();
            chrome.storage.local.set({ customTags: popupTags });
        });
    });
}

// ─── Actions ───────────────────────────────────────────────────────────────────
async function saveSelectedImages() {
    if (selectedImageIndices.size === 0) {
        showStatus('请先选择要保存的图片', 'error');
        return;
    }

    if (!isEagleRunning) {
        showStatus('请先启动 Eagle 软件', 'error');
        return;
    }

    const selectedItems = Array.from(selectedImageIndices).map(i => pageImages[i]);
    const folderId = folderSelect.value;
    const note = popupNoteInput.value.trim();
    const settings = await chrome.storage.local.get(['eagleApiToken', 'rememberFolder']);

    if (settings.rememberFolder !== false && folderId) {
        await chrome.storage.local.set({ selectedFolderId: folderId });
    }

    saveSelectedBtn.classList.add('loading');
    saveSelectedBtn.disabled = true;
    batchProgress.classList.add('show');

    try {
        const result = await chrome.runtime.sendMessage({
            type: 'EAGLE_SAVE_BATCH',
            payload: {
                items: selectedItems,
                folderId,
                token: settings.eagleApiToken,
                customTags: popupTags,
                note
            }
        });

        if (result) {
            progressCount.textContent = `${result.successCount} / ${result.total}`;
            progressFill.style.width = `${(result.successCount / result.total) * 100}%`;

            if (result.successCount === result.total) {
                showStatus(`已成功保存 ${result.successCount} 张图片！`, 'success');
            } else {
                showStatus(`保存完成：成功 ${result.successCount} 张，失败 ${result.failCount} 张`, 'info');
            }

            setTimeout(() => {
                batchProgress.classList.remove('show');
                progressFill.style.width = '0%';
            }, 2000);

            await loadHistory();
        }
    } catch (err) {
        showStatus('保存失败：' + err.message, 'error');
        batchProgress.classList.remove('show');
    } finally {
        saveSelectedBtn.classList.remove('loading');
        saveSelectedBtn.disabled = selectedImageIndices.size === 0;
    }
}

async function saveSingleImage(index) {
    const img = pageImages[index];
    if (!img || !isEagleRunning) {
        showStatus('Eagle 未连接', 'error');
        return;
    }

    const folderId = folderSelect.value;
    const note = popupNoteInput.value.trim();
    const settings = await chrome.storage.local.get(['eagleApiToken', 'rememberFolder', 'autoAnnotation']);

    const annotation = settings.autoAnnotation !== false ? (img.prompt || '') : '';

    try {
        const result = await chrome.runtime.sendMessage({
            type: 'EAGLE_SAVE_ONE',
            payload: {
                url: img.url,
                name: img.title,
                website: img.website,
                annotation,
                folderId,
                autoTags: true,
                token: settings.eagleApiToken,
                customTags: popupTags,
                note
            }
        });

        if (result && result.success) {
            showStatus(`「${img.title}」已保存到 Eagle`, 'success');
            await loadHistory();
        } else {
            throw new Error(result?.error || '保存失败');
        }
    } catch (err) {
        showStatus('保存失败：' + err.message, 'error');
    }
}

async function formatSelectedPrompts() {
    if (selectedImageIndices.size === 0) {
        showStatus('请先选择图片', 'error');
        return;
    }

    const format = formatSelect.value;
    const allPrompts = [];

    for (const index of selectedImageIndices) {
        const img = pageImages[index];
        if (img?.prompt) {
            allPrompts.push(img.prompt);
        }
    }

    if (allPrompts.length === 0) {
        showStatus('选中的图片没有提示词', 'error');
        return;
    }

    const combinedPrompt = allPrompts.join(', ');
    try {
        const result = await chrome.runtime.sendMessage({
            type: 'FORMAT_PROMPT',
            payload: { prompt: combinedPrompt, format }
        });

        if (result && result.success) {
            await navigator.clipboard.writeText(result.formatted);
            showStatus(`提示词已格式化并复制 (${allPrompts.length} 个)`, 'success');
        }
    } catch (err) {
        showStatus('格式化失败：' + err.message, 'error');
    }
}

async function copySelectedPrompts() {
    if (selectedImageIndices.size === 0) {
        showStatus('请先选择图片', 'error');
        return;
    }

    const allPrompts = [];
    for (const index of selectedImageIndices) {
        const img = pageImages[index];
        if (img?.prompt) {
            allPrompts.push(img.prompt);
        }
    }

    if (allPrompts.length === 0) {
        showStatus('选中的图片没有提示词', 'error');
        return;
    }

    try {
        await navigator.clipboard.writeText(allPrompts.join('\n\n---\n\n'));
        showStatus(`已复制 ${allPrompts.length} 个提示词`, 'success');
    } catch (err) {
        showStatus('复制失败：' + err.message, 'error');
    }
}

async function copySinglePrompt(index) {
    const img = pageImages[index];
    if (!img?.prompt) {
        showStatus('该图片没有提示词', 'error');
        return;
    }

    try {
        await navigator.clipboard.writeText(img.prompt);
        showStatus('提示词已复制', 'success');
    } catch (err) {
        showStatus('复制失败：' + err.message, 'error');
    }
}

async function copyAllHistoryPrompts() {
    if (currentHistory.length === 0) {
        showStatus('暂无历史记录', 'error');
        return;
    }

    const format = formatSelect.value;
    const allPrompts = currentHistory.filter(h => h.prompt).map(h => h.prompt);

    if (allPrompts.length === 0) {
        showStatus('历史记录中没有提示词', 'error');
        return;
    }

    try {
        const combined = allPrompts.join(', ');
        const result = await chrome.runtime.sendMessage({
            type: 'FORMAT_PROMPT',
            payload: { prompt: combined, format }
        });

        if (result && result.success) {
            await navigator.clipboard.writeText(result.formatted);
            showStatus(`已复制 ${allPrompts.length} 个提示词`, 'success');
        }
    } catch (err) {
        showStatus('复制失败：' + err.message, 'error');
    }
}

async function exportCurrentHistory() {
    if (currentHistory.length === 0) {
        showStatus('暂无历史记录可导出', 'error');
        return;
    }

    const exportData = {
        version: '2.0',
        exportDate: new Date().toISOString(),
        type: 'history',
        total: currentHistory.length,
        data: currentHistory
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `promptnote-history-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showStatus(`已导出 ${currentHistory.length} 条记录`, 'success');
}

async function clearAllHistory() {
    if (!confirm('确定要清空所有保存记录吗？此操作不可撤销。')) {
        return;
    }

    try {
        await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
        currentHistory = [];
        renderHistoryList(currentHistory);
        historyCount.textContent = '0';
        showStatus('历史记录已清空', 'success');
    } catch (err) {
        showStatus('清空失败：' + err.message, 'error');
    }
}

// ─── Search ────────────────────────────────────────────────────────────────────
async function searchHistoryWithQuery(query) {
    try {
        const result = await chrome.runtime.sendMessage({
            type: 'SEARCH_HISTORY',
            payload: { query, limit: 100 }
        });

        if (result && result.success) {
            renderHistoryList(result.items || []);
        }
    } catch (err) {
        console.error('Search failed:', err);
    }
}

// ─── Event Listeners ───────────────────────────────────────────────────────────
function setupEventListeners() {
    openJimengBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: 'https://jimeng.jianying.com/ai-tool/home' });
        window.close();
    });

    refreshBtn.addEventListener('click', async () => {
        refreshBtn.style.opacity = '0.5';
        await checkEagle();
        if (isOnJimeng) {
            await loadFolders();
            await extractPageImages();
        }
        await loadHistory();
        refreshBtn.style.opacity = '1';
        showStatus('已刷新', 'success');
    });

    settingsBtn.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });

    folderSelect.addEventListener('change', async () => {
        const { rememberFolder } = await chrome.storage.local.get('rememberFolder');
        if (rememberFolder !== false) {
            await chrome.storage.local.set({ selectedFolderId: folderSelect.value });
        }
    });

    popupTagInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const tag = popupTagInput.value.trim();
            if (tag && !popupTags.includes(tag)) {
                popupTags.push(tag);
                renderPopupTags();
                chrome.storage.local.set({ customTags: popupTags });
            }
            popupTagInput.value = '';
        }
    });

    selectAllBtn.addEventListener('click', () => {
        selectedImageIndices = new Set(pageImages.map((_, i) => i));
        renderImageList();
        updateSelectionInfo();
    });

    deselectAllBtn.addEventListener('click', () => {
        selectedImageIndices.clear();
        renderImageList();
        updateSelectionInfo();
    });

    formatPromptBtn.addEventListener('click', formatSelectedPrompts);
    copyPromptBtn.addEventListener('click', copySelectedPrompts);
    saveSelectedBtn.addEventListener('click', saveSelectedImages);

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            tabCurrent.classList.toggle('active', tab === 'current');
            tabHistory.classList.toggle('active', tab === 'history');
        });
    });

    let searchTimer;
    historySearch.addEventListener('input', () => {
        clearTimeout(searchTimer);
        const q = historySearch.value.trim();
        searchTimer = setTimeout(() => {
            if (q) {
                searchHistoryWithQuery(q);
            } else {
                renderHistoryList(currentHistory);
            }
        }, 300);
    });

    exportHistoryBtn.addEventListener('click', exportCurrentHistory);
    clearHistoryBtn.addEventListener('click', clearAllHistory);
    copyAllPromptsBtn.addEventListener('click', copyAllHistoryPrompts);
}

// ─── Utility ───────────────────────────────────────────────────────────────────
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

let statusTimeout;
function showStatus(msg, type = 'info') {
    clearTimeout(statusTimeout);
    statusBar.className = `status-bar show ${type}`;
    statusIcon.textContent = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
    statusText.textContent = msg;
    statusTimeout = setTimeout(() => statusBar.classList.remove('show'), 4000);
}

// ─── Start ─────────────────────────────────────────────────────────────────────
init().catch(console.error);
