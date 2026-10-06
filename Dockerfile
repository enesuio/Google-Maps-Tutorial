# Multi-stage build: compiles web (Vite) and api (tsc), ships only runtime deps.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY api/package.json api/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile
COPY api api
COPY web web
RUN pnpm -r build
RUN pnpm --filter api deploy --prod --legacy /out/api

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/api ./api
COPY --from=build /app/web/dist ./web/dist
RUN mkdir -p /app/uploads
EXPOSE 3000
CMD ["node", "api/dist/server.js"]
