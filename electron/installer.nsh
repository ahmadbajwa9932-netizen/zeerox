!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

Var Dialog
Var Radio1
Var Radio2
Var Radio3
Var Radio4
Var Radio5
Var Radio6
Var RadioCustom
Var TextCustom
Var BackupInterval

; ============================================
; CUSTOM PAGE — pick backup interval
; ============================================
Function BackupIntervalPageCreate
  !insertmacro MUI_HEADER_TEXT "Backup Frequency" "Choose how often ZeeroX should back up your database to Google Drive"

  nsDialogs::Create 1018
  Pop $Dialog

  ${If} $Dialog == error
    Abort
  ${EndIf}

  ${NSD_CreateRadioButton} 0 0u 100% 12u "Every 1 hour"
  Pop $Radio1
  ${NSD_CreateRadioButton} 0 15u 100% 12u "Every 2 hours"
  Pop $Radio2
  ${NSD_CreateRadioButton} 0 30u 100% 12u "Every 3 hours"
  Pop $Radio3
  ${NSD_CreateRadioButton} 0 45u 100% 12u "Every 4 hours (recommended)"
  Pop $Radio4
  ${NSD_CreateRadioButton} 0 60u 100% 12u "Every 5 hours"
  Pop $Radio5
  ${NSD_CreateRadioButton} 0 75u 100% 12u "Every 6 hours"
  Pop $Radio6
  ${NSD_CreateRadioButton} 0 90u 60% 12u "Custom (hours):"
  Pop $RadioCustom
  ${NSD_CreateNumber} 120u 90u 40u 12u "7"
  Pop $TextCustom

  ${NSD_Check} $Radio4

  nsDialogs::Show
FunctionEnd

Function BackupIntervalPageLeave
  StrCpy $BackupInterval "4"

  ${NSD_GetState} $Radio1 $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $BackupInterval "1"
  ${EndIf}

  ${NSD_GetState} $Radio2 $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $BackupInterval "2"
  ${EndIf}

  ${NSD_GetState} $Radio3 $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $BackupInterval "3"
  ${EndIf}

  ${NSD_GetState} $Radio4 $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $BackupInterval "4"
  ${EndIf}

  ${NSD_GetState} $Radio5 $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $BackupInterval "5"
  ${EndIf}

  ${NSD_GetState} $Radio6 $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $BackupInterval "6"
  ${EndIf}

  ${NSD_GetState} $RadioCustom $0
  ${If} $0 == ${BST_CHECKED}
    ${NSD_GetText} $TextCustom $BackupInterval
    ${If} $BackupInterval == ""
      StrCpy $BackupInterval "4"
    ${EndIf}
  ${EndIf}
FunctionEnd

!macro customPageAfterChangeDir
  Page custom BackupIntervalPageCreate BackupIntervalPageLeave
!macroend

