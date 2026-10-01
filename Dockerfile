# syntax=docker/dockerfile:1

# ---- Build: compile the app into static files -------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Set RUN_TESTS=true to run the unit tests as part of the image build.
ARG RUN_TESTS=false
RUN if [ "$RUN_TESTS" = "true" ]; then npm test; fi
RUN npm run build

# ---- Serve: static files only, nginx running as a non-root user -------------
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
# Runs before nginx starts: sets up SCORM's server key, if ANTHROPIC_API_KEY is given.
COPY --chmod=755 deploy/scorm-ai.sh /docker-entrypoint.d/40-scorm-ai.sh
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
