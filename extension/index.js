/**
 * 断因：生成结束时读取结束原因，在消息旁给出中文提示与建议。
 * 原因分类和正式文案由「断因·接口与兼容」提供（见 compat-contract.js / compat-reasons.json）。
 * 本文件只负责钩子、提示条 UI 和设置，不自撰一套分类。
 * 是否询问 classify、是否在设置里提醒补丁，见 hint-policy.js。
 */
import {
    detectPassthrough,
    decideHint,
    extractRawFinishReason,
    messageHasPassthroughField,
    shouldShowSettingsNotice,
} from './hint-policy.js';

const MODULE = 'duanyin';

const defaultSettings = {
    enabled: true,
};

/** 接口约定加载结果。未接入时为 null，不显示自撰分类文案。 */
let contract = null;

/** 启动时对 openai.js 补丁导出的探测结果。探测为已打补丁则可信，不必等第一轮生成。 */
let passthroughByFeatureDetect = false;
/** 本会话里是否已在消息上看到官方结束原因字段（防御：未来官方 ST 可能直接写字段但不暴露补丁导出）。 */
let passthroughByObservation = false;

const defaultSettingsRef = defaultSettings;

function getCtx() {
    return SillyTavern.getContext();
}

function getSettings() {
    const { extensionSettings } = getCtx();
    const merged = Object.assign(
        structuredClone(defaultSettingsRef),
        extensionSettings[MODULE] || {},
    );
    extensionSettings[MODULE] = merged;
    return merged;
}

function saveSettings() {
    const { saveSettingsDebounced } = getCtx();
    if (typeof saveSettingsDebounced === 'function') {
        saveSettingsDebounced();
    }
}

function isPassthroughAvailable() {
    return passthroughByFeatureDetect || passthroughByObservation;
}

function observePassthroughFromMessage(message) {
    if (!messageHasPassthroughField(message)) return;
    if (passthroughByObservation) return;
    passthroughByObservation = true;
    updatePassthroughNotice();
}

function observeChatForPassthrough(chat) {
    for (const message of chat || []) {
        if (messageHasPassthroughField(message)) {
            passthroughByObservation = true;
            return;
        }
    }
}

