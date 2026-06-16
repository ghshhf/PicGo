// ========================================================================
// registry.ts  — 图床模块注册表
//
// 设计灵感：
//   - C 中的动态模块（dlopen / dlsym）：运行时按 name 查找模块
//   - picgo-core 的 uploader plugin：每个图床 = 一个独立 plugin
//   - glibc-packages 的 repo.json：声明 name / version 等元信息
//
// 核心约定：每个图床模块必须实现 UploaderModule 接口，并通过 registerModule 注册
//   registerModule({ name, version, upload, delete? })
//
// 与 picgo-core 的关键差异：
//   - 不是字符串事件名 → 是明确的 upload(file, config) 函数签名
//   - 不是混合对象 → 模块只负责上传/删除，不包含 UI / 设置
//   - 支持版本号 → 便于模块升级与兼容检查
// ========================================================================

import { UploadFileInfo } from '../upload_ctx.h'

// 图床模块统一返回结构
export interface UploadRawResult {
  imgUrl: string                    // 图片直链（必填）
  webUrl?: string                   // 网页版链接（可选，用于相册展示）
  raw?: Record<string, any>         // 图床原始响应（保留完整信息）
}

// 图床模块统一接口（对应 picgo-core 的 'uploader' 插件类型）
export interface UploaderModule {
  name: string                      // 唯一标识（如 'smms'，必须与 UploadRoute.name 对应）
  version: string                   // 语义化版本号（如 '1.0.0'）
  upload: (
    file: UploadFileInfo,
    config: Record<string, any>
  ) => Promise<UploadRawResult>
  delete?: (url: string, config: Record<string, any>) => Promise<boolean>
}

// 全局注册表（对应 C 中 static 数组 + 索引）
const modules: Map<string, UploaderModule> = new Map()

// 注册模块（幂等：同 name 重复注册会覆盖旧版本）
export function registerModule(mod: UploaderModule): void {
  if (!mod || !mod.name || typeof mod.upload !== 'function') {
    throw new Error(`[registry] 无效模块: name=${mod?.name}, upload=${typeof mod?.upload}`)
  }
  modules.set(mod.name, mod)
}

// 按 name 查找（返回 undefined 表示未注册）
export function getModule(name: string): UploaderModule | undefined {
  return modules.get(name)
}

// 列出所有已注册模块（用于 UI 展示可用图床）
export function listModules(): string[] {
  return Array.from(modules.keys())
}

// 移除模块（用于热更新 / 测试 cleanup）
export function unregisterModule(name: string): boolean {
  return modules.delete(name)
}

// 清空（仅用于测试，避免模块污染）
export function clearModules(): void {
  modules.clear()
}
