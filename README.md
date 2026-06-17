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

#### 内置图床一览（5 个）

| 图床名 | `routes[i].name` | 必填配置字段 | 工作模式 | 零依赖? |
|--------|-----------------|-------------|---------|---------|
| SM.MS | `smms` | `token` | multipart/form-data POST | ✅ |
| GitHub (Content API) | `github` | `token`, `repo`, `branch`, `path`, `customUrl` | PUT binary to `/repos/:owner/:repo/contents/:path` | ✅ |
| 七牛云 KODO | `qiniu` | `accessKey`, `secretKey`, `bucket`, `domain`, `path` | HMAC-SHA1 签名 + multipart/form-data | ✅ |
| 腾讯云 COS | `tencent-cos` | `secretId`, `secretKey`, `bucket`, `region`, `domain`, `path` | COS v5 签名 + PUT binary | ✅ |
| 阿里云 OSS | `aliyun-oss` | `accessKeyId`, `accessKeySecret`, `bucket`, `region`, `domain`, `path` | OSS v2 签名 + PUT binary | ✅ |

> ✅ **全部零 npm 运行时依赖**（只用 Node.js `crypto` + `fetch`）。

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

## 🔄 兼容性故事：为什么我们能兼容上游，而上游不能兼容我们

> **核心观察**：PicGo（原始项目）是 Electron 桌面应用，它的"上传能力"其实是个**副产品** —— 嵌入在 UI 事件链里。我们把它**从底层重构为系统级的上传服务**。

### 1. 我们能兼容上游（PicGo 的使用场景）

| PicGo 的典型用法 | 本项目等价能力 | 兼容性 |
|-----------------|-------------|-------|
| 选图床 → 上传 → 得到 URL | `UploadContext.upload([filePath])` → `ctx.results` | ✅ 全覆盖 |
| 插件式图床（smms / github / tcyun...） | 独立 `UploaderModule`（同名或重新实现） | ✅ 一个文件一个图床 |
| Markdown 输出 | `UploadResult.markdownUrl` | ✅ 字段齐全 |
| 进度回调 | `UploadStepProgress`（6 步每步有进度） | ✅ 更细粒度 |

更重要的是，**我们的底层是纯 Node.js / TypeScript / 零依赖**：

| 平台 | 能跑吗? | 原因 |
|------|---------|------|
| macOS / Windows / Linux 桌面 | ✅ | Node.js 原生支持 |
| Linux 服务器（无 GUI） | ✅ | 纯 CLI，不需要 X11 / Wayland |
| 容器 (Docker) | ✅ | 任何 Node.js 镜像都能跑 |
| CI/CD (GitHub Actions / Gitee CI) | ✅ | GitHub Actions runner 自带 Node.js |
| Android Termux / iOS a-Shell | ⚙️ 可移植 | 只要有 Node.js 的环境就能跑 |
| 纯前端（浏览器） | ⚠️ 有限 | `fetch` 可运行，但 `fs` 读本地文件需要 Web API 适配层 |

**一句话**：上游只能在装了 Electron 的桌面跑；本项目**所有有 Node.js 的地方都能跑**。

---

### 2. 上游不能兼容我们（我们的新能力超出了 PicGo 原始架构）

| 本项目能力 | PicGo 能做到吗? | 为什么做不到 |
|-----------|------------------|------------|
| **统一上下文 UploadCtx** — 所有状态可序列化可传递 | ❌ 不能 | PicGo 状态分散在 `ctx.beforeTransform / ctx.output / this.$appConfig / 各 plugin 内部闭包`，没有一个可导出的统一上下文 |
| **6 步显式流水线** — 每步独立可跳过、可测试 | ❌ 不能 | 原始 PicGo 上传是隐式事件链，插在哪里、顺序是否正确，取决于各插件监听时机 |
| **强类型错误码枚举** `UploadErrCode` | ❌ 不能 | 原始 PicGo 错误是字符串消息，调用方没法程序化判断 |
| **图床模块纯函数** `upload(file, config) → imgUrl` | ❌ 不能 | PicGo 插件依赖全局 `ctx` 对象，不能独立在浏览器 / 单测 / Node.js 脚本里直接调用 |
| **健康检查 `healthCheck()`** — 查当前配置了多少图床、哪些模块已注册、哪些缺少 token | ❌ 不能 | 原始 PicGo 没有"系统状态查询"这类概念 |
| **上传前哈希去重**（SHA-256） | ❌ 不能 | PicGo prepare 阶段只做文件大小校验，没有内容级去重 |
| **指数退避网络重试**（`upload_retry.ts`） | ❌ 不能 | PicGo 各插件自行处理网络请求，统一的重试策略需要改每个插件 |
| **跨平台二进制部署**（pkg / 单文件 CLI） | ❌ 不能 | Electron 打包出 200MB，无法用作服务器命令行工具 |

