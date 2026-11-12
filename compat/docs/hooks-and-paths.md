# 钩子与字段路径

供「断因·扩展工程师」直接实现。所检版本：SillyTavern **1.19.0**（标签 `7e8663cd9c184a550b37238218bdd32c6efc68e9`；`release` HEAD `06bde939` 的业务源码与之相同）。

## 一句话

**未打补丁：没有官方、稳定、可给扩展用的结束原因字段或事件。**  
**打了本目录最小补丁之后：在生成结束事件里读 `chat[mesId].extra.finish_reason`。**

不要发明不存在的钩子。下面所有事件名和载荷都来自源码。

## 扩展入口

```js
const ctx = SillyTavern.getContext();
// ctx.eventSource, ctx.eventTypes（或 ctx.event_types）
// ctx.chat, ctx.saveChat, ctx.generate, ctx.chatCompletionSettings
```

`getContext()` 定义于 `public/scripts/st-context.js`（约 115–250 行），会交出 `eventSource`、`eventTypes` / `event_types`、`chat`、`saveChat`（即 `saveChatConditional`）、`generate` 等。

## 官方事件（扩展已经在用的）

定义见 `public/scripts/events.js` 第 3–111 行。

| 事件常量 | 字符串 | 实际载荷 | 备注 |
| --- | --- | --- | --- |
| `MESSAGE_RECEIVED` | `message_received` | `(mesId, type)` | 流式在 `StreamingProcessor.finalizeIntermediaryMessage`（`public/script.js` 3799 行附近）；非流式在 `saveReply`（6691 行等）。`type` 可能是 `'normal'`、`'swipe'`、`'continue'`、`'appendFinal'` 等。 |
| `CHARACTER_MESSAGE_RENDERED` | `character_message_rendered` | `(mesId, type)` | 紧跟在上一事件之后，DOM 通常已更新。适合画提示条。 |
| `GENERATION_ENDED` | `generation_ended` | `(chat.length)` | 在 `hideStopButton()`（3536 行）里发出。载荷是消息**条数**，不是下标。最后一条消息的下标是 `chat.length - 1`。不要把载荷直接当成 `mesId`。该事件可能在 `MESSAGE_RECEIVED` **之前**发出（流式路径里 `finalizeIntermediaryMessage` 先 `markUIGenStopped()` → `activateSendButtons()` → `hideStopButton()`，再 `emit(MESSAGE_RECEIVED)`）。 |
| `GENERATION_STOPPED` | `generation_stopped` | 无消息对象 | 用户点停止：`stopGeneration()`（5618 行）。用于识别取消。 |
| `MESSAGE_SWIPED` | `message_swiped` | `(mesId)` | `public/script.js` 10315 行。应改读当前 swipe 的 `chat[mesId].extra`（及 `swipe_info[swipe_id].extra`）。 |
| `MESSAGE_UPDATED` | `message_updated` | 消息下标（视调用方） | 编辑/更新后重绘。 |
| `CHAT_CHANGED` | `chat_id_changed` | 聊天标识 | 切聊天后重绘已保存的 `extra`。 |
| `STREAM_TOKEN_RECEIVED` | `stream_token_received` | **只有文本字符串 `text`** | 3895 行。不含 finish_reason，不要指望从这里读原因。 |

`IMPERSONATE_READY` 用于扮演，不是角色消息提示条的目标。`type === 'quiet'` 的内部生成不应弹出面向用户的提示。角色开场白会以 `type === 'first_message'` 发出，不是一次模型生成，不应显示结束原因提示。

## 未打补丁时：哪些路径读不到

扩展会在**当前这条消息**上试探（`message` / `message.extra` / `message.extra.duanyin`，以及当前 swipe 的 `swipe_info`）。`eventData` 仅在事件确实属于同一条消息时使用。不要扫描聊天里的其它条目，以免把另一条的结束原因漏到开场白上。

试探的字段名：`finish_reason`、`finishReason`、`stop_reason`、`stopReason`、`native_finish_reason`、`blockReason`、`block_reason`、`promptBlockReason`。

在官方 1.19.0 上，这些位置**都不会**被 ST 写入结束原因：

- `STREAM_TOKEN_RECEIVED` 只有文本。
- `MESSAGE_RECEIVED` / `CHARACTER_MESSAGE_RENDERED` 只传 `mesId` 和 `type`，没有响应 JSON。
- `GENERATION_ENDED` 只传 `chat.length`。
- `chat[i].extra` 会有 `api`、`model`、`reasoning`、`reasoning_signature`、`token_count`（**本地估算**，不是接口 usage）、`time_to_first_token` 等，**没有** `finish_reason`。
- 非流式 OpenAI / OpenRouter 的完整 JSON（含 `choices[0].finish_reason`）会进入 `onSuccess` 的局部变量 `data`（`public/script.js` 5461 行起），但 `extractMessageFromData`（6276–6299 行）只取文本，随后丢弃。扩展无法订阅到这个 `data`。
- 流式循环里 `parsed` 可以见到最后一块的 `finish_reason` / Gemini `finishReason`（`public/scripts/openai.js` 3175 行），但只用于 `getStreamingReply`、logprobs 和工具调用，不会写入 `state` 或消息。

因此：**未打补丁时不要假设能读到官方字段。** 把读到的原始值写入 `message.extra.duanyin` 仍然可行，但必须先有来源。

## 打补丁之后：官方字段路径

最小补丁会在发出扩展事件**之前**写入当前助手消息的 `extra`（含当前 swipe 的 `swipe_info[swipe_id].extra` 克隆）。

