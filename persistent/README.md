# sound-notify · 常驻版 preset（任务完成提示音）

这是 sound-notify 的**常驻版**：把它作为一个 agent preset 装进 DeepseekHarness，即可在任务完成时于**本机**随机播放提示音，**重启 DSH 也不会消失**（无需每次重装）。

> 与 `src/` 下"动态版"的区别：动态版带浏览器设置面板、但随进程消失；本目录是常驻版，无浏览器面板，改用 `sound_notify_config` 工具配置。

## 安装（给别人也这么装）

1. 把整个 `persistent/` 目录复制为 `${DSH_HOME}/.agent-presets/sound-notify/`：

   - Windows：`C:\Users\<你>\.dsh\.agent-presets\sound-notify\`
   - macOS/Linux：`~/.dsh/.agent-presets/sound-notify/`

   命令行示例（在仓库根目录执行）：

   ```bash
   # Windows (PowerShell)
   New-Item -ItemType Directory -Force "$env:USERPROFILE\.dsh\.agent-presets\sound-notify"
   Copy-Item -Recurse -Force persistent\* "$env:USERPROFILE\.dsh\.agent-presets\sound-notify"

   # macOS / Linux
   mkdir -p ~/.dsh/.agent-presets/sound-notify
   cp -R persistent/* ~/.dsh/.agent-presets/sound-notify/
   ```

2. 重启 DSH（或在预设选择器里）选择名为 **sound-notify** 的预设开始新会话。

3. 完成。任务完成时本机即会播放提示音。

## 配置（通过工具）

在新会话里对 Agent 说（或直接调用工具 `sound_notify_config`）：

| 想做的事 | 工具调用 |
| --- | --- |
| 查看状态 | `sound_notify_config` `{action: "status"}` |
| 开关 / 音量 / 范围 | `sound_notify_config` `{action:"set", enabled:false, volume:0.5, scope:"all"}` |
| 添加音频 | `sound_notify_config` `{action:"add-audio", file:"C:\\path\\to\\sound.mp3"}` |
| 列出音频 | `sound_notify_config` `{action:"list-audio"}` |
| 删除音频 | `sound_notify_config` `{action:"remove-audio", name:"sound.mp3"}` |

状态保存在 `${DSH_HOME}/sound-notify/state.json`，音频池在 `${DSH_HOME}/sound-notify/audio/`（首次启动会自动放入 `assets/default-notify.mp3`）。

## 平台支持

- **Windows**：WPF MediaPlayer（支持 mp3/wav 等，音量可调，无窗口）
- **macOS**：`afplay`
- **Linux**：`paplay`（需 pulseaudio）

## 目录说明

```
persistent/
├── agent.cordis.yml      # 完整 agent 组合（基于 standard）+ sound-notify 行
├── preset.yml            # 显示元数据
├── sound-notify.mjs      # 常驻模块（检测完成 + 本机播放 + 持久化 + 配置工具）
├── assets/default-notify.mp3  # 内置默认提示音
└── README.md             # 本文件
```
