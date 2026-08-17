# DoDoGo Release 打包脚本（Windows）
# 产出：release/dodogo-v<version>-windows-x64.zip（含 SHA256 校验）
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content "$root\Cargo.toml" | Select-String '^version\s*=\s*"([^"]+)"').Matches.Groups[1].Value

Write-Host "==> 1/4 构建前端静态资源"
Push-Location "$root\web"
if (!(Test-Path node_modules)) { npm install }
node build.mjs
Pop-Location

Write-Host "==> 2/4 构建 release 二进制"
Push-Location $root
cargo build --release
Pop-Location

Write-Host "==> 3/4 组装发布包"
$dist = "$root\release\DoDoGo"
if (Test-Path $dist) { Remove-Item -Recurse -Force $dist }
New-Item -ItemType Directory -Force -Path $dist | Out-Null
Copy-Item "$root\target\release\dodogo.exe" "$dist\dodogo.exe" -Force
Copy-Item "$root\config\config.example.toml" "$dist\config.example.toml" -Force
Copy-Item "$root\config\config.toml" "$dist\config.toml" -Force
Copy-Item "$root\scripts\install-windows.ps1" "$dist\install-windows.ps1" -Force
Copy-Item "$root\scripts\install-linux.sh" "$dist\install-linux.sh" -Force
Copy-Item "$root\README.md" "$dist\README.md" -Force

Write-Host "==> 4/4 压缩与校验"
$zip = "$root\release\dodogo-v$version-windows-x64.zip"
if (Test-Path $zip) { Remove-Item $zip }
Compress-Archive -Path "$dist\*" -DestinationPath $zip -Force
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash
@"
# DoDoGo v$version Release

- 平台：Windows x64
- 二进制：dodogo.exe（单文件，已内嵌前端静态资源与模板）
- 压缩包：dodogo-v$version-windows-x64.zip
- 大小：$([math]::Round((Get-Item $zip).Length / 1MB, 2)) MB
- SHA256：$hash

## 安装

1. 解压 zip；
2. 以管理员运行 `install-windows.ps1`（可选，需 NSSM）或直接运行 `dodogo.exe --config config.toml`；
3. 访问 http://127.0.0.1:8080，完成初始化向导。

## Linux

在 Linux x64 上执行 `scripts/build.sh`（构建）与 `scripts/install-linux.sh`（systemd 安装）。
"@ | Set-Content "$root\release\RELEASE-v$version.md" -Encoding UTF8

Write-Host "完成："
Write-Host "  包：$zip"
Write-Host "  校验：$hash"
Write-Host "  说明：$root\release\RELEASE-v$version.md"
