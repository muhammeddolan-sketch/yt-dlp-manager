$ErrorActionPreference = "Stop"

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pngPath    = Join-Path $projectDir "public\icon.png"
$icoPath    = Join-Path $projectDir "public\icon.ico"
$launcher   = Join-Path $projectDir "launcher.bat"

# ─── PNG → ICO ───────────────────────────────────────────────────
if (Test-Path $pngPath) {
    try {
        Add-Type -AssemblyName System.Drawing
        $img   = [System.Drawing.Image]::FromFile($pngPath)
        $bmp   = New-Object System.Drawing.Bitmap($img)
        $hicon = $bmp.GetHicon()
        $icon  = [System.Drawing.Icon]::FromHandle($hicon)
        $fs    = [System.IO.File]::Create($icoPath)
        $icon.Save($fs)
        $fs.Close()
        $img.Dispose(); $bmp.Dispose()
        Write-Host "ICO olusturuldu."
    } catch {
        Write-Warning "ICO olusturulamadi: $_"
    }
}

# ─── Kısayol oluştur ─────────────────────────────────────────────
$wshShell = New-Object -ComObject WScript.Shell

function Make-Shortcut($path) {
    $sc = $wshShell.CreateShortcut($path)
    # Doğrudan .bat dosyasını hedef al — cmd penceresi açılmaz
    $sc.TargetPath       = $launcher
    $sc.WorkingDirectory = $projectDir
    $sc.WindowStyle      = 7          # minimized = konsol görünmez
    $sc.Description      = "UniGet - YouTube Downloader"
    if (Test-Path $icoPath) {
        $sc.IconLocation = "$icoPath, 0"
    }
    $sc.Save()
}

# Masaüstü
$desktop = [System.Environment]::GetFolderPath('Desktop')
$lnk     = Join-Path $desktop "UniGet.lnk"
Make-Shortcut $lnk
Write-Host "Masaustu kisayolu: $lnk"

# Başlat Menüsü
try {
    $startMenu = Join-Path ([System.Environment]::GetFolderPath('StartMenu')) "Programs"
    Make-Shortcut (Join-Path $startMenu "UniGet.lnk")
    Write-Host "Baslat menusu kisayolu olusturuldu."
} catch {
    Write-Warning "Baslat menusu: $_"
}

Write-Host ""
Write-Host "Tamamlandi! Masaustundeki UniGet ikonuna cift tiklayin."