**一句话**：我们的能力是"系统级"的 —— 可嵌入、可测试、可组合。PicGo 的能力是"桌面应用级"的 —— 绑定了 Electron UI 才能工作。

---

### 3. 为什么上游的问题我们不需要等上游修

| 常见上游问题 | 本项目的解法 |
|-------------|------------|
| 某个图床插件长期无人维护 | ✅ 每个图床是独立文件，你自己可以写一个替换 |
| 大图片上传经常超时 | ✅ `upload_retry.ts` 统一 3 次指数退避重试 |
| 上传后 URL 验证缺失 | ✅ 第 5 步 `CHECK` 专门做 HEAD 验证 |
| 重复上传相同截图 | ✅ 第 1 步 `PREPARE` 计算 SHA-256 自动去重 |
| 配置格式混乱，每个插件要求不同字段 | ✅ 统一 `UploadRoute.config` JSON 结构，类型签名写在 `upload_ctx.h.ts` |
| 上游依赖 Electron 的版本问题 | ✅ 我们不需要 Electron，用 Node.js 18+ 即可 |

**核心思想**：与其等一个不活跃的上游修，不如**在底层把这些问题都抽象成系统能力**。glibc-packages 就是这个思路 —— 构建系统、包管理、跨平台兼容，都在底层解决，不把问题抛给上游。

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
│   ├── config.ts                    # ── 配置文件加载器（~/.picgo-upload-layer/config.json）
│   ├── cli.ts                       # ── 命令行入口（upload / list / stats / health / init-config）
│   └── modules/                        # ── 图床模块（与流水线解耦）
│       ├── registry.ts                 #     模块注册表（registerModule / getModule）
│       ├── index.ts                    #     统一导出所有内置模块
│       ├── smms.ts                     #     SM.MS
│       ├── github.ts                   #     GitHub
│       ├── qiniu.ts                    #     七牛云 KODO
│       ├── tencent-cos.ts              #     腾讯云 COS
│       └── aliyun-oss.ts              #     阿里云 OSS
│
├── bin/
│   └── picgo-upload-layer.js         # ── 全局 CLI 入口（npm install -g 后可用）
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

### 命令行用法（推荐日常使用）

```bash
# 1) 首次运行：自动创建默认配置
node --loader tsx src/upload/cli.ts init-config
# → 已写入 ~/.picgo-upload-layer/config.json

# 2) 编辑配置文件，把 token 和图床字段填好
#   Windows:   %USERPROFILE%\.picgo-upload-layer\config.json
#   macOS/Linux: ~/.picgo-upload-layer/config.json

# 3) 查看当前已配置 / 已注册的图床
node --loader tsx src/upload/cli.ts list
#   smms       (启用, 已注册)
#   github     (启用, 已注册)
#   qiniu      (未启用, 已注册)
#   tencent-cos (未启用, 已注册)
#   aliyun-oss (未启用, 已注册)

# 4) 上传！（支持单文件、多文件）
node --loader tsx src/upload/cli.ts upload /path/to/screenshot.png
node --loader tsx src/upload/cli.ts upload img1.png img2.jpg img3.webp

# 5) 指定图床（不写就用 defaultRoute）
node --loader tsx src/upload/cli.ts upload img.png --route github

# 6) 查看统计
node --loader tsx src/upload/cli.ts stats

# 7) 健康检查（调试用）
node --loader tsx src/upload/cli.ts health

# 8) 查看上传历史/相册（默认最近 10 条）
node --loader tsx src/upload/cli.ts history
#   查看最近 30 条
node --loader tsx src/upload/cli.ts history 30
#   查看所有
node --loader tsx src/upload/cli.ts history all
#   只看某个图床
node --loader tsx src/upload/cli.ts history --route github
#   只看某一天之后
node --loader tsx src/upload/cli.ts history --since 2026-06-01
#   组合
node --loader tsx src/upload/cli.ts history --route qiniu --since 2026-06-01 20

# 9) 删除某条历史（history 输出里的 [id]）
node --loader tsx src/upload/cli.ts history-delete 20260617-xxxxxx

# 10) 也可以用 npm scripts（更短）
npm run upload -- /path/to/screenshot.png
npm run picgo-list
npm run picgo-stats
npm run picgo-health
npm run picgo-history -- 30
```

### 配置文件结构（~/.picgo-upload-layer/config.json）

```json
{
  "defaultRoute": "github",
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
        "token": "ghp_xxxxxxxxxxx",
        "repo": "your-name/your-repo",
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
    }
  ]
}
```

> 💡 **小贴士**：配置文件字段结构和代码里 `UploadRoute` 类型**完全一致**。如果你在 TypeScript 项目里用这个库，可以直接把 `routes` 数组传给 `UploadContext.registerRoute()`。

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

