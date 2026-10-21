// Loopback-only server for the exact static /app artifact used in deployment.
import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(process.env.E2E_STATIC_DIR)
const basePath = process.env.E2E_APP_PATH.replace(/\/$/, '')
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.woff2': 'font/woff2' }

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
    for (const candidate of [file, file + '.html', path.join(file, 'index.html')]) {
      let isFile = false
      try { isFile = (await stat(candidate)).isFile() } catch { /* next candidate */ }
      if (!isFile) continue
      const bytes = await readFile(candidate)
      response.writeHead(200, { 'Content-Type': types[path.extname(candidate)] || 'application/octet-stream' })
      response.end(bytes); return
    }
    response.writeHead(404).end()
  } catch {
    response.writeHead(500).end()
  }
}).listen(3022, '127.0.0.1', () => console.log(`Static export mounted at ${basePath}`))
