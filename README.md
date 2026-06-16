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

</div>

---

## 📖 项目简介

`picgo-upload-layer` 是一个**自下而上**、用 **glibc-packages / AI-TP OS 的模块化 + 流水线架构**重新设计的图片上传引擎。

传统 PicGo 的上传层依赖于隐式的事件链（`beforeUploadPlugins → uploader → afterUploadPlugins`），插件逻辑与核心耦合、错误处理零散、扩展和调试都较为困难。本项目借鉴 Linux 系统编程中"**头文件声明接口 + 源文件实现逻辑 + 标准化构建管线**"的成熟实践，将整个上传过程抽象为：

- **一个上下文** — `UploadCtx`：集中管理生命周期、路由、当前批次、统计
- **一份声明** — `upload_ctx.h.ts`：集中声明所有类型、枚举、函数签名
- **一条流水线** — `prepare → transform → configure → upload → check → commit`
- **一组模块** — 每个图床只实现一个纯函数：`upload(file, config) → imgUrl`

由此带来的收益：

- ✅ **类型可靠**：不再在字符串事件名里猜参数，所有接口签名都在头文件
- ✅ **结构清晰**：6 步流水线每一步独立可测、可替换、可扩展
- ✅ **易于调试**：进度回调 + 统计 + `healthCheck()` 三位一体
- ✅ **零依赖**：仅使用 Node.js 标准库（`fs`/`path`/`os`/`fetch`），无需第三方网络库
- ✅ **即插即用**：新图床只需一个文件 + `registerModule()` 即可接入

---

## 🏗️ 架构对比

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
| **依赖** | electron + 多种第三方库 | **零运行时依赖**（仅 Node.js 标准库） |

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

一个文件即可读懂整个系统能力：

- **枚举**：`UploadErrCode`（10 种错误码）、`UploadStepState`（pending/running/success/failed/cancelled）
- **类型**：`UploadFileInfo`、`UploadResult`、`UploadRoute`、`UploadStats`、`UploadCallbacks`、`UploadCtx`
- **函数签名**：`UploadStepFn = (ctx, filePaths?) => UploadErrCode | Promise<UploadErrCode>`
- **常量**：`STEP.PREPARE` … `STEP.COMMIT` + `STEP_NAMES`

### 3. 6 步标准流水线

每一步都是独立文件，统一签名，互不干扰：

| 步骤 | 文件 | 职责 |
|------|------|------|
| **01** PREPARE | `upload_steps/01_prepare.ts` | 校验路径、读取文件大小、MIME、哈希 |
| **02** TRANSFORM | `upload_steps/02_transform.ts` | 图片压缩/格式转换（预留扩展点） |
| **03** CONFIGURE | `upload_steps/03_configure.ts` | 选中图床、校验必填配置字段 |
| **04** UPLOAD | `upload_steps/04_upload.ts` | 调用图床模块、并发限制、进度通知 |
| **05** CHECK | `upload_steps/05_check.ts` | 校验 `imgUrl` 有效性、过滤失败项 |
| **06** COMMIT | `upload_steps/06_commit.ts` | 汇总结果、生成 Markdown 链接 |

### 4. 独立可插拔的图床模块

每个图床只实现一个接口：

```ts
interface UploaderModule {
  name: string
  version: string
  upload: (file: UploadFileInfo, config: Record<string, any>) => Promise<{ imgUrl: string }>
}

registerModule(myModule)      // 注册
getModule('smms')              // 查询
listModules()                  // 列出全部
```

目前内置：

| 模块 | 文件 | 模式 | 配置项 |
|------|------|------|--------|
| **SM.MS** | `modules/smms.ts` | multipart/form-data POST | `{ token }` |
| **GitHub** | `modules/github.ts` | Content API PUT（base64） | `{ token, repo, branch, path, customUrl? }` |

### 5. 完整的统计 + 健康检查

```ts
getStats()
// → { totalUploads, successCount, failCount, successRate, totalBytesHuman, avgTimeMs, ... }

formatStats()
// → 人类可读的 ASCII 报告（累计次数/成功率/字节/平均耗时/上次上传时间）

healthCheck()
// → { initialized, routes: [{ name, enabled, moduleRegistered, hasRequiredConfig }], modules: [...] }
```

