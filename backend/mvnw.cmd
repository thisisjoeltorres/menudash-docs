@echo off
setlocal
set "MAVEN_PROJECTBASEDIR=%~dp0"
rem Remove the final backslash; otherwise Windows can treat the closing quote
rem as escaped when Java parses -Dmaven.multiModuleProjectDirectory.
if "%MAVEN_PROJECTBASEDIR:~-1%"=="\" set "MAVEN_PROJECTBASEDIR=%MAVEN_PROJECTBASEDIR:~0,-1%"
set "WRAPPER_JAR=%~dp0.mvn\wrapper\maven-wrapper.jar"

if defined JAVA_HOME (
  set "JAVA_EXE=%JAVA_HOME%\bin\java.exe"
) else (
  set "JAVA_EXE=java"
)

if defined JAVA_HOME if not exist "%JAVA_EXE%" (
  echo JAVA_HOME does not point to a JDK: %JAVA_HOME%
  echo Set JAVA_HOME to the JDK 17 installation folder, then reopen PowerShell.
  exit /b 1
)

if not defined JAVA_HOME (
  where java >nul 2>nul
  if errorlevel 1 (
    echo Java was not found. Install JDK 17, set JAVA_HOME, and reopen PowerShell.
    exit /b 1
  )
)

if not exist "%WRAPPER_JAR%" (
  echo Maven Wrapper file is missing: %WRAPPER_JAR%
  exit /b 1
)

"%JAVA_EXE%" "-Dmaven.multiModuleProjectDirectory=%MAVEN_PROJECTBASEDIR%" -classpath "%WRAPPER_JAR%" org.apache.maven.wrapper.MavenWrapperMain %*
exit /b %ERRORLEVEL%
