# 构建阶段：装上依赖并产出静态产物
FROM node:22-alpine AS build
WORKDIR /srv/web
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# 运行阶段：由 Caddy 托管 dist，SPA 深链回落到 index.html
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /srv/web/dist /usr/share/caddy
EXPOSE 5173
