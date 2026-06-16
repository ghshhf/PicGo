// ========================================================================
// upload_stats.ts  — 运行时统计与监控
//
// 职责：
//   1. 提供 getStats()：查询上传统计（累计次数/成功数/字节/耗时）
//   2. 提供 formatStats()：人类可读的格式化报告
//   3. 提供 resetStats()：重置统计
//   4. 提供 healthCheck()：健康检查（路由/模块状态）
//
// 设计灵感：AI-TP OS 的 worker-status：定期查询系统状态
// ========================================================================

import { getCtx } from './upload_ctx'
import { listModules } from './modules/registry'

export interface StatsReport {
  totalUploads: number
  successCount: number
  failCount: number
  successRate: string          // 百分数，如 "100.0%"
  totalBytes: number
  totalBytesHuman: string      // 人类可读，如 "1.2 MB"
  totalTimeMs: number
  avgTimeMs: string            // 平均耗时
  lastUploadAt: number
  lastUploadAtHuman: string    // ISO 格式时间
}

function bytesToHuman(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function getStats(): StatsReport {
  const ctx = getCtx()
  const total = ctx.stats.totalUploads || 0
  const success = ctx.stats.successCount || 0
  const rate = total > 0 ? ((success / total) * 100).toFixed(1) + '%' : '—'
  const avg = success > 0
    ? (ctx.stats.totalTimeMs / success).toFixed(0) + ' ms'
    : '—'

  return {
    totalUploads: total,
    successCount: success,
    failCount: ctx.stats.failCount || 0,
    successRate: rate,
    totalBytes: ctx.stats.totalBytes || 0,
    totalBytesHuman: bytesToHuman(ctx.stats.totalBytes || 0),
    totalTimeMs: ctx.stats.totalTimeMs || 0,
    avgTimeMs: avg,
    lastUploadAt: ctx.stats.lastUploadAt || 0,
    lastUploadAtHuman: ctx.stats.lastUploadAt
      ? new Date(ctx.stats.lastUploadAt).toISOString()
      : '从未上传',
  }
}

export function formatStats(): string {
  const s = getStats()
  return [
    '=== 上传统计 ===',
    `  累计次数 : ${s.totalUploads}`,
    `  成功     : ${s.successCount}`,
    `  失败     : ${s.failCount}`,
    `  成功率   : ${s.successRate}`,
    `  累计字节 : ${s.totalBytesHuman}`,
    `  平均耗时 : ${s.avgTimeMs}`,
    `  上次上传 : ${s.lastUploadAtHuman}`,
    '',
    `=== 系统状态 ===`,
    `  已注册模块: ${listModules().join(', ') || '(无)'}`,
  ].join('\n')
}

export function resetStats(): void {
  const ctx = getCtx()
  ctx.stats = {
    totalUploads: 0,
    successCount: 0,
    failCount: 0,
    totalBytes: 0,
    totalTimeMs: 0,
    lastUploadAt: 0,
  }
}

// 健康检查：返回每个路由的状态
export interface RouteHealth {
  name: string
  enabled: boolean
  moduleRegistered: boolean
  hasRequiredConfig: boolean
}

export function healthCheck(): { initialized: boolean; routes: RouteHealth[]; modules: string[] } {
  const ctx = getCtx()
  const modules = listModules()
  const routes: RouteHealth[] = ctx.routes.map((r) => ({
    name: r.name,
    enabled: r.enabled,
    moduleRegistered: modules.includes(r.name),
    hasRequiredConfig: Object.keys(r.config || {}).length > 0,
  }))
  return {
    initialized: ctx.initialized,
    routes,
    modules,
  }
}
