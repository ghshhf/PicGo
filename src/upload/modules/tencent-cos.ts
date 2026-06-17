// ========================================================================
// modules/tencent-cos.ts  — 腾讯云对象存储 (COS) 上传模块
//
// 配置字段：
//   secretId   - 腾讯云 SecretId
//   secretKey  - 腾讯云 SecretKey
//   bucket     - 存储桶（格式：<name>-<APPID>），例如 "picbed-1250000000"
//   region     - 存储桶所在地域，例如 "ap-shanghai"
//   domain     - 自定义域名（可选，若未填则使用 COS 默认域名）
//   path       - 上传目录前缀（可选，如 "picgo/"）
//
// 实现：使用 COS XML API v5 签名，PUT 对象
// 参考: https://cloud.tencent.com/document/product/436/7778
// ========================================================================

import * as fs from 'fs'
import * as path from 'path'
import { createHash, createHmac } from 'node:crypto'
import { UploadFileInfo, UploadRawResult, UploaderModule, registerModule } from './registry'

function sha1Hex(str: string): string {
  return createHash('sha1').update(str).digest('hex')
}

function hmacSha1Hex(key: string | Buffer, data: string): string {
  return createHmac('sha1', key).update(data).digest('hex')
}

// COS v5 签名算法（简化版 PUT 对象签名）
function generateAuthorization(
  secretId: string,
  secretKey: string,
  httpMethod: string,
  pathname: string,
  headers: Record<string, string> = {},
  params: Record<string, string> = {},
  keyTimeSec: number = 600
): string {
  const now = Math.floor(Date.now() / 1000)
  const keyTime = `${now - 60};${now + keyTimeSec}`

  // Step 1: 生成 signingKey
  const signKey = hmacSha1Hex(secretKey, keyTime)

  // Step 2: 生成 urlParamList & urlParams
  const sortedParamKeys = Object.keys(params).map((k) => k.toLowerCase()).sort()
  const urlParamList = sortedParamKeys.join(';')
  const urlParams = sortedParamKeys
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k] || '')}`)
    .join('&')

  // Step 3: 生成 headerList & headers
  const sortedHeaderKeys = Object.keys(headers).map((k) => k.toLowerCase()).sort()
  const headerList = sortedHeaderKeys.join(';')
  const httpHeaders = sortedHeaderKeys
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(headers[k] || '')}`)
    .join('&')

  // Step 4: httpString
  const httpString = [
    httpMethod.toLowerCase(),
    pathname,
    urlParams,
    httpHeaders,
    '',
  ].join('\n')
  const httpStringSha1 = sha1Hex(httpString)

  // Step 5: stringToSign
  const stringToSign = ['sha1', keyTime, httpStringSha1, ''].join('\n')

  // Step 6: signature
  const signature = hmacSha1Hex(signKey, stringToSign)

  // Step 7: 组装
  const pieces: string[] = [
    `q-sign-algorithm=sha1`,
    `q-ak=${secretId}`,
    `q-sign-time=${keyTime}`,
    `q-key-time=${keyTime}`,
    `q-header-list=${headerList}`,
    `q-url-param-list=${urlParamList}`,
    `q-signature=${signature}`,
  ]
  return pieces.join('&')
}

const tencentCos: UploaderModule = {
  name: 'tencent-cos',
  version: '0.1.0',
  description: '腾讯云对象存储 COS',

  async upload(file: UploadFileInfo, config: Record<string, any>): Promise<UploadRawResult> {
    const { secretId, secretKey, bucket, region, domain, path: pathPrefix = '' } = config

    if (!secretId || !secretKey || !bucket || !region) {
      throw new Error('腾讯云 COS 缺少必需配置：secretId / secretKey / bucket / region')
    }
    if (!bucket.includes('-')) {
      throw new Error('腾讯云 COS bucket 格式应为 <name>-<APPID>，如 "picbed-1250000000"')
    }

    // key: {pathPrefix}{sha256前16位}{ext}
    const ext = path.extname(file.fileName).toLowerCase() || '.png'
    const contentHash = createHash('sha256').update(fs.readFileSync(file.filePath)).digest('hex').slice(0, 16)
    const key = `${pathPrefix || ''}${contentHash}${ext}`.replace(/\/+/g, '/').replace(/^\//, '')

    // 构造请求 URL: https://{bucket}.cos.{region}.myqcloud.com/{key}
    const host = `${bucket}.cos.${region}.myqcloud.com`
    const pathname = `/${key}`
    const url = `https://${host}${pathname}`

    const body = fs.readFileSync(file.filePath)

    const headers: Record<string, string> = {
      host,
      'content-type': file.mimeType || 'application/octet-stream',
      'content-length': String(body.length),
    }

    const auth = generateAuthorization(
      secretId, secretKey, 'put', pathname, headers, {}
    )
    headers['Authorization'] = auth

    const resp = await fetch(url, {
      method: 'PUT',
      headers,
      body,
    })

    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(`腾讯云 COS 上传失败: HTTP ${resp.status} ${text}`)
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
    console.warn('[tencent-cos] delete 暂未实现，请在腾讯云控制台手动删除:', url)
    return false
  },
}

registerModule(tencentCos)
export const tencentCosModule = tencentCos
export default tencentCos
