// ============================================================================
// sound-notify · Client 侧（运行在 DeepseekHarness Web 页面的浏览器中）
//
// 职责：
//   1. 在「设置 → 提示音」注册完整设置面板：开关 / 音量 / 提示范围 /
//      批量上传音频 / 音频池列表（试听、删除）/ 测试随机播放 / 重载默认提示音；
//   2. 在 shell.overlay 常驻一个隐藏的 <audio> 播放器：订阅 useSessions 快照，
//      检测会话 running 状态从"运行中 → 完成"的转换，任务完成时从音频池随机播放；
//      同时低频轮询 Host 同步设置与音频池列表；
//   3. 处理浏览器自动播放限制：首次用户交互（点击/按键/打开设置页）时解锁，
//      若自动播放被拦截则弹出提示，并在下次交互后自动补播。
//
// 该文件内容是 Cordis Plugin 的函数体（plain JavaScript，无 JSX / TS / import）。
// ============================================================================
return {
  inject: ['timer'], // 轮询与防抖依赖 timer 服务
  async apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    const h = React.createElement
    const hasDom = typeof document !== 'undefined' && typeof FileReader !== 'undefined'

    // ---------------- 共享状态（本 Package 内 Player 与 Panel 共用） ----------------
    const store = {
      settings: { enabled: true, volume: 0.7, scope: 'main' },
      entries: [],     // 元数据列表（Panel 展示用）
      entryIds: [],    // 播放器轮询得到的 id 列表
      cache: {},       // id -> dataUrl 缓存
      dirtyAt: 0,      // 最近一次本地修改时间（避免轮询回写覆盖用户操作）
      runningMap: null, // 上次已知的"运行中"会话集合（完成检测用）
      unlocked: false,
      pendingUrl: null,
      toast: null,
      version: 0,
      listeners: new Set(),
    }
    let audioEl = null
    let toastDispose = null
    let lastPlayAt = 0

    const emit = () => {
      store.version += 1
      store.listeners.forEach(fn => { try { fn() } catch (e) { /* 忽略 */ } })
    }
    // 简易订阅 Hook：任何 store 变更都会触发组件重渲染
    const useStore = () => {
      const [, setTick] = React.useState(0)
      React.useEffect(() => {
        const fn = () => setTick(t => t + 1)
        store.listeners.add(fn)
        return () => { store.listeners.delete(fn) }
      }, [])
      return store
    }

    // sticky=true 时提示常驻不自动消失（用于"等待解锁补播"场景）
    const showToast = (text, sticky) => {
      store.toast = { text, at: Date.now(), sticky: !!sticky }
      emit()
      if (toastDispose) { try { toastDispose() } catch (e) { /* 忽略 */ } }
      if (!sticky) toastDispose = ctx.timeout(() => { store.toast = null; emit() }, 6000)
    }

    const setVolumeNow = () => {
      if (!audioEl) return
      try { audioEl.volume = Math.min(1, Math.max(0, store.settings.volume)) } catch (e) { /* 忽略 */ }
    }

    // ---------------- 播放逻辑 ----------------
    async function playDataUrl(dataUrl) {
      if (!audioEl || !dataUrl) return false
      try {
        audioEl.src = dataUrl
        setVolumeNow()
        await audioEl.play()
        store.unlocked = true
        // 播放成功：若"等待解锁"的常驻提示还在，一并收起
        if (store.toast && store.toast.sticky) { store.toast = null }
        emit()
        return true
      } catch (err) {
        // 被浏览器自动播放策略拦截：记录待播内容，弹常驻提示，等用户交互后补播
        store.pendingUrl = dataUrl
        showToast('任务已完成：浏览器阻止了自动播放，点击页面任意位置即可播放提示音', true)
        return false
      }
    }

    async function playById(id) {
      let url = store.cache[id]
      if (!url) {
        try {
          const res = await host.call('get-audio', { id })
          if (res && res.ok && typeof res.dataUrl === 'string') {
            url = res.dataUrl
            store.cache[id] = url
          }
        } catch (err) { /* 忽略，下面统一提示 */ }
      }
      if (!url) { showToast('音频数据加载失败'); return }
      await playDataUrl(url)
    }

    // 从音频池随机选一首播放（"测试随机播放"也复用此函数）
    async function playRandom() {
      const ids = store.entryIds.length > 0 ? store.entryIds : store.entries.map(e => e.id)
      if (ids.length === 0) { showToast('音频池为空：请到 设置 → 提示音 上传音频'); return }
      const id = ids[Math.floor(Math.random() * ids.length)]
      await playById(id)
    }

    // 任务完成回调：2.5 秒防抖，避免多个会话（并行子任务）连环轰炸
    const onTaskCompleted = () => {
      if (!store.settings.enabled) return
      const now = Date.now()
      if (now - lastPlayAt < 2500) return
      lastPlayAt = now
      playRandom()
    }

    // 解锁：任何用户交互（点击/按键/打开设置页）都会让浏览器授予该页面的
    // 自动播放许可（sticky activation）；若有被拦截的待播音频则立即补播。
    // 这里不做"静音试播"——那会在每次点击时重播主播放器里的上一段音频。
    const tryUnlock = () => {
      if (!audioEl) return
      if (store.pendingUrl) {
        const url = store.pendingUrl
        store.pendingUrl = null
        // 用户在此期间关闭了提示音：丢弃待播，不再补播
        if (!store.settings.enabled) {
          if (store.toast && store.toast.sticky) { store.toast = null; emit() }
          return
        }
        playDataUrl(url) // 位于用户手势内，必然能播
        return
      }
      store.unlocked = true
      emit()
    }

    // ---------------- 常驻播放器（shell.overlay） ----------------
    function Player(props) {
      const s = useStore()
      // 会话列表快照：byId 中每个会话带 running 状态（宿主实时流更新）。
      // 检测"运行中 → 完成"的转换即为任务完成信号。
      // 注意：useSessions 必须传入选择器函数（这里用恒等选择器取完整快照）。
      const sessions = props && typeof props.useSessions === 'function' ? props.useSessions((s) => s) : null
      const byId = sessions && sessions.byId ? sessions.byId : null

      React.useEffect(() => {
        if (!byId) return
        const nowRunning = {}
        for (const key of Object.keys(byId)) {
          const row = byId[key]
          if (row && row.running) nowRunning[key] = true
        }
        const prev = s.runningMap
        if (prev) {
          for (const key of Object.keys(prev)) {
            if (nowRunning[key]) continue
            const row = byId[key]
            if (!row) continue // 会话已被移除/归档，不算完成
            if (s.settings.scope === 'main' && row.origin === 'subagent') continue
            onTaskCompleted()
          }
        }
        s.runningMap = nowRunning
      }, [byId])

      React.useEffect(() => {
        if (!hasDom) return
        // 任意用户交互 → 解锁自动播放
        const onGesture = () => tryUnlock()
        document.addEventListener('pointerdown', onGesture, true)
        document.addEventListener('keydown', onGesture, true)

        let alive = true
        let inFlight = false
        const poll = async () => {
          if (inFlight || !alive) return
          inFlight = true
          try {
            const res = await host.call('poll', {})
            if (!alive || !res) return
            // 本地修改后 3 秒内不回写设置，避免覆盖用户正在拖动的音量
            if (Date.now() - s.dirtyAt > 3000) {
              if (typeof res.enabled === 'boolean') s.settings.enabled = res.enabled
              if (typeof res.volume === 'number') { s.settings.volume = res.volume; setVolumeNow() }
              if (res.scope === 'main' || res.scope === 'all') s.settings.scope = res.scope
            }
            if (Array.isArray(res.entryIds)) s.entryIds = res.entryIds
          } catch (err) { /* 轮询失败静默重试 */ }
          inFlight = false
        }
        poll()
        const dispose = ctx.interval(poll, 1500)
        return () => {
          alive = false
          if (dispose) dispose()
          document.removeEventListener('pointerdown', onGesture, true)
          document.removeEventListener('keydown', onGesture, true)
        }
      }, [])

      return h('div', { className: 'dsn-root' },
        h('audio', { ref: el => { audioEl = el }, preload: 'auto', style: { display: 'none' } }),
        s.toast
          ? h('div', {
              className: 'dsn-toast',
              title: '点击关闭',
              onClick: () => { s.toast = null; emit() },
            }, s.toast.text)
          : null
      )
    }

    // 设置持久化（apply 作用域创建一次，避免每次渲染重建防抖定时器）
    const persistSettings = ctx.debounce(async () => {
      try {
        const res = await host.call('set-settings', {
          enabled: !!store.settings.enabled,
          volume: store.settings.volume,
          scope: store.settings.scope,
        })
        if (res && res.settings) {
          store.settings = { enabled: !!res.settings.enabled, volume: Number(res.settings.volume) || 0, scope: res.settings.scope === 'all' ? 'all' : 'main' }
          setVolumeNow()
          emit()
        }
        if (res && res.ok === false) showToast('设置已生效，但未能持久化到磁盘')
      } catch (err) {
        showToast('设置保存失败：' + String(err && err.message ? err.message : err))
      }
    }, 300)

    // ---------------- 设置面板（settings.section） ----------------
    function Panel(props) {
      const s = useStore()
      const [message, setMessage] = React.useState('')
      const [saving, setSaving] = React.useState(false)
      let fileInput = null

      const refresh = async () => {
        try {
          const res = await host.call('get-state', {})
          if (!res) return
          if (res.settings) {
            s.settings = { enabled: !!res.settings.enabled, volume: Number(res.settings.volume) || 0, scope: res.settings.scope === 'all' ? 'all' : 'main' }
          }
          if (Array.isArray(res.entries)) {
            s.entries = res.entries
            s.entryIds = res.entries.map(e => e.id)
          }
          setVolumeNow()
          emit()
        } catch (err) {
          setMessage('读取设置失败：' + String(err && err.message ? err.message : err))
        }
      }

      React.useEffect(() => {
        refresh()
        tryUnlock() // 打开设置面板本身意味着用户已交互 → 顺手解锁
      }, [])

      const btn = (label, onClick, opts) => h('button',
        Object.assign({ className: 'dsn-btn', type: 'button', onClick }, opts || {}), label)

      // 本地立即生效 + 300ms 防抖持久化（persistSettings 定义在 apply 作用域）
      const changeSetting = (patch, toastText) => {
        Object.assign(s.settings, patch)
        s.dirtyAt = Date.now()
        setVolumeNow()
        emit()
        persistSettings()
        if (toastText) showToast(toastText)
      }

      // 批量读取文件并上传
      const handleFiles = (el) => {
        const files = el && el.files ? Array.from(el.files) : []
        if (el) el.value = ''
        if (files.length === 0) return
        if (!hasDom) { setMessage('当前环境不支持文件读取'); return }
        const MAX = 8 * 1024 * 1024
        const EXT = /\.(mp3|wav|ogg|m4a|aac|flac|webm|wma)$/i
        const tasks = []
        const skipped = []
        files.forEach(f => {
          const audioType = f.type && f.type.indexOf('audio/') === 0
          if (f.size > MAX) { skipped.push(f.name + '（超过 8MB）'); return }
          if (!audioType && !EXT.test(f.name)) { skipped.push(f.name + '（格式不支持）'); return }
          tasks.push(f)
        })
        if (tasks.length === 0) { setMessage(skipped.length ? '全部被跳过：' + skipped.join('、') : ''); return }
        setMessage('正在读取 ' + tasks.length + ' 个文件…')
        let done = 0
        const items = []
        const readNext = () => {
          if (done >= tasks.length) { uploadItems(items, skipped); return }
          const f = tasks[done]
          const reader = new FileReader()
          reader.onload = () => {
            done += 1
            items.push({ name: f.name, type: f.type || '', dataUrl: String(reader.result) })
            setMessage('正在读取 ' + done + '/' + tasks.length + ' …')
            readNext()
          }
          reader.onerror = () => { done += 1; skipped.push(f.name + '（读取失败）'); readNext() }
          reader.readAsDataURL(f)
        }
        readNext()
      }

      const uploadItems = async (items, skipped) => {
        if (items.length === 0) { setMessage(skipped.length ? '跳过：' + skipped.join('、') : ''); return }
        setSaving(true)
        try {
          const res = await host.call('upload', { items })
          if (res && Array.isArray(res.entries)) {
            s.entries = res.entries
            s.entryIds = res.entries.map(e => e.id)
            emit()
          }
          const errs = res && Array.isArray(res.errors) ? res.errors : []
          let msg = '已上传 ' + Math.max(0, items.length - errs.length) + ' 个音频'
          const all = skipped.concat(errs)
          if (all.length > 0) msg += '；跳过：' + all.join('、')
          setMessage(msg)
          if (res && res.saved === false) showToast('上传成功，但未能持久化到磁盘')
        } catch (err) {
          setMessage('上传失败：' + String(err && err.message ? err.message : err))
        }
        setSaving(false)
      }

      const doPreview = (id) => { playById(id) }

      const doDelete = async (id) => {
        try {
          const res = await host.call('delete', { id })
          if (res && Array.isArray(res.entries)) {
            s.entries = res.entries
            s.entryIds = res.entries.map(e => e.id)
            emit()
            showToast('已删除')
          }
        } catch (err) {
          setMessage('删除失败：' + String(err && err.message ? err.message : err))
        }
      }

      const rescanDefault = async () => {
        setSaving(true)
        try {
          const res = await host.call('rescan-default', {})
          if (res && Array.isArray(res.entries)) {
            s.entries = res.entries
            s.entryIds = res.entries.map(e => e.id)
            emit()
          }
          setMessage(res && res.ok ? '已重新载入默认提示音' : '未找到默认提示音文件')
        } catch (err) {
          setMessage('重载失败：' + String(err && err.message ? err.message : err))
        }
        setSaving(false)
      }

      const fmtSize = (n) => {
        n = Number(n) || 0
        if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB'
        return (n / 1024 / 1024).toFixed(1) + ' MB'
      }

      const volumePct = Math.round((s.settings.volume || 0) * 100)

      return h('div', { className: 'dsn-panel' },
        h('div', { className: 'dsn-title' }, '任务完成提示音',
          h('span', { className: 'dsn-sub' }, 'DeepseekHarness 完成工作时随机播放一条提示音')),

        // 开关
        h('div', { className: 'dsn-row' },
          h('span', { className: 'dsn-label' }, '开启提示音'),
          h('label', { className: 'dsn-switch' },
            h('input', {
              type: 'checkbox',
              checked: !!s.settings.enabled,
              onChange: (e) => changeSetting({ enabled: !!e.target.checked }, e.target.checked ? '提示音已开启' : '提示音已关闭'),
            }),
            h('span', { className: 'dsn-slider' })
          )
        ),

        // 音量
        h('div', { className: 'dsn-row dsn-col' },
          h('div', { className: 'dsn-row-between' },
            h('span', { className: 'dsn-label' }, '音量'),
            h('span', { className: 'dsn-muted' }, volumePct + '%')
          ),
          h('input', {
            type: 'range', min: 0, max: 100, step: 1,
            value: volumePct,
            onChange: (e) => changeSetting({ volume: Number(e.target.value) / 100 }),
            className: 'dsn-range',
          })
        ),

        // 提示范围
        h('div', { className: 'dsn-row' },
          h('span', { className: 'dsn-label' }, '提示范围'),
          h('select', {
            className: 'dsn-select',
            value: s.settings.scope === 'all' ? 'all' : 'main',
            onChange: (e) => changeSetting({ scope: e.target.value === 'all' ? 'all' : 'main' }),
          },
            h('option', { value: 'main' }, '仅主对话完成时'),
            h('option', { value: 'all' }, '包含子任务完成')
          )
        ),

        // 操作区
        h('div', { className: 'dsn-actions' },
          btn('上传音频', () => { if (fileInput) fileInput.click() }, {
            title: '支持 mp3 / wav / ogg / m4a / aac / flac / webm / wma，单文件 ≤ 8MB，可多选',
          }),
          btn('测试随机播放', () => playRandom()),
          btn('重载默认提示音', () => rescanDefault(), { className: 'dsn-btn dsn-ghost' }),
          saving ? h('span', { className: 'dsn-muted' }, '保存中…') : null,
          h('input', {
            type: 'file', multiple: true,
            accept: 'audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.webm,.wma',
            style: { display: 'none' },
            ref: el => { fileInput = el },
            onChange: (e) => handleFiles(e.target),
          })
        ),

        message ? h('div', { className: 'dsn-msg' }, message) : null,

        s.unlocked
          ? h('div', { className: 'dsn-ok' }, '✓ 音频已解锁，任务完成时自动播放')
          : h('div', { className: 'dsn-warn' }, '⚠ 尚未解锁自动播放：点击本页任意位置即可启用'),

        // 音频池列表
        h('div', { className: 'dsn-list-title' }, '音频池（' + s.entries.length + '）'),
        s.entries.length === 0
          ? h('div', { className: 'dsn-empty' }, '还没有音频。点击上方「上传音频」添加，或「重载默认提示音」载入工作目录中的默认音频。')
          : s.entries.map(entry => h('div', { key: entry.id, className: 'dsn-item' },
              h('div', { className: 'dsn-item-info' },
                h('div', { className: 'dsn-item-name', title: entry.name }, entry.name),
                h('div', { className: 'dsn-muted' },
                  fmtSize(entry.sizeBytes) + ' · ' + (entry.type || 'audio') + (entry.source === 'default' ? ' · 默认' : ''))
              ),
              h('div', { className: 'dsn-item-actions' },
                btn('试听', () => doPreview(entry.id), { className: 'dsn-btn dsn-small' }),
                btn('删除', () => doDelete(entry.id), { className: 'dsn-btn dsn-small dsn-danger' })
              )
            ))
      )
    }

    // ---------------- 样式 ----------------
    styles.insert(
      '.dsn-root{pointer-events:none;}' +
      '.dsn-panel{font-size:13px;line-height:1.6;color:var(--dsn-text,#d7dbe4);max-width:620px;}' +
      '.dsn-title{font-size:15px;font-weight:600;}' +
      '.dsn-sub{margin-left:8px;font-size:12px;font-weight:400;color:var(--dsn-muted,#8b93a7);}' +
      '.dsn-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:16px;}' +
      '.dsn-col{flex-direction:column;align-items:stretch;}' +
      '.dsn-row-between{display:flex;justify-content:space-between;}' +
      '.dsn-label{font-weight:500;}' +
      '.dsn-muted{color:var(--dsn-muted,#8b93a7);font-size:12px;}' +
      '.dsn-switch{position:relative;display:inline-block;width:38px;height:22px;flex-shrink:0;}' +
      '.dsn-switch input{display:none;}' +
      '.dsn-slider{position:absolute;inset:0;border-radius:22px;background:#3a4152;transition:background .15s;cursor:pointer;}' +
      '.dsn-slider::before{content:"";position:absolute;width:16px;height:16px;left:3px;top:3px;border-radius:50%;background:#fff;transition:transform .15s;}' +
      '.dsn-switch input:checked + .dsn-slider{background:#2f81f7;}' +
      '.dsn-switch input:checked + .dsn-slider::before{transform:translateX(16px);}' +
      '.dsn-range{width:100%;accent-color:#2f81f7;}' +
      '.dsn-select{padding:6px 8px;border-radius:6px;background:#222733;color:inherit;border:1px solid #363d4d;max-width:220px;}' +
      '.dsn-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:18px;}' +
      '.dsn-btn{padding:7px 12px;border-radius:6px;border:1px solid #363d4d;background:#2a3040;color:inherit;cursor:pointer;font-size:12.5px;}' +
      '.dsn-btn:hover{border-color:#2f81f7;}' +
      '.dsn-ghost{background:transparent;}' +
      '.dsn-small{padding:4px 10px;font-size:12px;}' +
      '.dsn-danger:hover{border-color:#e5534b;color:#e5534b;}' +
      '.dsn-msg{margin-top:12px;padding:8px 10px;border-radius:6px;background:rgba(47,129,247,.12);}' +
      '.dsn-ok{margin-top:10px;color:#3fb950;font-size:12px;}' +
      '.dsn-warn{margin-top:10px;color:#d29922;font-size:12px;}' +
      '.dsn-list-title{margin-top:22px;font-weight:600;}' +
      '.dsn-empty{margin-top:8px;color:var(--dsn-muted,#8b93a7);}' +
      '.dsn-item{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;margin-top:8px;border:1px solid #363d4d;border-radius:8px;}' +
      '.dsn-item-info{min-width:0;}' +
      '.dsn-item-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:340px;}' +
      '.dsn-item-actions{display:flex;gap:6px;flex-shrink:0;}' +
      '.dsn-toast{position:fixed;right:18px;bottom:18px;z-index:99999;background:#1c2130;color:#e6e9f0;padding:10px 14px;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.4);font-size:13px;pointer-events:auto;cursor:pointer;max-width:380px;}'
    )

    // ---------------- 插槽注册 ----------------
    slots.inject('settings.section', () => slots.register(
      { name: 'settings.section', id: 'sound-notify', order: 30, label: '提示音' },
      (props) => h(Panel, props)
    ))

    slots.inject('shell.overlay', () => slots.register(
      { name: 'shell.overlay', id: 'sound-notify-player', order: 90 },
      (props) => h(Player, props)
    ))
  },
}
