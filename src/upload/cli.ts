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
  force: boolean
  lang: 'zh' | 'en'
}

// ---- 简易 i18n ----
let LANG: 'zh' | 'en' = 'zh'
const L: Record<'zh' | 'en', Record<string, string>> = {
  zh: {
    'help.title': 'picgo-upload-layer — 基于模块化流水线的图片上传工具',
    'help.usage': '用法:',
    'help.cmd.upload': '  upload <file1> [file2...] [--route <name>] [--force]  上传一个或多个文件',
    'help.cmd.list': '  list                                            列出所有已注册的图床模块',
    'help.cmd.stats': '  stats                                           查看上传统计',
    'help.cmd.health': '  health                                          健康检查（路由/模块状态）',
    'help.cmd.init': '  init-config                                     重新生成默认配置文件',
    'help.cmd.history': '  history [--route <name>] [--since <date>]       查看上传历史',
    'help.cmd.historyDelete': '  history-delete <id>                           删除一条历史记录',
    'help.cmd.historyClear': '  history-clear [--force | -y]                  清空全部历史记录',
    'help.opt.help': '  --help / -h                                     显示此帮助',
    'help.opt.force': '  --force / -f                                    强制上传（忽略 hash 去重）',
    'help.opt.route': '  --route / -r <name>                            使用指定图床',
    'help.opt.lang': '  --lang <zh|en>                                 输出语言',
    'help.config': '配置文件:',
    'help.example': '示例:',
    'help.exampleUpload': '  upload ./screenshot.png',
    'help.exampleUploadRoute': '  upload ./a.png --route qiniu',
    'help.exampleUploadForce': '  upload ./a.png --force',
    'help.exampleHistory': '  history --route qiniu',
    'help.exampleDelete': '  history-delete 20250101-123045-abcd',
    'error.noFiles': '[error] 未提供任何文件路径。使用 --help 查看用法。',
    'error.noRoutes': '[error] 配置中没有启用任何图床。',
    'error.noRoutesEdit': `        编辑: ${getConfigPath()}`,
    'error.noRoutesHint': '        把要使用的图床 enabled 改为 true，并填入 token。',
    'info.useRoute': '[info] 使用图床:',
    'info.forceUpload': '[info] 强制上传模式：忽略 hash 去重（--force）',
    'error.routeSelectFail': '[error] 选择图床失败:',
    'error.routeSelectAvail': '        可用图床:',
    'success.uploaded': '[success] 成功上传',
    'success.files': '个文件：',
    'error.uploadFail': '[error] 上传失败',
    'list.title': '=== 已注册的图床模块 ===',
    'list.empty': '  (无)',
    'list.config': '配置文件:',
    'list.default': '默认图床:',
    'health.title': '=== 健康检查 ===',
    'health.init': '  初始化:',
    'health.modules': '  模块:',
    'health.routes': '  路由状态:',
    'health.routesEmpty': '    (无配置路由)',
    'init.done': '[info] 已确认配置文件:',
    'init.hint': '       编辑它以启用图床并填入 token。',
    'history.noRec': '（无历史记录）',
    'history.titlePrefix': '=== 上传历史',
    'history.deleteNeedId': '[error] 请提供要删除的记录 id（history 输出里的 [id] 标签）',
    'history.deleteSuccess': '[success] 已删除记录:',
    'history.deleteNotFound': '[warn] 未找到记录:',
    'history.clearEmpty': '历史记录为空，无需清理',
    'history.clearSuccess': '[success] 已清空',
    'history.clearNeedConfirm': '[error] 请加上 --force 或 -y 确认清空所有历史记录',
    'history.clearHint': '        当前共有',
    'history.clearHint2': '条记录，会删除',
    'date.invalid': '[error] --since 的日期格式不正确:',
    'date.invalidHint': '。期望: YYYY-MM-DD',
    'error.unknownCmd': '[error] 未知子命令:',
    'error.runtime': '[error] 运行异常:',
  },
  en: {
    'help.title': 'picgo-upload-layer — Modular pipeline-based image upload tool',
    'help.usage': 'Usage:',
    'help.cmd.upload': '  upload <file1> [file2...] [--route <name>] [--force]  Upload one or more files',
    'help.cmd.list': '  list                                            List registered image host modules',
    'help.cmd.stats': '  stats                                           Show upload statistics',
    'help.cmd.health': '  health                                          Health check (routes / modules)',
    'help.cmd.init': '  init-config                                     Re-generate default config file',
    'help.cmd.history': '  history [--route <name>] [--since <date>]       View upload history',
    'help.cmd.historyDelete': '  history-delete <id>                           Delete a history record',
    'help.cmd.historyClear': '  history-clear [--force | -y]                  Clear all history',
    'help.opt.help': '  --help / -h                                     Show this help',
    'help.opt.force': '  --force / -f                                    Force upload (ignore hash dedup)',
    'help.opt.route': '  --route / -r <name>                            Use specific image host',
    'help.opt.lang': '  --lang <zh|en>                                 Output language',
    'help.config': 'Config file:',
    'help.example': 'Examples:',
    'help.exampleUpload': '  upload ./screenshot.png',
    'help.exampleUploadRoute': '  upload ./a.png --route qiniu',
    'help.exampleUploadForce': '  upload ./a.png --force',
    'help.exampleHistory': '  history --route qiniu',
    'help.exampleDelete': '  history-delete 20250101-123045-abcd',
    'error.noFiles': '[error] No file paths provided. Use --help for usage.',
    'error.noRoutes': '[error] No image hosts enabled in config.',
    'error.noRoutesEdit': `        Edit: ${getConfigPath()}`,
    'error.noRoutesHint': '        Set enabled to true and fill in the token for the host you want to use.',
    'info.useRoute': '[info] Using host:',
    'info.forceUpload': '[info] Force upload mode: ignoring hash dedup (--force)',
    'error.routeSelectFail': '[error] Failed to select route:',
    'error.routeSelectAvail': '        Available hosts:',
    'success.uploaded': '[success] Uploaded',
    'success.files': 'files:',
    'error.uploadFail': '[error] Upload failed',
    'list.title': '=== Registered Image Host Modules ===',
    'list.empty': '  (none)',
    'list.config': 'Config file:',
    'list.default': 'Default host:',
    'health.title': '=== Health Check ===',
    'health.init': '  Initialized:',
    'health.modules': '  Modules:',
    'health.routes': '  Routes:',
    'health.routesEmpty': '    (no configured routes)',
    'init.done': '[info] Config file verified:',
    'init.hint': '       Edit it to enable hosts and fill in the token.',
    'history.noRec': '(no history records)',
    'history.titlePrefix': '=== Upload History',
    'history.deleteNeedId': '[error] Please provide a record id (see [id] tag in history output)',
    'history.deleteSuccess': '[success] Deleted record:',
    'history.deleteNotFound': '[warn] Record not found:',
    'history.clearEmpty': 'No history records, nothing to clear',
    'history.clearSuccess': '[success] Cleared',
    'history.clearNeedConfirm': '[error] Add --force or -y to confirm clearing all history',
    'history.clearHint': '        Currently',
    'history.clearHint2': 'records, will delete',
    'date.invalid': '[error] Invalid --since date format:',
    'date.invalidHint': '. Expected: YYYY-MM-DD',
    'error.unknownCmd': '[error] Unknown subcommand:',
    'error.runtime': '[error] Runtime error:',
  },
}
function t(key: string): string {
  return (L[LANG] && L[LANG][key]) || L.zh[key] || key
}

