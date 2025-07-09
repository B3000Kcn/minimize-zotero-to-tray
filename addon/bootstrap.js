// Zotero-in-Tray with TCP Helper Process
// This version uses an external AutoHotkey executable for the tray icon
// to avoid js-ctypes crashes on Windows 11. Communication is via TCP sockets.

var ZoteroInTray = {
    // Plugin metadata
    id: null,
    version: null,
    rootURI: null,
    
    // Logging function, initialized immediately.
    log: (msg) => {
        if (typeof Zotero !== 'undefined' && Zotero.debug) {
            Zotero.debug(`ZoteroInTray: ${msg}`);
        } else {
            console.log(`ZoteroInTray: ${msg}`);
        }
    },

    // For TCP Server
    serverSocket: null,
    
    // Window Management
    mainWindow: null,
    mainWindowHandle: null,
    lockedWindows: new Map(),
    isWindowHidden: false,
    windowWasMaximized: false, // Reverted to simple boolean logic
    isActuallyQuitting: false,
    initialHidePerformed: false,
    hidePollingInterval: null,
    
    // Helper Process
    helperProcess: null,
    helperExeName: 'tray_helper.exe',
    helperPath: null,
    isShuttingDown: false,
    relaunchDelay: 2000, // ms
    prefObserver: null,
    
    // Windows API
    user32: null,
    kernel32: null,
    ctypes: null,
    
    // WinAPI Constants
    constants: {
        SW_HIDE: 0,
        SW_RESTORE: 9,
        SW_MAXIMIZE: 3,
        SW_MINIMIZE: 6,
    },

    // Mozilla Components
    Cc: null,
    Ci: null,
    prefPane: null,

    init: function({ id, version, rootURI }) {
        this.id = id;
        this.version = version;
        this.rootURI = rootURI;
        
        // Reset state for re-enabling plugin without Zotero restart
        this.isShuttingDown = false;
        this.initialHidePerformed = false;
        
        try {
            // Define core components
            this.Cc = Components.classes;
            this.Ci = Components.interfaces;

            // Import only ctypes, which is known to be safe
            const { ctypes } = ChromeUtils.import("resource://gre/modules/ctypes.jsm");
            this.ctypes = ctypes;

        } catch (e) {
            this.log(`FATAL: Failed to import critical JSMs: ${e}`);
            return; // Abort initialization
        }

        this.log('🚀 Initializing Zotero-in-Tray (TCP Architecture)...');
        
        this.initWinAPI();
        this.startServer();
        this.registerPrefObserver();
        this.registerPreferences();
        this.launchHelper();
        this.setupDualInterceptForExistingWindows();
        
        this.log("✓ Initialization complete.");
    },

    initWinAPI: function() {
        if (!this.ctypes) {
            this.log("✗ ctypes not available");
            return;
        }
        try {
            this.log("Initializing Windows API libraries...");
            this.user32 = this.ctypes.open("user32.dll");
            this.kernel32 = this.ctypes.open("kernel32.dll");
            this.log("✓ Windows API libraries loaded.");
            this.declareWinAPIFunctions();
        } catch (e) {
            this.log("✗ Error initializing Windows API: " + e);
        }
    },
    
    startServer: function() {
        try {
            const port = Zotero.Prefs.get('extensions.zotero-in-tray.network.port', true);
            this.log(`Attempting to start server on port: ${port} (Type: ${typeof port})`);

            if (!port || isNaN(port)) {
                this.log(`✗ Invalid port number: '${port}'. Aborting server start.`);
                return;
            }

            this.serverSocket = this.Cc["@mozilla.org/network/server-socket;1"]
                .createInstance(this.Ci.nsIServerSocket);
            
            const listener = {
                onSocketAccepted: (socket, transport) => {
                    this.log("TCP Server: Connection accepted.");
                    this.handleConnection(socket, transport.openInputStream(0, 0, 0), transport.openOutputStream(0, 0, 0));
                }
            };
            this.serverSocket.init(Number(port), true, -1);
            this.serverSocket.asyncListen(listener);
            this.log(`✓ Server listening on port ${port}`);
        } catch(e) {
            this.log(`✗ Error starting server: ${e}`);
            if (typeof Zotero !== 'undefined') Zotero.logError(e);
        }
    },

    declareWinAPIFunctions: function() {
        try {
            this.user32.FindWindowW = this.user32.declare("FindWindowW", this.ctypes.winapi_abi, this.ctypes.voidptr_t, this.ctypes.char16_t.ptr, this.ctypes.char16_t.ptr);
            this.user32.ShowWindow = this.user32.declare("ShowWindow", this.ctypes.winapi_abi, this.ctypes.bool, this.ctypes.voidptr_t, this.ctypes.int);
            this.user32.SetForegroundWindow = this.user32.declare("SetForegroundWindow", this.ctypes.winapi_abi, this.ctypes.bool, this.ctypes.voidptr_t);
            this.user32.IsWindowVisible = this.user32.declare("IsWindowVisible", this.ctypes.winapi_abi, this.ctypes.bool, this.ctypes.voidptr_t);
            this.user32.IsZoomed = this.user32.declare("IsZoomed", this.ctypes.winapi_abi, this.ctypes.bool, this.ctypes.voidptr_t);
            this.user32.GetForegroundWindow = this.user32.declare("GetForegroundWindow", this.ctypes.winapi_abi, this.ctypes.voidptr_t);
            this.user32.IsIconic = this.user32.declare("IsIconic", this.ctypes.winapi_abi, this.ctypes.bool, this.ctypes.voidptr_t);
            
            // New functions for robust focus handling
            this.kernel32.GetCurrentThreadId = this.kernel32.declare("GetCurrentThreadId", this.ctypes.winapi_abi, this.ctypes.uint32_t);
            this.user32.GetWindowThreadProcessId = this.user32.declare("GetWindowThreadProcessId", this.ctypes.winapi_abi, this.ctypes.uint32_t, this.ctypes.voidptr_t, this.ctypes.voidptr_t);
            this.user32.AttachThreadInput = this.user32.declare("AttachThreadInput", this.ctypes.winapi_abi, this.ctypes.bool, this.ctypes.uint32_t, this.ctypes.uint32_t, this.ctypes.bool);

            this.log("✓ Windows API functions declared.");
        } catch (e) {
            this.log("✗ Error declaring Windows API functions: " + e);
            throw e;
        }
    },

    getHotkeyArgs: function() {
        const args = [];
        try {
            const useCtrl = Zotero.Prefs.get('extensions.zotero-in-tray.hotkey.ctrl', true);
            const useAlt = Zotero.Prefs.get('extensions.zotero-in-tray.hotkey.alt', true);
            const useShift = Zotero.Prefs.get('extensions.zotero-in-tray.hotkey.shift', true);
            const key = Zotero.Prefs.get('extensions.zotero-in-tray.hotkey.key', true);
            const port = Zotero.Prefs.get('extensions.zotero-in-tray.network.port', true);
            this.log(`Read port for helper args: ${port}`);

            if (useCtrl) args.push('--ctrl');
            if (useAlt) args.push('--alt');
            if (useShift) args.push('--shift');
            
            if (key && /^[a-zA-Z0-9]$/.test(key)) {
                args.push(`--key=${key.toUpperCase()}`);
            } else if (key) {
                this.log(`✗ Invalid hotkey character specified: "${key}". Ignoring.`);
            }

            if (port && !isNaN(port)) {
                 args.push(`--port=${port}`);
            } else {
                 this.log(`✗ Invalid or missing port for helper. Using helper's default.`);
            }
        } catch (e) {
            this.log(`✗ Error reading preferences for helper: ${e}`);
        }
        return args;
    },

    launchHelper: function() {
        if (this.isShuttingDown) {
            this.log("Shutdown in progress, aborting helper launch.");
                 return;
            }
        this.log("🚀 Launching helper process...");
        try {
            const jarPath = this.rootURI.substring(this.rootURI.startsWith("jar:") ? 4 : 0, this.rootURI.indexOf('!'));
            const fileHandler = this.Cc["@mozilla.org/network/protocol;1?name=file"].getService(this.Ci.nsIFileProtocolHandler);
            const xpiFile = fileHandler.getFileFromURLSpec(jarPath);
            
            const zr = this.Cc["@mozilla.org/libjar/zip-reader;1"].createInstance(this.Ci.nsIZipReader);
            zr.open(xpiFile);
            
            const entryPath = "bin/" + this.helperExeName;
            if (!zr.hasEntry(entryPath)) {
                zr.close();
                throw new Error(`Helper executable not found in XPI at path: ${entryPath}`);
            }
            const inputStream = zr.getInputStream(entryPath);

            const binaryInputStream = this.Cc["@mozilla.org/binaryinputstream;1"].createInstance(this.Ci.nsIBinaryInputStream);
            binaryInputStream.setInputStream(inputStream);
            const bytes = binaryInputStream.readBytes(binaryInputStream.available());
            zr.close();

            const dirService = this.Cc['@mozilla.org/file/directory_service;1'].getService(this.Ci.nsIDirectoryService);
            const tmpDir = dirService.get("TmpD", this.Ci.nsIFile);

            const helperFile = tmpDir.clone();
            helperFile.append(this.helperExeName);
            this.helperPath = helperFile.path;

            const ostream = this.Cc["@mozilla.org/network/file-output-stream;1"].createInstance(this.Ci.nsIFileOutputStream);
            ostream.init(helperFile, 0x02 | 0x08 | 0x20, 0o755, 0);
            ostream.write(bytes, bytes.length);
            ostream.close();
            this.log(`✓ Helper extracted to: ${this.helperPath}`);

            const process = this.Cc["@mozilla.org/process/util;1"].createInstance(this.Ci.nsIProcess);
            process.init(helperFile);
            
            const args = this.getHotkeyArgs();
            this.log(`🚀 Running helper with args: ${args.join(' ')}`);
            process.runAsync(args, args.length, (subject, topic, data) => {
                if (topic === "process-finished" || topic === "process-failed") {
                    this.log(`Helper process terminated (topic: ${topic}). Exit code: ${data}`);
                    this.helperProcess = null;
                    if (!this.isShuttingDown) {
                        this.log(`🤔 Helper process terminated unexpectedly. Restarting in ${this.relaunchDelay / 1000}s...`);
                        setTimeout(() => {
                            this.log("Attempting to relaunch helper process...");
                            this.launchHelper();
                        }, this.relaunchDelay);
                    }
                }
            });
            this.helperProcess = process;

            try {
                const shouldAutoHide = Zotero.Prefs.get('extensions.zotero-in-tray.startup.autohide', true);
                if (shouldAutoHide && !this.initialHidePerformed) {
                    this.log('🚀 Auto-hide is enabled. Starting to poll for main window...');
                    if (this.hidePollingInterval) clearInterval(this.hidePollingInterval);
                    
                    this.hidePollingInterval = setInterval(() => {
                        this.tryHideWindowOnStartup();
                    }, 250);

                    setTimeout(() => {
                        if (this.hidePollingInterval) {
                            clearInterval(this.hidePollingInterval);
                            this.hidePollingInterval = null;
                            this.log('✗ Polling for window handle timed out after 15s.');
                        }
                    }, 15000);
                }
            } catch(e) {
                this.log(`✗ Error starting auto-hide poller: ${e}`);
            }

        } catch (e) {
            this.log("✗ Error launching helper process: " + e);
            if (typeof Zotero !== 'undefined') Zotero.logError(e);
        }
    },

    registerPreferences: function() {
        this.log("Registering preferences pane...");
        this.prefPane = Zotero.PreferencePanes.register({
            pluginID: this.id,
            paneID: 'zotero-in-tray-prefs',
            label: 'Minimize to Tray',
            src: this.rootURI + 'preferences.xhtml',
        });
        this.log("✓ Preferences pane registered.");
    },

    registerPrefObserver: function() {
        this.log("Registering preference observer...");
        
        this.prefObserver = (branch, name) => {
            if (name.startsWith('extensions.zotero-in-tray.')) {
                this.log(`Preference changed: ${name}. Restarting helper process.`);
                if (this.helperProcess) {
                    this.helperProcess.kill(); 
                } else {
                    this.log("Helper process was not running, launching it now.");
                    this.launchHelper();
                }
            }
        };
        
        Zotero.Prefs.registerObserver('extensions.zotero-in-tray.', this.prefObserver);
        this.log("✓ Preference observer registered.");
    },

    handleConnection: function(socket, inputStream, outputStream) {
        this.log('✓ Client connection accepted. Setting up data pump...');
        try {
            const pump = this.Cc['@mozilla.org/network/input-stream-pump;1'].createInstance(this.Ci.nsIInputStreamPump);
            pump.init(inputStream, -1, -1, true);
            
            const listener = {
                onStartRequest: (request) => { this.log('Pump: onStartRequest'); },
                onStopRequest: (request, statusCode) => { this.log(`Pump: onStopRequest. Status: ${statusCode}`); },
                onDataAvailable: (request, stream, offset, count) => {
                    try {
                        const scriptableStream = this.Cc['@mozilla.org/scriptableinputstream;1'].createInstance(this.Ci.nsIScriptableInputStream);
                        scriptableStream.init(stream);
                        const data = scriptableStream.read(count);
                        this.log(`📥 Received command: ${data}`);
                        
                        if (data.trim() === 'CLICKED') {
                             const threadManager = this.Cc["@mozilla.org/thread-manager;1"].getService(this.Ci.nsIThreadManager);
                             threadManager.mainThread.dispatch(() => {
                                this.handleTrayClick();
                            }, this.Ci.nsIThread.DISPATCH_NORMAL);
                        }
                    } catch (e) {
                         this.log(`✗ Error in onDataAvailable: ${e}`);
                    }
                }
            };

            pump.asyncRead(listener, null);
            this.log('✓ Pump configured and asyncRead called.');
            
        } catch (e) {
            this.log(`✗ Error setting up pump: ${e}`);
        }
    },

    getMainWindowHandle: function() {
        // If we already have a valid handle, do nothing.
        if (this.mainWindowHandle && !this.mainWindowHandle.isNull()) {
            return true;
        }

        // --- Primary Method: Get handle directly from Zotero's window object ---
        // This is the most reliable way to get the correct handle.
        if (this.mainWindow) {
            try {
                // nsIWebBrowserChrome.getNativeWindowHandle() returns a native pointer
                const handlePtr = this.mainWindow.getNativeWindowHandle();
                if (handlePtr && !handlePtr.isNull()) {
                    this.mainWindowHandle = handlePtr;
                    this.log("✓ Found main window handle via getNativeWindowHandle(): " + this.mainWindowHandle.toString());
                    return true;
                }
            } catch (e) {
                this.log(`✗ Failed to get window handle via getNativeWindowHandle(). Error: ${e}`);
            }
        }
        
        this.log('🤔 Could not get handle from window object, falling back to FindWindowW...');

        // --- Fallback Method: Find window by class name (less reliable) ---
        // This is kept as a fallback but is prone to grabbing the wrong window (e.g., Firefox).
        try {
            const windowClasses = ["MozillaWindowClass", "MozillaDialogClass"];
            for (const className of windowClasses) {
                const handle = this.user32.FindWindowW(this.ctypes.char16_t.array()(className), null);
                if (handle && !handle.isNull()) {
                    this.mainWindowHandle = handle;
                    this.log("✓ Found main window handle via FindWindowW() fallback: " + this.mainWindowHandle.toString());
                    return true;
                }
            }
            this.log("✗ Fallback failed. Could not find main window handle.");
            return false;
        } catch (e) {
            this.log("✗ Error during fallback window search: " + e);
            return false;
        }
    },

    setupDualInterceptForExistingWindows: function() {
        this.log("🔥 Setting up DUAL INTERCEPT for existing windows...");
        let mainWindows = Zotero.getMainWindows();
        for (let window of mainWindows) {
            this.lockWindow(window);
        }
        if (mainWindows.length > 0) {
            this.mainWindow = mainWindows[0];
            this.getMainWindowHandle();
            this.log(`✓ DUAL INTERCEPT set up for ${mainWindows.length} windows`);
        } else {
            this.log("No existing windows found, will wait for onMainWindowLoad");
        }
    },

    lockWindow: function(window) {
        if (!window || this.lockedWindows.has(window)) return;
        this.log("🔒 Locking window: " + window.location.href);

        try {
            let self = this;
            let originalClose = window.close;
            let closeEventHandler = function(event) {
                if (self.isActuallyQuitting) return;
                self.log("🔥🔥 CLOSE EVENT intercepted! Hiding window.");
                event.preventDefault();
                event.stopPropagation();
                self.onWindowClosing(window);
            };

            window.close = function() {
                if (self.isActuallyQuitting) {
                    originalClose.call(this);
                    return;
                }
                self.log("🔥🔥 WINDOW.CLOSE() intercepted! Hiding window.");
                self.onWindowClosing(window);
            };

            window.addEventListener("close", closeEventHandler, false);
            this.lockedWindows.set(window, { closeEventHandler, originalClose });
            this.log("✓ Window locked with dual intercept");
        } catch (e) {
            this.log("✗ Failed to lock window: " + e);
        }
    },

    unlockWindow: function(window) {
        if (!window || !this.lockedWindows.has(window)) return;
        try {
            this.log("🔓 Unlocking window: " + window.location.href);
            let lockInfo = this.lockedWindows.get(window);
            window.removeEventListener("close", lockInfo.closeEventHandler, false);
            window.close = lockInfo.originalClose;
            this.lockedWindows.delete(window);
            this.log("✓ Window unlocked");
        } catch (e) {
            this.log("✗ Failed to unlock window: " + e);
        }
    },

    onWindowClosing: function(window) {
        this.hideMainWindow();
    },
    
    handleTrayClick: function() {
        this.log('🖱️ Tray icon/hotkey handled.');
        try {
            if (!this.getMainWindowHandle()) {
                this.log("✗ Could not get main window handle for tray click.");
                return;
            }

            const isVisible = this.user32.IsWindowVisible(this.mainWindowHandle);
            const isIconic = this.user32.IsIconic(this.mainWindowHandle);
            const isForeground = this.user32.GetForegroundWindow().toString() === this.mainWindowHandle.toString();

            this.log(`Window state: isVisible=${isVisible}, isIconic=${isIconic}, isForeground=${isForeground}`);
    
            if (isIconic) {
                // Case 1: Window is minimized to the taskbar. Restore it intelligently.
                this.log("🔄 Window is minimized, restoring...");
                this.showMainWindow({ forceRestore: true });
            } else if (!isVisible) {
                // Case 2: Window was hidden by us. Restore using the saved state.
                this.log("🔄 Window is hidden by plugin, showing...");
                this.showMainWindow({ forceRestore: false });
            } else {
                // Case 3: Window is visible and not minimized.
                if (isForeground) {
                    // Subcase 3a: It's in the foreground. Hide it.
                    this.log("🔄 Window is visible and foreground, hiding...");
                    this.hideMainWindow();
                } else {
                    // Subcase 3b: It's in the background. Bring it to the front.
                    this.log("🔄 Window is visible but background, bringing to front...");
                    this.bringToFront();
                }
            }
        } catch (e) {
            this.log(`✗ Error in handleTrayClick: ${e}`);
        }
    },

    hideMainWindow: function() {
        if (!this.getMainWindowHandle()) return;
        try {
            // This is the crucial part: we check and save the maximized state
            // *right before* we hide the window.
            this.windowWasMaximized = this.user32.IsZoomed(this.mainWindowHandle);
            this.log(`Hiding main window. Maximized state saved: ${this.windowWasMaximized}`);
            this.user32.ShowWindow(this.mainWindowHandle, this.constants.SW_HIDE);
            this.isWindowHidden = true;
        } catch (e) {
            this.log("✗ Error hiding main window: " + e);
        }
    },

    bringToFront: function() {
        if (!this.getMainWindowHandle()) {
            this.log('✗ No main window handle to bring to front.');
            return;
        }

        try {
            this.log('🖥️ Bringing window to front without changing state...');
            
            const hForegroundWnd = this.user32.GetForegroundWindow();
            const dwCurrentThreadId = this.kernel32.GetCurrentThreadId();
            const dwForegroundThreadId = this.user32.GetWindowThreadProcessId(hForegroundWnd, null);

            this.user32.AttachThreadInput(dwCurrentThreadId, dwForegroundThreadId, true);
            
            // Just set it as foreground. Don't use ShowWindow, as that could
            // change the maximized/restored state incorrectly.
            this.user32.SetForegroundWindow(this.mainWindowHandle);
            
            this.user32.AttachThreadInput(dwCurrentThreadId, dwForegroundThreadId, false);

            this.log('✓ Main window brought to front.');
        } catch (e) {
            this.log(`✗ Error bringing window to front: ${e}`);
        }
    },

    showMainWindow: function({ forceRestore = false } = {}) {
        if (!this.getMainWindowHandle()) {
            this.log('✗ No main window handle to show.');
            return;
        }

        try {
            // If restoring from a minimized state (isIconic was true), we must use SW_RESTORE.
            // SW_RESTORE correctly restores a window to its previous state (maximized or normal).
            // Otherwise, restore based on the last saved value when we hid the window.
            const state = (forceRestore || !this.windowWasMaximized)
                ? this.constants.SW_RESTORE
                : this.constants.SW_MAXIMIZE;

            const stateName = state === this.constants.SW_MAXIMIZE ? 'Maximize' : 'Restore';
            this.log(`🖥️ Activating main window. ForceRestore=${forceRestore}. Final State: ${stateName} (${state})`);
    
            const hForegroundWnd = this.user32.GetForegroundWindow();
            const dwForegroundThreadId = this.user32.GetWindowThreadProcessId(hForegroundWnd, null);
            const dwCurrentThreadId = this.kernel32.GetCurrentThreadId();
    
            // Attach our thread's input processing to the foreground window's thread
            this.user32.AttachThreadInput(dwCurrentThreadId, dwForegroundThreadId, true);
            
            // Show the window in its correct state (maximized or restored)
            this.user32.ShowWindow(this.mainWindowHandle, state);
            this.user32.SetForegroundWindow(this.mainWindowHandle);

            // Detach the thread input
            this.user32.AttachThreadInput(dwCurrentThreadId, dwForegroundThreadId, false);
    
            this.isWindowHidden = false;
            this.log('✓ Main window shown.');
    
        } catch (e) {
            this.log(`✗ Error showing main window: ${e}`);
        }
    },
    
    cleanupHelper: function() {
        this.isShuttingDown = true;
        if (this.helperProcess) {
            this.log("Terminating helper process...");
            this.helperProcess.kill();
            this.helperProcess = null;
        } else {
            this.log("Helper process was not running.");
        }

        if (this.helperPath) {
            try {
                const helperFile = this.Cc["@mozilla.org/file/local;1"].createInstance(this.Ci.nsIFile);
                helperFile.initWithPath(this.helperPath);
                if (helperFile.exists()) {
                    helperFile.remove(false);
                    this.log(`✓ Deleted helper executable: ${this.helperPath}`);
                }
                } catch (e) {
                this.log(`✗ Could not delete helper executable: ${e}`);
            }
        }
    },
    
    cleanup: function() {
        this.log("🧹 Cleaning up all resources...");
        this.isShuttingDown = true;

        if (this.hidePollingInterval) {
            clearInterval(this.hidePollingInterval);
            this.hidePollingInterval = null;
            this.log("✓ Polling interval cleared.");
        }

        if (this.prefPane) {
            Zotero.PreferencePanes.unregister(this.prefPane.paneID);
            this.prefPane = null;
            this.log("✓ Preferences pane unregistered.");
        }

        if (this.prefObserver) {
            Zotero.Prefs.unregisterObserver('extensions.zotero-in-tray.', this.prefObserver);
            this.log("✓ Preference observer unregistered.");
        }

        if (this.serverSocket) {
            this.serverSocket.close();
            this.log("✓ Server socket closed.");
        }
        
        this.cleanupHelper();

        for (let window of this.lockedWindows.keys()) {
            this.unlockWindow(window);
        }
        
        if (this.user32) this.user32.close();
        if (this.kernel32) this.kernel32.close();
        
        this.mainWindowHandle = null; // Clear handle on cleanup
        
        this.log("✓ Cleanup finished.");
    },

    tryHideWindowOnStartup: function() {
        if (this.initialHidePerformed || this.isShuttingDown) {
            if (this.hidePollingInterval) {
                clearInterval(this.hidePollingInterval);
                this.hidePollingInterval = null;
            }
            return;
        }

        if (this.getMainWindowHandle()) {
            this.log('🚀 Window handle is available. Hiding window now.');
            this.hideMainWindow();
            
            this.initialHidePerformed = true;
            clearInterval(this.hidePollingInterval);
            this.hidePollingInterval = null;
            this.log('✓ Initial auto-hide complete. Polling stopped.');
        }
    }
};

// Global bootstrap functions
function install() { ZoteroInTray.log("Install event."); }
function uninstall() { ZoteroInTray.log("Uninstall event."); }
function startup({ id, version, rootURI }) {
    ZoteroInTray.init({ id, version, rootURI });
}
function shutdown() {
    ZoteroInTray.cleanup();
}
function onMainWindowLoad({ window }) {
    ZoteroInTray.log("🔥 Main window loaded: " + window.location.href);
    ZoteroInTray.mainWindow = window;
    ZoteroInTray.getMainWindowHandle();
    ZoteroInTray.lockWindow(window);
}
function onMainWindowUnload({ window }) {
    ZoteroInTray.log("🔥 Main window unloaded: " + window.location.href);
    ZoteroInTray.unlockWindow(window);
    if (ZoteroInTray.mainWindow === window) {
        ZoteroInTray.mainWindow = null;
        ZoteroInTray.mainWindowHandle = null;
    }
} 
