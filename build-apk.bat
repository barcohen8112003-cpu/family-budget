@echo off
rem Builds the Android APK from the www folder and publishes it to www\apk for in-app updates.
rem After building, commit and push to GitHub so installed apps can offer the update.
setlocal
set "JAVA_HOME=C:\Program Files\Android\Android Studio1\jbr"
set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
for /d %%G in ("%USERPROFILE%\.gradle\wrapper\dists\gradle-8.6-bin\*") do set "GRADLE=%%G\gradle-8.6\bin\gradle.bat"
node "%~dp0make-manifest.js" || exit /b 1
cd /d "%~dp0android"
call "%GRADLE%" -q assembleDebug || exit /b 1
node "%~dp0make-release.js" || exit /b 1
echo APK ready: %~dp0family-budget.apk