!macro customInstall
  ; ============================================
  ; DATABASE SETUP — import schema.sql
  ; ============================================
  DetailPrint "Checking for MySQL..."

  IfFileExists "C:\xampp\mysql\bin\mysql.exe" zx_mysql_found zx_mysql_missing

  zx_mysql_missing:
    MessageBox MB_OK|MB_ICONEXCLAMATION "MySQL not found at C:\xampp\mysql\bin\mysql.exe.$\n$\nPlease install XAMPP first, then re-run database setup manually."
    Goto zx_db_done

  zx_mysql_found:
    DetailPrint "Setting up database..."
    nsExec::ExecToLog '"C:\xampp\mysql\bin\mysql.exe" -u root -e "CREATE DATABASE IF NOT EXISTS `pos-system1`;"'
    Pop $0

    ${If} $0 != 0
      MessageBox MB_OK|MB_ICONEXCLAMATION "Database creation failed. Make sure XAMPP MySQL is running."
      Goto zx_db_done
    ${EndIf}

    DetailPrint "Importing schema.sql..."
    nsExec::ExecToLog '"C:\xampp\mysql\bin\mysql.exe" -u root pos-system1 -e "source $INSTDIR\resources\database\schema.sql"'
    Pop $0

    ${If} $0 != 0
      MessageBox MB_OK|MB_ICONEXCLAMATION "Schema import failed. Error code: $0"
    ${EndIf}

    DetailPrint "Database setup completed!"

  zx_db_done:


  ; ============================================
  ; BACKUP SYSTEM SETUP (PowerShell - No Admin)
  ; ============================================
  IfFileExists "$INSTDIR\resources\tools\rclone.exe" zx_rclone_found zx_rclone_missing

  zx_rclone_missing:
    MessageBox MB_OK|MB_ICONEXCLAMATION "rclone.exe was not found in the installed resources — backup setup skipped."
    Goto zx_backup_done

  zx_rclone_found:
    DetailPrint "Setting up backup system..."

    FileOpen $0 "$INSTDIR\resources\setup-backup.bat" w
  FileWrite $0 '@echo off$\r$\n'
  FileWrite $0 'cls$\r$\n'
  FileWrite $0 'title ZeeroX Backup Setup$\r$\n'
  FileWrite $0 'echo ======================================$\r$\n'
  FileWrite $0 'echo   ZeeroX POS - Backup Setup$\r$\n'
  FileWrite $0 'echo ======================================$\r$\n'
  FileWrite $0 'echo.$\r$\n'
  FileWrite $0 'echo Step 1/3: Google Drive Connection$\r$\n'
  FileWrite $0 'echo Browser will open - Please login$\r$\n'
  FileWrite $0 'pause$\r$\n'
  FileWrite $0 '"$INSTDIR\resources\tools\rclone.exe" config create gdrive drive scope drive$\r$\n'
  FileWrite $0 'if errorlevel 1 ($\r$\n'
  FileWrite $0 '  echo [ERROR] Failed to connect to Google Drive$\r$\n'
  FileWrite $0 '  pause$\r$\n'
  FileWrite $0 '  exit /b 1$\r$\n'
  FileWrite $0 ')$\r$\n'
  FileWrite $0 'echo.$\r$\n'
  FileWrite $0 'echo [OK] Connected!$\r$\n'
  FileWrite $0 'echo.$\r$\n'
  FileWrite $0 'echo Step 2/3: Creating scheduled task (every $BackupInterval hour(s))...$\r$\n'
  FileWrite $0 'schtasks /create /tn "ZeeroX Backup" /tr "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -NoProfile -File \"$INSTDIR\resources\run-backup.ps1\"" /sc hourly /mo $BackupInterval /f$\r$\n'
  FileWrite $0 'if errorlevel 1 ($\r$\n'
  FileWrite $0 '  echo [ERROR] Failed to create scheduled task$\r$\n'
  FileWrite $0 '  pause$\r$\n'
  FileWrite $0 '  exit /b 1$\r$\n'
  FileWrite $0 ')$\r$\n'
  FileWrite $0 'echo [OK] Scheduled!$\r$\n'
  FileWrite $0 'echo.$\r$\n'
  FileWrite $0 'echo Step 3/3: Running first backup...$\r$\n'
  FileWrite $0 'start "" /min powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -NonInteractive -NoProfile -File "$INSTDIR\resources\run-backup.ps1"$\r$\n'
  FileWrite $0 'timeout /t 2 /nobreak > nul$\r$\n'
  FileWrite $0 'cls$\r$\n'
  FileWrite $0 'color 0A$\r$\n'
  FileWrite $0 'echo ========================================$\r$\n'
  FileWrite $0 'echo        SETUP COMPLETE!$\r$\n'
  FileWrite $0 'echo ========================================$\r$\n'
  FileWrite $0 'echo Backups: Every $BackupInterval hour(s) (hidden)$\r$\n'
  FileWrite $0 'echo Check: Google Drive/ZeeroX_Backups/$\r$\n'
  FileWrite $0 'echo.$\r$\n'
  FileWrite $0 'echo Logs: %APPDATA%\ZeeroX\backup.log$\r$\n'
  FileWrite $0 'pause$\r$\n'
  FileClose $0

  MessageBox MB_YESNO "Setup Google Drive backup now?$\n(Every $BackupInterval hour(s) - takes about 2 minutes)" IDYES setup_backup IDNO skip_backup

  setup_backup:
    ExecWait '"$INSTDIR\resources\setup-backup.bat"'
    Goto backup_done

  skip_backup:
    MessageBox MB_OK "Setup later: $INSTDIR\resources\setup-backup.bat"

  backup_done:

  zx_backup_done:
  DetailPrint "Installation complete!"
!macroend