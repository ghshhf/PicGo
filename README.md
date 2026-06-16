<div align="center">

# 🖼️ picgo-upload-layer

**基于 libc 架构理念重构的 PicGo 上传图层**

> 统一上下文 · 声明式接口头文件 · 6 步标准流水线 · 独立可插拔的图床模块
>
> 为图片上传提供一套类型可靠、结构清晰、易于扩展的底层框架

[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Architecture](https://img.shields.io/badge/架构-libc--style-blue.svg)](#设计理念)
[![Pipeline](https://img.shields.io/badge/流水线-6%20steps-orange.svg)](#6-步标准流水线)
[![Pluggable](https://img.shields.io/badge/模块-可插拔-purple.svg)](#添加新图床)

---

### 📢 关于本项目

> **这是一个独立的重构项目**，**不是**原始 PicGo（[Molunerfinn/PicGo](https://github.com/Molunerfinn/PicGo)）的维护分支或 fork 补丁。
>
> 原始 PicGo 依赖事件链架构，且项目上游活跃度较低。与其在旧架构上打补丁，**不如从零开始用模块化 + 流水线架构重新设计**。
>
> 本项目：
> - ✅ **不使用**原始 PicGo 的任何代码（event-chain / plugin system / electron UI）
> - ✅ **只关注**核心上传能力（typescript + Node.js 标准库，零运行时依赖）
> - ✅ **与 PicGo**仅在"图片上传工具"这个语义上有交集，实现方式完全不同
> - ✅ 保留 "PicGo" 仓库名是为了方便搜索引擎定位，核心代码就是你现在看到的这一套
>
> **如果你熟悉 glibc-packages / AI-TP OS 的代码风格，看这个项目你会感到舒适。**

---

</div>

## 📖 项目简介

`picgo-upload-layer` 是一个**自下而上**、用 **glibc-packages / AI-TP OS 的模块化 + 流水线架构**重新设计的图片上传引擎。

传统 PicGo 的上传层依赖于隐式的事件链（`beforeUploadPlugins → uploader → afterUploadPlugins`），插件逻辑与核心耦合、错误处理零散、扩展和调试都较为困难。本项目借鉴 Linux 系统编程中"**头文件声明接口 + 源文件实现逻辑 + 标准化构建管线**"的成熟实践，将整个上传过程抽象为：

- **一个上下文** — `UploadCtx`：集中管理生命周期、路由、当前批次、统计
- **一份声明** — `upload_ctx.h.ts`：集中声明所有类型、枚举、函数签名
- **一条流水线** — `prepare → transform → configure → upload → check → commit`
- **一组模块** — 每个图床只实现一个纯函数：`upload(file, config) → imgUrl`

由此带来的收益：

| 能力 | 说明 |
|------|------|
| ✅ **类型可靠** | 不再在字符串事件名里猜参数，所有接口签名都在头文件 |
| ✅ **结构清晰** | 6 步流水线每一步独立可测、可替换、可扩展 |
| ✅ **易于调试** | 进度回调 + 累计统计 + `healthCheck()` 三位一体 |
| ✅ **零运行时依赖** | 仅使用 Node.js 标准库（`fs`/`path`/`os`/`fetch`） |
| ✅ **即插即用** | 新图床只需一个文件 + `registerModule()` 即可接入 |

---

## 🏗️ 架构总览

```
                        ┌──────────────────────────────────┐
                        │           UploadCtx              │
                        │   ┌────────────────────────┐     │
                        │   │  initialized: Boolean │     │
                        │   │  running: Boolean     │     │
                        │   │  currentRoute: string│     │
                        │   │  files: UploadFile[] │     │
                        │   │  results: UploadResult[]  │     │
                        │   │  stats: UploadStats  │     │
                        │   └────────────────────────┘     │
                        │        ↑          ↑               │
                        └────────┬──────────┬───────────────┘
                                 │          │
                  ┌──────────────┘          └───────────────┐
                  │                                          │
          ┌───────┴──────┐                         ┌───────┴──────┐
          │  Progress     │                         │  Callback    │
          │  onProgress   │                         │  onSuccess   │
          │  emitStep()   │                         │  onError     │
          └──────────────┘                         └──────────────┘
```

### 6 步标准流水线

```
     ┌──────────┐    ┌───────────┐    ┌────────────┐    ┌──────────┐
     │ 01 PREPARE│ →  │02 TRANSFORM│ → │03 CONFIGURE │ → │ 04 UPLOAD│
     └──────────┘    └───────────┘    └────────────┘    └──────────┘
                                                                 │
     ┌──────────┐    ┌───────────┐                                │
     │ 06 COMMIT│ ←  │ 05 CHECK  │ ←──────────────────────────────┘
     └──────────┘    └───────────┘
```

| 步骤 | 职责 | 关键操作 | 错误码 |
|------|------|---------|--------|
| **PREPARE** | 准备文件元信息 | 检查路径、读取大小、计算哈希 | `UPLOAD_ERR_IO` `UPLOAD_ERR_NOT_FOUND` |
| **TRANSFORM** | 预处理（可扩展） | 图片压缩、格式转换（预留） | （当前保留） |
| **CONFIGURE** | 选择并校验图床 | 读取配置、验证必填字段 | `UPLOAD_ERR_CONFIG` |
| **UPLOAD** | 实际网络上传 | 调用图床模块、3 并发限制 | `UPLOAD_ERR_PLUGIN` `UPLOAD_ERR_NETWORK` |
| **CHECK** | 校验上传结果 | 验证 `imgUrl` 有效性 | `UPLOAD_ERR_VALIDATE` |
| **COMMIT** | 提交结果 | 生成 Markdown、统计更新 | `UPLOAD_OK` |

### 图床模块系统

```
                   ┌──────────────────── registry.ts ────────────────────┐
                   │  Map<moduleName, UploaderModule>                    │
                   │  ┌─────────┐  ┌────────────┐  ┌──────────────────┐ │
                   │  │ smms.ts │  │ github.ts │  │ your-host.ts (...)│ │
                   │  └─────────┘  └────────────┘  └──────────────────┘ │
                   │      upload()        upload()        upload()       │
                   └──────────────────────────┬──────────────────────────┘
                                              │
                                    ┌─────────┴─────────┐
                                    │   UploadCtx.upload │
                                    │   （调用当前路由）│
                                    └──────────────────┘
```

---

## 📊 架构对比

| 维度 | 传统 PicGo（event-driven） | picgo-upload-layer（libc-style） |
|------|----------------------------|---------------------------------|
| **核心抽象** | 全局对象 + 字符串事件<br>`ctx.on('upload', ...)` | 统一 `UploadCtx` + 类型化 API |
| **上传流程** | 隐式事件链<br>`beforeUpload → uploader → afterUpload` | **显式 6 步流水线**<br>`prepare → transform → configure → upload → check → commit` |
| **错误处理** | `try/catch` + 字符串错误消息 | **`UploadErrCode` 枚举**（共 10 种，带中英文描述） |
| **图床模块** | plugin 混合对象（UI + 设置 + 上传） | **纯函数** `upload(file, config) → imgUrl` |
| **并发控制** | 无（全交给插件自己处理） | **内置 3 并发限制** + 进度通知 |
| **统计监控** | 无 | `getStats()` / `healthCheck()` |
| **接口可见性** | 散落在各 plugin 文件 | **集中在 `upload_ctx.h.ts`** |
| **单元测试** | 需 mock 整个事件链 | 每个 step 独立可测 |
| **类型安全** | 弱（any 类型常见） | **强**（严格模式 + 完整类型） |
| **运行时依赖** | electron + 多种第三方库 | **零**（仅 Node.js 标准库） |

---

## ✨ 核心特性

### 1. 统一上下文 `UploadCtx`

所有状态集中管理，不再在全局变量、闭包、事件回调里东拼西凑：

```
UploadCtx {
  initialized: boolean          — 生命周期
  running:     boolean          — 运行中标志
  currentRoute: string|null     — 当前选中图床
  routes:       UploadRoute[]   — 所有已注册图床
  files:        UploadFileInfo[] — 当前上传文件
  results:      UploadResult[]  — 上传结果
  stats:        UploadStats     — 累计统计
  runtime:      { }             — step 间共享临时数据
}
```

### 2. 声明式头文件 `upload_ctx.h.ts`

一个文件即可读懂整个系统能力，类似 Linux 中 `<stdio.h>` 所起的作用：

- **枚举**：`UploadErrCode`（10 种错误码）、`UploadStepState`（pending/running/success/failed/cancelled）
- **类型**：`UploadFileInfo`、`UploadResult`、`UploadRoute`、`UploadStats`、`UploadCallbacks`、`UploadCtx`
- **函数签名**：`UploadStepFn = (ctx, filePaths?) => UploadErrCode | Promise<UploadErrCode>`
- **常量**：`STEP.PREPARE` … `STEP.COMMIT` + `STEP_NAMES`

### 3. 6 步标准流水线

每一步都是独立文件，统一签名，互不干扰。中间任意 step 失败都返回明确的 `UploadErrCode`，由 `UploadContext.upload()` 统一收尾并触发回调。

### 4. 独立可插拔的图床模块

每个图床只实现一个接口：

```ts
interface UploaderModule {
  name: string
  version: string
  upload: (file: UploadFileInfo, config: Record<string, any>) => Promise<{
    imgUrl: string
    webUrl?: string
    raw?: Record<string, any>
  }>
}

registerModule(myModule)      // 注册
getModule('smms')              // 查询
listModules()                  // 列出全部
unregisterModule('ghost-host') // 移除
```

目前内置：

| 模块 | 模式 | 配置项 |
|------|------|--------|
| **SM.MS** | multipart/form-data POST | `{ token }` |
| **GitHub** | Content API PUT（base64） | `{ token, repo, branch, path, customUrl? }` |

### 5. 完整的统计 + 健康检查

```ts
getStats()
// → {
//     totalUploads: 42,
//     successCount: 40,
//     successRate: "95.2%",
//     totalBytesHuman: "1.2 MB",
//     avgTimeMs: "420 ms",
//     lastUploadAt: "2026-06-17T07:14:35.465Z"
//   }

formatStats()      // ASCII 报告（用于终端输出）
healthCheck()      // 验证每个路由 + 模块是否正常注册
```

---

## 📂 目录结构

```
picgo-upload-layer/
├── package.json                        # 项目元信息（description / keywords / repository）
├── tsconfig.json                       # TypeScript 配置（ES2022 + strict 模式）
├── README.md                           # 👈 你现在在看的文件
│
├── src/upload/
│   ├── index.ts                        # ── 统一导出入口
│   ├── upload_ctx.h.ts                 # ── 声明式接口头文件（所有类型 / 枚举 / 签名）
│   ├── upload_ctx.ts                   # ── UploadContext 核心实现 + 6 步流水线调度
│   ├── upload_error.ts                 # ── 错误码 → 中英文描述映射 + 等级判断
│   ├── upload_callback.ts              # ── 多监听器回调系统（onProgress / onSuccess / ...）
│   ├── upload_stats.ts                 # ── 运行时统计 + healthCheck 健康检查
│   │
│   ├── upload_steps/                   # ── 6 步标准流水线（每个 step 独立文件）
│   │   ├── 01_prepare.ts               #     读取文件元信息 / 大小 / 哈希
│   │   ├── 02_transform.ts             #     图片预处理（压缩/格式转换，预留扩展）
│   │   ├── 03_configure.ts             #     选择图床 + 校验必填配置字段
│   │   ├── 04_upload.ts                #     调用图床模块 + 3 并发限制 + 进度通知
│   │   ├── 05_check.ts                 #     校验 imgUrl 有效性 + 过滤失败项
│   │   └── 06_commit.ts                #     汇总结果 + 生成 Markdown 链接
│   │
│   └── modules/                        # ── 图床模块（与流水线解耦）
│       ├── registry.ts                 #     模块注册表（registerModule / getModule）
│       ├── index.ts                    #     统一导出所有内置模块
│       ├── smms.ts                     #     SM.MS（multipart/form-data 上传）
│       └── github.ts                   #     GitHub（Content API PUT + base64）
│
└── test/
    └── integration.test.ts             # 端到端集成测试（mock 图床模块，不发网络请求）
```

---

## 🚀 快速上手

### 前置要求

| 依赖 | 最低版本 | 说明 |
|------|---------|------|
| **Node.js** | ≥ 18.0.0 | 需要内置 `fetch` + `FormData` + `Blob` |
| **TypeScript** | ≥ 5.4.0 | 已在 `devDependencies` 声明（开发时使用） |
| **操作系统** | Windows / macOS / Linux | 纯 Node.js，跨平台 |

### 安装

```bash
# 克隆本仓库
git clone https://github.com/ghshhf/PicGo.git
cd PicGo

# 安装开发依赖
npm install
```

### 最小完整示例

```ts
import {
  UploadContext,
  UploadErrCode,
  formatError,
  onProgress,
  onSuccess,
  bindCallbacks,
  getStats,
} from './src/upload'

// 1) 加载所有内置图床模块（会自动 registerModule）
import './src/upload/modules'

// 2) 初始化
UploadContext.init()

// 3) 注册图床路由（可同时注册多个）
UploadContext.registerRoute({
  name: 'smms',
  host: 'sm.ms',
  protocol: 'https',
  priority: 1,
  enabled: true,
  config: { token: 'YOUR_SMMS_TOKEN' },
})

UploadContext.registerRoute({
  name: 'github',
  host: 'api.github.com',
  protocol: 'https',
  priority: 2,
  enabled: true,
  config: {
    token: 'YOUR_GITHUB_TOKEN',
    repo: 'ghshhf/my-images',
    branch: 'main',
    path: 'img/2026',
  },
})

// 4) 选择当前使用的图床
UploadContext.setRoute('smms')

// 5) 绑定回调（监听上传过程）
bindCallbacks(UploadContext.getCtx())

onProgress((p) => {
  const bar = '█'.repeat(Math.floor(p.progress / 5)) + '░'.repeat(20 - Math.floor(p.progress / 5))
  console.log(`  [${p.step}] ${p.stepName} | ${bar} ${p.progress}%`)
}, UploadContext.getCtx())

onSuccess((results) => {
  console.log('\n✅ 上传完成！Markdown 链接：\n')
  results.forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.file.fileName} → ${r.markdownUrl}`)
  })
  console.log('\n📊 累计统计：')
  console.log(getStats())
}, UploadContext.getCtx())

// 6) 上传！
const code = await UploadContext.upload([
  '/path/to/screenshot.png',
  '/path/to/photo.jpg',
  '/path/to/diagram.svg',
])

if (code !== UploadErrCode.UPLOAD_OK) {
  console.error('\n❌ 上传失败：', formatError(code))
  process.exit(1)
}
```

### 运行测试

```bash
# 方案 A：直接通过 tsx 运行（推荐，无需编译）
node --loader tsx test/integration.test.ts

# 方案 B：先编译再运行
npx tsc --project tsconfig.json
node dist/test/integration.test.js
```

测试覆盖以下场景（全部通过 mock 图床模块，**不向真实网络发送请求**）：

- ✅ 多文件成功上传（3 并发）
- ✅ 文件不存在错误拦截
- ✅ 未选择图床时的配置错误
- ✅ 图床模块未注册时的插件错误
- ✅ 累计统计（成功数/字节数/耗时）
- ✅ 健康检查（初始化/路由/模块）

---

## 🔌 添加新图床（只需 1 个文件）

### 第 1 步：创建 `src/upload/modules/your-host.ts`

```ts
import * as fs from 'fs'
import { UploadFileInfo } from '../upload_ctx.h'
import { registerModule, UploaderModule } from './registry'

async function upload(
  file: UploadFileInfo,
  config: Record<string, any>,
): Promise<{ imgUrl: string; webUrl?: string; raw?: any }> {

  // 1. 读取文件
  const buffer = fs.readFileSync(file.filePath)

  // 2. 发起网络请求（使用 Node.js 内置 fetch）
  const resp = await fetch('https://your-host.com/api/v1/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.token}`,
      'Content-Type': file.mimeType,
    },
    body: buffer,
  })

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${resp.statusText}`)
  }

  // 3. 解析响应
  const data = await resp.json()

  // 4. 返回统一格式
  return {
    imgUrl: data.url,
    webUrl: data.page_url,
    raw: data,
  }
}

export const yourHostModule: UploaderModule = {
  name: 'your-host',
  version: '1.0.0',
  upload,
}

registerModule(yourHostModule)  // 自动注册到全局注册表
```

