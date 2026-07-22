$pkgs = @('shared','config','resilience','llm','scheduler','engine','cli')
foreach ($p in $pkgs) {
    $d = "D:\cortex\packages\$p\dist"
    if (Test-Path $d) {
        $c = (Get-ChildItem $d -Recurse -File | Measure-Object).Count
        Write-Output "$p : dist exists ($c files)"
    } else {
        Write-Output "$p : NO dist"
    }
}
