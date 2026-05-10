@echo off
cd /d D:\cortex\packages\engine
npx vitest run --reporter=verbose > D:\cortex\test-output\self-examination-soft\vitest-output.txt 2>&1
exit /b %ERRORLEVEL%
