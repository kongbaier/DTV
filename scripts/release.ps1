#!/usr/bin/env pwsh
<#
.SYNOPSIS
  统一更新 DTV 的三处版本号（package.json / src-tauri/Cargo.toml / src-tauri/tauri.conf.json），
  并按需提交、打 tag、推送 origin 以触发 GitHub Actions 构建发布。

.DESCRIPTION
  用法示例（在仓库根目录或任意位置运行均可，脚本会自行定位仓库根）：
    pwsh ./scripts/release.ps1 -Version 3.0.4            # 交互式确认
    pwsh ./scripts/release.ps1 -Version 3.0.4 -Yes       # 自动确认：升版 + 提交 + 打 tag（不推送）
    pwsh ./scripts/release.ps1 -Version 3.0.4 -Yes -Push # 再推送 branch 与 tag，触发 CI
    pwsh ./scripts/release.ps1 -Version 3.0.4 -NoTag     # 只改版本号，git 动作全部手动

  版本号必须是 x.y.z 三段（不要带 v，脚本自动去 v；不要用 3.0.3.1 这类四段，
  package.json/npm 的 semver 不接受）。

  注意：tag 需要指向「已经包含本次要发布改动」的提交，所以脚本会先提交版本变更再打 tag；
  其它未提交的功能改动请先自行 commit，否则 tag 构建的包不含它们。
#>
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Version,

  # 只升版本号，不做任何 git 动作
  [switch]$NoTag,

  # 跳过所有交互确认（默认行为：提交 + 打 tag，不推送）
  [switch]$Yes,

  # 打 tag 后同时推送当前分支与 tag 到 origin（配合 -Yes 可用于全自动发版）
  [switch]$Push,

  # 覆盖仓库根目录（一般无需传入，供脚本定位/测试用）
  [string]$Root = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------- 版本号校验 ----------
$Version = $Version.Trim().TrimStart('v', 'V')
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
  Write-Error "错误：版本号格式无效，需要 x.y.z 格式，例如 3.0.4（当前输入：$Version）"
  exit 1
}

# ---------- 定位仓库根目录 ----------
if (-not $Root) {
  if ($PSScriptRoot) {
    $Root = Split-Path -Parent $PSScriptRoot   # scripts/ 的上一级
  } else {
    $Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
  }
}
if (-not (Test-Path (Join-Path $Root 'package.json'))) {
  Write-Error "找不到仓库根目录（未在 package.json 旁）。当前定位到：$Root"
  exit 1
}

$VersionFiles = @{
  'package.json'            = Join-Path $Root 'package.json'
  'src-tauri/Cargo.toml'    = Join-Path $Root 'src-tauri\Cargo.toml'
  'src-tauri/tauri.conf.json' = Join-Path $Root 'src-tauri\tauri.conf.json'
}

# ---------- 前置 fail-fast：目标 tag 已存在则立即中止，避免留多余提交 ----------
if (-not $NoTag -and (git rev-parse --is-inside-work-tree 2>$null)) {
  $tag = "v$Version"
  if (git rev-parse -q --verify "refs/tags/$tag") {
    Write-Error "tag $tag 已存在（该版本可能已发布）。请换一个版本号，或先删除旧 tag：git tag -d $tag"
    exit 1
  }
}

# ---------- 读写辅助 ----------
function Read-FileUtf8([string]$Path) {
  if (-not (Test-Path $Path)) { throw "文件不存在：$Path" }
  return [System.IO.File]::ReadAllText($Path, [System.Text.UTF8Encoding]::new($false))
}

