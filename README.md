# picgo-upload-layer

> 基于 **libc 架构理念**（glibc-packages / AI-TP OS）重构的 PicGo 上传图层：
> **统一上下文 + 声明式接口 + 6 步标准流水线 + 独立图床模块**。

---

## 一、架构对比

| 维度 | 传统 PicGo（event-driven） | picgo-upload-layer（libc-style） |
|------|-----------------------------|---------------------------------|
| **核心抽象** | 全局对象 + 字符串事件 (`ctx.on('upload', ...)`) | 统一 `UploadCtx` + 类型化 API |
| **上传流程** | 隐式事件链 (`beforeUploadPlugins` → `uploader` → `afterUploadPlugins`) | 显式 6 步流水线（`prepare → transform → configure → upload → check → commit`） |
| **错误处理** | try/catch + 字符串错误消息 | 统一 `UploadErrCode` 枚举 |
| **图床模块** | plugin 混合对象（含 UI / 设置 / 上传） | 纯函数 `upload(file, config) → imgUrl` |
| **并发控制** | 无（全交给插件自己处理） | 内置 3 并发限制 + 进度通知 |
| **统计监控** | 无 | `getStats()` / `healthCheck()` |

---

## 二、目录结构

```
src/upload/
├── upload_ctx.h.ts         ← 声明式接口头文件（所有类型 / 枚举 / 签名集中一处）
├── upload_ctx.ts           ← 核心实现（UploadContext API + 流水线调度）
├── upload_error.ts         ← 错误码 → 中文消息映射
├── upload_callback.ts      ← 回调注册（多监听器支持）
├── upload_stats.ts         ← 运行时统计 + 健康检查
├── index.ts                ← 统一导出入口
├── upload_steps/           ← 6 步流水线（每步独立文件，统一签名）
│   ├── 01_prepare.ts       ← 读取文件元信息
│   ├── 02_transform.ts     ← 图片预处理（压缩/格式转换）
│   ├── 03_configure.ts     ← 选择图床 + 校验配置
│   ├── 04_upload.ts        ← 调用图床模块实际上传
│   ├── 05_check.ts         ← 校验上传结果
│   └── 06_commit.ts        ← 写回 + 通知
└── modules/                ← 图床模块（与流水线解耦）
    ├── registry.ts         ← 模块注册表（registerModule / getModule）
    ├── index.ts            ← 统一导出
    ├── smms.ts             ← SM.MS（表单 multipart 上传）
    └── github.ts           ← GitHub（Content API PUT 上传）
```

---

## 三、快速上手

```ts
import {
  UploadContext, UploadErrCode, formatError,
  onProgress, onSuccess, bindCallbacks,
  getStats,
} from './src/upload'

// 1) 加载内置图床模块（会自动 registerModule）
import './src/upload/modules'

// 2) 初始化 + 注册路由
UploadContext.init()
UploadContext.registerRoute({
  name: 'smms',
  host: 'sm.ms',
  protocol: 'https',
  priority: 1,
  enabled: true,
  config: { token: 'YOUR_SMMS_TOKEN' },
})
UploadContext.setRoute('smms')

// 3) 注册回调
bindCallbacks(UploadContext.getCtx())
onProgress((p) => console.log(`[${p.step}] ${p.progress}%`), UploadContext.getCtx())
onSuccess((results) => {
  results.forEach((r) => console.log(r.markdownUrl))
}, UploadContext.getCtx())

// 4) 上传
const code = await UploadContext.upload(['/path/to/img1.png', '/path/to/img2.jpg'])
if (code !== UploadErrCode.UPLOAD_OK) {
  console.error(formatError(code))
}

// 5) 查看统计
console.log(getStats().successRate)
```

---

## 四、添加新图床（只需 1 个文件）

在 `src/upload/modules/` 下创建 `<name>.ts`：

```ts
import * as fs from 'fs'
import { UploadFileInfo } from '../upload_ctx.h'
import { registerModule, UploaderModule, UploadRawResult } from './registry'

async function upload(file: UploadFileInfo, config: Record<string, any>): Promise<UploadRawResult> {
  // 你的上传逻辑：读文件 → 发请求 → 解析响应
  const buffer = fs.readFileSync(file.filePath)
  const resp = await fetch('https://your-host.com/api/upload', { method: 'POST', body: buffer })
  const data = await resp.json()
  return { imgUrl: data.url, webUrl: data.page, raw: data }
}

export const myModule: UploaderModule = {
  name: 'my-host',
  version: '1.0.0',
  upload,
}

registerModule(myModule)  // 自动注册
```

然后在 `src/upload/modules/index.ts` 加一行 `export * from './my-host'`，即可在路由中使用。

---

## 五、设计理念（与 AI-TP OS 的对应关系）

| AI-TP OS 概念 | 本项目对应 | 说明 |
|--------------|-----------|------|
| `ai_tp_gw_context_t` | `UploadCtx` | 统一上下文：生命周期 / 路由 / 当前批次 / 统计 |
| `ai_tp_gw_route_t` | `UploadRoute` | 每个图床 = 一个 route（含 name / config / priority） |
| `ai_storage_file_t` | `UploadFileInfo` | 文件元信息：路径 / 大小 / MIME / 哈希 |
| `AI_STORAGE_ERR_*` | `UploadErrCode` | 枚举化错误码（代替字符串消息） |
| `on_connection` 回调 | `UploadCallbacks` | 明确签名的函数回调（代替字符串事件） |
| 6 步 build pipeline | 6 步 upload pipeline | `prepare → transform → configure → upload → check → commit` |
| 独立模块（gateway / storage / worker） | 独立图床模块（smms / github / ...） | 模块间通过统一接口协作，互不感知 |

---

## 六、测试

```bash
# 运行集成测试（通过 mock 图床模块验证完整流水线）
node --loader tsx test/integration.test.ts
```

见 `test/integration.test.ts` —— 通过 mock 一个图床模块（不发真实网络请求）验证：
- 初始化 / 路由切换
- 6 步流水线全部通过
- 进度回调正常触发
- 统计数据正确累计
- 错误场景（文件不存在 / 未选图床 / 模块异常）处理正确

---

## 七、TODO（后续演进方向）

- [ ] `transform` step 接入 `sharp` 做真实图片压缩
- [ ] `check` step 做真实 URL HEAD 请求校验
- [ ] 接入更多内置图床（七牛 / 腾讯云 COS / 阿里云 OSS / 又拍云）
- [ ] 接入持久化相册（SQLite / JSON 文件）
- [ ] Web UI（Electron / Tauri）替换 PicGo GUI
- [ ] CLI 命令行工具（`picgo upload file.png`）
