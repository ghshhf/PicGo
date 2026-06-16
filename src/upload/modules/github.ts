// ========================================================================
// github.ts  — GitHub 图床模块（典型「Git 平台 Content API PUT 上传」模式）
//
// 官方 API：https://docs.github.com/en/rest/repos/contents
//   PUT https://api.github.com/repos/{owner}/{repo}/contents/{path}/{file}
//   Header: Authorization: Bearer {token}
//   Body  : { message, content: base64(file), branch }
//
// 所需配置 (config)：
//   token  : string  — GitHub Personal Access Token (需 repo 权限)
//   repo   : string  — 仓库名（如 'username/my-images'）
//   branch : string  — 分支（如 'main'）
//   path   : string  — 仓库内路径前缀（如 'img/2024'，可留空）
//   customUrl?: string — 自定义域名（如使用 jsDelivr CDN）
//
// 返回示例：
//   { content: {
//       name: "abc.jpg",
//       path: "img/2024/abc.jpg",
//       html_url: "https://github.com/.../abc.jpg",
//       download_url: "https://raw.githubusercontent.com/.../abc.jpg"
//     }
//   }
// ========================================================================

import * as fs from 'fs'

import { UploadFileInfo } from '../upload_ctx.h'
import { registerModule, UploadRawResult, UploaderModule } from './registry'

const API_BASE = 'https://api.github.com'

async function uploadToGithub(
  file: UploadFileInfo,
  config: Record<string, any>
): Promise<UploadRawResult> {
  const { token, repo, branch = 'main', path: prefix = '', customUrl } = config
  if (!token) throw new Error('[github] 缺少 token')
  if (!repo)  throw new Error('[github] 缺少 repo')

  // 1) 生成目标路径（时间戳避免重名）
  const timestamp = Date.now()
  const cleanPrefix = prefix ? prefix.replace(/\/+$/, '') + '/' : ''
  const targetPath = `${cleanPrefix}${timestamp}_${file.fileName}`

  // 2) 解析 owner/repo
  const parts = String(repo).split('/')
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`[github] repo 格式应为 'owner/name'，实际: ${repo}`)
  }
  const [owner, name] = parts

  // 3) base64 编码文件内容（GitHub Content API 要求）
  const buffer = fs.readFileSync(file.filePath)
  const content = buffer.toString('base64')

  // 4) 发起 PUT 请求
  const url = `${API_BASE}/repos/${owner}/${name}/contents/${targetPath}`
  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept':        'application/vnd.github+json',
      'Content-Type':  'application/json',
      'User-Agent':    'picgo-upload-layer',
    },
    body: JSON.stringify({
      message: `upload ${file.fileName} (picgo-upload-layer)`,
      content,
      branch,
    }),
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`[github] HTTP ${resp.status}: ${resp.statusText} — ${text.slice(0, 200)}`)
  }

  const data = await resp.json()
  const downloadUrl: string | undefined =
    data?.content?.download_url || data?.content?.git_url?.replace('git://', 'https://raw.githubusercontent.com/')

  if (!downloadUrl) {
    throw new Error(`[github] 响应缺少 download_url`)
  }

  // 5) 支持自定义域名（如 jsDelivr CDN）
  let finalImgUrl = downloadUrl
  if (customUrl) {
    finalImgUrl = customUrl
      .replace('{path}', targetPath)
      .replace('{owner}', owner)
      .replace('{repo}', name)
      .replace('{branch}', branch)
  }

  return {
    imgUrl: finalImgUrl,
    webUrl: data?.content?.html_url,
    raw: data,
  }
}

// 导出模块
export const githubModule: UploaderModule = {
  name: 'github',
  version: '1.0.0',
  upload: uploadToGithub,
}

// auto-register
registerModule(githubModule)
