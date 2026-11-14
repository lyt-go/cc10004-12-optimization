import { describe, expect, it } from 'vitest'

import { migrateStoredEntries, STORAGE_SCHEMA_VERSION } from './migrations'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

describe('本地数据迁移 v1 → v2', () => {
  function legacyConversionRow(): EntryRow {
    return {
      id: 2,
      status: '定义评审中',
      pending: true,
      abnormal: true,
      '转化编号': 'CONV-0002',
      '转化名称': '转化漏斗样例2',
      '步骤序列': '转化漏斗样例2',
      '每步事件': '转化漏斗样例2',
      '转化窗口天': '转化漏斗样例2',
      '目标转化率': '转化漏斗样例2',
      '最小样本量': '转化漏斗样例2',
      '业务域': '转化漏斗样例2',
    }
  }

  it('补齐 CONV-0002 的可诊断字段，同时保留业务状态', () => {
    const result = migrateStoredEntries(
      { conversion: [legacyConversionRow()] },
      1,
    )
    expect(result.migrated).toBe(true)
    const row = result.entries.conversion[0]
    expect(row['步骤序列']).toContain('→')
    expect(row['最小样本量']).toBe('50')
    expect(row['转化窗口天']).toBe('7')
    expect(row.status).toBe('定义评审中')
    expect(row.pending).toBe(true)
    expect(row.abnormal).toBe(true)
    expect(result.notes.some((note) => note.includes('CONV-0002'))).toBe(true)
  })

  it('已是 v2 的数据不会被再次改写', () => {
    const entries = { conversion: [...SEED_ROWS.conversion] }
    const result = migrateStoredEntries(entries, STORAGE_SCHEMA_VERSION)
    expect(result.migrated).toBe(false)
    expect(result.entries).toBe(entries)
    expect(result.notes).toHaveLength(0)
  })

  it('用户已经填过真实步骤序列时不覆盖', () => {
    const row = legacyConversionRow()
    row['步骤序列'] = '首页→搜索→下单'
    const result = migrateStoredEntries({ conversion: [row] }, 1)
    expect(result.entries.conversion[0]['步骤序列']).toBe('首页→搜索→下单')
  })
})
