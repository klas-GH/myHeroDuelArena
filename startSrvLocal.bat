@echo off
cd /d "%~dp0"
echo Serving myHeroDuelArena on http://localhost:8080  (Ctrl+C to stop)
start "" http://localhost:8080
python -m http.server 8080
