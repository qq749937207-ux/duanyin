# 透传调查报告：Chat Completion `finish_reason`

## 结论（明确）

**当前官方 SillyTavern 1.19.0（以及同时检查的 `release` / `staging` 业务源码）不能让扩展稳定读到生成结束原因。** 部分路径上字段会在内存里短暂出现，但不会进入消息对象、聊天元数据或扩展事件。这是「部分到达、完全未暴露」，对扩展而言按 **否** 处理。

最小补丁（不是核心重写）把原因写到扩展已经能读的 `message.extra` 上。见 [../patches/README.md](../patches/README.md) 与 [hooks-and-paths.md](hooks-and-paths.md)。

## 所检版本

| 项 | 值 |
| --- | --- |
| 仓库 | https://github.com/SillyTavern/SillyTavern |
| 默认分支 | `release` |
| 稳定标签 | **1.19.0** = `7e8663cd9c184a550b37238218bdd32c6efc68e9`（2026-09-14 19:55:46 +02:00） |
| `release` HEAD | `06bde939fb1e9c4c8d8641d810f0a916b5bce127`（2026-09-14 21:01:34 +02:00，subject: Fix npm release publishing workflow #6037） |
| 标签与 HEAD 的源码差 | 仅 `.github/workflows/npm-publish.yml`（`git diff --stat 1.19.0 HEAD`） |
| `package.json` | `"version": "1.19.0"` |
| `staging` | `ad29cbda62e92f145e44d7a10398a38af22ca986`（2026-10-03）。对 `openai.js` / `script.js` / `chat-completions.js` 只有模型默认值等无关改动，**同样没有**对 `finish_reason` 的读取 |
| 源码树中的 `finish_reason` | 在 `release` / `staging` 上，业务代码**零命中**；仅出现在 `tests/util/mock-server.js` 与 `tests/mock-server.test.js` |

调查日期：2026-11-12（Asia/Shanghai）。以下均来自实际阅读的源码。

## 与 Issue #6161 的关系

