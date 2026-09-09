FROM oven/bun:1-alpine AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
RUN bun run build
RUN bun prune --production

FROM oven/bun:1-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
COPY --from=builder /app/.output ./.output
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/instrument.server.mjs ./instrument.server.mjs
COPY --from=builder /app/src ./src
EXPOSE 3000

CMD ["bun", "--bun", "--import", "./instrument.server.mjs", ".output/server/index.mjs"]
