param(
    [switch]$SkipCompile
)

# Minimize Zotero To Tray packaging script
$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$rootPath = Split-Path -Parent $PSScriptRoot
$addonPath = Join-Path $rootPath "addon"
$nativePath = Join-Path $rootPath "native"
$manifestPath = Join-Path $addonPath "manifest.json"

if (-not (Test-Path $addonPath)) {
    Write-Host "Error: addon directory not found at $addonPath" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $manifestPath)) {
    Write-Host "Error: manifest.json not found at $manifestPath" -ForegroundColor Red
    exit 1
}

$manifest = Get-Content $manifestPath | ConvertFrom-Json
$pluginName = $manifest.name -replace ' ', '-' -replace '[^a-zA-Z0-9\-]', '' | ForEach-Object { $_.ToLower() }
$pluginVersion = $manifest.version
$outputFileName = "$pluginName-$pluginVersion.xpi"
$outputPath = Join-Path $rootPath $outputFileName
$tempZipPath = Join-Path $rootPath "temp_addon.zip"

Write-Host "Zotero Plugin Build Script" -ForegroundColor Cyan
Write-Host "==========================" -ForegroundColor Cyan
Write-Host "Plugin: $($manifest.name) v$($manifest.version)" -ForegroundColor Green
Write-Host "Output: $outputFileName" -ForegroundColor Green

function Invoke-NativeHelperBuild {
    param(
        [string]$NativeDir,
        [string]$OutputExe
    )

    $cFile = Join-Path $NativeDir "tray_helper.c"
    $rcFile = Join-Path $NativeDir "tray_helper.rc"
    $resFile = Join-Path $NativeDir "tray_helper.res"
    $objFile = Join-Path $NativeDir "tray_helper.obj"

    if (-not (Test-Path $cFile) -or -not (Test-Path $rcFile)) {
        throw "Native helper sources not found in '$NativeDir'."
    }

    $binDir = Split-Path -Parent $OutputExe
    if (-not (Test-Path $binDir)) {
        New-Item -ItemType Directory -Path $binDir -Force | Out-Null
    }

    try {
        $vswhereCandidates = @(
            "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe",
            "${env:ProgramFiles}\Microsoft Visual Studio\Installer\vswhere.exe"
        )
        $vswhere = $vswhereCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

        $vcvars64 = $null
        if ($vswhere) {
            $vsInstall = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
            if ($vsInstall) {
                $candidate = Join-Path $vsInstall "VC\Auxiliary\Build\vcvars64.bat"
                if (Test-Path $candidate) {
                    $vcvars64 = $candidate
                }
            }
        }

        if ($vcvars64) {
            Write-Host "Compiling native tray helper with MSVC..." -ForegroundColor Yellow
            $cmdLine = "`"$vcvars64`" && rc /nologo /i `"$NativeDir`" /fo `"$resFile`" `"$rcFile`" && cl /nologo /W4 /WX /O2 /MT /Fe:`"$OutputExe`" /Fo:`"$objFile`" `"$cFile`" `"$resFile`" user32.lib shell32.lib ws2_32.lib /link /SUBSYSTEM:WINDOWS"
            cmd /c $cmdLine
            if ($LASTEXITCODE -ne 0) {
                throw "MSVC compilation failed with exit code $LASTEXITCODE."
            }
            return
        }

        if ((Get-Command cl -ErrorAction SilentlyContinue) -and (Get-Command rc -ErrorAction SilentlyContinue)) {
            Write-Host "Compiling native tray helper with active MSVC environment..." -ForegroundColor Yellow
            & rc /nologo /i $NativeDir /fo $resFile $rcFile
            if ($LASTEXITCODE -ne 0) { throw "rc.exe failed with exit code $LASTEXITCODE." }
            & cl /nologo /W4 /WX /O2 /MT /Fe:$OutputExe /Fo:$objFile $cFile $resFile user32.lib shell32.lib ws2_32.lib /link /SUBSYSTEM:WINDOWS
            if ($LASTEXITCODE -ne 0) { throw "cl.exe failed with exit code $LASTEXITCODE." }
            return
        }

        $mingwGcc = Get-Command x86_64-w64-mingw32-gcc -ErrorAction SilentlyContinue
        $mingwWindres = Get-Command x86_64-w64-mingw32-windres -ErrorAction SilentlyContinue
        if (-not $mingwGcc) { $mingwGcc = Get-Command gcc -ErrorAction SilentlyContinue }
        if (-not $mingwWindres) { $mingwWindres = Get-Command windres -ErrorAction SilentlyContinue }

        if ($mingwGcc -and $mingwWindres) {
            Write-Host "Compiling native tray helper with MinGW ($($mingwGcc.Name))..." -ForegroundColor Yellow
            & $mingwWindres -I $NativeDir $rcFile -O coff -o $resFile
            if ($LASTEXITCODE -ne 0) { throw "windres failed with exit code $LASTEXITCODE." }
            & $mingwGcc -Wall -Wextra -Werror -O2 -mwindows $cFile $resFile -o $OutputExe -luser32 -lshell32 -lws2_32
            if ($LASTEXITCODE -ne 0) { throw "gcc failed with exit code $LASTEXITCODE." }
            return
        }

        throw "No C compiler found. Install Visual Studio Build Tools (Desktop development with C++) or MinGW-w64, or pass -SkipCompile with a prebuilt '$OutputExe'."
    } finally {
        Remove-Item -ErrorAction SilentlyContinue $resFile, $objFile
    }
}

