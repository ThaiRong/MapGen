@echo off
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64 >nul
set CARGO_TARGET_DIR=C:\Users\WinBug\AppData\Local\Temp\mapgen-target
set PATH=C:\Program Files\nodejs;C:\Users\WinBug\.cargo\bin;%PATH%
cd /d "C:\Users\WinBug\MapGen"
npm run tauri dev
