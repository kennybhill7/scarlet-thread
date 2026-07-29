@echo off
REM Rebuild the visual map from the vault, then open it.
cd /d "%~dp0"
py build_map.py
if errorlevel 1 goto :fail
start "" "Bible-Brain-Map.html"
goto :eof
:fail
echo.
echo Build failed - see the error above.
pause
