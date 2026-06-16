// ========================================================================
// index.ts  — 上传图层统一入口
//
// 调用方使用方式：
//
//   import {
//     UploadContext,          // 核心：统一上下文（init/setRoute/upload/cancel）
//     UploadErrCode,          // 错误码枚举
//     UploadRoute,            // 路由/图床配置结构
//     UploadCallbacks,        // 回调接口
//     UploadStepProgress,     // 步骤进度结构
//     UploadResult,           // 上传结果
//     UploadStats,            // 统计结构
//     formatError,            // 错误码 → 中文消息
//     errorMsg,               // 快速错误消息
//     onProgress,             // 注册进度回调
//     onError,                // 注册错误回调
//     onSuccess,              // 注册成功回调
//     onCancel,               // 注册取消回调
//     bindCallbacks,          // 绑定回调到 ctx
//     clearAll,               // 清空所有回调
//     getStats,               // 查询统计
//     formatStats,            // 统计格式化报告
//     resetStats,             // 重置统计
//     healthCheck,            // 健康检查
//     registerModule,         // 注册自定义图床模块
//     getModule,              // 查询图床模块
//     listModules,            // 列出已注册图床
//   } from 'picgo-upload-layer'
//
//   import 'picgo-upload-layer/src/upload/modules'  // 加载内置 smms/github
//
//   // 最简示例：
//   UploadContext.init()
//   UploadContext.registerRoute({
//     name: 'smms', host: 'sm.ms', protocol: 'https',
//     priority: 1, enabled: true, config: { token: 'YOUR_TOKEN' },
//   })
//   UploadContext.setRoute('smms')
//   UploadContext.upload(['/path/to/img.png'])
// ========================================================================

// ---- 核心（类型声明 + 实现） ----
export * from './upload_ctx.h'
export { UploadContext, getCtx } from './upload_ctx'

// ---- 错误处理 ----
export { formatError, errorMsg, isFatal, getErrorLevel, ErrorLevel } from './upload_error'

// ---- 回调系统 ----
export {
  onProgress, onError, onSuccess, onCancel,
  bindCallbacks, clearAll, off,
} from './upload_callback'

// ---- 统计监控 ----
export { getStats, formatStats, resetStats, healthCheck } from './upload_stats'
export type { StatsReport, RouteHealth } from './upload_stats'

// ---- 图床模块 ----
export {
  registerModule, getModule, listModules, unregisterModule, clearModules,
} from './modules/registry'
export type { UploaderModule, UploadRawResult } from './modules/registry'

// 注意：不自动 export './modules/index'
// 因为 modules/ 会触发网络请求，调用方按需 import
//   - 仅用测试 mock：不 import
//   - 用内置 smms/github：import 'picgo-upload-layer/src/upload/modules'
//   - 用自定义模块：registerModule({ name, version, upload })
