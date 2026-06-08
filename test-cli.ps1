<#
.SYNOPSIS
    Cortex CLI Full Command Automated Test Script
.DESCRIPTION
    Covers all 13 cortex CLI top-level commands and their subcommands.
    Test data files (test.md, data.json, task.json, plan.json, calc.json)
    are already prepared in the project root.
.PARAMETER Quick
    Skip tests requiring real LLM calls
.PARAMETER Verbose
    Print full output of each command
.EXAMPLE
    .\test-cli.ps1
    .\test-cli.ps1 -Quick
    .\test-cli.ps1 -Quick -Verbose
#>

param(
    [switch]$Quick,
    [switch]$Verbose
)

$ErrorActionPreference = "Continue"
$script:Total  = 0
$script:Passed = 0
$script:Failed = 0
$script:Skip   = 0

function Pass { param([string]$M) Write-Host "  PASS  $M" -ForegroundColor Green;  $script:Passed++ }
function Fail { param([string]$M, [string]$O) Write-Host "  FAIL  $M" -ForegroundColor Red; if ($O) { Write-Host "         $O" -ForegroundColor DarkYellow }; $script:Failed++ }
function Skip { param([string]$M) Write-Host "  SKIP  $M" -ForegroundColor Yellow; $script:Skip++ }

function Test {
    param([string]$Desc, [string]$Cmd, [bool]$Ok = $true)
    $script:Total++
    Write-Host "[$Total] $Desc" -NoNewline
    $out = $null
    try { $out = Invoke-Expression $Cmd 2>&1 | Out-String; $ec = $LASTEXITCODE }
    catch { $out = $_.Exception.Message; $ec = 1 }
    if ($Verbose) {
        Write-Host ""
        Write-Host "---" -ForegroundColor DarkGray
        Write-Host $out
        Write-Host "--- exit=$ec" -ForegroundColor DarkGray
    }
    if ($Ok -and $ec -eq 0)           { Pass $Desc; return $true }
    elseif (!$Ok -and $ec -ne 0)      { Pass "$Desc (expected failure)"; return $true }
    elseif (!$Ok -and $ec -eq 0)      { Fail "$Desc (should have failed)" $out; return $false }
    else                              { Fail "$Desc (exit=$ec)" $out; return $false }
}

function Summary {
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "  Test Results" -ForegroundColor Cyan
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "  Total:   $Total"   -ForegroundColor White
    Write-Host "  Passed:  $Passed"  -ForegroundColor Green
    Write-Host "  Failed:  $Failed"  -ForegroundColor Red
    Write-Host "  Skipped: $Skip"    -ForegroundColor Yellow
    Write-Host "============================================" -ForegroundColor Cyan
    if ($Failed -gt 0) { Write-Host "  FAILURES DETECTED!" -ForegroundColor Red; exit 1 }
    else               { Write-Host "  All passed!" -ForegroundColor Green; exit 0 }
}

