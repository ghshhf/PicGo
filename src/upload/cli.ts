// ========================================================================
// cli.ts  — 命令行入口
//
// 使用：
//   # 上传单个文件
//   node --loader tsx src/upload/cli.ts upload C:\path\to\img.png
//
//   # 上传多个文件
//   node --loader tsx src/upload/cli.ts upload img1.png img2.jpg img3.webp
//
//   # 指定图床（默认读取配置的 defaultRoute）
//   node --loader tsx src/upload/cli.ts upload img.png --route github
//
//   # 子命令列表
//   node --loader tsx src/upload/cli.ts list        # 列出所有已注册图床
//   node --loader tsx src/upload/cli.ts stats       # 查看统计
//   node --loader tsx src/upload/cli.ts health      # 健康检查
//   node --loader tsx src/upload/cli.ts init-config # 重新生成默认配置
//   node --loader tsx src/upload/cli.ts --help      # 帮助
//
// 设计：
//   - 零依赖：只使用 Node.js 标准库
//   - 极简参数解析：手写，不引入 commander/minimist
//   - 清晰分级输出：info / success / warn / error
// ========================================================================

import {
  UploadContext,
  UploadErrCode,
  formatError,
  onProgress,
  onSuccess,
  onError,
  bindCallbacks,
  clearAll,
  getStats,
  formatStats,
  healthCheck,
  listModules,
} from './upload'

import {
  loadConfig,
  getConfigPath,
  getDefaultRoute,
  saveConfig,
} from './config'

import {
  getHistory,
  deleteHistoryById,
  clearHistory,
  formatHistoryTable,
} from './upload_history'

import * as path from 'path'
import * as os from 'os'

// 加载内置图床模块（smms + github + qiniu + tencent-cos + aliyun-oss）
import './upload/modules'

// ---- 极简参数解析 ----

interface ParsedArgs {
  command: string
  files: string[]
  route: string | null
  showHelp: boolean
}

function parseArgs(argv: string[]): ParsedArgs {
  const files: string[] = []
  let command = 'upload'
  let route: string | null = null
  let showHelp = false

  let i = 0
  while (i < argv.length) {
    const a = argv[i]
    if (a === '--help' || a === '-h') {
      showHelp = true
    } else if (a === '--route' || a === '-r') {
      route = argv[i + 1] || null
      i++
    } else if (a.startsWith('--route=')) {
      route = a.slice('--route='.length)
    } else if (a === 'upload' || a === 'list' || a === 'stats' || a === 'health' || a === 'init-config') {
      command = a
    } else {
      // 默认当作文件路径
      files.push(a)
    }
    i++
  }

  return { command, files, route, showHelp }
}

// ---- 帮助信息 ----

function printHelp(): void {
  const lines = [
    'picgo-upload-layer — 基于模块化流水线的图片上传工具',
    '',
    '用法:',
    '  upload <file1> [file2...] [--route <name>]    上传一个或多个文件',
    '  list                                            列出所有已注册的图床模块',
    '  stats                                           查看上传统计',
    '  health                                          健康检查（路由/模块状态）',
    '  init-config                                     重新生成默认配置文件',
    '  --help / -h                                     显示此帮助',
    '',
    '配置文件:',
    `  ${getConfigPath()}`,
    '',
    '示例:',
    '  node --loader tsx src/upload/cli.ts upload C:\\screenshot.png',
    '  node --loader tsx src/upload/cli.ts upload a.png b.jpg --route github',
    '  node --loader tsx src/upload/cli.ts list',
    '  node --loader tsx src/upload/cli.ts stats',
    '  node --loader tsx src/upload/cli.ts health',
  ]
  console.log(lines.join('\n'))
}

// ---- 各子命令实现 ----

async function cmdUpload(files: string[], routeName: string | null): Promise<number> {
  if (!files || files.length === 0) {
    console.error('[error] 未提供任何文件路径。使用 --help 查看用法。')
    return 2
  }

  // 1) 读取配置
  const cfg = loadConfig()
  const enabledRoutes = cfg.routes.filter((r) => r.enabled)

  if (enabledRoutes.length === 0) {
    console.error('[error] 配置中没有启用任何图床。')
    console.error(`        编辑: ${getConfigPath()}`)
    console.error(`        把要使用的图床 enabled 改为 true，并填入 token。`)
    return 2
  }

  // 2) 初始化 + 注册路由
  UploadContext.init()
  bindCallbacks(UploadContext.getCtx())

  for (const r of enabledRoutes) {
    UploadContext.registerRoute(r)
  }

  // 3) 选择当前图床
  const target = routeName || cfg.defaultRoute || enabledRoutes[0].name
  const setResult = UploadContext.setRoute(target)
  if (setResult !== UploadErrCode.UPLOAD_OK) {
    console.error(`[error] 选择图床失败: ${target}`)
    console.error(`        可用图床: ${enabledRoutes.map((r) => r.name).join(', ')}`)
    return 2
  }
  console.log(`[info] 使用图床: ${target}`)

  // 4) 绑定回调（CLI 体验）
  onProgress((p) => {
    const step = String(p.step).padStart(2, ' ')
    const bar = buildBar(p.progress, 24)
    const elapsed = p.elapsedMs ? ` ${p.elapsedMs}ms` : ''
    console.log(`  [step ${step}] ${bar} ${p.progress}%${elapsed}`)
  }, UploadContext.getCtx())

  onSuccess((results) => {
    console.log(`\n[success] 成功上传 ${results.length} 个文件：\n`)
    for (const r of results) {
      console.log(`  ${r.file.fileName}`)
      console.log(`    → ${r.imgUrl}`)
      console.log(`    ![${r.file.fileName}](${r.imgUrl})`)
      console.log()
    }
  }, UploadContext.getCtx())

  onError((code, msg) => {
    console.error(`\n[error] ${formatError(code)} — ${msg}`)
  }, UploadContext.getCtx())

  // 5) 执行上传
  const code = await UploadContext.upload(files)
  if (code !== UploadErrCode.UPLOAD_OK) {
    console.error(`\n[done] 上传失败 (${formatError(code)})`)
    return 1
  }
  return 0
}

