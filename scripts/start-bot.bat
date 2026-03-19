@echo off
REM ================================================================
REM 启动 CoC Bot
REM ================================================================

cd /d C:\Users\sorawatcher\workspace\coc-bot

echo [CocBot] 正在启动...
echo [CocBot] 工作目录: %CD%

bun run src/server/index.ts
