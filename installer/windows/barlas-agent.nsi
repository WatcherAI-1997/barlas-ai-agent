Unicode true
RequestExecutionLevel user
ManifestDPIAware true

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"

!ifndef SOURCE_ARCHIVE
  !error "SOURCE_ARCHIVE must point to the release source zip"
!endif
!ifndef BOOTSTRAP_SCRIPT
  !error "BOOTSTRAP_SCRIPT must point to install-windows.ps1"
!endif
!ifndef BRAND_BITMAP
  !error "BRAND_BITMAP must point to the installer bitmap"
!endif
!ifndef BRAND_ICON
  !error "BRAND_ICON must point to the installer icon"
!endif
!ifndef OUTPUT_FILE
  !define OUTPUT_FILE "Barlas-AI-Agent-Setup.exe"
!endif

Name "Barlas AI Agent"
Caption "Barlas AI Agent — Setup"
BrandingText "THINK AHEAD. ACT BEYOND."
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\Barlas"
ShowInstDetails show
ShowUninstDetails show

!define MUI_ICON "${BRAND_ICON}"
!define MUI_UNICON "${BRAND_ICON}"
!define MUI_WELCOMEFINISHPAGE_BITMAP "${BRAND_BITMAP}"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "${BRAND_BITMAP}"
!define MUI_BGCOLOR "000000"
!define MUI_TEXTCOLOR "FFFFFF"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Open Barlas"
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchBarlas
!define MUI_FINISHPAGE_LINK "Installation log"
!define MUI_FINISHPAGE_LINK_LOCATION "$LOCALAPPDATA\Barlas\logs\install.log"

Var LanguageField
Var NameField
Var EmailField
Var ShortcutField
Var SelectedLanguage
Var OwnerName
Var OwnerEmail
Var CreateShortcut

!insertmacro MUI_PAGE_WELCOME
Page custom OptionsCreate OptionsLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_WELCOME
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "Russian"

Function .onInit
  StrCpy $SelectedLanguage "ru"
  StrCpy $OwnerName "Barlas Owner"
  StrCpy $OwnerEmail "owner@barlas.local"
  StrCpy $CreateShortcut ${BST_CHECKED}
FunctionEnd

Function OptionsCreate
  !insertmacro MUI_HEADER_TEXT "Personal setup" "Choose the language and local owner identity. You can change everything later."
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 2u 100% 16u "Interface language"
  Pop $0
  ${NSD_CreateDropList} 0 20u 100% 72u ""
  Pop $LanguageField
  ${NSD_CB_AddString} $LanguageField "Русский"
  ${NSD_CB_AddString} $LanguageField "English"
  ${NSD_CB_AddString} $LanguageField "O‘zbekcha"
  ${NSD_CB_SelectString} $LanguageField "Русский"

  ${NSD_CreateLabel} 0 55u 100% 16u "Your name"
  Pop $0
  ${NSD_CreateText} 0 73u 100% 14u "$OwnerName"
  Pop $NameField

  ${NSD_CreateLabel} 0 98u 100% 16u "Local owner email (never published)"
  Pop $0
  ${NSD_CreateText} 0 116u 100% 14u "$OwnerEmail"
  Pop $EmailField

  ${NSD_CreateCheckbox} 0 148u 100% 14u "Create Desktop and Start Menu shortcuts"
  Pop $ShortcutField
  ${NSD_SetState} $ShortcutField $CreateShortcut

  ${NSD_CreateLabel} 0 178u 100% 36u "Barlas installs only for your Windows account, listens only on 127.0.0.1, and preserves the previous version if an update fails. Model sign-in happens after the first launch."
  Pop $0
  SetCtlColors $0 888888 transparent

  nsDialogs::Show
FunctionEnd

Function OptionsLeave
  ${NSD_GetText} $LanguageField $0
  ${If} $0 == "English"
    StrCpy $SelectedLanguage "en"
  ${ElseIf} $0 == "O‘zbekcha"
    StrCpy $SelectedLanguage "uz"
  ${Else}
    StrCpy $SelectedLanguage "ru"
  ${EndIf}
  ${NSD_GetText} $NameField $OwnerName
  ${NSD_GetText} $EmailField $OwnerEmail
  ${NSD_GetState} $ShortcutField $CreateShortcut
  ${If} $OwnerName == ""
    MessageBox MB_ICONEXCLAMATION "Enter your name."
    Abort
  ${EndIf}
  ${If} $OwnerEmail == ""
    MessageBox MB_ICONEXCLAMATION "Enter a local owner email."
    Abort
  ${EndIf}
FunctionEnd

Section "Install Barlas" SEC_MAIN
  SetOutPath "$PLUGINSDIR"
  File /oname=install-windows.ps1 "${BOOTSTRAP_SCRIPT}"
  File /oname=barlas-source.zip "${SOURCE_ARCHIVE}"

  System::Call 'Kernel32::SetEnvironmentVariable(t "OWNER_LANGUAGE", t "$SelectedLanguage") i.r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t "OWNER_DISPLAY_NAME", t "$OwnerName") i.r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t "OWNER_EMAIL", t "$OwnerEmail") i.r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t "BARLAS_SETUP_MODE", t "quick") i.r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t "MODEL_PROVIDER", t "codex_cli") i.r0'

  DetailPrint "Installing the private runtime and Barlas application…"
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\install-windows.ps1" -SourceArchive "$PLUGINSDIR\barlas-source.zip" -NonInteractive -NoLaunch'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Barlas could not be installed. The previous version was restored when available.$\r$\n$\r$\nLog: $LOCALAPPDATA\Barlas\logs\install.log"
    SetErrorLevel 1
    Abort
  ${EndIf}

  ${If} $CreateShortcut != ${BST_CHECKED}
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$LOCALAPPDATA\Barlas\app\scripts\desktop-native.ps1" -Action uninstall'
    Pop $0
  ${EndIf}

  SetOutPath "$LOCALAPPDATA\Barlas"
  WriteUninstaller "$LOCALAPPDATA\Barlas\Uninstall Barlas.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Barlas AI Agent" "DisplayName" "Barlas AI Agent"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Barlas AI Agent" "DisplayIcon" "$LOCALAPPDATA\Barlas\Uninstall Barlas.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Barlas AI Agent" "UninstallString" '"$LOCALAPPDATA\Barlas\Uninstall Barlas.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Barlas AI Agent" "Publisher" "Barlas"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Barlas AI Agent" "DisplayVersion" "0.1.0"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Barlas AI Agent" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Barlas AI Agent" "NoRepair" 1
SectionEnd

Function LaunchBarlas
  Exec '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$LOCALAPPDATA\Barlas\app\scripts\desktop-native.ps1" -Action open'
FunctionEnd

Section "Uninstall"
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$LOCALAPPDATA\Barlas\app\scripts\uninstall-native.ps1" -Yes'
  Pop $0
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Barlas AI Agent"
  Delete "$LOCALAPPDATA\Barlas\Uninstall Barlas.exe"
  RMDir "$LOCALAPPDATA\Barlas"
SectionEnd
