#define UNICODE
#define _UNICODE
#define WIN32_LEAN_AND_MEAN
#define _WIN32_WINNT 0x0601

#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <shellapi.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

#include "resource.h"

#ifndef MOD_NOREPEAT
#define MOD_NOREPEAT 0x4000
#endif

#ifndef ARRAYSIZE
#define ARRAYSIZE(a) (sizeof(a) / sizeof((a)[0]))
#endif

#define HELPER_CLASS_NAME L"ZoteroTrayHelperWindowClass"
#define HELPER_WINDOW_TITLE L"ZoteroTrayHelper"

#define WM_TRAYICON (WM_APP + 1)
#define ID_TRAY_ICON 1
#define HOTKEY_ID 1

#define IDM_SHOW_HIDE 1001
#define IDM_EXIT_HELPER 1002

#define DEFAULT_TCP_PORT 23120

typedef struct {
    UINT modifiers;
    UINT hotkeyVk;
    unsigned short tcpPort;
    BOOL hotkeyRegistered;
    BOOL trayIconAdded;
    BOOL ownsTrayIcon;
    UINT msgTaskbarCreated;
    HICON trayIcon;
} HelperState;

static HelperState g_state = {
    0,
    0,
    DEFAULT_TCP_PORT,
    FALSE,
    FALSE,
    FALSE,
    0,
    NULL
};

static void ParseArgs(void) {
    int argc = 0;
    LPWSTR *argv = CommandLineToArgvW(GetCommandLineW(), &argc);
    if (!argv) {
        return;
    }

    for (int i = 1; i < argc; i++) {
        LPCWSTR arg = argv[i];
        if (wcscmp(arg, L"--ctrl") == 0) {
            g_state.modifiers |= MOD_CONTROL;
        } else if (wcscmp(arg, L"--alt") == 0) {
            g_state.modifiers |= MOD_ALT;
        } else if (wcscmp(arg, L"--shift") == 0) {
            g_state.modifiers |= MOD_SHIFT;
        } else if (wcsncmp(arg, L"--key=", 6) == 0) {
            LPCWSTR key = arg + 6;
            if (wcslen(key) == 1) {
                wchar_t ch = key[0];
                if (ch >= L'a' && ch <= L'z') {
                    ch = (wchar_t)(ch - L'a' + L'A');
                }
                if ((ch >= L'A' && ch <= L'Z') || (ch >= L'0' && ch <= L'9')) {
                    g_state.hotkeyVk = (UINT)ch;
                }
            }
        } else if (wcsncmp(arg, L"--port=", 7) == 0) {
            LPCWSTR portStr = arg + 7;
            wchar_t *end = NULL;
            unsigned long port = wcstoul(portStr, &end, 10);
            if (end != portStr && *end == L'\0' && port >= 1 && port <= 65535) {
                g_state.tcpPort = (unsigned short)port;
            }
        }
    }

    LocalFree(argv);
}

static void SendTcpCommand(const char *command) {
    SOCKET sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (sock == INVALID_SOCKET) {
        return;
    }

    DWORD timeoutMs = 1000;
    setsockopt(sock, SOL_SOCKET, SO_SNDTIMEO, (const char *)&timeoutMs, sizeof(timeoutMs));
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, (const char *)&timeoutMs, sizeof(timeoutMs));

    struct sockaddr_in addr;
    ZeroMemory(&addr, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons(g_state.tcpPort);
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);

    if (connect(sock, (const struct sockaddr *)&addr, sizeof(addr)) == 0) {
        int len = (int)strlen(command);
        int sent = 0;
        while (sent < len) {
            int n = send(sock, command + sent, len - sent, 0);
            if (n <= 0) {
                break;
            }
            sent += n;
        }
        shutdown(sock, SD_SEND);
    }

    closesocket(sock);
}

static void AddTrayIcon(HWND hwnd) {
    NOTIFYICONDATAW nid;
    ZeroMemory(&nid, sizeof(nid));
    nid.cbSize = sizeof(nid);
    nid.hWnd = hwnd;
    nid.uID = ID_TRAY_ICON;
    nid.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP;
    nid.uCallbackMessage = WM_TRAYICON;
    nid.hIcon = g_state.trayIcon;
    lstrcpynW(nid.szTip, L"Zotero", (int)ARRAYSIZE(nid.szTip));

    if (Shell_NotifyIconW(NIM_ADD, &nid)) {
        g_state.trayIconAdded = TRUE;
    }
}

static void RemoveTrayIcon(HWND hwnd) {
    if (!g_state.trayIconAdded) {
        return;
    }

    NOTIFYICONDATAW nid;
    ZeroMemory(&nid, sizeof(nid));
    nid.cbSize = sizeof(nid);
    nid.hWnd = hwnd;
    nid.uID = ID_TRAY_ICON;

    Shell_NotifyIconW(NIM_DELETE, &nid);
    g_state.trayIconAdded = FALSE;
}

