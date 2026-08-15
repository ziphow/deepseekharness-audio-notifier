// scripts/embed-audio.mjs —— 把一段音频内嵌进 src/host.js（重新生成内嵌默认提示音）
//
// 用法：
//   node scripts/embed-audio.mjs               使用 ../default-notify.mp3（仓库上一级）
//   node scripts/embed-audio.mjs <音频路径>     使用指定音频（mp3/wav/ogg/m4a/aac/flac/webm/wma）
//
// 说明：host.js 中的内嵌默认音频让插件开箱即用（无需任何文件）。如果你想换成自己的
// 提示音，把文件放到任意位置后运行本脚本即可，无需手工编辑那一大段 base64。
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, extname } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = process.argv[2] ? resolve(process.argv[2]) : resolve(here, '../../default-notify.mp3')

const MIME_BY_EXT = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.webm': 'audio/webm',
  '.wma': 'audio/x-ms-wma',
}
const mime = MIME_BY_EXT[extname(src).toLowerCase()] || 'audio/mpeg'

const bytes = readFileSync(src)
const dataUrl = 'data:' + mime + ';base64,' + bytes.toString('base64')

const hostPath = join(here, '../src/host.js')
const host = readFileSync(hostPath, 'utf8')
const marker = /'data:audio\/[a-z0-9.+-]+;base64,__SOUND_NOTIFY_EMBED_B64__'/
if (!marker.test(host)) {
  console.error('未在 src/host.js 找到占位符 __SOUND_NOTIFY_EMBED_B64__，请确认该占位符存在')
  process.exit(1)
}
writeFileSync(hostPath, host.replace(marker, JSON.stringify(dataUrl)))
console.log('已内嵌 ' + src + ' (' + bytes.length + ' bytes, ' + mime + ') -> src/host.js')
