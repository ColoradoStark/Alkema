@echo off
REM Alkema Build Script - Fast Rebuild for Code Changes Only
setlocal enabledelayedexpansion

echo ==========================================
echo Alkema Fast Rebuild - Code Changes Only
echo ==========================================
echo.

REM Check if containers are running
docker compose ps --services --filter "status=running" >nul 2>&1
if %errorlevel% equ 0 (
    echo Restarting containers with code changes...
    
    REM For client (Vite dev server) - just restart for hot reload
    docker compose restart game-client
    
    REM For server (Node.js) - restart to pick up changes
    docker compose restart game-server
    
    REM API and other services don't need restart for most changes
    
    echo.
    echo Services restarted with latest code!
) else (
    echo No containers running. Starting services...
    docker compose up -d
)

echo.
echo ==========================================
echo Fast Rebuild Complete!
echo ==========================================
echo Game Client: http://localhost:3000
echo Game Server: http://localhost:3001
echo API: http://localhost:8000
echo ==========================================
echo.
echo This script only restarts containers with code changes.
echo Use BuildScriptForce.bat for dependency or Docker config changes.
echo ==========================================

endlocal