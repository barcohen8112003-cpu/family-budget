@echo off
rem Builds the Android APK from the www folder and copies it next to this script.
setlocal
set "JAVA_HOME=C:\Program Files\Android\Android Studio1\jbr"
set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
for /d %%G in ("%USERPROFILE%\.gradle\wrapper\dists\gradle-8.6-bin\*") do set "GRADLE=%%G\gradle-8.6\bin\gradle.bat"
cd /d "%~dp0android"
call "%GRADLE%" -q assembleDebug || exit /b 1
copy /y "app\build\outputs\apk\debug\app-debug.apk" "%~dp0family-budget.apk" >nul
echo APK ready: %~dp0family-budget.apk
