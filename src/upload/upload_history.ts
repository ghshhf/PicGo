// ========================================================================
// upload_history.ts  — 上传历史（相册）持久化
//
// 存储格式：JSON Lines (JSONL / .jsonl)
//   每一行是一个独立的 JSON 对象，格式 = HistoryRecord
//
// 为什么用 JSONL：
//   1) 追加写入只需写一行，不需要重写整个文件（O(1) 而非 O(N)）
//   2) 任意行损坏不影响其他行（容错）
//   3) 查询 / 删除 基于行号做切片，性能可控
//   4) 与 glibc-packages 的 "每个包一行元信息" 思路一致
//
// 文件位置：~/.picgo-upload-layer/history.jsonl
// ========================================================================

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { UploadFileInfo, UploadResult } from './upload_ctx.h'

export interface HistoryRecord {
  id: string                    // 唯一 ID（时间戳 + 随机）
  createdAt: number            // 创建时间（ms）
  fileName: string             // 原始文件名
  filePath?: string            // 原始本地路径（可省略敏感信息）
  fileSize: number             // 文件字节数
  mime: string                 // MIME
  hash?: string                // 文件内容 hash（如果有）
  imgUrl: string               // 图床返回的 URL
  markdownUrl: string          // Markdown 链接
  route: string                // 所用图床名
  raw?: Record<string, any>    // 图床原始响应（可选，便于排查）
}

function getHistoryDir(): string {
  return path.join(os.homedir(), '.picgo-upload-layer')
}

function getHistoryPath(): string {
  return path.join(getHistoryDir(), 'history.jsonl')
}

function ensureDir(): void {
  const dir = getHistoryDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

// 生成一个简洁的 ID（足够人类可读 + 全局唯一）
function genId(): string {
  const date = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const base =
    date.getFullYear() +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    '-' +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  const rand = Math.random().toString(36).slice(2, 6)
  return `${base}-${rand}`
}

export function recordToLine(r: HistoryRecord): string {
  return JSON.stringify(r, (k, v) => (typeof v === 'bigint' ? v.toString() : v))
}

export function lineToRecord(line: string): HistoryRecord | null {
  const s = line.trim()
  if (!s) return null
  try {
    return JSON.parse(s) as HistoryRecord
  } catch {
    return null
  }
}

// 把一次上传的所有结果写入历史（调用方：Step 6 COMMIT 之后）
export function appendHistory(
  results: UploadResult[],
  routeName: string
): HistoryRecord[] {
  if (!results || results.length === 0) return []
  ensureDir()
  const filePath = getHistoryPath()

  const records: HistoryRecord[] = results.map((r) => ({
    id: genId(),
    createdAt: Date.now(),
    fileName: r.file.fileName,
    filePath: r.file.filePath,
    fileSize: r.file.fileSize,
    mime: r.file.mimeType,
    hash: r.file.hash,
    imgUrl: r.imgUrl,
    markdownUrl: r.markdownUrl,
    route: routeName,
    raw: r.raw,
  }))

  // 追加写入（UTF-8，每行一个 JSON）
  const content = records.map(recordToLine).join('\n') + '\n'
  fs.appendFileSync(filePath, content, 'utf-8')
  return records
}

// 读取全部历史（按时间倒序，最新在最前）
export function getHistory(limit?: number): HistoryRecord[] {
  const filePath = getHistoryPath()
  if (!fs.existsSync(filePath)) return []
  const raw = fs.readFileSync(filePath, 'utf-8')
  const lines = raw.split('\n').filter((l) => l.length > 0)
  const records: HistoryRecord[] = []
  for (const l of lines) {
    const r = lineToRecord(l)
    if (r) records.push(r)
  }
  records.sort((a, b) => b.createdAt - a.createdAt)
  if (limit && limit > 0) return records.slice(0, limit)
  return records
}

// 按图床过滤
export function getHistoryByRoute(route: string, limit?: number): HistoryRecord[] {
  return getHistory().filter((r) => r.route === route).slice(0, limit)
}

// 删除一条记录（根据 id，返回是否成功）
export function deleteHistoryById(id: string): boolean {
  const filePath = getHistoryPath()
  if (!fs.existsSync(filePath)) return false
  const raw = fs.readFileSync(filePath, 'utf-8')
  const lines = raw.split('\n')
  const kept: string[] = []
  let removed = false
  for (const l of lines) {
    const r = lineToRecord(l)
    if (r && r.id === id) {
      removed = true
      continue
    }
    if (l.length > 0) kept.push(l)
  }
  if (!removed) return false
  fs.writeFileSync(filePath, kept.join('\n') + (kept.length > 0 ? '\n' : ''), 'utf-8')
  return true
}

// 清空全部历史（慎用）
export function clearHistory(): void {
  const filePath = getHistoryPath()
  if (fs.existsSync(filePath)) fs.writeFileSync(filePath, '', 'utf-8')
}

// 格式化统计（给 CLI 用）
export function formatHistoryTable(records: HistoryRecord[]): string {
  if (records.length === 0) return '（无历史记录）'
  const lines: string[] = []
  lines.push(`共 ${records.length} 条记录，按时间倒序：`)
  lines.push('')
  for (const r of records) {
    const date = new Date(r.createdAt).toLocaleString()
    const size = bytesToHuman(r.fileSize)
    lines.push(`  [${r.id}]  ${date}  ${r.fileName}  (${r.route}, ${size})`)
    lines.push(`    ${r.imgUrl}`)
    lines.push(`    ${r.markdownUrl}`)
    lines.push('')
  }
  return lines.join('\n')
}

function bytesToHuman(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}
