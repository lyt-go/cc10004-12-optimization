import { describe, expect, it } from 'vitest'

import {
  buildDiagnosisCase,
  buildIncrementalBatch,
  coverageDays,
  evaluateBatches,
  formatRate,
  normalizeStepCounts,
  parseConversionRule,
  parsePathPattern,
  sampleSegmentLabel,
  windowSegmentLabel,
} from './diagnosis'
import type { DiagnosisBatch } from './diagnosis'
import { SEED_ROWS } from './seed'

const conversionRow = SEED_ROWS.conversion.find((row) => row['转化编号'] === 'CONV-0002')!
const pathRow = SEED_ROWS.userpath.find((row) => row['模式编号'] === 'USER-0002')!

const rule = parseConversionRule(conversionRow)!
const pattern = parsePathPattern(pathRow)!

function makeBatch(overrides: Partial<DiagnosisBatch> = {}): DiagnosisBatch {
  return {
    id: 'B-1',
    conversionId: 'CONV-0002',
    pathId: 'USER-0002',
    windowStart: '2026-11-08',
    windowEnd: '2026-11-14',
    sampleCount: 3,
    reusedSampleCount: 0,
    incrementalSampleCount: 3,
    reuseFromBatchId: null,
    stepCounts: [3, 3, 2, 1, 0],
    createdAt: '2026-11-14T09:00:00+08:00',
    ...overrides,
  }
}

describe('转化定义与路径解析', () => {
  it('CONV-0002 的最小样本量为 50、统计窗口为 7 天', () => {
    expect(rule.minSample).toBe(50)
    expect(rule.windowDays).toBe(7)
    expect(sampleSegmentLabel(rule.minSample)).toBe('观察段 0–49 条 / 结论段 ≥50 条')
    expect(windowSegmentLabel(rule.windowDays)).toBe('完整窗口 ≥7 天 / 不完整窗口 <7 天')
  })

  it('USER-0002 的节点序列与转化定义一致', () => {
    expect(pattern.nodes).toEqual([
      '商品曝光',
      '详情浏览',
      '加入购物车',
      '提交订单',
      '支付成功',
    ])
    expect(rule.nodes).toEqual(pattern.nodes)
  })

  it('窗口天数含首尾，缺失或倒置日期按 0 天处理', () => {
    expect(coverageDays('2026-11-08', '2026-11-14')).toBe(7)
    expect(coverageDays('2026-11-13', '2026-11-14')).toBe(2)
    expect(coverageDays('bad', '2026-11-14')).toBe(0)
    expect(coverageDays('2026-11-14', '2026-11-08')).toBe(0)
  })

  it('步骤计数不允许回涨，且不超过样本量', () => {
    expect(normalizeStepCounts([10, 12, 8, 20], 10)).toEqual([10, 10, 8, 8])
  })
})