---

## 📂 目录结构

```
picgo-upload-layer/
├── package.json                        # 项目元信息（description / keywords / repository）
├── tsconfig.json                       # TypeScript 配置（ES2022 + strict 模式）
│
├── src/upload/
│   ├── index.ts                        # ── 统一导出入口
│   ├── upload_ctx.h.ts                 # ── 声明式接口头文件（所有类型 / 枚举 / 签名）
│   ├── upload_ctx.ts                   # ── UploadContext 核心 API + 6 步流水线调度
│   ├── upload_error.ts                 # ── 错误码 → 中英文描述映射 + 等级判断
│   ├── upload_callback.ts              # ── 多监听器回调系统（onProgress / onSuccess / ...）
│   ├── upload_stats.ts                 # ── 运行时统计 + healthCheck 健康检查
│   │
│   ├── upload_steps/                   # ── 6 步标准流水线
│   │   ├── 01_prepare.ts               #     读取文件元信息
│   │   ├── 02_transform.ts             #     图片预处理（压缩/格式转换）
│   │   ├── 03_configure.ts             #     选择图床 + 校验配置
│   │   ├── 04_upload.ts                #     调用图床模块实际上传
│   │   ├── 05_check.ts                 #     校验上传结果
│   │   └── 06_commit.ts                #     写回 + 通知
│   │
│   └── modules/                        # ── 图床模块（与流水线解耦）
│       ├── registry.ts                 #     模块注册表（registerModule / getModule）
│       ├── index.ts                    #     统一导出
│       ├── smms.ts                     #     SM.MS（表单 multipart/form-data 模式）
│       └── github.ts                   #     GitHub（Content API PUT 模式）
│
└── test/
    └── integration.test.ts             # 6 个集成测试用例（mock 图床模块，不发网络请求）
```

---

## 🚀 快速上手

### 前置要求

- **Node.js ≥ 18**（需要内置 `fetch` 和 `FormData`）
- **TypeScript ≥ 5.4**（已在 `package.json` 中声明）

### 安装

```bash
# 克隆本仓库
git clone https://github.com/ghshhf/PicGo.git
cd PicGo

# 安装开发依赖（用于编译和运行测试）
npm install
```

### 最小示例

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

// 1) 加载内置图床模块（会自动 registerModule）
import './src/upload/modules'

// 2) 初始化 + 注册图床路由
UploadContext.init()

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

// 3) 选择要使用的图床
UploadContext.setRoute('smms')

// 4) 绑定回调（监听上传过程）
bindCallbacks(UploadContext.getCtx())

onProgress((p) => {
  console.log(`  [Step ${p.step}/${p.stepName}] ${p.progress}%`)
}, UploadContext.getCtx())

onSuccess((results) => {
  console.log('\n✅ 上传完成：')
  results.forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.markdownUrl}`)
  })
  console.log('\n📊 累计统计：')
  console.log(getStats())
}, UploadContext.getCtx())

// 5) 上传
const code = await UploadContext.upload([
  '/path/to/screenshot.png',
  '/path/to/photo.jpg',
])

if (code !== UploadErrCode.UPLOAD_OK) {
  console.error('\n❌ 上传失败：', formatError(code))
  process.exit(1)
}
```

### 运行测试

```bash
node --loader tsx test/integration.test.ts
```

测试覆盖 6 个场景：成功上传、文件不存在、未选图床、模块未注册、统计累计、健康检查。所有测试用 mock 图床模块，**不会向真实网络发送请求**。

---

## 🔌 添加新图床（只需 1 个文件）

在 `src/upload/modules/` 下创建 `your-host.ts`：

```ts
import * as fs from 'fs'
import { UploadFileInfo } from '../upload_ctx.h'
import { registerModule, UploaderModule } from './registry'

async function upload(
  file: UploadFileInfo,
  config: Record<string, any>,
): Promise<{ imgUrl: string; raw?: any }> {
  const buffer = fs.readFileSync(file.filePath)
  const resp = await fetch('https://your-host.com/api/v1/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}` },
    body: buffer,
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const data = await resp.json()
  return { imgUrl: data.url, raw: data }
}

