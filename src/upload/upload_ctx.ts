// ========================================================================
// upload_ctx.ts  — 上传上下文实现（对应 AI-TP OS 的 .c 源文件）
//
// 设计灵感：
//   - ai-tp-gateway.c: ai_tp_gw_init() / ai_tp_gw_start() / 路由管理
//   - ai-storage.c:  ai_storage_put() 等核心 API
//   - libaitp-common.c: aitp_* 辅助函数
//
// 核心：维护全局单例 ctx，对外暴露 UploadContext API
// ========================================================================

import {
  UploadCtx,
  UploadErrCode,
  UploadRoute,
  UploadStats,
  UploadCtxApi,
  UploadStepState,
  STEP,
  STEP_NAMES,
} from './upload_ctx.h'

// ========================================================================
// 内部辅助函数（类似 C 中 static 函数，不对外导出）
// ========================================================================

// 创建一个空的统计对象
function createEmptyStats(): UploadStats {
  return {
    totalUploads: 0,
    successCount: 0,
    failCount: 0,
    totalBytes: 0,
    totalTimeMs: 0,
    lastUploadAt: 0,
  }
}

// 在路由表中按名称查找（对应 C 的 find_route_index）
function findRouteIndex(routes: UploadRoute[], name: string): number {
  for (let i = 0; i < routes.length; i++) {
    if (routes[i].name === name) return i
  }
  return -1
}

// failover：从 routes 中选出「下一个可尝试的 route」
// 规则：enabled=true、未被尝试过、按 priority 升序（小的优先）
function pickNextRoute(
  routes: UploadRoute[],
  triedRoutes: Set<string>
): string | null {
  const candidates = routes
    .filter((r) => r.enabled && !triedRoutes.has(r.name))
    .sort((a, b) => a.priority - b.priority)
  return candidates.length > 0 ? candidates[0].name : null
}

// 简短错误码描述（给日志用，避免中文乱码或过长输出）
function formatErrorShort(code: UploadErrCode): string {
  const names: Record<number, string> = {
    0: 'UPLOAD_OK',
    1: 'UPLOAD_ERR_INIT',
    2: 'UPLOAD_ERR_IO',
    3: 'UPLOAD_ERR_CONFIG',
    4: 'UPLOAD_ERR_NOT_FOUND',
    5: 'UPLOAD_ERR_OVERLOAD',
    6: 'UPLOAD_ERR_CANCEL',
    7: 'UPLOAD_ERR_PLUGIN',
    8: 'UPLOAD_ERR_NETWORK',
    9: 'UPLOAD_ERR_VALIDATE',
    99: 'UPLOAD_ERR_UNKNOWN',
  }
  return names[code] || `CODE_${code}`
}

// ========================================================================
// 全局单例上下文（对应 C 中 static 全局 ctx 变量）
// ========================================================================

const ctx: UploadCtx = {
  initialized: false,
  running: false,
  currentRoute: null,
  routes: [],
  files: [],
  results: [],
  stats: createEmptyStats(),
  runtime: {},
}

// ========================================================================
// 生命周期（对应 ai_tp_gw_init / ai_tp_gw_destroy / ai_tp_gw_start）
// ========================================================================

function init(routes?: UploadRoute[]): UploadErrCode {
  if (ctx.initialized) {
    return UploadErrCode.UPLOAD_OK
  }
  ctx.initialized = true
  ctx.running = false
  ctx.routes = routes ? [...routes] : []
  ctx.currentRoute = routes && routes.length > 0 ? routes[0].name : null
  ctx.files = []
  ctx.results = []
  ctx.stats = createEmptyStats()
  ctx.runtime = {}
  return UploadErrCode.UPLOAD_OK
}

function destroy(): void {
  if (!ctx.initialized) return
  ctx.running = false
  ctx.initialized = false
  ctx.files = []
  ctx.results = []
  ctx.routes = []
  ctx.currentRoute = null
  ctx.onProgress = undefined
  ctx.onError = undefined
  ctx.onSuccess = undefined
  ctx.onCancel = undefined
  ctx.runtime = {}
}

function reset(): UploadErrCode {
  if (!ctx.initialized) return UploadErrCode.UPLOAD_ERR_INIT
  ctx.running = false
  ctx.files = []
  ctx.results = []
  ctx.runtime = {}
  return UploadErrCode.UPLOAD_OK
}

