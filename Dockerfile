FROM oven/bun:1.4.2-alpine AS builder
WORKDIR /app
ARG VITE_SENTRY_DSN
ARG VITE_SENTRY_ORG
ARG VITE_SENTRY_PROJECT
ARG VITE_APP_TITLE
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN \
    VITE_SENTRY_ORG=$VITE_SENTRY_ORG \
    VITE_SENTRY_PROJECT=$VITE_SENTRY_PROJECT \
    VITE_APP_TITLE=$VITE_APP_TITLE
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
# The auth token arrives as a BuildKit secret, never an ARG/ENV: a GHA layer cache is readable
# from PRs on this public repo. An absent secret is fine — it just disables source-map upload.
RUN --mount=type=secret,id=sentry_auth_token \
    SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_auth_token 2>/dev/null)" bun run build
RUN bun prune --production

FROM oven/bun:1.4.2-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
COPY --from=builder --chown=bun:bun /app/.output ./.output
COPY --from=builder --chown=bun:bun /app/node_modules ./node_modules
COPY --from=builder --chown=bun:bun /app/instrument.server.mjs ./instrument.server.mjs
COPY --from=builder --chown=bun:bun /app/src ./src
USER bun
EXPOSE 3000

CMD ["bun", "--bun", "--import", "./instrument.server.mjs", ".output/server/index.mjs"]
