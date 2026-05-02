/**
 * 咒语便签 - PromptNote
 * Options Page Script v2.0
 *
 * 功能：
 * - 初始化配置向导
 * - Eagle 连接检测（含详细错误类型）
 * - Token 管理
 * - 自定义标签
 * - 悬浮按钮位置设置
 * - 导出/导入配置
 * - 保存记录管理
 */

// ─── DOM Elements ─────────────────────────────────────────────────────────────
// Wizard elements
const onboardingCard = document.getElementById('onboardingCard');
const settingsContent = document.getElementById('settingsContent');
const wizardDots = document.querySelectorAll('.wizard-dot');
const step1 = document.getElementById('step1');
const step2 = document.getElementById('step2');
const step3 = document.getElementById('step3');
const step4 = document.getElementById('step4');
const startSetupBtn = document.getElementById('startSetupBtn');
const step2BackBtn = document.getElementById('step2BackBtn');
const step2NextBtn = document.getElementById('step2NextBtn');
const onboardingTestBtn = document.getElementById('onboardingTestBtn');
const step3SkipBtn = document.getElementById('step3SkipBtn');
const step3NextBtn = document.getElementById('step3NextBtn');
const finishSetupBtn = document.getElementById('finishSetupBtn');
const onboardingTokenInput = document.getElementById('onboardingTokenInput');
const onboardingTokenEyeBtn = document.getElementById('onboardingTokenEyeBtn');
const onboardingEyeIcon = document.getElementById('onboardingEyeIcon');
const onboardingStatusIcon = document.getElementById('onboardingStatusIcon');
const onboardingStatusTitle = document.getElementById('onboardingStatusTitle');
const onboardingStatusDetail = document.getElementById('onboardingStatusDetail');
const onboardingErrorHelp = document.getElementById('onboardingErrorHelp');

// Main settings elements
const mainTestBtn = document.getElementById('mainTestBtn');
const mainStatusIcon = document.getElementById('mainStatusIcon');
const mainStatusTitle = document.getElementById('mainStatusTitle');
const mainStatusDetail = document.getElementById('mainStatusDetail');
const mainErrorHelp = document.getElementById('mainErrorHelp');
const connectionBadge = document.getElementById('connectionBadge');
const eaglePortInput = document.getElementById('eaglePortInput');
const mainTokenInput = document.getElementById('mainTokenInput');
const mainTokenEyeBtn = document.getElementById('mainTokenEyeBtn');
const mainEyeIcon = document.getElementById('mainEyeIcon');

// Tags elements
const newTagInput = document.getElementById('newTagInput');
const addTagBtn = document.getElementById('addTagBtn');
const customTagsDisplay = document.getElementById('customTagsDisplay');
const autoSystemTags = document.getElementById('autoSystemTags');

// Float button elements
const enableFloatBtn = document.getElementById('enableFloatBtn');
const positionOptions = document.querySelectorAll('.position-option');

// Other settings
const autoAnnotation = document.getElementById('autoAnnotation');
const rememberFolder = document.getElementById('rememberFolder');
const showSuccessAnim = document.getElementById('showSuccessAnim');
const resetOnboardingBtn = document.getElementById('resetOnboardingBtn');

// Data management
const exportSettingsBtn = document.getElementById('exportSettingsBtn');
const importSettingsBtn = document.getElementById('importSettingsBtn');
const exportHistoryBtn = document.getElementById('exportHistoryBtn');
const clearDataBtn = document.getElementById('clearDataBtn');
const importFileInput = document.getElementById('importFileInput');

// Footer
const openSettingsFromOptions = document.getElementById('openSettingsFromOptions');

// ─── State ─────────────────────────────────────────────────────────────────────
let currentWizardStep = 1;
let customTags = [];

