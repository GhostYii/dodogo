# 构建脚本：前端静态资源 + 后端 release 二进制
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Write-Host "==> 构建前端静态资源"
Push-Location "$root\web"
if (!(Test-Path node_modules)) { npm install }
node build.mjs
Pop-Location

Write-Host "==> 构建后端 release"
Push-Location $root
cargo build --release
Pop-Location

Write-Host "==> 完成"
Write-Host "二进制: $root\target\release\dodogo.exe"
