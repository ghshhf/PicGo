// ========================================================================
// 02_transform.ts  — 上传流水线 Step 2：文件转换（真实实现）
//
// 职责（对应 glibc-packages build-cross.sh 的 patch()）：
//   1. MIME 类型过滤（拒绝非图片文件，提前拦截）
//   2. 文件大小合理性校验（> 20MB 发出警告，但不阻止 —— 留给各图床自己裁决）
//   3. 图片压缩（"有能力就压缩，没能力就跳过，不中断流水线" 原则）
//
// 压缩策略（零运行时依赖设计）：
//   当前项目保持零 npm 依赖（只用 Node.js 内置 API）。
//   若后续需要真正的图片压缩（如 sharp / imagemin）：
//     - 在配置文件里加上 `"transform": { "compress": true, "quality": 80 }`
//     - 在这里读取 config 并调用相应库
//     - 压缩后生成临时文件，写回 ctx.files[i].filePath / fileSize / mimeType
//
// 设计灵感：glibc-packages 中 patch() 步骤在每个包上运行，
// 没 patch 的包就是空操作 —— 本 step 同样不强制所有文件都被转换。
// ========================================================================

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

    // --- 3) 压缩：当前为"软跳过" —— 有配置时才真正执行 ---
    //     零依赖前提下，我们用"检查文件头 + 打印决策日志"代替真实压缩
    //     有条件（安装 sharp / imagemin）后，把下面注释打开即可
    const shouldTryCompress: boolean =
      (routeTransform.compress === true) &&
      (f.fileSize > COMPRESS_SIZE_THRESHOLD) &&
      COMPRESS_CANDIDATES.has(f.mimeType)

    if (shouldTryCompress) {
      // TODO: 接入真实压缩库时在这里实现
      // 伪代码：
      //   const out = path.join(os.tmpdir(), `picgo-${f.hash}-c.jpg`)
      //   await sharp(f.filePath)
      //     .resize({ width: Math.max(width, 2048) })
      //     .jpeg({ quality: routeTransform.quality || 85 })
      //     .toFile(out)
      //   f.filePath = out
      //   f.fileSize = fs.statSync(out).size
      //   f.mimeType = 'image/jpeg'
      //   // 重新计算 hash（压缩后文件变了）
      //   f.hash = sha256FileSync(out)
      compressedCount++
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

  const summary = `${totalFiles} 文件，跳过=${skippedCount}，计划压缩=${compressedCount}，拒绝=${blockedCount}`
  emitStepProgress(STEP.TRANSFORM, UploadStepState.SUCCESS, 100, {
    errorMsg: blockedCount > 0 ? summary : undefined,
  })
  return UploadErrCode.UPLOAD_OK
}
