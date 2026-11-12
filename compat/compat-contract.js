/**
 * 断因分类约定（ES module，无依赖，可在 SillyTavern 扩展里直接 import）。
 *
 * 扩展工程师请使用：
 *   import { classify, rules, categories, fallback } from './compat-contract.js';
 *   const info = classify(raw, { message, mesId, ctx });
 *
 * 返回：{ show, category, title, message, suggestion, action }
 * - title / message / suggestion 为中文（英文在 compat-reasons.json）
 * - action === 'continue' 时扩展显示「继续生成」；否则为 ''
 * - show === false 时不显示提示（正常 stop / 常规 tool_calls）
 * - raw 为原始 finish_reason 字符串；读不到时传 null，将落入 fallback（unknown）
 * - context 可用于思考额度判断：可见正文很短或为空，但存在 reasoning / thought tokens 时，
 *   即使 raw 是 length、stop 或缺失，也归为 thinking_quota
 * - classify 只解释结束原因，不判断这是不是一次生成、也不判断补丁有没有打上。
 *   调用方若不想在每条消息上显示 unknown，就不要把非模型生成（角色开场白等）
 *   或「结束原因透传不可用（未打补丁）」的情况交给 classify(null)。
 */
export const rules = [
  {
    "id": "content_filter",
    "match": [
      "content_filter",
      "SAFETY",
      "PROHIBITED_CONTENT",
      "BLOCKLIST",
      "SPII",
      "IMAGE_SAFETY",
      "IMAGE_PROHIBITED_CONTENT",
      "MODEL_ARMOR",
      "content_policy_violation",
      "HARM_CATEGORY"
    ],
    "show": true,
    "severity": "warning",
    "is_truncated": true,
    "title_zh": "回复被内容过滤打断了",
    "title_en": "The reply was stopped by a content filter",
    "message_zh": "服务提供方判定这段内容触发了安全或内容策略，所以生成停了。即使在 SillyTavern 里把安全选项关掉，对方仍可能拦截。",
    "message_en": "The provider stopped this reply because it triggered a safety or content policy. They can still block it even if SillyTavern safety settings are turned off.",
    "suggestion_zh": "可以换个说法再试，或换一个模型/渠道。不必反复点「继续」，同样的拦截可能还会出现。",
    "suggestion_en": "Try rephrasing, or switch models or providers. Pressing Continue may hit the same filter again.",
    "action": ""
  },
  {
    "id": "recitation",
    "match": [
      "RECITATION",
      "IMAGE_RECITATION"
    ],
    "show": true,
    "severity": "info",
    "is_truncated": true,
    "title_zh": "回复因引用限制停了",
    "title_en": "The reply stopped because of a recitation limit",
    "message_zh": "模型认为接下来的内容可能大段复述已有文本，所以提前结束了。",
    "message_en": "The model stopped because the next part may have closely recapped existing text.",
    "suggestion_zh": "可以换一种问法，或点「继续」看是否能换个角度写下去。",
    "suggestion_en": "Try asking in a different way, or press Continue to see if it can take another angle.",
    "action": "continue"
  },
  {
    "id": "refusal",
    "match": [
      "refusal"
    ],
    "show": true,
    "severity": "warning",
    "is_truncated": false,
    "title_zh": "模型拒绝了这次回复",
    "title_en": "The model declined this reply",
    "message_zh": "模型自己拒绝继续写下去，这和字数用完不是一回事。",
    "message_en": "The model itself declined to continue. This is not the same as hitting a length limit.",
    "suggestion_zh": "可以改写你的请求后再试，或换一个模型。",
    "suggestion_en": "Try rephrasing your request, or switch to another model.",
    "action": ""
  },
  {
    "id": "context_length",
    "match": [
      "context_length",
      "prompt_too_long",
      "ContextTooLong",
      "context_length_exceeded"
    ],
    "show": true,
    "severity": "warning",
    "is_truncated": false,
    "title_zh": "上下文太长了",
    "title_en": "The prompt was too long",
    "message_zh": "发给模型的内容超出了它的上下文长度，这一轮没能正常写完。",
    "message_en": "The prompt exceeded the model's context length, so this turn could not finish normally.",
    "suggestion_zh": "可以减少世界书、总结更早的对话，或换一个上下文更长的模型。",
    "suggestion_en": "Trim World Info, summarize earlier chat, or switch to a model with a longer context window.",
    "action": ""
  },
  {
    "id": "cancelled",
    "match": [
      "cancelled",
      "canceled",
      "aborted",
      "user_abort"
    ],
    "show": true,
    "severity": "info",
    "is_truncated": true,
    "title_zh": "生成已取消",
    "title_en": "Generation was cancelled",
    "message_zh": "这次回复是中途取消的，所以可能不完整。",
    "message_en": "This reply was cancelled partway through, so it may be incomplete.",
    "suggestion_zh": "如果需要完整回复，可以再生成一次，或在已有内容上点「继续」。",
    "suggestion_en": "Generate again if you need a full reply, or press Continue on what is already there.",
    "action": "continue"
  },
  {
    "id": "network",
    "match": [
      "timeout",
      "ECONNREFUSED",
      "network",
      "disconnected",
      "ETIMEDOUT",
      "ECONNRESET"
    ],
    "show": true,
    "severity": "warning",
    "is_truncated": true,
    "title_zh": "连接中断了",
    "title_en": "The connection was interrupted",
    "message_zh": "生成过程中网络或连接出了问题，回复可能不完整。",
    "message_en": "The connection dropped during generation, so the reply may be incomplete.",
    "suggestion_zh": "检查网络后再试一次。如果已经有一段内容，也可以点「继续」。",
    "suggestion_en": "Check your connection and try again. If some text already arrived, you can also press Continue.",
    "action": "continue"
  },
  {
    "id": "provider_error",
    "match": [
      "error",
      "OTHER",
      "IMAGE_OTHER",
      "server_error",
      "MALFORMED_RESPONSE",
      "NO_IMAGE"
    ],
    "show": true,
    "severity": "warning",
    "is_truncated": false,
    "title_zh": "生成遇到了上游错误",
    "title_en": "The provider returned an error",
    "message_zh": "模型服务在这一轮返回了错误，所以回复可能不完整或没有内容。",
    "message_en": "The model provider returned an error, so this reply may be incomplete or empty.",
    "suggestion_zh": "稍后再试，或换一个模型/渠道。",
    "suggestion_en": "Try again in a moment, or switch models or providers.",
    "action": ""
  },
  {
    "id": "thinking_quota",
    "match": [
      "thinking_quota",
      "empty_reasoning"
    ],
    "show": true,
    "severity": "info",
    "is_truncated": true,
    "title_zh": "思考占用了生成额度",
    "title_en": "Thinking used up the output budget",
    "message_zh": "这一轮很多字数花在了模型的思考过程上，所以你看到的回复很短，或者几乎是空的。思考内容也会计入长度上限。",
    "message_en": "A large share of this turn's token budget went to the model's thinking, so the visible reply is short or almost empty. Thinking tokens count toward the length limit too.",
    "suggestion_zh": "可以调高回复长度上限后再点「继续」，或换一个不带思考的模型。",
    "suggestion_en": "Raise the max token limit and press Continue, or switch to a non-thinking model.",
    "action": "continue"
  },
  {
    "id": "truncated",
    "match": [
      "length",
      "max_tokens",
      "MAX_TOKENS",
      "CONTINUATION"
    ],
    "show": true,
    "severity": "info",
    "is_truncated": true,
    "title_zh": "回复被截断了",
    "title_en": "The reply was cut off",
    "message_zh": "达到了本次生成的长度上限。",
    "message_en": "This reply hit the maximum length set for this generation.",
    "suggestion_zh": "可以试着调高 max tokens，或点「继续」接着写。",
    "suggestion_en": "Try raising max tokens, or press Continue to keep writing.",
    "action": "continue"
  },
  {
    "id": "tool_calls",
    "match": [
      "tool_calls",
      "function_call",
      "tool_use",
      "MALFORMED_FUNCTION_CALL",
      "UNEXPECTED_TOOL_CALL",
      "TOO_MANY_TOOL_CALLS"
    ],
    "show": false,
    "severity": "info",
    "is_truncated": false,
    "title_zh": "模型发起了工具调用",
    "title_en": "The model made a tool call",
    "message_zh": "这一轮停在工具调用上，通常会由 SillyTavern 继续处理，不必当作截断。",
    "message_en": "This turn stopped for a tool call. SillyTavern usually handles that next, so it is not a truncation.",
    "suggestion_zh": "无需特别处理。如果没有看到后续回复，再检查工具调用设置。",
    "suggestion_en": "Usually nothing to do. If no follow-up reply appears, check your tool-calling settings.",
    "action": ""
  },
  {
    "id": "stop",
    "match": [
      "stop",
      "STOP",
      "end_turn",
      "stop_sequence",
      "natural"
    ],
    "show": false,
    "severity": "info",
    "is_truncated": false,
    "title_zh": "模型正常结束",
    "title_en": "The model finished normally",
    "message_zh": "这一轮已经正常写完了。",
    "message_en": "This turn finished normally.",
    "suggestion_zh": "无需特别处理。",
    "suggestion_en": "No action needed.",
    "action": ""
  }
];

