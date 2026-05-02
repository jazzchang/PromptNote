/**
 * 咒语便签 - PromptNote
 * Background Service Worker v2.0
 *
 * 功能：
 * - Eagle API 代理（绕过 Origin 头限制）
 * - 完善的连接检测（自定义端口、详细错误类型）
 * - 批量保存
 * - 保存历史记录管理
 * - 提示词格式化
 */

const DEFAULT_EAGLE_PORT = '41595';

// ─── Message Handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.type) {
        case 'EAGLE_SAVE_ONE':
            eagleSaveOne(msg.payload).then(sendResponse);
            return true;

        case 'EAGLE_SAVE_BATCH':
            eagleSaveBatch(msg.payload).then(sendResponse);
            return true;

        case 'EAGLE_CHECK_CONNECTION':
            checkEagleConnection(msg.payload).then(sendResponse);
            return true;

        case 'FETCH_FOLDERS':
            fetchFolders(msg.payload).then(sendResponse);
            return true;

        case 'SAVE_TO_HISTORY':
            saveToHistory(msg.payload).then(sendResponse);
            return true;

        case 'GET_HISTORY':
            getHistory(msg.payload).then(sendResponse);
            return true;

        case 'SEARCH_HISTORY':
            searchHistory(msg.payload).then(sendResponse);
            return true;

        case 'CLEAR_HISTORY':
            clearHistory().then(sendResponse);
            return true;

        case 'FORMAT_PROMPT':
            formatPrompt(msg.payload).then(sendResponse);
            return true;

        case 'GET_SETTINGS':
            getSettings().then(sendResponse);
            return true;
    }
});

// ─── Get Eagle Base URL ────────────────────────────────────────────────────────
async function getEagleBaseUrl() {
    const settings = await chrome.storage.local.get('eaglePort');
    const port = settings.eaglePort || DEFAULT_EAGLE_PORT;
    return `http://localhost:${port}`;
}

