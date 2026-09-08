!macro customInit
  ; 检查并强制关闭正在运行的残留进程，防止用户因为旧版后台残留死锁而弹出"无法关闭"的报错
  nsExec::Exec 'cmd.exe /c "taskkill /F /IM \"DeepSeek Harness.exe\" /T"'
  Sleep 500
!macroend