describe('低样本诊断', () => {
  it('3 个样本的 USER-0002 标为样本不足、观察段，转化率不可比较', () => {
    const batch = makeBatch()
    const { evaluations } = evaluateBatches([batch], rule, pattern.nodes)
    const [evaluation] = evaluations

    expect(evaluation.status).toBe('样本不足')
    expect(evaluation.sampleStatus).toBe('样本不足')
    expect(evaluation.segment).toBe('观察段')
    expect(evaluation.sampleProgress).toBe('3/50')
    expect(evaluation.sampleGap).toBe(47)
    expect(evaluation.comparable).toBe(false)
    expect(evaluation.formal).toBe(false)
    expect(evaluation.rate).toBeNull()
    expect(evaluation.rateLabel).toBe('不可比较')
    expect(evaluation.rateLabel).not.toMatch(/^\d+\.\d{2}%$/)
    expect(evaluation.conclusionLabel).toBe('暂定结果，不作为正式结论')
    expect(evaluation.observedDropNodes).toEqual([
      '详情浏览',
      '加入购物车',
      '提交订单',
    ])
    // 路径明细仍然完整：每个节点都有进入样本
    expect(evaluation.steps.map((step) => [step.node, step.entered, step.dropped])).toEqual([
      ['商品曝光', 3, 0],
      ['详情浏览', 3, 1],
      ['加入购物车', 2, 1],
      ['提交订单', 1, 1],
      ['支付成功', 0, 0],
    ])
    // 样本不足时节点流失率同样不可比较
    expect(evaluation.steps[1].dropShareLabel).toBe('不可比较')
  })

  it('50 个样本的新批次进入已达标，并复用同一路径结构只补算新增样本', () => {
    const previous = makeBatch()
    const batch = buildIncrementalBatch(previous, rule, pattern.nodes, {
      increment: 47,
      id: 'B-2',
      now: new Date('2026-11-14T10:00:00+08:00'),
    })

    expect(batch.sampleCount).toBe(50)
    expect(batch.reusedSampleCount).toBe(3)
    expect(batch.incrementalSampleCount).toBe(47)
    expect(batch.reuseFromBatchId).toBe(previous.id)
    expect(batch.stepCounts[0]).toBe(50)
    expect(batch.stepCounts).toHaveLength(previous.stepCounts.length)

    const { evaluations } = evaluateBatches([previous, batch], rule, pattern.nodes)
    const [oldResult, newResult] = evaluations
    expect(newResult.status).toBe('已达标')
    expect(newResult.segment).toBe('结论段')
    expect(newResult.comparable).toBe(true)
    expect(newResult.rateLabel).toBe(`${newResult.rate!.toFixed(2)}%`)
    expect(newResult.reuseNote).toContain('仅补算新增样本 47 条')

    // 旧批次保留原判定，不因新批次达标被追认为正式结论
    expect(oldResult.status).toBe('样本不足')
    expect(oldResult.formal).toBe(false)
    expect(oldResult.rate).toBeNull()
    expect(oldResult.supersededBy).toBe('B-2')
  })

  it('同一路径结构上重复补算不会改变旧批次快照', () => {
    const first = makeBatch()
    const second = buildIncrementalBatch(first, rule, pattern.nodes, { increment: 47, id: 'B-2' })
    const third = buildIncrementalBatch(second, rule, pattern.nodes, { increment: 30, id: 'B-3' })
    expect(third.sampleCount).toBe(80)
    expect(third.reusedSampleCount).toBe(50)
    expect(third.incrementalSampleCount).toBe(30)

    const { evaluations } = evaluateBatches([first, second, third], rule, pattern.nodes)
    expect(evaluations.map((item) => item.status)).toEqual(['样本不足', '已达标', '已达标'])
    expect(evaluations[0].rate).toBeNull()
  })

  it('formatRate 只对可比较的结果给出两位小数', () => {
    expect(formatRate(null)).toBe('不可比较')
    expect(formatRate(32)).toBe('32.00%')
  })

  it('种子数据保持 3 条样本的观察批次', () => {
    const diagnosis = buildDiagnosisCase(conversionRow, pathRow, [
      makeBatch({ id: 'DIAG-20261114-0001' }),
    ])
    expect(diagnosis).not.toBeNull()
    expect(diagnosis!.batches[0].rateLabel).toBe('不可比较')
  })
})

describe('并发窗口汇总', () => {
  const full = makeBatch({
    id: 'FULL',
    sampleCount: 60,
    stepCounts: [60, 50, 40, 30, 18],
    createdAt: '2026-11-14T09:00:00+08:00',
  })
  const partial = makeBatch({
    id: 'PARTIAL',
    windowStart: '2026-11-13',
    windowEnd: '2026-11-14',
    sampleCount: 55,
    stepCounts: [55, 47, 36, 22, 10],
    createdAt: '2026-11-14T10:00:00+08:00',
  })

  it('覆盖完整时间段的批次作为窗口基准，另一个进入待复核', () => {
    const { evaluations, authorityBatchId } = evaluateBatches([partial, full], rule, pattern.nodes)
    expect(authorityBatchId).toBe('FULL')

    const fullResult = evaluations.find((item) => item.batchId === 'FULL')!
    const partialResult = evaluations.find((item) => item.batchId === 'PARTIAL')!

    expect(fullResult.status).toBe('已达标')
    expect(fullResult.isAuthority).toBe(true)
    expect(partialResult.status).toBe('待复核')
    expect(partialResult.rateLabel).toBe('待复核')
    expect(partialResult.comparable).toBe(false)
    expect(partialResult.supersededBy).toBe('FULL')
    expect(partialResult.statusReason).toContain('以该批次为准')
  })

  it('不完整窗口即便样本量更大也不能成为正式结论', () => {
    const { evaluations } = evaluateBatches([partial], rule, pattern.nodes)
    expect(evaluations[0].status).toBe('待复核')
    expect(evaluations[0].rate).toBeNull()
  })
})
