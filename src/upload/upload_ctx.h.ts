// ========================================================================
// upload_ctx.h.ts  — 上传图层"头文件"（声明式接口）
//
// 设计灵感：glibc-packages / AI-TP OS 的 *.h 头文件
//   - 类似 ai-tp-gateway.h：声明 ai_tp_gw_context_t 统一上下文
//   - 类似 ai-storage.h：声明 UploadFileInfo + 模块接口
//   - 类似 libaitp-common.h：声明错误码枚举
//
// 所有与上传相关的类型、枚举、接口签名集中在此文件
// 一个文件即可了解整个上传系统的完整能力
// ========================================================================

// ------------------------------------------------------------------------
// 1. 错误码（对应 C 中的 #define AI_STORAGE_OK 0）
// ------------------------------------------------------------------------

export const enum UploadErrCode {
  UPLOAD_OK            = 0,   // 成功
  UPLOAD_ERR_INIT      = 1,   // 初始化失败 / 系统未初始化
  UPLOAD_ERR_IO        = 2,   // 读写错误（文件/网络）
  UPLOAD_ERR_CONFIG    = 3,   // 配置错误
  UPLOAD_ERR_NOT_FOUND = 4,   // 图床/文件不存在
  UPLOAD_ERR_OVERLOAD  = 5,   // 超过并发/大小限制
  UPLOAD_ERR_CANCEL    = 6,   // 用户取消
  UPLOAD_ERR_PLUGIN    = 7,   // 图床模块错误
  UPLOAD_ERR_NETWORK   = 8,   // 网络错误
  UPLOAD_ERR_VALIDATE  = 9,   // 结果校验失败
  UPLOAD_ERR_UNKNOWN   = 99   // 未知错误
}

// ------------------------------------------------------------------------
// 2. 文件信息结构（对应 C 中的 struct ai_storage_file_t）
// ------------------------------------------------------------------------

export interface UploadFileInfo {
  fileName: string              // 文件名（含扩展名）
  filePath: string              // 本地绝对路径
  fileSize: number              // 文件大小（字节）
  mimeType: string              // MIME 类型（image/png, image/jpeg 等）
  width?: number                // 图片宽度（可选）
  height?: number               // 图片高度（可选）
  hash?: string                 // 文件内容哈希（用于去重，类似 simple_hash）
  reuseUrl?: string             // 若 hash 匹配到已有记录，则填入 URL —— 后续步骤跳过上传
}

// ------------------------------------------------------------------------
// 3. 上传结果（对应 C 中上传返回的响应结构体）
// ------------------------------------------------------------------------

export interface UploadResult {
  file: UploadFileInfo          // 上传的原始文件信息
  imgUrl: string                // 图片直链（Markdown 用）
  webUrl?: string               // 图床网页链接（可选）
  markdownUrl: string           // 完整的 Markdown 格式链接
  raw: Record<string, any>      // 图床原始响应（保留原始信息）
  uploadedAt: number            // 上传时间戳
}

// ------------------------------------------------------------------------
// 4. 路由表（对应 C 中的 ai_tp_gw_route_t）
//
// 每个图床 = 一个 route，包含 name + config + protocol + priority
// 通过 registerRoute 注册，通过 setRoute 选择当前使用的
// ------------------------------------------------------------------------

export type UploadProtocol = 'http' | 'https' | 'webdav' | 's3' | 'custom'

export interface UploadRoute {
  name: string                  // 图床唯一标识（如 'smms', 'github'）
  host: string                  // 目标主机（用于统计/监控）
  protocol: UploadProtocol      // 上传协议类型
  priority?: number             // 优先级（数字越小越优先，未设时默认=10）
  enabled: boolean              // 是否启用
  config: Record<string, any>   // 图床私有配置（token / repo / path 等）
}

// ------------------------------------------------------------------------
// 5. Step 状态（对应 C 中连接的 state 字段）
// ------------------------------------------------------------------------

export const enum UploadStepState {
  PENDING   = 0,                // 待执行
  RUNNING   = 1,                // 执行中
  SUCCESS   = 2,                // 执行成功
  FAILED    = 3,                // 执行失败
  CANCELLED = 4                 // 已取消
}

// ------------------------------------------------------------------------
// 6. Step 进度回调结构（对应 C 中 ctx->stats 的 bytes_in / bytes_out）
// ------------------------------------------------------------------------

