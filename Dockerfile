# syntax=docker/dockerfile:1

FROM node:20-slim AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

RUN groupadd --system appuser \
  && useradd --system --gid appuser --create-home --home-dir /home/appuser appuser

USER appuser

EXPOSE 3000

CMD ["node", "dist/index.js"]
