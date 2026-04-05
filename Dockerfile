# Stage 1: Install production dependencies (with native compilation)
FROM node:22-alpine AS deps
RUN apk add --no-cache build-base python3 curl
RUN npm install -g pnpm@9
WORKDIR /build
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Stage 2: Build TypeScript
FROM node:22-alpine AS build
RUN npm install -g pnpm@9
WORKDIR /build
COPY package.json pnpm-lock.yaml tsconfig.json tsconfig.build.json ./
# Copy ALL deps (including devDependencies) for TypeScript compilation
RUN pnpm install --frozen-lockfile
COPY src/ ./src/
RUN pnpm build

# Stage 3: Runtime image
FROM node:22-alpine AS runtime
# Install curl for health check and runtime libs for native modules
RUN apk add --no-cache curl libstdc++
# Create non-root user
RUN addgroup -S vigilclaw && adduser -S vigilclaw -G vigilclaw
WORKDIR /app
# Copy production node_modules (includes compiled native bindings)
COPY --from=deps --chown=vigilclaw:vigilclaw /build/node_modules ./node_modules
# Copy compiled TypeScript output
COPY --from=build --chown=vigilclaw:vigilclaw /build/dist ./dist
# Create data directory (will be volume-mounted, but needs to exist)
RUN mkdir -p /app/data && chown vigilclaw:vigilclaw /app/data
USER vigilclaw
EXPOSE 9100
CMD ["node", "dist/index.js"]
