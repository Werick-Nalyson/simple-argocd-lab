# Stage 1: install dependencies
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --only=production

# Stage 2: runtime image
FROM node:22-alpine AS runtime
WORKDIR /app

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=deps /app/node_modules ./node_modules
COPY src/ ./src/

USER appuser
EXPOSE 3000

# APP_VERSION will be overridden by Kubernetes env var; fallback for local docker run
ENV APP_VERSION=local

CMD ["node", "src/index.js"]
