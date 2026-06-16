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

export const run: UploadStepFn = async (
  ctx: UploadCtx,
): Promise<UploadErrCode> => {
  emitStepProgress(STEP.COMMIT, UploadStepState.RUNNING, 0)

  // 1) 确保每个结果都有 markdownUrl（虽然 step 4 已经填过，这里做二次保障）
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

  // 3) 可选：把结果写入用户本地相册（JSON 文件）— 由上层调用 onSuccess 时处理

  emitStepProgress(STEP.COMMIT, UploadStepState.SUCCESS, 100)
  return UploadErrCode.UPLOAD_OK
}
