#Persistent
#SingleInstance, Force

; --- 热键设置 ---
hotkey_string := ""
hotkey_key := ""
full_hotkey := ""

; --- TCP 客户端设置 ---
TCP_HOST := "127.0.0.1"
TCP_PORT := 23120 ; 默认端口

; 解析命令行参数 (AHK v1 风格)
Loop, %0%
{
    param := %A_Index%
    if (param = "--ctrl")
    {
        hotkey_string .= "^"
    }
    else if (param = "--alt")
    {
        hotkey_string .= "!"
    }
    else if (param = "--shift")
    {
        hotkey_string .= "+"
    }
    else if (InStr(param, "--key="))
    {
        hotkey_key := SubStr(param, 7)
    }
    else if (InStr(param, "--port="))
    {
        TCP_PORT := SubStr(param, 8)
    }
}

; 只有当提供了非空的key时，才构建并注册热键
if (hotkey_key != "")
{
    full_hotkey := hotkey_string . hotkey_key
    Hotkey, %full_hotkey%, OnTrayClick
}

; --- Tray Menu Configuration (Stable Order) ---
; 1. Modify the menu structure first.
Menu, Tray, NoStandard      ; Remove all standard items like "Pause", "Exit". This should come first.

; 2. Add custom items to the now-empty menu.
Menu, Tray, Add, Show/Hide, OnTrayClick  ; Add our "Show/Hide" item.

; 3. Now, set properties and behaviors for the tray icon and its menu.
Menu, Tray, Icon, %A_ScriptFullPath%, 1   ; Use the icon embedded in the executable.
Menu, Tray, Tip, Zotero     ; Set the hover tooltip text.
Menu, Tray, Click, 1        ; Set single-click to trigger the default action.
Menu, Tray, Default, Show/Hide ; Make "Show/Hide" the default item for the single-click action.

return ; End of auto-execute section

OnTrayClick:
    VarSetCapacity(wsaData, 400)
    result := DllCall("ws2_32\WSAStartup", "UShort", 0x0202, "Ptr", &wsaData)
    if (result != 0) {
        return
    }

    socket := DllCall("ws2_32\socket", "Int", 2, "Int", 1, "Int", 6, "Ptr")
    if (socket = -1 or socket = 0) {
        DllCall("ws2_32\WSACleanup")
        return
    }

    VarSetCapacity(sockaddr, 16, 0)
    NumPut(2, sockaddr, 0, "UShort")
    NumPut(DllCall("ws2_32\htons", "UShort", TCP_PORT), sockaddr, 2, "UShort")
    NumPut(DllCall("ws2_32\inet_addr", "AStr", TCP_HOST), sockaddr, 4, "UInt")

    result := DllCall("ws2_32\connect", "Ptr", socket, "Ptr", &sockaddr, "Int", 16)
    if (result != 0) {
        DllCall("ws2_32\closesocket", "Ptr", socket)
        DllCall("ws2_32\WSACleanup")
        return
    }

    message := "CLICKED"
    DllCall("ws2_32\send", "Ptr", socket, "AStr", message, "Int", StrLen(message), "Int", 0)

    DllCall("ws2_32\closesocket", "Ptr", socket)
    DllCall("ws2_32\WSACleanup")
return
