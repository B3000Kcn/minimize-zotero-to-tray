# Minimize Zotero To Tray

![GitHub release](https://img.shields.io/github/v/release/yourname/minimize-zotero-to-tray)
![GitHub downloads](https://img.shields.io/github/downloads/yourname/minimize-zotero-to-tray/total)
![Zotero](https://img.shields.io/badge/Zotero-7-blue)

A Zotero 7 plugin that minimizes Zotero to the system tray instead of closing it completely. Keep your reference manager running quietly in the background without cluttering your taskbar.

## ✨ Features

- **🎯 Smart Window Management**: Intercepts ALL close methods (X button, taskbar close, task view close)
- **🔍 Intelligent State Detection**: Recognizes 5 different window states for optimal restoration
- **🖱️ Double-Click Restore**: Smart behavior based on actual window state:
  - Hidden by plugin → Restore window
  - Minimized to taskbar → Restore window  
  - Visible but not foreground → Bring to foreground
  - Already visible and foreground → No action
  - Not visible (other reasons) → Make visible
- **🔇 Silent Operation**: No annoying popup notifications
- **💾 State Preservation**: Maintains window maximize state when restoring
- **🛡️ Memory Safe**: Proper resource management and cleanup

## 📦 Installation

### From Zotero Plugin Store
1. Open Zotero 7
2. Go to `Tools` → `Add-ons`
3. Search for "Minimize Zotero To Tray"
4. Click `Install`

### Manual Installation
1. Download the latest `.xpi` file from [Releases](https://github.com/B3000Kcn/minimize-zotero-to-tray/releases)
2. Open Zotero 7
3. Go to `Tools` → `Add-ons`
4. Click the gear icon → `Install Add-on From File`
5. Select the downloaded `.xpi` file

## 🚀 Usage

Once installed, the plugin works automatically:

1. **Minimize to Tray**: Close Zotero using any method (X button, Alt+F4, taskbar, etc.) - it will minimize to system tray instead of closing
2. **Restore from Tray**: Double-click the tray icon to restore Zotero window
3. **Silent Operation**: No popup notifications - clean and unobtrusive

## 🔧 Technical Details & Architecture

This plugin uses a hybrid architecture to ensure stability on modern Windows systems.

- **Target Platform**: Windows
- **Zotero Version**: 7.0+ 
- **Core Logic**: The main plugin logic is a Bootstrap extension running within Zotero.
- **Tray Icon Helper**: To avoid crashes related to `js-ctypes` on some systems, the system tray icon is managed by a small, pre-compiled external program: `tray_helper.exe`.

### How It Works

The `.xpi` plugin file contains the `tray_helper.exe` executable. When Zotero starts, the plugin extracts this helper program to a temporary directory and runs it. The helper's only job is to create the tray icon and listen for clicks. When you click the icon, it notifies the main Zotero plugin via a local TCP socket to show or hide the Zotero window.

### ⚠️ Important Note on Zotero Crashes

If Zotero crashes or is terminated abnormally (e.g., via Task Manager), the main plugin does not get a chance to shut down the `tray_helper.exe` process. 

**In this specific scenario, `tray_helper.exe` will become an orphan process.** 

It consumes minimal resources, but you may want to close it manually using the Windows Task Manager. The process will be automatically replaced the next time you start Zotero. Normal Zotero shutdown procedures will clean up the process correctly.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
