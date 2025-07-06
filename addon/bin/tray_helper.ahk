#Persistent
#SingleInstance, Force

; --- TCP 客户端设置 ---
TCP_HOST := "127.0.0.1"
TCP_PORT := 23120

; --- 最终的托盘菜单设置 (稳定版) ---
Menu, Tray, NoStandard      ; 移除标准的 AHK 菜单项
Menu, Tray, Icon            ; 使用嵌入到EXE自身的图标
Menu, Tray, Tip, Zotero     ; 设置鼠标悬停提示
Menu, Tray, Click, 1        ; 设置单击为默认动作

; --- 定义干净、最简的右键菜单 ---
Menu, Tray, Add, Show/Hide, OnTrayClick  ; 添加"显示/隐藏"

; --- 设置单击的默认行为 ---
Menu, Tray, Default, Show/Hide ; 将"显示/隐藏"设为单击时的默认动作

return ; 自动执行段结束

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