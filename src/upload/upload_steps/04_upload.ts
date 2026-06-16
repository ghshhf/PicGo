// ========================================================================
// 04_upload.ts  — 上传流水线 Step 4：核心上传
//
// 职责（对应 glibc-packages build-cross.sh 的 build()）：
//   1. 从 ctx.runtime.configuredRoute 获取图床配置
//   2. 到图床模块注册表中查找对应的 UploaderModule
//   3. 对 ctx.files 中的每个文件调用 module.upload(file, config)
//   4. 把结果填充到 ctx.results
//
// 关键点：
//   - 不直接 import 具体图床模块，而是通过 registry 查找（解耦）
//   - 具体图床模块在 modules/ 下独立实现，与上传流水线无关
//   - 支持并发上传（通过 Promise.all）
// ========================================================================

import {
  UploadCtx,
  UploadErrCode,
  UploadStepFn,
  UploadStepState,
  STEP,
  UploadResult,
} from '../upload_ctx.h'
import { emitStepProgress } from '../upload_ctx'
import { getModule } from '../modules/registry'

export const run: UploadStepFn = async (
  ctx: UploadCtx,
): Promise<UploadErrCode> => {
  emitStepProgress(STEP.UPLOAD, UploadStepState.RUNNING, 0)

  const route = ctx.runtime.configuredRoute
  if (!route) {
    emitStepProgress(STEP.UPLOAD, UploadStepState.FAILED, 0, {
      errorMsg: '未配置图床路由，configure 可能失败',
    })
    return UploadErrCode.UPLOAD_ERR_CONFIG
  }

  // 1) 查找图床模块
  const mod = getModule(route.name)
  if (!mod) {
    emitStepProgress(STEP.UPLOAD, UploadStepState.FAILED, 0, {
      errorMsg: `未注册的图床模块: ${route.name}`,
    })
    return UploadErrCode.UPLOAD_ERR_PLUGIN
  }

  // 2) 并发上传所有文件（限制并发数为 3）
  const files = ctx.files
  const results: (UploadResult | null)[] = new Array(files.length).fill(null)

  const CONCURRENCY = 3
  let cursor = 0
  let doneCount = 0
  const totalBytes = files.reduce((s, f) => s + f.fileSize, 0)
  let processedBytes = 0

  async function worker(): Promise<void> {
    while (cursor < files.length) {
      const idx = cursor++
      const file = files[idx]

      try {
        const raw = await mod.upload(file, route.config)

        if (!raw || !raw.imgUrl) {
          throw new Error(`module.upload 返回缺少 imgUrl`)
        }

        results[idx] = {
          file,
          imgUrl: raw.imgUrl,
          webUrl: raw.webUrl,
          markdownUrl: `![](${raw.imgUrl})`,
          raw: raw.raw || raw,
          uploadedAt: Date.now(),
        }
      } catch (e) {
        // 单个文件失败：标记为 null，并保存错误到 runtime
        ctx.runtime[`upload_error_${idx}`] = String(e)
      }

      // 更新进度（线程安全：此处只做 +=，顺序不影响总数）
      doneCount++
      processedBytes += file.fileSize
      const progress = Math.round((doneCount / files.length) * 100)
      emitStepProgress(STEP.UPLOAD, UploadStepState.RUNNING, progress, {
        bytesProcessed: processedBytes,
        bytesTotal: totalBytes,
      })
    }
  }

  // 启动 N 个 worker（线程池模式）
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, files.length) }, () => worker())
  )

  // 3) 收集成功的结果
  const successResults = results.filter((r): r is UploadResult => r !== null)

  if (successResults.length === 0) {
    emitStepProgress(STEP.UPLOAD, UploadStepState.FAILED, 0, {
      errorMsg: '全部文件上传失败',
    })
    return UploadErrCode.UPLOAD_ERR_PLUGIN
  }

  ctx.results = successResults

  // 4) 部分失败：在 runtime 中记录（供上层通过 getCtx 查询细粒度信息）
  if (successResults.length < files.length) {
    ctx.runtime.partialFailure = true
  }

  emitStepProgress(STEP.UPLOAD, UploadStepState.SUCCESS, 100, {
    bytesProcessed: totalBytes,
    bytesTotal: totalBytes,
  })
  return UploadErrCode.UPLOAD_OK
}
