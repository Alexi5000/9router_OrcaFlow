FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . ./
RUN pnpm build

FROM node:20-alpine AS runner
WORKDIR /app

LABEL org.opencontainers.image.title="9router"

ENV NODE_ENV=production
ENV PORT=20128
ENV HOSTNAME=0.0.0.0

# Runtime writable location for localDb when DATA_DIR is configured to /app/data
RUN mkdir -p /app/data

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/open-sse ./open-sse

EXPOSE 20128

CMD ["node", "server.js"]
