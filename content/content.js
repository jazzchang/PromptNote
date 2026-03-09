/**
 * 咒语便签 - PromptNote
 * Content Script v2.2 — 画廊按钮注入
 *
 * 保存流程：
 *   - 画廊按钮点击 → chrome.runtime.sendMessage(EAGLE_SAVE_ONE) → background 代理 Eagle API
 *   - background 的 fetch 无 Origin 头，不触发 Eagle 4.0 的 401
 */

(function () {
    'use strict';

    let isInitialized = false;
    let injectedImgs = new WeakSet();
    let settings = { autoAnnotation: true, autoTags: true };

    function init() {
        if (isInitialized) return;
        isInitialized = true;
        loadSettings();
        createToastContainer();
        startWatcher();
    }

    function loadSettings() {
        chrome.storage.local.get(['autoAnnotation', 'autoTags'], r => {
            settings.autoAnnotation = r.autoAnnotation !== false;
            settings.autoTags = r.autoTags !== false;
        });
    }

    // ─── 页面监听 ─────────────────────────────────────────────────────────────
    function startWatcher() {
        let timer = null;

        new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(injectButtons, 600);
        }).observe(document.body, { childList: true, subtree: true, attributes: false });

        let lastUrl = location.href;
        setInterval(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                injectedImgs = new WeakSet();
                clearTimeout(timer);
                timer = setTimeout(injectButtons, 1500);
            }
        }, 500);

        setTimeout(injectButtons, 1500);
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

        // 防重复
        if (posParent.querySelector(`[data-pn-src="${img.src.substring(0, 60)}"]`)) return;

        const cs = window.getComputedStyle(posParent);
        if (cs.position === 'static') posParent.style.position = 'relative';

        const imgRect = img.getBoundingClientRect();
        const parentRect = posParent.getBoundingClientRect();

        const btn = createSpellBtn();
        btn.dataset.pnSrc = img.src.substring(0, 60);
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

    // ─── 保存处理（通过 background 代理，避免 Origin 头导致的 Eagle 401）────
    async function handleSave(img, btn) {
        const url = cleanUrl(img.src);
        if (!url) { showToast('图片链接无效', 'error'); return; }

        btn.disabled = true;
        btn.classList.add('loading');
        btn.querySelector('.pn-btn-txt').textContent = '保存中…';

        const store = await new Promise(r =>
            chrome.storage.local.get(['eagleApiToken', 'selectedFolderId', 'autoTags', 'autoAnnotation'], r)
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
                    token: store.eagleApiToken || ''
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
            if (el.tagName === 'A' && el.href) {
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
            for (let i = 0; i < 8; i++) {
                if (!el || el === document.body) break;
                const p = el.querySelector('[class*="prompt-value-container"]');
                const t = el.querySelector('[class*="title-wrapper"]');
                if (p || t) return { pEl: p, tEl: t };
                el = el.parentElement;
            }
            return { pEl: null, tEl: null };
        }

        let { pEl, tEl } = findInParent();
        if (!pEl) pEl = document.querySelector('[class*="prompt-value-container"]');
        if (!tEl) tEl = document.querySelector('[class*="title-wrapper"]');

        if (pEl) prompt = (pEl.innerText || pEl.textContent || '').trim();
        if (tEl) {
            title = (tEl.innerText || tEl.textContent || '').trim();
            if (title.length > 60) title = title.substring(0, 60);
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

    function cleanUrl(url) {
        if (!url || url.startsWith('data:') || url.startsWith('blob:')) return null;
        return url.replace(/(aigc_resize)[_:](\d+)[_:](\d+)/g, '$1:2048:2048');
    }

    function isIconLike(url) {
        return !url || /avatar|\/icon|logo|emoji|placeholder|default|\.ico/.test(url);
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