// ─── Constants ─────────────────────────────────────────────────────────────────
const DEFAULT_EAGLE_PORT = '41595';
const POSITION_MAP = {
    'top-left': { top: 'start', left: 'start' },
    'top-center': { top: 'start', left: 'center' },
    'top-right': { top: 'start', left: 'end' },
    'middle-left': { top: 'center', left: 'start' },
    'middle-center': { top: 'center', left: 'center' },
    'middle-right': { top: 'center', left: 'end' },
    'bottom-left': { top: 'end', left: 'start' },
    'bottom-center': { top: 'end', left: 'center' },
    'bottom-right': { top: 'end', left: 'end' }
};

// ─── Initialization ────────────────────────────────────────────────────────────
async function init() {
    await loadAllSettings();
    await checkOnboardingStatus();
    setupEventListeners();
}

async function loadAllSettings() {
    const settings = await chrome.storage.local.get([
        'onboardingComplete',
        'eaglePort',
        'eagleApiToken',
        'customTags',
        'autoSystemTags',
        'enableFloatBtn',
        'floatButtonPosition',
        'autoAnnotation',
        'rememberFolder',
        'showSuccessAnim'
    ]);

    // Port
    eaglePortInput.value = settings.eaglePort || DEFAULT_EAGLE_PORT;

    // Token
    const token = settings.eagleApiToken || '';
    mainTokenInput.value = token;
    onboardingTokenInput.value = token;
    if (token) {
        mainTokenInput.classList.add('has-value');
    }

    // Tags
    customTags = settings.customTags || [];
    renderCustomTags();

    // Auto system tags
    autoSystemTags.checked = settings.autoSystemTags !== false;

    // Float button
    enableFloatBtn.checked = settings.enableFloatBtn !== false;
    const savedPosition = settings.floatButtonPosition || 'top-left';
    updatePositionSelection(savedPosition);

    // Other settings
    autoAnnotation.checked = settings.autoAnnotation !== false;
    rememberFolder.checked = settings.rememberFolder !== false;
    showSuccessAnim.checked = settings.showSuccessAnim !== false;
}

async function checkOnboardingStatus() {
    const { onboardingComplete } = await chrome.storage.local.get('onboardingComplete');
    if (onboardingComplete) {
        onboardingCard.style.display = 'none';
        settingsContent.style.display = 'block';
    } else {
        onboardingCard.style.display = 'block';
        settingsContent.style.display = 'none';
        currentWizardStep = 1;
        updateWizardUI();
    }
}

