import { SDK_IMPORT_AVAILABLE } from '@/src/shared/config/optional-capabilities'
import type { PreparedLocalImport } from './sdk-import-converter'
import { enrichLocalFhirImport } from '@/src/application/services/local-fhir-import-enrichment.service'
export type { PreparedLocalImport } from './sdk-import-converter'

type WorkerSuccess = {
  type: 'success'
  result: PreparedLocalImport
}

type WorkerFailure = {
  type: 'failure'
  error: string
}

type WorkerUnavailable = {
  type: 'unavailable'
  error: string
}

type WorkerProgress = {
  type: 'progress'
  phase: 'ready' | 'parsed' | 'converted' | 'enriched'
}

type WorkerResponse =
  | WorkerSuccess
  | WorkerFailure
  | WorkerUnavailable
  | WorkerProgress

class WorkerStartupError extends Error {}

async function convertOnMainThread(bytes: ArrayBuffer): Promise<PreparedLocalImport> {
  // Yield one paint so the UI can display its loading state before the
  // synchronous converter runs. This is a fallback for browser/build
  // combinations where a module Worker cannot start.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  const { convertLocalImportBytes } = await import('./sdk-import-converter')
  try {
    const prepared = convertLocalImportBytes(bytes)
    return {
      ...prepared,
      bundle: await enrichLocalFhirImport(prepared.bundle),
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown conversion error'
    throw new Error(
      `${SDK_IMPORT_AVAILABLE ? '不支援的資料格式；請選擇 FHIR Bundle 或健康存摺 SDK JSON。' : '此部署僅支援 FHIR Bundle 匯入。'}(${detail})`,
    )
  }
}

function convertInWorker(bytes: ArrayBuffer): Promise<PreparedLocalImport> {
  return new Promise<PreparedLocalImport>((resolve, reject) => {
    const worker = new Worker(
      new URL('../workers/sdk-import.worker.ts', import.meta.url),
      { type: 'module' },
    )
    let lastPhase: WorkerProgress['phase'] | 'starting' = 'starting'
    const startupTimeout = window.setTimeout(() => {
      worker.terminate()
      reject(new WorkerStartupError('Local conversion worker did not start'))
    }, 2_000)
    const conversionTimeout = window.setTimeout(() => {
      worker.terminate()
      reject(new Error(`本機資料轉換逾時（停在 ${lastPhase} 階段）`))
    }, 30_000)
    const finish = () => {
      window.clearTimeout(startupTimeout)
      window.clearTimeout(conversionTimeout)
      worker.terminate()
    }

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.type === 'progress') {
        lastPhase = event.data.phase
        if (event.data.phase === 'ready') window.clearTimeout(startupTimeout)
        return
      }
      finish()
      if (event.data.type === 'success') resolve(event.data.result)
      else if (event.data.type === 'unavailable') {
        reject(new WorkerStartupError(event.data.error))
      } else {
        reject(new Error(event.data.error))
      }
    }
    worker.onerror = (event) => {
      finish()
      if (lastPhase === 'starting') {
        reject(new WorkerStartupError(event.message || 'Local conversion worker failed to load'))
      } else {
        reject(new Error(
          `無法完成本機資料轉換 (Local conversion failed${event.message ? `: ${event.message}` : ''})`,
        ))
      }
    }
    const workerBytes = bytes.slice(0)
    worker.postMessage({ bytes: workerBytes }, [workerBytes])
  })
}

export async function prepareLocalImportFile(file: File): Promise<PreparedLocalImport> {
  const bytes = await file.arrayBuffer()
  if (typeof Worker === 'undefined' || process.env.NODE_ENV === 'development') {
    return convertOnMainThread(bytes)
  }

  try {
    return await convertInWorker(bytes)
  } catch (error) {
    if (error instanceof WorkerStartupError) return convertOnMainThread(bytes)
    throw error
  }
}
