/**
 * 本地开发环境的数据迁移检查（对应「数据库与示例数据一并迁移」）。
 *
 * 浏览器的数据迁移在应用启动时由 src/data/local-store.ts 执行；
 * 这个脚本在 `npm run dev` 之前跑一遍同样的迁移规则，确认示例数据能从 v1 升到 v2，
 * 并把迁移说明打到终端，避免开发机上仍停留在旧结构。
 */
import { DIAGNOSIS_SEED } from '../src/data/diagnosis.ts'
import {
  migrateStoredEntries,
  SCHEMA_KEY,
  seedEntries,
  STORAGE_KEY,
  STORAGE_SCHEMA_VERSION,
} from '../src/data/migrations.ts'
import { SEED_ROWS } from '../src/data/seed.ts'

const seeded = seedEntries()
// 模拟旧库里 v1 播种的占位文本，再跑一遍 v1 → v2 迁移，确认迁移路径真的能补齐字段。
const legacyEntries = JSON.parse(JSON.stringify(seeded)) as typeof seeded
for (const row of legacyEntries.conversion) {
  if (String(row['转化编号'] ?? '') === 'CONV-0002') {
    for (const field of ['步骤序列', '每步事件', '转化窗口天', '目标转化率', '最小样本量', '业务域']) {
      row[field] = '转化漏斗样例2'
    }
  }
}
for (const row of legacyEntries.userpath) {
  if (String(row['模式编号'] ?? '') === 'USER-0002') {
    for (const field of ['节点序列', '节点权重', '最小频次', '最大步长', '起始节点', '终止节点']) {
      row[field] = '用户路径样例2'
    }
  }
}
const legacy = migrateStoredEntries(legacyEntries, STORAGE_SCHEMA_VERSION - 1)
const migrated = legacy.entries

const conversion = migrated.conversion?.find(
  (row) => String(row['转化编号'] ?? '') === 'CONV-0002',
)
const path = migrated.userpath?.find(
  (row) => String(row['模式编号'] ?? '') === 'USER-0002',
)

const issues: string[] = []
if (!conversion) issues.push('缺少转化定义 CONV-0002')
if (!path) issues.push('缺少路径模式 USER-0002')
if (conversion && !String(conversion['步骤序列']).includes('→')) {
  issues.push('CONV-0002 的步骤序列无法解析')
}
if (path && !String(path['节点序列']).includes('→')) {
  issues.push('USER-0002 的节点序列无法解析')
}
if (conversion && String(conversion['最小样本量']) !== '50') {
  issues.push('CONV-0002 的最小样本量不是 50')
}
if (conversion && String(conversion['转化窗口天']) !== '7') {
  issues.push('CONV-0002 的统计窗口不是 7 天')
}

console.log(`[local-data] schema v${STORAGE_SCHEMA_VERSION} · localStorage key ${STORAGE_KEY} / ${SCHEMA_KEY}`)
console.log(`[local-data] 示例批次 ${DIAGNOSIS_SEED.length} 个，示例模块 ${Object.keys(SEED_ROWS).length} 个`)
for (const note of legacy.notes) {
  console.log(`[local-data] migrate: ${note}`)
}

if (issues.length > 0) {
  console.error('[local-data] 迁移检查失败：')
  for (const issue of issues) console.error(`  - ${issue}`)
  process.exit(1)
}

console.log('[local-data] 迁移检查通过：CONV-0002 / USER-0002 可直接用于低样本诊断。')