// ─── Event Listeners ───────────────────────────────────────────────────────────
function setupEventListeners() {
    // Wizard navigation
    startSetupBtn.addEventListener('click', () => goToStep(2));
    step2BackBtn.addEventListener('click', () => goToStep(1));
    step2NextBtn.addEventListener('click', () => goToStep(3));
    step3SkipBtn.addEventListener('click', async () => {
        await chrome.storage.local.set({ onboardingComplete: true });
        goToStep(4);
    });
    step3NextBtn.addEventListener('click', async () => {
        const token = onboardingTokenInput.value.trim();
        await chrome.storage.local.set({ 
            eagleApiToken: token,
            onboardingComplete: true 
        });
        goToStep(4);
    });
    finishSetupBtn.addEventListener('click', () => {
        onboardingCard.style.display = 'none';
        settingsContent.style.display = 'block';
    });

    // Connection test
    onboardingTestBtn.addEventListener('click', () => testConnection('onboarding'));
    mainTestBtn.addEventListener('click', () => testConnection('main'));

    // Token visibility toggle
    onboardingTokenEyeBtn.addEventListener('click', () => togglePasswordVisibility(onboardingTokenInput, onboardingEyeIcon));
    mainTokenEyeBtn.addEventListener('click', () => togglePasswordVisibility(mainTokenInput, mainEyeIcon));

    // Port input
    eaglePortInput.addEventListener('input', debounce(async () => {
        const port = eaglePortInput.value.trim();
        if (/^\d{1,5}$/.test(port)) {
            await chrome.storage.local.set({ eaglePort: port });
        }
    }, 500));

    // Token auto-save
    let tokenSaveTimer;
    mainTokenInput.addEventListener('input', () => {
        clearTimeout(tokenSaveTimer);
        const v = mainTokenInput.value.trim();
        mainTokenInput.classList.toggle('has-value', v.length > 0);
        tokenSaveTimer = setTimeout(async () => {
            await chrome.storage.local.set({ eagleApiToken: v });
        }, 600);
    });

    // Tags
    addTagBtn.addEventListener('click', addNewTag);
    newTagInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addNewTag();
    });

    // Toggle settings
    autoSystemTags.addEventListener('change', () => saveToggleSetting('autoSystemTags', autoSystemTags.checked));
    enableFloatBtn.addEventListener('change', () => saveToggleSetting('enableFloatBtn', enableFloatBtn.checked));
    autoAnnotation.addEventListener('change', () => saveToggleSetting('autoAnnotation', autoAnnotation.checked));
    rememberFolder.addEventListener('change', () => saveToggleSetting('rememberFolder', rememberFolder.checked));
    showSuccessAnim.addEventListener('change', () => saveToggleSetting('showSuccessAnim', showSuccessAnim.checked));

    // Position selection
    positionOptions.forEach(option => {
        option.addEventListener('click', () => {
            const position = option.dataset.position;
            updatePositionSelection(position);
            chrome.storage.local.set({ floatButtonPosition: position });
        });
    });

    // Reset onboarding
    resetOnboardingBtn.addEventListener('click', async () => {
        if (confirm('确定要重新显示首次配置向导吗？')) {
            await chrome.storage.local.set({ onboardingComplete: false });
            location.reload();
        }
    });

    // Data management
    exportSettingsBtn.addEventListener('click', exportSettings);
    importSettingsBtn.addEventListener('click', () => importFileInput.click());
    exportHistoryBtn.addEventListener('click', exportHistory);
    clearDataBtn.addEventListener('click', clearAllData);
    importFileInput.addEventListener('change', handleImportFile);

    // Footer link
    if (openSettingsFromOptions) {
        openSettingsFromOptions.addEventListener('click', (e) => {
            e.preventDefault();
            chrome.tabs.create({ url: 'chrome://extensions/' });
        });
    }
}

// ─── Wizard Functions ──────────────────────────────────────────────────────────
function goToStep(step) {
    currentWizardStep = step;
    updateWizardUI();
}

function updateWizardUI() {
    // Hide all steps
    [step1, step2, step3, step4].forEach(s => s.classList.remove('active'));

    // Show current step
    const steps = [step1, step2, step3, step4];
    if (steps[currentWizardStep - 1]) {
        steps[currentWizardStep - 1].classList.add('active');
    }

    // Update dots
    wizardDots.forEach((dot, i) => {
        dot.classList.remove('active', 'completed');
        if (i + 1 === currentWizardStep) {
            dot.classList.add('active');
        } else if (i + 1 < currentWizardStep) {
            dot.classList.add('completed');
        }
    });
}

// ─── Connection Detection ──────────────────────────────────────────────────────
async function testConnection(mode) {
    const port = eaglePortInput.value.trim() || DEFAULT_EAGLE_PORT;
    const token = mainTokenInput.value.trim();
    
    const isOnboarding = mode === 'onboarding';
    const statusIcon = isOnboarding ? onboardingStatusIcon : mainStatusIcon;
    const statusTitle = isOnboarding ? onboardingStatusTitle : mainStatusTitle;
    const statusDetail = isOnboarding ? onboardingStatusDetail : mainStatusDetail;
    const errorHelp = isOnboarding ? onboardingErrorHelp : mainErrorHelp;
    const nextBtn = isOnboarding ? step2NextBtn : null;

    // Set loading state
    statusIcon.className = 'status-icon-wrapper warning';
    statusIcon.textContent = '⏳';
    statusTitle.textContent = '检测中...';
    statusDetail.textContent = '正在连接 Eagle 服务...';
    errorHelp.style.display = 'none';
    if (nextBtn) nextBtn.disabled = true;

    try {
        const result = await checkEagleConnection(port, token);
        
        if (result.success) {
            // Success
            statusIcon.className = 'status-icon-wrapper success';
            statusIcon.textContent = '✓';
            statusTitle.textContent = '连接成功';
            statusDetail.textContent = result.message || 'Eagle 服务正常运行';
            if (!isOnboarding) {
                connectionBadge.textContent = '已连接';
                connectionBadge.style.background = 'rgba(16, 185, 129, 0.15)';
                connectionBadge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
                connectionBadge.style.color = '#34d399';
            }
            if (nextBtn) nextBtn.disabled = false;
        } else {
            // Specific error
            handleConnectionError(result, statusIcon, statusTitle, statusDetail, errorHelp);
        }
    } catch (err) {
        handleConnectionError({ type: 'unknown', message: err.message }, statusIcon, statusTitle, statusDetail, errorHelp);
    }
}

