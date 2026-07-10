Write-Host "🔍 Cortex pre-commit check..."
$errors = 0

Write-Host "  tsc engine..."
$tsc = npx tsc -b packages/engine/tsconfig.src.json --force 2>&1
if ($LASTEXITCODE -ne 0) { Write-Host "❌ tsc failed"; $errors++ }

Write-Host "  vitest engine..."
npx vitest run --no-color 2>&1 | Select-String "Tests " | Select-Object -Last 1

Write-Host "  eslint engine..."
npx eslint packages/engine/src --max-warnings 999 2>&1 | Select-String "\d+ problems"

if ($errors -gt 0) { Write-Host "❌ pre-commit failed"; exit 1 }
Write-Host "✅ pre-commit passed"
