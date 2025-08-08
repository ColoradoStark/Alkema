@echo off
REM Alkema Build Script - Optimized for speed
setlocal enabledelayedexpansion

echo ========================================
echo Alkema Character Generator - Fast Build
echo ========================================
echo.

REM Parse command line arguments
set "FORCE_REBUILD="
set "SKIP_BUILD="
set "QUICK_START="
for %%a in (%*) do (
    if /i "%%a"=="--force" set FORCE_REBUILD=1
    if /i "%%a"=="--skip-build" set SKIP_BUILD=1
    if /i "%%a"=="--quick" set QUICK_START=1
    if /i "%%a"=="--help" goto :show_help
)

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

REM Check if containers are already running
docker compose ps --services --filter "status=running" >nul 2>&1
if %errorlevel% equ 0 (
    for /f %%i in ('docker compose ps --services --filter "status=running" ^| find /c /v ""') do set RUNNING_COUNT=%%i
) else (
    set RUNNING_COUNT=0
)

if !RUNNING_COUNT! gtr 0 (
    if defined QUICK_START (
        echo Services already running. Use --force to rebuild or just restart.
        goto :show_urls
    )
    echo Found !RUNNING_COUNT! running services. Restarting...
    docker compose restart
    goto :show_urls
)

if defined SKIP_BUILD (
    echo Starting services without rebuilding...
    docker compose up -d
    goto :wait_for_services
)

REM Check if images need to be rebuilt
set NEEDS_REBUILD=0
if defined FORCE_REBUILD (
    set NEEDS_REBUILD=1
    echo Forced rebuild requested...
) else (
    REM Check if docker-compose.yml or Dockerfiles have changed
    for /f "tokens=*" %%i in ('docker compose config --images') do (
        docker image inspect %%i >nul 2>&1
        if !errorlevel! neq 0 (
            set NEEDS_REBUILD=1
            echo Image %%i not found, rebuild needed...
        )
    )
)

if !NEEDS_REBUILD! equ 1 (
    echo Stopping existing containers...
    docker compose down --remove-orphans
    
    echo.
    echo Building containers in parallel...
    docker compose build --parallel
) else (
    echo Images up to date, skipping rebuild...
    echo Stopping existing containers...
    docker compose down --remove-orphans
)

echo.
echo Starting services...
docker compose up -d

:wait_for_services
echo.
echo Waiting for services to be ready...

REM Quick health check instead of fixed timeout
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
    echo API is ready!
    goto :show_urls
)

REM Show progress dots
echo | set /p=.
timeout /t 1 /nobreak >nul
goto :health_check_loop

:show_urls
echo.
echo ========================================
echo Services are ready!
echo ========================================
echo Game Client: http://localhost:3000
echo Game Server: http://localhost:3001
echo API: http://localhost:8000
echo API Docs: http://localhost:8000/docs
echo Legacy Generator: http://localhost:8080
echo MongoDB: localhost:27017
echo ========================================
echo.
echo Quick commands:
echo   View logs:        docker compose logs -f
echo   Stop services:    docker compose down
echo   Test API:         python test_api.py
echo   Rebuild all:      BuildScript.bat --force
echo   Quick restart:    BuildScript.bat --quick
echo ========================================
goto :end

:show_help
echo.
echo Usage: BuildScript.bat [options]
echo.
echo Options:
echo   --force       Force rebuild all Docker images
echo   --skip-build  Start services without checking for rebuilds
echo   --quick       Quick start if services already running
echo   --help        Show this help message
echo.
echo Examples:
echo   BuildScript.bat             # Normal start with smart rebuild
echo   BuildScript.bat --force     # Force rebuild everything
echo   BuildScript.bat --quick     # Quick restart if already running
echo.

:end
endlocal