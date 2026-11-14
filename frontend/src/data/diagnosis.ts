import type { EntryRow } from './types'

/**
 * 转化路径诊断的领域模型。
 *
 * 两种分段必须同时满足，转化率才可比较：
 * 1. 样本量达到转化定义的最小样本量（观察段 → 结论段）；
 * 2. 统计窗口覆盖转化定义要求的完整时间段（不完整窗口 → 待复核）。
 *
 * 样本不足时不做点估计：路径明细和已经观察到的流失节点照常保留，但 rate 为 null，
 * 页面上只能看到「不可比较」，不会出现两位小数的转化率。
 */

export type DiagnosisBatchStatus = '样本不足' | '已达标' | '待复核'
export type SampleStatus = '样本不足' | '已达标'
export type SampleSegment = '观察段' | '结论段'

export type DiagnosisBatch = {
  id: string
  conversionId: string
  pathId: string
  windowStart: string
  windowEnd: string
  sampleCount: number
  reusedSampleCount: number
  incrementalSampleCount: number
  reuseFromBatchId: string | null
  stepCounts: number[]
  createdAt: string
}

export type ConversionRule = {
  conversionId: string
  conversionName: string
  minSample: number
  windowDays: number
  targetRate: number | null
  nodes: string[]
}

export type PathPattern = {
  pathId: string
  pathName: string
  nodes: string[]
}

export type PathStepDetail = {
  node: string
  entered: number
  dropped: number
  dropShare: number | null
  dropShareLabel: string
  observedDrop: boolean
  terminal: boolean
}

export type BatchEvaluation = {
  batchId: string
  status: DiagnosisBatchStatus
  sampleStatus: SampleStatus
  segment: SampleSegment
  fullWindow: boolean
  coveredDays: number
  windowDays: number
  windowStart: string
  windowEnd: string
  comparable: boolean
  formal: boolean
  isAuthority: boolean
  rate: number | null
  rateLabel: string
  rateHint: string
  sampleProgress: string
  sampleGap: number
  enteringCount: number
  conversionCount: number
  steps: PathStepDetail[]
  observedDropNodes: string[]
  conclusionLabel: string
  statusReason: string
  reuseNote: string | null
  supersededBy: string | null
  supersededReason: '窗口重叠' | '后续批次' | null
}

export type DiagnosisCase = {
  key: string
  conversionId: string
  conversionName: string
  pathId: string
  pathName: string
  rule: ConversionRule
  nodes: string[]
  authorityBatchId: string | null
  batches: BatchEvaluation[]
}

/** 示例：3 条观察样本（完整窗口）→ 补算后 50 条达标；另有 2 天不完整窗口并发汇总。 */
export const DIAGNOSIS_SEED: DiagnosisBatch[] = [
  {
    id: 'DIAG-20261114-0001',
    conversionId: 'CONV-0002',
    pathId: 'USER-0002',
    windowStart: '2026-11-08',
    windowEnd: '2026-11-14',
    sampleCount: 3,
    reusedSampleCount: 0,
    incrementalSampleCount: 3,
    reuseFromBatchId: null,
    stepCounts: [3, 3, 2, 1, 0],
    createdAt: '2026-11-14T09:20:00+08:00',
  },
  {
    id: 'DIAG-20261114-0002',
    conversionId: 'CONV-0002',
    pathId: 'USER-0002',
    windowStart: '2026-11-13',
    windowEnd: '2026-11-14',
    sampleCount: 55,
    reusedSampleCount: 0,
    incrementalSampleCount: 55,
    reuseFromBatchId: null,
    stepCounts: [55, 49, 38, 24, 12],
    createdAt: '2026-11-14T10:05:00+08:00',
  },
]

export function parseNodes(sequence: string): string[] {
  return sequence
    .split(/\s*(?:→|->|>|，|,|、|\|)\s*/)
    .map((node) => node.trim())
    .filter(Boolean)
}

function numeric(value: unknown, fallback: number): number {
  const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : fallback
}

export function parseConversionRule(row: EntryRow | undefined): ConversionRule | null {
  if (!row) return null
  return {
    conversionId: String(row['转化编号'] ?? ''),
    conversionName: String(row['转化名称'] ?? ''),
    minSample: Math.max(1, Math.round(numeric(row['最小样本量'], 50))),
    windowDays: Math.max(1, Math.round(numeric(row['转化窗口天'], 7))),
    targetRate: row['目标转化率'] === undefined ? null : numeric(row['目标转化率'], Number.NaN),
    nodes: parseNodes(String(row['步骤序列'] ?? '')),
  }
}

export function parsePathPattern(row: EntryRow | undefined): PathPattern | null {
  if (!row) return null
  return {
    pathId: String(row['模式编号'] ?? ''),
    pathName: String(row['路径名称'] ?? ''),
    nodes: parseNodes(String(row['节点序列'] ?? '')),
  }
}