function cmdList(): number {
  const cfg = loadConfig()
  const modules = listModules()

  console.log('=== 已注册的图床模块 ===')
  if (modules.length === 0) {
    console.log('  (无)')
  } else {
    for (const m of modules) {
      const r = cfg.routes.find((x) => x.name === m)
      const status = r?.enabled ? '启用' : r ? '已配置但未启用' : '可用但未配置'
      console.log(`  - ${m}  (${status})`)
    }
  }

  console.log(`\n配置文件: ${getConfigPath()}`)
  console.log(`默认图床: ${cfg.defaultRoute || '(未设置)'}`)
  return 0
}

function cmdStats(): number {
  // 必须先 init，否则 stats 不可用
  const cfg = loadConfig()
  UploadContext.init()
  for (const r of cfg.routes) UploadContext.registerRoute(r)

  console.log(formatStats())
  return 0
}

function cmdHealth(): number {
  const cfg = loadConfig()
  UploadContext.init()
  for (const r of cfg.routes) UploadContext.registerRoute(r)

  const h = healthCheck()
  console.log('=== 健康检查 ===')
  console.log(`  初始化: ${h.initialized ? 'OK' : 'NO'}`)
  console.log(`  模块: ${h.modules.length > 0 ? h.modules.join(', ') : '(无)'}`)
  console.log()
  console.log('  路由状态:')
  if (h.routes.length === 0) {
    console.log('    (无配置路由)')
  } else {
    for (const r of h.routes) {
      const flags: string[] = []
      if (r.enabled) flags.push('ENABLED') else flags.push('disabled')
      if (r.moduleRegistered) flags.push('MODULE_OK') else flags.push('NO_MODULE')
      if (r.hasRequiredConfig) flags.push('HAS_CONFIG') else flags.push('NO_CONFIG')
      console.log(`    ${r.name.padEnd(14)} ${flags.join(' / ')}`)
    }
  }
  return 0
}

function cmdInitConfig(): number {
  const cfg = loadConfig()
  saveConfig(cfg)
  console.log(`[info] 已确认配置文件: ${getConfigPath()}`)
  console.log(`       编辑它以启用图床并填入 token。`)
  return 0
}

// 查看历史相册（支持 --limit N 或简写数字）
function cmdHistory(argv: string[]): number {
  let limit = 10
  for (const a of argv) {
    if (/^\d+$/.test(a)) {
      limit = parseInt(a, 10)
    } else if (a === 'all' || a === '--all') {
      limit = 0
    }
  }
  const records = getHistory(limit > 0 ? limit : undefined)
  console.log(`=== 上传历史（最近 ${limit > 0 ? limit : '全部'} 条） ===`)
  console.log(formatHistoryTable(records))
  return 0
}

// 删除历史记录（按 id）
function cmdDeleteHistory(id?: string): number {
  if (!id) {
    console.error('[error] 请提供要删除的记录 id（history 输出里的 [id] 标签）')
    return 2
  }
  const ok = deleteHistoryById(id)
  if (ok) {
    console.log(`[success] 已删除记录: ${id}`)
    return 0
  }
  console.log(`[warn] 未找到记录: ${id}`)
  return 1
}

// 清空所有历史（二次确认）
function cmdClearHistory(): number {
  const records = getHistory()
  if (records.length === 0) {
    console.log('历史记录为空，无需清理')
    return 0
  }
  // 简单提示：不做交互式输入，让用户通过命令参数二次确认
  if (process.argv.includes('--force') || process.argv.includes('-y')) {
    clearHistory()
    console.log(`[success] 已清空 ${records.length} 条记录`)
    return 0
  }
  console.error('[error] 请加上 --force 或 -y 确认清空所有历史记录')
  console.error(`        当前共有 ${records.length} 条记录，会删除 ${getHistoryPath()}`)
  return 2
}

function getHistoryPath(): string {
  // 此函数仅用于 CLI 提示，与 upload_history.ts 保持一致
  return path.join(os.homedir(), '.picgo-upload-layer', 'history.jsonl')
}

// ---- 进度条辅助 ----

function buildBar(progress: number, width: number): string {
  const p = Math.max(0, Math.min(100, progress))
  const filled = Math.round((p / 100) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

// ---- 主入口 ----

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const { command, files, route, showHelp } = parseArgs(argv)

  if (showHelp) {
    printHelp()
    return 0
  }

  try {
    switch (command) {
      case 'upload':
        return await cmdUpload(files, route)
      case 'list':
        return cmdList()
      case 'stats':
        return cmdStats()
      case 'health':
        return cmdHealth()
      case 'history':
      case 'album':
        return cmdHistory(files)  // files 里可能是数字（limit）
      case 'history-delete':
        return cmdDeleteHistory(argv[0])  // argv 里第一个非 switch 元素是 id
      case 'history-clear':
        return cmdClearHistory()
      case 'init-config':
        return cmdInitConfig()
      default:
        console.error(`[error] 未知子命令: ${command}`)
        printHelp()
        return 2
    }
  } catch (e) {
    console.error(`\n[error] 运行异常: ${(e as Error).message}`)
    return 1
  } finally {
    clearAll()
  }
}

main().then((code) => {
  process.exit(code)
})