### 第 2 步：在 `src/upload/modules/index.ts` 添加导出

```ts
export * from './registry'
export * from './smms'
export * from './github'
export * from './your-host'   // 👈 新增这行
```

### 第 3 步：使用新图床

```ts
UploadContext.registerRoute({
  name: 'your-host',
  host: 'your-host.com',
  protocol: 'https',
  priority: 3,
  enabled: true,
  config: { token: 'YOUR_TOKEN' },
})

UploadContext.setRoute('your-host')
await UploadContext.upload(['/path/to/image.png'])
```

**就这么简单** —— 核心系统已经为你处理了文件读取、并发、进度、统计、错误处理。你只需要专注于 **「图床的 API 协议」** 这一件事。

---

## 🧭 设计理念（与 AI-TP OS / glibc-packages 的对应关系）

| AI-TP OS 概念 | 本项目对应 | 说明 |
|--------------|-----------|------|
| `ai_tp_gw_context_t` | `UploadCtx` | 统一上下文：生命周期 / 路由 / 当前批次 / 统计 |
| `ai_tp_gw_route_t` | `UploadRoute` | 每个图床 = 一个 route（name / config / priority） |
| `ai_storage_file_t` | `UploadFileInfo` | 文件元信息：路径 / 大小 / MIME / 哈希 |
| `AI_STORAGE_ERR_*` | `UploadErrCode` | 枚举化错误码（代替字符串消息） |
| `on_connection` 回调 | `UploadCallbacks` | 明确签名的函数回调（代替字符串事件） |
| 6 步 build pipeline | 6 步 upload pipeline | `prepare → transform → configure → upload → check → commit` |
| 独立模块（gateway / storage） | 独立图床模块 | 统一 `upload(file, config)` 接口，按 name 查找 |
| `repo.json` 元信息 | `package.json` | name / version / description / keywords |

