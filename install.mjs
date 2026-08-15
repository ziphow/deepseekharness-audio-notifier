// install.mjs —— 一键生成 DeepseekHarness 安装指令（零依赖，Node.js 18+）
//
// 用法：
//   node install.mjs            打印推荐安装指令（让 DSH 会话从 GitHub 拉取源码）
//   node install.mjs --copy     同上，并尝试复制到剪贴板（Windows/macOS/Linux）
//   node install.mjs --offline  打印无网络自包含版（把源码内联，适合会话无法联网时）
//
// 说明：DeepseekHarness 的动态插件由会话内的 Agent 通过 cordis_define / cordis_run
// 安装，本脚本只是把"要发给 Agent 的那段话"生成好，方便一键复制粘贴。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const RAW = 'https://raw.githubusercontent.com/ziphow/deepseekharness-audio-notifier/main'

const shortPrompt = `请安装并运行插件「sound-notify（任务完成提示音）」，步骤：
1. 分别读取以下两个文件的内容：
   - ${RAW}/src/host.js
   - ${RAW}/src/client.js
2. 调用 cordis_define：plugin.kind="new"、idPrefix="sndfy"、name="sound-notify · 任务完成提示音"，
   code.host 与 code.client 分别填入上面两个文件的完整内容。
3. 用返回的 pluginId / packageId 调用 cordis_run（mode="run"）；若界面出现审批，请点允许。
4. 完成后提醒我去 设置 → 提示音 配置即可。`

function offlinePrompt() {
  const host = readFileSync(join(here, 'src', 'host.js'), 'utf8')
  const client = readFileSync(join(here, 'src', 'client.js'), 'utf8')
  return `（无网络自包含版）请安装并运行插件「sound-notify（任务完成提示音）」：
调用 cordis_define：plugin.kind="new"、idPrefix="sndfy"、name="sound-notify · 任务完成提示音"，
code.host 填下面【HOST】代码块的完整内容、code.client 填下面【CLIENT】代码块的完整内容；
再用返回的 pluginId / packageId 调用 cordis_run（mode="run"），出现审批请点允许。

【HOST】
${host}

【CLIENT】
${client}
`
}

let out
if (process.argv.includes('--offline')) out = offlinePrompt()
else out = shortPrompt

process.stdout.write(out + '\n')

if (process.argv.includes('--copy')) {
  const { execSync } = await import('node:child_process')
  try {
    if (process.platform === 'win32') execSync('clip', { input: out })
    else if (process.platform === 'darwin') execSync('pbcopy', { input: out })
    else execSync('xclip -selection clipboard', { input: out })
    console.log('\n[已复制到剪贴板，直接粘贴给 DeepseekHarness 会话即可]')
  } catch {
    console.log('\n[自动复制失败，请手动复制上方内容]')
  }
}
