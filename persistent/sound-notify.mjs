// sound-notify · 常驻版 Host 模块（随 preset 目录分发，重启不消失）
//
// 设计说明：
//   本文件是 agent preset 里的一行（name: ./sound-notify.mjs），由 Cordis 加载器
//   作为普通 Node ESM 模块导入，因此拥有完整 Node 能力（child_process / fs / os / path），
//   不需要依赖部署 node_modules 里的任何包 —— 这正是它能随 preset 目录"带走"的关键。
//
// 职责：
//   1. 监听 agent/status 事件：主对话 Agent 回到 idle 即认为一轮工作完成；
//   2. 从音频池随机选一首，在本机（Windows 用 WPF MediaPlayer，macOS 用 afplay，
//      Linux 用 paplay）播放，音量可控；
//   3. 持久化：状态写入 ${DSH_HOME}/sound-notify/state.json，
//      音频池为 ${DSH_HOME}/sound-notify/audio/ 目录；
//   4. 注册配置工具 sound_notify_config。
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, readdirSync, copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const ROOT = join(DSH_HOME, 'sound-notify')
const STATE_FILE = join(ROOT, 'state.json')
const AUDIO_DIR = join(ROOT, 'audio')

// preset 目录内自带的默认音频（本文件在 preset 根目录，音频在 assets/ 子目录）
const HERE = dirname(fileURLToPath(import.meta.url))
const BUNDLED_DEFAULT = join(HERE, 'assets', 'default-notify.mp3')

const EXT_OK = /\.(mp3|wav|ogg|m4a|aac|flac|webm|wma)$/i
const DEBOUNCE_MS = 2500

