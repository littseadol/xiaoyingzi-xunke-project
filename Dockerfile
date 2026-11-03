FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production FFMPEG_BIN=/usr/bin/ffmpeg XY_PORT=8080 XY_HOST=0.0.0.0 XY_PROXY_HTTP=1 XY_DATA_DIR=/data XY_DOWNLOAD_DIR=/downloads
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && mkdir /data /downloads && chown node:node /data /downloads
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
USER node
EXPOSE 8080
CMD ["node", "dist-server/server/cli.js"]
