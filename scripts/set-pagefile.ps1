# 设置虚拟内存 pagefile —— 管理员权限运行
# 用法: 管理员 PowerShell 中执行 .\scripts\set-pagefile.ps1

$ErrorActionPreference = "Stop"

# 1. 查当前物理内存
$cs = Get-CimInstance Win32_ComputerSystem
$ramGB = [math]::Round($cs.TotalPhysicalMemory / 1GB, 0)
Write-Host "物理内存: $ramGB GB"

# 2. 查当前 pagefile
$pf = Get-CimInstance Win32_PageFileUsage
Write-Host "当前 pagefile:"
$pf | ForEach-Object {
    Write-Host "  $($_.Name): Allocated=$([math]::Round($_.AllocatedBaseSize/1024,1))GB, Peak=$([math]::Round($_.PeakUsage/1024,1))GB"
}

# 3. 固定 10GB（10240 MB）
$targetMB = 10240  # 10GB
Write-Host ""
Write-Host "推荐设置: ${targetMB} MB ($([math]::Round($targetMB/1024,1)) GB)"

$confirm = Read-Host "输入 yes 确认修改 (需要重启生效)"
if ($confirm -ne "yes") {
    Write-Host "已取消。"
    exit 0
}

# 4. 关闭自动管理
$compSys = Get-WmiObject Win32_ComputerSystem -EnableAllPrivileges
$compSys.AutomaticManagedPagefile = $false
$compSys.Put() | Out-Null
Write-Host "已关闭自动管理 pagefile。"

# 5. 设置 pagefile 大小
$pfSetting = Get-WmiObject Win32_PageFileSetting
if ($pfSetting) {
    $pfSetting.InitialSize = $targetMB
    $pfSetting.MaximumSize = $targetMB
    $pfSetting.Put() | Out-Null
    Write-Host "已设置 pagefile: Initial=${targetMB}MB, Maximum=${targetMB}MB"
} else {
    Write-Host "未找到现有 pagefile 配置，创建新配置..."
    $newPF = [wmiclass]"Win32_PageFileSetting"
    # 默认 C 盘
    $pfPath = "$env:SystemDrive\pagefile.sys"
    # 删除旧的
    Get-WmiObject Win32_PageFileSetting | ForEach-Object { $_.Delete() }
    # 创建新的
    Set-WmiInstance -Class Win32_PageFileSetting -Arguments @{
        Name = $pfPath
        InitialSize = $targetMB
        MaximumSize = $targetMB
    }
}

Write-Host ""
Write-Host "完成。需要重启系统使 pagefile 生效。"
Write-Host "重启后运行: systeminfo | Select-String 'Page File'"
