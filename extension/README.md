# 断因（SillyTavern 扩展）

生成结束时读取 `finish_reason` / `finishReason`，在被截断的消息旁用中文说明为什么停了，并给出一句可执行建议。

## 本机安装（开发）

把**本目录**复制或符号链接到 SillyTavern 安装位置：

```
public/scripts/extensions/third-party/duanyin
```

目录里必须有 `manifest.json`。还需要按 [`../compat/INSTALL.md`](../compat/INSTALL.md) 给本机 SillyTavern **打上结束原因补丁**（官方 1.19.0 默认读不到结束原因）。重启 SillyTavern，在扩展菜单里启用「断因」。

这是本机开发安装方式，不是已发布扩展的安装渠道。面向用户的正式安装说明、许可证和截图位由 [`../compat`](../compat)（「断因·接口与兼容」）提供。

## 接口约定

原因分类和提示文案**不在本目录维护**。约定落地后，把下面任一文件放到本目录，扩展启动时加载：

- `compat-contract.js`：导出 `classify(raw, context)`，返回 `{ show, category, title, message, suggestion, action }`。`action` 为 `"continue"` 时显示「继续生成」按钮。`classify` 只解释结束原因：`classify(null)` 仍表示 unknown 兜底。要不要询问 classify、要不要展示兜底，由 `hint-policy.js` 决定。
- `compat-reasons.json`：一张可匹配原始结束原因的表。加载器对字段名做了宽松兼容（`rules` / `categories`、`title_zh` / `title`、`suggestion_zh` / `suggestion` 等），最终以约定格式为准。

未接入约定时，扩展不会显示自撰分类，设置里可以用「预览提示条」看样式。读到的原始结束原因会记在该条消息的 `extra.duanyin` 里。

角色开场白（`first_message`，以及没有生成证据的首条角色消息）不是一次生成，不会出现「回复可能提前结束了」，也不会出现「继续生成」。

官方未打补丁的 SillyTavern 上，不会在每条消息旁用 unknown 兜底刷屏。设置面板会显示一条提醒，说明需要先打补丁，否则断因无法判断回复为什么结束。只有在透传可用、且这是一次真正的生成、但这一轮没有读到原因时，才会调用 `classify(null)` 显示兜底提示。若消息上已经有结束原因（例如手改了 `extra.finish_reason`，或未来官方自行写入），即使探测为未打补丁也会照常分类并显示。

## 设置

- **启用提示**：总开关。
- **预览提示条**：只展示样式，文案不是正式分类。
- **补丁提醒**：未探测到结束原因透传时出现在本面板，打上补丁后会自动消失。这不是每条消息上的提示。
