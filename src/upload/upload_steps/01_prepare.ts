// ========================================================================
// 01_prepare.ts  — 上传流水线 Step 1：文件准备
//
// 职责（对应 glibc-packages build-cross.sh 的 prepare()）：
//   1. 校验文件路径是否存在
//   2. 读取文件大小 / MIME 类型
//   3. 填充 ctx.files（UploadFileInfo[]）
//   4. 计算文件哈希（可选，用于去重）
//
// 注意：本 step 只做读取，不做任何上传相关网络操作
// ========================================================================

import * as fs from 'fs'
import * as path from 'path'

import {
  UploadCtx,
  UploadErrCode,
  UploadStepFn,
  UploadStepState,
  STEP,
  UploadFileInfo,
} from '../upload_ctx.h'
import { emitStepProgress } from '../upload_ctx'

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
}

function detectMime(file: string): string {
  const ext = path.extname(file).toLowerCase()
  return MIME_MAP[ext] || 'application/octet-stream'
}

// 简化的内容哈希（对应 C 中的 simple_hash()）
async function simpleHash(filePath: string): Promise<string> {
  try {
    const buf = fs.readFileSync(filePath)
    let h = 0
    for (let i = 0; i < Math.min(buf.length, 4096); i++) {
      h = ((h << 5) - h) + buf[i]
      h |= 0
    }
    return 'h' + Math.abs(h).toString(16) + '_' + buf.length
  } catch {
    return ''
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

  const total = filePaths.length
  for (let i = 0; i < total; i++) {
    const filePath = filePaths[i]

    // 1) 检查路径是否存在
    if (!fs.existsSync(filePath)) {
      emitStepProgress(STEP.PREPARE, UploadStepState.FAILED, 0, {
        errorMsg: `文件不存在: ${filePath}`,
      })
      return UploadErrCode.UPLOAD_ERR_NOT_FOUND
    }

    // 2) 读取文件元信息
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

    // 3) 大小校验（10 MB 上限，可由 configure 覆盖）
    const MAX_SIZE = 10 * 1024 * 1024
    if (stat.size > MAX_SIZE) {
      emitStepProgress(STEP.PREPARE, UploadStepState.FAILED, 0, {
        errorMsg: `文件过大: ${filePath} (${Math.round(stat.size / 1024)} KB)`,
      })
      return UploadErrCode.UPLOAD_ERR_OVERLOAD
    }

    // 4) 计算哈希（异步但轻量）
    const hash = await simpleHash(filePath)

    // 5) 填充 UploadFileInfo
    const info: UploadFileInfo = {
      fileName: path.basename(filePath),
      filePath,
      fileSize: stat.size,
      mimeType: detectMime(filePath),
      hash,
    }
    ctx.files.push(info)

    // 6) 进度更新（每完成一个文件 → 按比例）
    const progress = Math.round(((i + 1) / total) * 100)
    emitStepProgress(STEP.PREPARE, UploadStepState.RUNNING, progress, {
      bytesProcessed: stat.size,
      bytesTotal: stat.size,
    })
  }

  // 统计：累计字节数
  const totalBytes = ctx.files.reduce((sum, f) => sum + f.fileSize, 0)
  ctx.stats.totalBytes += totalBytes

  emitStepProgress(STEP.PREPARE, UploadStepState.SUCCESS, 100, {
    bytesProcessed: totalBytes,
    bytesTotal: totalBytes,
  })
  return UploadErrCode.UPLOAD_OK
}