### 1️⃣ 当前已完成（架构核心，含本次重构）

| 模块 | 文件 | 状态 | 备注 |
|------|------|------|------|
| **声明式接口** | `upload_ctx.h.ts` | ✅ 完整 | 11 部分：错误码 / 文件元 / 结果 / 路由表 / Step-State / 进度回调 / 统计 / 回调接口 / UploadCtx / API 签名 / StepFn 常量 |
| **核心调度 + 多图床 failover** | `upload_ctx.ts` | ✅ **升级** | 6 步流水线 + 当前图床失败时自动切换到下一个 enabled 图床（按 priority 排序） |
| **错误码系统** | `upload_error.ts` | ✅ 完整 | 10 个错误码 + 中英文对照 + `formatError` 辅助 |
| **回调系统** | `upload_callback.ts` | ✅ 完整 | `onProgress` / `onSuccess` / `onError` / `onCancel` / `bindCallbacks` |
| **统计/健康检查** | `upload_stats.ts` | ✅ 完整 | `getStats` / `formatStats` / `healthCheck` + `totalBytesHuman` 美化 |
| **配置文件加载** | `config.ts` | ✅ **新增** | 读取 `~/.picgo-upload-layer/config.json`，首次运行自动创建默认值 |
| **命令行 CLI** | `cli.ts` | ✅ **新增** | `upload / list / stats / health / history / history-delete / history-clear`，支持 `--route` 指定图床 |
| **6 步流水线** | `upload_steps/01~06.ts` | ✅ **全面升级** | Step 1 支持 SHA-256 + 去重；Step 2 支持 MIME 校验；Step 4 包指数退避重试；Step 5 真实 HEAD URL 校验；Step 6 写入相册 JSONL |
| **图床注册表** | `modules/registry.ts` | ✅ 完整 | `registerModule` / `getModule` / `listModules` / `unregisterModule` |
| **内置图床（5 个）** | `modules/smms.ts` | ✅ 可用 | multipart/form-data 上传 |
| | `modules/github.ts` | ✅ 可用 | Content API PUT + base64 + customUrl |
| | `modules/qiniu.ts` | ✅ **新增** | 七牛云 KODO，HMAC-SHA1 签名 |
| | `modules/tencent-cos.ts` | ✅ **新增** | 腾讯云 COS，V5 签名 + PUT |
| | `modules/aliyun-oss.ts` | ✅ **新增** | 阿里云 OSS，V2 签名 + PUT |
| **网络重试** | `upload_retry.ts` | ✅ **新增** | 3 次指数退避（200/400/800ms），5xx 自动重试 |
| **相册持久化** | `upload_history.ts` | ✅ **新增** | JSON Lines 追加写入、`getHistory` 查询、按 id 删除 |
| **统一导出入口** | `index.ts` | ✅ 完整 | 对外集中暴露 `UploadContext` / `UploadErrCode` / `formatError` / `loadConfig` / `getHistory` |
| **集成测试** | `test/integration.test.ts` | ✅ 可运行 | mock 图床模块，覆盖成功路径 + 4 种失败模式 |

---

### 2️⃣ 剩下的工作（按严重程度排序）

#### 🟥 高严重性 — "影响日常使用"

| 排名 | 缺失项 | 影响 | 为什么重要 |
|------|--------|------|----------|
| **#1** | **Step 2 Transform 的真实图片压缩** | 🟡 中等 | `02_transform.ts` 已经做好 MIME 校验与压缩候选分类，但**只打印日志、不做真实字节压缩**。需要引入 `sharp` 完成 PNG → JPEG / 尺寸缩放 |
| **#2** | **单元测试（每个 step / module 独立测试）** | 🟡 中等 | `upload_retry.ts` 的指数退避、`qiniu/tencent/aliyun` 的签名算法、`upload_ctx.ts` 里的 failover 循环都缺少独立单测保护 |
| **#3** | **failover 的用户提示** | 🟢 低 | 现在"图床 A 失败 → 自动切到 B"是静默发生的。应该通过 `onError` 回调打印"正在切换"提示，让用户知道发生了什么 |

#### 🟨 中严重性 — "功能可以更完整"

| 排名 | 缺失项 | 影响 |
|------|--------|------|
| **#4** | **第 6~8 个图床**（LskyPro / 又拍云 / Gitee） | 国内还有一批常见图床；Gitee 对轻度使用友好且免费 |
| **#5** | ~~相册按路由/时间筛选~~ | ✅ 已完成：CLI `history --route x --since YYYY-MM-DD` |
| **#6** | **上传前的字节级预检**（不重复上传已知 hash 的图片） | 当前去重只在同一批上传内生效；跨批去重需要持久化 hash → 本地索引 |
| **#7** | **国际化（i18n）** | CLI 输出当前以中文为主。`upload_error.ts` 已具备中英文基础映射 |

