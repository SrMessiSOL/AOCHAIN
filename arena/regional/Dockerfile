FROM rust:1.97 AS rules
WORKDIR /src/arena
COPY arena/Cargo.toml arena/Cargo.lock ./
COPY arena/core ./core
COPY arena/runner ./runner
COPY arena/programs ./programs
RUN cargo build --locked --release -p aochain-arena-runner

FROM node:24-bookworm-slim AS browser
WORKDIR /app
COPY arena/integration/package*.json ./arena/integration/
RUN cd arena/integration && npm ci
COPY arena/integration ./arena/integration
COPY arena/web ./arena/web
RUN node arena/integration/build-browser.mjs

FROM node:24-bookworm-slim
WORKDIR /app
COPY arena/package*.json ./arena/
RUN cd arena && npm ci --omit=dev
COPY arena/regional ./arena/regional
COPY arena/web ./arena/web
COPY frontend/public/graphics ./frontend/public/graphics
COPY --from=browser /app/arena/work ./arena/work
COPY --from=rules /src/arena/target/release/aochain-arena-runner /app/rules/arena-runner
RUN mkdir -p arena/work && chown -R node:node /app
USER node
ENV AOCHAIN_RUNNER=/app/rules/arena-runner HOST=0.0.0.0 PORT=3210
EXPOSE 3210
CMD ["node", "arena/regional/server.mjs"]