function parseArgs(argv: string[]): ParsedArgs {
  const files: string[] = []
  let command = 'upload'
  let route: string | null = null
  let showHelp = false
  let force = false
  let lang: 'zh' | 'en' = 'zh'

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
    } else if (a === '--force' || a === '-f') {
      force = true
    } else if (a === '--lang') {
      const v = (argv[i + 1] || '').toLowerCase()
      if (v === 'en' || v === 'zh' || v === 'cn') lang = v === 'en' ? 'en' : 'zh'
      i++
    } else if (a.startsWith('--lang=')) {
      const v = a.slice('--lang='.length).toLowerCase()
      if (v === 'en' || v === 'zh' || v === 'cn') lang = v === 'en' ? 'en' : 'zh'
    } else if (a === 'upload' || a === 'list' || a === 'stats' || a === 'health' || a === 'init-config') {
      command = a
    } else {
      // 默认当作文件路径
      files.push(a)
    }
    i++
  }

  return { command, files, route, showHelp, force, lang }
}

// ---- 帮助信息 ----

function printHelp(): void {
  const lines = [
    t('help.title'),
    '',
    t('help.usage'),
    t('help.cmd.upload'),
    t('help.cmd.list'),
    t('help.cmd.stats'),
    t('help.cmd.health'),
    t('help.cmd.init'),
    t('help.cmd.history'),
    t('help.cmd.historyDelete'),
    t('help.cmd.historyClear'),
    t('help.opt.help'),
    t('help.opt.force'),
    t('help.opt.route'),
    t('help.opt.lang'),
    '',
    t('help.config'),
    `  ${getConfigPath()}`,
    '',
    t('help.example'),
    t('help.exampleUpload'),
    t('help.exampleUploadRoute'),
    t('help.exampleUploadForce'),
    t('help.exampleHistory'),
    t('help.exampleDelete'),
  ]
  console.log(lines.join('\n'))
}

