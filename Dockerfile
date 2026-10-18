# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ make && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY backend/  backend/
COPY Makefile  .

RUN make

# ── Stage 2: run ─────────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS runner

WORKDIR /app
COPY --from=builder /src/rewind ./rewind
COPY frontend/               ./frontend/

# PORT is injected by Fly.io / Render / Railway at runtime.
# Falls back to 8080 for plain `docker run`.
ENV PORT=8080
EXPOSE 8080

CMD ["./rewind"]