**核心思想**：把软件系统当作操作系统来设计 —— 有清晰的上下文（进程）、声明式的接口（头文件）、标准化的处理管线（构建系统）、可插拔的模块（共享库）。

---

## 🔍 API 速查

### 核心 API

```ts
import { UploadContext } from 'picgo-upload-layer'

UploadContext.init(routes?)                // 初始化
UploadContext.destroy()                    // 销毁（清理回调/状态）
UploadContext.reset()                      // 重置当前批次

UploadContext.registerRoute(route)         // 注册图床路由
UploadContext.removeRoute(name)            // 移除图床路由
UploadContext.setRoute(name)               // 选择当前图床
UploadContext.getCurrentRoute()            // 查询当前图床
UploadContext.getRoutes()                  // 列出所有图床

UploadContext.upload(filePaths)            // → Promise<UploadErrCode>
UploadContext.cancel()                     // 取消上传

UploadContext.getCtx()                     // 获取完整上下文对象
```

### 错误码

| 枚举 | 值 | 含义 |
|------|-----|------|
| `UPLOAD_OK` | 0 | 成功 |
| `UPLOAD_ERR_INIT` | 1 | 系统未初始化 |
| `UPLOAD_ERR_IO` | 2 | 文件读写失败 |
| `UPLOAD_ERR_CONFIG` | 3 | 配置错误 |
| `UPLOAD_ERR_NOT_FOUND` | 4 | 图床或文件不存在 |
| `UPLOAD_ERR_OVERLOAD` | 5 | 超过并发 / 大小限制 |
| `UPLOAD_ERR_CANCEL` | 6 | 用户取消 |
| `UPLOAD_ERR_PLUGIN` | 7 | 图床模块异常 |
| `UPLOAD_ERR_NETWORK` | 8 | 网络错误 |
| `UPLOAD_ERR_VALIDATE` | 9 | 结果校验失败 |
| `UPLOAD_ERR_UNKNOWN` | 99 | 未知错误 |

