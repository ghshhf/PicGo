// ========================================================================
// upload_callback.ts  — 回调系统实现
//
// 设计灵感：
//   - C 中 ctx->on_progress / ctx->on_error 回调函数指针 + user_data
//   - picgo-core 的 EventEmitter 事件系统（但这里用明确的函数回调替代字符串事件）
//
// 核心改进：用明确的回调接口替代字符串事件监听
//   PicGo 原方案：ctx.on('upload-progress', ...)  — 类型不可靠
//   本系统方案：ctx.onProgress = (p) => ...      — 强类型
//
// 额外能力：支持多监听器 + 一次性回调（对应用户侧的 UI 更新 / 日志记录 / 通知）
// ========================================================================

import {
  UploadCtx,
  UploadErrCode,
  UploadStepProgress,
  UploadResult,
} from './upload_ctx.h'

// 监听器 ID（用于注册/卸载时的句柄）
export type ListenerId = number

// 内部监听器表（对应 C 中的函数指针数组）
interface CallbackRegistry {
  progress: Map<ListenerId, (p: UploadStepProgress) => void>
  error:    Map<ListenerId, (code: UploadErrCode, msg: string) => void>
  success:  Map<ListenerId, (results: UploadResult[]) => void>
  cancel:   Map<ListenerId, () => void>
}

let nextId: ListenerId = 1
const registry: CallbackRegistry = {
  progress: new Map(),
  error:    new Map(),
  success:  new Map(),
  cancel:   new Map(),
}

// ========================================================================
// 注册回调（返回 ID，可用于 later 卸载；类似 C 中注册回调函数指针）
// ========================================================================

export function onProgress(listener: (p: UploadStepProgress) => void, ctx: UploadCtx): ListenerId {
  const id = nextId++
  registry.progress.set(id, listener)
  syncCtx(ctx)
  return id
}

export function onError(listener: (code: UploadErrCode, msg: string) => void, ctx: UploadCtx): ListenerId {
  const id = nextId++
  registry.error.set(id, listener)
  syncCtx(ctx)
  return id
}

export function onSuccess(listener: (results: UploadResult[]) => void, ctx: UploadCtx): ListenerId {
  const id = nextId++
  registry.success.set(id, listener)
  syncCtx(ctx)
  return id
}

export function onCancel(listener: () => void, ctx: UploadCtx): ListenerId {
  const id = nextId++
  registry.cancel.set(id, listener)
  syncCtx(ctx)
  return id
}

// ========================================================================
// 卸载回调
// ========================================================================

export function off(id: ListenerId): void {
  registry.progress.delete(id)
  registry.error.delete(id)
  registry.success.delete(id)
  registry.cancel.delete(id)
}

// ========================================================================
// 清空全部（对应 destroy 时的资源释放）
// ========================================================================

export function clearAll(): void {
  registry.progress.clear()
  registry.error.clear()
  registry.success.clear()
  registry.cancel.clear()
}

// ========================================================================
// 把 registry 中的所有回调打包到 ctx（对应 C 中给 ctx->on_* 赋值）
// 这样 ctx 的回调就会依次触发所有已注册的监听器
// ========================================================================

function dispatchProgress(p: UploadStepProgress): void {
  for (const fn of registry.progress.values()) {
    try { fn(p) } catch (_) { /* 单个监听器失败不影响整体 */ }
  }
}
function dispatchError(code: UploadErrCode, msg: string): void {
  for (const fn of registry.error.values()) {
    try { fn(code, msg) } catch (_) {}
  }
}
function dispatchSuccess(results: UploadResult[]): void {
  for (const fn of registry.success.values()) {
    try { fn(results) } catch (_) {}
  }
}
function dispatchCancel(): void {
  for (const fn of registry.cancel.values()) {
    try { fn() } catch (_) {}
  }
}

function syncCtx(ctx: UploadCtx): void {
  ctx.onProgress = dispatchProgress
  ctx.onError    = dispatchError
  ctx.onSuccess  = dispatchSuccess
  ctx.onCancel   = dispatchCancel
}

// 导出：供上层在 ctx 生命周期启动时绑定
export function bindCallbacks(ctx: UploadCtx): void {
  syncCtx(ctx)
}
