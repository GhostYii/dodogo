# DoDoGo 冒烟测试：启动服务 → 注册 → 登录 → 建项目 → 建卡 → 移动 → 搜索 → 健康检查
# 用法：.\scripts\smoke-test.ps1
param(
    [string]$BaseUrl = "http://127.0.0.1:8080",
    [string]$ExePath = ""
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

if ($ExePath -eq "") {
    $ExePath = "$root\target\debug\dodogo.exe"
    if (!(Test-Path $ExePath)) { $ExePath = "$root\target\release\dodogo.exe" }
}
if (!(Test-Path $ExePath)) { throw "未找到二进制，请先 cargo build: $ExePath" }

# 提取 CSRF Cookie 值
function Get-Csrf($session) {
    foreach ($c in $session.Cookies.GetCookies([uri]$BaseUrl)) {
        if ($c.Name -eq "dodogo_csrf") { return $c.Value }
    }
    return ""
}

$proc = Start-Process -FilePath $ExePath -ArgumentList "--config","$root\config\config.toml" -PassThru -WindowStyle Hidden

try {
    # 等待就绪
    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        try {
            $r = Invoke-RestMethod "$BaseUrl/healthz" -TimeoutSec 2
            if ($r -eq "ok") { $ready = $true; break }
        } catch {}
        Start-Sleep -Milliseconds 500
    }
    if (!$ready) { throw "服务未就绪" }

    Write-Host "[OK] 健康检查"

    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $user = "admin" + (Get-Random -Max 99999)

    # 注册（首个账号自动成为系统管理员）
    $body = @{ username = $user; password = "Passw0rd!"; displayName = "冒烟管理员" } | ConvertTo-Json
    $r = Invoke-RestMethod "$BaseUrl/api/auth/register" -Method Post -Body $body -ContentType "application/json" -WebSession $session
    Write-Host "[OK] 注册: $($r.data.username) role=$($r.data.role)"

    # 登录
    $body = @{ identity = $user; password = "Passw0rd!"; remember = $false } | ConvertTo-Json
    $r = Invoke-RestMethod "$BaseUrl/api/auth/login" -Method Post -Body $body -ContentType "application/json" -WebSession $session
    Write-Host "[OK] 登录"

    # 登录后会话携带 CSRF Cookie
    $csrf = Get-Csrf $session
    if (-not $csrf) { throw "未获取到 CSRF Cookie" }
    $csrfHeaders = @{ "X-CSRF-Token" = $csrf }

    # 创建项目
    $body = @{ key = "SMK"; name = "冒烟项目"; description = "smoke"; template = "dev" } | ConvertTo-Json
    $r = Invoke-RestMethod "$BaseUrl/api/projects" -Method Post -Body $body -ContentType "application/json" -WebSession $session -Headers $csrfHeaders
    Write-Host "[OK] 创建项目: $($r.data.key)"

    # 看板列表 → 默认看板
    $r = Invoke-RestMethod "$BaseUrl/api/projects/SMK/boards" -WebSession $session
    $boardId = $r.data[0].id
    $r = Invoke-RestMethod "$BaseUrl/api/boards/$boardId" -WebSession $session
    $colId = $r.data.columns[0].id
    Write-Host "[OK] 看板含 $($r.data.columns.Count) 列"

    # 创建卡片
    $body = @{ title = "第一张卡片"; priority = "p1" } | ConvertTo-Json
    $r = Invoke-RestMethod "$BaseUrl/api/columns/$colId/cards" -Method Post -Body $body -ContentType "application/json" -WebSession $session -Headers $csrfHeaders
    $cardId = $r.data.id
    $number = $r.data.number
    Write-Host "[OK] 创建卡片: $number"

    # 移动到第二列
    $r = Invoke-RestMethod "$BaseUrl/api/boards/$boardId" -WebSession $session
    $col2 = $r.data.columns[1].id
    $body = @{ columnId = $col2 } | ConvertTo-Json
    Invoke-RestMethod "$BaseUrl/api/cards/$cardId/move" -Method Post -Body $body -ContentType "application/json" -WebSession $session -Headers $csrfHeaders | Out-Null
    $r = Invoke-RestMethod "$BaseUrl/api/cards/$cardId" -WebSession $session
    Write-Host "[OK] 卡片移动到列 $($r.data.columnId)"

    # 添加评论
    $body = @{ content = "冒烟评论 **加粗**" } | ConvertTo-Json
    Invoke-RestMethod "$BaseUrl/api/cards/$cardId/comments" -Method Post -Body $body -ContentType "application/json" -WebSession $session -Headers $csrfHeaders | Out-Null
    $r = Invoke-RestMethod "$BaseUrl/api/cards/$cardId" -WebSession $session
    Write-Host "[OK] 评论数 $($r.data.comments.Count)"

    # 搜索
    $r = Invoke-RestMethod "$BaseUrl/api/search?q=$number" -WebSession $session
    Write-Host "[OK] 搜索命中 $($r.data.Count) 条"

    # 里程碑
    $body = @{ name = "首个里程碑" } | ConvertTo-Json
    Invoke-RestMethod "$BaseUrl/api/projects/SMK/milestones" -Method Post -Body $body -ContentType "application/json" -WebSession $session -Headers $csrfHeaders | Out-Null
    $r = Invoke-RestMethod "$BaseUrl/api/projects/SMK/milestones" -WebSession $session
    Write-Host "[OK] 里程碑 $($r.data.Count) 个"

    # SSR 页面可访问性
    $loginHtml = Invoke-WebRequest "$BaseUrl/login" -UseBasicParsing -WebSession $session
    Write-Host "[OK] /login 页面 HTTP $($loginHtml.StatusCode)"

    Write-Host "`n冒烟测试全部通过 ✔"
}
finally {
    if ($proc -and !$proc.HasExited) { Stop-Process -Id $proc.Id -Force }
}