static void ShowTrayMenu(HWND hwnd) {
    POINT pt;
    if (!GetCursorPos(&pt)) {
        return;
    }

    HMENU hMenu = CreatePopupMenu();
    if (!hMenu) {
        return;
    }

    AppendMenuW(hMenu, MF_STRING, IDM_SHOW_HIDE, L"Show/Hide");
    AppendMenuW(hMenu, MF_SEPARATOR, 0, NULL);
    AppendMenuW(hMenu, MF_STRING, IDM_EXIT_HELPER, L"Exit Tray Helper");
    SetMenuDefaultItem(hMenu, IDM_SHOW_HIDE, FALSE);

    SetForegroundWindow(hwnd);
    TrackPopupMenu(
        hMenu,
        TPM_RIGHTBUTTON | TPM_BOTTOMALIGN | TPM_LEFTALIGN,
        pt.x,
        pt.y,
        0,
        hwnd,
        NULL
    );
    PostMessageW(hwnd, WM_NULL, 0, 0);
    DestroyMenu(hMenu);
}

static void CloseExistingInstance(void) {
    HWND existing = FindWindowW(HELPER_CLASS_NAME, HELPER_WINDOW_TITLE);
    if (!existing) {
        return;
    }

    SendMessageTimeoutW(existing, WM_CLOSE, 0, 0, SMTO_ABORTIFHUNG, 500, NULL);
    for (int i = 0; i < 10; i++) {
        if (!FindWindowW(HELPER_CLASS_NAME, HELPER_WINDOW_TITLE)) {
            break;
        }
        Sleep(50);
    }
}

static LRESULT CALLBACK WndProc(HWND hwnd, UINT uMsg, WPARAM wParam, LPARAM lParam) {
    switch (uMsg) {
        case WM_CREATE:
            g_state.msgTaskbarCreated = RegisterWindowMessageW(L"TaskbarCreated");
            AddTrayIcon(hwnd);
            if (g_state.hotkeyVk != 0) {
                g_state.hotkeyRegistered = RegisterHotKey(
                    hwnd,
                    HOTKEY_ID,
                    g_state.modifiers | MOD_NOREPEAT,
                    g_state.hotkeyVk
                );
            }
            return 0;

        case WM_HOTKEY:
            if (wParam == HOTKEY_ID) {
                SendTcpCommand("CLICKED");
            }
            return 0;

        case WM_TRAYICON:
            if ((UINT)lParam == WM_LBUTTONUP) {
                SendTcpCommand("CLICKED");
            } else if ((UINT)lParam == WM_RBUTTONUP) {
                ShowTrayMenu(hwnd);
            }
            return 0;

        case WM_COMMAND:
            switch (LOWORD(wParam)) {
                case IDM_SHOW_HIDE:
                    SendTcpCommand("CLICKED");
                    break;
                case IDM_EXIT_HELPER:
                    SendTcpCommand("HELPER_EXIT");
                    DestroyWindow(hwnd);
                    break;
            }
            return 0;

        case WM_CLOSE:
            DestroyWindow(hwnd);
            return 0;

        case WM_ENDSESSION:
            if (wParam) {
                RemoveTrayIcon(hwnd);
            }
            return 0;

        case WM_DESTROY:
            if (g_state.hotkeyRegistered) {
                UnregisterHotKey(hwnd, HOTKEY_ID);
                g_state.hotkeyRegistered = FALSE;
            }
            RemoveTrayIcon(hwnd);
            PostQuitMessage(0);
            return 0;

        default:
            if (g_state.msgTaskbarCreated != 0 && uMsg == g_state.msgTaskbarCreated) {
                AddTrayIcon(hwnd);
                return 0;
            }
            return DefWindowProcW(hwnd, uMsg, wParam, lParam);
    }
}

int WINAPI wWinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, PWSTR pCmdLine, int nCmdShow) {
    (void)hPrevInstance;
    (void)pCmdLine;
    (void)nCmdShow;

    ParseArgs();
    CloseExistingInstance();

    WSADATA wsaData;
    if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0) {
        return 1;
    }

    int cxIcon = GetSystemMetrics(SM_CXSMICON);
    int cyIcon = GetSystemMetrics(SM_CYSMICON);
    g_state.trayIcon = (HICON)LoadImageW(
        hInstance,
        MAKEINTRESOURCEW(IDI_TRAY_ICON),
        IMAGE_ICON,
        cxIcon,
        cyIcon,
        LR_DEFAULTCOLOR
    );
    if (g_state.trayIcon) {
        g_state.ownsTrayIcon = TRUE;
    } else {
        g_state.trayIcon = LoadIconW(NULL, IDI_APPLICATION);
    }

    WNDCLASSEXW wc;
    ZeroMemory(&wc, sizeof(wc));
    wc.cbSize = sizeof(wc);
    wc.lpfnWndProc = WndProc;
    wc.hInstance = hInstance;
    wc.lpszClassName = HELPER_CLASS_NAME;

    if (!RegisterClassExW(&wc)) {
        if (g_state.ownsTrayIcon && g_state.trayIcon) {
            DestroyIcon(g_state.trayIcon);
        }
        WSACleanup();
        return 1;
    }

    HWND hwnd = CreateWindowExW(
        0,
        HELPER_CLASS_NAME,
        HELPER_WINDOW_TITLE,
        WS_OVERLAPPED,
        0,
        0,
        0,
        0,
        NULL,
        NULL,
        hInstance,
        NULL
    );
    if (!hwnd) {
        if (g_state.ownsTrayIcon && g_state.trayIcon) {
            DestroyIcon(g_state.trayIcon);
        }
        WSACleanup();
        return 1;
    }

    MSG msg;
    while (GetMessageW(&msg, NULL, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    if (g_state.ownsTrayIcon && g_state.trayIcon) {
        DestroyIcon(g_state.trayIcon);
    }
    WSACleanup();
    return 0;
}