// ========================================================================
// 路由管理（对应 ai_tp_gw_add_route / ai_tp_gw_remove_route / find）
// ========================================================================

function setRoute(name: string): UploadErrCode {
  if (!ctx.initialized) return UploadErrCode.UPLOAD_ERR_INIT
  const idx = findRouteIndex(ctx.routes, name)
  if (idx < 0) return UploadErrCode.UPLOAD_ERR_NOT_FOUND
  if (!ctx.routes[idx].enabled) return UploadErrCode.UPLOAD_ERR_CONFIG
  ctx.currentRoute = name
  return UploadErrCode.UPLOAD_OK
}

function getRoutes(): UploadRoute[] {
  return [...ctx.routes]
}

function registerRoute(route: UploadRoute): UploadErrCode {
  if (!ctx.initialized) return UploadErrCode.UPLOAD_ERR_INIT
  if (findRouteIndex(ctx.routes, route.name) >= 0) return UploadErrCode.UPLOAD_ERR_CONFIG
  ctx.routes.push({ ...route })
  ctx.routes.sort((a, b) => a.priority - b.priority)
  if (!ctx.currentRoute && route.enabled) ctx.currentRoute = route.name
  return UploadErrCode.UPLOAD_OK
}

function removeRoute(name: string): UploadErrCode {
  if (!ctx.initialized) return UploadErrCode.UPLOAD_ERR_INIT
  const idx = findRouteIndex(ctx.routes, name)
  if (idx < 0) return UploadErrCode.UPLOAD_ERR_NOT_FOUND
  ctx.routes.splice(idx, 1)
  if (ctx.currentRoute === name) {
    const next = ctx.routes.find((r) => r.enabled)
    ctx.currentRoute = next ? next.name : null
  }
  return UploadErrCode.UPLOAD_OK
}

function getCurrentRoute(): UploadRoute | null {
  if (!ctx.currentRoute) return null
  const idx = findRouteIndex(ctx.routes, ctx.currentRoute)
  return idx >= 0 ? ctx.routes[idx] : null
}

// ========================================================================
// 核心上传入口（对应 ai_storage_put + 6步流水线）
//
// PREPARE   → 读取文件元信息
// TRANSFORM → 图片压缩/格式转换（当前空实现，预留扩展）
// CONFIGURE → 选择并校验图床配置
// UPLOAD    → 调用图床模块实际上传
// CHECK     → 校验上传结果（URL 有效性等）
// COMMIT    → 写入相册、复制链接、回调通知
// ========================================================================