```text
chat[mesId].extra.finish_reason
    OpenAI / OpenRouter 标准化值，或 Gemini finishReason / Claude stop_reason 的透传字符串。
    例：stop | length | content_filter | tool_calls | MAX_TOKENS | SAFETY | cancelled

chat[mesId].extra.native_finish_reason
    更接近提供方原生的值（OpenRouter 的 native_finish_reason，或 Gemini finishReason / Claude stop_reason）。

chat[mesId].extra.block_reason
    Gemini `promptFeedback.blockReason`（若有）。

chat[mesId].extra.usage
    OpenAI / OpenRouter 的 `usage`，或 Gemini 的 `usageMetadata`（含 thoughtsTokenCount）。
    不要和 extra.token_count（本地估算）混淆。
```

推荐读取顺序：

1. `message.extra.finish_reason`
2. 若需要更细的分类：`message.extra.native_finish_reason`、`message.extra.block_reason`
3. 思考额度：`message.extra.usage`（以及已有的 `message.extra.reasoning`、`message.mes`）

已持久化的 `message.extra.duanyin.raw` 可作缓存，但**新的原始值应以 `extra.finish_reason` 为准**。

## 示例：订阅并分类最后一条助手消息

```js
import { classify } from './compat-contract.js';

const { eventSource, event_types, chat, saveChat } = SillyTavern.getContext();

function pickRaw(extra = {}) {
    return extra.finish_reason
        || extra.native_finish_reason
        || extra.block_reason
        || extra.duanyin?.raw
        || null;
}

function handleAssistantMessage(mesId) {
    if (typeof mesId !== 'number' || !chat[mesId] || chat[mesId].is_user) return;
    const message = chat[mesId];
    const extra = message.extra || {};
    const raw = pickRaw(extra);
    const info = classify(raw, { message, mesId, ctx: SillyTavern.getContext() });
    // info.show === false：正常结束，不要打标签
    // info.action === 'continue'：显示「继续生成」
    if (!info || info.show === false) return;
    // 渲染 info.title / info.message / info.suggestion
}

eventSource.on(event_types.MESSAGE_RECEIVED, (mesId, type) => {
    if (type === 'quiet' || type === 'first_message') return;
    handleAssistantMessage(mesId);
});

eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (mesId, type) => {
    if (type === 'quiet' || type === 'first_message') return;
    handleAssistantMessage(mesId);
});

eventSource.on(event_types.GENERATION_ENDED, (chatLength) => {
    // 载荷是条数，不是下标
    const mesId = (typeof chatLength === 'number' ? chatLength : chat.length) - 1;
    handleAssistantMessage(mesId);
});

eventSource.on(event_types.MESSAGE_SWIPED, (mesId) => handleAssistantMessage(mesId));
```

`classify(null, { message, mesId, ctx })` 会返回 unknown 兜底（`show: true`）。这只表示「原因无法分类」，不要把它用在角色开场白上，也不要在未打补丁、根本读不到透传字段时对每条消息都调用。

当前扩展由 `extension/hint-policy.js` 区分三种「没有 raw」：

- 不是一次模型生成（`type === 'first_message'`，或消息没有 `gen_started` / `gen_finished`、也没有 `extra.api` / `extra.model` / 结束原因字段等生成证据）：不显示每条消息的兜底提示。切聊天重绘时也按消息字段判断，不以「第一条助手消息」作为开场白定义。
- 官方未打补丁、透传不可用：不在每条消息旁显示 unknown；设置面板提醒需要按安装说明打补丁。探测方式是看 `public/scripts/openai.js` 是否导出补丁加入的 `extractFinishState` 和 `applyFinishStateToExtra`，而不是看某条消息缺不缺 `finish_reason`（开场白也会缺）。若本会话已在消息上看到官方结束原因字段，也视为透传可用。
- 透传可用，且这是一次真正的生成，但这一轮没有/是未知原因：这时才调用 `classify(null)` 显示「回复可能提前结束了」。

若消息上已经有结束原因，即使探测为未打补丁，仍应分类并显示。

取消：监听 `GENERATION_STOPPED`。补丁在能判断为用户中止时，会把 `extra.finish_reason` 写成 `'cancelled'`（若提供方没有给出其他原因）。

## `classify` 约定

```js
classify(raw, context) -> {
  show: boolean,
  category: string,
  title: string,        // 中文
  message: string,      // 中文
  suggestion: string,   // 中文
  action: string        // 'continue' 或 ''
}
```

- `raw`：原始结束原因字符串；读不到时传 `null`。
- `context` 建议包含 `{ message, mesId, ctx }`。`classify` 会用 `message.mes`、`message.extra.reasoning`、`message.extra.usage`（或 `usageMetadata`）判断 **thinking_quota**：可见正文很短或为空，但思考/推理占用了额度时，即使 `raw` 是 `length` / `stop` / 缺失，也归到这一类。内容过滤优先于思考额度。
- 模块同时导出 `rules`（与 `categories` 相同）和 `fallback`，便于打印 `ruleCount`。

分类 id（稳定，与 OpenRouter 常见值及 `isTruncated` 习惯对齐）：

`truncated`（length / max_tokens / MAX_TOKENS）、`stop`、`content_filter`、`tool_calls`、`thinking_quota`（空正文 + 思考）、以及 `recitation`、`refusal`、`cancelled`、`network`、`provider_error`、`context_length`、`unknown`。

## 版本注意

- 本路径以 1.19.0 为准。打补丁前没有这些 `extra.*` 字段。
- 若未来上游（例如 Issue #6161）把原因写到别的地方，以当时源码为准，并保持 `extra.finish_reason` 作为扩展读取的稳定入口。
- `main_api === 'openai'` 的 Chat Completion 是本产品的主路径。Text Completion 若走 `/chat/completions`（OpenRouter）同样适用；Kobold / NovelAI 等非 Chat Completion 路径不在本补丁范围，classify 应走 `unknown` 兜底。
