@echo off
rem Builds specifically the Admin Android APK (family-budget-admin.apk)
setlocal
set "JAVA_HOME=C:\Program Files\Android\Android Studio1\jbr"
set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
for /d %%G in ("%USERPROFILE%\.gradle\wrapper\dists\gradle-8.6-bin\*") do set "GRADLE=%%G\gradle-8.6\bin\gradle.bat"
node "%~dp0make-manifest.js" || exit /b 1
cd /d "%~dp0android"
call "%GRADLE%" -q assembleAdminDebug || exit /b 1
cd /d "%~dp0"
node "%~dp0make-release.js" || exit /b 1
echo.
echo =======================================================
echo [V] Admin APK ready: %~dp0family-budget-admin.apk
echo =======================================================