function escapeHtml(text) {
    const { DOMPurify } = SillyTavern.libs || {};
    if (DOMPurify && typeof DOMPurify.sanitize === 'function') {
        return DOMPurify.sanitize(String(text ?? ''), { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
    }
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * 按接口提供的 JSON 表做匹配。字段名做了宽松兼容，正式格式以约定为准。
 * 这里不填任何分类文案，只读表。
 */
function classifyFromJson(data, raw) {
    if (!data) return null;
    const rawStr = raw == null ? '' : String(raw);
    const rules = data.rules || data.categories || data.reasons || data.mapping || [];
    const ignoreCase = data.matchIgnoreCase !== false;

    const matchesRule = (rule) => {
        const values = rule.match || rule.raw_values || rule.aliases || rule.reasons || [];
        if (values.some((item) => ignoreCase
            ? String(item).toLowerCase() === rawStr.toLowerCase()
            : String(item) === rawStr)) {
            return true;
        }
        const id = rule.id || rule.category || rule.kind;
        return id != null && String(id) === rawStr;
    };

    const toResult = (rule) => ({
        show: rule.show !== false,
        category: rule.id || rule.category || rule.kind || '',
        title: rule.title_zh || rule.title || rule.name_zh || rule.name || '',
        message: rule.message_zh || rule.message || rule.text_zh || rule.text || '',
        suggestion: rule.suggestion_zh || rule.suggestion || rule.advice_zh || rule.advice || '',
        action: rule.action || '',
    });

    for (const rule of rules) {
        if (matchesRule(rule)) return toResult(rule);
    }
    const fallback = data.fallback || data.default;
    if (fallback) return toResult(fallback);
    return null;
}

function classify(raw, context) {
    if (!contract) return null;
    try {
        if (typeof contract.classify === 'function') {
            // raw 为 null 时走约定的 unknown 兜底（或 context 触发的 thinking_quota）。
            // 调用前须先经过 hint-policy.decideHint：非生成、透传不可用时不要把 unknown 画到每条消息上。
            return contract.classify(raw, context);
        }
    } catch (error) {
        console.error('[断因] 调用约定 classify 失败', error);
    }
    return null;
}

async function loadContract() {
    contract = null;

    try {
        const mod = await import(new URL('./compat-contract.js', import.meta.url).href);
        if (typeof mod.classify === 'function') {
            contract = {
                type: 'js',
                classify: mod.classify,
                meta: mod,
                ruleCount: Array.isArray(mod.rules) ? mod.rules.length
                    : Array.isArray(mod.categories) ? mod.categories.length
                        : null,
            };
            console.log('[断因] 已加载 compat-contract.js');
            return;
        }
        if (mod.default && typeof mod.default === 'object') {
            contract = {
                type: 'js-data',
                classify: (raw, ctx) => classifyFromJson(mod.default, raw, ctx),
                meta: mod.default,
                ruleCount: (mod.default.rules || mod.default.categories || []).length,
            };
            console.log('[断因] 已加载 compat-contract.js 数据表');
            return;
        }
    } catch (error) {
        if (!String(error?.message || error).includes('Failed to fetch')
            && error?.name !== 'TypeError') {
            console.debug('[断因] 未找到 compat-contract.js（约定尚未接入时属正常）', error?.message || error);
        }
    }

    try {
        const response = await fetch(new URL('./compat-reasons.json', import.meta.url));
        if (response.ok) {
            const data = await response.json();
            contract = {
                type: 'json',
                classify: (raw, ctx) => classifyFromJson(data, raw, ctx),
                meta: data,
                ruleCount: (data.rules || data.categories || data.reasons || data.mapping || []).length,
            };
            console.log('[断因] 已加载 compat-reasons.json');
            return;
        }
    } catch (error) {
        console.debug('[断因] 未找到 compat-reasons.json（约定尚未接入时属正常）');
    }
}

function contractStatusText() {
    if (!contract) {
        return '尚未接入接口约定：不会显示自撰分类。请把约定文件放到本扩展目录的 compat-contract.js 或 compat-reasons.json。';
    }
    const count = contract.ruleCount;
    const countText = typeof count === 'number' ? `（${count} 条）` : '';
    return `已加载接口约定${countText}。开场白不会出现结束原因提示；未打补丁时也不会在每条消息旁用兜底提示，请看下方说明。`;
}

function resolveMesId(arg) {
    if (typeof arg === 'number' && Number.isFinite(arg)) return arg;
    if (typeof arg === 'string' && /^\d+$/.test(arg)) return Number(arg);
    if (arg && typeof arg === 'object') {
        const id = arg.mesId ?? arg.message_id ?? arg.mesid ?? arg.id;
        if (typeof id === 'number' && Number.isFinite(id)) return id;
        if (typeof id === 'string' && /^\d+$/.test(id)) return Number(id);
    }
    const chat = getCtx().chat || [];
    for (let i = chat.length - 1; i >= 0; i--) {
        if (chat[i] && !chat[i].is_user && !chat[i].is_system) return i;
    }
    return null;
}

function persistDuanyin(mesId, patch) {
    const ctx = getCtx();
    const mes = ctx.chat?.[mesId];
    if (!mes) return;
    mes.extra = mes.extra || {};
    mes.extra.duanyin = Object.assign({}, mes.extra.duanyin, patch);
    if (typeof ctx.saveChat === 'function') {
        ctx.saveChat();
    } else if (typeof ctx.saveChatDebounced === 'function') {
        ctx.saveChatDebounced();
    }
}

function triggerContinue() {
    const ctx = getCtx();
    if (typeof ctx.generate === 'function') {
        ctx.generate('continue');
        return;
    }
    const button = document.querySelector('#option_continue, #mes_continue, .mes_continue');
    if (button) button.click();
}

function buildHintElement(info, { preview = false, mesId = null } = {}) {
    const bar = document.createElement('div');
    bar.className = 'duanyin-hint';
    bar.setAttribute('role', 'note');
    if (info.category) bar.dataset.category = info.category;
    if (preview) bar.dataset.preview = '1';
    if (mesId != null) bar.dataset.mesid = String(mesId);

    const title = info.title ? `<div class="duanyin-hint-title">${escapeHtml(info.title)}</div>` : '';
    const message = info.message ? `<p class="duanyin-hint-message">${escapeHtml(info.message)}</p>` : '';
    const suggestion = info.suggestion
        ? `<p class="duanyin-hint-suggestion">${escapeHtml(info.suggestion)}</p>`
        : '';
    const showContinue = info.action === 'continue';
    const actions = showContinue
        ? `<div class="duanyin-hint-actions"><button type="button" class="menu_button duanyin-continue">继续生成</button></div>`
        : '';

    bar.innerHTML = `
        <div class="duanyin-hint-body">
            ${title}${message}${suggestion}${actions}
        </div>
        ${preview ? '' : '<button type="button" class="duanyin-hint-dismiss" aria-label="关闭提示" title="关闭提示">×</button>'}
    `;

    bar.querySelector('.duanyin-continue')?.addEventListener('click', (event) => {
        event.preventDefault();
        triggerContinue();
    });
    bar.querySelector('.duanyin-hint-dismiss')?.addEventListener('click', (event) => {
        event.preventDefault();
        if (mesId != null) persistDuanyin(mesId, { dismissed: true });
        bar.remove();
    });

    return bar;
}

function messageElement(mesId) {
    return document.querySelector(`#chat .mes[mesid="${mesId}"]`);
}

function removeHint(mesId) {
    const el = messageElement(mesId);
    el?.querySelectorAll('.duanyin-hint').forEach((node) => node.remove());
}

function insertHint(mesEl, bar) {
    const text = mesEl.querySelector('.mes_text');
    const block = mesEl.querySelector('.mes_block');
    if (text) {
        text.insertAdjacentElement('afterend', bar);
    } else if (block) {
        block.appendChild(bar);
    } else {
        mesEl.appendChild(bar);
    }
}

function renderHintForMessage(mesId, eventType) {
    const ctx = getCtx();
    const mes = ctx.chat?.[mesId];
    const el = messageElement(mesId);
    if (!el || !mes) return;

    removeHint(mesId);
    observePassthroughFromMessage(mes);
    if (!getSettings().enabled) return;
    if (mes.is_user) return;
    if (mes.extra?.duanyin?.dismissed) return;

    const storedRaw = mes.extra?.duanyin?.raw;
    const extracted = storedRaw != null
        ? { raw: storedRaw, key: mes.extra?.duanyin?.key }
        : extractRawFinishReason({ message: mes, mesId });

    // 开场白不是一次生成，不要把误探到的 raw 写进去。
    // 也不要把「读不到」写成 stored raw，否则补丁生效后这条消息无法再拿到真正的结束原因。
    if (extracted && storedRaw == null && eventType !== 'first_message') {
        persistDuanyin(mesId, { raw: extracted.raw, key: extracted.key });
    }

    const raw = extracted ? extracted.raw : null;
    const decision = decideHint({
        message: mes,
        eventType,
        raw,
        passthroughAvailable: isPassthroughAvailable(),
    });
    if (!decision.askClassify) return;

    const result = classify(raw, { message: mes, mesId, ctx });
    if (!result || result.show === false) return;
    if (!decision.allowUnknown && result.category === 'unknown') return;
    if (!result.title && !result.message && !result.suggestion) return;

    insertHint(el, buildHintElement(result, { mesId }));
}

function renderAllHints() {
    const chat = getCtx().chat || [];
    observeChatForPassthrough(chat);
    updatePassthroughNotice();
    for (let i = 0; i < chat.length; i++) {
        renderHintForMessage(i);
    }
}

function captureFromEvent(eventData, eventType) {
    const mesId = resolveMesId(eventData);
    if (mesId == null) return;
    const ctx = getCtx();
    const mes = ctx.chat?.[mesId];
    observePassthroughFromMessage(mes);
    // 开场白不要捕捉或持久化一个假的 raw；仍刷新提示条，以便清掉残留、且不插入 unknown。
    if (eventType !== 'first_message') {
        const extracted = extractRawFinishReason({ message: mes, eventData, mesId });
        if (extracted) {
            persistDuanyin(mesId, { raw: extracted.raw, key: extracted.key, at: Date.now() });
        }
    }
    // 流式结束后 DOM 可能已在，立刻画；还没渲染则等 CHARACTER_MESSAGE_RENDERED
    renderHintForMessage(mesId, eventType);
}

function updateContractStatus() {
    const node = document.querySelector('#duanyin_contract_status');
    if (node) node.textContent = contractStatusText();
}

function updatePassthroughNotice() {
    const node = document.querySelector('#duanyin_passthrough_notice');
    if (!node) return;
    const show = shouldShowSettingsNotice(isPassthroughAvailable());
    node.hidden = !show;
}

async function refreshPassthroughState() {
    passthroughByFeatureDetect = await detectPassthrough();
    observeChatForPassthrough(getCtx().chat);
    updatePassthroughNotice();
}

function showPreview() {
    const host = document.querySelector('#duanyin_preview_host');
    if (!host) return;
    host.replaceChildren();
    const preview = {
        category: 'preview',
        title: '提示条预览',
        message: '正式的原因分类和文案由接口约定提供，这里只展示样式。',
        suggestion: '接入约定后，这里会出现一句可执行建议。',
        action: 'continue',
        show: true,
    };
    host.appendChild(buildHintElement(preview, { preview: true }));
}

function bindSettings() {
    const enabled = document.querySelector('#duanyin_enabled');
    if (enabled) {
        enabled.checked = !!getSettings().enabled;
        enabled.addEventListener('change', () => {
            getSettings().enabled = !!enabled.checked;
            saveSettings();
            renderAllHints();
        });
    }
    document.querySelector('#duanyin_preview_btn')?.addEventListener('click', showPreview);
    updateContractStatus();
    updatePassthroughNotice();
}

async function loadSettingsPanel() {
    const html = await fetch(new URL('./settings.html', import.meta.url)).then((r) => r.text());
    const host = document.querySelector('#extensions_settings2')
        || document.querySelector('#extensions_settings');
    if (!host) {
        console.warn('[断因] 找不到扩展设置面板容器');
        return;
    }
    host.insertAdjacentHTML('beforeend', html);
    bindSettings();
}

function bindEvents() {
    const { eventSource, event_types } = getCtx();
    if (!eventSource || !event_types) {
        console.warn('[断因] 无法绑定事件：缺少 eventSource');
        return;
    }

    const onGenerated = (data) => {
        console.debug('[断因] 生成结束事件', event_types.GENERATION_ENDED, data);
        captureFromEvent(data);
    };

    eventSource.on(event_types.GENERATION_ENDED, onGenerated);
    eventSource.on(event_types.MESSAGE_RECEIVED, (mesId, type) => captureFromEvent(mesId, type));
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (mesId, type) => {
        const id = resolveMesId(mesId);
        if (id != null) renderHintForMessage(id, type);
    });
    eventSource.on(event_types.MESSAGE_SWIPED, (data) => {
        const mesId = resolveMesId(data);
        if (mesId != null) renderHintForMessage(mesId);
    });
    eventSource.on(event_types.MESSAGE_UPDATED, (data) => {
        const mesId = resolveMesId(data);
        if (mesId != null) renderHintForMessage(mesId);
    });
    eventSource.on(event_types.CHAT_CHANGED, () => renderAllHints());
}

async function init() {
    getSettings();
    await loadContract();
    await loadSettingsPanel();
    await refreshPassthroughState();
    bindEvents();
    renderAllHints();
    console.log(`[断因] 已加载 ${contract ? '（约定已接入）' : '（等待接口约定）'}`);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init().catch((e) => console.error('[断因] 初始化失败', e)));
} else {
    init().catch((e) => console.error('[断因] 初始化失败', e));
}
