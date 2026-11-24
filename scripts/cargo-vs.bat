@echo off
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64 >nul
if errorlevel 1 (
  echo VsDevCmd failed
  exit /b 1
)
"C:\Users\WinBug\.cargo\bin\cargo.exe" %*
exit /b %errorlevel%