Write-Host "Verifying required files..." -ForegroundColor Yellow
$requiredFiles = @(
    "manifest.json",
    "bootstrap.js",
    "prefs.js",
    "preferences.xhtml"
)
foreach ($file in $requiredFiles) {
    $filePath = Join-Path $addonPath $file
    if (-not (Test-Path $filePath)) {
        Write-Host "Error: Required file '$file' not found at '$filePath'" -ForegroundColor Red
        exit 1
    }
}

$helperPath = Join-Path (Join-Path $addonPath "bin") "tray_helper.exe"
if (-not $SkipCompile) {
    try {
        Invoke-NativeHelperBuild -NativeDir $nativePath -OutputExe $helperPath
    } catch {
        Write-Host "Error compiling native helper: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
}

if (-not (Test-Path $helperPath)) {
    Write-Host "Error: Required file 'tray_helper.exe' not found at '$helperPath'" -ForegroundColor Red
    exit 1
}

Write-Host "All required files are present." -ForegroundColor Green

Write-Host "Files to be packaged:" -ForegroundColor Yellow
Get-ChildItem -Path $addonPath -Recurse -File | ForEach-Object {
    $relativePath = $_.FullName.Substring($addonPath.Length + 1)
    Write-Host "  $relativePath" -ForegroundColor Gray
}

if (Test-Path $outputPath) {
    Remove-Item $outputPath -Force
    Write-Host "Removed existing XPI file" -ForegroundColor Yellow
}

if (Test-Path $tempZipPath) {
    Remove-Item $tempZipPath -Force
}

try {
    Write-Host "Creating XPI archive..." -ForegroundColor Yellow
    Add-Type -AssemblyName System.IO.Compression.FileSystem

    $zipArchive = [System.IO.Compression.ZipFile]::Open($tempZipPath, 'Create')
    $filesToZip = Get-ChildItem -Path $addonPath -Recurse -File

    foreach ($file in $filesToZip) {
        $relativePath = $file.FullName.Substring($addonPath.Length + 1)
        $entryPath = $relativePath.Replace('\', '/')
        [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zipArchive, $file.FullName, $entryPath)
    }

    $zipArchive.Dispose()
    Move-Item $tempZipPath $outputPath

    Write-Host "Package created successfully: $outputPath" -ForegroundColor Green

    $fileSize = (Get-Item $outputPath).Length
    $fileSizeKB = [math]::Round($fileSize / 1KB, 2)
    Write-Host "File size: $fileSizeKB KB" -ForegroundColor Gray

    Write-Host "Verifying XPI contents..." -ForegroundColor Yellow
    $zip = [System.IO.Compression.ZipFile]::OpenRead($outputPath)
    $zip.Entries | ForEach-Object {
        Write-Host "  $($_.FullName)" -ForegroundColor Gray
    }
    $zip.Dispose()

    Write-Host "Build completed successfully: $outputFileName" -ForegroundColor Cyan
} catch {
    Write-Host "Error during packaging: $($_.Exception.Message)" -ForegroundColor Red
    if (Test-Path $tempZipPath) {
        Remove-Item $tempZipPath -Force
    }
    exit 1
}