export const fallback = {
  "id": "unknown",
  "match": [
    "unknown",
    "missing",
    "FINISH_REASON_UNSPECIFIED"
  ],
  "show": true,
  "severity": "info",
  "is_truncated": false,
  "title_zh": "回复可能提前结束了",
  "title_en": "The reply may have ended early",
  "message_zh": "没能读到明确的结束原因，所以无法判断是写完了、被截断，还是被过滤。",
  "message_en": "No clear stop reason was available, so it is unclear whether the reply finished, was cut off, or was filtered.",
  "suggestion_zh": "如果句子看起来没写完，可以点「继续」，或调高长度上限后再试。",
  "suggestion_en": "If the sentence looks unfinished, press Continue, or raise the length limit and try again.",
  "action": "continue"
};

/** 与 rules 相同，供加载器统计 ruleCount（`mod.categories`）。 */
export const categories = rules;

const SHORT_VISIBLE = 80;

function normalize(raw) {
    if (raw == null) return '';
    const text = String(raw).trim();
    if (text === '' || text === 'null' || text === 'undefined') return '';
    return text;
}

function toResult(rule) {
    return {
        show: rule.show !== false,
        category: rule.id || '',
        title: rule.title_zh || rule.title || '',
        message: rule.message_zh || rule.message || '',
        suggestion: rule.suggestion_zh || rule.suggestion || '',
        action: rule.action || '',
    };
}

