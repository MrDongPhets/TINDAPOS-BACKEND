# Tindapo backend — local Docker (see ../docker-compose.yml). Production build, like the droplet.
# Secrets are NOT baked in: docker compose passes TindaPos-Backend/.env at run time.
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Fallback toolchain in case a native module (bcrypt, sharp, better-sqlite3) has no prebuilt binary
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
