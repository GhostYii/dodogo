# DoDoGo 构建镜像
FROM rust:1.97 AS builder
WORKDIR /app
COPY . .
# 前端构建（无 Node 时跳过，仅保留后端）
RUN cargo build --release

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
COPY --from=builder /app/target/release/dodogo /usr/local/bin/dodogo
COPY --from=builder /app/config/config.example.toml /data/config.toml
COPY --from=builder /app/web/static /data/static
WORKDIR /data
EXPOSE 8080
ENTRYPOINT ["dodogo", "--config", "/data/config.toml"]