export function effectiveNodes(rule: ConversionRule, pattern: PathPattern): string[] {
  return pattern.nodes.length > 0 ? pattern.nodes : rule.nodes
}

export type BatchRuleCheck = {
  minSampleReached: boolean
  fullWindow: boolean
  comparable: boolean
  reason: string
}

/**
 * 页面/服务共用的判定入口：把「样本量是否够」和「窗口是否完整」分开回答，
 * 避免任何地方只看样本量就把暂定结果当成正式结论。
 */
export function checkBatchRule(
  batch: Pick<DiagnosisBatch, 'sampleCount' | 'windowStart' | 'windowEnd'>,
  rule: ConversionRule,
): BatchRuleCheck {
  const coveredDays = coverageDays(batch.windowStart, batch.windowEnd)
  const minSampleReached = batch.sampleCount >= rule.minSample
  const fullWindow = coveredDays >= rule.windowDays
  if (!minSampleReached) {
    return {
      minSampleReached,
      fullWindow,
      comparable: false,
      reason: `样本量 ${batch.sampleCount}/${rule.minSample} 未达到门槛`,
    }
  }
  if (!fullWindow) {
    return {
      minSampleReached,
      fullWindow,
      comparable: false,
      reason: `窗口仅覆盖 ${coveredDays}/${rule.windowDays} 天`,
    }
  }
  return {
    minSampleReached,
    fullWindow,
    comparable: true,
    reason: `样本量 ${batch.sampleCount}/${rule.minSample} 且窗口 ${coveredDays}/${rule.windowDays} 天完整`,
  }
}

