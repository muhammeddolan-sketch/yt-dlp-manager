$ErrorActionPreference = "Stop"

$projectDir = "c:\Projeler\yt-dlp-manager"
$pngPath = Join-Path $projectDir "public\icon.png"
$icoPath = Join-Path $projectDir "public\icon.ico"

# Convert PNG to ICO
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($pngPath)
$bmp = new-object System.Drawing.Bitmap($img)
$hicon = $bmp.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($hicon)
$fs = [System.IO.File]::Create($icoPath)
$icon.Save($fs)
$fs.Close()
$img.Dispose()
$bmp.Dispose()

# Create Shortcut
$wshShell = New-Object -ComObject WScript.Shell
$desktop = [System.Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop "UniGet.lnk"
$shortcut = $wshShell.CreateShortcut($shortcutPath)

# Point to electron.exe directly so no command window flashes
$targetPath = Join-Path $projectDir "node_modules\electron\dist\electron.exe"
if (-not (Test-Path $targetPath)) {
    # Fallback to npm if electron executable is not found
    $targetPath = "npm.cmd"
    $shortcut.Arguments = "start"
    $shortcut.WindowStyle = 7 # Minimized
} else {
    $shortcut.Arguments = "."
    $shortcut.WindowStyle = 1 # Normal
}

$shortcut.TargetPath = $targetPath
$shortcut.WorkingDirectory = $projectDir
$shortcut.IconLocation = "$icoPath, 0"
$shortcut.Description = "Launch UniGet"
$shortcut.Save()

Write-Host "Shortcut created at: $shortcutPath"
