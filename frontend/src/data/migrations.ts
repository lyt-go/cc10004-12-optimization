import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

/**
 * 本地数据（浏览器 localStorage，相当于纯前端版的“数据库”）版本迁移。
 * 当前版本：2。
 * - v1：首版示例数据，CONV-0002 / USER-0002 的字段是占位文本；
 * - v2：这两个示例补齐步骤序列、统计窗口、最小样本量，并新增诊断批次存储。
 */

export const STORAGE_SCHEMA_VERSION = 2
export const STORAGE_KEY = 'data-product-ops:entries'
export const DIAGNOSIS_KEY = 'data-product-ops:diagnosis-batches'
export const SCHEMA_KEY = 'data-product-ops:schema-version'

type StoredEntries = Record<string, EntryRow[]>

const SYSTEM_FIELDS = new Set(['id', 'status', 'pending', 'abnormal'])

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function migrateEntryRow(moduleKey: string, row: EntryRow): EntryRow {
  // v2：旧版本播种的占位文本解析不出步骤序列，按示例数据补齐这些字段；状态和用户操作保留。
  if (moduleKey !== 'conversion' && moduleKey !== 'userpath') return row
  const targetId = moduleKey === 'conversion' ? 'CONV-0002' : 'USER-0002'
  const idField = moduleKey === 'conversion' ? '转化编号' : '模式编号'
  const sequenceField = moduleKey === 'conversion' ? '步骤序列' : '节点序列'
  if (String(row[idField] ?? '') !== targetId) return row
  const sequence = String(row[sequenceField] ?? '')
  if (sequence.includes('→') || sequence.includes('->')) return row
  const seedRow = SEED_ROWS[moduleKey]?.find((candidate) => candidate.id === row.id)
  if (!seedRow) return row
  const patched: EntryRow = { ...row }
  for (const field of Object.keys(seedRow)) {
    if (SYSTEM_FIELDS.has(field)) continue
    patched[field] = seedRow[field]
  }
  return patched
}

export type MigrationResult = {
  entries: StoredEntries
  migrated: boolean
  notes: string[]
}

/** 纯函数，方便测试：传入已持久化的数据与版本，返回迁移后的数据。 */
export function migrateStoredEntries(
  entries: StoredEntries,
  storedVersion: number,
): MigrationResult {
  const notes: string[] = []
  if (storedVersion >= STORAGE_SCHEMA_VERSION) {
    return { entries, migrated: false, notes }
  }
  let changed = false
  const migrated: StoredEntries = {}
  for (const [moduleKey, rows] of Object.entries(entries)) {
    migrated[moduleKey] = rows.map((row) => {
      const next = migrateEntryRow(moduleKey, row)
      if (next !== row) changed = true
      return next
    })
  }
  if (changed) {
    notes.push(
      'v1 → v2：示例数据 CONV-0002 与 USER-0002 补齐步骤序列、统计窗口和最小样本量，业务状态保持不变。',
    )
  }
  notes.push('v1 → v2：新增转化路径诊断批次存储，旧数据无需重建。')
  return { entries: changed ? migrated : entries, migrated: true, notes }
}

export function seedEntries(): StoredEntries {
  return clone(SEED_ROWS)
}
