// ========================================================================
// config.ts  — 配置文件加载器
//
// 职责：
//   1. 读取 ~/.picgo-upload-layer/config.json（用户个人配置）
//   2. 首次运行自动创建默认配置（带中文注释）
//   3. 提供 loadConfig() / saveConfig() / getConfigDir()
//   4. 提供 getRoutesFromConfig()：把配置文件里的图床列表转换成 UploadRoute[]
//
// 设计目标：
//   - 零依赖（只用 Node.js fs / path / os）
//   - 幂等：重复调用 loadConfig() 不会出错
//   - 友好：文件缺失时给出清晰提示和默认模板
//
// 配置文件结构：
//   {
//     "defaultRoute": "smms",              // 默认使用哪个图床
//     "routes": [
//       {
//         "name": "smms",
//         "host": "sm.ms",
//         "protocol": "https",
//         "priority": 1,
//         "enabled": true,
//         "config": { "token": "YOUR_SMMS_TOKEN" }
//       },
//       ... 更多图床
//     ]
//   }
// ========================================================================

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { UploadRoute } from './upload_ctx.h'

// ---- 配置结构（与 JSON 对应）----

export interface ConfigFile {
  defaultRoute: string | null
  routes: UploadRoute[]
}

// ---- 路径解析 ----

const CONFIG_DIR_NAME = '.picgo-upload-layer'
const CONFIG_FILE_NAME = 'config.json'

export function getConfigDir(): string {
  return path.join(os.homedir(), CONFIG_DIR_NAME)
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), CONFIG_FILE_NAME)
}

// ---- 默认模板（首次运行时创建）----

function defaultConfig(): ConfigFile {
  return {
    defaultRoute: 'smms',
    routes: [
      {
        name: 'smms',
        host: 'sm.ms',
        protocol: 'https',
        priority: 1,
        enabled: true,
        config: { token: 'YOUR_SMMS_TOKEN' },
      },
      {
        name: 'github',
        host: 'api.github.com',
        protocol: 'https',
        priority: 2,
        enabled: true,
        config: {
          token: 'YOUR_GITHUB_TOKEN',
          repo: 'owner/name',
          branch: 'main',
          path: 'img/2026',
          customUrl: '',
        },
      },
      {
        name: 'qiniu',
        host: 'upload.qiniup.com',
        protocol: 'https',
        priority: 3,
        enabled: false,
        config: {
          accessKey: 'YOUR_ACCESS_KEY',
          secretKey: 'YOUR_SECRET_KEY',
          bucket: 'your-bucket',
          domain: 'https://cdn.example.com',
          path: '',
        },
      },
      {
        name: 'tencent-cos',
        host: 'cos.myqcloud.com',
        protocol: 'https',
        priority: 4,
        enabled: false,
        config: {
          secretId: 'YOUR_SECRET_ID',
          secretKey: 'YOUR_SECRET_KEY',
          bucket: 'your-bucket-1250000000',
          region: 'ap-shanghai',
          domain: 'https://cdn.example.com',
          path: '',
        },
      },
      {
        name: 'aliyun-oss',
        host: 'oss-accelerate.aliyuncs.com',
        protocol: 'https',
        priority: 5,
        enabled: false,
        config: {
          accessKeyId: 'YOUR_ACCESS_KEY_ID',
          accessKeySecret: 'YOUR_ACCESS_KEY_SECRET',
          bucket: 'your-bucket',
          region: 'oss-cn-shanghai',
          domain: 'https://cdn.example.com',
          path: '',
        },
      },
    ],
  }
}

// ---- 带注释的 JSON 模板（人类可读）----

const DEFAULT_JSON_TEMPLATE = `{
  "//": "picgo-upload-layer 配置文件。把 token/密钥填好后，enabled=true 的图床即可使用。",
  "// 说明": "defaultRoute 指定默认使用哪个图床（对应 routes[i].name）。首次使用请在下方 routes 中找到要启用的图床，把 enabled 改成 true 并把密钥填好。",
  "defaultRoute": "smms",

  "routes": [
    {
      "name": "smms",
      "host": "sm.ms",
      "protocol": "https",
      "priority": 1,
      "enabled": true,
      "config": { "token": "YOUR_SMMS_TOKEN" }
    },
    {
      "name": "github",
      "host": "api.github.com",
      "protocol": "https",
      "priority": 2,
      "enabled": true,
      "config": {
        "token": "YOUR_GITHUB_TOKEN",
        "repo": "owner/name",
        "branch": "main",
        "path": "img/2026",
        "customUrl": ""
      }
    },
    {
      "name": "qiniu",
      "host": "upload.qiniup.com",
      "protocol": "https",
      "priority": 3,
      "enabled": false,
      "config": {
        "accessKey": "YOUR_ACCESS_KEY",
        "secretKey": "YOUR_SECRET_KEY",
        "bucket": "your-bucket",
        "domain": "https://cdn.example.com",
        "path": ""
      }
    },
    {
      "name": "tencent-cos",
      "host": "cos.myqcloud.com",
      "protocol": "https",
      "priority": 4,
      "enabled": false,
      "config": {
        "secretId": "YOUR_SECRET_ID",
        "secretKey": "YOUR_SECRET_KEY",
        "bucket": "your-bucket-1250000000",
        "region": "ap-shanghai",
        "domain": "https://cdn.example.com",
        "path": ""
      }
    },
    {
      "name": "aliyun-oss",
      "host": "oss-accelerate.aliyuncs.com",
      "protocol": "https",
      "priority": 5,
      "enabled": false,
      "config": {
        "accessKeyId": "YOUR_ACCESS_KEY_ID",
        "accessKeySecret": "YOUR_ACCESS_KEY_SECRET",
        "bucket": "your-bucket",
        "region": "oss-cn-shanghai",
        "domain": "https://cdn.example.com",
        "path": ""
      }
    }
  ]
}
`

// ---- 读取配置 ----

export function loadConfig(): ConfigFile {
  const cfgPath = getConfigPath()

  // 1) 文件不存在 → 自动创建默认配置
  if (!fs.existsSync(cfgPath)) {
    const dir = getConfigDir()
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(cfgPath, DEFAULT_JSON_TEMPLATE, 'utf-8')
    console.log(`[config] 已创建默认配置: ${cfgPath}`)
    console.log(`[config] 请填入 token 后重新运行。`)
    return defaultConfig()
  }

  // 2) 文件存在 → 尝试解析
  try {
    const raw = fs.readFileSync(cfgPath, 'utf-8')
    const parsed = JSON.parse(raw)

    // 3) 基础字段校验
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('根节点不是对象')
    }
    if (!parsed.routes || !Array.isArray(parsed.routes)) {
      parsed.routes = []
    }

    return {
      defaultRoute: parsed.defaultRoute || null,
      routes: parsed.routes.filter((r: any) => r && r.name),
    }
  } catch (e) {
    console.error(`[config] 读取失败: ${cfgPath}`)
    console.error(`         原因: ${(e as Error).message}`)
    console.error(`         将使用默认配置作为备用。`)
    return defaultConfig()
  }
}

// ---- 保存配置 ----

export function saveConfig(cfg: ConfigFile): void {
  const dir = getConfigDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(getConfigPath(), JSON.stringify(cfg, null, 2), 'utf-8')
}

// ---- 辅助：从配置中提取 routes ----

export function getRoutesFromConfig(): UploadRoute[] {
  return loadConfig().routes
}

export function getDefaultRoute(): string | null {
  return loadConfig().defaultRoute
}
