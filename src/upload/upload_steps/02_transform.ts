// ========================================================================
// 02_transform.ts  — 上传流水线 Step 2：文件转换（真实实现）
//
// 职责（对应 glibc-packages build-cross.sh 的 patch()）：
//   1. MIME 类型过滤（拒绝非图片文件，提前拦截）
//   2. 文件大小合理性校验（> 20MB 发出警告，但不阻止 —— 留给各图床自己裁决）
//   3. 图片压缩（"有能力就压缩，没能力就跳过，不中断流水线" 原则）
//
// 压缩策略（可选依赖，零强制安装）：
//   压缩依赖 `sharp`，定义在 package.json 的 `optionalDependencies`。
//   - 用户执行 `npm install` 时 sharp 会自动尝试安装
//   - 若因平台原因安装失败（无预编译二进制 / 缺少 libvips），程序会在运行时
//     自动回退到「只打印日志 + 不压缩」的模式，不会让上传失败
//   - 要让压缩真正发生：在 ~/.picgo-upload-layer/config.json 的当前 route 里加
//       "transform": { "compress": true, "quality": 85, "maxWidth": 2048 }
//
// 设计灵感：glibc-packages 中 patch() 步骤在每个包上运行，
// 没 patch 的包就是空操作 —— 本 step 同样不强制所有文件都被转换。
// ========================================================================

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { createHash } from 'node:crypto'
import {
  UploadCtx,
  UploadErrCode,
  UploadStepFn,
  UploadStepState,
  STEP,
} from '../upload_ctx.h'
import { emitStepProgress } from '../upload_ctx'

// --- 常量 / 阈值（后续可从配置文件覆盖） ---
const WARN_FILE_SIZE = 20 * 1024 * 1024   // 20 MB —— 超过就打印警告
const COMPRESS_SIZE_THRESHOLD = 2 * 1024 * 1024 // 2MB —— 超过才考虑压缩
const DEFAULT_JPEG_QUALITY = 85
const DEFAULT_MAX_WIDTH = 2048

// 允许的图片 MIME（与 prepare 阶段的 MIME_MAP 保持一致，但这里做强校验）
const ALLOWED_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/tiff': 'tiff',
}

// 这些格式是"无损/体积大"的，适合在有压缩能力时优先处理
const COMPRESS_CANDIDATES = new Set(['image/png', 'image/bmp', 'image/tiff'])

// --- 可选依赖的懒加载 ---
// 用动态 import() 避免 sharp 未安装时直接 crash（静态 import 会失败）
let sharpModule: any = null
let sharpLoadAttempted = false
let sharpLoadError: string | null = null

async function loadSharp(): Promise<any> {
  if (sharpLoadAttempted) return sharpModule
  sharpLoadAttempted = true
  try {
    const mod = await import('sharp')
    sharpModule = mod.default ?? mod
    return sharpModule
  } catch (e) {
    sharpLoadError = (e as Error).message
    return null
  }
}

// sha256 同步计算（用于压缩后重新计算 hash）
function sha256FileSync(filePath: string): string {
  const buf = fs.readFileSync(filePath)
  return createHash('sha256').update(buf).digest('hex')
}