#### 🟩 长期演进（架构层面的锦上添花）

| 排名 | 缺失项 | 影响 |
|------|--------|------|
| **#8** | **Electron / Tauri GUI** | 桌面 UI 是 PicGo 的"原生意境"。但底层引擎越稳定，上层 UI 越薄 |
| **#9** | **拖拽 / 剪贴板上传** | GUI 配套功能 |
| **#10** | **配置热加载**（修改 config.json 后立即生效，无需重启） |

---

### 3️⃣ 什么最简单 / 最优先

| 优先级 | 任务 | 预估行数 | 难度 | 为什么值得先做 |
|--------|------|---------|------|------------|
| **✅** | ~~failover 回调里打印"切换到 X"提示~~ | ~10 行 | 🟢 低 | 已完成 |
| **✅** | ~~相册的 `--since / --route` 筛选~~ | ~25 行 | 🟢 低 | 已完成 |
| **⭐⭐** | **接入 `sharp` 做真实图片压缩** | ~50 行 + 1 npm 包 | 🟡 中 | 这是打破"零运行时依赖"承诺的第一步，但对真实用户体验提升最大 |
| **⭐⭐** | **第 6~8 个图床模块**（又拍云 / LskyPro / Gitee） | 每个 ~80 行 | 🟡 中 | 已有 5 个图床做模板，按 Copy-Modify 就能出结果 |
| **⭐** | **i18n 文案整理** | ~20 行映射 | 🟢 低 | 只是"整理"，不涉及算法或 API |
| **⭐** | **为 `upload_retry.ts` / `qiniu.ts` 写单元测试** | 每个 ~40 行 | 🟡 中 | `test/unit.test.ts` 已存在，`npm run test:unit` 直接运行 |

---

### 4️⃣ 一句话总结

> **目前项目已经走到了「能用」阶段**（有 CLI、有配置文件、有 5 个内置图床、有 failover、有 retry、有相册持久化、有 history --route/--since 筛选）。
>
> 接下来只需做**两件事**就能达到「专业」：
> 1. 接入 `sharp` 做真实图片压缩
> 2. 补一批单元测试（签名算法 / 重试循环 / failover）



---

## 🛣️ 路线图 / TODO

**已完成 ✅**

- [x] **6 步标准流水线**：`prepare → transform → configure → upload → check → commit`
- [x] **声明式接口 + 统一错误码系统**（`upload_ctx.h.ts` + `upload_error.ts`）
- [x] **回调系统**：`onProgress` / `onSuccess` / `onError` / `onCancel`
- [x] **配置文件**：`~/.picgo-upload-layer/config.json`，支持多图床切换 + enabled 切换 + priority 排序
- [x] **命令行 CLI**：`node --loader tsx src/upload/cli.ts upload|list|stats|health|history|history-delete|...`
- [x] **内置图床（5 个）**：SM.MS / GitHub / **七牛云** / **腾讯云 COS** / **阿里云 OSS**
- [x] **网络重试**：指数退避（200/400/800ms），5xx 自动重试
- [x] **URL 校验**：`fetch HEAD` + 超时 + 非 2xx 识别
- [x] **图床故障切换（failover）**：当前 route 失败 → 自动试下一个 enabled route
- [x] **相册持久化**：JSON Lines 追加写入 `~/.picgo-upload-layer/history.jsonl`
- [x] **SHA-256 + 同批去重**
- [x] **MIME 类型校验 + 图片分类**
- [x] **统一导出入口** `index.ts`：对外暴露 `UploadContext` / `UploadErrCode` / `formatError` / `loadConfig` / `getHistory`

**近期（v0.2 / v0.3）**

- [ ] **`transform` step 接入 `sharp`**：对超大图片做真实的压缩和格式转换（PNG→JPEG、尺寸缩放）
- [x] **failover 的"正在切换"用户提示**：用户能看到"图床 A 失败 → 切到图床 B"的过程
- [x] **CLI `history` 加 `--route` / `--since` 筛选**：从相册里按图床或时间筛选
- [x] **单元测试**（upload_retry 指数退避 / qiniu 签名格式 / failover 路由选择）：`npm run test:unit`
- [ ] **上传前的跨批 hash 去重**：持久化 hash 索引，不同次 CLI 调用也能复用

**中期（v1.0）**

- [ ] **更多内置图床**：又拍云 / LskyPro / Gitee
- [ ] **Electron / Tauri GUI**：替换 PicGo 桌面前端，复用本项目作为核心引擎
- [ ] **npm 发布**：`npm install picgo-upload-layer`

**长期（v2.0+）**

- [ ] **拖拽 / 剪贴板上传**：监听系统剪贴板，一键上传
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
