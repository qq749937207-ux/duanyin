# 断因

SillyTavern 扩展：生成结束时读取结束原因，在需要说明的消息旁用中文告诉你为什么停了，并给出一句可执行建议。

当前版本：**0.1.1**。已在 SillyTavern **1.19.0** 上，用 Gemini 3.8 Flash（OpenRouter，流式输出）做过真实生成测试。

## 能做什么

- **正常写完**：旁边不会出提示，不打扰你。
- **回复被截断了**：达到了这次生成的长度上限，可以点「继续生成」。
- **思考占用了生成额度**：很多字数花在了模型的思考过程上，你看到的正文很短，或者几乎是空的。
- **回复被内容过滤打断了**：服务提供方拦截了这段内容。
- 角色自带的**开场白不是一次生成**，不会误报「回复可能提前结束了」。

许可为 MIT，见 [LICENSE](LICENSE)。本扩展不读取、也不需要你的 API 密钥。

## 安装（两步都要做）

官方 SillyTavern 1.19.0 **不会**把结束原因交给扩展。只装扩展、不打补丁的话，断因无法判断回复为什么结束；这时它**不会**在每条消息旁误报，只会在扩展设置里提醒你需要打补丁。

### 第一步：安装扩展

1. 打开 SillyTavern，进入扩展菜单。
2. 选择安装第三方扩展，填入本仓库地址：

   `https://github.com/qq749937207-ux/duanyin`

3. 安装完成后，启用「断因」。

### 第二步：给 SillyTavern 打补丁

在你的 **SillyTavern 安装目录**里执行（建议先确认当前是 1.19.0，或先备份）：

```bash
cd /path/to/SillyTavern
patch -p1 --dry-run < data/default-user/extensions/duanyin/compat/patches/sillytavern-1.19.0-finish-reason.patch
patch -p1 < data/default-user/extensions/duanyin/compat/patches/sillytavern-1.19.0-finish-reason.patch
```

说明：

- 若你的用户目录不是 `default-user`，把路径里的这一段换成你自己的用户名。
- 如果安装时勾选了全局（管理员）安装，补丁文件在 `public/scripts/extensions/third-party/duanyin/compat/patches/` 下。
- 可以先 `--dry-run` 看会不会冲突，再真正打上。打完后**重启** SillyTavern。
- 补丁成功后，断因设置里不应再出现「还没有打结束原因补丁」的提醒。
- Windows 上可在 Git Bash 里运行上述命令；也可用 `git apply`。更详细的说明、改动文件和回滚方法见 [compat/patches/README.md](compat/patches/README.md)。

开发者本地安装、字段约定和分类表见 [compat/INSTALL.md](compat/INSTALL.md)。

## 提示什么时候会出现

只有**真正的模型生成**结束、并且读到了结束原因（或在已打补丁的情况下确实读不到原因）时，才会在该条消息旁出现提示。正常结束不会出条。

## 仓库结构

- [`extension/`](extension/)：扩展的界面、钩子和提示策略。
- [`compat/`](compat/)：结束原因分类约定、SillyTavern 1.19.0 最小补丁和说明文档。

仓库根目录的 `manifest.json` 是给 SillyTavern「安装扩展」用的（`js` / `css` 指向 `extension/`）。如果只是把 `extension/` 目录单独拷过去，请使用那个目录里的 `manifest.json`。
