// ========================================================================
// modules/qiniu.ts  — 七牛云对象存储 (KODO) 上传模块
//
// 配置字段：
//   accessKey  - 七牛云 AK
//   secretKey  - 七牛云 SK
//   bucket     - 存储桶名称
//   domain     - 下载域名（如 https://cdn.example.com）
//   path       - 上传目录前缀（可选，如 "picgo/"）
//
// 实现：
//   1. 基于 HMAC-SHA1 生成上传凭证 (uploadToken)
//   2. 用 multipart/form-data 上传到 upload.qiniup.com
//   3. 返回 domain + key 作为最终 URL
//
// 参考官方文档: https://developer.qiniu.com/kodo/manual/upload-token
// ========================================================================

import * as fs from 'fs'
import * as path from 'path'
import { createHmac, createHash } from 'node:crypto'
import { UploadFileInfo, UploadRawResult, UploaderModule, registerModule } from './registry'

const UPLOAD_HOST = 'https://upload.qiniup.com' // 华东-浙江，可按地区调整

function urlSafeBase64Encode(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf) : buf
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
}

// 生成上传凭证 (uploadToken)
function generateUploadToken(
  accessKey: string,
  secretKey: string,
  bucket: string,
  key: string,
  expiresInSec: number = 3600
): string {
  const deadline = Math.floor(Date.now() / 1000) + expiresInSec
  const policy = { scope: `${bucket}:${key}`, deadline }
  const encodedPolicy = urlSafeBase64Encode(JSON.stringify(policy))
  const hmac = createHmac('sha1', secretKey).update(encodedPolicy).digest()
  const encodedSign = urlSafeBase64Encode(hmac)
  return `${accessKey}:${encodedSign}:${encodedPolicy}`
}

// 构建 multipart form data body
function buildFormBody(
  token: string,
  key: string,
  file: UploadFileInfo
): { boundary: string; body: Buffer } {
  const boundary = 'picgo-ul-boundary-' + Date.now().toString(16)
  const buffer = fs.readFileSync(file.filePath)

  const parts: Buffer[] = []

  const addField = (name: string, value: string) => {
    parts.push(Buffer.from(`--${boundary}\r\n`))
    parts.push(Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n\r\n`))
    parts.push(Buffer.from(value))
    parts.push(Buffer.from('\r\n'))
  }

  const addFile = (buffer: Buffer) => {
    parts.push(Buffer.from(`--${boundary}\r\n`))
    parts.push(Buffer.from(`Content-Disposition: form-data; name="file"; filename="${file.fileName}"\r\n`))
    parts.push(Buffer.from(`Content-Type: ${file.mimeType}\r\n\r\n`))
    parts.push(buffer)
    parts.push(Buffer.from('\r\n'))
  }

  addField('token', token)
  addField('key', key)
  addFile(buffer)
  parts.push(Buffer.from(`--${boundary}--\r\n`))

  return { boundary, body: Buffer.concat(parts) }
}

const qiniu: UploaderModule = {
  name: 'qiniu',
  version: '0.1.0',
  description: '七牛云 KODO 对象存储',

  async upload(file: UploadFileInfo, config: Record<string, any>): Promise<UploadRawResult> {
    const { accessKey, secretKey, bucket, domain, path: pathPrefix = '' } = config

    if (!accessKey || !secretKey || !bucket || !domain) {
      throw new Error('七牛云缺少必需配置：accessKey / secretKey / bucket / domain')
    }

    // 生成 key：{pathPrefix}sha256.ext（基于文件内容的不可变 key）
    const ext = path.extname(file.fileName).toLowerCase() || '.png'
    const contentHash = createHash('sha256').update(fs.readFileSync(file.filePath)).digest('hex').slice(0, 16)
    const key = `${pathPrefix || ''}${contentHash}${ext}`.replace(/\/+/g, '/').replace(/^\//, '')

    const token = generateUploadToken(accessKey, secretKey, bucket, key)
    const { boundary, body } = buildFormBody(token, key, file)

    const resp = await fetch(UPLOAD_HOST, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    })

    const text = await resp.text()
    if (!resp.ok) {
      throw new Error(`七牛云上传失败: HTTP ${resp.status} ${text}`)
    }

    let json: any
    try {
      json = JSON.parse(text)
    } catch {
      throw new Error(`七牛云响应非 JSON: ${text}`)
    }

    // 七牛返回: { hash: "...", key: "..." }
    const normalizedDomain = domain.endsWith('/') ? domain.slice(0, -1) : domain
    const imgUrl = `${normalizedDomain}/${key}`

    return {
      imgUrl,
      webUrl: imgUrl,
      raw: json,
    }
  },

  async delete(url: string, config: Record<string, any>): Promise<boolean> {
    // 删除管理 API 较复杂（需管理凭证），这里暂用空实现
    console.warn('[qiniu] delete 暂未实现，请在七牛云控制台手动删除:', url)
    return false
  },
}

registerModule(qiniu)
export const qiniuModule = qiniu
export default qiniu
