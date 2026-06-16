// ========================================================================
// smms.ts  — SM.MS 图床模块（典型「表单 multipart/form-data 上传」模式）
//
// 官方 API：https://doc.sm.ms/
//   POST https://sm.ms/api/v2/upload
//   Header: Authorization: {token}
//   Body  : smfile = <file>
//
// 所需配置 (config)：
//   token: string  — API Token（SM.MS 后台生成）
//
// 返回示例：
//   { success: true,
//     data: {
//       url: "https://i.loli.net/2024/01/01/abc.jpg",
//       markdown: "![](https://i.loli.net/2024/01/01/abc.jpg)"
//     }
//   }
// ========================================================================

import * as fs from 'fs'
import * as path from 'path'

import { UploadFileInfo } from '../upload_ctx.h'
import { registerModule, UploadRawResult, UploaderModule } from './registry'

const API_URL = 'https://sm.ms/api/v2/upload'

async function uploadToSmms(
  file: UploadFileInfo,
  config: Record<string, any>
): Promise<UploadRawResult> {
  const { token } = config
  if (!token) throw new Error('[smms] 缺少 token')

  // 1) 构造 multipart/form-data（用纯 Node.js fetch + FormData）
  const formData = new FormData()
  const buffer = fs.readFileSync(file.filePath)
  const blob = new Blob([buffer], { type: file.mimeType })
  formData.append('smfile', blob, file.fileName)

  // 2) 发起请求
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: token,
    },
    body: formData as any,
  })

  // 3) 解析响应
  if (!resp.ok) {
    throw new Error(`[smms] HTTP ${resp.status}: ${resp.statusText}`)
  }

  let data: any
  try {
    data = await resp.json()
  } catch {
    throw new Error(`[smms] 响应不是 JSON`)
  }

  if (!data || !data.success) {
    throw new Error(`[smms] ${data?.message || '上传失败'}`)
  }

  return {
    imgUrl: data.data.url,
    webUrl: data.data.page,
    raw: data.data,
  }
}

// 导出模块（供调用方 import 后调用 registerModule）
export const smmsModule: UploaderModule = {
  name: 'smms',
  version: '1.0.0',
  upload: uploadToSmms,
}

// auto-register：import 本文件即自动注册到注册表
registerModule(smmsModule)
