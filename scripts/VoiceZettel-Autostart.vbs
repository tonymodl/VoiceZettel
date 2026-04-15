' VoiceZettel-Autostart.vbs
' Silent launcher — runs start-all.bat without showing a console window at login
' Placed in shell:startup folder for autostart

Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """C:\Users\anton\OneDrive\Документы\VoiceZettel\scripts\start-all.bat""", 0, False
Set WshShell = Nothing
