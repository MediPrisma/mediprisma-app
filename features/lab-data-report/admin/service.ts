// Reads and deletes lab-data problem reports for the developer viewer
// (/lab-reports). Firestore rules allow this only to the verified developer
// account (isLabDataReportAdmin in firebase-smart-on-fhir); everyone else,
// including the reporter, gets permission-denied. Writes come only from the
// submitLabDataReport Function.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  writeBatch,
  type DocumentData,
  type Firestore,
} from 'firebase/firestore'
import { db } from '@/src/shared/config/firebase.config'
import type {
  LabDataReportContext,
  LabDataReportPayload,
  LabDataReportProblemType,
  LabDataReportRawError,
  LabDataReportRawRow,
  LabDataReportRawSource,
  LabDataReportRow,
} from '../types'

const REPORTS = 'labDataReports'
const ROWS = 'labDataReportRows'

export interface StoredLabDataReport {
  id: string
  problemType: LabDataReportProblemType
  description: string
  includesValues: boolean
  scope: LabDataReportPayload['scope']
  context: LabDataReportContext
  rowCount: number
  rowChunks: number
  truncatedRows: number
  excludedNonLabRows: number
  droppedStrings: number
  serverDroppedStrings: number
  reporterIsAnonymous: boolean
  createdAt: Date | null
  expireAt: Date | null
  /** MediCloud raw rows stored with the report (0 for older reports). */
  rawRowCount: number
  /** The raw block's header — its rows live in the row chunks. */
  rawSource: Omit<LabDataReportRawSource, 'rows'> | null
  /** The reporter asked for raw rows but they could not be read. */
  rawSourceError: LabDataReportRawError | null
}

export interface StoredLabDataReportRows {
  rows: LabDataReportRow[]
  rawRows: LabDataReportRawRow[]
}

function requireDb(): Firestore {
  if (!db) throw new Error('Firestore database is not available')
  return db
}

function toDate(value: unknown): Date | null {
  if (value && typeof value === 'object' && 'toDate' in value) {
    const converted = (value as { toDate: () => unknown }).toDate()
    if (converted instanceof Date) return converted
  }
  return value instanceof Date ? value : null
}

const numberOr = (value: unknown, fallback = 0) => (typeof value === 'number' ? value : fallback)

function toReport(id: string, data: DocumentData): StoredLabDataReport {
  return {
    id,
    problemType: (data.problemType ?? 'unspecified') as LabDataReportProblemType,
    description: typeof data.description === 'string' ? data.description : '',
    includesValues: data.includesValues === true,
    scope: {
      flaggedCategories: Array.isArray(data.scope?.flaggedCategories) ? data.scope.flaggedCategories : [],
      categories: Array.isArray(data.scope?.categories) ? data.scope.categories : [],
    },
    context: data.context ?? { appVersion: 'unknown', dataSource: 'unknown', site: 'unknown', language: '', nameMode: 'standardized' },
    rowCount: numberOr(data.rowCount),
    rowChunks: numberOr(data.rowChunks),
    truncatedRows: numberOr(data.truncatedRows),
    excludedNonLabRows: numberOr(data.excludedNonLabRows),
    droppedStrings: numberOr(data.droppedStrings),
    serverDroppedStrings: numberOr(data.serverDroppedStrings),
    reporterIsAnonymous: data.reporterIsAnonymous === true,
    createdAt: toDate(data.createdAt),
    expireAt: toDate(data.expireAt),
    rawRowCount: numberOr(data.rawRowCount),
    rawSource: data.rawSource && typeof data.rawSource === 'object' ? data.rawSource : null,
    rawSourceError: typeof data.rawSourceError === 'string' ? data.rawSourceError as LabDataReportRawError : null,
  }
}

export async function listLabDataReports(max = 100): Promise<StoredLabDataReport[]> {
  const snapshot = await getDocs(query(collection(requireDb(), REPORTS), orderBy('createdAt', 'desc'), limit(max)))
  return snapshot.docs.map((record) => toReport(record.id, record.data()))
}

export async function getLabDataReport(id: string): Promise<StoredLabDataReport | null> {
  const record = await getDoc(doc(requireDb(), REPORTS, id))
  return record.exists() ? toReport(record.id, record.data()) : null
}

/** Converted rows and MediCloud raw rows, each in chunk order. Raw chunks
 *  ("raw-000" …) share the subcollection and carry kind "raw". */
export async function getLabDataReportRows(id: string): Promise<StoredLabDataReportRows> {
  const snapshot = await getDocs(query(collection(requireDb(), REPORTS, id, ROWS), orderBy('chunk')))
  const rowsOf = (chunk: (typeof snapshot.docs)[number]) => (Array.isArray(chunk.get('rows')) ? chunk.get('rows') : [])
  return {
    rows: snapshot.docs.filter((chunk) => chunk.get('kind') !== 'raw').flatMap(rowsOf),
    rawRows: snapshot.docs.filter((chunk) => chunk.get('kind') === 'raw').flatMap(rowsOf),
  }
}

/** The problem is handled: delete the report and every row chunk, at once. */
export async function deleteLabDataReport(id: string): Promise<void> {
  const database = requireDb()
  const chunks = await getDocs(collection(database, REPORTS, id, ROWS))
  const batch = writeBatch(database)
  for (const chunk of chunks.docs) batch.delete(chunk.ref)
  batch.delete(doc(database, REPORTS, id))
  await batch.commit()
}
