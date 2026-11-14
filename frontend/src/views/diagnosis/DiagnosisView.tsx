import { useCallback, useEffect, useState } from 'react'

import {
  collectDiagnosisBatch,
  downloadDiagnosis,
  loadDiagnosisCase,
  resetDiagnosis,
} from '@/api/local-service'
import {
  sampleSegmentLabel,
  windowSegmentLabel,
} from '@/data/diagnosis'
import type { BatchEvaluation, DiagnosisCase } from '@/data/diagnosis'

const STATUS_CLASS: Record<string, string> = {
  样本不足: 'badge warning',
  已达标: 'badge success',
  待复核: 'badge pending',
}

export function BatchCard({ item, authority }: { item: BatchEvaluation; authority: boolean }) {
  return (
    <article className="diag-batch" data-batch={item.batchId} data-status={item.status}>
      <header className="diag-batch-head">
        <div>
          <strong>{item.batchId}</strong>
          <span className="diag-window">
            {item.windowStart} ~ {item.windowEnd}（{item.coveredDays}/{item.windowDays} 天）
          </span>
        </div>
        <div className="diag-badge-row">
          <span className={STATUS_CLASS[item.status] ?? 'badge'}>{item.status}</span>
          <span className="badge muted">样本判定：{item.sampleStatus}</span>
          <span className="badge muted">{item.segment}</span>
          <span className={item.fullWindow ? 'badge muted' : 'badge pending'}>
            窗口：{item.fullWindow ? '完整' : '不完整'}
          </span>
          {authority && <span className="badge info">窗口基准批次</span>}
        </div>
      </header>

      <dl className="diag-meta">
        <div>
          <dt>样本量</dt>
          <dd>{item.sampleProgress}</dd>
        </div>
        <div>
          <dt>转化率</dt>
          <dd className={item.comparable ? 'rate-value' : 'rate-value muted-value'}>{item.rateLabel}</dd>
          <dd className="diag-hint">{item.rateHint}</dd>
        </div>
        <div>
          <dt>结论性质</dt>
          <dd>{item.conclusionLabel}</dd>
        </div>
        <div>
          <dt>已观察到的流失节点</dt>
          <dd>{item.observedDropNodes.length > 0 ? item.observedDropNodes.join('、') : '—'}</dd>
        </div>
      </dl>

      <p className="diag-reason">{item.statusReason}</p>
      if (item.reuseNote) <p className="diag-reuse">{item.reuseNote}</p>
      {item.supersededBy && (
        <p className="diag-superseded">
          {item.supersededReason === '窗口重叠'
            ? `窗口与批次 ${item.supersededBy} 重叠且不完整，请以该批次复核。`
            : `后续批次 ${item.supersededBy} 已按同一路径结构补算样本，本批次保持原判定。`}
        </p>
      )}

      <table className="data-table diag-steps">
        <thead>
          <tr>
            <th>路径节点</th>
            <th>进入样本</th>
            <th>流失样本</th>
            <th>节点流失率</th>
            <th>明细状态</th>
          </tr>
        </thead>
        <tbody>
          {item.steps.map((step) => (
            <tr key={step.node} className={step.observedDrop ? 'drop-row' : ''}>
              <td>{step.node}</td>
              <td>{step.entered}</td>
              <td>{step.dropped}</td>
              <td>{step.terminal ? '—' : step.dropShareLabel}</td>
              <td>{step.observedDrop ? '已观察到流失' : step.terminal ? '终点节点' : '暂无流失'}</td>
            </tr>
          ))}
          {item.steps.length === 0 && (
            <tr>
              <td colSpan={5} className="empty-state">路径结构为空，请先补全路径节点序列</td>
            </tr>
          )}
        </tbody>
      </table>
    </article>
  )
}

export default function DiagnosisView() {
  const [diagnosis, setDiagnosis] = useState<DiagnosisCase | null>(null)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  const reload = useCallback(() => {
    setErrorMessage('')
    try {
      setDiagnosis(loadDiagnosisCase())
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '转化路径诊断读取失败')
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  function collect() {
    setErrorMessage('')
    setMessage('')
    const result = collectDiagnosisBatch()
    if (!result.ok) {
      setErrorMessage(result.message)
      return
    }
    setMessage(result.message)
    reload()
  }

  function resetAll() {
    setErrorMessage('')
    resetDiagnosis()
    setMessage('诊断批次已回到示例数据，页面重新读取。')
    reload()
  }

  if (!diagnosis) {
    return (
      <section className="page" data-module="diagnosis">
        <header className="page-head">
          <div>
            <h2>转化路径诊断</h2>
            <p className="page-desc">低样本诊断按最小样本量与统计窗口分段展示，样本不足时只保留路径明细。</p>
          </div>
        </header>
        {errorMessage && <p className="error-text">{errorMessage}</p>}
      </section>
    )
  }

  const insufficient = diagnosis.batches.filter((item) => item.status === '样本不足').length
  const reached = diagnosis.batches.filter((item) => item.status === '已达标').length
  const review = diagnosis.batches.filter((item) => item.status === '待复核').length

  return (
    <section className="page" data-module="diagnosis">
      <header className="page-head">
        <div>
          <h2>转化路径诊断</h2>
          <p className="page-desc">
            {diagnosis.conversionId} · {diagnosis.conversionName} / {diagnosis.pathId} · {diagnosis.pathName}
          </p>
        </div>
        <div className="page-actions">
          <button className="btn primary" type="button" onClick={collect}>补算新增样本</button>
          <button className="btn" type="button" onClick={() => downloadDiagnosis()}>导出诊断明细</button>
          <button className="btn ghost" type="button" onClick={resetAll}>重置诊断批次</button>
        </div>
      </header>

      <div className="stat-row">
        <article className="stat-card">
          <span className="stat-label">诊断批次</span>
          <strong className="stat-value">{diagnosis.batches.length}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">样本不足（暂定）</span>
          <strong className="stat-value">{insufficient}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">已达标（正式）</span>
          <strong className="stat-value">{reached}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">待复核（窗口不完整）</span>
          <strong className="stat-value">{review}</strong>
        </article>
      </div>

      <div className="diag-rule" data-rule="sample-window">
        <span className="diag-rule-item">最小样本量：{diagnosis.rule.minSample} 条</span>
        <span className="diag-rule-item">统计窗口：{diagnosis.rule.windowDays} 天</span>
        <span className="diag-rule-item">样本分段：{sampleSegmentLabel(diagnosis.rule.minSample)}</span>
        <span className="diag-rule-item">窗口分段：{windowSegmentLabel(diagnosis.rule.windowDays)}</span>
      </div>

      <p className="diag-note">
        样本不足时转化率标记为「不可比较」，不做点估计；路径明细与已观察到的流失节点照常保留。
        只有结论段且窗口覆盖完整的批次才展示可比较转化率并进入正式结论。
      </p>

      <div className="diag-batch-list">
        {diagnosis.batches.map((item) => (
          <BatchCard key={item.batchId} item={item} authority={item.batchId === diagnosis.authorityBatchId} />
        ))}
      </div>

      <footer className="page-foot">
        <span>诊断批次数据保存在本机浏览器里；批次只做快照，旧批次的暂定结果不会被追认成正式结论</span>
        <span>
          {message && <span className="success-text">{message}</span>}
          {errorMessage && <span className="error-text">{errorMessage}</span>}
        </span>
      </footer>
    </section>
  )
}
