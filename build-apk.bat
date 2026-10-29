@echo off
rem Builds both Regular and Admin Android APKs from the www folder.
rem Produces:
rem   1) family-budget.apk (Regular user version)
rem   2) family-budget-admin.apk (Admin version with access to all budgets)
setlocal
set "JAVA_HOME=C:\Program Files\Android\Android Studio1\jbr"
set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
for /d %%G in ("%USERPROFILE%\.gradle\wrapper\dists\gradle-8.6-bin\*") do set "GRADLE=%%G\gradle-8.6\bin\gradle.bat"
node "%~dp0make-manifest.js" || exit /b 1
cd /d "%~dp0android"
call "%GRADLE%" -q assembleDebug || exit /b 1
cd /d "%~dp0"
node "%~dp0make-release.js" || exit /b 1
echo.
echo =======================================================
echo [V] User APK ready:  %~dp0family-budget.apk
echo [V] Admin APK ready: %~dp0family-budget-admin.apk
echo =======================================================