function Write-FileUtf8([string]$Path, [string]$Content) {
  # 统一写 UTF-8 无 BOM，保留读取到的原有换行（不改 \r\n）
  [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

function Get-VersionInFile([string]$Path) {
  $raw = Read-FileUtf8 $Path
  if ($Path -like '*Cargo.toml') {
    # Cargo.toml：行首 version = "x.y.z"（仅 [package] 里的 dtv 版本出现在行首）
    $m = [regex]::Match($raw, '(?m)^version\s*=\s*"([^"]+)"')
  } else {
    # JSON：取第一个 "version": "x.y.z"
    $m = [regex]::Match($raw, '"version"\s*:\s*"([^"]+)"')
  }
  if ($m.Success) { return $m.Groups[1].Value }
  throw "在 $Path 中找不到 version 字段"
}

function Set-VersionInFile([string]$Path, [string]$NewVersion) {
  $raw = Read-FileUtf8 $Path
  if ($Path -like '*Cargo.toml') {
    # Cargo.toml：只替换「行首的 version = "..."」——全文件只有 [package] 里的 dtv 版
    # 这一处出现在行首（依赖的 version 都在行内/缩进），用 count=1 保守只改第一处。
    $new = [regex]::Replace($raw, '(?m)^version\s*=\s*"[^"]*"', ('version = "' + $NewVersion + '"'), 1)
  } else {
    # JSON：只替换第一处 "version": "..."
    $new = [regex]::Replace($raw, '("version"\s*:\s*")[^"]*(")', ('${1}' + $NewVersion + '${2}'), 1)
  }
  if ($new -ceq $raw) {
    throw "在 $Path 中没有匹配到可替换的版本号（格式与预期不符），已中止，未改动任何文件。"
  }
  Write-FileUtf8 $Path $new
}

function To-VersionObj([string]$s) {
  try { return [version]$s } catch { return [version]'0.0.0' }
}

# ---------- 读取当前版本，做一致性检查 ----------
$currents = @{}
foreach ($name in $VersionFiles.Keys) {
  $currents[$name] = Get-VersionInFile $VersionFiles[$name]
}

Write-Host ''
Write-Host '当前版本：' -ForegroundColor Cyan -NoNewline
foreach ($name in @('package.json', 'src-tauri/Cargo.toml', 'src-tauri/tauri.conf.json')) {
  Write-Host "$name = $($currents[$name])" -NoNewline
  if ($name -ne 'src-tauri/tauri.conf.json') { Write-Host '  |  ' -NoNewline }
}
Write-Host ''
Write-Host "目标版本：v$Version" -ForegroundColor Cyan
Write-Host ''

$distinct = @($currents.Values | Sort-Object -Unique)
if ($distinct.Count -gt 1) {
  Write-Host "⚠️  警告：三处版本号不一致！将以 v$Version 统一。" -ForegroundColor Yellow
}

$highestCurrent = ($currents.Values | ForEach-Object { To-VersionObj $_ } | Measure-Object -Maximum).Maximum
$targetObj = To-VersionObj $Version
$downgrade = $targetObj -lt $highestCurrent
$same = $targetObj -eq $highestCurrent -and $distinct.Count -eq 1

# ---------- 提醒 / 确认 ----------
if (-not $Yes) {
  if ($downgrade) {
    Write-Host "⚠️  降级警告：v$($highestCurrent.ToString()) -> v$Version（新版本低于当前版本）" -ForegroundColor Yellow
    $confirm = Read-Host "确认降级？输入版本号 '$Version' 继续"
    if ($confirm -ne $Version) { Write-Host '已取消。'; exit 0 }
  }
  elseif ($same) {
    Write-Host "版本没有变化（当前就是 v$Version）。" -ForegroundColor Yellow
    $confirm = Read-Host "确认仍要执行？输入 'y' 继续"
    if ($confirm -ne 'y') { Write-Host '已取消。'; exit 0 }
  }
  else {
    Write-Host "版本变更：v$($highestCurrent.ToString()) -> v$Version" -ForegroundColor Cyan
    $confirm = Read-Host "确认升级？输入 'y' 继续"
    if ($confirm -ne 'y') { Write-Host '已取消。'; exit 0 }
  }
}

# ---------- 写入三个文件 ----------
foreach ($name in $VersionFiles.Keys) {
  Set-VersionInFile $VersionFiles[$name] $Version
}

# ---------- 写回后校验 ----------
$failed = @()
foreach ($name in $VersionFiles.Keys) {
  $after = Get-VersionInFile $VersionFiles[$name]
  if ($after -ne $Version) { $failed += $name }
}
if ($failed.Count -gt 0) {
  Write-Host "❌ 校验未通过，以下文件版本不是 v$Version：$($failed -join ', ')" -ForegroundColor Red
  exit 1
}
Write-Host "✅ 版本已统一更新为 v$Version" -ForegroundColor Green

if ($NoTag) {
  Write-Host ''
  Write-Host '已跳过 git 动作（-NoTag）。请手动：'
  Write-Host '  git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json'
  Write-Host "  git commit -m \"release: v$Version\""
  Write-Host "  git tag v$Version && git push origin v$Version"
  exit 0
}

# ---------- git 环境检查 ----------
if (-not (git rev-parse --is-inside-work-tree 2>$null)) {
  Write-Host '⚠️  不在 git 仓库内，跳过提交/打 tag。仅完成了版本号更新。' -ForegroundColor Yellow
  exit 0
}

# 提醒：非版本文件的未提交改动不会被带进 tag 的构建
$dirty = git status --porcelain
$otherDirty = @($dirty | Where-Object {
    $_ -notmatch '^\s*[MADRCU?]?\s*(package\.json|src-tauri/Cargo\.toml|src-tauri/tauri\.conf\.json)(\s|$)'
  })
if ($otherDirty.Count -gt 0) {
  Write-Host ''
  Write-Host '⚠️  检测到版本文件之外的未提交改动（不会被本次 release 构建包含）：' -ForegroundColor Yellow
  $otherDirty | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
  if (-not $Yes) {
    $confirm = Read-Host "请先自行提交这些改动。仍要继续打 tag？输入 'y' 继续"
    if ($confirm -ne 'y') { Write-Host '已取消。'; exit 0 }
  }
}

# ---------- 提交 ----------
if (-not $Yes) {
  $c = Read-Host "提交版本变更（commit: release: v$Version）？[y/N]"
  if ($c -ne 'y') { Write-Host '已取消，未提交/打 tag。'; exit 0 }
}
git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
if ($LASTEXITCODE -ne 0) { Write-Error 'git add 失败。'; exit 1 }
git commit -m "release: v$Version"
if ($LASTEXITCODE -ne 0) { Write-Error "git commit 失败（可能未配置 user.name/email，或提交内容为空）。"; exit 1 }
Write-Host "✅ 已提交 release: v$Version" -ForegroundColor Green

# ---------- 打 tag ----------
$tag = "v$Version"
if (git rev-parse -q --verify "refs/tags/$tag") {
  Write-Error "tag $tag 已存在，请换一个版本号，或先删除旧 tag（git tag -d $tag）后重试。"
  exit 1
}
git tag $tag
if ($LASTEXITCODE -ne 0) { Write-Error "git tag $tag 失败。"; exit 1 }
Write-Host "✅ 已创建本地 tag：$tag" -ForegroundColor Green

# ---------- 推送 ----------
if ($Push) {
  $branch = git branch --show-current
  if ($branch) {
    git push origin $branch
    if ($LASTEXITCODE -ne 0) { Write-Host "⚠️  推送分支 $branch 失败，继续尝试推送 tag。" -ForegroundColor Yellow }
    else { Write-Host "✅ 已推送分支 $branch" -ForegroundColor Green }
  }
  git push origin $tag
  if ($LASTEXITCODE -ne 0) { Write-Error '推送 tag 失败，请检查网络 / origin 地址。'; exit 1 }
  Write-Host '✅ 已推送 tag，两个 workflow（build.yml / windows-build.yml）将在 GitHub Actions 上开始构建。' -ForegroundColor Green
}
else {
  Write-Host ''
  Write-Host '本地已完成，tag 尚未推送。手动推送以触发构建发布：'
  Write-Host "  git push origin $tag"
  if (-not $Yes) {
    $p = Read-Host "现在推送 tag 到 origin？[y/N]"
    if ($p -eq 'y') {
      git push origin $tag
      if ($LASTEXITCODE -ne 0) { Write-Error '推送 tag 失败。'; exit 1 }
    }
  }
}
Write-Host ''
Write-Host '发布后注意：'
Write-Host '  · fork 仓库需在 Settings → Actions 中启用 workflow（首次发版常见）。'
Write-Host "  · 应用内“检查更新”横幅已改为跟踪本 fork 的 GitHub Releases（version_check.rs）。"
Write-Host '  · 非 draft / prerelease 的 Release 建成后，横幅才会提示有新版本。'
Write-Host '完成 ✅'
