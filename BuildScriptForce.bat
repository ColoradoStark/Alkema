@echo off
REM Alkema Build Script - Force Rebuild Everything
setlocal enabledelayedexpansion

echo ==========================================
echo Alkema Force Rebuild - Complete Reset
echo ==========================================
echo.
echo WARNING: This will completely rebuild all containers!
echo.

REM Check if Python virtual environment exists
if not exist "venv" (
    echo Creating Python virtual environment...
    python -m venv venv
    call venv\Scripts\activate.bat
    python -m pip install --upgrade pip >nul 2>&1
    if exist "requirements-local.txt" (
        echo Installing local testing tools...
        pip install -r requirements-local.txt >nul 2>&1
    )
) else (
    call venv\Scripts\activate.bat
)

echo Stopping ALL containers...
docker compose down --volumes --remove-orphans

echo.
echo Removing project images (keeping base images)...
docker compose rm -f

echo.
echo Building ALL containers from scratch (parallel build)...
docker compose build --no-cache --parallel

echo.
echo Starting fresh services...
docker compose up -d

echo.
echo Waiting for services to be ready...
set MAX_ATTEMPTS=30
set ATTEMPT=0

:health_check_loop
set /a ATTEMPT+=1
if !ATTEMPT! gtr !MAX_ATTEMPTS! (
    echo Services took too long to start. Check logs with: docker compose logs
    goto :show_urls
)

REM Check if API is responding
curl -s -o nul -w "%%{http_code}" http://localhost:8000/test >nul 2>&1
if %errorlevel% equ 0 (
    echo All services are ready!
    goto :show_urls
)

REM Show progress dots
echo | set /p=.
timeout /t 1 /nobreak >nul
goto :health_check_loop

:show_urls
echo.
echo ==========================================
echo FORCE REBUILD COMPLETE!
echo ==========================================
echo Game Client: http://localhost:3000
echo Game Server: http://localhost:3001
echo API: http://localhost:8000
echo API Docs: http://localhost:8000/docs
echo Legacy Generator: http://localhost:8080
echo MongoDB: localhost:27017
echo ==========================================
echo.
echo All containers have been rebuilt from scratch.
echo.
echo Quick commands:
echo   View logs:          docker compose logs -f
echo   Stop services:      docker compose down
echo   Test API:           python test_api.py
echo   Normal rebuild:     BuildScript.bat
echo   Quick restart:      BuildScript.bat --quick
echo ==========================================

endlocal