[#6161](https://github.com/SillyTavern/SillyTavern/issues/6161)（2026-10-25 开启，调查时仍为 open，未见已合并的官方实现）描述的问题和复现路径与本次源码结论一致：

- `public/scripts/openai.js` 从不读取 `finishReason` / `finish_reason`。
- 非流式 Gemini：`sendMakerSuiteRequest` 把响应重装成 `{ choices: [{ message: { content } }], responseContent }`，结束原因到不了客户端。
- 思考模型把 thinking tokens 计入 `maxOutputTokens`，UI 却无提示。
- 作者希望在核心里对异常原因弹 toast，并在流式 `state` 和非流式包装里保留原因。

本补丁**对齐其数据采集部分**（流式记入 `state`，非流式 Gemini 包装带上 `finish_reason`），但**不在核心里弹 toast**。提示文案与是否显示交给「断因」扩展，避免把产品文案写进 ST 核心。若上游日后按 #6161 落地，扩展仍应能读 `extra.finish_reason`；若官方改用别的字段，再跟源码更新钩子文档。

## 端到端路径

用户可见的 Chat Completion 主路径：`main_api === 'openai'` → `/api/backends/chat-completions/generate`。

### 后端

入口：`src/endpoints/backends/chat-completions.js` 的 `router.post('/generate', …)`（2242 行）。

按 `chat_completion_source` 分支。与结束原因相关的两类处理：

**1. 原样转发（OpenAI、OpenRouter、多数 OpenAI 兼容源）**

同文件 2689–2700 行：流式用 `forwardFetchResponse(fetchResponse, response)` 把上游 SSE 原样交给浏览器；非流式 `response.send(json)` 把完整 JSON（含 `choices[0].finish_reason`，OpenRouter 还有 `native_finish_reason`、`usage`、可选 `error`）交给前端。这一段**没有丢掉**字段。

OpenRouter 的请求体在 2301–2393 行组装（`reasoning`、Gemini 时附带 `GEMINI_SAFETY` 等），但不改写响应里的 finish 字段。

**2. 重新包装（会丢字段）**

- **Google AI Studio / Vertex**（`MAKERSUITE` / `VERTEXAI`）走 `sendMakerSuiteRequest`（454 行）。
  - 流式（740–743 行）：`forwardFetchResponse`，原生 SSE（`candidates[0].finishReason`、`usageMetadata`、`promptFeedback`）可以到达浏览器。
  - 非流式（783–785 行）原文：

```js
const reply = { choices: [{ 'message': { 'content': responseText } }], responseContent };
return response.send(reply);
```

  这里丢掉了 `candidates[0].finishReason`、`usageMetadata`、`promptFeedback`。若没有 candidate 且存在 `promptFeedback.blockReason`（765–768 行），会变成 `{ error: { message } }` 文本错误，而不是结构化的 finish 字段。可见正文为空且没有 functionCall / inlineData 时（777–780 行），同样变成 error，思考额度用尽的空回复可能在这里被当成错误，而不是 `MAX_TOKENS`。

- **Claude**（`sendClaudeRequest`，437–439 行）非流式同样只包装 `content`，丢掉 `stop_reason`。流式是 Anthropic 原生 SSE，原样转发。

安全设置：`GEMINI_SAFETY` / `VERTEX_SAFETY`（`src/constants.js` 141–185 行）默认 threshold 为 `'OFF'`。这与 #6161 的观察一致：ST 侧关掉安全，提供方仍可能返回 `SAFETY` / `PROHIBITED_CONTENT` 等。

### 前端接收

`sendOpenAIRequest`（`public/scripts/openai.js` 3138–3210 行）：

- 请求：`POST /api/backends/chat-completions/generate`。
- 非流式：`const data = await response.json();`，校验 error 后 **`return data`**（3209 行）。完整 JSON 回到 `Generate` 的 `onSuccess`。
- 流式（3160–3188 行）：解析每个 SSE 块为 `parsed`，用 `getStreamingReply(parsed, state)` 累加文本，并把 `{ text, swipes, logprobs, toolCalls, state }` yield 出去。`state` 初始为 `{ reasoning, images, signature, toolSignatures }`（3168 行），**没有** finish 字段。`getStreamingReply`（3222–3305 行）按源读取 delta / `candidates[0].content.parts` / reasoning，**从不读取** `finish_reason` 或 `finishReason`。

`StreamingProcessor.generate`（`public/script.js` 3859–3910 行）只把 `state.reasoning`、`state.images`、`state.signature` 写入处理器；`STREAM_TOKEN_RECEIVED` 只发出 `text`（3895 行）。结束时 `finalizeIntermediaryMessage` 把文本、reasoning、图片写入 `chat[messageId]`，**不写结束原因**。

非流式 `onSuccess`（5461 行起）：

```js
let getMessage = extractMessageFromData(data);
let reasoning = extractReasoningFromData(data);
```

`extractMessageFromData` 对 `main_api === 'openai'`（6291–6292 行）只取 `choices[0].message.content`（及若干后备）。随后 `saveReply` 把文本和 reasoning 写入 `extra`，完整 `data` 被丢弃。扩展看不到它。

### 写入消息的 extra 字段（现状）

`saveReply` / 流式进度里常见字段：`extra.api`、`extra.model`、`extra.reasoning`、`extra.reasoning_duration`、`extra.reasoning_signature`、`extra.token_count`、`extra.time_to_first_token`、群聊 `extra.gen_id`。没有 finish / usage（接口用量）。

`extra.token_count` 来自本地 `getTokenCountAsync`，**不是** Gemini `usageMetadata` 或 OpenRouter `usage`。不能用来判断 thinking tokens。

### 扩展钩子

见 [hooks-and-paths.md](hooks-and-paths.md)。没有「生成结束带响应 JSON」的官方事件。`GENERATION_ENDED` 只传 `chat.length`。

## OpenRouter

- ST 把它当作 OpenAI 兼容源：后端原样转发 `/api/v1/chat/completions`。
- 官方文档（https://openrouter.ai/docs/api/reference/overview）：标准化 `finish_reason` 为 `tool_calls` | `stop` | `length` | `content_filter` | `error`；原生值在 `native_finish_reason`；`usage.completion_tokens_details.reasoning_tokens` 可表示思考用量；中途错误可带 `choices[0].finish_reason: 'error'` 与 `error` 对象。拒答成功返回时，文档写明 Chat Completions 使用 `finish_reason: "content_filter"` 且带 `message.refusal`。
- ST 前端 `getStreamingReply` 的 OpenRouter 分支（3259–3288 行）读取 content / reasoning / images / signatures，**不读** `finish_reason`、`native_finish_reason`、`error`。
- 因此：字段会到达浏览器（流式最后一块或非流式 JSON），但扩展读不到。补丁只需在前端收集并写入 `extra`，不必改 OpenRouter 后端转发。

Gemini 经 OpenRouter 时，模型 id 形如 `google/gemini-...`。ST 会加 `safety_settings: GEMINI_SAFETY`（2391–2393 行）。结束原因一般是 OpenRouter 标准化之后的 `length` / `content_filter` / `stop`，原生 Gemini 枚举在 `native_finish_reason`。若只看 `finish_reason` 仍能做 MVP 分类；细分类应同时看 `native_finish_reason`。

## Gemini 原生（AI Studio / Vertex）

见 [gemini-thinking.md](gemini-thinking.md)。要点：

- 流式：原生 `finishReason` 在最后一块里，前端解析到了但丢弃。
- 非流式：后端包装丢失。这是必须补的缺口。
- `thinkingConfig.includeThoughts` / `thinkingBudget` / `thinkingLevel` 在 `sendMakerSuiteRequest` 603–621 行；预算由 `calculateGoogleBudgetTokens`（`src/prompt-converters.js` 1182 行起）根据 reasoning effort 计算。思考 tokens 计入 `maxOutputTokens`。

## Text Completion 及其他 API

仅在与同一条用户可见生成路径相关时说明：

- ST 把部分 OpenAI **Text Completion** 模型当作 chat completion 源（`parseChatCompletionLogprobs` 3334–3338 行）。若走 `/completions` 或 `/chat/completions` 且响应带 `choices[0].finish_reason`，补丁的 `extractFinishState` 同样能取到。
- Kobold / NovelAI / 多数 textgen 后端不在本补丁范围；那些路径没有本约定依赖的 Chat Completion 字段，扩展应使用 `unknown` 兜底。

## 补丁为何最小

只做「把已经见到的字段，写到扩展已经能读的地方」：

1. 非流式 Gemini / Claude 包装增加已有字段（各约数行），不改请求、不改采样。
2. 流式循环把 `extractFinishState(parsed)` 合并进现有 `state`。
3. 在 `saveReply` / `finalizeIntermediaryMessage` 里写入 `message.extra`，且必须发生在 `MESSAGE_RECEIVED` 和可能更早的 `GENERATION_ENDED` 之前。

不改 UI，不弹核心 toast，不重构流式架构，不新增事件名（以免和将来官方实现分叉过大）。风险见补丁说明：流式 vs 非流式、多 swipe、继续/重新生成、群聊、用户取消。