export interface UploadStepProgress {
  step: number                  // 当前步骤号（1-6）
  stepName: string              // 步骤名（PREPARE / TRANSFORM / ...）
  state: UploadStepState        // 执行状态
  progress: number              // 完成度（0-100）
  bytesProcessed?: number       // 已处理字节数（可选）
  bytesTotal?: number           // 总字节数（可选）
  elapsedMs?: number            // 已耗时（毫秒）
  errorMsg?: string             // 错误信息（如果失败）
}

// ------------------------------------------------------------------------
// 7. 运行时统计（对应 C 中的 ai_tp_gw_stats_t）
// ------------------------------------------------------------------------

export interface UploadStats {
  totalUploads: number          // 累计上传次数（含失败）
  successCount: number          // 成功次数
  failCount: number             // 失败次数
  totalBytes: number            // 累计传输字节数
  totalTimeMs: number           // 累计耗时（毫秒）
  lastUploadAt: number          // 上次上传时间戳
}

// ------------------------------------------------------------------------
// 8. 回调接口（对应 C 中 ctx->on_connection / ctx->user_data）
// ------------------------------------------------------------------------

export interface UploadCallbacks {
  onProgress?: (progress: UploadStepProgress) => void
  onError?:    (code: UploadErrCode, msg: string) => void
  onSuccess?:  (results: UploadResult[]) => void
  onCancel?:   () => void
}

// ------------------------------------------------------------------------
// 9. 统一上下文（核心！对应 C 中的 ai_tp_gw_context_t）
//
// 所有上传相关状态集中管理，便于调试和监控
// 全局单例：由 upload_ctx.ts 创建并维护
// ------------------------------------------------------------------------

export interface UploadCtx {
  // 生命周期
  initialized: boolean          // 是否已初始化
  running: boolean              // 是否正在上传

  // 路由表
  currentRoute: string | null   // 当前选中的图床名称
  routes: UploadRoute[]         // 所有已注册的图床路由

  // 当前批次
  files: UploadFileInfo[]       // 当前批次的文件列表
  results: UploadResult[]       // 已完成的上传结果

  // 统计
  stats: UploadStats            // 运行时统计（可通过 getStats 查询）

  // 回调
  onProgress?: UploadCallbacks['onProgress']
  onError?:    UploadCallbacks['onError']
  onSuccess?:  UploadCallbacks['onSuccess']
  onCancel?:   UploadCallbacks['onCancel']

  // 运行时临时数据（step 之间传递的共享状态）
  runtime: Record<string, any>
}

// ------------------------------------------------------------------------
// 10. 对外暴露的 API 签名（类似 C 的 extern 函数声明）
// ------------------------------------------------------------------------

export interface UploadCtxApi {
  // 生命周期
  init:    (routes?: UploadRoute[]) => UploadErrCode
  destroy: ()                       => void
  reset:   ()                       => UploadErrCode

  // 路由管理
  setRoute:        (name: string)   => UploadErrCode
  getRoutes:       ()               => UploadRoute[]
  registerRoute:   (route: UploadRoute) => UploadErrCode
  removeRoute:     (name: string)   => UploadErrCode
  getCurrentRoute: ()               => UploadRoute | null

  // 核心上传
  upload: (files: string[])         => Promise<UploadErrCode>
  cancel: ()                        => void

  // 查询
  getCtx: ()                        => UploadCtx
}

// ------------------------------------------------------------------------
// 11. Step 统一签名（所有 6 个 step 必须实现此接口）
//
// 设计灵感：glibc-packages 的 build-step 每步接收同一套上下文
// 好处：新增 step 只需复制此签名，删除 step 不会破坏其他
// ------------------------------------------------------------------------

export type UploadStepFn = (
  ctx: UploadCtx,
  filePaths?: string[]
) => UploadErrCode | Promise<UploadErrCode>

// Step 编号常量（避免魔法数字）
export const STEP = {
  PREPARE:   1,
  TRANSFORM: 2,
  CONFIGURE: 3,
  UPLOAD:    4,
  CHECK:     5,
  COMMIT:    6,
} as const

// Step 名称常量（用于日志/回调）
export const STEP_NAMES: Record<number, string> = {
  [STEP.PREPARE]:   'PREPARE',
  [STEP.TRANSFORM]: 'TRANSFORM',
  [STEP.CONFIGURE]: 'CONFIGURE',
  [STEP.UPLOAD]:    'UPLOAD',
  [STEP.CHECK]:     'CHECK',
  [STEP.COMMIT]:    'COMMIT',
}