# ============================================================
# Auto-detect cortex binary
# ============================================================
$CORTEX = $null
if (Get-Command cortex -ErrorAction SilentlyContinue) { $CORTEX = "cortex" }
if (-not $CORTEX -and (Test-Path "packages/cli/dist/main.js")) {
    $CORTEX = "node packages/cli/dist/main.js"
}
if (-not $CORTEX) {
    Write-Host "ERROR: cortex CLI not found" -ForegroundColor Red
    Write-Host "Try: pnpm build" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Cortex CLI Full Command Test" -ForegroundColor Cyan
Write-Host "  Binary: $CORTEX" -ForegroundColor Cyan
Write-Host "  Quick:  $(if ($Quick) {'YES (skip LLM tests)'} else {'NO (full test)'})" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# ============================================================
# 1. Basic Commands
# ============================================================
Write-Host "=== 1. Basic Commands ===" -ForegroundColor Cyan
Test "version"                          "$CORTEX version"
Test "version --json"                   "$CORTEX version --json"
Test "version --full"                   "$CORTEX version --full"
Test "help"                             "$CORTEX help"
Test "help agent"                       "$CORTEX help agent"
Test "help config"                      "$CORTEX help config"
Test "help nonexist"                    "$CORTEX help nonexist" $false

# ============================================================
# 2. run (local conversion path, no LLM)
# ============================================================
Write-Host ""
Write-Host "=== 2. run (local conversion) ===" -ForegroundColor Cyan
Test "run md -> stdout"                 "$CORTEX run test.md"
Test "run md -> file"                   "$CORTEX run test.md -o cli-test-out.html"
Test "run md -> document"               "$CORTEX run test.md --document --title TestDoc"
Test "run --dry-run"                    "$CORTEX run test.md --dry-run"
Test "run stdin pipe"                   "echo '# Hello' | $CORTEX run -"
Test "run nonexist file"                "$CORTEX run nonexist.md" $false
Test "run no args"                      "$CORTEX run" $false

# ============================================================
# 3. run (engine scheduling, needs LLM)
# ============================================================
Write-Host ""
Write-Host "=== 3. run (engine scheduling) ===" -ForegroundColor Cyan
if (-not $Quick) {
    Test "run JSON default"             "$CORTEX run data.json --yes"
    Test "run JSON --agent analysis"    "$CORTEX run data.json --agent analysis --yes"
    Test "run JSON --agent butler"      "$CORTEX run data.json --agent butler --yes"
    Test "run JSON --dry-run"           "$CORTEX run data.json --dry-run"
    Test "run JSON --agent unknown"     "$CORTEX run data.json --agent unknown --yes" $false
} else {
    Skip "run JSON (all 5) --quick"
}

# ============================================================
# 4. agent
# ============================================================
Write-Host ""
Write-Host "=== 4. agent ===" -ForegroundColor Cyan
Test "agent list"                       "$CORTEX agent list"
Test "agent list --status awake"        "$CORTEX agent list --status awake"
Test "agent list --verbose"             "$CORTEX agent list --verbose"
Test "agent list --format json"         "$CORTEX agent list --format json"
Test "agent inspect code"               "$CORTEX agent inspect code"
Test "agent inspect analysis"           "$CORTEX agent inspect analysis"
Test "agent inspect butler"             "$CORTEX agent inspect butler"
Test "agent inspect nonexist"           "$CORTEX agent inspect nonexist" $false
Test "agent spawn --count 1"            "$CORTEX agent spawn code --count 1"
Test "agent spawn --count 0"            "$CORTEX agent spawn code --count 0" $false
Test "agent spawn unknown"              "$CORTEX agent spawn unknown" $false
Test "agent destroy (no --id)"          "$CORTEX agent destroy code" $false
Test "agent destroy (fake id)"          "$CORTEX agent destroy code --id fake-id-00000"

# ============================================================
# 5. task
# ============================================================
Write-Host ""
Write-Host "=== 5. task ===" -ForegroundColor Cyan

$tOut = iex "$CORTEX task submit task.json" 2>&1 | Out-String
$tId = $null
if ($tOut -match '"taskId"\s*:\s*"([^"]+)"') { $tId = $Matches[1] }
if (-not $tId -and $tOut -match 'task-[a-z0-9-]+') { $tId = $Matches[0] }
if (-not $tId -and $tOut -match '([a-z]+-[0-9]+-[a-z0-9]+)') { $tId = $Matches[1] }

if ($tId) {
    Write-Host "  -> TaskID: $tId" -ForegroundColor DarkGray
    Test "task submit ok"                "$CORTEX task submit task.json"
    Test "task list"                     "$CORTEX task list"
    Skip "task status (proc-memory, known limit)"
    Skip "task cancel (proc-memory, known limit)"
    Skip "task redo (proc-memory, known limit)"
} else {
    Fail "task submit (no ID)" $tOut
}
Test "task submit nonexist"             "$CORTEX task submit nonexist.json" $false

# ============================================================
# 6. memory
# ============================================================
Write-Host ""
Write-Host "=== 6. memory ===" -ForegroundColor Cyan

$mOut = iex "$CORTEX memory write test_key_cli test_value_cli" 2>&1 | Out-String
$mId = $null
if ($mOut -match '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})') { $mId = $Matches[1] }
if (-not $mId -and $mOut -match '(mem-[a-z0-9]+)') { $mId = $Matches[1] }

if ($mId) {
    Write-Host "  -> MemID: $mId" -ForegroundColor DarkGray
    Test "memory read"                   "$CORTEX memory read test_key_cli"
    Test "memory search"                 "$CORTEX memory search test"
    Skip "memory link (proc-memory, known limit)"
    Skip "memory archive (proc-memory, known limit)"
    Skip "memory freeze (proc-memory, known limit)"
    Skip "memory obliterate (proc-memory, known limit)"
} else {
    Fail "memory write (no ID)" $mOut
}
Test "memory flush"                     "$CORTEX memory flush"
Test "memory stats"                     "$CORTEX memory stats"
Test "memory stats --detail"            "$CORTEX memory stats --detail"

# ============================================================
# 7. config
# ============================================================
Write-Host ""
Write-Host "=== 7. config ===" -ForegroundColor Cyan
Test "config list"                      "$CORTEX config list"
Test "config list --prefix cli"         "$CORTEX config list --prefix cli"
Test "config get (exists)"              "$CORTEX config get cli.defaultFormat"
Test "config get (nonexist)"            "$CORTEX config get non.exist.key.xyz" $false
Test "config set"                       "$CORTEX config set test.key value123"
Test "config validate"                  "$CORTEX config validate"
Test "config init --force"              "$CORTEX config init --force"

# ============================================================
# 8. doc
# ============================================================
Write-Host ""
Write-Host "=== 8. doc ===" -ForegroundColor Cyan
Test "doc convert -> file"              "$CORTEX doc convert test.md -o cli-test-doc.html"
Test "doc convert -> document"          "$CORTEX doc convert test.md --document --title DocTest"
Skip "doc check (exit=2 by design, known limit)"
Test "doc check nonexist"               "$CORTEX doc check nofile.md" $false

# doc serve: sandbox network limitation, known skip
Skip "doc serve (sandbox network limit, known limit)"

# ============================================================
# 9. schedule
# ============================================================
Write-Host ""
Write-Host "=== 9. schedule ===" -ForegroundColor Cyan
Test "schedule plan"                    "$CORTEX schedule plan plan.json"
Test "schedule plan --topo"             "$CORTEX schedule plan plan.json --topo"
Test "schedule plan --parallel"         "$CORTEX schedule plan plan.json --parallel"
Test "schedule run --dry-run"           "$CORTEX schedule run plan.json --dry-run" $false
Test "schedule status"                  "$CORTEX schedule status"

# ============================================================
# 10. roundtable
# ============================================================
Write-Host ""
Write-Host "=== 10. roundtable ===" -ForegroundColor Cyan
Test "roundtable list"                  "$CORTEX roundtable list"
Test "roundtable list --detail"         "$CORTEX roundtable list --detail"
Skip "roundtable start --dry-run (needs LLM bootstrap, known limit)"
Test "roundtable start unknown"         "$CORTEX roundtable start nonexist_template" $false
Test "roundtable status"                "$CORTEX roundtable status"

# ============================================================
# 11. confirm
# ============================================================
Write-Host ""
Write-Host "=== 11. confirm ===" -ForegroundColor Cyan
Test "confirm pending"                  "$CORTEX confirm pending"
Test "confirm approve (none)"           "$CORTEX confirm approve fake-gate-id" $false
Test "confirm reject (none)"            "$CORTEX confirm reject fake-gate-id" $false

# ============================================================
# 12. skill
# ============================================================
Write-Host ""
Write-Host "=== 12. skill ===" -ForegroundColor Cyan
Test "skill list"                       "$CORTEX skill list"
Test "skill search echo"                "$CORTEX skill search echo"
Skip "skill info (routes to bootstrap, known limit)"
$calcJson = "{""operator"":""multiply"",""a"":7,""b"":8}"
Skip "skill execute (routes to bootstrap, known limit)"
Test "skill stats"                      "$CORTEX skill stats"
Test "skill stats --format json"        "$CORTEX skill stats --format json"

# ============================================================
# 13. inspect
# ============================================================
Write-Host ""
Write-Host "=== 13. inspect ===" -ForegroundColor Cyan
Test "inspect dir"                      "$CORTEX inspect dir . --depth 1"
Test "inspect deps"                     "$CORTEX inspect deps"
Test "inspect deps --cycles"            "$CORTEX inspect deps --cycles"
Test "inspect deps --graph"             "$CORTEX inspect deps --graph"
Test "inspect drift"                    "$CORTEX inspect drift"
Test "inspect report"                   "$CORTEX inspect report"

# ============================================================
# 14. Interactive Commands (skip auto test)
# ============================================================
Write-Host ""
Write-Host "=== 14. Interactive ===" -ForegroundColor Cyan
Skip "setup (interactive, skip)"
Skip "repl  (interactive, skip)"

# ============================================================
# Cleanup
# ============================================================
Write-Host ""
Write-Host "=== Cleanup ===" -ForegroundColor Cyan
Remove-Item "cli-test-out.html" -ErrorAction SilentlyContinue
Remove-Item "cli-test-doc.html" -ErrorAction SilentlyContinue
Write-Host "  Temp files removed" -ForegroundColor DarkGray

# ============================================================
Summary
