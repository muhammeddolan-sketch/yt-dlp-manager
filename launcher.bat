@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

:: ─── UniGet Launcher ─────────────────────────────────────────────
:: Başlatmadan önce yt-dlp'yi günceller, sonra uygulamayı açar.
:: ─────────────────────────────────────────────────────────────────

set "APPDATA_DIR=%APPDATA%\uniget"
set "BIN_DIR=%APPDATA_DIR%\bin"
set "YTDLP=%BIN_DIR%\yt-dlp.exe"
set "ELECTRON=%~dp0node_modules\electron\dist\electron.exe"
set "UPDATE_FLAG=%APPDATA_DIR%\last_update.txt"

:: Bin klasörü yoksa oluştur
if not exist "%BIN_DIR%" mkdir "%BIN_DIR%"

:: ─── Bugünün tarihini ISO formatında al (locale bağımsız) ─────────
for /f "tokens=*" %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "TODAY=%%i"

:: ─── Güncelleme kontrolü (günde bir kez) ─────────────────────────
set "SHOULD_UPDATE=0"

if not exist "%YTDLP%" (
    set "SHOULD_UPDATE=1"
    echo [UniGet] yt-dlp bulunamadi, indiriliyor...
) else (
    if not exist "%UPDATE_FLAG%" (
        set "SHOULD_UPDATE=1"
    ) else (
        set /p LAST_UPDATE=<"%UPDATE_FLAG%"
        set "LAST_UPDATE=!LAST_UPDATE: =!"
        if "!LAST_UPDATE!" NEQ "!TODAY!" set "SHOULD_UPDATE=1"
    )
)

if "!SHOULD_UPDATE!"=="1" (
    echo [UniGet] yt-dlp guncelleniyor...
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
        "try { $url='https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'; $dest='%YTDLP:\=\\%'; Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing; Write-Host '[UniGet] yt-dlp guncellendi.' } catch { Write-Host '[UniGet] Guncelleme basarisiz, mevcut surum kullanilacak.' }"
    :: Güncelleme tarihini kaydet
    echo !TODAY!> "%UPDATE_FLAG%"
) else (
    echo [UniGet] yt-dlp guncel ^(!TODAY!^).
)

:: ─── Uygulamayı başlat ───────────────────────────────────────────
if not exist "%ELECTRON%" (
    echo [HATA] Electron bulunamadi: %ELECTRON%
    echo Lutfen 'npm install' calistirin.
    pause
    exit /b 1
)

echo [UniGet] Uygulama baslatiliyor...
start "" "%ELECTRON%" %~dp0
exit /b 0