// ─── Single Save ───────────────────────────────────────────────────────────────
async function eagleSaveOne({ url, name, website, annotation, folderId, autoTags, token, customTags, note }) {
    try {
        const baseUrl = await getEagleBaseUrl();
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${String(token).replace(/[^\x20-\x7E]/g, '')}`;

        const settings = await chrome.storage.local.get(['autoSystemTags', 'customTags']);
        const systemTags = settings.autoSystemTags !== false ? ['即梦', 'PromptNote', 'AI生成'] : [];
        const userTags = settings.customTags || [];
        const allTags = [...systemTags, ...userTags, ...(customTags || [])];

        const body = {
            url,
            name: name || '即梦AI作品',
            website: website || 'https://jimeng.jianying.com',
            annotation: annotation || '',
            tags: allTags,
            headers: { referer: 'https://jimeng.jianying.com/' }
        };

        if (folderId) body.folderId = folderId;
        if (note) {
            body.annotation = body.annotation 
                ? `${body.annotation}\n\n--- 备注 ---\n${note}` 
                : note;
        }

        const res = await fetch(`${baseUrl}/api/item/addFromURL`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        });

        const data = await res.json();
        if (data.status !== 'success') {
            throw new Error(data.message || 'Eagle返回错误');
        }

        await saveToHistory({
            url,
            name: body.name,
            prompt: annotation,
            tags: allTags,
            note: note || '',
            savedAt: Date.now(),
            folderId: folderId || ''
        });

        return { success: true, data: data.data };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ─── Batch Save ────────────────────────────────────────────────────────────────
async function eagleSaveBatch({ items, folderId, token, customTags, note }) {
    const results = [];
    let successCount = 0;
    let failCount = 0;

    for (const item of items) {
        const result = await eagleSaveOne({
            url: item.url,
            name: item.name || '即梦AI作品',
            website: item.website || 'https://jimeng.jianying.com',
            annotation: item.prompt || '',
            folderId,
            autoTags: true,
            token,
            customTags,
            note: note || item.note
        });

        results.push({
            ...item,
            success: result.success,
            error: result.error
        });

        if (result.success) successCount++;
        else failCount++;

        await delay(200);
    }

    return {
        success: failCount === 0,
        total: items.length,
        successCount,
        failCount,
        results
    };
}

// ─── Check Connection ───────────────────────────────────────────────────────────
async function checkEagleConnection({ port, token }) {
    const baseUrl = `http://localhost:${port || DEFAULT_EAGLE_PORT}`;
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 5000);

    try {
        const headers = { 'Content-Type': 'application/json' };
        if (token) {
            headers['Authorization'] = `Bearer ${token.replace(/[^\x20-\x7E]/g, '')}`;
        }

        const res = await fetch(`${baseUrl}/api/application/info`, {
            headers,
            signal: ctrl.signal
        });

        clearTimeout(timeoutId);

        if (res.ok) {
            const data = await res.json();
            return {
                success: true,
                type: 'connected',
                message: `Eagle ${data.data?.version || ''} 运行正常`,
                version: data.data?.version
            };
        }

        if (res.status === 401) {
            return {
                success: false,
                type: 'token_error',
                message: 'Token 无效或缺失',
                detail: 'Eagle 4.0+ 需要正确的 API Token 才能访问。请在 Eagle 设置 → 高级 → API Token 中获取并填入。'
            };
        }

        if (res.status === 403) {
            return {
                success: false,
                type: 'forbidden',
                message: '访问被拒绝',
                detail: 'Eagle API 拒绝了访问请求。请检查 Eagle 的 API 权限设置。'
            };
        }

        return {
            success: false,
            type: 'server_error',
            message: `服务器错误: ${res.status}`,
            detail: 'Eagle API 返回了错误状态码。请尝试重启 Eagle 软件。'
        };

    } catch (err) {
        clearTimeout(timeoutId);

        if (err.name === 'AbortError') {
            return {
                success: false,
                type: 'timeout',
                message: '连接超时',
                detail: '连接 Eagle 服务超时。请检查端口设置是否正确，或尝试重启 Eagle。'
            };
        }

        if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
            return {
                success: false,
                type: 'not_running',
                message: 'Eagle 未运行或端口错误',
                detail: '无法连接到 Eagle 服务。请确保：\n1. Eagle 软件已启动\n2. API 端口设置正确（默认 41595）\n3. 防火墙未阻止本地连接'
            };
        }

        return {
            success: false,
            type: 'unknown',
            message: err.message,
            detail: '发生未知错误。请尝试重启浏览器扩展或 Eagle 软件。'
        };
    }
}

