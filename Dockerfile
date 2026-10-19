FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
COPY skills ./skills
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=8080 EDGE_TTS_PYTHON=/opt/tts/bin/python
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
COPY requirements-tts.txt ./
RUN python3 -m venv /opt/tts && /opt/tts/bin/pip install --no-cache-dir -r requirements-tts.txt
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY src/*.js ./src/
COPY skills ./skills
COPY scripts/install-skills.mjs ./scripts/install-skills.mjs
RUN npm run skills:install && mkdir -p .local/audio && chown -R node:node /app
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
CMD ["node","server/index.js"]