### 回调系统

```ts
import { onProgress, onSuccess, onError, onCancel, bindCallbacks } from 'picgo-upload-layer'

bindCallbacks(UploadContext.getCtx())

onProgress(({ step, stepName, progress, bytesProcessed, bytesTotal, elapsedMs }) => {
  console.log(`Step ${step} (${stepName}): ${progress}%`)
})

onSuccess((results) => console.log(`${results.length} 个文件上传成功`))
onError((code, msg)    => console.error(`错误码 ${code}: ${msg}`))
onCancel(()             => console.log('已取消'))
```

### 模块管理

```ts
import { registerModule, getModule, listModules, unregisterModule } from 'picgo-upload-layer'

registerModule({ name, version, upload })
getModule('smms')
listModules()                    // ['smms', 'github', ...]
unregisterModule('ghost-host')
```

### 统计 + 健康检查

```ts
import { getStats, formatStats, healthCheck } from 'picgo-upload-layer'

getStats()                       // 对象形式
formatStats()                    // ASCII 终端报告
healthCheck()                    // 初始化状态 + 每个路由/模块状态
```

---

## 📊 项目元信息

| 字段 | 值 |
|------|-----|
| **仓库地址** | https://github.com/ghshhf/PicGo |
| **许可证** | MIT |
| **作者** | ghshhf |
| **Node 要求** | ≥ 18.0.0 |
| **TypeScript** | 5.4+ |
| **运行时依赖** | **0 个**（仅 Node.js 标准库） |
| **开发依赖** | `@types/node` · `tsx` · `typescript` |
| **源文件** | 17 个 TypeScript 文件（src + test） |
| **代码行数** | ~2,100 行 |
| **测试用例** | 6 个（mock 图床，不发网络请求） |

