@echo off
echo Running High-Speed Data Fetcher...
"C:\Users\DELL\AppData\Local\Programs\Python\Python311\python.exe" "%~dp0fetch_data.py"

echo.
echo Checking WhatsApp Alert Dispatcher...
"C:\Users\DELL\AppData\Local\Programs\Python\Python311\python.exe" "%~dp0send_whatsapp_alert.py"
