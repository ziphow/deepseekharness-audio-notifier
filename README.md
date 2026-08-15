# sound-notify · DeepseekHarness 任务完成提示音插件

> 当 DeepseekHarness（DSH）完成一项工作时，自动播放一段提示音 —— 支持自定义音频、音量调节、一键开关，设置永久保存。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
![Version](https://img.shields.io/badge/version-1.5.1-blue)
![Platform](https://img.shields.io/badge/platform-DeepseekHarness-8b5cf6)

**一句话**：DeepseekHarness干完活儿会发出"哎哟~你干嘛~"的声音，不用再盯着屏幕干等，支持上传自定义音频，随机播放。
	       欢迎各位小黑子体验

---

## ✨ 它能做什么

- 🔊 **干完自动响**：DSH 完成一轮工作时自动播放提示音
- 🎁 **开箱即用**：自带默认提示音，不用准备任何文件
- 🎲 **音频池随机播**：放多段音频，每次随机选一首
- 🎚️ **开关 + 音量**：一键开关，0–100% 实时调
- 📁 **批量上传**：mp3 / wav / ogg / m4a 等常见格式，多选上传
- 👂 **试听 + 删除**：音频池列表可单条试听、删除
- 💾 **永久保存**：设置和音频重启后自动恢复
- 🎯 **范围可选**：只在主任务完成时响，或子任务完成也响

---

## 📋 前置条件

- ✅ 已安装 **DeepseekHarness（DSH）** 并能正常开会话
- ✅ （可选）**Node.js 18+**：仅当你想用一键脚本 `install.mjs` 时才需要；直接复制安装指令则不需要

---

## ⚡ 30 秒快速开始

> 最简单的路径：把一句话发给 DSH，点允许，去设置里开声音。

**第 1 步** · 复制下面这段话：

```
请安装插件 sound-notify：读取 https://github.com/ziphow/deepseekharness-audio-notifier 仓库中的 src/host.js 和 src/client.js，用 cordis_define（idPrefix=sndfy）定义、cordis_run 运行，完成后提醒我去 设置 → 提示音 配置。
```

**第 2 步** · 粘贴到任意一个 DSH 会话里发送，等它安装。界面弹出审批时点 **允许**。

**第 3 步** · 打开左侧 **设置 → 提示音**，确认开关已开启。下次 DSH 干完活儿就会响。

> 默认提示音已内置，无需任何文件。如果没响，看下面的「常见问题」。

---

## 🤔 选哪个版本？

本插件有两种安装方式，按你的需求选一个：

| | 动态版（新手推荐） | 常驻版（重启不消失） |
|---|---|---|
| **安装难度** | ⭐ 复制一句话即可 | ⭐⭐⭐ 需命令行复制目录 |
| **配置方式** | 图形设置面板 | 工具命令 |
| **重启 DSH 后** | ❌ 需重新安装 | ✅ 自动保留 |
| **声音在哪响** | 浏览器页面内 | 本机系统 |
| **适合谁** | 想快速上手、先试试 | 想长期用、不怕命令行 |

- 想快速试试 → 用下面的「方式一：动态版」
- 想一劳永逸 → 用下面的「方式二：常驻版」

---

## 📖 安装详解

### 方式一：动态版

这就是上面「30 秒快速开始」的方法。除了复制那句话，还有几个可选操作。

#### 一键生成安装指令（可选）

如果不想手动复制，用仓库自带的脚本生成指令（需 Node.js）：

```bash
node install.mjs            # 打印安装指令
node install.mjs --copy     # 打印并复制到剪贴板，直接粘贴给 DSH
node install.mjs --offline  # 无网络自包含版（把源码内联进指令）
```

或：`npm run install-prompt`

#### 换默认提示音（可选）

默认提示音已内嵌，想换成自己的声音，二选一：

- **临时覆盖**：把 `default-notify.mp3` 放到 DSH 工作目录根下，设置面板点「重载默认提示音」
- **重新内嵌**：`node scripts/embed-audio.mjs 你的音频.mp3`（可反复换；不带参数则用仓库内置默认音 `persistent/assets/default-notify.mp3`）

#### 配置项

打开 **设置 → 提示音**：

| 设置项 | 说明 |
| ------ | ---- |
| 开启提示音 | 总开关 |
| 音量 | 0–100%，拖动即时生效 |
| 提示范围 | 仅主对话（默认）/ 包含子任务 |
| 上传音频 | 多选，单文件 ≤ 8MB，池上限 60 个 / 64MB |
| 测试随机播放 | 随机播一首，验证效果 |
| 重载默认提示音 | 重新读工作目录里的默认音频 |
| 音频池列表 | 每条可试听、删除 |

#### 手动安装（进阶，无需联网）

会话无法联网时，用 `node install.mjs --offline` 生成含源码的指令；或手动：

1. 把 `src/host.js` 全文作为 `code.host`、`src/client.js` 全文作为 `code.client`；
2. 调 `cordis_define`（`plugin.kind:"new"`、`idPrefix:"sndfy"`）；
3. 用返回的 `pluginId` / `packageId` 调 `cordis_run`（mode `run`）；
4. 审批通过后，打开 **设置 → 提示音**。

> `src/*.js` 是纯 JS 函数体（无 `import`、无 JSX），可直接复制，无需构建。

---

### 方式二：常驻版（重启不消失）

把 `persistent/` 目录装成 DSH 的预设，之后重启 DSH 也不会消失，声音在本机系统播放。

**第 1 步** · 把 `persistent/` 整个复制到 DSH 的预设目录：

```bash
# Windows (PowerShell)
New-Item -ItemType Directory -Force "$env:USERPROFILE\.dsh\.agent-presets\sound-notify"
Copy-Item -Recurse -Force persistent\* "$env:USERPROFILE\.dsh\.agent-presets\sound-notify"

# macOS / Linux
mkdir -p ~/.dsh/.agent-presets/sound-notify
cp -R persistent/* ~/.dsh/.agent-presets/sound-notify/
```

**第 2 步** · 重启 DSH，在预设选择器里选 **sound-notify** 开新会话。

**第 3 步** · 配置（对 Agent 说，或直接调工具 `sound_notify_config`）：

| 想做的事 | 工具调用 |
| --- | --- |
| 查看状态 | `sound_notify_config` `{action:"status"}` |
| 开关 / 音量 / 范围 | `sound_notify_config` `{action:"set", enabled:false, volume:0.5, scope:"all"}` |
| 添加音频 | `sound_notify_config` `{action:"add-audio", file:"C:\\路径\\sound.mp3"}` |
| 列出音频 | `sound_notify_config` `{action:"list-audio"}` |
| 删除音频 | `sound_notify_config` `{action:"remove-audio", name:"sound.mp3"}` |

**平台支持**：Windows（系统自带）、macOS（`afplay` 自带）、Linux（需 `paplay` / PulseAudio）。

更多见 [`persistent/README.md`](./persistent/README.md)。

---

## ❓ 常见问题

**Q：任务完成后没声音？**
按顺序检查：① 设置里总开关是否开启；② 音频池是否为空（点「测试随机播放」验证）；③ 页面是否还没解锁自动播放（点一下页面任意位置再试）；④ 浏览器/系统是否静音。

**Q：第一次为什么可能不响？**
浏览器禁止"零交互就发声"。你在页面上点过任何一下（发消息、开设置、点测试）就解锁了，之后完成即响。若零交互时恰好完成，会弹提示，下次点击自动补播。

**Q：上传后提示"未能持久化到磁盘"？**
当前会话文件策略可能是只读。功能仍可在内存中用，切换到可写工作区后重试。

**Q：动态版重启 DSH 后没了？**
动态版随进程消失，重启需重新安装。想一劳永逸用「方式二：常驻版」。

**Q：如何换默认工作目录？**
`FALLBACK_WORKSPACE` 默认是 `process.cwd()`，通用且通常不用改。要固定目录可改 `src/host.js` 顶部该常量。

---

## 🔧 进阶说明

> 了解原理或排障

### 🏗️ 架构

插件分两部分，分别运行在两个环境里：

| 部分 | 运行在 | 干什么 |
| ---- | ------ | ---- |
| `src/host.js` | DSH 的 Node.js 进程 | 持久化设置与音频池到 JSON；读取默认提示音；提供 RPC；注册自检工具 |
| `src/client.js` | DSH 的 Web 页面 | 检测任务完成（会话 running 状态变化）；注册设置面板；播放音频；处理自动播放解锁 |

数据流：会话状态变完成 → Client 检测到 → 随机取一首 → 拉取音频 → 播放。

> 设计说明：动态插件挂在 `cordis-dynamic` 独立 fiber 下，收不到 agent scope 冒泡的 `agent/status` 事件，因此在 Client 侧用会话列表快照（自带 `running` 状态与 `origin: 'subagent'` 标记）检测完成转换，既可靠又能按"提示范围"过滤子任务。

### 💾 持久化

- 设置：`<存储根>/.dsh-sound-notify.settings.json`
- 音频池：`<存储根>/.dsh-sound-notify.pool.json`

存储根按优先级选择（写入会逐个尝试直至成功）：① 沙箱策略 `workspaceRoot`（DSH `fs` 后端允许写入的根）→ ② 工作区注册表中的用户工作目录 → ③ `FALLBACK_WORKSPACE` 常量（默认 `process.cwd()`，通用，通常无需修改）。

默认提示音会在上述所有候选根中依次查找。可用自检工具 `sound_notify_status` 查看实际使用的 `workspace`、`settingsFile` 与 `poolFile` 路径。删除这两个 JSON 文件即可完全重置插件；若所有根都不可写，插件会降级为内存模式并在界面提示。

### 🔇 浏览器自动播放限制

浏览器通常禁止页面在"没有用户交互"的情况下自动播放声音。完成检测本身是全局的，唯一门槛是浏览器策略：

1. 用户在页面上任何一次点击/按键（发消息、开设置、点测试）都会解锁自动播放，此后完成即响；
2. 若页面加载后完全零交互、恰好此时任务完成，浏览器会拦截播放——插件会弹出常驻提示，并在下次点击/按键时自动补播被拦截的那段；
3. 补播会尊重当前开关设置；设置面板底部会显示当前解锁状态。

只有"刚打开页面、零交互、恰好完成"这一种场景会延迟发声，其余情况都是完成即响。

### 🧰 自检与排障

- 调用工具 `sound_notify_status`（无需参数）可查看：开关/音量/范围设置、音频池元数据、持久化结果与最近错误；
- Host 侧日志带 `[sound-notify]` 前缀；Client 侧用浏览器控制台查看。

### 📁 项目结构

```
sound-notify/
├── README.md            # 本文件
├── LICENSE              # MIT
├── CHANGELOG.md         # 更新日志
├── package.json         # npm 元数据
├── install.mjs          # 一键生成安装指令
├── scripts/
│   └── embed-audio.mjs  # 内嵌/更换默认音频
├── persistent/          # 常驻版（重启不消失）
│   ├── agent.cordis.yml # 预设组合
│   ├── preset.yml       # 显示元数据
│   ├── sound-notify.mjs # 常驻模块
│   ├── assets/default-notify.mp3
│   └── README.md
└── src/                 # 动态版（带设置面板）
    ├── host.js          # Host 侧
    └── client.js        # Client 侧
```

---

## ⚠️ 免责声明

本项目仅是我个人用于学习 DeepSeek Harness 插件开发的演示玩具（Demo），功能极其简单，且目前暂时不打算迭代。
项目按"现状（AS IS）"提供，不作任何明示或暗示的保证，包括但不限于适销性、特定用途适用性及无侵权等。
使用者因下载、安装或使用本插件所产生的任何风险与后果（包括但不限于数据丢失、系统故障、财产损失等）均由使用者自行承担，本人（项目作者）不承担任何法律责任及赔偿责任。

## 📄 许可证

[MIT](./LICENSE)
