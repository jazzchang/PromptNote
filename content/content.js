/**
 * 咒语便签 - PromptNote v2.0
 * Content Script
 *
 * 功能：
 * - 全站适配：列表页、瀑布流、详情页提示词提取
 * - 多选模式：支持页面上选择多个图片
 * - 悬浮按钮：支持自定义位置与显示开关
 * - 消息通信：与 popup 和 background 交互
 */

(function () {
    'use strict';

    let isInitialized = false;
    let injectedImgs = new WeakSet();
    let settings = {
        autoAnnotation: true,
        autoTags: true,
        enableFloatBtn: true,
        floatButtonPosition: 'top-left'
    };

    let selectionMode = false;
    let selectedImgs = new Set();
    let floatPanel = null;

    const POSITION_STYLES = {
        'top-left': { top: '20px', left: '20px', right: 'auto', bottom: 'auto' },
        'top-center': { top: '20px', left: '50%', right: 'auto', bottom: 'auto', transform: 'translateX(-50%)' },
        'top-right': { top: '20px', left: 'auto', right: '20px', bottom: 'auto' },
        'middle-left': { top: '50%', left: '20px', right: 'auto', bottom: 'auto', transform: 'translateY(-50%)' },
        'middle-center': { top: '50%', left: '50%', right: 'auto', bottom: 'auto', transform: 'translate(-50%, -50%)' },
        'middle-right': { top: '50%', left: 'auto', right: '20px', bottom: 'auto', transform: 'translateY(-50%)' },
        'bottom-left': { top: 'auto', left: '20px', right: 'auto', bottom: '20px' },
        'bottom-center': { top: 'auto', left: '50%', right: 'auto', bottom: '20px', transform: 'translateX(-50%)' },
        'bottom-right': { top: 'auto', left: 'auto', right: '20px', bottom: '20px' }
    };

    function init() {
        if (isInitialized) return;
        isInitialized = true;
        loadSettings();
        createToastContainer();
        createFloatPanel();
        setupMessageListener();
        startWatcher();
    }

    async function loadSettings() {
        const saved = await new Promise(r => chrome.storage.local.get([
            'autoAnnotation',
            'autoTags',
            'enableFloatBtn',
            'floatButtonPosition'
        ], r));

        settings.autoAnnotation = saved.autoAnnotation !== false;
        settings.autoTags = saved.autoTags !== false;
        settings.enableFloatBtn = saved.enableFloatBtn !== false;
        settings.floatButtonPosition = saved.floatButtonPosition || 'top-left';

        updateFloatPanelPosition();
        updateFloatPanelVisibility();
    }

    function createFloatPanel() {
        if (document.getElementById('pn-float-panel')) return;

        floatPanel = document.createElement('div');
        floatPanel.id = 'pn-float-panel';
        floatPanel.className = 'pn-float-panel';
        floatPanel.innerHTML = `
            <div class="pn-float-toggle">
                <button class="pn-float-btn" id="pn-toggle-selection" title="选择模式">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/>
                        <rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/>
                        <rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/>
                        <rect x="14" y="14" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/>
                    </svg>
                    <span class="pn-float-txt">选择</span>
                </button>
            </div>
            <div class="pn-float-selection" style="display:none;">
                <div class="pn-selection-count">
                    <span>已选: <strong id="pn-selected-count">0</strong> 张</span>
                </div>
                <div class="pn-selection-actions">
                    <button class="pn-mini-btn" id="pn-select-all" title="全选">全选</button>
                    <button class="pn-mini-btn" id="pn-deselect-all" title="取消">取消</button>
                    <button class="pn-mini-btn primary" id="pn-save-selected" title="保存选中">保存</button>
                </div>
            </div>
        `;

        document.body.appendChild(floatPanel);

        floatPanel.querySelector('#pn-toggle-selection').addEventListener('click', toggleSelectionMode);
        floatPanel.querySelector('#pn-select-all').addEventListener('click', selectAllImages);
        floatPanel.querySelector('#pn-deselect-all').addEventListener('click', deselectAllImages);
        floatPanel.querySelector('#pn-save-selected').addEventListener('click', saveSelectedImages);

        updateFloatPanelPosition();
    }

    function updateFloatPanelPosition() {
        if (!floatPanel) return;

        const posStyle = POSITION_STYLES[settings.floatButtonPosition] || POSITION_STYLES['top-left'];

        floatPanel.style.top = posStyle.top;
        floatPanel.style.left = posStyle.left;
        floatPanel.style.right = posStyle.right;
        floatPanel.style.bottom = posStyle.bottom;

        if (posStyle.transform) {
            floatPanel.style.transform = posStyle.transform;
        }
    }

    function updateFloatPanelVisibility() {
        if (!floatPanel) return;
        floatPanel.style.display = settings.enableFloatBtn ? 'block' : 'none';
    }

    function toggleSelectionMode() {
        selectionMode = !selectionMode;

        const toggleBtn = floatPanel.querySelector('#pn-toggle-selection');
        const selectionPanel = floatPanel.querySelector('.pn-float-selection');

        if (selectionMode) {
            toggleBtn.classList.add('active');
            toggleBtn.querySelector('.pn-float-txt').textContent = '退出';
            selectionPanel.style.display = 'block';
            document.body.classList.add('pn-selection-mode');
            injectSelectionUI();
        } else {
            toggleBtn.classList.remove('active');
            toggleBtn.querySelector('.pn-float-txt').textContent = '选择';
            selectionPanel.style.display = 'none';
            document.body.classList.remove('pn-selection-mode');
            deselectAllImages();
            removeSelectionUI();
        }
    }

    function injectSelectionUI() {
        const imgs = document.querySelectorAll(
            'img[src*="byteimg.com"], img[src*="dreamina-sign"], img[src*="lf26-cn"], img[src*="lf3-cn"]'
        );

        imgs.forEach(img => {
            if (isIconLike(img.src)) return;
            if (img.naturalWidth < 80 && img.naturalWidth !== 0) return;
            if (img.offsetWidth < 80) return;

            addSelectionOverlay(img);
        });
    }

    function removeSelectionUI() {
        document.querySelectorAll('.pn-selection-overlay').forEach(el => el.remove());
        document.querySelectorAll('.pn-image-selected').forEach(el => el.classList.remove('pn-image-selected'));
    }

    function addSelectionOverlay(img) {
        const posParent = findPositionParent(img);
        if (!posParent) return;

        if (posParent.querySelector('.pn-selection-overlay')) return;

        const cs = window.getComputedStyle(posParent);
        if (cs.position === 'static') posParent.style.position = 'relative';

        const overlay = document.createElement('div');
        overlay.className = 'pn-selection-overlay';
        overlay.innerHTML = `
            <div class="pn-selection-checkbox">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M5 12l5 5L20 7" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </div>
        `;

        overlay.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            toggleImageSelection(img, overlay);
        });

        posParent.appendChild(overlay);
    }

    function toggleImageSelection(img, overlay) {
        if (selectedImgs.has(img)) {
            selectedImgs.delete(img);
            overlay.classList.remove('selected');
            img.classList.remove('pn-image-selected');
        } else {
            selectedImgs.add(img);
            overlay.classList.add('selected');
            img.classList.add('pn-image-selected');
        }
        updateSelectedCount();
    }

    function selectAllImages() {
        document.querySelectorAll('.pn-selection-overlay').forEach((overlay, index) => {
            const img = findImageFromOverlay(overlay);
            if (img) {
                selectedImgs.add(img);
                overlay.classList.add('selected');
                img.classList.add('pn-image-selected');
            }
        });
        updateSelectedCount();
    }

    function deselectAllImages() {
        selectedImgs.clear();
        document.querySelectorAll('.pn-selection-overlay').forEach(overlay => {
            overlay.classList.remove('selected');
        });
        document.querySelectorAll('.pn-image-selected').forEach(img => {
            img.classList.remove('pn-image-selected');
        });
        updateSelectedCount();
    }

    function findImageFromOverlay(overlay) {
        const parent = overlay.parentElement;
        if (!parent) return null;
        return parent.querySelector('img[src*="byteimg.com"], img[src*="dreamina-sign"], img[src*="lf26-cn"], img[src*="lf3-cn"]');
    }

    function updateSelectedCount() {
        const countEl = floatPanel.querySelector('#pn-selected-count');
        if (countEl) {
            countEl.textContent = selectedImgs.size;
        }

        const saveBtn = floatPanel.querySelector('#pn-save-selected');
        if (saveBtn) {
            saveBtn.disabled = selectedImgs.size === 0;
        }
    }

    async function saveSelectedImages() {
        if (selectedImgs.size === 0) {
            showToast('请先选择要保存的图片', 'error');
            return;
        }

        const store = await new Promise(r => chrome.storage.local.get([
            'eagleApiToken',
            'selectedFolderId',
            'autoTags',
            'autoAnnotation',
            'customTags'
        ], r));

        const items = [];
        const failedUrls = [];

        for (const img of selectedImgs) {
            const url = cleanUrl(img.src);
            if (!url) {
                failedUrls.push(img.src);
                continue;
            }

            const { prompt, title } = extractPromptAndTitle(img);
            const websiteUrl = findImagePageUrl(img);

            items.push({
                url,
                name: title,
                prompt,
                website: websiteUrl,
                thumbnail: img.src
            });
        }

        if (items.length === 0) {
            showToast('没有有效的图片可保存', 'error');
            return;
        }

        showToast(`正在保存 ${items.length} 张图片...`, 'info');

        try {
            const result = await chrome.runtime.sendMessage({
                type: 'EAGLE_SAVE_BATCH',
                payload: {
                    items,
                    folderId: store.selectedFolderId || '',
                    token: store.eagleApiToken || '',
                    customTags: store.customTags || [],
                    note: ''
                }
            });

            if (result) {
                if (result.successCount === result.total) {
                    showToast(`已成功保存 ${result.successCount} 张图片！`, 'success');
                } else {
                    showToast(`保存完成：成功 ${result.successCount} 张，失败 ${result.failCount} 张`, 'info');
                }

                deselectAllImages();
                toggleSelectionMode();
            }
        } catch (err) {
            showToast('保存失败：' + err.message, 'error');
        }
    }

    // ─── 页面监听 ─────────────────────────────────────────────────────────────
    function startWatcher() {
        let timer = null;

        new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                injectButtons();
                if (selectionMode) {
                    injectSelectionUI();
                }
            }, 600);
        }).observe(document.body, { childList: true, subtree: true, attributes: false });

        let lastUrl = location.href;
        setInterval(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                injectedImgs = new WeakSet();
                clearTimeout(timer);
                timer = setTimeout(() => {
                    injectButtons();
                    if (selectionMode) {
                        injectSelectionUI();
                    }
                }, 1500);
            }
        }, 500);

        setTimeout(() => {
            injectButtons();
        }, 1500);
    }

    // ─── 注入"添加咒语"按钮 ──────────────────────────────────────────────────
    function injectButtons() {
        const imgs = document.querySelectorAll(
            'img[src*="byteimg.com"], img[src*="dreamina-sign"], img[src*="lf26-cn"], img[src*="lf3-cn"]'
        );

        imgs.forEach(img => {
            if (injectedImgs.has(img)) return;
            if (!img.src || isIconLike(img.src)) return;
            if (img.naturalWidth < 80 && img.naturalWidth !== 0) return;
            if (img.offsetWidth < 80) return;

            injectedImgs.add(img);
            placeButton(img);
        });
    }

    function placeButton(img) {
        const posParent = findPositionParent(img);
        if (!posParent) return;

        if (posParent.querySelector(`[data-pn-src="${img.src.substring(0, 60)}"]`)) return;

        const cs = window.getComputedStyle(posParent);
        if (cs.position === 'static') posParent.style.position = 'relative';

        const btn = createSpellBtn();
        btn.dataset.pnSrc = img.src.substring(0, 60);

        const imgRect = img.getBoundingClientRect();
        const parentRect = posParent.getBoundingClientRect();

        btn.style.top = (imgRect.top - parentRect.top + 8) + 'px';
        btn.style.left = (imgRect.left - parentRect.left + 8) + 'px';

        btn.addEventListener('click', async e => {
            e.stopPropagation();
            e.preventDefault();
            await handleSave(img, btn);
        });

        posParent.appendChild(btn);
    }

    function findPositionParent(img) {
        let el = img.parentElement;
        for (let i = 0; i < 6; i++) {
            if (!el || el === document.body) break;
            const cs = window.getComputedStyle(el);
            const w = el.offsetWidth;
            const h = el.offsetHeight;
            if (w > 80 && h > 80) {
                if (cs.position !== 'static') return el;
                if (el.contains(img) && w < 800) return el;
            }
            el = el.parentElement;
        }
        return img.parentElement;
    }

    // ─── 保存处理 ────────────────────────────────────────────────────────────
    async function handleSave(img, btn) {
        const url = cleanUrl(img.src);
        if (!url) { showToast('图片链接无效', 'error'); return; }

        btn.disabled = true;
        btn.classList.add('loading');
        btn.querySelector('.pn-btn-txt').textContent = '保存中…';

        const store = await new Promise(r =>
            chrome.storage.local.get(['eagleApiToken', 'selectedFolderId', 'autoTags', 'autoAnnotation', 'customTags'], r)
        );

        const { prompt, title } = extractPromptAndTitle(img);
        const annotation = store.autoAnnotation !== false ? prompt : '';
        const websiteUrl = findImagePageUrl(img);

        try {
            const result = await chrome.runtime.sendMessage({
                type: 'EAGLE_SAVE_ONE',
                payload: {
                    url,
                    name: title,
                    website: websiteUrl,
                    annotation: annotation,
                    folderId: store.selectedFolderId || '',
                    autoTags: store.autoTags !== false,
                    token: store.eagleApiToken || '',
                    customTags: store.customTags || []
                }
            });

            if (result && result.success) {
                btn.classList.replace('loading', 'saved');
                btn.querySelector('.pn-btn-txt').textContent = '✓ 已加入';
                showToast('已保存到 Eagle', 'success');
            } else {
                throw new Error(result?.error || '保存失败');
            }
        } catch (err) {
            btn.disabled = false;
            btn.classList.remove('loading');
            btn.querySelector('.pn-btn-txt').textContent = '添加咒语';
            showToast('保存失败：' + err.message, 'error');
        }
    }

    // ─── 工具函数 ────────────────────────────────────────────────────────────
    function findImagePageUrl(img) {
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

    function extractPromptAndTitle(img) {
        let prompt = '';
        let title = '';

        function findInParent() {
            let el = img.parentElement;
            for (let i = 0; i < 10; i++) {
                if (!el || el === document.body) break;

                const selectors = [
                    '[class*="prompt-value-container"]',
                    '[class*="prompt-text"]',
                    '[class*="desc-prompt"]',
                    '[class*="prompt-content"]'
                ];

                for (const selector of selectors) {
                    const p = el.querySelector(selector);
                    if (p) {
                        const t = (p.innerText || p.textContent || '').trim();
                        if (t.length > 5) {
                            const titleEl = el.querySelector('[class*="title-wrapper"], [class*="img-title"], [class*="work-title"], [class*="author-name"]');
                            let foundTitle = '';
                            if (titleEl) {
                                foundTitle = (titleEl.innerText || titleEl.textContent || '').trim();
                                if (foundTitle.length > 60) foundTitle = foundTitle.substring(0, 60);
                            }
                            return { prompt: t, title: foundTitle };
                        }
                    }
                }

                el = el.parentElement;
            }
            return { prompt: '', title: '' };
        }

        let { prompt: parentPrompt, title: parentTitle } = findInParent();
        prompt = parentPrompt;
        title = parentTitle;

        if (!prompt) {
            const globalSelectors = [
                '[class*="prompt-value-container"]',
                '[class*="prompt-text"]',
                '[class*="desc-prompt"]'
            ];

            for (const selector of globalSelectors) {
                const globalPrompt = document.querySelector(selector);
                if (globalPrompt) {
                    const t = (globalPrompt.innerText || globalPrompt.textContent || '').trim();
                    if (t.length > 5) {
                        prompt = t;
                        break;
                    }
                }
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

    function isIconLike(url) {
        return !url || /avatar|\/icon|logo|emoji|placeholder|default|\.ico|favicon/.test(url);
    }

    // ─── 创建按钮 ────────────────────────────────────────────────────────────
    function createSpellBtn() {
        const btn = document.createElement('button');
        btn.className = 'pn-spell-btn';
        btn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" width="12" height="12">
        <path d="M12 3v13" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
        <path d="M8 12l4 4 4-4" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M3 19h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <span class="pn-btn-txt">添加咒语</span>
    `;
        return btn;
    }

    // ─── 消息监听 ────────────────────────────────────────────────────────────
    function setupMessageListener() {
        chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
            switch (msg.type) {
                case 'EXTRACT_IMAGES':
                    const images = extractAllImagesWithPrompts();
                    sendResponse({ success: true, images });
                    return true;

                case 'GET_SETTINGS':
                    sendResponse({ success: true, settings });
                    return true;

                case 'REFRESH_BUTTONS':
                    injectedImgs = new WeakSet();
                    injectButtons();
                    sendResponse({ success: true });
                    return true;
            }
        });
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

    // ─── Toast ───────────────────────────────────────────────────────────────
    let toastRoot = null;

    function createToastContainer() {
        if (document.getElementById('pn-toast-root')) return;
        toastRoot = document.createElement('div');
        toastRoot.id = 'pn-toast-root';
        document.body.appendChild(toastRoot);
    }

    function showToast(msg, type = 'info') {
        if (!toastRoot) toastRoot = document.getElementById('pn-toast-root');
        if (!toastRoot) return;
        const t = document.createElement('div');
        t.className = `pn-toast pn-toast-${type}`;
        const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
        t.innerHTML = `<span class="pn-ti">${icon}</span><span>${msg}</span>`;
        toastRoot.appendChild(t);
        requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
        setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 3500);
    }

    // ─── 启动 ────────────────────────────────────────────────────────────────
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

})();