export const run: UploadStepFn = async (
  ctx: UploadCtx,
): Promise<UploadErrCode> => {
  emitStepProgress(STEP.TRANSFORM, UploadStepState.RUNNING, 0)

  if (!ctx.files || ctx.files.length === 0) {
    emitStepProgress(STEP.TRANSFORM, UploadStepState.FAILED, 0, {
      errorMsg: 'files 为空，prepare 可能失败',
    })
    return UploadErrCode.UPLOAD_ERR_IO
  }

  // 从 ctx.routes 里拿"当前选中的 route"的 transform 配置（如果存在）
  const currentRoute = ctx.routes.find((r) => r.name === ctx.runtime.configuredRoute?.name)
  const routeTransform = (currentRoute?.config as any)?.transform || {}
  const userWantCompress = routeTransform.compress === true
  const quality: number = Number(routeTransform.quality) || DEFAULT_JPEG_QUALITY
  const maxWidth: number = Number(routeTransform.maxWidth) || DEFAULT_MAX_WIDTH

  // 如果用户显式启用了压缩 —— 尝试加载 sharp（一次即可）
  if (userWantCompress) {
    const loaded = await loadSharp()
    if (!loaded) {
      console.log(
        `[transform] 启用了 compress=true，但 optional dependency "sharp" 无法加载：`
        + ` ${sharpLoadError}`
        + `\n            请运行：npm install sharp   或者暂时把 transform.compress 设为 false`
      )
    }
  }

  const totalFiles = ctx.files.length
  let compressedCount = 0
  let skippedCount = 0
  let blockedCount = 0

  for (let i = 0; i < totalFiles; i++) {
    const f = ctx.files[i]

    // --- 1) MIME 校验（强校验，失败直接拒绝该文件）---
    if (!f.mimeType || !(f.mimeType in ALLOWED_MIME)) {
      console.warn(`[transform] ${f.fileName}: MIME=${f.mimeType} 非图片格式，跳过`)
      f.fileSize = 0 // 标记为不可上传（prepare 会在下次校验中过滤掉）
      blockedCount++
      continue
    }

    // --- 2) 体积告警 ---
    if (f.fileSize > WARN_FILE_SIZE) {
      console.log(
        `[transform] ${f.fileName}: ${(f.fileSize / 1024 / 1024).toFixed(2)} MB，`
        + `体积较大，建议启用压缩（在配置文件中设置 transform.compress=true）`
      )
    }

    // --- 3) 真实压缩 —— 仅在用户显式 enable + sharp 可用 + 体积阈值 + 候选格式时执行 ---
    const shouldTryCompress: boolean =
      userWantCompress &&
      !!sharpModule &&
      f.fileSize > COMPRESS_SIZE_THRESHOLD &&
      COMPRESS_CANDIDATES.has(f.mimeType)

    if (shouldTryCompress) {
      try {
        const outPath = path.join(os.tmpdir(), `picgo-ul-${Date.now()}-${i}-${(f.hash ?? 'x').slice(0, 8)}.jpg`)
        await sharpModule(f.filePath)
          .resize({ width: maxWidth, withoutEnlargement: true, fit: 'inside' })
          .jpeg({ quality, mozjpeg: false })
          .toFile(outPath)

        const newSize = fs.statSync(outPath).size
        const oldSize = f.fileSize
        const savedPct = oldSize > 0 ? ((oldSize - newSize) / oldSize * 100).toFixed(1) : '0.0'

        f.filePath = outPath
        f.fileName = path.basename(outPath)
        f.fileSize = newSize
        f.mimeType = 'image/jpeg'
        f.hash = sha256FileSync(outPath)
        compressedCount++
        console.log(
          `[transform] ${f.fileName}: ${(oldSize / 1024).toFixed(0)} KB → ${(newSize / 1024).toFixed(0)} KB (-${savedPct}%)`
        )
      } catch (e) {
        console.warn(`[transform] 压缩失败，跳过：${f.fileName} —— ${(e as Error).message}`)
        skippedCount++
      }
    } else {
      skippedCount++
    }

    // 更新进度（transform 阶段进度按"已处理文件数"算）
    const progress = Math.round(((i + 1) / totalFiles) * 100)
    emitStepProgress(STEP.TRANSFORM, UploadStepState.RUNNING, progress, {
      bytesProcessed: ctx.files.slice(0, i + 1).reduce((s, x) => s + x.fileSize, 0),
      bytesTotal: ctx.files.reduce((s, x) => s + x.fileSize, 0),
    })
  }

  // 如果全部文件都被 block，返回失败
  const validCount = ctx.files.filter((f) => f.fileSize > 0).length
  if (validCount === 0) {
    emitStepProgress(STEP.TRANSFORM, UploadStepState.FAILED, 0, {
      errorMsg: `全部 ${totalFiles} 个文件被 transform 拒绝（非图片格式）`,
    })
    return UploadErrCode.UPLOAD_ERR_VALIDATE
  }

  // 过滤掉被 block 的文件（fileSize === 0 的）
  ctx.files = ctx.files.filter((f) => f.fileSize > 0)

  const summary = `${totalFiles} 文件，压缩成功=${compressedCount}，跳过=${skippedCount}，拒绝=${blockedCount}`
  console.log(`[transform] ${summary}`)
  emitStepProgress(STEP.TRANSFORM, UploadStepState.SUCCESS, 100, {
    errorMsg: blockedCount > 0 ? summary : undefined,
  })
  return UploadErrCode.UPLOAD_OK
}
