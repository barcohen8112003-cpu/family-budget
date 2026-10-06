@echo off
rem Builds both editions of the Android APK from the www folder:
rem   family-budget.apk       - regular edition, no notification reading (installs from any source)
rem   family-budget-full.apk  - full edition with notification reading (install over USB)
setlocal
set "JAVA_HOME=C:\Program Files\Android\Android Studio1\jbr"
set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
for /d %%G in ("%USERPROFILE%\.gradle\wrapper\dists\gradle-8.6-bin\*") do set "GRADLE=%%G\gradle-8.6\bin\gradle.bat"
node "%~dp0make-manifest.js" || exit /b 1
cd /d "%~dp0android"
call "%GRADLE%" -q assembleDebug || exit /b 1
copy /y "app\build\outputs\apk\lite\debug\app-lite-debug.apk" "%~dp0family-budget.apk" >nul
copy /y "app\build\outputs\apk\full\debug\app-full-debug.apk" "%~dp0family-budget-full.apk" >nul
echo APK ready: %~dp0family-budget.apk and family-budget-full.apk
