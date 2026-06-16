// ========================================================================
// integration.test.ts  — 完整上传流程集成测试
//
// 测试策略：
//   - mock 一个图床模块（不发真实网络请求）
//   - 用临时文件（Node.js fs/tmp）验证 prepare 步骤
//   - 验证 6 步流水线是否按预期运行
//   - 验证回调 / 统计 / 错误处理
// ========================================================================

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { fileURLToPath } from 'url'

import {
  UploadContext,
  UploadErrCode,
  getCtx,
  bindCallbacks,
  onProgress,
  onSuccess,
  clearAll,
  formatError,
  getStats,
  registerModule,
  clearModules,
  healthCheck,
} from '../src/upload'

// --- 辅助函数 ---
function makeTempFiles(count: number, sizeKB = 1): string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'picgo-test-'))
  const files: string[] = []
  for (let i = 0; i < count; i++) {
    const p = path.join(dir, `test-${i}.png`)
    fs.writeFileSync(p, Buffer.alloc(sizeKB * 1024, 0xAB))
    files.push(p)
  }
  return files
}

// 1) mock 图床模块（不发真实网络请求，直接返回构造的 URL）
registerModule({
  name: 'mock-host',
  version: '1.0.0',
  upload: async (file, config) => {
    await new Promise((r) => setTimeout(r, 50)) // 模拟网络延迟
    return {
      imgUrl: `https://mock.example.com/${file.fileName}?t=${Date.now()}`,
      webUrl: `https://mock.example.com/view/${file.fileName}`,
      raw: { file: file.fileName, size: file.fileSize },
    }
  },
})

// 2) 初始化
UploadContext.init()
UploadContext.registerRoute({
  name: 'mock-host',
  host: 'mock.example.com',
  protocol: 'https',
  priority: 1,
  enabled: true,
  config: {}, // mock 图床不需要 token
})
UploadContext.setRoute('mock-host')

// 3) 注册回调
bindCallbacks(UploadContext.getCtx())
const progressEvents: number[] = []
onProgress((p) => { progressEvents.push(p.step) }, UploadContext.getCtx())
let successTriggered = false
onSuccess(() => { successTriggered = true }, UploadContext.getCtx())

// --- 测试用例 1：成功上传 3 个文件 ---
async function test1_happy_path() {
  const files = makeTempFiles(3, 2)
  const code = await UploadContext.upload(files)
  if (code !== UploadErrCode.UPLOAD_OK) {
    throw new Error(`test1 失败: ${formatError(code)}`)
  }
  const ctx = getCtx()
  if (ctx.results.length !== 3) throw new Error(`预期 3 个结果，实际 ${ctx.results.length}`)
  if (!successTriggered) throw new Error('onSuccess 未触发')
  // 验证 6 步都发出过进度事件
  for (let step = 1; step <= 6; step++) {
    if (!progressEvents.includes(step)) throw new Error(`缺少 step=${step} 进度事件`)
  }
  console.log('✔ test1: 3 个文件成功上传，6 步流水线正常')
  // 清理
  files.forEach((f) => { try { fs.unlinkSync(f) } catch {} })
}

// --- 测试用例 2：文件不存在 ---
async function test2_file_not_found() {
  const code = await UploadContext.upload(['/tmp/picgo-not-exist-xyz.png'])
  if (code !== UploadErrCode.UPLOAD_ERR_IO && code !== UploadErrCode.UPLOAD_ERR_NOT_FOUND) {
    throw new Error(`test2 失败: 预期错误码，实际 ${code}`)
  }
  console.log('✔ test2: 文件不存在被正确拦截')
}

// --- 测试用例 3：未选择图床（先移除当前路由） ---
async function test3_no_route() {
  const ctx = getCtx()
  const oldRoute = ctx.currentRoute
  ctx.currentRoute = '' as any  // 临时破坏
  const code = await UploadContext.upload(makeTempFiles(1))
  if (code !== UploadErrCode.UPLOAD_ERR_CONFIG) {
    throw new Error(`test3 失败: 预期 UPLOAD_ERR_CONFIG，实际 ${code}`)
  }
  ctx.currentRoute = oldRoute  // 恢复
  console.log('✔ test3: 未选择图床被正确拦截')
}

// --- 测试用例 4：图床模块未注册 ---
async function test4_module_not_found() {
  // 注册一个指向未注册模块的路由
  UploadContext.registerRoute({
    name: 'ghost-host', host: 'ghost', protocol: 'https',
    priority: 99, enabled: true, config: {},
  })
  UploadContext.setRoute('ghost-host')
  const code = await UploadContext.upload(makeTempFiles(1))
  if (code !== UploadErrCode.UPLOAD_ERR_PLUGIN) {
    throw new Error(`test4 失败: 预期 UPLOAD_ERR_PLUGIN，实际 ${code}`)
  }
  // 恢复
  UploadContext.removeRoute('ghost-host')
  UploadContext.setRoute('mock-host')
  console.log('✔ test4: 未注册图床模块被正确拦截')
}

// --- 测试用例 5：统计累计 ---
async function test5_stats() {
  // 再跑一次成功上传
  const files = makeTempFiles(2, 1)
  await UploadContext.upload(files)
  const stats = getStats()
  if (stats.successCount < 2) throw new Error(`successCount 应 ≥ 2，实际 ${stats.successCount}`)
  if (stats.totalBytes <= 0) throw new Error('totalBytes 应为正数')
  files.forEach((f) => { try { fs.unlinkSync(f) } catch {} })
  console.log('✔ test5: 统计累计正常 (success=' + stats.successCount + ', bytes=' + stats.totalBytesHuman + ')')
}

// --- 测试用例 6：健康检查 ---
async function test6_health_check() {
  const h = healthCheck()
  if (!h.initialized) throw new Error('initialized 应为 true')
  if (!h.modules.includes('mock-host')) throw new Error('mock-host 应在模块列表')
  console.log('✔ test6: healthCheck 正常, 模块 = ' + h.modules.join(','))
}

// --- 测试执行 ---
async function main() {
  const tests = [
    test1_happy_path,
    test2_file_not_found,
    test3_no_route,
    test4_module_not_found,
    test5_stats,
    test6_health_check,
  ]

  let pass = 0
  let fail = 0
  for (const t of tests) {
    try {
      await t()
      pass++
    } catch (e) {
      console.error('✗', (e as Error).message)
      fail++
    }
  }

  // cleanup
  clearAll()
  clearModules()
  UploadContext.destroy()

  console.log('\n======================')
  console.log(`  通过: ${pass} / ${tests.length}`)
  console.log(`  失败: ${fail}`)
  console.log('======================')

  if (fail > 0) process.exit(1)
  process.exit(0)
}

main()
