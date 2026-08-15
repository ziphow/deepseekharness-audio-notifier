// ============================================================================
// sound-notify · Host 侧（运行在 DeepseekHarness 的 Node.js 进程中）
//
// 职责：
//   1. 持久化：设置与音频池（base64 data URL）分别写入工作目录下的 JSON 文件，
//      插件重启后自动恢复；
//   2. 首次启动时把工作目录中的默认提示音读入音频池；
//   3. 通过 harness.handle 向 Client 提供包私有 RPC；
//   4. 注册只读工具 sound_notify_status 便于自检与排障。
//
// 任务完成检测在 Client 侧完成（动态插件挂载在 cordis-dynamic 独立 fiber 下，
// 收不到 agent scope 冒泡的事件；Client 的 useSessions 快照自带会话 running
// 状态，检测"运行中 → 完成"转换更可靠）。
//
// 该文件内容是 Cordis Plugin 的函数体（plain JavaScript，无 import / TS / JSX）。
// ============================================================================
return {
  apply(ctx) {
    const fs = ctx.get('fs') // 文件系统服务（可选，缺失时仅内存模式）

    // ---------------- 配置（可按需修改） ----------------
    const FALLBACK_WORKSPACE = 'D:\\Desktop\\杂项\\DeepseekHarnessWork' // 后备工作目录
    const SETTINGS_FILE = '.dsh-sound-notify.settings.json'            // 设置文件
    const POOL_FILE = '.dsh-sound-notify.pool.json'                    // 音频池文件
    const DEFAULT_AUDIO_FILES = [                                      // 默认提示音候选（相对工作目录）
      '蔡徐坤——你干嘛_爱给网_aigei_com.mp3',
      'default-notify.mp3',
      'notification.mp3',
    ]
    const MAX_FILE_BYTES = 8 * 1024 * 1024   // 单个音频上限 8MB
    const MAX_POOL_BYTES = 64 * 1024 * 1024  // 音频池总容量上限 64MB
    const MAX_ENTRIES = 60                   // 音频池数量上限

    const MIME_BY_EXT = {
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      m4a: 'audio/mp4',
      aac: 'audio/aac',
      flac: 'audio/flac',
      webm: 'audio/webm',
      wma: 'audio/x-ms-wma',
    }
    const EXT_OK = /\.(mp3|wav|ogg|m4a|aac|flac|webm|wma)$/i

    // ---------------- 运行时状态（随 Fiber 生命周期） ----------------
    const state = {
      settings: { enabled: true, volume: 0.7, scope: 'main' },
      entries: [],   // 音频元数据列表 [{id,name,type,sizeBytes,source,createdAt}]
      audio: {},     // id -> base64 data URL
      settingsPath: null,
      poolPath: null,
      workspace: null,
      loaded: false,
      lastSaveOk: null,
      lastError: null, // 最近一次 fs/初始化错误（供自检工具查看）
    }

    // ---------------- 工具函数 ----------------
    // 把字节数组编码为 base64（btoa 按 UTF-8 处理文本，不适用于二进制，故手写编码器）
    const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    function bytesToBase64(bytes) {
      let out = ''
      for (let i = 0; i < bytes.length; i += 3) {
        const n0 = bytes[i]
        const n1 = i + 1 < bytes.length ? bytes[i + 1] : -1
        const n2 = i + 2 < bytes.length ? bytes[i + 2] : -1
        out += B64.charAt(n0 >> 2)
        out += B64.charAt(((n0 & 3) << 4) | (n1 >= 0 ? (n1 >> 4) & 15 : 0))
        out += n1 >= 0 ? B64.charAt(((n1 & 15) << 2) | (n2 >= 0 ? (n2 >> 6) & 3 : 0)) : '='
        out += n2 >= 0 ? B64.charAt(n2 & 63) : '='
      }
      return out
    }

    function extOf(name) {
      const m = /\.([a-z0-9]+)$/i.exec(name || '')
      return m ? m[1].toLowerCase() : ''
    }

    function mimeOf(name, type) {
      if (type && type.indexOf('audio/') === 0) return type
      return MIME_BY_EXT[extOf(name)] || 'audio/mpeg'
    }

    // 估算 data URL 的二进制大小（字节）
    function dataUrlBytes(dataUrl) {
      const s = String(dataUrl)
      const comma = s.indexOf(',')
      if (comma < 0) return -1
      return Math.floor(((s.length - comma - 1) * 3) / 4)
    }

    function newId() {
      return 'u' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
    }

    // 工作目录候选：沙箱策略 workspaceRoot（fs 后端允许写入的根，优先）→
    // 工作区注册表（用户实际工作区，读取默认音频用）→ 后备常量
    function rootCandidates() {
      const list = []
      const sp = ctx.get('sandboxPolicy')
      if (sp && typeof sp.workspaceRoot === 'string' && sp.workspaceRoot.length > 0) list.push(sp.workspaceRoot)
      const wr = ctx.get('workspaceRegistry')
      if (wr) {
        try {
          const workspaces = wr.list()
          if (Array.isArray(workspaces)) {
            for (const w of workspaces) {
              const p = w && (w.path || w.cwd)
              if (typeof p === 'string' && p.length > 0 && list.indexOf(p) < 0) list.push(p)
            }
          }
        } catch (err) { /* 忽略 */ }
      }
      if (list.indexOf(FALLBACK_WORKSPACE) < 0) list.push(FALLBACK_WORKSPACE)
      return list
    }

    // 在候选根中解析 fileName，返回第一个可解析的绝对路径
    async function resolveInRoot(fileName) {
      if (!fs) { state.lastError = 'fs 服务不可用（ctx.get("fs") 为 undefined）'; return null }
      for (const root of rootCandidates()) {
        const path = root.replace(/[\\/]+$/, '') + '\\' + fileName
        try {
          await fs.resolve(path)
          state.workspace = root
          return path
        } catch (err) {
          state.lastError = 'fs.resolve 失败 ' + path + ' → ' + String(err && err.message ? err.message : err)
        }
      }
      return null
    }

    async function readJsonFile(fileName) {
      const path = await resolveInRoot(fileName)
      if (!path) return null
      try {
        const text = await fs.readText(await fs.resolve(path))
        return JSON.parse(text)
      } catch (err) {
        return null // 文件不存在或损坏：按空处理
      }
    }

    async function writeJsonFile(fileName, value) {
      if (!fs) { state.lastError = 'fs 服务不可用（ctx.get("fs") 为 undefined）'; return false }
      const failures = []
      for (const root of rootCandidates()) {
        const path = root.replace(/[\\/]+$/, '') + '\\' + fileName
        try {
          await fs.writeText(await fs.resolve(path), JSON.stringify(value))
          state.workspace = root
          return true // 写入成功即采用该根
        } catch (err) {
          failures.push(String(err && err.message ? err.message : err))
        }
      }
      state.lastError = '写入失败 ' + fileName + ' → ' + failures.join(' | ')
      console.error('[sound-notify] 写入文件失败 ' + fileName + ':', failures.join(' | '))
      return false
    }

    async function loadState() {
      const settings = await readJsonFile(SETTINGS_FILE)
      if (settings && typeof settings === 'object') {
        if (typeof settings.enabled === 'boolean') state.settings.enabled = settings.enabled
        if (typeof settings.volume === 'number') state.settings.volume = Math.min(1, Math.max(0, settings.volume))
        if (settings.scope === 'main' || settings.scope === 'all') state.settings.scope = settings.scope
      }
      const pool = await readJsonFile(POOL_FILE)
      if (pool && typeof pool === 'object') {
        if (Array.isArray(pool.entries)) {
          state.entries = pool.entries.filter(e => e && typeof e.id === 'string' && typeof e.name === 'string')
        }
        if (pool.audio && typeof pool.audio === 'object') state.audio = pool.audio
      }
      state.settingsPath = await resolveInRoot(SETTINGS_FILE)
      state.poolPath = await resolveInRoot(POOL_FILE)
      state.loaded = true
    }

    async function saveSettings() {
      const ok = await writeJsonFile(SETTINGS_FILE, {
        version: 1,
        savedAt: new Date().toISOString(),
        enabled: state.settings.enabled,
        volume: state.settings.volume,
        scope: state.settings.scope,
      })
      state.lastSaveOk = ok
      return ok
    }

    async function savePool() {
      const ok = await writeJsonFile(POOL_FILE, {
        version: 1,
        savedAt: new Date().toISOString(),
        entries: state.entries,
        audio: state.audio,
      })
      state.lastSaveOk = ok
      return ok
    }

    // 载入工作目录中的默认提示音；force=true 时强制重读
    async function seedDefaultAudio(force) {
      if (!fs) { state.lastError = 'fs 服务不可用（ctx.get("fs") 为 undefined）'; return null }
      const existing = state.entries.find(e => e.source === 'default')
      if (existing && !force) return existing
      for (const root of rootCandidates()) {
        for (const rel of DEFAULT_AUDIO_FILES) {
          const full = /^[A-Za-z]:[\\/]/.test(rel) ? rel : root.replace(/[\\/]+$/, '') + '\\' + rel
          try {
            const bytes = await fs.readBytes(await fs.resolve(full), undefined, MAX_FILE_BYTES)
            if (!bytes || bytes.length === 0) continue
            const mime = mimeOf(rel, '')
            const dataUrl = 'data:' + mime + ';base64,' + bytesToBase64(bytes)
            const entry = existing || { id: 'default', source: 'default', createdAt: Date.now() }
            entry.name = rel
            entry.type = mime
            entry.sizeBytes = bytes.length
            state.audio[entry.id] = dataUrl
            if (!existing) state.entries.unshift(entry)
            state.workspace = root
            await savePool()
            console.log('[sound-notify] 已载入默认提示音:', rel, '(' + bytes.length + ' bytes)')
            return entry
          } catch (err) {
            state.lastError = '读取默认音频失败 ' + full + ' → ' + String(err && err.message ? err.message : err)
            console.error('[sound-notify] 读取默认音频失败:', full, String(err && err.message ? err.message : err))
          }
        }
      }
      return null
    }

    let loadPromise = null
    function ensureLoaded() {
      if (!loadPromise) {
        loadPromise = loadState().catch(err => {
          state.lastError = '状态加载失败 → ' + String(err && err.message ? err.message : err)
          console.error('[sound-notify] 状态加载失败:', String(err && err.message ? err.message : err))
        })
      }
      return loadPromise
    }

    // ---------------- Client RPC ----------------
    const stopHandles = []

    stopHandles.push(harness.handle('get-state', async () => {
      await ensureLoaded()
      return {
        settings: { enabled: state.settings.enabled, volume: state.settings.volume, scope: state.settings.scope },
        entries: state.entries,
        persisted: state.lastSaveOk,
      }
    }))

    // 播放器低频轮询：同步设置与音频池 id 列表（轻量载荷，不携带音频数据）
    stopHandles.push(harness.handle('poll', async () => {
      await ensureLoaded()
      return {
        enabled: state.settings.enabled,
        volume: state.settings.volume,
        scope: state.settings.scope,
        entryIds: state.entries.map(e => e.id),
      }
    }))

    stopHandles.push(harness.handle('get-audio', async (args) => {
      await ensureLoaded()
      const id = args && args.id
      const url = state.audio[id]
      if (typeof url !== 'string') return { ok: false, reason: 'not-found' }
      return { ok: true, dataUrl: url }
    }))

    stopHandles.push(harness.handle('set-settings', async (args) => {
      await ensureLoaded()
      const patch = args && typeof args === 'object' ? args : {}
      if (typeof patch.enabled === 'boolean') state.settings.enabled = patch.enabled
      if (typeof patch.volume === 'number') state.settings.volume = Math.min(1, Math.max(0, patch.volume))
      if (patch.scope === 'main' || patch.scope === 'all') state.settings.scope = patch.scope
      const ok = await saveSettings()
      return { ok, settings: { enabled: state.settings.enabled, volume: state.settings.volume, scope: state.settings.scope } }
    }))

    stopHandles.push(harness.handle('upload', async (args) => {
      await ensureLoaded()
      const items = args && Array.isArray(args.items) ? args.items : []
      const errors = []
      let total = state.entries.reduce((sum, e) => sum + (Number(e.sizeBytes) || 0), 0)
      for (const item of items) {
        const name = String(item && item.name ? item.name : '').trim()
        const dataUrl = item && item.dataUrl
        if (!name) { errors.push('（未命名文件）'); continue }
        if (!EXT_OK.test(name) && !(item && typeof item.type === 'string' && item.type.indexOf('audio/') === 0)) {
          errors.push(name + '（格式不支持）')
          continue
        }
        const size = dataUrlBytes(dataUrl)
        if (size <= 0 || size > MAX_FILE_BYTES) { errors.push(name + '（超过 8MB 限制）'); continue }
        if (state.entries.length >= MAX_ENTRIES) { errors.push(name + '（音频池已满 ' + MAX_ENTRIES + ' 个）'); continue }
        if (total + size > MAX_POOL_BYTES) { errors.push(name + '（音频池总容量超过 64MB）'); continue }
        const entry = {
          id: newId(),
          name,
          type: mimeOf(name, item.type),
          sizeBytes: size,
          source: 'upload',
          createdAt: Date.now(),
        }
        state.entries.push(entry)
        state.audio[entry.id] = String(dataUrl)
        total += size
      }
      const ok = await savePool()
      return { ok, saved: ok, entries: state.entries, errors }
    }))

    stopHandles.push(harness.handle('delete', async (args) => {
      await ensureLoaded()
      const id = args && args.id
      const idx = state.entries.findIndex(e => e.id === id)
      if (idx < 0) return { ok: false, reason: 'not-found', entries: state.entries }
      state.entries.splice(idx, 1)
      delete state.audio[id]
      const ok = await savePool()
      return { ok, entries: state.entries }
    }))

    stopHandles.push(harness.handle('rescan-default', async () => {
      await ensureLoaded()
      const entry = await seedDefaultAudio(true)
      return { ok: !!entry, entries: state.entries }
    }))

    // ---------------- 只读自检工具 ----------------
    const statusTool = harness.defineTool({
      name: 'sound_notify_status',
      description:
        '查看「任务完成提示音」插件的运行状态：开关/音量/范围设置、音频池元数据、' +
        '持久化与文件系统诊断。只读，不修改任何数据。',
      parameters: { type: 'object', properties: {} },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            settings: {
              type: 'object',
              additionalProperties: false,
              required: true,
              properties: {
                enabled: { type: 'boolean', required: true },
                volume: { type: 'number', required: true },
                scope: { type: 'string', required: true },
              },
            },
            entryCount: { type: 'integer', required: true },
            entries: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', required: true },
                  name: { type: 'string', required: true },
                  type: { type: 'string', required: true },
                  sizeBytes: { type: 'integer', required: true },
                  source: { type: 'string', required: true },
                  createdAt: { type: 'number', required: true },
                },
              },
            },
            settingsFile: { type: 'string', required: true },
            poolFile: { type: 'string', required: true },
            persisted: { type: 'boolean', required: true },
            fsAvailable: { type: 'boolean', required: true },
            workspace: { type: 'string', required: true },
            lastError: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: async () => {
        await ensureLoaded()
        return {
          settings: { enabled: state.settings.enabled, volume: state.settings.volume, scope: state.settings.scope },
          entryCount: state.entries.length,
          entries: state.entries,
          settingsFile: state.settingsPath || '',
          poolFile: state.poolPath || '',
          persisted: state.lastSaveOk === true,
          fsAvailable: !!fs,
          workspace: state.workspace || '',
          lastError: state.lastError || '',
        }
      },
    })
    stopHandles.push(harness.registerTool(ctx, statusTool))

    // ---------------- 启动自检（异步，不阻塞） ----------------
    ;(async () => {
      await ensureLoaded()
      await seedDefaultAudio(false)
      // 启动时做一次设置写入自检：既能校准 persisted 语义，也能尽早暴露磁盘不可写
      if (state.lastSaveOk === null) await saveSettings()
      console.log('[sound-notify] 初始化完成', {
        workspace: state.workspace,
        settingsFile: state.settingsPath,
        poolFile: state.poolPath,
        entryCount: state.entries.length,
        defaultSeeded: state.entries.some(e => e.source === 'default'),
        lastSaveOk: state.lastSaveOk,
        lastError: state.lastError,
      })
    })().catch(err => console.error('[sound-notify] 初始化异常:', String(err && err.message ? err.message : err)))

    // ---------------- 清理：停止时撤销全部副作用 ----------------
    ctx.effect(() => () => {
      stopHandles.forEach(fn => {
        try { fn() } catch (e) { /* 忽略 */ }
      })
    })
  },
}