function messageOf(context) {
    if (!context || typeof context !== 'object') return null;
    if (context.message && typeof context.message === 'object') return context.message;
    const chat = context.ctx?.chat;
    const id = context.mesId;
    if (Array.isArray(chat) && Number.isInteger(id) && chat[id]) return chat[id];
    return null;
}

function visibleText(context) {
    const mes = messageOf(context);
    if (!mes) return String(context?.text || context?.visible || '').trim();
    return String(mes.extra?.display_text || mes.mes || '').trim();
}

function reasoningText(context) {
    const mes = messageOf(context);
    return String(
        context?.reasoning
        || mes?.extra?.reasoning
        || mes?.extra?.duanyin?.reasoning
        || '',
    ).trim();
}

function usageOf(context) {
    const mes = messageOf(context);
    const extra = mes?.extra || {};
    return context?.usage
        || context?.usageMetadata
        || extra.usage
        || extra.usageMetadata
        || extra.duanyin?.usage
        || extra.duanyin?.usageMetadata
        || null;
}

function num(...values) {
    for (const value of values) {
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) return n;
    }
    return 0;
}

function thoughtTokens(usage) {
    if (!usage || typeof usage !== 'object') return 0;
    const details = usage.completion_tokens_details || usage.completionTokensDetails || {};
    return num(
        usage.thoughtsTokenCount,
        usage.thoughts_token_count,
        details.reasoning_tokens,
        details.reasoning,
    );
}

function outputTokens(usage) {
    if (!usage || typeof usage !== 'object') return 0;
    return num(
        usage.candidatesTokenCount,
        usage.candidates_token_count,
        usage.completion_tokens,
        usage.completionTokens,
    );
}

const SAFETY_IDS = new Set(['content_filter', 'recitation', 'refusal']);

/**
 * 可见正文很短或为空，且有明显思考/推理占用时，归为思考额度不足。
 * 即使 raw 为 length / stop / 缺失也优先于普通截断或正常结束。
 * 内容过滤、引用限制、拒答不覆盖。
 */
export function isThinkingQuotaCase(raw, context) {
    const rule = matchRule(raw);
    if (rule && SAFETY_IDS.has(rule.id)) return false;
    if (rule && (rule.id === 'cancelled' || rule.id === 'network' || rule.id === 'context_length' || rule.id === 'provider_error')) {
        return false;
    }

    const visible = visibleText(context);
    const reasoning = reasoningText(context);
    const thoughts = thoughtTokens(usageOf(context));
    const output = outputTokens(usageOf(context));
    const short = visible.length === 0 || visible.length <= SHORT_VISIBLE;
    if (!short) return false;

    if (thoughts > 0 && (visible.length === 0 || thoughts >= Math.max(output, 1))) return true;
    if (reasoning.length >= 40 && (visible.length === 0 || reasoning.length >= visible.length * 2)) return true;
    return false;
}

function matchRule(raw) {
    const rawStr = normalize(raw);
    if (!rawStr) return null;
    const needle = rawStr.toLowerCase();
    for (const rule of rules) {
        const values = Array.isArray(rule.match) ? rule.match : [];
        if (values.some((item) => String(item).toLowerCase() === needle)) return rule;
        if (String(rule.id).toLowerCase() === needle) return rule;
    }
    return null;
}

/**
 * @param {string|null|undefined} raw 原始 finish_reason / finishReason / stop_reason 等
 * @param {object} [context] { message, mesId, ctx, usage, usageMetadata, reasoning, text }
 * @returns {{ show: boolean, category: string, title: string, message: string, suggestion: string, action: string }}
 *
 * raw 为 null，或字面值为 unknown / missing / FINISH_REASON_UNSPECIFIED 时，返回 unknown 兜底（show: true）。
 * 这只说明「原因是什么」，不说明「该不该在这条消息旁展示」。
 */
export function classify(raw, context = {}) {
    if (isThinkingQuotaCase(raw, context)) {
        const thinking = rules.find((rule) => rule.id === 'thinking_quota') || fallback;
        return toResult(thinking);
    }
    const rule = matchRule(raw);
    if (rule) return toResult(rule);
    return toResult(fallback);
}

export default classify;
