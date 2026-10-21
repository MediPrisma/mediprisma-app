// Loopback-only server for the exact static /app artifact used in deployment.
import http from 'node:http'
import { open } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(process.env.E2E_STATIC_DIR)
const basePath = process.env.E2E_APP_PATH.replace(/\/$/, '')
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.woff2': 'font/woff2',
  '.txt': 'text/plain', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.wasm': 'application/wasm', '.mjs': 'application/javascript' }

http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    if (pathname !== basePath && !pathname.startsWith(basePath + '/')) {
      response.writeHead(404).end(); return
    }
    const file = path.resolve(root, '.' + (pathname.slice(basePath.length) || '/'))
    if (file !== root && !file.startsWith(root + path.sep)) {
      response.writeHead(403).end(); return
    }
    const candidates = file === root ? [path.join(root, 'index.html')]
      : [file, file + '.html', path.join(file, 'index.html')]
    for (const candidate of candidates) {
      let handle
      try {
        handle = await open(candidate, 'r')
        if (!(await handle.stat()).isFile()) continue
        const bytes = await handle.readFile()
        response.writeHead(200, { 'Content-Type': types[path.extname(candidate)] || 'application/octet-stream' })
        response.end(bytes); return
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code)) throw error
      } finally {
        await handle?.close()
      }
    }
    response.writeHead(404).end()
  } catch {
    response.writeHead(500).end()
  }
}).listen(3022, '127.0.0.1', () => console.log(`Static export mounted at ${basePath}`))
