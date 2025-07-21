![Plugin Icon](addon/content/icons/favicon.png)

# Minimize Zotero To Tray

![GitHub release](https://img.shields.io/github/v/release/B3000Kcn/minimize-zotero-to-tray)
![GitHub downloads](https://img.shields.io/github/downloads/B3000Kcn/minimize-zotero-to-tray/total)
![Zotero](https://img.shields.io/badge/Zotero-7-blue)

A Zotero 7 plugin that lets you minimize Zotero to the tray, show/hide it with a single tray icon click or a global hotkey, and, if you want, automatically hide it on startup. Keep your reference manager running quietly in the background without cluttering your taskbar.

## ✨ Core Features

- **Minimize on Close**: Intercepts all standard window close actions (e.g., clicking the 'X' button, closing from the taskbar or task view) and minimizes Zotero to the tray instead.
- **Global Hotkey**: Show or hide the Zotero window from anywhere with a customizable global hotkey.
- **Single-Click Show**: A single click on the tray icon brings the main Zotero window to the foreground.
- **Auto-hide on Startup**: Optionally start Zotero silently in the tray, perfect for running on system startup.

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

1. **Toggle Visibility**: Use the **global hotkey** you configured to show or hide the Zotero window.
2. **Show Window**: **Single-click the tray icon** to bring the Zotero window to the front.
3. **Minimize to Tray**: Close the Zotero window using any standard method (e.g., 'X' button, Alt+F4, from the taskbar, or from the Task View) - it will minimize to the system tray instead of closing.
4. **Completely Quit**: To fully exit Zotero and its tray helper, use the `File` > `Quit` option from the Zotero menu.

## 🔧 Configuration

All settings can be configured in Zotero via `Edit` > `Preferences` > `Minimize to Tray`.

- **Global Hotkey**:
  - Define your own key combination (e.g., `Ctrl+Alt+K`) to toggle (show/hide) the Zotero window.
- **Auto-hide on Startup**:
  - Enable this to make Zotero start minimized to the tray.
- **Communication Port**:
  - The plugin and its tray icon helper need a local network port to communicate.
  - You can change the default port (`23120`) if it conflicts with another application on your system.
  - **Note**: All settings require a Zotero restart to take effect.

## 🚑 Troubleshooting

### Zotero Starts Hidden and Won't Show Up

If you enabled **"Auto-hide on Startup"** and the tray icon/hotkey stops working (e.g., due to a port conflict), you might get "locked out" of the Zotero window. Here's how to fix it by directly editing Zotero's configuration file:

1. Completely quit Zotero. Make sure no `zotero.exe` or `tray_helper.exe` processes are running in the Windows Task Manager.
2. Open the Windows File Explorer.
3. In the address bar, type `%APPDATA%\\Zotero\\Zotero\\Profiles\\` and press Enter.
4. You will see a folder with a random name (e.g., `xxxxxxxx.default`). Open it.
5. Find the file named `prefs.js` and open it with a simple text editor like Notepad.
6. You now have two options to fix the issue:

    **Option A: Disable the Auto-Hide Feature**
    This is a surefire way to make Zotero start visibly again, allowing you to re-configure the plugin from its settings.
    - Search for the line: `user_pref("extensions.zotero-in-tray.startup.autohide", true);`
    - Change `true` to `false`.

    **Option B: Change the Communication Port**
    If you suspect a port conflict is the issue, you can assign a new port.
    - Search for the line containing `extensions.zotero-in-tray.network.port`.
    - Change the port number to a different value, for example: `user_pref("extensions.zotero-in-tray.network.port", 23121);`

7. Save the `prefs.js` file and start Zotero normally. The problem should be resolved.

## 🛠️ Technical Details & Architecture

This plugin uses a hybrid architecture to ensure stability on modern Windows systems.

- **Target Platform**: Windows
- **Zotero Version**: 7.0+ 
- **Core Logic**: The main plugin logic is a Bootstrap extension running within Zotero.
- **Tray Icon Helper**: To avoid crashes related to `js-ctypes` on some systems, the system tray icon is managed by a small, pre-compiled external program: `tray_helper.exe`.

### How It Works

The `.xpi` plugin file contains the `tray_helper.exe` executable. When Zotero starts, the plugin extracts this helper program to a temporary directory and runs it. The helper's main jobs are to create the tray icon and register the global hotkey. When you click the icon or press the hotkey, it notifies the main Zotero plugin via a local TCP socket to perform the appropriate action (show or toggle).

### ⚠️ Important Note on Zotero Crashes

If Zotero crashes or is terminated abnormally (e.g., via Task Manager), the main plugin does not get a chance to shut down the `tray_helper.exe` process. 

**In this specific scenario, `tray_helper.exe` will become an orphan process.** 

It consumes minimal resources, but you may want to close it manually using the Windows Task Manager. The process will be automatically replaced the next time you start Zotero. Normal Zotero shutdown procedures will clean up the process correctly.

## 🔨 Build It Yourself

This plugin, due to its operational methods (e.g., extracting and running an `.exe` file, using global hotkeys), can sometimes be flagged by antivirus software as suspicious. To ensure complete transparency and allow users full control, we provide instructions for building the plugin yourself.

1.  **Download the project**: Clone or download the source code from the GitHub repository.

2.  **Download Ahk2Exe**: Get the `Ahk2Exe` compiler from the official AutoHotkey releases page: [https://github.com/AutoHotkey/Ahk2Exe/releases](https://github.com/AutoHotkey/Ahk2Exe/releases).

3.  **Convert `tray_helper.ahk` to `exe`**:
    *   Locate `tray_helper.ahk` in the project's `bin` folder (`addon/bin/tray_helper.ahk`).
    *   Use `Ahk2Exe` to convert `tray_helper.ahk` into an executable (`.exe`) file.
    *   During this process, `Ahk2Exe` will prompt you for an icon in `.ico` format. You can use the `zotero_128.ico` file found in the same `bin` folder (`addon/bin/zotero_128.ico`), or provide your own custom `.ico` icon.

4.  **Package the plugin**:
    *   Open PowerShell.
    *   Navigate to the project's `scripts` folder (`scripts/`).
    *   Run the `build.ps1` script: `.\build.ps1`
    *   The packaged plugin (`.xpi` file) will be generated in the project's root directory.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
