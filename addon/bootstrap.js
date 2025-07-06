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
    PORT: 23120,
    
    // Window Management
    mainWindow: null,
    mainWindowHandle: null,
    lockedWindows: new Map(),
    isWindowHidden: false,
    windowWasMaximized: false,
    isActuallyQuitting: false,
    
    // Helper Process
    helperProcess: null,
    helperExeName: 'tray_helper.exe',
    helperPath: null,
    isShuttingDown: false,
    relaunchDelay: 2000, // ms
    
    // Windows API
    user32: null,
    kernel32: null,
    ctypes: null,
    
    // WinAPI Constants
    constants: {
        SW_HIDE: 0,
        SW_RESTORE: 9,
        SW_MAXIMIZE: 3,
    },

    // Mozilla Components
    Cc: null,
    Ci: null,

    init: function({ id, version, rootURI }) {
        this.id = id;
        this.version = version;
        this.rootURI = rootURI;
        
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
            this.serverSocket = this.Cc["@mozilla.org/network/server-socket;1"]
                .createInstance(this.Ci.nsIServerSocket);
            
            const listener = {
                onSocketAccepted: (socket, transport) => {
                    this.log("TCP Server: Connection accepted.");
                    this.handleConnection(socket, transport.openInputStream(0, 0, 0), transport.openOutputStream(0, 0, 0));
                }
            };
            this.serverSocket.init(this.PORT, true, -1);
            this.serverSocket.asyncListen(listener);
            this.log(`✓ Server listening on port ${this.PORT}`);
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
            this.log("✓ Windows API functions declared.");
        } catch (e) {
            this.log("✗ Error declaring Windows API functions: " + e);
            throw e;
        }
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
            
            this.log(`🚀 Running helper...`);
            process.runAsync([], 0, (subject, topic, data) => {
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
        } catch (e) {
            this.log("✗ Error launching helper process: " + e);
            if (typeof Zotero !== 'undefined') Zotero.logError(e);
        }
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
        if (this.mainWindowHandle && !this.mainWindowHandle.isNull()) {
            return true;
        }
        try {
            let windowClasses = ["MozillaWindowClass", "MozillaDialogClass"];
            for (let className of windowClasses) {
                let handle = this.user32.FindWindowW(this.ctypes.char16_t.array()(className), null);
                if (handle && !handle.isNull()) {
                    this.mainWindowHandle = handle;
                    this.log("✓ Found main window handle: " + handle.toString());
                    return true;
                }
            }
            this.log("✗ Failed to get main window handle");
            return false;
        } catch (e) {
            this.log("Error getting main window handle: " + e);
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
        this.log('🖱️ Tray icon click handled.');
        try {
            if (!this.getMainWindowHandle()) {
                this.log("✗ Could not get main window handle for tray click.");
                return;
            }

            const isVisible = this.user32.IsWindowVisible(this.mainWindowHandle);
            const isMinimized = this.user32.IsIconic(this.mainWindowHandle);

            this.log(`Window state: isHidden=${this.isWindowHidden}, isVisible=${isVisible}, isMinimized=${isMinimized}`);

            if (this.isWindowHidden) {
                this.log("🔄 Window is hidden by plugin, restoring...");
                this.showMainWindow();
            }
            else if (isMinimized) {
                this.log("🔄 Window is minimized, restoring...");
                this.showMainWindow();
            }
            else if (isVisible) {
                this.log("🔄 Window is in background, bringing to front...");
                this.user32.SetForegroundWindow(this.mainWindowHandle);
            }
            else {
                this.log("🔄 Unhandled state, attempting to restore window...");
                this.showMainWindow();
            }
        } catch (e)
        {
            this.log(`✗ Error in handleTrayClick: ${e}`);
        }
    },

    hideMainWindow: function() {
        if (!this.getMainWindowHandle()) return;
        try {
            this.windowWasMaximized = this.user32.IsZoomed(this.mainWindowHandle);
            this.log(`Hiding main window. Maximized state: ${this.windowWasMaximized}`);
            this.user32.ShowWindow(this.mainWindowHandle, this.constants.SW_HIDE);
            this.isWindowHidden = true;
        } catch (e) {
            this.log("✗ Error hiding main window: " + e);
        }
    },

    showMainWindow: function() {
        if (!this.getMainWindowHandle()) {
            this.log('✗ No main window handle to show.');
            return;
        }

        try {
            this.log('🖥️ Showing main window...');
            const state = this.windowWasMaximized ? this.constants.SW_MAXIMIZE : this.constants.SW_RESTORE;
            this.user32.ShowWindow(this.mainWindowHandle, state);
            this.user32.SetForegroundWindow(this.mainWindowHandle);
            this.isWindowHidden = false; // Ensure state is updated
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
        
        this.log("✓ Cleanup finished.");
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