import { MODULE_BY_KEY } from '@/data/modules'
import {
  buildDiagnosisCase,
  buildIncrementalBatch,
  coverageDays,
  createdAtValue,
  DIAGNOSIS_SEED,
  sampleSegmentLabel,
} from '@/data/diagnosis'
import type { DiagnosisBatch, DiagnosisCase } from '@/data/diagnosis'
import {
  allRows,
  diagnosisStorageKey,
  listDiagnosisBatches,
  listRows,
  resetDiagnosisBatches,
  resetRows,
  saveDiagnosisBatch,
  saveRows,
  storageInfo,
} from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

// ===== 转化路径诊断 =====

export function loadDiagnosisCase(
  conversionId = 'CONV-0002',
  pathId = 'USER-0002',
): DiagnosisCase {
  const conversionRow = listRows('conversion').find(
    (row) => String(row['转化编号'] ?? '') === conversionId,
  )
  const pathRow = listRows('userpath').find(
    (row) => String(row['模式编号'] ?? '') === pathId,
  )
  const diagnosis = buildDiagnosisCase(conversionRow, pathRow, listDiagnosisBatches())
  if (!diagnosis) {
    throw new Error(
      `转化定义 ${conversionId} 或路径模式 ${pathId} 不存在，无法生成路径诊断`,
    )
  }
  return diagnosis
}

/**
 * 按同一路径结构补算新增样本。只有样本不足的批次允许补算，
 * 已有达标批次时直接返回提示，避免重复累计。
 */
export function collectDiagnosisBatch(
  conversionId = 'CONV-0002',
  pathId = 'USER-0002',
): ActionResult {
  const diagnosis = loadDiagnosisCase(conversionId, pathId)
  if (diagnosis.batches.some((batch) => batch.formal)) {
    return {
      ok: false,
      message: `${conversionId} 已有达标批次，无需补算；可复核后再生成新批次`,
    }
  }
  // 复用观察段批次的路径结构；不完整窗口批次进入待复核，不作为补算来源。
  const sourceOrder = listDiagnosisBatches()
    .filter(
      (batch) =>
        coverageDays(batch.windowStart, batch.windowEnd) >= diagnosis.rule.windowDays,
    )
    .sort((left, right) => createdAtValue(left) - createdAtValue(right))
  const source = sourceOrder[sourceOrder.length - 1]
  if (!source) {
    return { ok: false, message: '没有可补算的完整窗口批次' }
  }
  const increment = Math.max(diagnosis.rule.minSample - source.sampleCount, 0)
  const batch = buildIncrementalBatch(source, diagnosis.rule, diagnosis.nodes, {
    increment,
    existingBatches: listDiagnosisBatches(),
  })
  saveDiagnosisBatch(batch)
  return {
    ok: true,
    message: `已复用批次 ${source.id} 的路径结构，补算新增样本 ${batch.incrementalSampleCount} 条，新批次 ${batch.id} 样本量 ${batch.sampleCount}（${sampleSegmentLabel(diagnosis.rule.minSample)}）`,
  }
}

export function localDataInfo(): { schemaVersion: number; migrationNotes: string[] } {
  return storageInfo()
}

export function resetDiagnosis(): { batches: DiagnosisBatch[]; schemaVersion: number } {
  const batches = resetDiagnosisBatches()
  return { batches, schemaVersion: storageInfo().schemaVersion }
}

export function diagnosisMeta(): {
  storageKey: string
  seededBatchCount: number
} {
  return {
    storageKey: diagnosisStorageKey(),
    seededBatchCount: DIAGNOSIS_SEED.length,
  }
}

export function exportDiagnosis(): { filename: string; content: string } {
  const diagnosis = loadDiagnosisCase()
  const header = [
    '批次编号',
    '转化编号',
    '路径编号',
    '窗口开始',
    '窗口结束',
    '样本判定',
    '分段',
    '批次状态',
    '样本量',
    '最小样本量',
    '转化率',
    '复用样本',
    '补算样本',
    '复用来源',
    '结论性质',
    '状态说明',
  ]
  const rawById = new Map(listDiagnosisBatches().map((batch) => [batch.id, batch]))
  const lines = [header.join(',')]
  for (const evaluation of diagnosis.batches) {
    const raw = rawById.get(evaluation.batchId)
    lines.push(
      [
        evaluation.batchId,
        diagnosis.conversionId,
        diagnosis.pathId,
        evaluation.windowStart,
        evaluation.windowEnd,
        evaluation.sampleStatus,
        evaluation.segment,
        evaluation.status,
        raw ? String(raw.sampleCount) : evaluation.sampleProgress,
        String(diagnosis.rule.minSample),
        evaluation.rateLabel,
        raw ? String(raw.reusedSampleCount) : '0',
        raw ? String(raw.incrementalSampleCount) : '0',
        raw?.reuseFromBatchId ?? '',
        evaluation.conclusionLabel,
        evaluation.statusReason,
      ]
        .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
        .join(','),
    )
  }
  return {
    filename: `转化路径诊断-${diagnosis.conversionId}-${diagnosis.pathId}.csv`,
    content: `﻿${lines.join('\n')}`,
  }
}

export function downloadDiagnosis(): void {
  const { filename, content } = exportDiagnosis()
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
