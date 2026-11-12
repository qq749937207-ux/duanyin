# Gemini 思考模型：额度、字段与提示

所检 ST 版本：1.19.0。Gemini API 字段来自 Google 官方 `FinishReason` / `UsageMetadata` 文档；OpenRouter 字段来自其 API Reference。

## 会发生什么

对 Google 思考（thinking / reasoning）模型，思考过程消耗的 tokens 会计入本次输出上限（原生 API 为 `maxOutputTokens`，ST 设置里对应 Max Response Length / `max_tokens`）。因此即使用户看见的正文只有一两百字甚至是空的，这一轮也可能已经因为 `MAX_TOKENS` 停住。

Issue #6161 中的实例：默认 4096 上限的一次 Continue，思考用了 3931 tokens，正文只有 161，Gemini 返回 `finishReason: MAX_TOKENS`，界面没有任何说明。

这不是故障提示，只是说明「额度花在思考上了」。建议提高上限或换用不带思考的模型，不要说教。

## ST 如何打开思考

`sendMakerSuiteRequest`（`src/endpoints/backends/chat-completions.js` 526–621 行）：

- 对 `gemini-2.5-(flash|pro)`（非图像）以及 `gemini-3[.\d]*-(flash|pro)` 会设置 `generationConfig.thinkingConfig`。
- `includeThoughts` 来自请求的 `include_reasoning`（与前端「Show thoughts」一类设置对应）。
- `thinkingBudget`（数字）或 `thinkingLevel`（Gemini 3 的 `'minimal' | 'low' | 'medium' | 'high'` 等）由 `calculateGoogleBudgetTokens`（`src/prompt-converters.js` 1182 行起）按 `reasoning_effort` 和 `maxOutputTokens` 计算。例如 2.5 Flash 的 high 约为上限的 50%，且有各自的上下夹紧。

ST 把 Google 安全阈值默认设为 `OFF`（`src/constants.js` 的 `GEMINI_SAFETY`）。提供方仍可能返回 `SAFETY`、`PROHIBITED_CONTENT`、`BLOCKLIST`、`SPII`、`RECITATION` 等。

## 字段（原生 Gemini）

候选的 `finishReason`（官方枚举，常见值）：

| 值 | 本分类 id | 含义 |
| --- | --- | --- |
| `STOP` | `stop` | 自然结束或遇到停止序列 |
| `MAX_TOKENS` | `truncated`（若思考占用了额度且可见正文很短 → `thinking_quota`） | 达到 `maxOutputTokens` |
| `CONTINUATION` | `truncated` | 达成本次上限，但可用 continuation token 继续 |
| `SAFETY`、`PROHIBITED_CONTENT`、`BLOCKLIST`、`SPII`、`IMAGE_SAFETY`、`IMAGE_PROHIBITED_CONTENT`、`MODEL_ARMOR` | `content_filter` | 安全 / 内容策略 |
| `RECITATION`、`IMAGE_RECITATION` | `recitation` | 可能大段复述已有文本 |
| `OTHER`、`IMAGE_OTHER`、`MALFORMED_RESPONSE`、`NO_IMAGE` | `provider_error` | 其他上游结束 |
| `MALFORMED_FUNCTION_CALL`、`UNEXPECTED_TOOL_CALL`、`TOO_MANY_TOOL_CALLS` | `tool_calls` | 工具调用相关（常规 tool_calls 不提示） |
| `FINISH_REASON_UNSPECIFIED` 或缺失 | `unknown` | 读不到 |

请求级拦截：`promptFeedback.blockReason`（如 `SAFETY`、`BLOCKLIST`、`PROHIBITED_CONTENT`、`IMAGE_SAFETY`）。非流式路径在 ST 里可能变成 `error.message` 文本（「Prompt was blocked due to …」），补丁会尽量把 `blockReason` 放到 `extra.block_reason` 和 `choices[0].finish_reason`。

用量：`usageMetadata`

- `promptTokenCount`、`candidatesTokenCount`、`totalTokenCount`
- `thoughtsTokenCount`：思考 tokens（官方说明 `totalTokenCount` 包含 prompt + tool-use prompt + thoughts + candidates）
- 以及 cached / 各 modality 明细（扩展一般用不到）

可见思考文本：非流式在包装后的 `responseContent.parts` 里 `part.thought` 为真的部分；前端会写入 `message.extra.reasoning`（若开启 show thoughts）。流式在 `getStreamingReply` 里累加到 `state.reasoning`。

**注意：** 未打补丁时，非流式包装不包含 `usageMetadata`。`message.extra.token_count` 是本地估算，不能代替 `thoughtsTokenCount`。

空正文：若非流式候选没有可见文本、也没有 functionCall / inlineData（777–780 行），ST 会返回 `{ error: { message: '… Candidate text empty' } }`，可能在到达 `extractFinishState` 之前就按 API 错误抛出。这种「思考用尽、正文为空」在非流式原生 Gemini 上，补丁也未必能写到消息上（请求可能被当成失败）。流式路径通常仍能在最后一块看到 `MAX_TOKENS` 和 `usageMetadata`。此为已知风险。

## 经 OpenRouter 的 Gemini

ST 不把 OpenRouter 上的 Gemini 再走一遍 `sendMakerSuiteRequest`，而是走 OpenAI 兼容转发。此时：

- `finish_reason` 多为 `length` / `content_filter` / `stop` / `error`
- `native_finish_reason` 可能仍是 `MAX_TOKENS`、`SAFETY` 等
- 思考用量更常见于 `usage.completion_tokens_details.reasoning_tokens`，而不是 `thoughtsTokenCount`

`classify` 会同时看这两种 usage 形状，以及 `message.extra.reasoning`。

## 扩展应如何提示

`compat-contract.js` 的规则：

可见正文为空或很短（默认 ≤ 80 个字符），并且满足以下之一，则归为 `thinking_quota`（即使 raw 是 `length`、`MAX_TOKENS`、`stop` 或缺失）：

- `thoughtsTokenCount` 或 `reasoning_tokens` > 0，且（正文为空，或思考 tokens ≥ 可见输出 tokens）
- 或已有较长的 `extra.reasoning`（≥ 40），且正文为空或推理文本明显长于正文

`content_filter` / `recitation` / `refusal` 以及取消、网络、上下文过长等，不被思考额度覆盖。

中文提示方向（已写入约定，勿再改成恐吓语气）：

> 思考占用了生成额度。这一轮很多字数花在了模型的思考过程上，所以你看到的回复很短，或者几乎是空的。思考内容也会计入长度上限。可以调高回复长度上限后再点「继续」，或换一个不带思考的模型。

`action` 为 `'continue'`。