async function checkEagleConnection(port, token) {
    const baseUrl = `http://localhost:${port}`;
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
                message: `Eagle ${data.data?.version || ''} 运行正常` 
            };
        }

        if (res.status === 401) {
            return { 
                success: false, 
                type: 'token_error',
                message: 'Token 无效或缺失' 
            };
        }

        if (res.status === 403) {
            return { 
                success: false, 
                type: 'forbidden',
                message: '访问被拒绝' 
            };
        }

        return { 
            success: false, 
            type: 'server_error',
            message: `服务器错误: ${res.status}` 
        };

    } catch (err) {
        clearTimeout(timeoutId);
        
        if (err.name === 'AbortError') {
            return { 
                success: false, 
                type: 'timeout',
                message: '连接超时' 
            };
        }

        if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
            return { 
                success: false, 
                type: 'not_running',
                message: 'Eagle 未运行或端口错误' 
            };
        }

        return { 
            success: false, 
            type: 'unknown',
            message: err.message 
        };
    }
}

function handleConnectionError(result, iconEl, titleEl, detailEl, helpEl) {
    iconEl.className = 'status-icon-wrapper error';
    iconEl.textContent = '✕';
    helpEl.style.display = 'block';

    switch (result.type) {
        case 'not_running':
            titleEl.textContent = 'Eagle 未运行';
            detailEl.textContent = '请启动 Eagle 软件后再试';
            break;
        case 'timeout':
            titleEl.textContent = '连接超时';
            detailEl.textContent = '检查端口设置或网络连接';
            break;
        case 'token_error':
            titleEl.textContent = 'Token 无效';
            detailEl.textContent = 'Eagle 4.0+ 需要正确的 API Token';
            break;
        case 'forbidden':
            titleEl.textContent = '访问被拒绝';
            detailEl.textContent = '请检查 Eagle 的 API 权限设置';
            break;
        case 'server_error':
            titleEl.textContent = '服务器错误';
            detailEl.textContent = result.message;
            break;
        default:
            titleEl.textContent = '连接失败';
            detailEl.textContent = result.message || '未知错误';
    }

    // Update main badge if in main mode
    if (iconEl === mainStatusIcon) {
        connectionBadge.textContent = '连接失败';
        connectionBadge.style.background = 'rgba(239, 68, 68, 0.15)';
        connectionBadge.style.borderColor = 'rgba(239, 68, 68, 0.3)';
        connectionBadge.style.color = '#f87171';
    }
}

// ─── Token Visibility ──────────────────────────────────────────────────────────
function togglePasswordVisibility(input, iconEl) {
    const shown = input.type === 'text';
    input.type = shown ? 'password' : 'text';
    iconEl.innerHTML = shown
        ? `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>`
        : `<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19M1 1l22 22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" opacity="0.3"/>`;
}

// ─── Tags Management ───────────────────────────────────────────────────────────
function addNewTag() {
    const tag = newTagInput.value.trim();
    if (!tag) return;
    
    if (customTags.includes(tag)) {
        newTagInput.value = '';
        return;
    }

    customTags.push(tag);
    newTagInput.value = '';
    renderCustomTags();
    chrome.storage.local.set({ customTags });
}

