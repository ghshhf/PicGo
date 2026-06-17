// ========================================================================
// modules/index.ts  — 图床模块统一导出
//
// 调用方只需要：
//   import './src/upload/modules'   // 即可自动注册所有内置图床模块
//
// 新增图床模块时：
//   1. 在本目录下创建 <name>.ts（参考 smms.ts / github.ts）
//   2. 在本文件中添加一行：export * from './<name>'
// ========================================================================

export * from './registry'
export * from './smms'
export * from './github'
export * from './qiniu'
export * from './tencent-cos'
export * from './aliyun-oss'