export const yourHostModule: UploaderModule = {
  name: 'your-host',
  version: '1.0.0',
  upload,
}

registerModule(yourHostModule)
```

然后在 `src/upload/modules/index.ts` 添加一行：

```ts
export * from './your-host'
```

就可以像这样使用了：

```ts
UploadContext.registerRoute({
  name: 'your-host',
  host: 'your-host.com',
  protocol: 'https',
  priority: 3,
  enabled: true,
  config: { token: '...' },
})
```

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

核心思想：**把软件系统当作操作系统来设计**——有清晰的上下文（进程）、声明式的接口（头文件）、标准化的处理管线（构建系统）、可插拔的模块（共享库）。

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
UploadContext.getCtx()                     // 获取完整上下文
```

### 错误码

```ts
UploadErrCode.UPLOAD_OK            // 0  成功
UploadErrCode.UPLOAD_ERR_INIT      // 1  未初始化
UploadErrCode.UPLOAD_ERR_IO        // 2  文件读写错误
UploadErrCode.UPLOAD_ERR_CONFIG    // 3  配置错误
UploadErrCode.UPLOAD_ERR_NOT_FOUND // 4  图床/文件不存在
UploadErrCode.UPLOAD_ERR_OVERLOAD  // 5  超过并发/大小限制
UploadErrCode.UPLOAD_ERR_CANCEL    // 6  用户取消
UploadErrCode.UPLOAD_ERR_PLUGIN    // 7  图床模块异常
UploadErrCode.UPLOAD_ERR_NETWORK   // 8  网络错误
UploadErrCode.UPLOAD_ERR_VALIDATE  // 9  结果校验失败
UploadErrCode.UPLOAD_ERR_UNKNOWN   // 99 未知错误
```

### 回调

```ts
import { onProgress, onSuccess, onError, onCancel, bindCallbacks } from 'picgo-upload-layer'

bindCallbacks(UploadContext.getCtx())

onProgress(({ step, stepName, progress, bytesProcessed, bytesTotal, elapsedMs }) => ...)
onSuccess((results) => ...)
onError((code, msg) => ...)
onCancel(() => ...)
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

getStats()                       // { totalUploads, successCount, failCount, successRate, ... }
formatStats()                    // 人类可读 ASCII 报告
healthCheck()                    // { initialized, routes: [...], modules: [...] }
```

---

## 📊 项目元信息

| 字段 | 值 |
|------|------|
| **仓库地址** | https://github.com/ghshhf/PicGo |
| **许可证** | MIT |
| **作者** | ghshhf |
| **Node 要求** | ≥ 18.0.0 |
| **TypeScript** | 5.4+ |
| **运行时依赖** | **无**（仅 Node.js 标准库） |
| **开发依赖** | `@types/node` · `tsx` · `typescript` |
| **代码行数** | ~2,100 行（20 个源文件） |
| **测试用例** | 6 个（mock 图床，不发网络请求） |

---

## 🛣️ 路线图 / TODO

- [ ] **`transform` step 接入 sharp**：对超大图片做真实的压缩和格式转换
- [ ] **`check` step 真实 HEAD 请求**：校验 `imgUrl` 的 HTTP 200 可访问性
- [ ] **更多内置图床**：七牛云 / 腾讯云 COS / 阿里云 OSS / 又拍云 / 兰空
- [ ] **持久化相册**：SQLite 或 JSON 文件存储上传历史，支持搜索和批量删除
- [ ] **CLI 工具**：`picgo upload file.png`、`picgo list`、`picgo delete`
- [ ] **Electron / Tauri GUI**：替换 PicGo 桌面前端，复用本项目作为核心引擎
- [ ] **配置文件**：`~/.picgo/config.json` 支持多图床切换、默认优先级
- [ ] **拖拽上传**：监听系统剪贴板，一键上传
- [ ] **国际化**：i18n 支持（中文/英文已在 `upload_error.ts` 预留框架）

---

## 📜 License

**MIT** — 你可以自由地：复制、修改、分发、商用，**唯需保留版权和许可声明**。

详细条款见 [LICENSE](LICENSE)。

---

<div align="center">

**Made with ❤️ in the spirit of glibc & AI-TP OS — 清晰的架构胜过一切魔法。**

</div>
