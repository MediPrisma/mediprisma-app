// Synthetic receiver only. No production configuration, database or credentials.
import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const { createCollector } = await import(pathToFileURL(resolve(process.env.COLLECTOR_GATEWAY_CHECKOUT, 'dist/collector.js')).href)
const token = randomBytes(32).toString('hex')
const password = randomBytes(32).toString('hex')
const app = await createCollector({
  dbPath: join(mkdtempSync(join(tmpdir(), 'collector-cross-repo-synthetic-')), 'synthetic.db'),
  encryptionKey: randomBytes(32), ingestToken: token, adminUser: 'synthetic', adminPassword: password,
  retentionDays: 0, maxBodyMiB: 1, allowedOrigins: ['http://localhost'],
  capacityProbe: () => ({ storageBytes: 0, freeBytes: 100 * 1024 ** 3 }),
})
await app.listen({ host: '127.0.0.1', port: 0 })
process.send({ origin: app.listeningOrigin, token, admin: 'Basic ' + Buffer.from('synthetic:' + password).toString('base64') })
process.on('message', async message => {
  if (message === 'close') { await app.close(); process.disconnect() }
})
process.on('disconnect', () => { void app.close() })
