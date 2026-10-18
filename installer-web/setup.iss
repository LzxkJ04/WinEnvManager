; WinEnv管家 —— 原生 Inno Setup 安装脚本（无 WebView2，标准向导）
; 功能：升级检测 / 关闭运行中程序 / 可选加入系统 PATH / 卸载可选删用户数据

#define MyAppName "WinEnv管家"
#define MyAppVersion "1.1.0"
#define MyAppExeName "WinEnvManager.exe"

[Setup]
AppId={{8F3A7C21-9B4D-4E5A-A6C8-1D2F3B4C5D6E}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher="WinEnv"
AppComments="Windows 环境变量管理工具"
AppUpdatesURL="https://winenv.example.com/update"
DefaultDirName={autopf}\WinEnvManager
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=output
OutputBaseFilename=WinEnvManager-v{#MyAppVersion}-setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName={#MyAppName} v{#MyAppVersion}
UninstallDisplayIcon={app}\WinEnvManager.ico
SetupIconFile=pkg\WinEnvManager.ico
LicenseFile=pkg\resources\license\license.rtf

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Types]
Name: "full"; Description: "完整安装（推荐）"
Name: "compact"; Description: "精简安装"
Name: "custom"; Description: "自定义安装"; Flags: iscustom

[Components]
Name: "main"; Description: "WinEnv管家 主程序（必需）"; Types: full compact custom; Flags: fixed
Name: "templates"; Description: "内置环境规则模板"; Types: full compact custom
Name: "cli"; Description: "命令行工具 wenv.exe"; Types: full custom
Name: "readme"; Description: "快速上手文档"; Types: full compact custom

[Tasks]
Name: "startmenu"; Description: "创建开始菜单快捷方式"; GroupDescription: "快捷方式:"
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "快捷方式:"
Name: "assoc"; Description: "关联 .winenv-setting 配置文件"; GroupDescription: "系统集成:"
Name: "shellctx"; Description: "添加右键菜单「用WinEnv管家扫描目录」"; GroupDescription: "系统集成:"
Name: "addpath"; Description: "将 wenv 命令加入系统 PATH（任意目录可用）"; GroupDescription: "系统集成:"
Name: "autostart"; Description: "开机自动启动 WinEnv管家"; GroupDescription: "系统集成:"

[Files]
Source: "pkg\WinEnvManager.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "pkg\WinEnvManager.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "pkg\cli\wenv.exe"; DestDir: "{app}\cli"; Flags: ignoreversion; Components: cli
Source: "pkg\default_templates\*"; DestDir: "{app}\default_templates"; Flags: ignoreversion recursesubdirs; Components: templates
Source: "pkg\resources\license\*"; DestDir: "{app}\resources\license"; Flags: ignoreversion
Source: "pkg\resources\readme\*"; DestDir: "{app}\resources\readme"; Flags: ignoreversion; Components: readme

[Dirs]
Name: "{code:GetUserDataDir}\config"
Name: "{code:GetUserDataDir}\exports"
Name: "{code:GetUserDataDir}\snapshots"
Name: "{code:GetUserDataDir}\logs"

[Icons]
Name: "{commonprograms}\{#MyAppName}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: startmenu
Name: "{commonprograms}\{#MyAppName}\卸载 {#MyAppName}"; Filename: "{app}\winenv-setup.exe"; Parameters: "/uninstall"; Tasks: startmenu
Name: "{commondesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Registry]
Root: HKLM; Subkey: "SOFTWARE\WinEnvManager"; ValueType: string; ValueName: "InstallPath"; ValueData: "{app}"; Flags: uninsdeletekey
Root: HKLM; Subkey: "SOFTWARE\WinEnvManager"; ValueType: string; ValueName: "UserDataRoot"; ValueData: "{code:GetUserDataDir}"
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "WinEnvManager"; ValueData: """{app}\{#MyAppExeName}"""; Tasks: autostart; Flags: uninsdeletevalue
Root: HKLM; Subkey: "SOFTWARE\WinEnvManager"; ValueType: string; ValueName: "Version"; ValueData: "{#MyAppVersion}"
Root: HKLM; Subkey: "SOFTWARE\WinEnvManager"; ValueType: string; ValueName: "InstallDate"; ValueData: "{code:GetInstallDate}"
Root: HKLM; Subkey: "SOFTWARE\WinEnvManager"; ValueType: string; ValueName: "UpdateUrl"; ValueData: "https://winenv.example.com/update"
Root: HKCR; Subkey: ".winenv-setting"; ValueType: string; ValueData: "WinEnvManager.ConfigFile"; Tasks: assoc; Flags: uninsdeletekey
Root: HKCR; Subkey: "WinEnvManager.ConfigFile"; ValueType: string; ValueData: "WinEnv管家配置备份文件"; Tasks: assoc; Flags: uninsdeletekey
Root: HKCR; Subkey: "WinEnvManager.ConfigFile\DefaultIcon"; ValueType: string; ValueData: "{app}\WinEnvManager.ico"; Tasks: assoc; Flags: uninsdeletekey
Root: HKCR; Subkey: "WinEnvManager.ConfigFile\shell\open\command"; ValueType: string; ValueData: """{app}\{#MyAppExeName}"" ""%1"""; Tasks: assoc; Flags: uninsdeletekey
Root: HKCR; Subkey: "Directory\shell\WinEnvManager"; ValueType: string; ValueData: "用WinEnv管家扫描目录"; Tasks: shellctx; Flags: uninsdeletekey
Root: HKCR; Subkey: "Directory\shell\WinEnvManager"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\WinEnvManager.ico"; Tasks: shellctx
Root: HKCR; Subkey: "Directory\shell\WinEnvManager\command"; ValueType: string; ValueData: """{app}\{#MyAppExeName}"" --scan ""%1"""; Tasks: shellctx; Flags: uninsdeletekey
Root: HKCR; Subkey: "Directory\Background\shell\WinEnvManager"; ValueType: string; ValueData: "用WinEnv管家扫描目录"; Tasks: shellctx; Flags: uninsdeletekey
Root: HKCR; Subkey: "Directory\Background\shell\WinEnvManager\command"; ValueType: string; ValueData: """{app}\{#MyAppExeName}"" --scan ""%V"""; Tasks: shellctx; Flags: uninsdeletekey

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "启动 {#MyAppName}"; Flags: nowait postinstall skipifsilent
Filename: "{app}\resources\readme\quick_start.md"; Description: "查看快速上手文档"; Flags: postinstall shellexec skipifsilent unchecked

[UninstallDelete]
Type: filesandordirs; Name: "{localappdata}\WinEnvManager\Cache"

[Code]
const
  ENV_KEY = 'SYSTEM\CurrentControlSet\Control\Session Manager\Environment';
  MY_WM_SETTINGCHANGE = $001A;
  MY_HWND_BROADCAST = $FFFF;

function GetInstallDate(Param: string): string;
begin
  Result := GetDateTimeString('yyyy/mm/dd hh:nn:ss', '-', ':');
end;

// ---------- 引导壳参数：/USERDATA="路径" ----------
// Tauri 引导壳通过命令行传递用户数据目录；双击直接运行时回落默认值

function GetUserDataParam(): string;
var
  Tail: string;
  P, Q: Integer;
begin
  Result := '';
  Tail := GetCmdTail();
  P := Pos('/USERDATA=', Tail);
  if P = 0 then Exit;
  Tail := Copy(Tail, P + 10, MaxInt);
  if Copy(Tail, 1, 1) = '"' then
  begin
    Q := Pos('"', Copy(Tail, 2, MaxInt));
    if Q > 0 then Result := Copy(Tail, 2, Q - 1);
  end
  else
  begin
    Q := Pos(' /', Tail);
    if Q = 0 then Result := Trim(Tail) else Result := Trim(Copy(Tail, 1, Q - 1));
  end;
end;

function GetUserDataDir(Param: string): string;
var
  UD: string;
begin
  UD := GetUserDataParam();
  if UD = '' then
    Result := ExpandConstant('{localappdata}\WinEnvManager')
  else
    Result := UD;
end;

// ---------- 系统 PATH 操作（保持 REG_EXPAND_SZ） ----------

procedure BroadcastEnvChange();
var
  EnvStr: string;
begin
  EnvStr := 'Environment';
  SendBroadcastMessage(MY_WM_SETTINGCHANGE, 0, CastStringToInteger(EnvStr));
end;

procedure AddToPath(Dir: string);
var
  OldPath, NewPath: string;
begin
  if not RegQueryStringValue(HKLM, ENV_KEY, 'Path', OldPath) then
    OldPath := '';
  if Pos(';' + LowerCase(OldPath) + ';', ';' + LowerCase(Dir) + ';') > 0 then
    Exit;
  if Pos(LowerCase(Dir) + ';', LowerCase(OldPath) + ';') > 0 then
    Exit;
  if OldPath = '' then
    NewPath := Dir
  else
    NewPath := RemoveBackslashUnlessRoot(OldPath) + ';' + Dir;
  RegWriteExpandStringValue(HKLM, ENV_KEY, 'Path', NewPath);
  BroadcastEnvChange();
end;

procedure RemoveFromPath(Dir: string);
var
  OldPath, NewPath, Want: string;
begin
  if not RegQueryStringValue(HKLM, ENV_KEY, 'Path', OldPath) then
    Exit;
  Want := LowerCase(Dir);
  NewPath := ';' + LowerCase(OldPath) + ';';
  StringChangeEx(NewPath, ';' + Want + ';', ';', True);
  // 恢复原始大小写：按结果长度从 OldPath 中截取
  NewPath := Copy(NewPath, 2, Length(NewPath) - 2);
  if NewPath <> LowerCase(OldPath) then
  begin
    // 用保留大小写的方式重建：逐段过滤
    NewPath := '';
    while Pos(';', OldPath) > 0 do
    begin
      Want := Copy(OldPath, 1, Pos(';', OldPath) - 1);
      OldPath := Copy(OldPath, Pos(';', OldPath) + 1, MaxInt);
      if (Want <> '') and (LowerCase(Want) <> LowerCase(Dir)) then
        NewPath := NewPath + ';' + Want;
    end;
    if (OldPath <> '') and (LowerCase(OldPath) <> LowerCase(Dir)) then
      NewPath := NewPath + ';' + OldPath;
    NewPath := Copy(NewPath, 2, MaxInt);
    RegWriteExpandStringValue(HKLM, ENV_KEY, 'Path', NewPath);
    BroadcastEnvChange();
  end;
end;

// ---------- 运行中程序关闭 ----------

procedure KillRunningApp();
var
  R: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/f /im {#MyAppExeName} /t', '',
       SW_HIDE, ewWaitUntilTerminated, R);
end;

// ---------- 安装流程 ----------

function InitializeSetup(): Boolean;
var
  OldVer: string;
begin
  Result := True;
  if RegQueryStringValue(HKLM, 'SOFTWARE\WinEnvManager', 'Version', OldVer) then
  begin
    // 引导壳已在自己的界面里确认过，静默模式不再弹窗
    if WizardSilent() then Exit;
    if MsgBox('检测到已安装 WinEnv管家 v' + OldVer + '。' #13#10 +
              '将继续安装 v{#MyAppVersion}（升级模式，用户数据保留）。' #13#10 #13#10 +
              '是否继续？', mbInformation, MB_YESNO) = IDNO then
      Result := False;
  end;
end;

function UninstKey(): string;
begin
  Result := 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\' +
    Chr(123) + '8F3A7C21-9B4D-4E5A-A6C8-1D2F3B4C5D6E' + Chr(125) + '_is1';
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  R: Integer;
begin
  if CurStep = ssInstall then
    KillRunningApp();
  if CurStep = ssPostInstall then
  begin
    if WizardIsTaskSelected('addpath') then
      AddToPath(ExpandConstant('{app}\cli'));
    if WizardIsTaskSelected('assoc') then
      // 刷新图标缓存让新关联立即生效
      Exec(ExpandConstant('{sys}\ie4uinit.exe'), '-show', '', SW_HIDE,
           ewWaitUntilTerminated, R);
  end;
  // ssDone 时卸载项已写完。键名里的花括号用字符码拼，避免被预处理吃掉。
  if CurStep = ssDone then
  begin
    RegWriteStringValue(HKLM, UninstKey(),
      'UninstallString', ExpandConstant('"{app}\winenv-setup.exe" /uninstall'));
    RegWriteStringValue(HKLM, UninstKey(),
      'QuietUninstallString', ExpandConstant('"{uninstallexe}" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART'));
  end;
end;

// ---------- 卸载流程 ----------

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
  begin
    KillRunningApp();
    RemoveFromPath(ExpandConstant('{app}\cli'));
    // 用户数据目录的删除决策交由 Tauri 引导壳（卸载 UI 收集选项后自行清理）
    if (not UninstallSilent()) and
       (MsgBox('是否同时删除用户数据（环境规则、设置与缓存）？' #13#10 +
              '选择「否」将保留数据，重装后可继续使用。', mbConfirmation, MB_YESNO) = IDYES) then
      DelTree(ExpandConstant('{localappdata}\WinEnvManager'), True, True, True);
  end;
end;
