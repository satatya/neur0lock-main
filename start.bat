@echo off
REM NeuroLock quick start for Windows
setlocal enabledelayedexpansion
set ROOT=%~dp0

echo.
echo NeuroLock Quick Start
echo =====================
echo.
echo 1) Full stack in Docker (website, API, AAA server, OpenLDAP, rsyslog, MySQL) + mobile app
echo 2) Local development without Docker (AAA dev server + API + app; MySQL must run on 3307)
echo 3) Mobile app / Expo only
echo 4) Stop the Docker stack
echo.
set /p choice="Enter choice [1-4]: "

if "%choice%"=="1" (
    call :docker_up || exit /b 1
    call :start_frontend
) else if "%choice%"=="2" (
    call :start_aaa || exit /b 1
    call :start_backend || exit /b 1
    call :start_frontend
) else if "%choice%"=="3" (
    call :start_frontend
) else if "%choice%"=="4" (
    pushd "%ROOT%"
    docker compose down
    popd
) else (
    echo Invalid choice
    exit /b 1
)
exit /b 0

:docker_up
    docker --version >nul 2>&1
    if errorlevel 1 (
        echo Error: Docker is not installed. Install Docker Desktop, or use option 2.
        exit /b 1
    )
    pushd "%ROOT%"
    if not exist ".env" (
        echo Creating .env with fresh random secrets...
        node scripts\setup-env.mjs
        if errorlevel 1 (
            echo Error: could not create .env. Install Node.js, or copy .env.example to .env and fill in the secrets.
            popd
            exit /b 1
        )
    )
    echo Building and starting containers (first run takes a few minutes)...
    docker compose up -d --build
    if errorlevel 1 (
        popd
        exit /b 1
    )
    echo Waiting for the API to report healthy...
    set /a tries=0
    :wait_api
    curl -s -o nul -w "%%{http_code}" http://localhost:4311/api/health | findstr "200" >nul
    if not errorlevel 1 goto api_ready
    set /a tries+=1
    if !tries! geq 90 (
        echo The API is not healthy yet. Check: docker compose ps   and   docker compose logs aaa api
        popd
        exit /b 1
    )
    timeout /t 2 /nobreak >nul
    goto wait_api
    :api_ready
    echo.
    echo Ready:  website https://localhost   API http://localhost:4311/api
    echo Audit log:  docker compose exec rsyslog tail -f /var/log/neurolock/audit.log
    popd
    exit /b 0

:start_aaa
    echo.
    echo Starting the AAA server (development mode, in-memory directory)...
    set PY=py -3
    %PY% --version >nul 2>&1 || set PY=python
    pushd "%ROOT%aaa-server"
    if not exist ".venv" (
        echo Creating Python virtual environment...
        %PY% -m venv .venv || (popd & exit /b 1)
        .venv\Scripts\pip install -q -r requirements.txt || (popd & exit /b 1)
    )
    if not exist "%ROOT%infra\certs\dev\api.crt" (
        echo Generating development certificates...
        .venv\Scripts\python "%ROOT%infra\certs\generate_certs.py" "%ROOT%infra\certs\dev"
    )
    start "NeuroLock AAA server" cmd /k .venv\Scripts\python dev_server.py --certs "%ROOT%infra\certs\dev"
    popd
    timeout /t 4 /nobreak >nul
    exit /b 0

:start_backend
    echo.
    echo Starting the REST API...
    pushd "%ROOT%neurolock-staff-backend"
    if not exist ".env" (
        echo Error: neurolock-staff-backend\.env is missing. Run: node scripts\setup-env.mjs --dev
        popd
        exit /b 1
    )
    if not exist "node_modules" (
        echo Installing API dependencies...
        call npm install
    )
    echo Preparing database (schema if empty + encrypted demo notes)...
    call npm run db:setup
    if errorlevel 1 (
        echo Error: could not reach MySQL. Is it running on port 3307?
        popd
        exit /b 1
    )
    start "NeuroLock API" cmd /k npm run dev
    echo API starting on http://localhost:4311/api
    popd
    timeout /t 3 /nobreak >nul
    exit /b 0

:start_frontend
    echo.
    echo Starting the app (Expo). Press w for web, or scan the QR code with Expo Go on your phone.
    echo The app finds the API on this computer automatically (allow port 4311 in the firewall for phones).
    echo.
    pushd "%ROOT%frontend"
    if not exist "node_modules" (
        echo Installing app dependencies...
        call npm install
    )
    call npm start
    popd
    exit /b 0