// ─── Fetch Folders ─────────────────────────────────────────────────────────────
async function fetchFolders({ token } = {}) {
    try {
        const baseUrl = await getEagleBaseUrl();
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token.replace(/[^\x20-\x7E]/g, '')}`;

        const res = await fetch(`${baseUrl}/api/folder/list`, { headers });
        if (!res.ok) return { success: false, folders: [] };

        const data = await res.json();
        if (data.status !== 'success') return { success: false, folders: [] };

        return { success: true, folders: flattenFolders(data.data || []) };
    } catch {
        return { success: false, folders: [] };
    }
}

function flattenFolders(arr, depth = 0) {
    let r = [];
    for (const f of arr) {
        r.push({
            id: f.id,
            name: f.name,
            depth,
            displayName: '　'.repeat(depth) + f.name,
            children: f.children?.length ? flattenFolders(f.children, depth + 1) : []
        });
        if (f.children?.length) r = r.concat(flattenFolders(f.children, depth + 1));
    }
    return r;
}

// ─── History Management ────────────────────────────────────────────────────────
async function saveToHistory(item) {
    try {
        const { saveHistory = [] } = await chrome.storage.local.get('saveHistory');
        
        const existingIndex = saveHistory.findIndex(h => h.url === item.url);
        if (existingIndex >= 0) {
            saveHistory[existingIndex] = { ...saveHistory[existingIndex], ...item, savedAt: Date.now() };
        } else {
            saveHistory.unshift(item);
            if (saveHistory.length > 500) saveHistory.pop();
        }

        await chrome.storage.local.set({ saveHistory });
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function getHistory({ limit = 100, offset = 0 } = {}) {
    try {
        const { saveHistory = [] } = await chrome.storage.local.get('saveHistory');
        const items = saveHistory.slice(offset, offset + limit);
        return { success: true, items, total: saveHistory.length };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function searchHistory({ query, limit = 50 } = {}) {
    try {
        const { saveHistory = [] } = await chrome.storage.local.get('saveHistory');
        if (!query || !query.trim()) {
            return { success: true, items: saveHistory.slice(0, limit), total: saveHistory.length };
        }

        const q = query.toLowerCase().trim();
        const results = saveHistory.filter(item => {
            return (item.name?.toLowerCase().includes(q)) ||
                   (item.prompt?.toLowerCase().includes(q)) ||
                   (item.tags?.some(t => t.toLowerCase().includes(q))) ||
                   (item.note?.toLowerCase().includes(q));
        });

        return { success: true, items: results.slice(0, limit), total: results.length };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function clearHistory() {
    try {
        await chrome.storage.local.remove('saveHistory');
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ─── Prompt Formatting ─────────────────────────────────────────────────────────
async function formatPrompt({ prompt, format = 'cleaned' }) {
    if (!prompt) return { success: true, formatted: '' };

    let formatted = prompt;

    switch (format) {
        case 'cleaned':
            formatted = prompt
                .replace(/\s+/g, ' ')
                .replace(/[,，]{2,}/g, ',')
                .replace(/\s*[,，]\s*/g, ', ')
                .trim();
            break;

        case 'linebreak':
            formatted = prompt
                .replace(/[,，]/g, '\n')
                .split('\n')
                .map(line => line.trim())
                .filter(Boolean)
                .join('\n');
            break;

        case 'bullet':
            const items = prompt
                .split(/[,，]/)
                .map(item => item.trim())
                .filter(Boolean);
            formatted = items.map(item => `• ${item}`).join('\n');
            break;

        case 'markdown':
            const mdItems = prompt
                .split(/[,，]/)
                .map(item => item.trim())
                .filter(Boolean);
            formatted = '### 提示词\n\n' + mdItems.map(item => `- ${item}`).join('\n');
            break;
    }

    return { success: true, formatted, original: prompt };
}

// ─── Get All Settings ───────────────────────────────────────────────────────────
async function getSettings() {
    try {
        const settings = await chrome.storage.local.get(null);
        return { success: true, settings };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ─── Utility ───────────────────────────────────────────────────────────────────
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Install / Update Handler ──────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
        await chrome.storage.local.set({
            onboardingComplete: false,
            autoAnnotation: true,
            autoTags: true,
            autoSystemTags: true,
            rememberFolder: true,
            showSuccessAnim: true,
            enableFloatBtn: true,
            floatButtonPosition: 'top-left',
            eaglePort: DEFAULT_EAGLE_PORT,
            customTags: [],
            saveHistory: []
        });
    }

    if (details.reason === 'update') {
        const settings = await chrome.storage.local.get(null);
        const newSettings = {
            onboardingComplete: settings.onboardingComplete !== false,
            autoAnnotation: settings.autoAnnotation !== false,
            autoTags: settings.autoTags !== false,
            autoSystemTags: settings.autoSystemTags !== false,
            rememberFolder: settings.rememberFolder !== false,
            showSuccessAnim: settings.showSuccessAnim !== false,
            enableFloatBtn: settings.enableFloatBtn !== false,
            floatButtonPosition: settings.floatButtonPosition || 'top-left',
            eaglePort: settings.eaglePort || DEFAULT_EAGLE_PORT,
            customTags: settings.customTags || [],
            saveHistory: settings.saveHistory || []
        };
        if (settings.eagleApiToken) newSettings.eagleApiToken = settings.eagleApiToken;
        if (settings.selectedFolderId) newSettings.selectedFolderId = settings.selectedFolderId;
        await chrome.storage.local.set(newSettings);
    }
});