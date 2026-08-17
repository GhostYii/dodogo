# Windows 安装脚本：将 DoDoGo 安装为服务（NSSM）
# 用法：.\install-windows.ps1 [-InstallDir C:\dodogo]
param(
    [string]$InstallDir = "C:\dodogo"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Write-Host "==> 安装目录: $InstallDir"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

Write-Host "==> 复制文件"
Copy-Item "$root\target\release\dodogo.exe" "$InstallDir\dodogo.exe" -Force
Copy-Item "$root\config\config.example.toml" "$InstallDir\config.toml" -Force
Copy-Item -Recurse "$root\web\static" "$InstallDir\static" -Force -ErrorAction SilentlyContinue

Write-Host "==> 创建数据目录"
New-Item -ItemType Directory -Force -Path "$InstallDir\data" | Out-Null

# 注意：配置中的 data_dir 默认为相对路径 ./data，因此服务以 $InstallDir 为工作目录运行即可。
Write-Host "==> 注册服务（需要 NSSM，若未安装请先安装 nssm 并加入 PATH）"
if (Get-Command nssm -ErrorAction SilentlyContinue) {
    nssm install DoDoGo "$InstallDir\dodogo.exe" --config "$InstallDir\config.toml"
    nssm set DoDoGo AppDirectory "$InstallDir"
    nssm set DoDoGo Start SERVICE_AUTO_START
    nssm start DoDoGo
    Write-Host "==> 已启动服务，访问 http://127.0.0.1:8080"
} else {
    Write-Host "==> 未检测到 NSSM。请手动运行：$InstallDir\dodogo.exe --config $InstallDir\config.toml"
}
