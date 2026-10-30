@echo off
cd /d "%~dp0"
python servidor.py
if errorlevel 1 pause
