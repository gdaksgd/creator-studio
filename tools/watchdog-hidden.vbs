' Launch the Creator Studio watchdog with no visible window.
'
' Task Scheduler runs this file via wscript.exe (a GUI-subsystem host that
' never opens a console). The run style 0 below keeps the PowerShell child
' hidden as well. Starting powershell.exe directly from Task Scheduler
' always flashes a console, even with -WindowStyle Hidden, because the
' console window is created before the flag is read.
'
' Exit status is propagated to Task Scheduler for the run history.

Option Explicit

Dim fso, shell, here, ps1, rc
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

here = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = fso.BuildPath(here, "watchdog.ps1")

If Not fso.FileExists(ps1) Then WScript.Quit 1

rc = shell.Run("powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """", 0, True)
WScript.Quit rc
