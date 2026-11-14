# 数据产品运营与归因分析平台

面向数据产品运营、渠道归因、用户行为分析、ROI评估、转化优化与数据应用监控的数据分析工程平台。

这是一个**纯前端**管理平台：React + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                       React + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/                  每个业务模块一个页面
│   ├── src/api/local-service.ts    本地数据服务：列表、筛选、动作流转、诊断、导出
│   ├── src/data/modules.ts         模块元数据（字段 / 状态 / 动作）
│   ├── src/data/seed.ts            示例数据（v2 已补齐可诊断字段）
│   ├── src/data/diagnosis.ts       转化路径诊断领域逻辑：样本分段、窗口分段、批次判定
│   ├── src/data/migrations.ts      本地数据版本迁移（v1 → v2）
│   ├── src/data/local-store.ts     localStorage 持久化与启动迁移
│   ├── scripts/local-data-migrate.ts  开发环境示例数据迁移检查
│   └── vite.config.ts              dev server 配置（open: false，无 /api 代理）
├── Makefile                        安装 / 迁移 / 测试 / 构建 / 预览流水线
├── docker-compose.yml
└── README.md
```

## 启动

```bash
cd frontend
npm install
npm run migrate:data   # 先迁移示例数据，与浏览器启动时的迁移规则一致
npm run dev
```

也可以从仓库根目录用 `make frontend`（会自动先跑 `migrate-data`）。

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

完整流水线：

```bash
make install        # npm ci
make migrate-data   # 示例数据 v1 → v2 迁移检查
make test           # vitest
make typecheck      # tsc --noEmit
make build          # tsc + vite build
make preview        # 预览构建产物
make verify         # 依次执行以上步骤并确认预览服务可访问
```

生产构建与容器：

```bash
cd frontend && npm run build
cd .. && docker compose up --build   # 多阶段构建，Caddy 托管 dist
```

## 转化路径诊断（低样本）

入口：侧边栏「转化路径诊断」（`/diagnosis`，`src/views/diagnosis/`）。诊断口径直接取自转化定义：

| 口径 | 取值 | 分段界线 |
| --- | --- | --- |
| 最小样本量 | CONV-0002 = 50 | 观察段 0–49 条 / 结论段 ≥50 条 |
| 统计窗口 | CONV-0002 = 7 天 | 完整窗口 ≥7 天 / 不完整窗口 <7 天 |

批次判定：

| 状态 | 条件 | 转化率 | 结论性质 |
| --- | --- | --- | --- |
| 样本不足 | 样本量 < 最小样本量，窗口完整 | **不可比较**（不展示两位小数） | 暂定结果，不作为正式结论 |
| 已达标 | 样本量 ≥ 最小样本量，窗口完整 | 可比较，两位小数 | 正式结论 |
| 待复核 | 窗口不完整（无论样本量多少） | 待复核 | 不参与结论 |

- 样本不足时仍展示完整的路径明细与已观察到的流失节点，只是节点流失率也标为「不可比较」。
- 「补算新增样本」会复用上一观察段批次的路径结构，只补算新增样本，生成**新批次**；旧批次的
  暂定结果保持原判，不会被追认成正式结论。
- 两个窗口并发汇总时，覆盖完整时间段的批次作为窗口基准批次，另一个进入待复核。
- 示例：`USER-0002` / `CONV-0002` 初始 3 条样本，转化率显示「不可比较」；补算 47 条后新批次
  达到 50/50 进入「已达标」，转化率才可比较。

## 本地数据与迁移

浏览器 `localStorage` 里的数据带版本号（当前 **v2**）：

- `data-product-ops:entries`：业务模块数据；
- `data-product-ops:diagnosis-batches`：转化路径诊断批次；
- `data-product-ops:schema-version`：数据版本。

v2 迁移会把旧版占位文本的 `CONV-0002` / `USER-0002` 补齐步骤序列、统计窗口和最小样本量，
业务状态与用户操作保持不变；迁移是幂等的，已是 v2 的数据不会再次改写。

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 渠道管理 | `channel` | 渠道配置 | 渠道编号、渠道名称、渠道类型 |
| 投放活动 | `campaign` | 投放活动 | 活动编号、活动名称、关联渠道 |
| 触点追踪 | `touchpoint` | 触点记录 | 触点编号、用户标识、触点类型 |
| 归因分析 | `attribution` | 归因模型 | 模型编号、模型名称、归因算法 |
| ROI评估 | `roi` | ROI报告 | 报告编号、关联活动、投入金额 |
| 转化漏斗 | `conversion` | 转化定义 | 转化编号、转化名称、步骤序列 |
| 转化路径诊断 | `diagnosis` | 诊断批次 | 批次编号、样本量、转化率、批次状态 |
| 用户路径 | `userpath` | 路径模式 | 模式编号、路径名称、节点序列 |
| 留存分析 | `retention` | 留存方案 | 方案编号、方案名称、初始事件 |
| 事件定义 | `eventdef` | 埋点事件 | 事件编号、事件名称、事件类型 |
| 用户画像 | `profile` | 画像定义 | 画像编号、画像名称、统计维度 |
| 热力分析 | `heatmap` | 热力方案 | 方案编号、页面名称、热力类型 |
| 竞品对标 | `benchmark` | 对标方案 | 方案编号、对标对象、对比指标 |
| 数据审计 | `auditcheck` | 审计规则 | 规则编号、审计对象、校验字段 |
| 分流配置 | `abgroup` | 分流方案 | 方案编号、方案名称、分流类型 |
| 可视化配置 | `dataviz` | 图表配置 | 配置编号、图表名称、图表类型 |
| 舆情分析 | `sentiment` | 舆情方案 | 方案编号、监控主题、关键词集合 |
| 生命周期 | `lifecycle` | 生命周期模型 | 模型编号、模型名称、生命周期阶段 |
| 运营预警 | `opsalert` | 预警规则 | 预警编号、监控指标、比较方式 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.tsx`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 诊断的样本/窗口判定只允许在 `src/data/diagnosis.ts` 里改，页面不自己算转化率。
- 想回到初始数据：清掉浏览器里 `data-product-ops:entries` 与
  `data-product-ops:diagnosis-batches`，或调用 `resetModule(模块)` / `resetDiagnosis()`。

领域：数据工程
子方向：数据分析与数据应用
