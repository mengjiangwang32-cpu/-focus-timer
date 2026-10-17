Option Explicit
Dim shell, fso, appName, appDir, target, shortcut
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
appName = ChrW(&H62FE) & ChrW(&H5149) & ChrW(&H4E13) & ChrW(&H6CE8)
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
target = fso.BuildPath(appDir, appName & ".exe")
If Not fso.FileExists(target) Then
  MsgBox "Please extract the complete application folder first.", 48, appName
  WScript.Quit 1
End If
Set shortcut = shell.CreateShortcut(fso.BuildPath(shell.SpecialFolders("Desktop"), appName & ".lnk"))
shortcut.TargetPath = target
shortcut.WorkingDirectory = appDir
shortcut.IconLocation = target & ",0"
shortcut.Description = appName
shortcut.Save
MsgBox appName & " - Desktop shortcut created.", 64, appName
