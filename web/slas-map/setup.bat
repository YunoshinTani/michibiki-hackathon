@echo off
cd /d "%~dp0"
py -3 -m venv .venv
if errorlevel 1 (
  echo.
  echo Could not create the local Python environment. Install Python 3 and try again.
  pause
  exit /b 1
)
.venv\Scripts\python.exe -m pip install -r requirements.txt
if errorlevel 1 (
  echo.
  echo Setup failed. Check your internet connection and try again.
  pause
  exit /b 1
)
echo.
echo Setup complete. Run start.bat to open the dashboard.
pause