---

## 🔍 项目现状与架构分析

> 以下分析基于当前仓库（`src/upload/` 下的 17 个 TypeScript 文件）。
> 目标是回答三个问题：**最缺什么？什么最简单？优先做什么？**

### 1️⃣ 当前已完成（架构核心）

| 模块 | 文件 | 状态 | 备注 |
|------|------|------|------|
| **声明式接口** | `upload_ctx.h.ts` | ✅ 完整 | 11 部分：错误码 / 文件元 / 结果 / 路由表 / Step-State / 进度回调 / 统计 / 回调接口 / UploadCtx / API 签名 / StepFn 常量 |
| **核心调度** | `upload_ctx.ts` | ✅ 完整 | 生命周期 + 路由管理 + 6 步流水线调度 + finalize 统一收尾 + cancel |
| **错误码系统** | `upload_error.ts` | ✅ 完整 | 10 个错误码 + 中英文对照 + `formatError` 辅助 |
| **回调系统** | `upload_callback.ts` | ✅ 完整 | `onProgress` / `onSuccess` / `onError` / `onCancel` / `bindCallbacks` |
| **统计/健康检查** | `upload_stats.ts` | ✅ 完整 | `getStats` / `formatStats` / `healthCheck` + `totalBytesHuman` 美化 |
| **6 步流水线** | `upload_steps/01~06.ts` | ⚠️ 基本骨架完整 | 每步约 50~120 行，Step 2/5 预留空间较大 |
| **模块注册表** | `modules/registry.ts` | ✅ 完整 | `registerModule` / `getModule` / `listModules` / `unregisterModule` |
| **内置图床** | `modules/smms.ts` | ✅ 可用 | multipart/form-data 模式 |
| **内置图床** | `modules/github.ts` | ✅ 可用 | Content API PUT + base64 + customUrl 支持 |
| **集成测试** | `test/integration.test.ts` | ✅ 可运行 | 6 个用例覆盖成功路径 + 4 种失败 + 统计 + 健康检查 |

