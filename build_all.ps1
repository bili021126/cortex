Set-Location D:\cortex
$packages = @('shared','config','resilience','llm','scheduler','engine','cli')
$overall = 0
foreach ($pkg in $packages) {
    if ($pkg -eq 'cli') {
        $args = @('tsc','--noEmit','--project',"packages/$pkg/tsconfig.json")
    } else {
        $args = @('tsc','--project',"packages/$pkg/tsconfig.json")
    }
    Write-Output "=== BUILD $pkg ==="
    $output = & npx @args 2>&1
    $code = $LASTEXITCODE
    if ($output) { $output | ForEach-Object { Write-Output $_ } }
    Write-Output "=== EXIT $pkg = $code ==="
    if ($code -ne 0) { $overall = 1 }
}
Write-Output "=== OVERALL_EXIT = $overall ==="
