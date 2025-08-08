@echo off
REM Alkema Build Script - Builds and runs the character generator API

echo ========================================
echo Alkema Character Generator
echo ========================================
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

echo Stopping existing containers...
docker compose down

echo.
echo Building containers...
docker compose build

echo.
echo Starting services...
docker compose up -d

echo.
echo ========================================
echo Services are starting!
echo ========================================
echo Game Client: http://localhost:3000
echo Game Server: http://localhost:3001
echo API: http://localhost:8000
echo API Docs: http://localhost:8000/docs
echo Legacy Generator: http://localhost:8080
echo MongoDB: localhost:27017
echo ========================================
echo.
echo Waiting for API to be ready...
timeout /t 10 /nobreak >nul

echo.
echo You can test the API with:
echo   python test_api.py
echo.
echo To view logs:
echo   docker compose logs -f
echo.
echo To stop services:
echo   docker compose down
echo ========================================