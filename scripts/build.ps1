# Minimize Zotero To Tray Final Packaging Script
# Prepared for the simplified addon directory

# Set encoding to UTF-8
$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Define paths
$rootPath = Split-Path -Parent $PSScriptRoot
$addonPath = Join-Path $rootPath "addon"
$manifestPath = Join-Path $addonPath "manifest.json"

# Read manifest.json to get plugin name and version
$manifest = Get-Content $manifestPath | ConvertFrom-Json
$pluginName = $manifest.name -replace ' ', '-' -replace '[^a-zA-Z0-9\-]', '' | ForEach-Object { $_.ToLower() }
$pluginVersion = $manifest.version
$outputFileName = "$pluginName-$pluginVersion.xpi"
$outputPath = Join-Path $rootPath $outputFileName
$tempZipPath = Join-Path $rootPath "temp_addon.zip"

Write-Host "Zotero Plugin Build Script" -ForegroundColor Cyan
Write-Host "==========================" -ForegroundColor Cyan

# Check if addon directory exists
if (-not (Test-Path $addonPath)) {
    Write-Host "Error: addon directory not found at $addonPath" -ForegroundColor Red
    exit 1
}

# Check if manifest.json exists
if (-not (Test-Path $manifestPath)) {
    Write-Host "Error: manifest.json not found at $manifestPath" -ForegroundColor Red
    exit 1
}

Write-Host "Plugin: $($manifest.name) v$($manifest.version)" -ForegroundColor Green
Write-Host "Output: $outputFileName" -ForegroundColor Green

# Check for required files
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

# Separately check for tray_helper.exe
$helperPath = Join-Path -Path (Join-Path -Path $addonPath -ChildPath "bin") -ChildPath "tray_helper.exe"
if (-not (Test-Path $helperPath)) {
    Write-Host "Error: Required file 'tray_helper.exe' not found in 'bin' directory." -ForegroundColor Red
    Write-Host "Path checked: $helperPath" -ForegroundColor Red
    Write-Host "Hint: Please compile 'tray_helper.ahk' to 'tray_helper.exe' and place it in the '$addonPath\bin' directory before building." -ForegroundColor Yellow
    exit 1
}

Write-Host "✓ All required files are present." -ForegroundColor Green

Write-Host "Checking addon directory structure..." -ForegroundColor Yellow
Write-Host "Addon path: $addonPath" -ForegroundColor Gray

# Display files to be packaged
Write-Host "Files to be packaged:" -ForegroundColor Yellow
Get-ChildItem -Path $addonPath -Recurse | ForEach-Object {
    $relativePath = $_.FullName.Substring($addonPath.Length + 1)
    Write-Host "  $relativePath" -ForegroundColor Gray
}

# Delete old output file
if (Test-Path $outputPath) {
    Remove-Item $outputPath -Force
    Write-Host "Removed existing XPI file" -ForegroundColor Yellow
}

if (Test-Path $tempZipPath) {
    Remove-Item $tempZipPath -Force
}

try {
    Write-Host "Creating ZIP archive with preserved directory structure..." -ForegroundColor Yellow
    
    # --- Packaging logic with preserved directory structure ---
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    
    $zipArchive = [System.IO.Compression.ZipFile]::Open($tempZipPath, 'Create')
    
    $filesToZip = Get-ChildItem -Path $addonPath -Recurse -File
    
    foreach ($file in $filesToZip) {
        # Get path relative to addon directory (e.g., "bin\tray_helper.exe")
        $relativePath = $file.FullName.Substring($addonPath.Length + 1)
        
        # [Critical Fix] Convert path separators to Zotero/XPI compatible forward slashes "/"
        $entryPath = $relativePath.Replace('\', '/')
        
        # Create entry in zip with the same relative path
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zipArchive, $file.FullName, $entryPath)
    }
    
    $zipArchive.Dispose()
    # --- End of logic ---
    
    # Rename to XPI
    Move-Item $tempZipPath $outputPath
    
    Write-Host "Package created successfully!" -ForegroundColor Green
    Write-Host "Output file: $outputPath" -ForegroundColor Green
    
    # Display file size
    $fileSize = (Get-Item $outputPath).Length
    $fileSizeKB = [math]::Round($fileSize / 1KB, 2)
    Write-Host "File size: $fileSizeKB KB" -ForegroundColor Gray
    
    # Verify XPI file contents
    Write-Host "Verifying XPI contents..." -ForegroundColor Yellow
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($outputPath)
    $zip.Entries | ForEach-Object {
        Write-Host "  $($_.Name)" -ForegroundColor Gray
    }
    $zip.Dispose()
    
    Write-Host "Build completed successfully!" -ForegroundColor Green
    Write-Host "XPI file ready for installation: $outputFileName" -ForegroundColor Cyan
    
} catch {
    Write-Host "Error during build process: $($_.Exception.Message)" -ForegroundColor Red
    
    # Clean up temporary files
    if (Test-Path $tempZipPath) {
        Remove-Item $tempZipPath -Force
    }
    
    exit 1
}

Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "Build process completed!" -ForegroundColor Cyan