# Changelog

本项目的所有重要变更都会记录在此文件中。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [1.5.1] - 2026-08-15

### Fixed

- `src/host.js` 的 `FALLBACK_WORKSPACE` 由硬编码的本机路径改为 `process.cwd()`：他人复现时不再依赖作者本地目录，作为存储根的最后兜底通用可用（正常情况下优先使用沙箱 `workspaceRoot` 与工作区注册表，兜底通常不触发）。
- `scripts/embed-audio.mjs` 修复无法重复内嵌的问题：旧正则只匹配已被替换掉的占位符 `__SOUND_NOTIFY_EMBED_B64__`，导致首次内嵌后无法再换音频；现改为匹配已内嵌的真实 data URL，支持反复重新内嵌不同音频。
- `scripts/embed-audio.mjs` 默认音频路径由不存在的 `../../default-notify.mp3` 修正为仓库内置的 `persistent/assets/default-notify.mp3`，不带参数即可重新内嵌默认提示音。

## [1.5.0] - 2025-01-16

### Added

- `persistent/` 常驻版 preset：作为 agent preset 安装，重启不消失；任务完成时在本机播放随机提示音（Windows 用 WPF MediaPlayer，macOS 用 afplay，Linux 用 paplay）。
- 常驻版配置工具 `sound_notify_config`（status / set / add-audio / remove-audio / list-audio）。
- 常驻版音频池与状态持久化到 `${DSH_HOME}/sound-notify/`（无需 base64，音频为文件）。

## [1.4.0] - 2025-01-16

### Added

- 内置默认提示音：默认音频以 base64 内嵌进 `src/host.js`，开箱即用；工作目录放置 `default-notify.mp3` 可覆盖。
- `scripts/embed-audio.mjs`：把任意音频重新内嵌进插件。
- `install.mjs`：一键生成 DSH 安装指令（含剪贴板复制、无网络自包含版）。

### Changed

- README 重写：新增「快速上手（一键安装）」「换默认提示音」与清晰的安装命令。
- `package.json` 增加 `install-prompt` / `embed-audio` 脚本，完善 keywords 与 files。

## [1.2.0] - 2025-01-16

### Changed

- 自动播放被拦截时改为**常驻提示**（不再 6 秒自动消失），明确告知用户"任务已完成、点击页面任意位置即可播放"，播放成功后自动收起。
- 补播尊重开关设置：等待补播期间关闭提示音则丢弃待播内容，不再补播。

## [1.1.3] - 2025-01-16

### Fixed

- 恢复存储根优先级（沙箱策略 `workspaceRoot` 优先），并让写入在全部候选根中逐个尝试直至成功：修复在部分部署中用户工作目录位于 fs 后端写入根之外导致持久化被拒绝的问题。

## [1.1.2] - 2025-01-16

### Changed

- 启动时执行一次设置写入自检，使自检工具中的 `persisted` 语义准确，并能尽早暴露磁盘不可写。
- 存储根候选增加工作区注册表中的用户工作目录。

## [1.1.1] - 2025-01-16

### Fixed

- 修复 `useSessions` 必须传入选择器函数导致的 `shell.overlay` 渲染崩溃（传入恒等选择器取完整快照）。

## [1.1.0] - 2025-01-16

### Changed

- **任务完成检测改为 Client 侧实现**：动态插件挂载在 `cordis-dynamic` 独立 fiber 下收不到 agent scope 冒泡事件，改为订阅 `useSessions` 快照、检测会话 `running` 状态从"运行中 → 完成"的转换，并支持按 `origin: 'subagent'` 过滤提示范围。
- 自检工具 `sound_notify_status` 输出完整 JSON（含 fs 可用性、存储路径、最近错误），便于排障。
- 移除 Host 侧失效的 `agent/status` 监听与 epoch 机制。

## [1.0.0] - 2025-01-16

### Added

- 任务完成自动播放提示音（2.5 秒防抖）
- 音频池：批量上传（mp3/wav/ogg/m4a/aac/flac/webm/wma）、随机播放、试听、删除
- 设置面板（`settings.section`）：开关、音量（0–100%）、提示范围（仅主对话 / 包含子任务）
- 默认提示音自动载入（从工作目录读取，支持「重载默认提示音」）
- 设置与音频池持久化到 JSON 文件（`.dsh-sound-notify.settings.json` / `.dsh-sound-notify.pool.json`）
- 浏览器自动播放解锁：首次用户交互解锁、被拦截时提示并在下次交互后自动补播
- 只读自检工具 `sound_notify_status`
