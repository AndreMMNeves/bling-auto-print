@echo off
rem Instala o Agente de impressão da Ônix neste computador (pede permissão de administrador).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar.ps1"
