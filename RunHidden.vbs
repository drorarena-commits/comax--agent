' Runs the idle-logoff check without flashing a console window.
'
' Called by the Windows scheduled task "comax-idle-logoff" every 5 minutes:
'     wscript.exe "C:\AGENT-COMAX-CLOAD\RunHidden.vbs"
'
' The task defines no working directory, so this script sets it. Without that,
' `node tools\idle-logoff.js` resolves against C:\Windows\System32 and fails.
'
' Window style 0 = hidden, bWaitOnReturn = False so the task finishes at once
' and never overlaps with the next tick. Output is appended to a log rather
' than discarded: a check that silently stopped working is exactly the failure
' this whole mechanism exists to avoid.
'
' Comments are deliberately in English — Windows Script Host reads .vbs as ANSI,
' and Hebrew text saved as UTF-8 comes back as mojibake and can break parsing.
Option Explicit

Dim sh, root, cmd
root = "C:\AGENT-COMAX-CLOAD"

Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = root

' chcp 65001 first: the tool logs in Hebrew, and without it cmd writes the log
' in the OEM codepage and every line comes back as mojibake.
cmd = "cmd /c chcp 65001 > nul & node tools\idle-logoff.js >> runs\idle-logoff.log 2>&1"
sh.Run cmd, 0, False