---

### 2️⃣ 项目最缺什么（按严重程度排序）

#### 🟥 高严重性 — "没有它，用户根本无法使用"

| 排名 | 缺失项 | 影响 | 为什么重要 |
|------|--------|------|----------|
| **#1** | **配置文件（~/.picgo/config.json）** | 🔴 阻塞 | 当前 token 只能写死在代码里。用户用这个项目的**第一步**必须是"把我的 token 配好"，而不是改源码 |
| **#2** | **CLI 入口（命令行上传）** | 🔴 阻塞 | 当前项目没有任何可执行文件。`npm run test` 只跑集成测试，但 `node src/upload/index.ts` 什么都不会做。项目需要一个 `bin/` 或 `cli.ts` 作为真实使用入口 |
| **#3** | **Step 2 Transform 的真实实现** | 🟡 半阻塞 | `02_transform.ts` 目前是**空壳**（只打印一行日志）。图片压缩/格式转换是真实使用场景下的刚需，特别是大截图（MB 级） |

#### 🟨 中严重性 — "能跑通，但体验差、扩展性弱"

| 排名 | 缺失项 | 影响 |
|------|--------|------|
| **#4** | **更多图床模块（至少 5~8 个）** | 只有 SM.MS 和 GitHub 两个。七牛云/阿里云 OSS/腾讯云 COS/LskyPro 这些是国内用户刚需 |
| **#5** | **相册/上传历史持久化** | 上传后 Markdown 链接打印到终端就没了。应该保存到本地文件/SQLite，便于查找、复用、删除 |
| **#6** | **Step 5 CHECK 的真实 URL 校验** | 当前只做了非空检查。应该 HEAD 请求确认 URL 可访问（含超时处理 / 重试） |
| **#7** | **单元测试** | 只有 1 个集成测试，没有对每个 step、每个模块单独的单元测试。重构时信心不足 |
| **#8** | **网络错误重试** | 网络抖动或图床 API 偶尔 5xx 会让上传失败。需要指数退避重试（exponential backoff） |
| **#9** | **文件哈希 + 去重** | `UploadFileInfo` 定义了 `hash?: string` 字段，但 `01_prepare.ts` 从未真正计算。去重意味着"同一张图不会上传两次" |

#### 🟩 低严重性 / 长期演进

| 排名 | 缺失项 | 影响 |
|------|--------|------|
| **#10** | **Electron / Tauri GUI** | 桌面 UI 是 PicGo 最核心的用户形态，但底层引擎先做扎实再套壳 |
| **#11** | **拖拽 / 剪贴板上传** | GUI 配套功能 |
| **#12** | **多图床故障切换（failover）** | 当前只在选择的图床上尝试；可以做"失败后自动切备份图床" |
| **#13** | **国际化（i18n）** | `upload_error.ts` 已经准备了中英文，但还没接入到所有提示文案 |

---

### 3️⃣ 什么最简单（实现成本 / 预估代码量）

下面按**代码量从少到多**排序（代码越少说明越容易做）：

| 优先级 | 任务 | 预估文件数 | 预估行数 | 难度 | 说明 |
|--------|------|-----------|---------|------|------|
| **⭐⭐⭐ 最简单** | **文件哈希 + 去重（Step 1）** | 1 文件（修改 `01_prepare.ts`） | ~20 行新增 | 🟢 低 | 用 Node.js `crypto.createHash('sha256')`，在读取文件后加一步 |
| **⭐⭐⭐** | **Step 5 CHECK URL 校验** | 1 文件（修改 `05_check.ts`） | ~30 行 | 🟢 低 | 用 `fetch(url, { method: 'HEAD' })` 验证返回 2xx；注意加超时 |
| **⭐⭐⭐** | **CLI 入口（最小可运行版）** | 1 新文件 `src/cli.ts` | ~80 行 | 🟢 低 | 解析 `process.argv`，调用 `UploadContext.upload()`，打印结果 |
| **⭐⭐ 中等** | **配置文件加载器** | 1 文件 `src/config.ts` + 1 示例 `config.example.json` | ~100 行 | 🟡 中 | 读取 `~/.picgo-upload-layer/config.json`，没有就自动创建默认值 |
| **⭐⭐** | **网络重试（backoff）** | 局部修改 `modules/*` + `04_upload.ts` | ~50 行 | 🟡 中 | 在 `mod.upload()` 外层包一层重试循环（3 次 + 200/400/800ms 退避） |
| **⭐⭐** | **3 个新图床模块** | 3 个新文件（qiniu.ts / aliyun-oss.ts / lskypro.ts） | 每个 ~80 行 | 🟡 中 | 每个图床都是独立文件 + 统一接口，按模板复制即可 |
| **⭐ 较难** | **真实图片压缩（Step 2 TRANSFORM）** | 1 文件重写 `02_transform.ts` + 新增 `sharp` 依赖 | ~80 行 + 1 npm 包 | 🟠 中高 | 需要引入 `sharp`（但这会打破"零依赖"承诺；或者用 `imagemin` 等替代品，或者 Node.js 原生能力压缩 PNG → WebP） |
| **⭐ 较难** | **相册持久化（SQLite）** | 1 文件 `src/album.ts` + 新增 `better-sqlite3` 依赖 | ~150 行 | 🟠 中高 | CRUD：`save(UploadResult)` / `findByDate()` / `findByHost()` / `delete()` |
| **⭐⭐ 长期** | **单元测试体系** | 每个 step/module 1 个测试文件，约 8~10 个文件 | 每个 ~100 行 | 🟡 中 | 用 Node.js 内置 `node:test` 或继续用当前手写风格 |

