/**
 * 咒语便签 - PromptNote
 * Background Service Worker v1.2.1
 *
 * 关键：background script 的 fetch 不带 Origin 头，可绕过 Eagle API 401。
 * content script 发消息到这里，由 background 代为调用 Eagle API。
 */

const EAGLE = 'http://localhost:41595';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'EAGLE_SAVE_ONE') {
        eagleSaveOne(msg.payload).then(sendResponse);
        return true; // 保持通道开放
    }
    if (msg.type === 'FETCH_FOLDERS') {
        fetchFolders().then(folders => sendResponse({ folders }));
        return true;
    }
});

// 单张保存（供 content script 的画廊按钮调用）
async function eagleSaveOne({ url, name, website, annotation, folderId, autoTags, token }) {
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${String(token).replace(/[^\x20-\x7E]/g, '')}`;

        const body = {
            url,
            name: name || '即梦AI作品',
            website: website || 'https://jimeng.jianying.com',
            annotation: annotation || '',
            tags: autoTags ? ['即梦', 'PromptNote', 'AI生成'] : [],
            headers: { referer: 'https://jimeng.jianying.com/' }
        };
        if (folderId) body.folderId = folderId;

        const res = await fetch(`${EAGLE}/api/item/addFromURL`, {
            method: 'POST', headers, body: JSON.stringify(body)
        });
        const data = await res.json();
        if (data.status !== 'success') throw new Error(data.message || 'Eagle返回错误');
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function fetchFolders() {
    try {
        const res = await fetch(`${EAGLE}/api/folder/list`);
        if (!res.ok) return [];
        const data = await res.json();
        if (data.status !== 'success') return [];
        return flattenFolders(data.data || []);
    } catch {
        return [];
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
