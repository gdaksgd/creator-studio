' Launch keepalive.bat with no visible window.
'
' Same pattern as watchdog-hidden.vbs: Task Scheduler running a .bat file
' always flashes a console window (cmd.exe is a console app). wscript.exe
' is a GUI-subsystem host, and run style 0 keeps cmd hidden.

Option Explicit

Dim fso, shell, here, bat, rc
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

here = fso.GetParentFolderName(WScript.ScriptFullName)
bat = fso.BuildPath(here, "keepalive.bat")

If Not fso.FileExists(bat) Then WScript.Quit 1

rc = shell.Run("cmd.exe /c """ & bat & """", 0, True)
WScript.Quit rc
