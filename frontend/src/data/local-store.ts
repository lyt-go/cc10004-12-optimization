import { DIAGNOSIS_SEED } from './diagnosis'
import type { DiagnosisBatch } from './diagnosis'
import {
  DIAGNOSIS_KEY,
  migrateStoredEntries,
  SCHEMA_KEY,
  seedEntries,
  STORAGE_KEY,
  STORAGE_SCHEMA_VERSION,
} from './migrations'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// 首次打开或版本升级时执行迁移；迁移规则在 ./migrations.ts 里，便于测试。

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function hasStorage(): boolean {
  return typeof window !== 'undefined' && Boolean(window.localStorage)
}

const migrationNotes: string[] = []

function persist(entries: Record<string, EntryRow[]>, version: number): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  window.localStorage.setItem(SCHEMA_KEY, String(version))
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = seedEntries()
  if (!hasStorage()) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    persist(fallback, STORAGE_SCHEMA_VERSION)
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    const merged = { ...fallback, ...parsed }
    const storedVersion = Number(window.localStorage.getItem(SCHEMA_KEY) ?? '1')
    if (!Number.isFinite(storedVersion) || storedVersion < STORAGE_SCHEMA_VERSION) {
      const result = migrateStoredEntries(merged, storedVersion)
      migrationNotes.push(...result.notes)
      persist(result.entries, STORAGE_SCHEMA_VERSION)
      return result.entries
    }
    return merged
  } catch {
    persist(fallback, STORAGE_SCHEMA_VERSION)
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null
let batchCache: DiagnosisBatch[] | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (hasStorage()) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(seedEntries()[key] ?? [])
  saveRows(key, rows)
  return rows
}

function readBatches(): DiagnosisBatch[] {
  if (!hasStorage()) return clone(DIAGNOSIS_SEED)
  const raw = window.localStorage.getItem(DIAGNOSIS_KEY)
  if (!raw) {
    window.localStorage.setItem(DIAGNOSIS_KEY, JSON.stringify(DIAGNOSIS_SEED))
    return clone(DIAGNOSIS_SEED)
  }
  try {
    const parsed = JSON.parse(raw) as DiagnosisBatch[]
    if (!Array.isArray(parsed) || parsed.length === 0) {
      window.localStorage.setItem(DIAGNOSIS_KEY, JSON.stringify(DIAGNOSIS_SEED))
      return clone(DIAGNOSIS_SEED)
    }
    return parsed
  } catch {
    window.localStorage.setItem(DIAGNOSIS_KEY, JSON.stringify(DIAGNOSIS_SEED))
    return clone(DIAGNOSIS_SEED)
  }
}

export function listDiagnosisBatches(): DiagnosisBatch[] {
  if (batchCache === null) {
    batchCache = readBatches()
  }
  return batchCache
}

export function saveDiagnosisBatch(batch: DiagnosisBatch): DiagnosisBatch[] {
  const next = [
    ...listDiagnosisBatches().filter((item) => item.id !== batch.id),
    batch,
  ]
  batchCache = clone(next)
  if (hasStorage()) {
    window.localStorage.setItem(DIAGNOSIS_KEY, JSON.stringify(batchCache))
  }
  return batchCache
}

export function resetDiagnosisBatches(): DiagnosisBatch[] {
  batchCache = clone(DIAGNOSIS_SEED)
  if (hasStorage()) {
    window.localStorage.setItem(DIAGNOSIS_KEY, JSON.stringify(batchCache))
  }
  return batchCache
}

export function storageKey(): string {
  return STORAGE_KEY
}

export function diagnosisStorageKey(): string {
  return DIAGNOSIS_KEY
}

export function storageInfo(): { schemaVersion: number; migrationNotes: string[] } {
  return { schemaVersion: STORAGE_SCHEMA_VERSION, migrationNotes: [...migrationNotes] }
}
