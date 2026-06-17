#!/usr/bin/env node
// ========================================================================
// bin/picgo-upload-layer.js  — CLI 入口转发器
//
// 作用：通过 `npm install -g picgo-upload-layer` 后，
//       `picgo-upload-layer` / `picgo-ul` 命令直接指向此文件。
//
// 此文件是一个极简转发器，使用 tsx 运行 TypeScript 源码。
// ========================================================================

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const cliPath = path.join(__dirname, '..', 'src', 'upload', 'cli.ts')

const child = spawn('node', ['--loader', 'tsx', cliPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
})

child.on('exit', (code) => {
  process.exit(code || 0)
})
