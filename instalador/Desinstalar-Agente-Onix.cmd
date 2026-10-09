@echo off
rem Remove o serviço do Agente Ônix deste computador.
net session >nul 2>&1 || (powershell -NoProfile -Command "Start-Process -Verb RunAs -FilePath \"%~f0\"" & exit /b)
cd /d C:\OnixAgente && node scripts\servicos.ts desinstalar agente
pause
