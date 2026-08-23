@echo off
REM Daily production backup, invoked by Windows Task Scheduler.
REM
REM Exists because backup-production.sh is a bash script and Task Scheduler is
REM not a shell: it runs one executable, with no redirection and no chaining.
REM This wrapper supplies Git Bash, a working directory, and a log.
REM
REM Everything printed goes to backup-daily.log, replaced each run. A one-line
REM pass/fail record is appended to backup-log.tsv, which is the file worth
REM glancing at: a backup that fails quietly is worse than no backup, so a
REM failure is recorded as loudly as a success.

setlocal
set REPO=C:\Projects\SIHL_CRM
set BACKUPS=C:\Projects\SIHL_backups
set BASH=C:\Program Files\Git\bin\bash.exe

if not exist "%BASH%" (
    echo Git Bash not found at %BASH% >> "%BACKUPS%\backup-log.tsv"
    exit /b 1
)

REM Use a copy of the Railway CLI kept beside the backups, not the one in the
REM npm global directory.
REM
REM Under Task Scheduler, bash can list %APPDATA%\npm but sees only a subset of
REM its contents - node_modules, vc, vc.cmd - with every railway entry missing,
REM while an interactive shell in the same account sees them all. Same path,
REM same user, different view. Rather than work out why, the scheduled job
REM depends on a location that is plainly visible to both.
REM
REM Refresh it after upgrading the CLI:
REM   copy "%APPDATA%\npm\node_modules\@railway\cli\bin\railway.exe" "%BACKUPS%\bin\"
set RAILWAY_BIN=%BACKUPS%\bin\railway.exe

if not exist "%RAILWAY_BIN%" (
    powershell -NoProfile -Command ^
      "Add-Content -Path '%BACKUPS%\backup-log.tsv' -Encoding utf8 -Value (\"{0}`tFAILED`trailway.exe missing from %BACKUPS%\bin\" -f (Get-Date -Format o))"
    exit /b 1
)

cd /d "%REPO%"
"%BASH%" -lc "scripts/backup-production.sh" > "%BACKUPS%\backup-daily.log" 2>&1
set RC=%ERRORLEVEL%

if not "%RC%"=="0" (
    REM The script writes its own success line; only failure needs adding here.
    powershell -NoProfile -Command ^
      "Add-Content -Path '%BACKUPS%\backup-log.tsv' -Encoding utf8 -Value (\"{0}`tFAILED`texit {1}`tsee backup-daily.log\" -f (Get-Date -Format o), %RC%)"
)

exit /b %RC%
