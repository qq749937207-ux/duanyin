# 最小补丁说明（SillyTavern 1.19.0）

文件：`sillytavern-1.19.0-finish-reason.patch`

针对所检标签 **1.19.0**（`7e8663cd9c184a550b37238218bdd32c6efc68e9`）。`release` 分支 HEAD `06bde939` 在这三个业务文件上与标签完全相同，可直接应用。

## 做什么

把 Chat Completion 已经收到、但未被保存的结束原因和 usage，写到 `chat[mesId].extra`，供扩展在现有事件里读取。不改核心 UI，不弹 toast，不重构流式栈。

这覆盖了 Issue #6161 里「把原因记下来并在非流式 Gemini 包装里带上」的数据部分，把展示交给断因扩展。

## 如何应用

```bash
cd /path/to/SillyTavern
git checkout 1.19.0
patch -p1 < data/default-user/extensions/duanyin/compat/patches/sillytavern-1.19.0-finish-reason.patch
```

重启 SillyTavern。可用 `patch -p1 --dry-run < …` 预演。

## 改了哪里（为何算最小）

1. **`src/endpoints/backends/chat-completions.js`**
   - `sendMakerSuiteRequest` 非流式包装增加 `choices[0].finish_reason` / `native_finish_reason`、`usageMetadata`、`promptFeedback`。
   - `sendClaudeRequest` 非流式包装增加 `stop_reason` → `finish_reason` 和 `usage`。
   - 流式 Gemini / OpenRouter / OpenAI 本来就是原样转发，后端不用改。

2. **`public/scripts/openai.js`**
   - 新增并导出 `extractFinishState`、`applyFinishStateToExtra`。
   - 流式循环把每块里的 finish / usage 合并进现有 `state`（最后一块通常带结束原因）。

3. **`public/script.js`**
   - 非流式 `onSuccess` 从完整 `data` 取出 finish state，经 `saveReply` 在 `MESSAGE_RECEIVED` **之前**写入 `extra`。
   - 流式在 `finalizeIntermediaryMessage` 开头写入 `extra`，早于 `onProgressStreaming(isFinal)` 对 `swipe_info.extra` 的克隆，也早于可能触发 `GENERATION_ENDED` 的 `markUIGenStopped()`。
   - 用户中止且没有提供方原因时，写入 `finish_reason: 'cancelled'`。

不新增事件名，不改请求体，不改默认采样或安全设置。

## 风险与边界

| 场景 | 行为 |
| --- | --- |
| 流式 vs 非流式 | 两条路径都会写 `extra`。流式依赖最后一块或带 `finishReason` 的块；若上游从不给出该字段，则不会写（扩展侧可对 `null` 走 `unknown`）。 |
| 多 swipe（`n > 1`） | ST 对非主 swipe 的 `state.reasoning` 已有 FIXME（不按 swipe 分数组）。本补丁同样把 **主 choice（index 0）** 的原因写到当前消息 `extra`。并行生成的其它 swipe 不一定有各自的原因。 |
| Continue / Regenerate | 以**这一轮**的原因为准覆盖 `extra.finish_reason`，并随 `swipe_info[swipe_id].extra` 一起保存。 |
| 群聊 | 仍写在该条角色消息的 `extra` 上（与现有 `extra.gen_id` 并列），不写入聊天全局 metadata。 |
| 用户取消 | 可能走 `GENERATION_STOPPED`；若 `finalize` 或 `onErrorStreaming` 跑到，会尝试写 `cancelled`。竞态下偶发写不上时，扩展应同时听 `GENERATION_STOPPED`。 |
| 非流式 Gemini 空正文 | ST 可能在包装前就把「Candidate text empty」当成 error 返回，这一轮不一定会落到带 extra 的消息上。见 [../docs/gemini-thinking.md](../docs/gemini-thinking.md)。 |
| `quiet` / impersonate | 不面向角色消息提示条。`quiet` 不走会显示的 `saveReply` 提示路径。 |
| `staging` / 未来版本 | 2026-10-03 的 staging 在这三个文件上只有无关差异，通常可打上或略调偏移。以后官方若已实现类似透传，请先检查是否冲突，不要重复写入不同字段名而不文档化。 |

## 回滚

```bash
cd /path/to/SillyTavern
patch -p1 -R < data/default-user/extensions/duanyin/compat/patches/sillytavern-1.19.0-finish-reason.patch
```

或对这三个文件执行 `git checkout --`。
