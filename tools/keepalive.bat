@echo off
rem Supabase keep-alive - called by the daily scheduled task
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0keepalive.ps1"