---

### 4️⃣ 推荐优先级（综合考虑"价值" × "成本"）

按 **从最该先做到最不急** 排序：

| 优先级 | 任务 | 价值 | 成本 | 价值/成本比 | 建议 |
|--------|------|------|------|------------|------|
| **🔝 P0 — 立即做** | **① CLI 入口 + ② 配置文件** | 🟥 极高（让项目"可以用"） | 🟢 极低（~180 行 / 2 文件） | **最高** | 这两项决定项目能不能从"代码"变成"工具"。没有这两项，项目就是个**库 demo**，不是真正可被人使用的 PicGo 替代品 |
| **P1 — 紧接着做** | **③ 文件哈希 + 去重** <br> **④ 3 个新图床** | 🟧 高（功能完整性） | 🟢 低（~260 行 / 4 文件） | **很高** | 这两项是"纯粹扩功能"，不涉及架构变动，完全遵循已有接口模板。**做的过程中同时也是在验证架构设计**（如果每个新图床都只需要 80 行左右，说明 UploaderModule 接口设计合理） |
| **P2 — 做了就"能用"** | **⑤ 网络重试** <br> **⑥ URL 校验** | 🟧 高（鲁棒性） | 🟡 中（~80 行） | **高** | 真实网络环境下这两项会拦截掉大部分"偶发失败"。代码量不大但体验提升显著 |
| **P3 — 完善阶段** | **⑦ 真实图片压缩** <br> **⑧ 相册持久化** | 🟧 中高（用户体验 + 数据留存） | 🟠 中高（需引入依赖 + ~230 行） | **中** | 打破"零运行时依赖"承诺需要决策。可以做成**可选依赖**（不装 `sharp` 就不压缩，跳过 Step 2） |
| **P4 — 专业级** | **⑨ 单元测试体系** <br> **⑩ 多图床故障切换 (failover)** | 🟡 中（工程质量 / 高级功能） | 🟡 中（~800 行 / 10+ 文件） | **中** | 测试给你重构信心；failover 让上传成功率接近 100%。但这两个都有"架构设计决策"的成分，不急着一上来就做 |
| **P5 — 锦上添花** | **⑪ Electron / Tauri GUI** <br> **⑫ 拖拽与剪贴板** | 🟡 中低（但这是"PicGo 的灵魂"） | 🔴 高（整层 UI 重写） | **低** | GUI 可以等底层引擎稳定后再做。底层越稳，上层 UI 越薄 |
| **P6 — 可有可无** | **⑬ 国际化** | 🟩 低 | 🟢 低 | 视需求而定 | 用户群体稳定后再考虑英文用户 |

---

### 5️⃣ 总结：一句话版本

> **先让项目"能用"（CLI + 配置文件，~2 小时），再让它"好用"（更多图床 + 网络重试，~1 天），最后让它"专业"（压缩 + 相册 + 测试，~1 周）。**

**推荐的真实推进路径：**

```
第 1 步 —  CLI + 配置文件（P0，核心目标：用户能敲一行命令上传）
   │
   ▼
第 2 步 —  新增 3 个图床模块 + 文件哈希去重（P1，验证架构可扩展）
   │
   ▼
第 3 步 —  网络重试 + URL 校验（P2，提升鲁棒性）
   │
   ▼
第 4 步 —  图片压缩 + 相册持久化（P3，用户体验）
   │
   ▼
第 5 步 —  单元测试 + failover + i18n（P4/P5/P6，专业级）
```

---

## 🛣️ 路线图 / TODO

**近期（v0.2 / v0.3）**

- [ ] **`transform` step 接入 `sharp`**：对超大图片做真实的压缩和格式转换（PNG→JPEG、尺寸缩放）
- [ ] **`check` step 真实 HEAD 请求**：验证 `imgUrl` 的 HTTP 可访问性（超时处理）
- [ ] **配置文件**：`~/.picgo-upload-layer/config.json` 支持多图床切换、默认优先级、自定义字段

**中期（v1.0）**

