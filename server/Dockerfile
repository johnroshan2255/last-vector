# LAST-VECTOR server — build from repo root: docker build -f server/Dockerfile .
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --workspace server --workspace shared --include-workspace-root
COPY shared shared
COPY server server
COPY tsconfig.base.json .
RUN npm run build -w server

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
COPY --from=build /app/server/package.json server/
COPY --from=build /app/shared/package.json shared/
RUN npm ci --omit=dev --workspace server --workspace shared --include-workspace-root
COPY --from=build /app/server/dist server/dist
EXPOSE 2567
CMD ["node", "server/dist/server/src/index.js"]
