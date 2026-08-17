#!/usr/bin/env bash
# 构建脚本：前端静态资源 + 后端 release 二进制
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> 构建前端静态资源"
(cd "$ROOT/web" && [ -d node_modules ] || npm install && node build.mjs)

echo "==> 构建后端 release"
(cd "$ROOT" && cargo build --release)

echo "==> 完成"
echo "二进制: $ROOT/target/release/dodogo"
