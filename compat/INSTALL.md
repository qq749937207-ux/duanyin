# 安装说明

本说明面向本机开发者和想把安装细节看完整的人。面向使用者的安装步骤见仓库根目录 [README.md](../README.md)：在 SillyTavern 扩展菜单里用 GitHub 地址安装，再给本机 SillyTavern 打上本目录的最小补丁。

## 1. 接入分类约定（不改扩展业务代码）

把下面两个文件放到扩展目录（与 `manifest.json`、`index.js` 同级）：

- `compat-contract.js`
- `compat-reasons.json`

扩展启动时会优先 `import('./compat-contract.js')`，要求存在命名导出 `classify`。加载器还会读取 `rules` 或 `categories` 以打印条数。若 JS 不存在，再尝试 `compat-reasons.json`。

若使用仓库里的 `../extension` 骨架，这两个文件已经复制过去，无需改 `index.js` / CSS / manifest。

`classify(raw, context)` 的约定见 [docs/hooks-and-paths.md](docs/hooks-and-paths.md) 与 [taxonomy/reasons.md](taxonomy/reasons.md)。

## 2. 为什么还要打 ST 补丁

在官方 SillyTavern **1.19.0**（以及同时检查的 `release` / `staging` 源码）中，扩展**不能**从事件载荷或 `message.extra` 读到结束原因。详情见 [docs/passthrough.md](docs/passthrough.md)。

因此：只放入约定文件还不够。官方 1.19.0 需要先打本目录的最小补丁，扩展才能从 `message.extra` 读到结束原因。未打补丁时，扩展**不会**在每条消息旁用 unknown 兜底刷屏，而是在设置面板里提醒一次需要打补丁。角色开场白本来就不是一次生成，也不会出现这条兜底提示。

最小补丁做一件事：把提供方的 `finish_reason` / `finishReason` / `native_finish_reason` / `blockReason` 和 usage 写到**扩展已经能读的** `chat[mesId].extra` 上，并在 `MESSAGE_RECEIVED` / `CHARACTER_MESSAGE_RENDERED` / `GENERATION_ENDED` 触发前写好。

## 3. 给 SillyTavern 打补丁

补丁针对：

- 标签 `1.19.0`（提交 `7e8663cd9c184a550b37238218bdd32c6efc68e9`）
- 等价于 `release` 分支 HEAD `06bde939fb1e9c4c8d8641d810f0a916b5bce127` 的业务源码（该提交只改了 npm 发布工作流）

```bash
cd /path/to/SillyTavern
git checkout 1.19.0   # 或确认业务源码与 1.19.0 相同
patch -p1 < /path/to/duanyin/compat/patches/sillytavern-1.19.0-finish-reason.patch
```

改动的三个文件：

- `src/endpoints/backends/chat-completions.js`（非流式 Gemini / Claude 包装时带上结束原因和 usage）
- `public/scripts/openai.js`（流式循环收集原因；导出 `extractFinishState` / `applyFinishStateToExtra`）
- `public/script.js`（写入 `message.extra`，再发扩展事件）

打完后重启 SillyTavern。应用说明、冲突与风险见 [patches/README.md](patches/README.md)。

`staging`（`ad29cbda`，2026-10-03）在这三个文件上只有模型默认值等无关差异，一般可手工打上或小幅偏移后应用。若无法干净应用，不要强行合并，先对照 [docs/passthrough.md](docs/passthrough.md) 在同样三个位置补那几行。

## 4. 把扩展装进 SillyTavern

**推荐（已发布仓库）：** 在 SillyTavern 扩展菜单里安装第三方扩展，地址为 `https://github.com/qq749937207-ux/duanyin`。仓库根目录的 `manifest.json` 会把 `js` / `css` 指到 `extension/`。装完后启用「断因」，并按第 3 节打补丁。

**本机开发：** 也可以把 `extension/` 目录复制或符号链接为：

```
public/scripts/extensions/third-party/duanyin
```

（或用户目录 `data/<用户名>/extensions/duanyin`。）该目录内必须有 `manifest.json`。重启 ST，在扩展菜单启用「断因」。开发期若符号链接的是整个仓库而不是 `extension/`，请使用根目录的 `manifest.json`。

## 5. 读字段（打补丁之后）

优先读取：

```text
chat[mesId].extra.finish_reason
chat[mesId].extra.native_finish_reason   # 可选，OpenRouter / Gemini 原生值
chat[mesId].extra.block_reason           # 可选，Gemini promptFeedback.blockReason
chat[mesId].extra.usage                  # 可选，思考额度判断
```

推荐在 `MESSAGE_RECEIVED` 或 `CHARACTER_MESSAGE_RENDERED`（载荷为消息下标 `mesId`）里读取。注意：`GENERATION_ENDED` 的载荷是 `chat.length`（消息**条数**），不是下标。完整说明见 [docs/hooks-and-paths.md](docs/hooks-and-paths.md)。

## 6. 读不到原因时的兜底

`compat-contract.js` 的 `classify(null, context)` 会返回 `unknown` 兜底（`show: true`）。`classify` 只解释结束原因，不要让它同时承担「这是不是一次生成」或「补丁有没有打上」的判断。

扩展侧由 `hint-policy.js` 决定要不要询问 `classify`：

- 角色开场白（事件 `type === 'first_message'`，或消息上没有生成证据）不是一次生成，不调用 `classify(null)`，不显示「回复可能提前结束了」。
- 官方未打补丁、透传不可用时，不在每条消息旁显示 unknown 兜底；设置面板会提醒需要先打补丁。
- 只有在透传可用（探测到补丁导出，或本会话已在消息上看到官方结束原因字段），并且这是一次真正的生成，但这一轮没有/是未知原因时，才调用 `classify(null)` 显示兜底。若消息上已经有 `finish_reason`（手改或未来官方自行写入），即使探测为未打补丁也会照常分类。
