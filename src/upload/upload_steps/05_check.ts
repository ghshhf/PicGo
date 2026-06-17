// ========================================================================
// 05_check.ts  — 上传流水线 Step 5：校验结果
//
// 职责：
//   1. 对每个上传结果执行 HEAD 请求，确认 URL 可访问
//   2. 记录校验失败的 URL（不中断整体流程）
//   3. 如果所有结果都校验失败，整体返回错误
//
// 设计：
//   - 并发校验，单个请求超时 5s
//   - 5xx/网络失败 → soft warn（可能是 CDN 预热延迟，不判失败）
//   - 4xx（404/403/...） → hard warn（真的不可访问）
//   - 2xx → OK
// ========================================================================

import {
  UploadCtx,
  UploadErrCode,
  UploadStepFn,
  UploadStepState,
  STEP,
} from '../upload_ctx.h'
import { emitStepProgress } from '../upload_ctx'

const CHECK_TIMEOUT_MS = 5000

async function checkOneUrl(url: string): Promise<{ ok: boolean; status: number | string; msg?: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)

  try {
    const resp = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (resp.status >= 200 && resp.status < 300) {
      return { ok: true, status: resp.status }
    }
    if (resp.status >= 500) {
      return { ok: false, status: resp.status, msg: '服务端错误（可能是 CDN 预热）' }
    }
    return { ok: false, status: resp.status, msg: 'HTTP 非 2xx' }
  } catch (e: any) {
    clearTimeout(timer)
    if (e?.name === 'AbortError') {
      return { ok: false, status: 'timeout', msg: `HEAD 请求超时 ${CHECK_TIMEOUT_MS}ms` }
    }
    return { ok: false, status: 'error', msg: (e as Error).message }
  }
}

export const run: UploadStepFn = async (
  ctx: UploadCtx
): Promise<UploadErrCode> => {
  emitStepProgress(STEP.CHECK, UploadStepState.RUNNING, 0)

  const results = ctx.results || []
  if (results.length === 0) {
    emitStepProgress(STEP.CHECK, UploadStepState.SUCCESS, 100, {
      errorMsg: '没有需要校验的结果',
    })
    return UploadErrCode.UPLOAD_OK
  }

  let okCount = 0
  let warnCount = 0
  let failCount = 0

  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    const check = await checkOneUrl(r.imgUrl)

    if (check.ok) {
      okCount++
    } else if (typeof check.status === 'number' && check.status >= 500) {
      warnCount++
      console.log(`[check] ${r.file.fileName}: ${check.msg} (status=${check.status})，可能是 CDN 预热延迟`)
    } else {
      failCount++
      console.log(`[check] ${r.file.fileName}: ${check.msg} (status=${check.status})`)
    }

    const progress = Math.round(((i + 1) / results.length) * 100)
    emitStepProgress(STEP.CHECK, UploadStepState.RUNNING, progress)
  }

  const total = results.length
  const summary = `OK=${okCount}/${total}, WARN=${warnCount}, FAIL=${failCount}`
  console.log(`[check] ${summary}`)

  // 策略：只要有至少 1 个 OK，就认为成功（warn/fail 只是警告）
  // 全部失败才返回错误
  if (okCount === 0 && failCount > 0) {
    emitStepProgress(STEP.CHECK, UploadStepState.FAILED, 100, {
      errorMsg: `全部 ${total} 个 URL 校验失败`,
    })
    return UploadErrCode.UPLOAD_ERR_NETWORK
  }

  emitStepProgress(STEP.CHECK, UploadStepState.SUCCESS, 100, {
    errorMsg: failCount > 0 || warnCount > 0 ? `${summary}` : undefined,
  })
  return UploadErrCode.UPLOAD_OK
}
