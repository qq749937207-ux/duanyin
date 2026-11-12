# 断因 · 接口与兼容

这份目录给「断因」SillyTavern 扩展工程师使用：说明当前官方 ST **能不能**读到 `finish_reason` / `finishReason`，给出可直接加载的分类约定，并在需要时提供针对所检版本的最小补丁。

断因是一个独立的 SillyTavern 扩展玩具项目。

**结论（针对下方所检版本）：扩展今天不能从官方钩子稳定读到结束原因。** 流式路径会丢掉字段；非流式 OpenAI 兼容响应虽然到达前端，但不会写入消息对象或事件载荷。Google AI Studio / Vertex 的非流式路径在后端包装时就会丢掉 `finishReason`。请先打最小补丁，再按 [docs/hooks-and-paths.md](docs/hooks-and-paths.md) 读取 `message.extra.finish_reason`。

## 给扩展工程师的约定文件

可直接放到扩展目录（已同步一份到 `../extension/`，未改其 `index.js` / CSS / manifest）：

| 文件 | 作用 |
| --- | --- |
| [compat-contract.js](compat-contract.js) | ES 模块，导出 `classify(raw, context)`、`rules` / `categories`、`fallback` |
| [compat-reasons.json](compat-reasons.json) | 同一张机器可读分类表 |

`classify` 返回 `{ show, category, title, message, suggestion, action }`。中文文案给 ST 扩展用；英文在 JSON 表里。`show === false` 时不要显示提示（正常 `stop`、常规 `tool_calls`）。`action === 'continue'` 时显示「继续生成」。

## 所检 SillyTavern 版本

| 项 | 值 |
| --- | --- |
| 仓库 | https://github.com/SillyTavern/SillyTavern |
| 默认分支 | `release` |
| 最新稳定标签 | **1.19.0**（`7e8663cd9c184a550b37238218bdd32c6efc68e9`，2026-09-14 19:55:46 +02:00） |
| `release` HEAD | `06bde939fb1e9c4c8d8641d810f0a916b5bce127`（仅 `.github/workflows/npm-publish.yml` 相对 1.19.0 有改动，业务源码一致） |
| `package.json` version | `1.19.0` |
| `staging` 对照 | `ad29cbda62e92f145e44d7a10398a38af22ca986`（2026-10-03）。这三个待补丁文件只有模型默认值等无关改动，**同样没有**读取 `finish_reason` |
| 上游需求 | [Issue #6161](https://github.com/SillyTavern/SillyTavern/issues/6161)（open，截至调查时无合并实现） |

调查日期：2026-11-12（Asia/Shanghai）。所有 ST 行为判断均来自上述源码，不是二手评测。

## 如何使用

1. 阅读 [docs/passthrough.md](docs/passthrough.md) 了解透传结论与路径追踪。
2. 把 `compat-contract.js` 和 `compat-reasons.json` 放进扩展目录（若使用 `../extension` 骨架，已经放好）。
3. **要真正读到原因，请先按 [INSTALL.md](INSTALL.md) 给 ST 打补丁**，然后按 [docs/hooks-and-paths.md](docs/hooks-and-paths.md) 从 `chat[mesId].extra.finish_reason` 取值。
4. Gemini 思考模型额度问题见 [docs/gemini-thinking.md](docs/gemini-thinking.md)。
5. 分类说明见 [taxonomy/reasons.md](taxonomy/reasons.md)。

设置开关和扩展安装布局由扩展工程师负责；本目录只提供分类、钩子路径和补丁。

## 安装 / 应用补丁

见 [INSTALL.md](INSTALL.md) 与 [patches/README.md](patches/README.md)。补丁文件：

- [patches/sillytavern-1.19.0-finish-reason.patch](patches/sillytavern-1.19.0-finish-reason.patch)

官方 1.19.0 需要先打补丁才能稳定读到结束原因。未打补丁时，扩展不会在每条消息旁用 unknown 兜底刷屏，而是在设置里提醒一次需要打补丁。角色开场白会被排除。`classify(null)` 仍然表示 unknown 兜底，但只应在透传可用、且这是一次真正的生成、却读不到原因时调用。详见 [INSTALL.md](INSTALL.md) 第 6 节与 [docs/hooks-and-paths.md](docs/hooks-and-paths.md)。

## 截图

界面示意见仓库根目录 [README.md](../README.md)。本目录 `screenshots/` 下若仍有占位文件，只作开发记录，不是发布截图。

## 目录

```
compat/
  README.md
  LICENSE
  INSTALL.md
  compat-contract.js
  compat-reasons.json
  docs/passthrough.md
  docs/hooks-and-paths.md
  docs/gemini-thinking.md
  taxonomy/reasons.json
  taxonomy/reasons.md
  patches/
  screenshots/
```

## 许可

MIT，版权归属项目「断因」，2026。
