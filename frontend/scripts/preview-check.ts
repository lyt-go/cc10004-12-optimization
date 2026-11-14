/**
 * 部署校验：构建完成后起 `vite preview`，确认首页和构建产物可访问，再干净退出。
 * 用 Node 管理子进程，避免 Make 里 `&` + `kill` 误伤 make 自身。
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = Number(process.env.PREVIEW_PORT ?? 4173)
const BASE = `http://127.0.0.1:${PORT}`

function assetPath(): string {
  const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8')
  const match = html.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)
  if (!match) throw new Error('构建产物里找不到入口 JS，dist/index.html 可能不是最新构建')
  return match[0]
}

async function waitForServer(timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/`)
      if (response.ok) return
    } catch {
      // 服务还没起来，继续等
    }
    await sleep(250)
  }
  throw new Error(`预览服务在 ${timeoutMs}ms 内没有就绪`)
}

const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'],
  { stdio: 'ignore', detached: true },
)

let exitCode = 0
try {
  await waitForServer()
  const check = async (label: string, path: string) => {
    const response = await fetch(`${BASE}${path}`)
    if (!response.ok) throw new Error(`${label} 返回 HTTP ${response.status}`)
    console.log(`[deploy] ${label} 可访问（HTTP ${response.status}）`)
  }
  await check('预览首页', '/')
  await check('入口 JS', assetPath())
  await check('诊断路由', '/diagnosis')
} catch (error) {
  console.error(`[deploy] 校验失败：${error instanceof Error ? error.message : String(error)}`)
  exitCode = 1
} finally {
  try {
    process.kill(-server.pid!, 'SIGTERM')
  } catch {
    server.kill('SIGTERM')
  }
}

process.exit(exitCode)
