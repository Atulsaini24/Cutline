# One image runs the whole app: API, render workers and the built web app.
#   docker build -t cutline .
#   docker run -p 8787:8787 -v cutline-data:/data --env-file backend/.env cutline

# ---- build the web app ----
FROM node:20-bookworm-slim AS web
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY shared/ /app/shared/
COPY frontend/ ./
RUN npm run build

# ---- install server dependencies (build tools only live in this stage) ----
FROM node:20-bookworm-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/package*.json ./
# optional local Whisper is included; if its runtime can't install, the build still succeeds
RUN npm ci --omit=dev

# ---- runtime ----
FROM node:20-bookworm-slim
# fonts let FFmpeg burn captions into renders
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core fontconfig ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY --from=deps /app/backend/node_modules ./node_modules
COPY backend/ ./
COPY shared/ /app/shared/
COPY --from=web /app/frontend/dist /app/frontend/dist
ENV NODE_ENV=production STORAGE_DIR=/data PORT=8787
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://localhost:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node_modules/.bin/tsx", "src/server.ts"]
