// ========================================================================
// 02_transform.ts  — 上传流水线 Step 2：文件转换（占位实现）
//
// 职责（对应 glibc-packages build-cross.sh 的 configure() 前的 patch）：
//   - 当前：空实现（占位，确保流水线完整性）
//   - 未来：压缩超大 PNG → 转换 JPEG / WebP / 自动加水印 等
//   - 输出：写回 ctx.files（可能修改 fileSize / filePath / hash）
//
// 设计思想：保持 pipeline 一致即使当前 step 无操作
//   好处：调用方不需要关心"要不要跳过 step 2"，统一执行即可
//   类比：glibc-packages 的 build 流程始终有 6 步，某步无操作为空函数
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
  emitStepProgress(STEP.TRANSFORM, UploadStepState.RUNNING, 0)

  if (!ctx.files || ctx.files.length === 0) {
    emitStepProgress(STEP.TRANSFORM, UploadStepState.FAILED, 0, {
      errorMsg: 'files 为空，prepare 可能失败',
    })
    return UploadErrCode.UPLOAD_ERR_IO
  }

  // TODO(未来扩展)：
  //   - 检测图片尺寸，超过阈值进行压缩
  //   - PNG 体积过大时转换为 JPEG
  //   - 添加水印
  //
  // 当前实现：原样保留
  //
  // 伪代码示例（未来接入 sharp 库时）：
  //   for (const f of ctx.files) {
  //     if (f.fileSize > 2 * 1024 * 1024) {
  //       const out = path.join(os.tmpdir(), 'picgo-' + f.hash + '.jpg')
  //       await sharp(f.filePath).resize(2048).jpeg({ quality: 85 }).toFile(out)
  //       f.filePath = out
  //       f.fileSize = fs.statSync(out).size
  //       f.mimeType = 'image/jpeg'
  //     }
  //   }

  emitStepProgress(STEP.TRANSFORM, UploadStepState.SUCCESS, 100, {
    bytesProcessed: ctx.files.reduce((s, f) => s + f.fileSize, 0),
    bytesTotal: ctx.files.reduce((s, f) => s + f.fileSize, 0),
  })
  return UploadErrCode.UPLOAD_OK
}
