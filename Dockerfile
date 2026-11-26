FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Vite inlines these at build time. Without them the image still builds and the
# app shows a "not configured" page instead of failing.
ARG VITE_CONVEX_URL=""
ARG VITE_CLERK_PUBLISHABLE_KEY=""
ENV VITE_CONVEX_URL=$VITE_CONVEX_URL \
    VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY
RUN npm run build && npm run check:bundle

FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node server ./server
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=3s \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server/main.mjs"]
