// ========================================================================
// upload_retry.ts  — 指数退避重试（exponential backoff）
//
// 用途：包装任意网络操作，失败时自动重试。
//
// 行为：
//   1. 第 1 次失败 → wait 200ms
//   2. 第 2 次失败 → wait 400ms
//   3. 第 3 次失败 → wait 800ms
//   4. 第 4 次后 → wait 1600ms（封顶）
//   5. 最大 maxAttempts 次（默认 3）
//
// 重试条件：
//   - 抛出异常（任何 Error）
//   - HTTP 5xx 状态码（服务端错误）
//   - 网络层面错误（如 ECONNRESET、ETIMEDOUT、ENOTFOUND、DNS 查询失败）
//
// 不重试：
//   - HTTP 4xx（客户端错误，重试也不会成功）
//
// 使用示例：
//   const result = await withRetry(() => fetch('https://api.example.com/upload'), {
//     label: '上传',
//     maxAttempts: 3,
//   })
// ========================================================================

export interface RetryOptions {
  label?: string              // 操作名（用于日志）
  maxAttempts?: number        // 最大尝试次数，默认 3
  baseDelayMs?: number        // 初始退避毫秒，默认 200
  maxDelayMs?: number         // 最大退避毫秒，默认 1600
  onRetry?: (attempt: number, error: Error, delay: number) => void
  shouldRetry?: (error: Error, attempt: number) => boolean
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'label'>> = {
  maxAttempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 1600,
  onRetry: () => {},
  shouldRetry: () => true,
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// 判断是否为"可重试"网络错误
function isRetryableNetworkError(e: Error): boolean {
  const msg = (e.message || '').toLowerCase()
  // fetch 失败时错误信息通常包含这些字符串
  const retryable = [
    'econnreset', 'etimedout', 'enotfound', 'econnrefused',
    'networkerror', 'request failed', 'fetch failed',
    'socket hang up', 'getaddrinfo',
  ]
  return retryable.some((k) => msg.includes(k))
}

// 判断 HTTP 响应是否可重试（仅 5xx 重试）
export function isRetryableStatus(status: number): boolean {
  return status >= 500 && status < 600
}

// 带重试的通用 Promise 包装
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_OPTIONS.maxAttempts
  const baseDelay = opts.baseDelayMs ?? DEFAULT_OPTIONS.baseDelayMs
  const maxDelay = opts.maxDelayMs ?? DEFAULT_OPTIONS.maxDelayMs
  const label = opts.label || 'operation'
  const onRetry = opts.onRetry || DEFAULT_OPTIONS.onRetry
  const shouldRetry = opts.shouldRetry || DEFAULT_OPTIONS.shouldRetry

  let lastError: Error
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastError = e as Error
      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay)

      // 最后一次尝试失败 → 直接抛
      if (attempt >= maxAttempts) break
      // 用户自定义不重试
      if (!shouldRetry(lastError, attempt)) break

      onRetry(attempt, lastError, delay)
      console.log(`[retry] ${label} 第 ${attempt}/${maxAttempts} 次失败：${lastError.message}；${delay}ms 后重试`)
      await sleep(delay)
    }
  }

  throw lastError!
}

// 带重试的 fetch 封装 —— 把 HTTP 5xx 也当作可重试错误
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  opts: RetryOptions = {}
): Promise<Response> {
  return withRetry(async () => {
    let resp: Response
    try {
      resp = await fetch(input, init)
    } catch (e) {
      // fetch 在网络层面失败时（无法连接）会抛异常
      if (isRetryableNetworkError(e as Error)) {
        throw e // 让外层 withRetry 重试
      }
      throw e
    }

    // HTTP 5xx → 抛异常让外层重试
    if (isRetryableStatus(resp.status)) {
      throw new Error(`HTTP ${resp.status} ${resp.statusText || ''}`)
    }
    return resp
  }, opts)
}
