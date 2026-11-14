import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  buildIncrementalBatch,
  evaluateBatches,
  parseConversionRule,
  parsePathPattern,
} from '@/data/diagnosis'
import type { DiagnosisBatch } from '@/data/diagnosis'
import { SEED_ROWS } from '@/data/seed'

import { BatchCard } from './DiagnosisView'

const rule = parseConversionRule(
  SEED_ROWS.conversion.find((row) => row['转化编号'] === 'CONV-0002'),
)!
const pattern = parsePathPattern(
  SEED_ROWS.userpath.find((row) => row['模式编号'] === 'USER-0002'),
)!

const lowSample: DiagnosisBatch = {
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
}

describe('诊断批次渲染', () => {
  it('3 条样本时页面显示「不可比较」，不出现两位小数转化率', () => {
    const [evaluation] = evaluateBatches([lowSample], rule, pattern.nodes).evaluations
    const html = renderToStaticMarkup(<BatchCard item={evaluation} authority />)

    expect(html).toContain('样本不足')
    expect(html).toContain('观察段')
    expect(html).toContain('3/50')
    expect(html).toContain('不可比较')
    expect(html).not.toMatch(/\d+\.\d{2}%/)
    expect(html).toContain('暂定结果，不作为正式结论')
    expect(html).toContain('已观察到流失')
    // 路径明细保留：5 个节点都在
    for (const node of pattern.nodes) expect(html).toContain(node)
  })

  it('达到 50 条的新批次显示可比较转化率与复用说明', () => {
    const batch = buildIncrementalBatch(lowSample, rule, pattern.nodes, {
      increment: 47,
      id: 'DIAG-20261114-0002',
      now: new Date('2026-11-14T10:05:00+08:00'),
    })
    const { evaluations } = evaluateBatches([lowSample, batch], rule, pattern.nodes)
    const html = renderToStaticMarkup(<BatchCard item={evaluations[1]} authority />)

    expect(html).toContain('已达标')
    expect(html).toContain('结论段')
    expect(html).toContain('50/50')
    expect(html).toMatch(/\d+\.\d{2}%/)
    expect(html).toContain('仅补算新增样本 47 条')
  })
})