// ---- 各子命令实现 ----

async function cmdUpload(files: string[], routeName: string | null, force: boolean = false): Promise<number> {
  if (!files || files.length === 0) {
    console.error(t('error.noFiles'))
    return 2
  }

  // 1) 读取配置
  const cfg = loadConfig()
  const enabledRoutes = cfg.routes.filter((r) => r.enabled)

  if (enabledRoutes.length === 0) {
    console.error(t('error.noRoutes'))
    console.error(t('error.noRoutesEdit'))
    console.error(t('error.noRoutesHint'))
    return 2
  }

  // 2) 初始化 + 注册路由
  UploadContext.init()
  const ctx = UploadContext.getCtx()
  bindCallbacks(ctx)

  // 2b) 把 --force 写入 ctx，供后续 step 读取
  if (force) {
    ctx.runtime.forceUpload = true
    console.log(t('info.forceUpload'))
  }

  for (const r of enabledRoutes) {
    UploadContext.registerRoute(r)
  }

  // 3) 选择当前图床
  const target = routeName || cfg.defaultRoute || enabledRoutes[0].name
  const setResult = UploadContext.setRoute(target)
  if (setResult !== UploadErrCode.UPLOAD_OK) {
    console.error(`${t('error.routeSelectFail')} ${target}`)
    console.error(`${t('error.routeSelectAvail')} ${enabledRoutes.map((r) => r.name).join(', ')}`)
    return 2
  }
  console.log(`${t('info.useRoute')} ${target}`)

  // 4) 绑定回调（CLI 体验）
  onProgress((p) => {
    // 非流水线 step 的事件：FAILOVER / INFO（step===0）
    if (p.step === 0) {
      if (p.stepName === 'FAILOVER') {
        console.log(`  [failover] ${p.errorMsg}`)
      } else if (p.stepName === 'INFO') {
        console.log(`  [info] ${p.errorMsg || ''}`)
      }
      return
    }
    // 正常流水线 step 的进度条显示
    const step = String(p.step).padStart(2, ' ')
    const bar = buildBar(p.progress, 24)
    const elapsed = p.elapsedMs ? ` ${p.elapsedMs}ms` : ''
    console.log(`  [step ${step}] ${bar} ${p.progress}%${elapsed}`)
  }, UploadContext.getCtx())

  onSuccess((results) => {
    console.log(`\n${t('success.uploaded')} ${results.length} ${t('success.files')}\n`)
    for (const r of results) {
      console.log(`  ${r.file.fileName}`)
      console.log(`    → ${r.imgUrl}`)
      console.log(`    ![${r.file.fileName}](${r.imgUrl})`)
      console.log()
    }
  }, UploadContext.getCtx())

  onError((code, msg) => {
    console.error(`\n${t('error.runtime')} ${formatError(code)} — ${msg}`)
  }, UploadContext.getCtx())

  // 5) 执行上传
  const code = await UploadContext.upload(files)
  if (code !== UploadErrCode.UPLOAD_OK) {
    console.error(`\n${t('error.uploadFail')} (${formatError(code)})`)
    return 1
  }
  return 0
}

