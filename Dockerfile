FROM node:24.15.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24.15.0-bookworm-slim AS runtime
ARG ONCHAINOS_VERSION=4.4.10
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && curl -fsSLo /tmp/onchainos "https://github.com/okx/onchainos-skills/releases/download/v${ONCHAINOS_VERSION}/onchainos-x86_64-unknown-linux-gnu" \
  && curl -fsSLo /tmp/checksums.txt "https://github.com/okx/onchainos-skills/releases/download/v${ONCHAINOS_VERSION}/checksums.txt" \
  && grep "onchainos-x86_64-unknown-linux-gnu" /tmp/checksums.txt | sed 's#onchainos-x86_64-unknown-linux-gnu#/tmp/onchainos#' | sha256sum -c - \
  && install -m 0755 /tmp/onchainos /usr/local/bin/onchainos \
  && rm /tmp/onchainos /tmp/checksums.txt \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig*.json ./
COPY scripts/render-start.sh ./scripts/render-start.sh
RUN chmod 0755 ./scripts/render-start.sh
ENV NODE_ENV=production
ENV HOME=/app/storage/home
EXPOSE 10000
CMD ["./scripts/render-start.sh"]
