Set-Location D:\cortex\packages\engine
$output = npx vitest run 2>&1
$output | Out-File -FilePath D:\cortex\test-output\self-examination-soft\vitest-engine-result.txt -Encoding UTF8
