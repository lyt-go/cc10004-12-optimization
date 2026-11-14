import { beforeEach, describe, expect, it, vi } from 'vitest'

type MemoryStorage = Storage & { dump(): Record<string, string> }

function createMemoryStorage(seed: Record<string, string> = {}): MemoryStorage {
  const map = new Map<string, string>(Object.entries(seed))
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key)
    },
    setItem: (key: string, value: string) => {
      map.set(key, String(value))
    },
    dump: () => Object.fromEntries(map.entries()),
  }
}

const ENTRIES_KEY = 'data-product-ops:entries'
const BATCH_KEY = 'data-product-ops:diagnosis-batches'
const SCHEMA_KEY = 'data-product-ops:schema-version'

function installStorage(storage: MemoryStorage): void {
  vi.stubGlobal('window', { localStorage: storage })
}

beforeEach(() => {
  vi.resetModules()
})

describe('转化路径诊断服务（本地数据层）', () => {
  it('首次打开时 3 条样本的 USER-0002 转化率不可比较', async () => {
    installStorage(createMemoryStorage())
    const service = await import('./local-service')

    const diagnosis = service.loadDiagnosisCase()
    const first = diagnosis.batches[0]

    expect(diagnosis.rule.minSample).toBe(50)
    expect(first.batchId).toBe('DIAG-20261114-0001')
    expect(first.sampleProgress).toBe('3/50')
    expect(first.segment).toBe('观察段')
    expect(first.rateLabel).toBe('不可比较')
    expect(first.rate).toBeNull()
    expect(first.formal).toBe(false)
    expect(first.steps.length).toBe(5)
    expect(first.observedDropNodes.length).toBeGreaterThan(0)
  })

  it('补算新增样本后，新批次达到 50 条进入已达标，旧批次仍是暂定', async () => {
    installStorage(createMemoryStorage())
    const service = await import('./local-service')

    const result = service.collectDiagnosisBatch()
    expect(result.ok).toBe(true)
    expect(result.message).toContain('补算新增样本 47 条')

    const diagnosis = service.loadDiagnosisCase()
    const added = diagnosis.batches.find(
      (batch) => batch.batchId !== 'DIAG-20261114-0001' && batch.batchId !== 'DIAG-20261114-0002',
    )!
    expect(added.sampleProgress).toBe('50/50')
    expect(added.status).toBe('已达标')
    expect(added.rateLabel).toMatch(/^\d+\.\d{2}%$/)
    expect(added.reuseNote).toContain('仅补算新增样本 47 条')

    const original = diagnosis.batches.find((batch) => batch.batchId === 'DIAG-20261114-0001')!
    expect(original.status).toBe('样本不足')
    expect(original.rateLabel).toBe('不可比较')
    expect(original.supersededBy).toBe(added.batchId)

    // 不完整窗口批次仍然待复核
    const partial = diagnosis.batches.find((batch) => batch.batchId === 'DIAG-20261114-0002')!
    expect(partial.status).toBe('待复核')
    expect(partial.rateLabel).toBe('待复核')

    // 已有正式结论后不再重复补算
    const again = service.collectDiagnosisBatch()
    expect(again.ok).toBe(false)
  })

  it('v1 本地数据打开后自动迁移到 v2，诊断可直接读取真实步骤', async () => {
    const legacyEntries = {
      conversion: [
        {
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
        },
      ],
      userpath: [
        {
          id: 2,
          status: '模式分析中',
          pending: true,
          abnormal: true,
          '模式编号': 'USER-0002',
          '路径名称': '用户路径样例2',
          '节点序列': '用户路径样例2',
          '节点权重': '用户路径样例2',
          '最小频次': '用户路径样例2',
          '最大步长': '用户路径样例2',
          '起始节点': '用户路径样例2',
          '终止节点': '用户路径样例2',
        },
      ],
    }
    const storage = createMemoryStorage({
      [ENTRIES_KEY]: JSON.stringify(legacyEntries),
      [SCHEMA_KEY]: '1',
    })
    installStorage(storage)
    const service = await import('./local-service')

    const diagnosis = service.loadDiagnosisCase()
    expect(diagnosis.rule.minSample).toBe(50)
    expect(diagnosis.nodes).toContain('支付成功')
    expect(storage.getItem(SCHEMA_KEY)).toBe('2')
    expect(storage.getItem(BATCH_KEY)).not.toBeNull()

    const stored = JSON.parse(storage.getItem(ENTRIES_KEY)!) as {
      conversion: Record<string, string>[]
    }
    const row = stored.conversion.find((item) => item['转化编号'] === 'CONV-0002')!
    expect(row['步骤序列']).toContain('→')
    expect(row.status).toBe('定义评审中')
    expect(service.localDataInfo().migrationNotes.length).toBeGreaterThan(0)
  })
})