export default {
  name: 'sound-notify',
  inject: ['tools'],
  apply(ctx) {
    // ---------------- 状态 ----------------
    let state = { enabled: true, volume: 0.7, scope: 'main' }
    try {
      if (existsSync(STATE_FILE)) {
        const loaded = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
        if (loaded && typeof loaded === 'object') {
          if (typeof loaded.enabled === 'boolean') state.enabled = loaded.enabled
          if (typeof loaded.volume === 'number') state.volume = Math.min(1, Math.max(0, loaded.volume))
          if (loaded.scope === 'all') state.scope = 'all'
        }
      }
    } catch { /* 首次运行或文件损坏：用默认值 */ }

    const saveState = () => {
      try {
        mkdirSync(ROOT, { recursive: true })
        writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
      } catch { /* 忽略写入失败 */ }
    }

    // ---------------- 音频池 ----------------
    const ensurePool = () => {
      mkdirSync(AUDIO_DIR, { recursive: true })
      try {
        const files = readdirSync(AUDIO_DIR).filter(f => EXT_OK.test(f))
        if (files.length === 0 && existsSync(BUNDLED_DEFAULT)) {
          copyFileSync(BUNDLED_DEFAULT, join(AUDIO_DIR, basename(BUNDLED_DEFAULT)))
        }
      } catch { /* 忽略 */ }
    }
    const poolFiles = () => {
      try {
        return readdirSync(AUDIO_DIR).filter(f => EXT_OK.test(f)).map(f => join(AUDIO_DIR, f))
      } catch { return [] }
    }

    // ---------------- 本机播放 ----------------
    const playFile = (file, volume) => {
      const vol = Math.min(1, Math.max(0, volume || 0.7))
      try {
        if (process.platform === 'win32') {
          const script = [
            'Add-Type -AssemblyName presentationCore',
            '$p=New-Object System.Windows.Media.MediaPlayer',
            '$ended=$false',
            '$p.add_MediaEnded({$script:ended=$true})',
            `$p.Open([System.Uri]'${file.replace(/'/g, "''")}')`,
            `$p.Volume=${vol}`,
            '$p.Play()',
            '$d=(Get-Date).AddSeconds(120)',
            'while(-not $ended -and (Get-Date) -lt $d){Start-Sleep -Milliseconds 200}',
            '$p.Stop();$p.Close()',
          ].join(';')
          spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { detached: true, stdio: 'ignore' }).unref()
        } else if (process.platform === 'darwin') {
          spawn('afplay', [file], { detached: true, stdio: 'ignore' }).unref()
        } else {
          spawn('paplay', [file], { detached: true, stdio: 'ignore' }).unref()
        }
      } catch { /* 播放失败静默忽略 */ }
    }

    // ---------------- 任务完成检测 ----------------
    // preset 的 standing mount 是 agent 的 scope 祖先，因此能收到 agent/status 冒泡事件。
    const agents = ctx.get('agents')
    let lastIdleAt = 0
    ctx.on('agent/status', (payload) => {
      if (!payload || payload.status !== 'idle') return
      if (state.scope !== 'all' && agents) {
        try {
          const roots = agents.roots()
          if (Array.isArray(roots) && roots.length > 0 && roots.indexOf(payload.agent) === -1) return
        } catch { /* 拿不到 roots 时按放行处理 */ }
      }
      const now = Date.now()
      if (now - lastIdleAt < DEBOUNCE_MS) return
      lastIdleAt = now
      if (!state.enabled) return
      const files = poolFiles()
      if (files.length === 0) return
      playFile(files[Math.floor(Math.random() * files.length)], state.volume)
    })

    // ---------------- 配置工具 ----------------
    const configTool = {
      name: 'sound_notify_config',
      description:
        '配置「任务完成提示音」常驻插件。action 取值：status(查看) / set(改开关·音量·范围) / ' +
        'add-audio(按绝对路径添加音频) / remove-audio(按文件名删除) / list-audio(列出音频池)。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'status | set | add-audio | remove-audio | list-audio' },
          enabled: { type: 'boolean', description: '开/关（set 时用）' },
          volume: { type: 'number', description: '音量 0-1（set 时用）' },
          scope: { type: 'string', description: 'main | all（set 时用）' },
          file: { type: 'string', description: '音频文件绝对路径（add-audio 时用）' },
          name: { type: 'string', description: '音频文件名（remove-audio 时用）' },
        },
        required: ['action'],
      },
      output: {
        schema: { type: 'object' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      async execute(args) {
        try {
          ensurePool()
          const action = String(args && args.action ? args.action : 'status')
          if (action === 'status') {
            return { ok: true, enabled: state.enabled, volume: state.volume, scope: state.scope, audio: poolFiles().map(f => basename(f)) }
          }
          if (action === 'set') {
            if (typeof args.enabled === 'boolean') state.enabled = args.enabled
            if (typeof args.volume === 'number') state.volume = Math.min(1, Math.max(0, args.volume))
            if (args.scope === 'main' || args.scope === 'all') state.scope = args.scope
            saveState()
            return { ok: true, enabled: state.enabled, volume: state.volume, scope: state.scope }
          }
          if (action === 'add-audio') {
            const src = args.file
            if (typeof src !== 'string' || !EXT_OK.test(src)) return { ok: false, message: '需要 file 参数指向 mp3/wav/ogg 等音频文件' }
            if (!existsSync(src)) return { ok: false, message: '文件不存在: ' + src }
            const dest = join(AUDIO_DIR, basename(src))
            copyFileSync(src, dest)
            return { ok: true, message: '已添加: ' + basename(src), audio: poolFiles().map(f => basename(f)) }
          }
          if (action === 'remove-audio') {
            const name = args.name
            if (typeof name !== 'string' || !name) return { ok: false, message: '需要 name 参数（音频文件名）' }
            const target = join(AUDIO_DIR, name)
            if (!existsSync(target)) return { ok: false, message: '不存在: ' + name }
            rmSync(target)
            return { ok: true, message: '已删除: ' + name, audio: poolFiles().map(f => basename(f)) }
          }
          if (action === 'list-audio') {
            return { ok: true, audio: poolFiles().map(f => basename(f)) }
          }
          return { ok: false, message: '未知 action: ' + action }
        } catch (e) {
          return { ok: false, message: String(e && e.message ? e.message : e) }
        }
      },
    }
    ctx.tools.register(configTool)

    // ---------------- 初始化 ----------------
    ensurePool()
    saveState()
  },
}
