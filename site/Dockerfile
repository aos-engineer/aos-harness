# === Build stage ===
FROM oven/bun:1 AS build

WORKDIR /app

# Copy the entire project (site needs access to core/ for content loading)
COPY . .

# Install site dependencies
WORKDIR /app/site
RUN bun install --frozen-lockfile 2>/dev/null || bun install

# Build the static site
RUN bun run build

# === Production stage ===
FROM nginx:alpine AS production

# Copy custom nginx config
COPY site/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built static files
COPY --from=build /app/site/dist /usr/share/nginx/html

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost:80/ || exit 1

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