/** 起止日期都算在窗口内，例如 11-08 到 11-14 是 7 天。 */
export function coverageDays(windowStart: string, windowEnd: string): number {
  const start = Date.parse(`${windowStart}T00:00:00Z`)
  const end = Date.parse(`${windowEnd}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0
  return Math.floor((end - start) / 86_400_000) + 1
}

function overlaps(
  left: Pick<DiagnosisBatch, 'windowStart' | 'windowEnd'>,
  right: Pick<DiagnosisBatch, 'windowStart' | 'windowEnd'>,
): boolean {
  return left.windowStart <= right.windowEnd && right.windowStart <= left.windowEnd
}

export function sampleSegmentLabel(minSample: number): string {
  return `观察段 0–${Math.max(0, minSample - 1)} 条 / 结论段 ≥${minSample} 条`
}

export function windowSegmentLabel(windowDays: number): string {
  return `完整窗口 ≥${windowDays} 天 / 不完整窗口 <${windowDays} 天`
}

export function formatRate(rate: number | null): string {
  return rate === null ? '不可比较' : `${rate.toFixed(2)}%`
}

export function normalizeStepCounts(counts: number[], sampleCount: number): number[] {
  let ceiling = Math.max(0, Math.floor(sampleCount))
  return counts.map((count) => {
    const value = Math.max(0, Math.min(Math.floor(Number(count) || 0), ceiling))
    ceiling = value
    return value
  })
}

function rateHintFor(status: DiagnosisBatchStatus): string {
  if (status === '样本不足') return '样本量未达到门槛，不做点估计，仅保留路径明细'
  if (status === '待复核') return '窗口不完整，暂不与完整窗口结论比较'
  return '样本量与窗口均满足口径，可与其他达标批次比较'
}

function stepDetail(
  node: string,
  entered: number,
  dropped: number,
  terminal: boolean,
  comparable: boolean,
): PathStepDetail {
  const dropShare = comparable && entered > 0 ? (dropped / entered) * 100 : null
  return {
    node,
    entered,
    dropped,
    dropShare,
    dropShareLabel: terminal ? '—' : comparable ? `${dropShare!.toFixed(2)}%` : '不可比较',
    observedDrop: dropped > 0,
    terminal,
  }
}

export function evaluateBatch(
  batch: DiagnosisBatch,
  rule: ConversionRule,
  nodes: string[],
): BatchEvaluation {
  const check = checkBatchRule(batch, rule)
  const coveredDays = coverageDays(batch.windowStart, batch.windowEnd)
  const fullWindow = check.fullWindow
  const sampleStatus: SampleStatus =
    check.minSampleReached ? '已达标' : '样本不足'
  const segment: SampleSegment = sampleStatus === '已达标' ? '结论段' : '观察段'

  const counts = normalizeStepCounts(
    nodes.map((_, index) => batch.stepCounts[index] ?? 0),
    batch.sampleCount,
  )
  const allZero = counts.every((count) => Number(count) === 0)
  if (counts.length > 0 && allZero && batch.sampleCount > 0) {
    counts[0] = batch.sampleCount
  }

  const terminalComparable = fullWindow && sampleStatus === '已达标'
  const steps: PathStepDetail[] = nodes.map((node, index) => {
    const entered = counts[index] ?? 0
    const terminal = index === nodes.length - 1
    const dropped = terminal ? 0 : Math.max(0, entered - (counts[index + 1] ?? 0))
    return stepDetail(node, entered, dropped, terminal, terminalComparable)
  })

  const enteringCount = counts[0] ?? 0
  const conversionCount = counts[counts.length - 1] ?? 0
  const computedRate =
    enteringCount > 0 ? (conversionCount / enteringCount) * 100 : null
  const status: DiagnosisBatchStatus = !fullWindow
    ? '待复核'
    : sampleStatus
  const comparable = status === '已达标' && computedRate !== null
  const formal = comparable

  let rateLabel = '不可比较'
  if (status === '待复核') rateLabel = '待复核'
  else if (comparable) rateLabel = formatRate(computedRate)

  const sampleProgress = `${batch.sampleCount}/${rule.minSample}`
  const sampleGap = Math.max(0, rule.minSample - batch.sampleCount)
  const observedDropNodes = steps.filter((step) => step.observedDrop).map((step) => step.node)

  let conclusionLabel = '正式结论'
  let statusReason = `样本量 ${sampleProgress}（结论段），窗口覆盖 ${coveredDays}/${rule.windowDays} 天，转化率可比较，纳入正式结论。`
  if (status === '样本不足') {
    conclusionLabel = '暂定结果，不作为正式结论'
    statusReason = `样本量 ${sampleProgress}（观察段），未达到最小样本量 ${rule.minSample}；转化率不可比较，路径明细与已观察到的流失节点仍然保留。`
  } else if (status === '待复核') {
    conclusionLabel = '待复核，不参与结论'
    statusReason = `窗口仅覆盖 ${coveredDays}/${rule.windowDays} 天，属于不完整窗口；与覆盖完整时间段的批次并发汇总时以完整批次为准，本批次进入待复核。`
  }

  let reuseNote: string | null = null
  if (batch.reuseFromBatchId) {
    reuseNote = `复用批次 ${batch.reuseFromBatchId} 的同一路径结构；沿用 ${batch.reusedSampleCount} 条有效明细，仅补算新增样本 ${batch.incrementalSampleCount} 条，累计 ${batch.sampleCount} 条。`
  }

  return {
    batchId: batch.id,
    status,
    sampleStatus,
    segment,
    fullWindow,
    coveredDays,
    windowDays: rule.windowDays,
    windowStart: batch.windowStart,
    windowEnd: batch.windowEnd,
    comparable,
    formal,
    isAuthority: false,
    rate: comparable ? computedRate : null,
    rateLabel,
    rateHint: rateHintFor(status),
    sampleProgress,
    sampleGap,
    enteringCount,
    conversionCount,
    steps,
    observedDropNodes,
    conclusionLabel,
    statusReason,
    reuseNote,
    supersededBy: null,
    supersededReason: null,
  }
}

export function createdAtValue(batch: Pick<DiagnosisBatch, 'createdAt'>): number {
  const parsed = Date.parse(batch.createdAt)
  return Number.isFinite(parsed) ? parsed : 0
}

export function evaluateBatches(
  batches: DiagnosisBatch[],
  rule: ConversionRule,
  nodes: string[],
): { evaluations: BatchEvaluation[]; authorityBatchId: string | null } {
  const ordered = [...batches].sort(
    (left, right) => createdAtValue(left) - createdAtValue(right),
  )
  const evaluations = ordered.map((batch) => evaluateBatch(batch, rule, nodes))
  const byId = new Map(ordered.map((batch) => [batch.id, batch]))

  // 窗口并发：只有完整窗口批次能做基准，另一个不完整窗口批次进入待复核。
  const full = ordered.filter(
    (batch) => coverageDays(batch.windowStart, batch.windowEnd) >= rule.windowDays,
  )
  // 只有完整窗口批次能做基准；没有完整窗口时全部待复核，不拿不完整窗口硬当基准。
  const authority = full.length > 0 ? full[full.length - 1] : null
  const authorityBatchId = authority?.id ?? null

  for (const evaluation of evaluations) {
    if (authority && evaluation.batchId === authority.id) {
      evaluation.isAuthority = true
    }

    if (!evaluation.fullWindow) {
      const own = byId.get(evaluation.batchId)!
      const overlappingAuthority =
        authority && authority.id !== evaluation.batchId && overlaps(own, authority)
      if (overlappingAuthority) {
        const authorityResult = evaluations.find(
          (candidate) => candidate.batchId === authority.id,
        )
        evaluation.supersededBy = authority.id
        evaluation.supersededReason = '窗口重叠'
        evaluation.statusReason +=
          authorityResult?.status === '已达标'
            ? ` 完整窗口批次 ${authority.id} 覆盖同一时间段且已达标，以该批次为准。`
            : ` 窗口汇总以完整窗口批次 ${authority.id} 为准；该批次仍为「${authorityResult?.status ?? '样本不足'}」，本批次不单独出结论。`
      } else {
        evaluation.statusReason += ' 当前没有覆盖同一时间段的完整窗口批次，待窗口补齐后复核。'
      }
    }

    // 批次只做快照：新批次复用旧批次后，旧的暂定结果仍是暂定，不会被追认成正式结论。
    const successor = ordered.find(
      (batch) => batch.reuseFromBatchId === evaluation.batchId,
    )
    if (successor) {
      evaluation.supersededBy = successor.id
      evaluation.supersededReason = '后续批次'
      evaluation.statusReason += ` 后续批次 ${successor.id} 已按同一路径结构补算样本，本批次保持原判定。`
    }
  }

  return { evaluations, authorityBatchId }
}

export function buildDiagnosisCase(
  conversionRow: EntryRow | undefined,
  pathRow: EntryRow | undefined,
  batches: DiagnosisBatch[],
): DiagnosisCase | null {
  const rule = parseConversionRule(conversionRow)
  const pattern = parsePathPattern(pathRow)
  if (!rule || !pattern) return null
  const nodes = effectiveNodes(rule, pattern)
  const { evaluations, authorityBatchId } = evaluateBatches(batches, rule, nodes)
  return {
    key: `${rule.conversionId}::${pattern.pathId}`,
    conversionId: rule.conversionId,
    conversionName: rule.conversionName,
    pathId: pattern.pathId,
    pathName: pattern.pathName,
    rule,
    nodes,
    authorityBatchId,
    batches: evaluations,
  }
}

function defaultShare(index: number): number {
  return Math.max(0.2, 1 - 0.16 * index)
}

function incrementCountsFor(
  nodes: string[],
  increment: number,
  previousCounts: number[],
): number[] {
  if (nodes.length === 0 || increment <= 0) return nodes.map(() => 0)
  const reliable = (previousCounts[0] ?? 0) >= 30
  return nodes.map((_, index) => {
    if (index === 0) return increment
    let share = defaultShare(index)
    if (reliable) {
      const entered = previousCounts[index - 1] ?? 0
      const next = previousCounts[index] ?? 0
      if (entered <= 0) share = 0
      else share = Math.min(1, next / entered)
    }
    return Math.round(increment * share)
  })
}

function nextBatchId(batches: DiagnosisBatch[], now: Date): string {
  const day = now.toISOString().slice(0, 10).replace(/-/g, '')
  const prefix = `DIAG-${day}-`
  const sequences = batches
    .filter((batch) => batch.id.startsWith(prefix))
    .map((batch) => Number(batch.id.slice(prefix.length)))
    .filter((value) => Number.isFinite(value))
  const next = (sequences.length > 0 ? Math.max(...sequences) : 0) + 1
  return `${prefix}${String(next).padStart(4, '0')}`
}

/**
 * 达标后生成新批次：复用上一批次的路径结构，只补算新增样本。
 * 旧批次不会原地改写，避免把暂定结果追认为正式结论。
 */
export function buildIncrementalBatch(
  previous: DiagnosisBatch,
  rule: ConversionRule,
  nodes: string[],
  options: { now?: Date; increment?: number; id?: string; existingBatches?: DiagnosisBatch[] } = {},
): DiagnosisBatch {
  const now = options.now ?? new Date()
  const increment = Math.max(
    0,
    Math.round(options.increment ?? rule.minSample - previous.sampleCount),
  )
  const previousCounts = normalizeStepCounts(
    nodes.map((_, index) => previous.stepCounts[index] ?? 0),
    previous.sampleCount,
  )
  const incrementCounts = incrementCountsFor(nodes, increment, previousCounts)
  const sampleCount = previous.sampleCount + increment
  const stepCounts = normalizeStepCounts(
    previousCounts.map((count, index) => count + (incrementCounts[index] ?? 0)),
    sampleCount,
  )

  return {
    id: options.id ?? nextBatchId(options.existingBatches ?? [previous], now),
    conversionId: previous.conversionId,
    pathId: previous.pathId,
    windowStart: previous.windowStart,
    windowEnd: previous.windowEnd,
    sampleCount,
    reusedSampleCount: previous.sampleCount,
    incrementalSampleCount: increment,
    reuseFromBatchId: previous.id,
    stepCounts,
    createdAt: now.toISOString(),
  }
}
