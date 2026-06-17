// ========================================================================
// 03_configure.ts  — 上传流水线 Step 3：配置准备
//
// 职责（对应 glibc-packages build-cross.sh 的 configure()）：
//   1. 确认当前有选中的图床（ctx.currentRoute）
//   2. 校验该图床的配置是否完整（token / repo / path 等必填项）
//   3. 将配置暂存到 ctx.runtime.configuredRoute（供 step 4 使用）
//
// 关键点：本 step 不做网络请求，纯内存校验
// ========================================================================

import {
  UploadCtx,
  UploadErrCode,
  UploadStepFn,
  UploadStepState,
  STEP,
  UploadRoute,
} from '../upload_ctx.h'
import { emitStepProgress } from '../upload_ctx'

// 必填字段校验规则（按图床名称区分）
// 设计灵感：C 中每个模块有自己的 required fields
const REQUIRED_FIELDS: Record<string, string[]> = {
  smms:        ['token'],
  github:      ['token', 'repo', 'branch', 'path'],
  qiniu:       ['accessKey', 'secretKey', 'bucket', 'domain'],
  'tencent-cos': ['secretId', 'secretKey', 'bucket', 'region'],
  'aliyun-oss':  ['accessKeyId', 'accessKeySecret', 'bucket', 'region'],
}

function validateRouteConfig(route: UploadRoute): string | null {
  const fields = REQUIRED_FIELDS[route.name]
  if (!fields) {
    // 未登记的图床：不做强校验（第三方模块自行检查）
    return null
  }
  for (const key of fields) {
    const val = route.config[key]
    if (val === undefined || val === null || val === '') {
      return `[${route.name}] 缺少配置: ${key}`
    }
  }
  return null
}

export const run: UploadStepFn = async (
  ctx: UploadCtx,
): Promise<UploadErrCode> => {
  emitStepProgress(STEP.CONFIGURE, UploadStepState.RUNNING, 0)

  // 1) 确认有选中的图床
  if (!ctx.currentRoute) {
    emitStepProgress(STEP.CONFIGURE, UploadStepState.FAILED, 0, {
      errorMsg: '未选择图床',
    })
    return UploadErrCode.UPLOAD_ERR_CONFIG
  }

  // 2) 从路由表中查找
  const route = ctx.routes.find((r) => r.name === ctx.currentRoute)
  if (!route) {
    emitStepProgress(STEP.CONFIGURE, UploadStepState.FAILED, 0, {
      errorMsg: `找不到图床: ${ctx.currentRoute}`,
    })
    return UploadErrCode.UPLOAD_ERR_NOT_FOUND
  }

  if (!route.enabled) {
    emitStepProgress(STEP.CONFIGURE, UploadStepState.FAILED, 0, {
      errorMsg: `图床已禁用: ${ctx.currentRoute}`,
    })
    return UploadErrCode.UPLOAD_ERR_CONFIG
  }

  // 3) 校验配置
  const errMsg = validateRouteConfig(route)
  if (errMsg) {
    emitStepProgress(STEP.CONFIGURE, UploadStepState.FAILED, 0, { errorMsg })
    return UploadErrCode.UPLOAD_ERR_CONFIG
  }

  // 4) 暂存配置（供 step 4 使用）
  ctx.runtime.configuredRoute = route
  ctx.runtime.configuredAt = Date.now()

  emitStepProgress(STEP.CONFIGURE, UploadStepState.SUCCESS, 100)
  return UploadErrCode.UPLOAD_OK
}
