@echo off
REM Setup Python virtual environment for local testing

echo ========================================
echo Setting up Python Virtual Environment
echo ========================================
echo.

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH
    echo Please install Python 3.8+ from https://www.python.org/
    pause
    exit /b 1
)

REM Check if venv exists
if exist "venv" (
    echo Virtual environment already exists.
    set /p recreate="Do you want to recreate it? (y/N): "
    if /i "%recreate%"=="y" (
        echo Removing existing virtual environment...
        rmdir /s /q venv
    ) else (
        echo Activating existing virtual environment...
        goto :activate
    )
)

REM Create virtual environment
echo Creating virtual environment...
python -m venv venv

:activate
REM Activate virtual environment
echo Activating virtual environment...
call venv\Scripts\activate.bat

REM Upgrade pip
echo Upgrading pip...
python -m pip install --upgrade pip

REM Install requirements
if exist "requirements-local.txt" (
    echo Installing local requirements...
    pip install -r requirements-local.txt
    echo.
    echo ✓ Local requirements installed
) else (
    echo WARNING: requirements-local.txt not found
)

echo.
echo ========================================
echo Virtual environment setup complete!
echo ========================================
echo.
echo Virtual environment is now ACTIVE.
echo.
echo You can now run:
echo   python test_api.py       - Test the API
echo   python test_db.py        - Test database connection
echo.
echo To deactivate the virtual environment, type: deactivate
echo To reactivate it later, run: venv\Scripts\activate.bat
echo ========================================