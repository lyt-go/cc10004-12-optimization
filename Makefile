.PHONY: install frontend build typecheck test migrate-data preview deploy docker-build docker-run verify

install:
	cd frontend && npm ci

# 本地开发前先把示例数据迁移到当前版本（与浏览器启动时的迁移规则一致）
migrate-data:
	cd frontend && npm run migrate:data

frontend: migrate-data
	cd frontend && npm run dev

typecheck:
	cd frontend && npm run typecheck

test:
	cd frontend && npm test

build:
	cd frontend && npm run build

preview:
	cd frontend && npm run preview

# 部署校验：起预览服务，确认首页、构建产物和诊断路由可访问后干净退出
deploy: build
	cd frontend && npm run preview:check

docker-build:
	docker build -t data-product-ops-frontend:local ./frontend

docker-run:
	docker run --rm -p 5173:5173 data-product-ops-frontend:local

# 上线流水线：依赖 → 示例数据迁移 → 测试 → 类型检查 → 构建 → 部署校验
verify: install migrate-data test typecheck deploy
