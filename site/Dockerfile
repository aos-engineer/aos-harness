ARG SITE_VERSION=dev
ARG SITE_BUILD_ID=local
ARG BUILD_DATE=unknown

# === Build stage ===
FROM oven/bun:1 AS build

ARG SITE_VERSION
ARG SITE_BUILD_ID
ARG BUILD_DATE

WORKDIR /app

# Copy the entire project (site needs access to core/ for content loading)
COPY . .

# Install site dependencies
WORKDIR /app/site
RUN bun install --frozen-lockfile 2>/dev/null || bun install

# Stamp the static output with build metadata before the Astro build runs.
RUN printf '{\n  "version": "%s",\n  "buildId": "%s",\n  "buildDate": "%s"\n}\n' \
  "$SITE_VERSION" "$SITE_BUILD_ID" "$BUILD_DATE" > /app/site/public/build-info.json

# Build the static site
RUN bun run build

# === Production stage ===
FROM nginx:alpine AS production

ARG SITE_VERSION
ARG SITE_BUILD_ID
ARG BUILD_DATE

LABEL org.opencontainers.image.title="aos-harness-site" \
      org.opencontainers.image.description="Static Astro documentation site for AOS Harness" \
      org.opencontainers.image.version="${SITE_VERSION}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      io.aos.site.build_id="${SITE_BUILD_ID}"

# Copy custom nginx config
COPY site/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built static files
COPY --from=build /app/site/dist /usr/share/nginx/html

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost:80/ || exit 1

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
