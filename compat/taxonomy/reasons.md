# 结束原因分类表

机器可读副本：同目录 [reasons.json](reasons.json)，与根目录 [../compat-reasons.json](../compat-reasons.json) 内容相同。

实现请优先用 [../compat-contract.js](../compat-contract.js) 的 `classify(raw, context)`。JSON 加载器也可按 `rules[].match` 做不区分大小写的精确匹配；**思考额度（thinking_quota）依赖 context，仅 JS `classify` 能在 raw 为 length/stop/缺失时正确升级。**

## 函数约定

```
classify(raw, context?) -> { show, category, title, message, suggestion, action }
```

- 输入 `raw`：提供方原始结束原因（字符串或 `null`）。
- 输入 `context`（可选）：`{ message, mesId, ctx, usage, usageMetadata, reasoning, text }`。
- 输出 `category` 即下面的稳定 `id`；`title` / `message` / `suggestion` 为中文；英文在表的 `*_en` 字段。
- `action` 为 `"continue"` 或 `""`。
- `show === false`：不显示提示。用于正常 `stop` 和常规 `tool_calls`，避免给每条完整回复打标签。表中仍保留「模型正常结束」。
- 匹配顺序：先排除过滤/拒答等后，若 context 表明思考占用了额度则 `thinking_quota`；再按 `rules` 从上到下匹配 `match`；最后 `fallback`（`unknown`）。大小写不敏感。

## 分类一览

### `content_filter`

- 是否显示：是
- 视为截断：是
- 建议操作：无
- 原始值：`content_filter`, `SAFETY`, `PROHIBITED_CONTENT`, `BLOCKLIST`, `SPII`, `IMAGE_SAFETY`, `IMAGE_PROHIBITED_CONTENT`, `MODEL_ARMOR`, `content_policy_violation`, `HARM_CATEGORY`
- 中文标题：回复被内容过滤打断了
- 中文说明：服务提供方判定这段内容触发了安全或内容策略，所以生成停了。即使在 SillyTavern 里把安全选项关掉，对方仍可能拦截。
- 中文建议：可以换个说法再试，或换一个模型/渠道。不必反复点「继续」，同样的拦截可能还会出现。
- English title: The reply was stopped by a content filter
- English body: The provider stopped this reply because it triggered a safety or content policy. They can still block it even if SillyTavern safety settings are turned off.
- English suggestion: Try rephrasing, or switch models or providers. Pressing Continue may hit the same filter again.

### `recitation`

- 是否显示：是
- 视为截断：是
- 建议操作：`continue`
- 原始值：`RECITATION`, `IMAGE_RECITATION`
- 中文标题：回复因引用限制停了
- 中文说明：模型认为接下来的内容可能大段复述已有文本，所以提前结束了。
- 中文建议：可以换一种问法，或点「继续」看是否能换个角度写下去。
- English title: The reply stopped because of a recitation limit
- English body: The model stopped because the next part may have closely recapped existing text.
- English suggestion: Try asking in a different way, or press Continue to see if it can take another angle.

### `refusal`

- 是否显示：是
- 视为截断：否
- 建议操作：无
- 原始值：`refusal`
- 中文标题：模型拒绝了这次回复
- 中文说明：模型自己拒绝继续写下去，这和字数用完不是一回事。
- 中文建议：可以改写你的请求后再试，或换一个模型。
- English title: The model declined this reply
- English body: The model itself declined to continue. This is not the same as hitting a length limit.
- English suggestion: Try rephrasing your request, or switch to another model.

### `context_length`

- 是否显示：是
- 视为截断：否
- 建议操作：无
- 原始值：`context_length`, `prompt_too_long`, `ContextTooLong`, `context_length_exceeded`
- 中文标题：上下文太长了
- 中文说明：发给模型的内容超出了它的上下文长度，这一轮没能正常写完。
- 中文建议：可以减少世界书、总结更早的对话，或换一个上下文更长的模型。
- English title: The prompt was too long
- English body: The prompt exceeded the model's context length, so this turn could not finish normally.
- English suggestion: Trim World Info, summarize earlier chat, or switch to a model with a longer context window.

### `cancelled`

- 是否显示：是
- 视为截断：是
- 建议操作：`continue`
- 原始值：`cancelled`, `canceled`, `aborted`, `user_abort`
- 中文标题：生成已取消
- 中文说明：这次回复是中途取消的，所以可能不完整。
- 中文建议：如果需要完整回复，可以再生成一次，或在已有内容上点「继续」。
- English title: Generation was cancelled
- English body: This reply was cancelled partway through, so it may be incomplete.
- English suggestion: Generate again if you need a full reply, or press Continue on what is already there.

### `network`

