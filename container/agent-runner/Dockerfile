FROM node:22-alpine AS builder
WORKDIR /build
COPY package.json pnpm-lock.yaml* ./
RUN npm install
COPY src/ ./src/
COPY tsconfig.json ./
RUN npx tsc

FROM node:22-alpine AS runtime
RUN addgroup -S agent && adduser -S agent -G agent
RUN apk del --purge apk-tools 2>/dev/null; rm -rf /var/cache/apk/* /tmp/* /root/.cache
WORKDIR /app
COPY --from=builder --chown=agent:agent /build/dist/ ./
COPY --from=builder /build/node_modules/ ./node_modules/
RUN mkdir -p /ipc/input /ipc/output /workspace /tmp && \
    chown -R agent:agent /ipc /workspace /tmp
USER agent
ENTRYPOINT ["node", "/app/index.js"]
