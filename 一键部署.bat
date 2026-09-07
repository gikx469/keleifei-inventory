@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ============================================================
echo   可乐菲出入库系统 - 一键部署到 Render（永久免费）
echo ============================================================
echo.

REM 1. 确认在 keleifei-server 目录里
cd /d "%~dp0"
if not exist "server.js" (
    echo [错误] 请把这个 bat 文件放到 keleifei-server 文件夹里再运行！
    echo        比如：D:\download\keleifei-server\deploy.bat
    pause
    exit /b 1
)

echo 当前目录: %cd%
echo.

REM 2. 检查 git
git --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 没装 git。去 https://git-scm.com/download/win 下载安装后再来。
    pause
    exit /b 1
)
echo [OK] git 已装
echo.

REM 3. 问 GitHub 仓库地址
set /p REPO_URL="请粘贴你的 GitHub 仓库地址（形如 https://github.com/xxx/keleifei-inventory.git）："

if "%REPO_URL%"=="" (
    echo [错误] 没填地址，退出。
    pause
    exit /b 1
)

REM 4. 如果还没初始化 git 仓库，就初始化
if not exist ".git" (
    echo.
    echo 正在初始化 git 仓库...
    git init
    git branch -M main
    git add .
    git commit -m "Initial deploy of keleifei-inventory"
)

REM 5. 配 remote + 推送
echo.
echo 正在推送到 GitHub...
git remote remove origin 2>nul
git remote add origin %REPO_URL%

REM 第一次推送可能要登录
git push -u origin main
if errorlevel 1 (
    echo.
    echo [错误] 推送失败。常见原因：
    echo   1. GitHub 仓库地址不对
    echo   2. 没登录 git（去 https://github.com/settings/tokens 生成 Personal Access Token 当密码用）
    echo   3. 仓库名被占用
    pause
    exit /b 1
)

echo.
echo ============================================================
echo   代码已成功推到 GitHub！
echo ============================================================
echo.
echo 接下来 3 步搞定 Render 部署（3 分钟）：
echo.
echo   1. 浏览器打开 https://dashboard.render.com/blueprints
echo   2. 点 "New Blueprint Instance" 选你的仓库 "keleifei-inventory"
echo   3. 点 "Apply"，等 3 分钟，会给你一个 https://keleifei-xxxx.onrender.com 的链接
echo.
echo   那个链接就是你的永久链接，发给同事就能用。
echo.
echo 现在帮你打开 Render Blueprint 页面...
start https://dashboard.render.com/blueprints

pause