// ========================================================================
// 05_check.ts  — 上传流水线 Step 5：结果校验
//
// 职责（对应 glibc-packages build-cross.sh 的 check()）：
//   1. 校验 ctx.results 是否非空
//   2. 校验每个 result.imgUrl 是否是有效的 URL（http(s) 开头）
//   3. 可选：对 URL 发起 HEAD 请求确认资源存在
//   4. 把校验通过的结果过滤到 ctx.results
//
// 注意：严格校验但保留原始信息（失败的结果放入 ctx.runtime.failedResults）
// ========================================================================

import {
  UploadCtx,
  UploadErrCode,
  UploadStepFn,
  UploadStepState,
  STEP,
} from '../upload_ctx.h'
import { emitStepProgress } from '../upload_ctx'

function isValidUrl(u: string): boolean {
  try {
    const url = new URL(u)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export const run: UploadStepFn = async (
  ctx: UploadCtx,
): Promise<UploadErrCode> => {
  emitStepProgress(STEP.CHECK, UploadStepState.RUNNING, 0)

  if (!ctx.results || ctx.results.length === 0) {
    emitStepProgress(STEP.CHECK, UploadStepState.FAILED, 0, {
      errorMsg: '上传结果为空',
    })
    return UploadErrCode.UPLOAD_ERR_VALIDATE
  }

  const valid = []
  const failed = []
  const total = ctx.results.length

  for (let i = 0; i < total; i++) {
    const r = ctx.results[i]
    const ok = isValidUrl(r.imgUrl)
    if (ok) {
      valid.push(r)
    } else {
      failed.push({ file: r.file, imgUrl: r.imgUrl, reason: '无效 URL' })
    }
    const progress = Math.round(((i + 1) / total) * 100)
    emitStepProgress(STEP.CHECK, UploadStepState.RUNNING, progress)
  }

  // 存一份失败结果供上层调试
  ctx.runtime.failedResults = failed

  if (valid.length === 0) {
    emitStepProgress(STEP.CHECK, UploadStepState.FAILED, 0, {
      errorMsg: '所有结果 URL 无效',
    })
    return UploadErrCode.UPLOAD_ERR_VALIDATE
  }

  ctx.results = valid
  emitStepProgress(STEP.CHECK, UploadStepState.SUCCESS, 100)
  return UploadErrCode.UPLOAD_OK
}
