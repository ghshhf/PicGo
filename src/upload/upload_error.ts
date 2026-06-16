// ========================================================================
// upload_error.ts  — 错误码辅助模块
//
// 设计灵感：libaitp-common.c 的错误处理模式 + C 的 fprintf(stderr, ...)
//   - UploadErrCode 类型在 upload_ctx.h.ts 中声明（类似 .h 的 #define）
//   - 本模块提供 code → 中文消息 / 英文消息 的映射 + 格式化辅助
//
// 用途：
//   formatError(code, detail) -> 人类可读错误消息
//   isFatal(code)              -> 判断是否需要停止流水线
// ========================================================================

import { UploadErrCode } from './upload_ctx.h'

// ---- 错误码 → 中文描述（对应 C 中 fprintf(stderr, "...")） ----
const zhMessages: Record<UploadErrCode, string> = {
  [UploadErrCode.UPLOAD_OK]:            '成功',
  [UploadErrCode.UPLOAD_ERR_INIT]:      '上传系统未初始化',
  [UploadErrCode.UPLOAD_ERR_IO]:        '文件读写失败',
  [UploadErrCode.UPLOAD_ERR_CONFIG]:    '配置错误（图床未配置 / 配置缺失）',
  [UploadErrCode.UPLOAD_ERR_NOT_FOUND]: '资源不存在（文件/图床未找到）',
  [UploadErrCode.UPLOAD_ERR_OVERLOAD]:  '系统忙，超过并发限制',
  [UploadErrCode.UPLOAD_ERR_CANCEL]:    '用户取消',
  [UploadErrCode.UPLOAD_ERR_PLUGIN]:    '图床模块异常（未注册 / 加载失败）',
  [UploadErrCode.UPLOAD_ERR_NETWORK]:   '网络错误（DNS 失败 / 超时 / HTTP 非 200）',
  [UploadErrCode.UPLOAD_ERR_VALIDATE]:  '上传结果校验失败（无效 URL / 图床返回失败）',
  [UploadErrCode.UPLOAD_ERR_UNKNOWN]:   '未知错误',
}

// ---- 错误码 → 英文描述（便于接入国际化系统） ----
const enMessages: Record<UploadErrCode, string> = {
  [UploadErrCode.UPLOAD_OK]:            'Success',
  [UploadErrCode.UPLOAD_ERR_INIT]:      'Upload system not initialized',
  [UploadErrCode.UPLOAD_ERR_IO]:        'I/O failure',
  [UploadErrCode.UPLOAD_ERR_CONFIG]:    'Configuration error',
  [UploadErrCode.UPLOAD_ERR_NOT_FOUND]: 'Resource not found',
  [UploadErrCode.UPLOAD_ERR_OVERLOAD]:  'Overload: concurrent limit exceeded',
  [UploadErrCode.UPLOAD_ERR_CANCEL]:    'Cancelled by user',
  [UploadErrCode.UPLOAD_ERR_PLUGIN]:    'Plugin error (not registered or failed)',
  [UploadErrCode.UPLOAD_ERR_NETWORK]:   'Network error (DNS / timeout / non-200)',
  [UploadErrCode.UPLOAD_ERR_VALIDATE]:  'Validation failed (invalid upload result)',
  [UploadErrCode.UPLOAD_ERR_UNKNOWN]:   'Unknown error',
}

// ---- 错误等级（用于决定是否中断流水线） ----
export const enum ErrorLevel {
  INFO = 0,    // 不影响，继续
  WARN = 1,    // 告警，但继续
  FATAL = 2,   // 必须终止
}

// 判断错误等级（类似 C 中根据返回码决定是否 exit）
export function getErrorLevel(code: UploadErrCode): ErrorLevel {
  switch (code) {
    case UploadErrCode.UPLOAD_OK:
      return ErrorLevel.INFO
    case UploadErrCode.UPLOAD_ERR_CANCEL:
      return ErrorLevel.WARN
    default:
      return ErrorLevel.FATAL
  }
}

// 格式化错误消息（对应 C 中 fprintf(stderr, "[ERROR %d] %s: %s\n", code, msg, detail)）
export function formatError(code: UploadErrCode, detail?: string, lang: 'zh' | 'en' = 'zh'): string {
  const messages = lang === 'zh' ? zhMessages : enMessages
  const base = `[UPLOAD_${code}] ${messages[code] || messages[UploadErrCode.UPLOAD_ERR_UNKNOWN]}`
  return detail ? `${base} — ${detail}` : base
}

// 简写：快速创建中文描述（最常用）
export function errorMsg(code: UploadErrCode): string {
  return zhMessages[code] || zhMessages[UploadErrCode.UPLOAD_ERR_UNKNOWN]
}

// 简写：快速判断是否致命错误（用于 step 内部决定是否继续）
export function isFatal(code: UploadErrCode): boolean {
  return getErrorLevel(code) === ErrorLevel.FATAL
}
