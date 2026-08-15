# sound-notify · DeepseekHarness 任务完成提示音插件

> 当 DeepseekHarness 完成一项工作时，自动播放一段提示音 —— 支持自定义音频池随机播放、音量调节、一键开关，所有设置与音频持久化保存。

**GitHub 仓库**：`ziphow/deepseekharness-audio-notifier`

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
![Version](https://img.shields.io/badge/version-1.2.0-blue)
![Platform](https://img.shields.io/badge/platform-DeepseekHarness-8b5cf6)

**Tags / Topics:** `deepseekharness` · `dsh-plugin` · `cordis-plugin` · `notification-sound` · `audio-notification` · `notification` · `productivity` · `web-audio`

推荐在 GitHub 仓库的 **Topics** 中填写：`deepseekharness, dsh-plugin, cordis-plugin, notification-sound, audio-notification, productivity`

---

## ✨ 功能特性

- 🔊 **任务完成自动提示**：主对话 Agent 完成一轮工作（回到 idle）时自动播放提示音
- 🎲 **音频池随机播放**：每次完成从音频池中随机选择一首播放
- 🎚️ **开关与音量**：一键开启/关闭，0–100% 音量实时生效
- 📁 **批量上传**：支持多选上传，常见格式 mp3 / wav / ogg / m4a / aac / flac / webm / wma
- 👂 **试听与删除**：音频池列表支持单条试听与删除
- 🧪 **测试随机播放**：设置页一键测试随机播放效果
- 💾 **持久化**：设置与音频池分别保存为工作目录下的 JSON 文件，插件重启后自动恢复
- 🔓 **自动播放解锁**：遵循浏览器自动播放策略，首次用户交互（点击/按键/打开设置页）即解锁；被拦截时弹出提示并在下次交互后自动补播
- 🎯 **提示范围可选**：仅主对话完成时提示，或包含子任务完成（2.5 秒防抖避免连环轰炸）
- 🧰 **自检工具**：注册只读工具 `sound_notify_status`，可随时查看插件运行状态

## 🏗️ 架构

插件分为两半，分别运行在两个运行时中：

| 半区 | 运行位置 | 职责 |
| ---- | -------- | ---- |
| `src/host.js` | DSH Node.js 进程 | 用 `fs` 服务把设置与音频池（base64 data URL）持久化到 JSON 文件；首次启动时读取工作目录中的默认提示音；提供包私有 RPC（`get-state` / `poll` / `get-audio` / `set-settings` / `upload` / `delete` / `rescan-default`）；注册 `sound_notify_status` 自检工具 |
| `src/client.js` | Web 页面（浏览器） | 订阅 `useSessions` 快照，检测会话 `running` 状态从"运行中 → 完成"的转换（任务完成信号）；在「设置 → 提示音」注册完整设置面板；在 `shell.overlay` 常驻隐藏 `<audio>` 播放器，任务完成时从音频池随机播放；处理自动播放解锁与拦截补播 |

数据流：会话列表实时流 → Client 检测 `running: true → false` → 随机取一首 → `get-audio` 拉取数据 → `<audio>` 播放。

> 设计说明：动态插件挂在 `cordis-dynamic` 独立 fiber 下，收不到 agent scope 冒泡的 `agent/status` 事件，因此在 Client 侧用会话列表快照（自带 `running` 状态与 `origin: 'subagent'` 标记）检测完成转换，既可靠又能按"提示范围"过滤子任务。

## 📦 安装与使用

### 1. 准备默认提示音（可选）

把默认提示音放到 **工作目录** 根下，命名为以下任一名字（按顺序查找）：

- `蔡徐坤——你干嘛_爱给网_aigei_com.mp3`（本仓库默认配置）
- `default-notify.mp3`
- `notification.mp3`

也可在 `src/host.js` 的 `DEFAULT_AUDIO_FILES` 中自行增改。首次启动时插件会自动把默认提示音载入音频池；工作目录中没有默认音频也不影响手动上传。

### 2. 安装插件

本插件是一个 DeepseekHarness **动态 Cordis 插件**。在 DSH 会话中：

1. 调用 `cordis_define`：`plugin.kind: "new"`，`idPrefix` 填 `sndfy`（或任意 3–6 位小写字母），把 `src/host.js` 的完整内容作为 `code.host`、`src/client.js` 的完整内容作为 `code.client`；
2. 对返回的 `pluginId` / `packageId` 调用 `cordis_run`（mode `run`）；
3. 首次运行需要在界面中 **批准**（在 run 卡片上允许）；
4. 打开左侧 **设置 → 提示音** 即可配置。

> 提示：`src/*.js` 的内容就是插件函数体（无 `import`、无 JSX），可以直接复制粘贴使用，无需任何构建步骤。

### 3. 配置

| 设置项 | 说明 |
| ------ | ---- |
| 开启提示音 | 总开关，关闭后任务完成不再播放 |
| 音量 | 0–100%，拖动即时生效并自动保存 |
| 提示范围 | `仅主对话完成时`（默认）/ `包含子任务完成` |
| 上传音频 | 多选上传，单文件 ≤ 8MB，池上限 60 个 / 64MB |
| 测试随机播放 | 随机播放一首，用于验证效果与解锁音频 |
| 重载默认提示音 | 重新读取工作目录中的默认音频文件 |
| 音频池列表 | 每条支持 **试听** 与 **删除** |

## 💾 持久化说明

- 设置：`<存储根>/.dsh-sound-notify.settings.json`
- 音频池（元数据 + base64 数据）：`<存储根>/.dsh-sound-notify.pool.json`

存储根按以下优先级选择（写入会逐个尝试直至成功，因此会自动落到文件系统后端允许写入的位置）：

1. 沙箱策略的 `workspaceRoot`（DSH `fs` 后端允许写入的根，通常能直接写入）；
2. 工作区注册表中的用户工作目录；
3. `src/host.js` 中的 `FALLBACK_WORKSPACE` 常量（部署后备值，请按需修改）。

默认提示音则会在上述所有候选根中依次查找（`DEFAULT_AUDIO_FILES` 列表）。可用自检工具 `sound_notify_status` 查看实际使用的 `workspace`、`settingsFile` 与 `poolFile` 路径。删除这两个 JSON 文件即可完全重置插件；若所有根都不可写，插件会降级为内存模式并在界面提示。

## 🔇 浏览器自动播放限制

浏览器通常禁止页面在"没有用户交互"的情况下自动播放声音。**完成检测本身是全局的**（基于会话列表实时流，与你在看哪个会话/标签无关），唯一的门槛是浏览器策略：

1. 用户在页面上任何一次点击/按键（包括打开设置面板、点击测试按钮、发送消息）都会解锁该页面的自动播放许可，此后任务完成时立即发声；
2. 若页面加载后完全零交互、且恰好此时任务完成，浏览器会拦截播放——插件会弹出**常驻提示**（"任务已完成：浏览器阻止了自动播放，点击页面任意位置即可播放提示音"），并在用户下一次点击/按键时**自动补播**被拦截的那段提示音；
3. 补播会尊重当前的开关设置（期间关闭提示音则不再补播）；设置面板底部会显示当前解锁状态。

这是浏览器强制策略下的最优兜底：只有"刚打开页面、零交互、恰好完成"这一种场景会延迟发声，其余情况都是完成即响。

## 🧰 自检与排障

- 调用工具 `sound_notify_status`（无需参数）可查看：开关/音量/范围设置、音频池元数据、持久化结果与最近错误；
- Host 侧日志带有 `[sound-notify]` 前缀（读取默认音频失败、写入失败等都会记录）；Client 侧可用浏览器控制台查看。

## 📁 项目结构

```
sound-notify/
├── README.md        # 本文件
├── LICENSE          # MIT
├── CHANGELOG.md     # 更新日志
└── src/
    ├── host.js      # Host 侧插件代码（持久化 / 完成检测 / RPC / 自检工具）
    └── client.js    # Client 侧插件代码（设置面板 / 播放器 / 自动播放解锁）
```

## ❓ FAQ

**Q：为什么任务完成后没有声音？**
A：依次检查 ① 设置页总开关是否开启；② 音频池是否为空（可用「测试随机播放」验证）；③ 页面是否尚未解锁自动播放（点击页面任意位置后重试）；④ 浏览器/系统音量。

**Q：上传后为什么提示“未能持久化到磁盘”？**
A：插件通过 DSH 的 `fs` 服务写文件，若当前会话文件策略为只读会导致写入失败。功能仍可在内存中生效，切换为可写工作区后重试即可。

**Q：如何更换部署的默认工作目录？**
A：修改 `src/host.js` 顶部的 `FALLBACK_WORKSPACE` 常量。

## ⚠️ 免责声明

本项目仅是我个人用于学习 DeepSeek Harness 插件开发的演示玩具（Demo），功能极其简单，且目前暂时不打算迭代。
项目按“现状（AS IS）”提供，不作任何明示或暗示的保证，包括但不限于适销性、特定用途适用性及无侵权等。
使用者因下载、安装或使用本插件所产生的任何风险与后果（包括但不限于数据丢失、系统故障、财产损失等）均由使用者自行承担，本人（项目作者）不承担任何法律责任及赔偿责任。

## 📄 许可证

[MIT](./LICENSE)
