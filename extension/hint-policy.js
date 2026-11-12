/**
 * 断因提示策略（纯模块：无 DOM，不读 SillyTavern 全局）。
 *
 * 回答两件事：这条消息该不该去问 classify；设置里要不要提醒去打补丁。
 * 原因分类仍由 compat-contract.classify 负责。classify(null) 的含义保持不变
 * （unknown 兜底），本模块决定什么时候根本不要去问。
 *
 * 「读不到 raw」有三种不同含义，不可折成同一次 classify(null)：
 *   A. 不是一次模型生成（角色开场白 / first_message、系统消息等）——不要每条提示。
 *   B. 结束原因透传不可用（官方未打补丁的 ST）——不要每条 unknown；设置里提醒一次。
 *   C. 透传可用，且这是一次真正的生成，但这一轮没有/是 unknown 原因 —— 这时才 classify(null)。
 */

/** 消息 extra / 响应载荷上可能出现的结束原因字段。 */
export const FINISH_REASON_KEYS = [
    'finish_reason',
    'finishReason',
    'stop_reason',
    'stopReason',
    'native_finish_reason',
    'blockReason',
    'block_reason',
    'promptBlockReason',
];

/** 1.19.0 补丁在 public/scripts/openai.js 上新增的命名导出。 */
export const PASSTHROUGH_EXPORTS = ['extractFinishState', 'applyFinishStateToExtra'];

export const SETTINGS_NOTICE_TEXT = '当前的 SillyTavern 还没有打结束原因补丁，断因无法判断回复为什么结束。请按安装说明给本机 SillyTavern 打上补丁后再用，否则不会在消息旁显示结束原因。';

export function hasNonEmpty(value) {
    if (value == null) return false;
    if (typeof value === 'string') return value.trim() !== '';
    if (typeof value === 'number' && Number.isFinite(value)) return true;
    if (typeof value === 'boolean') return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return String(value).trim() !== '';
}

export function isRawPresent(raw) {
    return raw != null && String(raw).trim() !== '';
}

export function currentSwipeInfo(message) {
    if (!message || !Array.isArray(message.swipe_info)) return null;
    const id = typeof message.swipe_id === 'number' ? message.swipe_id : 0;
    const info = message.swipe_info[id];
    return info && typeof info === 'object' ? info : null;
}

function extraOf(message) {
    return message && typeof message.extra === 'object' && message.extra ? message.extra : null;
}

function extraHasFinishReasonField(extra) {
    if (!extra || typeof extra !== 'object') return false;
    return FINISH_REASON_KEYS.some((key) => hasNonEmpty(extra[key]));
}

/**
 * 官方透传字段是否已经出现在这条消息上。
 * 只看 extra 上的结束原因字段，不把 extra.duanyin（含已关闭的提示）当成透传证据。
 */
export function messageHasPassthroughField(message) {
    if (!message || typeof message !== 'object') return false;
    if (extraHasFinishReasonField(extraOf(message))) return true;
    const swipe = currentSwipeInfo(message);
    return extraHasFinishReasonField(swipe?.extra);
}

function hasGenerationTimestamp(obj) {
    return !!(obj && (hasNonEmpty(obj.gen_started) || hasNonEmpty(obj.gen_finished)));
}

/**
 * 这条消息是不是一次模型生成。
 * 不以「聊天里第一条助手消息」来判断。eventType === 'first_message' 一律不是生成
 * （即使字段看起来令人困惑）。默认保守：没有生成证据就返回 false。
 *
 * @param {object|null|undefined} message
 * @param {string} [eventType] MESSAGE_RECEIVED / CHARACTER_MESSAGE_RENDERED 的 type
 * @returns {boolean}
 */
export function isModelGeneration(message, eventType) {
    if (eventType === 'first_message' || eventType === 'quiet') return false;
    if (!message || typeof message !== 'object') return false;
    if (message.is_user || message.is_system) return false;

    if (hasGenerationTimestamp(message)) return true;
    if (hasGenerationTimestamp(currentSwipeInfo(message))) return true;

    const extra = extraOf(message);
    if (extraHasFinishReasonField(extra)) return true;
    const swipeExtra = currentSwipeInfo(message)?.extra;
    if (extraHasFinishReasonField(swipeExtra)) return true;

    // 官方 ST 即使未打补丁，也会在 Chat Completion 生成结果上写入 api / model。
    // 这是辅助证据，不是唯一依据（开场白没有这些字段）。
    if (hasNonEmpty(extra?.api) || hasNonEmpty(extra?.model)) return true;
    if (hasNonEmpty(swipeExtra?.api) || hasNonEmpty(swipeExtra?.model)) return true;

    // 提供方 usage（不要和本地估算的 extra.token_count 混淆）。
    if (hasNonEmpty(extra?.usage) || hasNonEmpty(swipeExtra?.usage)) return true;

    // extra.duanyin（含 dismissed）不是生成证据。
    return false;
}