- [ ] **更多内置图床**：七牛云 / 腾讯云 COS / 阿里云 OSS / 又拍云 / 兰空
- [ ] **持久化相册**：SQLite 存储上传历史，支持搜索、批量删除、重新获取链接
- [ ] **CLI 工具**：`picgo upload file.png`、`picgo list`、`picgo delete`
- [ ] **Electron / Tauri GUI**：替换 PicGo 桌面前端，复用本项目作为核心引擎

**长期（v2.0+）**

- [ ] **拖拽上传**：监听系统剪贴板，一键上传
- [ ] **国际化（i18n）**：中文/英文双语（`upload_error.ts` 已预留框架）
- [ ] **Web Dashboard**：浏览器端查看上传历史和统计图表

---

## ❓ FAQ（常见问题）

**Q：为什么不直接用 PicGo 原项目？**

> PicGo 是一个成熟的桌面应用，但其上传核心基于事件链架构。本项目的目标是做一个**更清晰、更易维护、更易扩展**的上传核心层，可以独立使用，也可以作为未来 PicGo 的底层引擎替换。

**Q：为什么是 libc 架构？**

> glibc-packages 的"头文件声明接口 + 标准化构建管线 + 独立模块"的模式在大型系统编程中已经验证了几十年。这套模式天然解决了"接口在哪里看？流程怎么走？如何加新图床？"三大痛点。

**Q：为什么没有运行时依赖？**

> Node.js 18+ 已经内置了 `fetch`、`FormData`、`Blob`、`TextEncoder`，足以处理所有图片上传场景。**零依赖** = 更少的安全隐患 + 更小的安装体积 + 更快的启动速度。

**Q：如何在现有项目中引入？**

> 当前版本还需要 clone 并在本地引用 `src/upload/`。当 API 稳定后（v1.0），会发布到 npm：`npm install picgo-upload-layer`。

**Q：如何贡献代码？**

> 欢迎提交 PR！请确保：
> 1. 所有公共 API 在 `upload_ctx.h.ts` 中声明
> 2. 新的 step 遵循 `(ctx, filePaths?) => UploadErrCode` 签名
> 3. 新增图床模块遵循 `UploaderModule` 接口
> 4. 通过现有测试（`node --loader tsx test/integration.test.ts`）

---

## 🤝 参与贡献

欢迎任何形式的贡献！你可以：

- 🐛 **提交 Issue**：报告 bug、请求新功能、提出架构建议
- 🔀 **提交 PR**：修复 bug、实现新图床、完善文档、增加测试用例
- 💬 **讨论**：在 README 评论区分享你的使用场景和想法

### 开发环境

```bash
# 1. 克隆
git clone https://github.com/ghshhf/PicGo.git
cd PicGo

# 2. 安装开发依赖（仅 3 个包）
npm install

# 3. 开发模式：监视文件变化
npm run dev

# 4. 运行测试（确保你的改动没有破坏现有功能）
npm test

# 5. 构建产物
npm run build
```

### 代码规范

- ✅ 使用 TypeScript **strict 模式**（`noImplicitAny: true`、`strictNullChecks: true`）
- ✅ 所有公共接口在 `upload_ctx.h.ts` 中**声明**，再在对应 `.ts` 实现
- ✅ 新增 `error` 场景时，务必在 `upload_error.ts` 中添加对应的中文/英文描述
- ✅ 新图床模块：文件名 = `<name>.ts`，`name` 字段与文件名保持一致
- ✅ 每次重要变更更新 README（新增章节或更新现有章节）

---

## 📜 变更历史

### v0.1.0（当前）

- ✅ 核心架构：`UploadCtx` + 声明式头文件
- ✅ 6 步流水线：prepare / transform / configure / upload / check / commit
- ✅ 图床模块系统：`registerModule()` / `getModule()` / `listModules()`
- ✅ 内置 SM.MS 图床
- ✅ 内置 GitHub Content API 图床
- ✅ 运行时统计（`getStats()`）
- ✅ 健康检查（`healthCheck()`）
- ✅ 集成测试（mock 图床，6 个场景）
- ✅ 完整的项目文档（README + package.json）

---

## 🙏 致谢

- **glibc-packages / AI-TP OS** —— 提供了模块化和流水线的架构灵感
- **PicGo** —— 原始项目，定义了"图片上传"的核心场景
- **Node.js 18+** —— 内置的 `fetch`、`FormData`、`Blob` 让零依赖成为可能
- **TypeScript 5.4** —— 严格模式让代码在运行前就排除了一大类错误

---

## 📜 License

**MIT License** —— 你可以自由地：复制、修改、分发、商用，**唯需保留版权和许可声明**。

```
Copyright (c) 2026 ghshhf

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

<div align="center">

**Made with ❤️ in the spirit of glibc & AI-TP OS —— 清晰的架构胜过一切魔法。**

*Repository: [github.com/ghshhf/PicGo](https://github.com/ghshhf/PicGo)*

</div>
