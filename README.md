# Minimize Zotero To Tray

![GitHub release](https://img.shields.io/github/v/release/B3000Kcn/minimize-zotero-to-tray)
![GitHub downloads](https://img.shields.io/github/downloads/B3000Kcn/minimize-zotero-to-tray/total)
![Zotero](https://img.shields.io/badge/Zotero-7-blue)

A Zotero 7 plugin that lets you minimize Zotero to the tray, show/hide it with a single tray icon click or a global hotkey, and, if you want, automatically hide it on startup. Keep your reference manager running quietly in the background without cluttering your taskbar.

## ✨ Core Features

- **Global Hotkey**: Show or hide the Zotero window from anywhere with a customizable global hotkey.
- **Minimize on Close**: Intercepts all standard window close actions (e.g., 'X' button) and minimizes Zotero to the tray instead.
- **Auto-hide on Startup**: Optionally start Zotero silently in the tray, perfect for running on system startup.
- **Single-Click Toggle**: A single click on the tray icon shows or hides the main window.

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

1. **Toggle Visibility**: Use the **global hotkey** you configured or **single-click the tray icon** to show/hide the Zotero window.
2. **Minimize to Tray**: Close Zotero using any standard method (X button, Alt+F4, etc.) - it will minimize to the system tray instead of closing.
3. **Completely Quit**: To fully exit Zotero and its tray helper, use the `File` > `Quit` option from the Zotero menu.

## 🔧 Configuration

All settings can be configured in Zotero via `Edit` > `Preferences` > `Minimize to Tray`.

- **Global Hotkey**:
  - Define your own key combination (e.g., `Ctrl+Alt+K`) to toggle the Zotero window.
- **Auto-hide on Startup**:
  - Enable this to make Zotero start minimized to the tray.
- **Communication Port**:
  - The plugin and its tray icon helper need a local network port to communicate.
  - You can change the default port (`23120`) if it conflicts with another application on your system.
  - **Note**: All settings require a Zotero restart to take effect.

## 🛠️ Technical Details & Architecture

This plugin uses a hybrid architecture to ensure stability on modern Windows systems.

- **Target Platform**: Windows
- **Zotero Version**: 7.0+ 
- **Core Logic**: The main plugin logic is a Bootstrap extension running within Zotero.
- **Tray Icon Helper**: To avoid crashes related to `js-ctypes` on some systems, the system tray icon is managed by a small, pre-compiled external program: `tray_helper.exe`.

### How It Works

The `.xpi` plugin file contains the `tray_helper.exe` executable. When Zotero starts, the plugin extracts this helper program to a temporary directory and runs it. The helper's main jobs are to create the tray icon and register the global hotkey. When you click the icon or press the hotkey, it notifies the main Zotero plugin via a local TCP socket to show or hide the Zotero window.

### ⚠️ Important Note on Zotero Crashes

If Zotero crashes or is terminated abnormally (e.g., via Task Manager), the main plugin does not get a chance to shut down the `tray_helper.exe` process. 

**In this specific scenario, `tray_helper.exe` will become an orphan process.** 

It consumes minimal resources, but you may want to close it manually using the Windows Task Manager. The process will be automatically replaced the next time you start Zotero. Normal Zotero shutdown procedures will clean up the process correctly.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