function isChatMessageLike(obj) {
    if (!obj || typeof obj !== 'object') return false;
    if (!('mes' in obj)) return false;
    return 'is_user' in obj || 'is_system' in obj || 'name' in obj || 'send_date' in obj;
}

function eventDataBelongsToMessage(eventData, message, mesId) {
    if (!eventData || typeof eventData !== 'object' || Array.isArray(eventData)) return false;
    const eventMesId = eventData.mesId ?? eventData.message_id ?? eventData.mesid;
    if (eventMesId != null && mesId != null && Number(eventMesId) !== Number(mesId)) {
        return false;
    }
    // 另一条聊天消息的对象不能用来给当前消息提结束原因。
    if (message && eventData !== message && isChatMessageLike(eventData)) return false;
    return true;
}

function firstReasonIn(obj) {
    if (!obj || typeof obj !== 'object') return null;
    for (const key of FINISH_REASON_KEYS) {
        const value = obj[key];
        if (hasNonEmpty(value)) return { raw: String(value), key };
    }
    return null;
}

/**
 * 只从「这一条消息」提取结束原因。
 * eventData 仅在事件确实属于同一条消息时使用；绝不扫描聊天里的其它条目。
 *
 * @param {{ message?: object, eventData?: object, mesId?: number }} [args]
 * @returns {{ raw: string, key: string } | null}
 */
export function extractRawFinishReason({ message, eventData, mesId } = {}) {
    const pools = [];
    if (eventDataBelongsToMessage(eventData, message, mesId)) {
        pools.push(eventData, eventData.extra, eventData.choice, eventData.choices?.[0]);
    }
    if (message && typeof message === 'object') {
        pools.push(message, message.extra, message.extra?.duanyin);
        const swipe = currentSwipeInfo(message);
        if (swipe) pools.push(swipe, swipe.extra);
    }

    for (const obj of pools) {
        const found = firstReasonIn(obj);
        if (found) return found;
    }
    return null;
}

/**
 * 是否询问 classify，以及是否允许展示 unknown 兜底。
 *
 * - 开场白 / 非生成：不问 classify，不展示（调用方仍应先清掉残留提示条）。
 * - 已有 raw（含字面 "unknown"）：询问 classify，即使探测为未打补丁。
 *   用户手改 extra、或未来官方 ST 自己写入 finish_reason 时，仍应显示。
 * - 透传可用且这是一次生成、但 raw 缺失：询问 classify，允许 unknown（情况 C）。
 * - 透传不可用且无 raw：仍可询问 classify，以便 thinking_quota 在 raw 为 null 时升级；
 *   但不允许 unknown 兜底（情况 B，改由设置面板提醒）。
 *
 * @param {{ message?: object, eventType?: string, raw?: string|null, passthroughAvailable?: boolean }} [params]
 * @returns {{ askClassify: boolean, allowUnknown: boolean, reason: string }}
 */
export function decideHint({ message, eventType, raw, passthroughAvailable = false } = {}) {
    if (eventType === 'quiet') {
        return { askClassify: false, allowUnknown: false, reason: 'quiet' };
    }
    if (!isModelGeneration(message, eventType)) {
        return { askClassify: false, allowUnknown: false, reason: 'not_generation' };
    }
    if (isRawPresent(raw)) {
        return { askClassify: true, allowUnknown: true, reason: 'raw_present' };
    }
    if (passthroughAvailable) {
        return { askClassify: true, allowUnknown: true, reason: 'patched_unknown' };
    }
    return { askClassify: true, allowUnknown: false, reason: 'passthrough_unavailable' };
}

export function shouldShowSettingsNotice(passthroughAvailable) {
    return !passthroughAvailable;
}

function defaultImportOpenai(url) {
    return import(url);
}

/**
 * 探测 ST 是否提供结束原因透传。失败或缺少补丁导出时视为未打补丁。
 * 不要仅凭某条消息没有 finish_reason 就推断「未打补丁」（开场白也没有）。
 *
 * @param {{ importOpenai?: (url: string) => Promise<object> }} [options] 测试时可注入。
 * @returns {Promise<boolean>}
 */
export async function detectPassthrough(options = {}) {
    const importer = typeof options.importOpenai === 'function'
        ? options.importOpenai
        : defaultImportOpenai;
    try {
        const mod = await importer('/scripts/openai.js');
        return typeof mod?.extractFinishState === 'function'
            && typeof mod?.applyFinishStateToExtra === 'function';
    } catch {
        return false;
    }
}
