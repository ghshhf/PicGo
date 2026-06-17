// ========================================================================
// 01_prepare.ts  — 上传流水线 Step 1：文件准备
//
// 职责（对应 glibc-packages build-cross.sh 的 prepare()）：
//   1. 校验文件路径是否存在
//   2. 读取文件大小 / MIME 类型
//   3. 计算 SHA-256 哈希（用于真正的文件内容去重）
//   4. 去重：同一批上传中相同内容的文件只保留一份
//   5. 填充 ctx.files（UploadFileInfo[]）
//
// 注意：本 step 只做读取，不做任何上传相关网络操作
// ========================================================================

import * as fs from 'fs'
import * as path from 'path'
import { createHash } from 'node:crypto'

import {
  UploadCtx,
  UploadErrCode,
  UploadStepFn,
  UploadStepState,
  STEP,
  UploadFileInfo,
} from '../upload_ctx.h'
import { emitStepProgress } from '../upload_ctx'
import { getHashIndex, appendHashIndex, HashIndexRecord } from '../upload_history'

// 文件扩展名 → MIME 映射（极简版，可按需扩展）
const MIME_MAP: Record<string, string> = {
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.bmp':  'image/bmp',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.avif': 'image/avif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.tif':  'image/tiff',
  '.tiff': 'image/tiff',
}

function detectMime(file: string): string {
  const ext = path.extname(file).toLowerCase()
  return MIME_MAP[ext] || 'application/octet-stream'
}

// 真正的 SHA-256 哈希（分块 64KB，避免一次性读大文件）
function sha256FileSync(filePath: string): string {
  const hash = createHash('sha256')
  const CHUNK = 64 * 1024
  const fd = fs.openSync(filePath, 'r')
  try {
    const stat = fs.fstatSync(fd)
    let remaining = stat.size
    const buf = Buffer.allocUnsafe(Math.min(CHUNK, remaining))
    while (remaining > 0) {
      const toRead = Math.min(CHUNK, remaining)
      const bytesRead = fs.readSync(fd, buf, 0, toRead, null)
      hash.update(buf.subarray(0, bytesRead))
      remaining -= bytesRead
    }
    return hash.digest('hex')
  } finally {
    try { fs.closeSync(fd) } catch { /* ignore */ }
  }
}

export const run: UploadStepFn = async (
  ctx: UploadCtx,
  filePaths: string[] = []
): Promise<UploadErrCode> => {
  emitStepProgress(STEP.PREPARE, UploadStepState.RUNNING, 0)
  ctx.files = []

  if (!filePaths || filePaths.length === 0) {
    emitStepProgress(STEP.PREPARE, UploadStepState.FAILED, 0, { errorMsg: '空文件列表' })
    return UploadErrCode.UPLOAD_ERR_IO
  }

  // 同批去重：按内容哈希（sha256）+ 路径去重
  const seenHashes = new Set<string>()
  const seenPaths = new Set<string>()

  // 跨批去重：hash-index 是持久化的，记录已成功上传过的 (hash → URL)
  // 如果 --force，则跳过 hash-index 检查（强制上传）
  const crossIndex: Map<string, HashIndexRecord> = (ctx.runtime as any).forceUpload
    ? new Map<string, HashIndexRecord>()
    : getHashIndex()
  let crossDedup = 0

  const total = filePaths.length
  for (let i = 0; i < total; i++) {
    const filePath = filePaths[i]

    // 1) 检查路径：避免重复路径
    if (seenPaths.has(filePath)) {
      continue // 完全相同的路径，跳过
    }
    seenPaths.add(filePath)

    // 2) 检查路径是否存在
    if (!fs.existsSync(filePath)) {
      emitStepProgress(STEP.PREPARE, UploadStepState.FAILED, 0, {
        errorMsg: `文件不存在: ${filePath}`,
      })
      return UploadErrCode.UPLOAD_ERR_NOT_FOUND
    }

    // 3) 读取文件元信息
    let stat: fs.Stats
    try {
      stat = fs.statSync(filePath)
    } catch {
      emitStepProgress(STEP.PREPARE, UploadStepState.FAILED, 0, {
        errorMsg: `stat 失败: ${filePath}`,
      })
      return UploadErrCode.UPLOAD_ERR_IO
    }

    if (!stat.isFile()) {
      emitStepProgress(STEP.PREPARE, UploadStepState.FAILED, 0, {
        errorMsg: `不是文件: ${filePath}`,
      })
      return UploadErrCode.UPLOAD_ERR_IO
    }

    // 4) 大小校验（默认 50 MB 上限，单张截图一般 < 5MB，留足余量）
    const MAX_SIZE = 50 * 1024 * 1024
    if (stat.size > MAX_SIZE) {
      emitStepProgress(STEP.PREPARE, UploadStepState.FAILED, 0, {
        errorMsg: `文件过大: ${filePath} (${Math.round(stat.size / 1024)} KB)`,
      })
      return UploadErrCode.UPLOAD_ERR_OVERLOAD
    }

    if (stat.size === 0) {
      emitStepProgress(STEP.PREPARE, UploadStepState.FAILED, 0, {
        errorMsg: `空文件: ${filePath}`,
      })
      return UploadErrCode.UPLOAD_ERR_IO
    }

    // 5) 计算 SHA-256（真正的内容哈希）+ 去重
    let hash: string
    try {
      hash = sha256FileSync(filePath)
    } catch {
      // 哈希失败降级为空字符串，但不终止整体流程
      hash = ''
    }
    if (hash && seenHashes.has(hash)) {
      // 同内容文件已存在于本次上传中，跳过，不重复上传
      continue
    }
    if (hash) seenHashes.add(hash)

    // 5b) 跨批去重：若 hash 在 hash-index 中有对应 URL，记录下来
    // upload 会在 04 步骤直接使用该 URL，跳过真实上传
    let reuseUrl: string | undefined
    if (hash) {
      const existing = crossIndex.get(hash)
      if (existing) {
        reuseUrl = existing.imgUrl
        crossDedup++
      }
    }

    // 6) 填充 UploadFileInfo
    const info: UploadFileInfo = {
      fileName: path.basename(filePath),
      filePath,
      fileSize: stat.size,
      mimeType: detectMime(filePath),
      hash,
      ...(reuseUrl ? { reuseUrl } : {})
    }
    ctx.files.push(info)

    // 7) 进度更新
    const progress = Math.round(((i + 1) / total) * 100)
    emitStepProgress(STEP.PREPARE, UploadStepState.RUNNING, progress, {
      bytesProcessed: stat.size,
      bytesTotal: stat.size,
    })
  }

  // 如果去重后所有文件都被跳过，返回错误
  if (ctx.files.length === 0) {
    emitStepProgress(STEP.PREPARE, UploadStepState.FAILED, 0, {
      errorMsg: '去重后无有效文件',
    })
    return UploadErrCode.UPLOAD_ERR_IO
  }

  // 统计：累计字节数
  const totalBytes = ctx.files.reduce((sum, f) => sum + f.fileSize, 0)
  ctx.stats.totalBytes += totalBytes

  const dedup = total - ctx.files.length
  const dedupMsg = dedup > 0 ? ` (去重跳过 ${dedup} 个)` : ''
  const crossMsg = crossDedup > 0 ? ` (历史复用 ${crossDedup} 个)` : ''
  emitStepProgress(STEP.PREPARE, UploadStepState.SUCCESS, 100, {
    bytesProcessed: totalBytes,
    bytesTotal: totalBytes,
    errorMsg: (dedupMsg + crossMsg).trim() || undefined,
  })
  return UploadErrCode.UPLOAD_OK
}
