# DoDoGo Release 打包脚本（Windows）
# 产出：release/dodogo-v<version>-windows-x64.zip（含 SHA256 校验）
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content "$root\Cargo.toml" | Select-String '^version\s*=\s*"([^"]+)"').Matches.Groups[1].Value

Write-Host "==> 1/5 构建前端静态资源"
Push-Location "$root\web"
if (!(Test-Path node_modules)) { npm install }
node build.mjs
Pop-Location

Write-Host "==> 2/5 构建 release 二进制（服务端 + 桌面客户端）"
Push-Location $root
cargo build --release
cargo build --release -p dodogo-desktop
Pop-Location

Write-Host "==> 3/5 组装发布包"
$dist = "$root\release\DoDoGo"
if (Test-Path $dist) { Remove-Item -Recurse -Force $dist }
New-Item -ItemType Directory -Force -Path $dist | Out-Null
Copy-Item "$root\target\release\dodogo.exe" "$dist\dodogo.exe" -Force
Copy-Item "$root\target\release\dodogo-desktop.exe" "$dist\dodogo-desktop.exe" -Force
Copy-Item "$root\config\config.example.toml" "$dist\config.example.toml" -Force
Copy-Item "$root\config\config.toml" "$dist\config.toml" -Force
Copy-Item "$root\scripts\install-windows.ps1" "$dist\install-windows.ps1" -Force
Copy-Item "$root\scripts\install-linux.sh" "$dist\install-linux.sh" -Force
Copy-Item "$root\README.md" "$dist\README.md" -Force

Write-Host "==> 4/5 压缩与校验"
$zip = "$root\release\dodogo-v$version-windows-x64.zip"
if (Test-Path $zip) { Remove-Item $zip }
Compress-Archive -Path "$dist\*" -DestinationPath $zip -Force
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash
@"
# DoDoGo v$version Release

- 平台：Windows x64
- 服务端：dodogo.exe（单文件，已内嵌前端静态资源与模板）
- 桌面客户端：dodogo-desktop.exe（WebView 壳，自动拉起服务并打开窗口）
- 压缩包：dodogo-v$version-windows-x64.zip
- 大小：$([math]::Round((Get-Item $zip).Length / 1MB, 2)) MB
- SHA256：$hash

## 运行方式

- **桌面客户端**：双击 `dodogo-desktop.exe`（自动启动服务并打开应用窗口，关闭窗口即停止服务）
- **网页版**：`dodogo.exe --config config.toml`，然后浏览器访问 http://127.0.0.1:8080

## 管理员账号注册

首次启动后，在登录页点击"注册"（或访问 /setup 初始化向导），注册的**第一个账号自动成为系统管理员**，
拥有管理后台全部权限（用户管理 / 系统设置 / 审计日志 / 备份恢复）。
后续账号为普通用户；管理员可在管理后台 → 用户管理中为他人分配系统管理员角色。

## 安装为服务（可选）

以管理员运行 `install-windows.ps1`（需 NSSM）注册为 Windows 服务。

## Linux

在 Linux x64 上执行 `scripts/build.sh`（构建）与 `scripts/install-linux.sh`（systemd 安装）。
"@ | Set-Content "$root\release\RELEASE-v$version.md" -Encoding UTF8

Write-Host "==> 5/5 完成"
Write-Host "  包：$zip"
Write-Host "  校验：$hash"
Write-Host "  说明：$root\release\RELEASE-v$version.md"
