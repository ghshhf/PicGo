// ========================================================================
// 06_commit.ts  — 上传流水线 Step 6：提交（写回 + 通知）
//
// 职责（对应 glibc-packages build-cross.sh 的 install()）：
//   1. 将上传结果写入相册（可选，本层只填充 ctx.results）
//   2. 生成 Markdown 格式链接
//   3. 把结果同步到剪贴板（可选，由上层通过 onSuccess 处理）
//   4. 发出最终 onSuccess 回调（由 upload_ctx.ts 的 finalize 触发）
//
// 本 step 只是"收尾"——真实的写剪贴板/写相册由上层通过监听事件完成
// ========================================================================

import {
  UploadCtx,
  UploadErrCode,
  UploadStepFn,
  UploadStepState,
  STEP,
} from '../upload_ctx.h'
import { emitStepProgress } from '../upload_ctx'
import { appendHistory, appendHashIndex, HashIndexRecord } from '../upload_history'

export const run: UploadStepFn = async (
  ctx: UploadCtx,
): Promise<UploadErrCode> => {
  emitStepProgress(STEP.COMMIT, UploadStepState.RUNNING, 0)

  // 1) 确保每个结果都有 markdownUrl（二次保障）
  for (const r of ctx.results) {
    if (!r.markdownUrl) {
      r.markdownUrl = `![](${r.imgUrl})`
    }
  }

  // 2) 汇总到 runtime（便于上层通过 getCtx 获取）
  ctx.runtime.commitSummary = {
    total: ctx.results.length,
    urls: ctx.results.map((r) => r.imgUrl),
    markdownUrls: ctx.results.map((r) => r.markdownUrl),
    joinedMarkdown: ctx.results.map((r) => r.markdownUrl).join('\n'),
  }

  // 3) 写入用户本地相册（JSON Lines，~/.picgo-upload-layer/history.jsonl）
  //    这是 PicGo 传统里最经典的"相册"功能的底层实现
  const routeName = ctx.runtime.configuredRoute?.name || ctx.currentRoute || 'unknown'
  try {
    const records = appendHistory(ctx.results, routeName)
    ctx.runtime.historyIds = records.map((r) => r.id)
    ctx.runtime.historyCount = records.length
  } catch (e) {
    // 相册写入失败不能导致整个上传失败（降级方案：仍返回成功，但记录错误信息）
    ctx.runtime.historyError = String(e)
  }

  // 4) 写入跨批 hash-index：下次相同内容的图片会命中并复用 URL
  try {
    const hashRecords: HashIndexRecord[] = []
    for (const r of ctx.results) {
      // 只记录非 reused（即实际真实上传产生的 URL）
      if (r.file?.hash && !r.file.reuseUrl) {
        hashRecords.push({
          hash: r.file.hash,
          imgUrl: r.imgUrl,
          route: routeName,
          createdAt: r.uploadedAt || Date.now(),
        })
      }
    }
    if (hashRecords.length > 0) {
      appendHashIndex(hashRecords)
      ctx.runtime.hashIndexCount = hashRecords.length
    }
  } catch (e) {
    // hash-index 写入失败也不影响上传结果
    ctx.runtime.hashIndexError = String(e)
  }

  emitStepProgress(STEP.COMMIT, UploadStepState.SUCCESS, 100)
  return UploadErrCode.UPLOAD_OK
}