async function upload(files: string[]): Promise<UploadErrCode> {
  if (!ctx.initialized) return UploadErrCode.UPLOAD_ERR_INIT
  if (ctx.running) return UploadErrCode.UPLOAD_ERR_OVERLOAD
  if (!ctx.currentRoute) return UploadErrCode.UPLOAD_ERR_CONFIG
  if (!files || files.length === 0) return UploadErrCode.UPLOAD_ERR_IO

  ctx.running = true
  ctx.files = []
  ctx.results = []
  ctx.stats.totalUploads++
  const startTime = Date.now()

  try {
    // ---------- Step 1: PREPARE（读取文件元信息） ----------
    const step1 = await import('./upload_steps/01_prepare')
    const r1 = await step1.run(ctx, files)
    if (r1 !== UploadErrCode.UPLOAD_OK) {
      return finalize(r1, startTime)
    }

    // ---------- Step 2: TRANSFORM（图片预处理） ----------
    const step2 = await import('./upload_steps/02_transform')
    const r2 = await step2.run(ctx)
    if (r2 !== UploadErrCode.UPLOAD_OK) {
      return finalize(r2, startTime)
    }

    // ---------- Step 3-6: 在单个 route 上完成完整上传流程 ----------
    // 含 failover：当前 route 失败时自动切换下一个 enabled route
    // 算法：按 priority 排序 → 依次尝试 → 第一个成功的 route 就是最终选择
    const triedRoutes = new Set<string>()
    let finalCode: UploadErrCode = UploadErrCode.UPLOAD_OK
    let succeeded: boolean = false

    while (true) {
      // Step 3: CONFIGURE（选择当前 route）
      const step3 = await import('./upload_steps/03_configure')
      const r3 = await step3.run(ctx)
      if (r3 !== UploadErrCode.UPLOAD_OK) {
        // configure 失败 → 记录并尝试下一个 route
        triedRoutes.add(ctx.currentRoute || '')
        const next = pickNextRoute(ctx.routes, triedRoutes)
        if (!next) {
          finalCode = r3
          break
        }
        ctx.currentRoute = next
        continue
      }

      // Step 4: UPLOAD（核心上传）
      const step4 = await import('./upload_steps/04_upload')
      const r4 = await step4.run(ctx)
      if (r4 !== UploadErrCode.UPLOAD_OK) {
        triedRoutes.add(ctx.currentRoute || '')
        const next = pickNextRoute(ctx.routes, triedRoutes)
        if (!next) {
          finalCode = r4
          break
        }
        ctx.currentRoute = next
        ctx.results = [] // 清除失败 route 的部分结果
        continue
      }

      // Step 5: CHECK（校验结果）
      const step5 = await import('./upload_steps/05_check')
      const r5 = await step5.run(ctx)
      if (r5 !== UploadErrCode.UPLOAD_OK) {
        triedRoutes.add(ctx.currentRoute || '')
        const next = pickNextRoute(ctx.routes, triedRoutes)
        if (!next) {
          finalCode = r5
          break
        }
        ctx.currentRoute = next
        ctx.results = []
        continue
      }

      // Step 6: COMMIT（写回+通知）
      const step6 = await import('./upload_steps/06_commit')
      const r6 = await step6.run(ctx)
      if (r6 !== UploadErrCode.UPLOAD_OK) {
        triedRoutes.add(ctx.currentRoute || '')
        const next = pickNextRoute(ctx.routes, triedRoutes)
        if (!next) {
          finalCode = r6
          break
        }
        ctx.currentRoute = next
        ctx.results = []
        continue
      }

      // 全流程成功
      succeeded = true
      finalCode = r6
      break
    }

    if (!succeeded) {
      // 所有 route 都失败了
      ctx.onError?.(finalCode, `所有 ${triedRoutes.size} 个图床都失败，最后一次错误: ${formatErrorShort(finalCode)}`)
    }
    return finalize(finalCode, startTime)

  } catch (e) {
    ctx.onError?.(UploadErrCode.UPLOAD_ERR_UNKNOWN, String(e))
    return finalize(UploadErrCode.UPLOAD_ERR_UNKNOWN, startTime)
  }
}

// 统一收尾（对应 C 中函数返回前的资源清理 + 统计更新）
function finalize(code: UploadErrCode, startTime: number): UploadErrCode {
  ctx.running = false
  const elapsed = Date.now() - startTime
  ctx.stats.totalTimeMs += elapsed

  if (code === UploadErrCode.UPLOAD_OK) {
    ctx.stats.successCount++
    ctx.stats.lastUploadAt = Date.now()
    ctx.onSuccess?.(ctx.results)
  } else {
    ctx.stats.failCount++
  }
  return code
}

function cancel(): void {
  if (!ctx.running) return
  ctx.runtime.cancelled = true
  ctx.onCancel?.()
}

// ========================================================================
// 对外暴露统一 API（类似 C 通过头文件暴露的函数表）
// ========================================================================

export const UploadContext: UploadCtxApi = {
  init,
  destroy,
  reset,
  setRoute,
  getRoutes,
  registerRoute,
  removeRoute,
  getCurrentRoute,
  upload,
  cancel,
  getCtx: () => ctx,
}

// 为内部模块暴露只读/可写的上下文
export function getCtx(): UploadCtx {
  return ctx
}

// 辅助：发出进度事件（供 step 内部调用）
export function emitStepProgress(
  step: number,
  state: UploadStepState,
  progress: number,
  extra: Partial<{ bytesProcessed: number; bytesTotal: number; errorMsg: string; elapsedMs: number }> = {}
): void {
  ctx.onProgress?.({
    step,
    stepName: STEP_NAMES[step] || `STEP-${step}`,
    state,
    progress,
    bytesProcessed: extra.bytesProcessed,
    bytesTotal: extra.bytesTotal,
    elapsedMs: extra.elapsedMs,
    errorMsg: extra.errorMsg,
  })
}
