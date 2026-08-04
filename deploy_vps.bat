@echo off
title Artha AI Deployed Server Updater
echo ============================================================
echo           ARTHA AI VPS AUTOMATIC DEPLOYMENT
echo ============================================================
echo.
echo This script will SSH into your server (13.52.69.143),
echo pull the latest fix we pushed to GitHub, build it, and restart.
echo.
set /p USERNAME="Enter your VPS username (e.g. ubuntu, root, admin): "
echo.
echo Connecting to %USERNAME%@13.52.69.143 ...
echo (If prompted, please enter your VPS login password)
echo.

ssh -t %USERNAME%@13.52.69.143 "if [ -d 'artha-ai-copilot2.0' ]; then cd artha-ai-copilot2.0; elif [ -d 'artha-ai-copilot' ]; then cd artha-ai-copilot; else cd artha; fi && echo '==^> Pulling latest fixes from Git...' && git pull origin main && echo '==^> Rebuilding project...' && npm run build --prefix apps/api && echo '==^> Restarting application via PM2...' && pm2 restart all || pm2 restart artha-api || pm2 restart artha-ai; echo '==^> Restarting Docker containers if any...' && (docker-compose down && docker-compose up -d --build || docker compose down && docker compose up -d --build); echo '============================================================'; echo '✅ DEPLOYMENT FINISHED!'; echo '============================================================'"

if %errorlevel% neq 0 (
    echo.
    echo ❌ Connection failed or user cancelled.
)
echo.
pause