- 是否显示：是
- 视为截断：是
- 建议操作：`continue`
- 原始值：`timeout`, `ECONNREFUSED`, `network`, `disconnected`, `ETIMEDOUT`, `ECONNRESET`
- 中文标题：连接中断了
- 中文说明：生成过程中网络或连接出了问题，回复可能不完整。
- 中文建议：检查网络后再试一次。如果已经有一段内容，也可以点「继续」。
- English title: The connection was interrupted
- English body: The connection dropped during generation, so the reply may be incomplete.
- English suggestion: Check your connection and try again. If some text already arrived, you can also press Continue.

### `provider_error`

- 是否显示：是
- 视为截断：否
- 建议操作：无
- 原始值：`error`, `OTHER`, `IMAGE_OTHER`, `server_error`, `MALFORMED_RESPONSE`, `NO_IMAGE`
- 中文标题：生成遇到了上游错误
- 中文说明：模型服务在这一轮返回了错误，所以回复可能不完整或没有内容。
- 中文建议：稍后再试，或换一个模型/渠道。
- English title: The provider returned an error
- English body: The model provider returned an error, so this reply may be incomplete or empty.
- English suggestion: Try again in a moment, or switch models or providers.

### `thinking_quota`

- 是否显示：是
- 视为截断：是
- 建议操作：`continue`
- 原始值：`thinking_quota`, `empty_reasoning`
- 中文标题：思考占用了生成额度
- 中文说明：这一轮很多字数花在了模型的思考过程上，所以你看到的回复很短，或者几乎是空的。思考内容也会计入长度上限。
- 中文建议：可以调高回复长度上限后再点「继续」，或换一个不带思考的模型。
- English title: Thinking used up the output budget
- English body: A large share of this turn's token budget went to the model's thinking, so the visible reply is short or almost empty. Thinking tokens count toward the length limit too.
- English suggestion: Raise the max token limit and press Continue, or switch to a non-thinking model.

### `truncated`

- 是否显示：是
- 视为截断：是
- 建议操作：`continue`
- 原始值：`length`, `max_tokens`, `MAX_TOKENS`, `CONTINUATION`
- 中文标题：回复被截断了
- 中文说明：达到了本次生成的长度上限。
- 中文建议：可以试着调高 max tokens，或点「继续」接着写。
- English title: The reply was cut off
- English body: This reply hit the maximum length set for this generation.
- English suggestion: Try raising max tokens, or press Continue to keep writing.

### `tool_calls`

- 是否显示：否
- 视为截断：否
- 建议操作：无
- 原始值：`tool_calls`, `function_call`, `tool_use`, `MALFORMED_FUNCTION_CALL`, `UNEXPECTED_TOOL_CALL`, `TOO_MANY_TOOL_CALLS`
- 中文标题：模型发起了工具调用
- 中文说明：这一轮停在工具调用上，通常会由 SillyTavern 继续处理，不必当作截断。
- 中文建议：无需特别处理。如果没有看到后续回复，再检查工具调用设置。
- English title: The model made a tool call
- English body: This turn stopped for a tool call. SillyTavern usually handles that next, so it is not a truncation.
- English suggestion: Usually nothing to do. If no follow-up reply appears, check your tool-calling settings.

### `stop`

- 是否显示：否
- 视为截断：否
- 建议操作：无
- 原始值：`stop`, `STOP`, `end_turn`, `stop_sequence`, `natural`
- 中文标题：模型正常结束
- 中文说明：这一轮已经正常写完了。
- 中文建议：无需特别处理。
- English title: The model finished normally
- English body: This turn finished normally.
- English suggestion: No action needed.

### `unknown`

- 是否显示：是
- 视为截断：否
- 建议操作：`continue`
- 原始值：`unknown`, `missing`, `FINISH_REASON_UNSPECIFIED`
- 中文标题：回复可能提前结束了
- 中文说明：没能读到明确的结束原因，所以无法判断是写完了、被截断，还是被过滤。
- 中文建议：如果句子看起来没写完，可以点「继续」，或调高长度上限后再试。
- English title: The reply may have ended early
- English body: No clear stop reason was available, so it is unclear whether the reply finished, was cut off, or was filtered.
- English suggestion: If the sentence looks unfinished, press Continue, or raise the length limit and try again.

`classify(null)` 以及原始值 `unknown` / `missing` / `FINISH_REASON_UNSPECIFIED` 都会落到这一类。这表示「一次生成的结束原因无法判断」，不是给角色开场白用的，也不是给「官方 ST 未打补丁、根本没有透传」用的。后两种情况由扩展策略处理，不要为了它们去改本分类的 `show`。

## MVP 覆盖

至少覆盖：长度上限（`truncated`）、内容过滤（`content_filter`）、模型正常结束（`stop`，不显示）、读不到原因（`unknown`）。思考额度、引用限制、取消等为同一张表上的扩展类。