function renderCustomTags() {
    if (customTags.length === 0) {
        customTagsDisplay.innerHTML = '<span class="tag-placeholder">暂无自定义标签，添加一些常用标签吧</span>';
        return;
    }

    customTagsDisplay.innerHTML = customTags.map(tag => `
        <span class="tag-item">
            ${tag}
            <span class="tag-remove" data-tag="${tag}">×</span>
        </span>
    `).join('');

    // Add click handlers for remove
    customTagsDisplay.querySelectorAll('.tag-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            const tagToRemove = btn.dataset.tag;
            customTags = customTags.filter(t => t !== tagToRemove);
            renderCustomTags();
            chrome.storage.local.set({ customTags });
        });
    });
}

// ─── Position Selection ────────────────────────────────────────────────────────
function updatePositionSelection(position) {
    positionOptions.forEach(opt => {
        opt.classList.toggle('active', opt.dataset.position === position);
    });
}

// ─── Save Settings ──────────────────────────────────────────────────────────────
async function saveToggleSetting(key, value) {
    await chrome.storage.local.set({ [key]: value });
}

// ─── Data Management ───────────────────────────────────────────────────────────
async function exportSettings() {
    const settings = await chrome.storage.local.get(null);
    const exportData = {
        version: '2.0',
        exportDate: new Date().toISOString(),
        type: 'settings',
        data: {
            eaglePort: settings.eaglePort,
            eagleApiToken: settings.eagleApiToken,
            customTags: settings.customTags,
            autoSystemTags: settings.autoSystemTags,
            enableFloatBtn: settings.enableFloatBtn,
            floatButtonPosition: settings.floatButtonPosition,
            autoAnnotation: settings.autoAnnotation,
            rememberFolder: settings.rememberFolder,
            showSuccessAnim: settings.showSuccessAnim,
            selectedFolderId: settings.selectedFolderId
        }
    };

    downloadJSON(exportData, `promptnote-settings-${new Date().toISOString().slice(0, 10)}.json`);
}

async function exportHistory() {
    const { saveHistory } = await chrome.storage.local.get('saveHistory');
    const history = saveHistory || [];
    
    const exportData = {
        version: '2.0',
        exportDate: new Date().toISOString(),
        type: 'history',
        total: history.length,
        data: history
    };

    downloadJSON(exportData, `promptnote-history-${new Date().toISOString().slice(0, 10)}.json`);
}

function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const data = JSON.parse(event.target.result);
            
            if (data.type === 'settings' && data.data) {
                await chrome.storage.local.set(data.data);
                alert('配置导入成功！页面将刷新以应用新设置。');
                location.reload();
            } else if (data.type === 'history' && data.data) {
                const { saveHistory = [] } = await chrome.storage.local.get('saveHistory');
                const merged = [...saveHistory, ...data.data];
                // Remove duplicates by URL
                const unique = [];
                const seen = new Set();
                for (const item of merged) {
                    if (!seen.has(item.url)) {
                        seen.add(item.url);
                        unique.push(item);
                    }
                }
                await chrome.storage.local.set({ saveHistory: unique });
                alert(`历史记录导入成功！共导入 ${data.data.length} 条记录。`);
            } else {
                alert('无法识别的文件格式。');
            }
        } catch (err) {
            alert('导入失败：' + err.message);
        }
    };
    reader.readAsText(file);
    e.target.value = '';
}

async function clearAllData() {
    if (!confirm('⚠️ 确定要清除所有数据吗？\n\n此操作将删除：\n- 所有配置设置\n- 保存历史记录\n\n此操作不可撤销！')) {
        return;
    }

    await chrome.storage.local.clear();
    alert('所有数据已清除。页面将刷新。');
    location.reload();
}

// ─── Utility Functions ─────────────────────────────────────────────────────────
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// ─── Start ─────────────────────────────────────────────────────────────────────
init().catch(console.error);