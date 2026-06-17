// ========================================================================
// modules/aliyun-oss.ts  — 阿里云对象存储 (OSS) 上传模块
//
// 配置字段：
//   accessKeyId     - AccessKey ID
//   accessKeySecret - AccessKey Secret
//   bucket          - 存储桶名称
//   region          - 存储桶所在地域，如 "oss-cn-shanghai"
//   domain          - 自定义域名（可选）
//   path            - 上传目录前缀（可选，如 "picgo/"）
//
// 实现：使用 OSS V2 签名算法 (V2) PUT 对象
// 参考: https://help.aliyun.com/zh/oss/developer-reference/sign-v2
// ========================================================================

import * as fs from 'fs'
import * as path from 'path'
import { createHash, createHmac } from 'node:crypto'
import { UploadFileInfo, UploadRawResult, UploaderModule, registerModule } from './registry'

// 日期格式化：yyyyMMdd'T'HHmmss'Z' / yyyyMMdd
function formatDate(d: Date, withTime: boolean = true): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  if (withTime) {
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  }
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
}

function hmacSha256(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest()
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex')
}

// OSS V2 签名算法（简化版 PUT 对象签名）
function generateAuthorizationV2(
  accessKeyId: string,
  accessKeySecret: string,
  httpMethod: string,
  bucket: string,
  key: string,
  extraHeaders: Record<string, string> = {}
): { Authorization: string; Date: string; 'x-oss-date': string } {
  const now = new Date()
  const xOssDate = formatDate(now, true)
  const shortDate = formatDate(now, false)
  const isoDate = now.toUTCString()

  // Canonical Request
  const pathname = `/${key}`
  const canonicalQueryString = '' // 无 query 参数
  const lowerKeys = Object.keys(extraHeaders).map((k) => k.toLowerCase()).sort()
  const canonicalHeaderLines = [
    `host:${bucket}.oss-accelerate.aliyuncs.com`, // 占位，下方用实际 host
    ...lowerKeys.map((k) => `${k}:${extraHeaders[k]}`),
  ].join('\n')
  const signedHeaders = 'host' + (lowerKeys.length > 0 ? ';' + lowerKeys.join(';') : '')

  const canonicalRequest = [
    httpMethod.toUpperCase(),
    pathname,
    canonicalQueryString,
    canonicalHeaderLines + '\n',
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n')

  // String to Sign
  const stringToSign = [
    'OSS2-HMAC-SHA256',
    xOssDate,
    `${shortDate}/${accessKeyId}/aliyun_v4_request`,
    sha256Hex(canonicalRequest),
  ].join('\n')

  // Signature
  const kDate = hmacSha256(`aliyun_v4_request_${accessKeySecret}`, shortDate)
  const kId = hmacSha256(kDate, accessKeyId)
  const signingKey = hmacSha256(kId, 'aliyun_v4_request')
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')

  const authorization = `OSS2-HMAC-SHA256 Credential=${accessKeyId}/${shortDate}/aliyun_v4_request, SignedHeaders=${signedHeaders}, Signature=${signature}`

  return {
    Authorization: authorization,
    Date: isoDate,
    'x-oss-date': xOssDate,
  }
}

const aliyunOss: UploaderModule = {
  name: 'aliyun-oss',
  version: '0.1.0',
  description: '阿里云对象存储 OSS',

  async upload(file: UploadFileInfo, config: Record<string, any>): Promise<UploadRawResult> {
    const { accessKeyId, accessKeySecret, bucket, region, domain, path: pathPrefix = '' } = config

    if (!accessKeyId || !accessKeySecret || !bucket || !region) {
      throw new Error('阿里云 OSS 缺少必需配置：accessKeyId / accessKeySecret / bucket / region')
    }

    const ext = path.extname(file.fileName).toLowerCase() || '.png'
    const contentHash = createHash('sha256').update(fs.readFileSync(file.filePath)).digest('hex').slice(0, 16)
    const key = `${pathPrefix || ''}${contentHash}${ext}`.replace(/\/+/g, '/').replace(/^\//, '')

    const host = `${bucket}.${region}.aliyuncs.com`
    const url = `https://${host}/${key}`
    const body = fs.readFileSync(file.filePath)

    const auth = generateAuthorizationV2(
      accessKeyId, accessKeySecret, 'put', bucket, key
    )

    const resp = await fetch(url, {
      method: 'PUT',
      headers: {
        Host: host,
        'Content-Type': file.mimeType || 'application/octet-stream',
        'x-oss-date': auth['x-oss-date'],
        Authorization: auth.Authorization,
      },
      body,
    })

    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(`阿里云 OSS 上传失败: HTTP ${resp.status} ${text}`)
    }

    const imgUrl = domain
      ? `${domain.endsWith('/') ? domain.slice(0, -1) : domain}/${key}`
      : url

    return {
      imgUrl,
      webUrl: imgUrl,
      raw: { bucket, key, region },
    }
  },

  async delete(url: string, config: Record<string, any>): Promise<boolean> {
    console.warn('[aliyun-oss] delete 暂未实现，请在阿里云控制台手动删除:', url)
    return false
  },
}

registerModule(aliyunOss)
export const aliyunOssModule = aliyunOss
export default aliyunOss