function cmdList(): number {
  const cfg = loadConfig()
  const modules = listModules()

  console.log(t('list.title'))
  if (modules.length === 0) {
    console.log(t('list.empty'))
  } else {
    for (const m of modules) {
      const r = cfg.routes.find((x) => x.name === m)
      const status = LANG === 'en'
        ? (r?.enabled ? 'enabled' : r ? 'configured but disabled' : 'available but not configured')
        : (r?.enabled ? '启用' : r ? '已配置但未启用' : '可用但未配置')
      console.log(`  - ${m}  (${status})`)
    }
  }

  console.log(`\n${t('list.config')} ${getConfigPath()}`)
  console.log(`${t('list.default')} ${cfg.defaultRoute || (LANG === 'en' ? '(not set)' : '(未设置)')}`)
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
  console.log(t('health.title'))
  console.log(`  ${t('health.init')} ${h.initialized ? 'OK' : 'NO'}`)
  console.log(`  ${t('health.modules')} ${h.modules.length > 0 ? h.modules.join(', ') : (LANG === 'en' ? '(none)' : '(无)')}`)
  console.log()
  console.log(`  ${t('health.routes')}`)
  if (h.routes.length === 0) {
    console.log(`    ${t('health.routesEmpty')}`)
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
  console.log(`${t('init.done')} ${getConfigPath()}`)
  console.log(t('init.hint'))
  return 0
}

// 查看历史相册（支持 --limit N 或简写数字）
function cmdHistory(argv: string[]): number {
  let limit = 10
  let route: string | null = null
  let sinceTs: number | null = null

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (/^\d+$/.test(a)) {
      limit = parseInt(a, 10)
    } else if (a === 'all' || a === '--all') {
      limit = 0
    } else if (a === '--route' && i + 1 < argv.length) {
      route = argv[++i]
    } else if (a.startsWith('--route=')) {
      route = a.slice('--route='.length)
    } else if (a === '--since' && i + 1 < argv.length) {
      const dateStr = argv[++i]
      const parsed = parseDateArg(dateStr)
      if (parsed) sinceTs = parsed
      else {
        console.error(`${t('date.invalid')} ${dateStr}${t('date.invalidHint')}`)
        return 2
      }
    } else if (a.startsWith('--since=')) {
      const dateStr = a.slice('--since='.length)
      const parsed = parseDateArg(dateStr)
      if (parsed) sinceTs = parsed
      else {
        console.error(`${t('date.invalid')} ${dateStr}${t('date.invalidHint')}`)
        return 2
      }
    }
  }

  // 1) 先从本地拿（按路由过滤的小优化：如果指定 route 且已经有 getHistoryByRoute，则调用）
  let records = route
    ? getHistoryByRoute(route, limit > 0 ? limit : undefined)
    : getHistory(limit > 0 ? limit : undefined)

  // 2) apply --since
  if (sinceTs !== null) {
    records = records.filter((r) => r.createdAt >= sinceTs)
  }

  const parts: string[] = []
  if (route) parts.push(`route=${route}`)
  if (sinceTs !== null) parts.push(`since=${new Date(sinceTs).toISOString().slice(0, 10)}`)
  parts.push(LANG === 'en' ? `${records.length} total` : `共 ${records.length} 条`)

  console.log(`${t('history.titlePrefix')} ${parts.length > 1 ? '（' + parts.join(', ') + '）' : '（' + parts[0] + '）'} ===`)
  console.log(formatHistoryTable(records))
  return 0
}

// 解析 YYYY-MM-DD（返回该日 00:00:00 的毫秒时间戳）
function parseDateArg(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim())
  if (!m) return null
  const y = parseInt(m[1], 10)
  const mo = parseInt(m[2], 10)
  const d = parseInt(m[3], 10)
  const dt = new Date(y, mo - 1, d)
  if (Number.isNaN(dt.getTime())) return null
  return dt.getTime()
}

// 删除历史记录（按 id）
function cmdDeleteHistory(id?: string): number {
  if (!id) {
    console.error(t('history.deleteNeedId'))
    return 2
  }
  const ok = deleteHistoryById(id)
  if (ok) {
    console.log(`${t('history.deleteSuccess')} ${id}`)
    return 0
  }
  console.log(`${t('history.deleteNotFound')} ${id}`)
  return 1
}

// 清空所有历史（二次确认）
function cmdClearHistory(): number {
  const records = getHistory()
  if (records.length === 0) {
    console.log(t('history.clearEmpty'))
    return 0
  }
  // 简单提示：不做交互式输入，让用户通过命令参数二次确认
  if (process.argv.includes('--force') || process.argv.includes('-y')) {
    clearHistory()
    console.log(`${t('history.clearSuccess')} ${records.length} ${LANG === 'en' ? 'records' : '条记录'}`)
    return 0
  }
  console.error(t('history.clearNeedConfirm'))
  console.error(`${t('history.clearHint')} ${records.length} ${t('history.clearHint2')} ${getHistoryPath()}`)
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
  const { command, files, route, showHelp, force, lang } = parseArgs(argv)
  LANG = lang

  if (showHelp) {
    printHelp()
    return 0
  }

  try {
    switch (command) {
      case 'upload':
        return await cmdUpload(files, route, force)
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
        console.error(`${t('error.unknownCmd')} ${command}`)
        printHelp()
        return 2
    }
  } catch (e) {
    console.error(`\n${t('error.runtime')} ${(e as Error).message}`)
    return 1
  } finally {
    clearAll()
  }
}

main().then((code) => {
  process.exit(code)
})
