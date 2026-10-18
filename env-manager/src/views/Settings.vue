<template>
  <div>
    <!-- 界面与主题 -->
    <div class="wem-card">
      <div class="wem-card-head"><div class="wem-card-title"><BgColorsOutlined /> 界面与主题</div></div>
      <div class="wem-card-body">
        <div class="row">
          <span class="row-label">主题模式</span>
          <a-radio-group :value="ui.theme" button-style="solid" @change="onThemeChange">
            <a-radio-button value="light"><BulbOutlined /> 浅色</a-radio-button>
            <a-radio-button value="dark"><BulbFilled /> 深色</a-radio-button>
            <a-radio-button value="system"><DesktopOutlined /> 跟随系统</a-radio-button>
          </a-radio-group>
          <span class="text-muted">当前实际生效：{{ ui.isDark ? '深色' : '浅色' }}</span>
        </div>
        <div class="row">
          <span class="row-label">主色调</span>
          <input type="color" v-model="cfg.primaryColor" class="color-input" @change="save({ primaryColor: cfg.primaryColor })" />
          <a-tag v-for="c in presetColors" :key="c" :style="{ background: c, cursor: 'pointer' }" @click="save({ primaryColor: c })">&nbsp;&nbsp;&nbsp;</a-tag>
        </div>
        <div class="row">
          <span class="row-label">状态提示色</span>
          <span class="text-muted">成功</span>
          <input type="color" :value="cfg.colorSuccess || '#00b42a'" class="color-input" @change="(e) => save({ colorSuccess: e.target.value })" />
          <span class="text-muted">警告</span>
          <input type="color" :value="cfg.colorWarning || '#ff7d00'" class="color-input" @change="(e) => save({ colorWarning: e.target.value })" />
          <span class="text-muted">错误</span>
          <input type="color" :value="cfg.colorError || '#f53f3f'" class="color-input" @change="(e) => save({ colorError: e.target.value })" />
          <span class="text-muted">信息</span>
          <input type="color" :value="cfg.colorInfo || '#165DFF'" class="color-input" @change="(e) => save({ colorInfo: e.target.value })" />
        </div>
        <div class="row">
          <span class="row-label">代码预览字号</span>
          <a-input-number :value="cfg.editorFontSize || 12" size="small" :min="10" :max="20" @change="(v) => save({ editorFontSize: v })" />
          <span class="row-label" style="width:auto">日志面板字号</span>
          <a-input-number :value="cfg.logFontSize || 12" size="small" :min="10" :max="20" @change="(v) => save({ logFontSize: v })" />
          <span class="text-muted">与主界面字体字号互相独立</span>
        </div>
        <div class="row">
          <span class="row-label">页面切换动画</span>
          <a-switch :checked="cfg.animPage !== false" @change="(v) => save({ animPage: v })" />
          <span class="row-label" style="width:auto">弹窗动画</span>
          <a-switch :checked="cfg.animModal !== false" @change="(v) => save({ animModal: v })" />
          <span class="row-label" style="width:auto">美化滚动条</span>
          <a-switch :checked="cfg.animScrollbar !== false" @change="(v) => save({ animScrollbar: v })" />
        </div>
        <div class="row">
          <span class="row-label">全局唤起热键</span>
          <a-input
            :value="cfg.hotkeySearch"
            size="small"
            class="mono"
            style="width: 220px"
            placeholder="如 Ctrl+Shift+W，留空不注册"
            @change="(e) => save({ hotkeySearch: e.target.value })"
          />
          <a-switch :checked="cfg.hotkeyEnabled !== false" @change="(v) => save({ hotkeyEnabled: v })" />
          <span class="text-muted">按下后唤起主窗口并打开全局搜索；改动即时生效</span>
        </div>
        <div class="row">
          <span class="row-label">界面语言</span>
          <a-select :value="cfg.language || 'zh-CN'" size="small" style="width: 140px" @change="(v) => save({ language: v })">
            <a-select-option value="zh-CN">简体中文</a-select-option>
            <a-select-option value="en-US">English（部分翻译）</a-select-option>
          </a-select>
          <span class="text-muted">只切换组件语言，例如分页、日期和空状态。界面文案仍是中文</span>
        </div>
        <div class="row">
          <span class="row-label">表格分页大小</span>
          <a-input-number :value="cfg.pageSize || 20" size="small" :min="10" :max="200" @change="(v) => save({ pageSize: v })" />
          <span class="row-label" style="width:auto">表格行高</span>
          <a-radio-group :value="cfg.rowHeight || 'middle'" size="small" @change="(e) => save({ rowHeight: e.target.value })">
            <a-radio-button value="small">紧凑</a-radio-button>
            <a-radio-button value="middle">标准</a-radio-button>
            <a-radio-button value="large">宽松</a-radio-button>
          </a-radio-group>
        </div>
        <div class="row">
          <span class="row-label">界面字号</span>
          <a-radio-group
            :value="[12, 13, 15, 17].includes(Number(cfg.fontSize)) ? Number(cfg.fontSize) : undefined"
            size="small"
            @change="(e) => save({ fontSize: e.target.value })"
          >
            <a-radio-button :value="12">小</a-radio-button>
            <a-radio-button :value="13">标准</a-radio-button>
            <a-radio-button :value="15">大</a-radio-button>
            <a-radio-button :value="17">超大</a-radio-button>
          </a-radio-group>
          <a-input-number :value="cfg.fontSize || 13" size="small" :min="12" :max="20" @change="(v) => save({ fontSize: v })" />
          <span class="text-muted">顶栏 A- / A+ 可随时微调，中间数字可切换预设，立即作用于菜单、表格和按钮</span>
        </div>
        <div class="row">
          <span class="row-label">侧边导航</span>
          <a-switch :checked="!ui.sidebarCollapsed" checked-children="展开" un-checked-children="收起" @change="(v) => (ui.sidebarCollapsed = !v)" />
        </div>
        <div class="row">
          <span class="row-label">紧凑布局</span>
          <a-switch :checked="!!cfg.compactMode" @change="(v) => save({ compactMode: v })" />
          <span class="text-muted">缩小卡片间距和表格行距，一屏能看到更多设置</span>
        </div>
        <div class="row">
          <span class="row-label">状态栏显示 PATH 条数</span>
          <a-switch :checked="cfg.showPathCount !== false" @change="(v) => save({ showPathCount: v })" />
        </div>
        <div class="hint-box" style="margin-top: 12px">
          <InfoCircleOutlined />
          <div>浅色是默认主题。深色会同时改页面底色和组件配色；「跟随系统」会随 Windows 外观切换。主色和字号立即作用于按钮、菜单和表格。</div>
        </div>
      </div>
    </div>

    <!-- 草稿与保存 -->
    <div class="wem-card">
      <div class="wem-card-head"><div class="wem-card-title"><RocketOutlined /> 启动 / 草稿与保存</div></div>
      <div class="wem-card-body">
        <div class="row"><span class="row-label">启动时自动加载变量</span><a-switch :checked="cfg.loadOnStart !== false" @change="(v) => save({ loadOnStart: v })" /></div>
        <div class="row"><span class="row-label">启动时最小化到托盘</span><a-switch :checked="!!cfg.startMinimized" @change="(v) => save({ startMinimized: v })" /></div>
        <div class="row"><span class="row-label">开机自动启动</span><a-switch :checked="autoLaunch" :loading="launchLoading" @change="onAutoLaunch" /></div>
        <div class="row"><span class="row-label">保存前自动创建快照</span><a-switch :checked="cfg.autoSnapshot !== false" @change="(v) => save({ autoSnapshot: v })" /><span class="text-muted">每次保存前抓取一份环境快照，便于回滚</span></div>
        <div class="row"><span class="row-label">保存前强制校验 PATH 长度</span><a-switch :checked="cfg.saveValidatePath !== false" @change="(v) => save({ saveValidatePath: v })" /></div>
        <div class="row"><span class="row-label">撤销重做栈最大步数</span><a-input-number :value="cfg.undoMaxSteps || 50" size="small" :min="10" :max="200" @change="(v) => save({ undoMaxSteps: v })" /></div>
        <div class="row"><span class="row-label">保存完成后自动重启资源管理器</span><a-switch :checked="!!cfg.autoRestartExplorerAfterSave" @change="(v) => save({ autoRestartExplorerAfterSave: v })" /></div>
        <div class="row"><span class="row-label">检测外部注册表变更提醒</span><a-switch :checked="cfg.detectExternal !== false" @change="(v) => save({ detectExternal: v })" /></div>
        <div class="row"><span class="row-label">草稿自动保存到本地缓存</span><a-switch :checked="cfg.draftAutoSave !== false" @change="(v) => save({ draftAutoSave: v })" /><span class="text-muted">防止软件崩溃丢失草稿</span></div>
        <div class="row"><span class="row-label">关闭软件时保留草稿</span><a-switch :checked="cfg.keepDraftOnExit !== false" @change="(v) => save({ keepDraftOnExit: v })" /></div>
        <div class="row"><span class="row-label">有未保存草稿时退出确认</span><a-switch :checked="cfg.confirmOnQuit !== false" @change="(v) => save({ confirmOnQuit: v })" /></div>
        <div class="row"><span class="row-label">记住窗口位置与大小</span><a-switch :checked="cfg.rememberWindow !== false" @change="(v) => save({ rememberWindow: v })" /></div>
        <div class="row"><span class="row-label">保存前二次确认弹窗</span><a-switch :checked="cfg.confirmBeforeSave !== false" @change="(v) => save({ confirmBeforeSave: v })" /></div>
      </div>
    </div>

    <!-- 开发环境配置 -->
    <div class="wem-card">
      <div class="wem-card-head">
        <div class="wem-card-title"><CloudDownloadOutlined /> 开发环境配置</div>
        <a-button size="small" @click="api.devenv.cacheStats().then(showCache)">查看缓存占用</a-button>
        <a-button size="small" danger @click="clearCache">一键清空缓存</a-button>
      </div>
      <div class="wem-card-body">
        <div class="row">
          <span class="row-label">默认安装根目录</span>
          <a-input :value="cfg.devRoot" readonly class="mono" style="width: 300px" />
          <a-button size="small" @click="chooseDevRoot">更换</a-button>
          <a-button size="small" @click="api.devenv.openDir('dev')">打开</a-button>
        </div>
        <div class="row">
          <span class="row-label">安装包缓存目录</span>
          <a-input :value="paths.cacheDir" readonly class="mono" style="width: 300px" />
          <span class="row-label" style="width:auto">上限</span>
          <a-input-number :value="cfg.cacheMaxMB || 2048" size="small" :min="256" :max="51200" @change="(v) => save({ cacheMaxMB: v })" />
          <span class="text-muted">MB</span>
        </div>
        <div class="row">
          <span class="row-label">下载源</span>
          <a-radio-group :value="cfg.downloadSource || 'mirror'" size="small" button-style="solid" @change="(e) => save({ downloadSource: e.target.value })">
            <a-radio-button value="official">官方源</a-radio-button>
            <a-radio-button value="mirror">国内镜像</a-radio-button>
          </a-radio-group>
          <span class="text-muted">最大并发下载：</span>
          <a-input-number :value="cfg.maxConcurrentDownloads || 2" size="small" :min="1" :max="5" @change="(v) => save({ maxConcurrentDownloads: v })" />
        </div>
        <div class="row">
          <span class="row-label">镜像地址（留空使用内置）</span>
          <div class="mirror-grid">
            <div v-for="m in mirrorKeys" :key="m.key" class="mirror-row">
              <span class="mono mirror-key">{{ m.label }}</span>
              <a-input :value="cfg[m.key]" size="small" class="mono" :placeholder="m.placeholder" @change="(e) => save({ [m.key]: e.target.value })" />
            </div>
          </div>
        </div>
        <div class="row"><span class="row-label">部署完成自动校验版本</span><a-switch :checked="cfg.deployVerifyVersion !== false" @change="(v) => save({ deployVerifyVersion: v })" /></div>
        <div class="row">
          <span class="row-label">多版本管理策略</span>
          <a-radio-group :value="cfg.multiVersionMode || 'coexist'" size="small" @change="(e) => save({ multiVersionMode: e.target.value })">
            <a-radio-button value="coexist">共存模式（推荐）</a-radio-button>
            <a-radio-button value="overwrite">覆盖模式</a-radio-button>
          </a-radio-group>
        </div>
        <div class="row"><span class="row-label">数据库安装默认注册 Windows 服务</span><a-switch :checked="!!cfg.dbRegisterService" @change="(v) => save({ dbRegisterService: v })" /></div>
        <div class="row"><span class="row-label">任务依赖编排</span><a-switch :checked="cfg.taskDepends !== false" @change="(v) => save({ taskDepends: v })" /><span class="text-muted">例如安装 JDK 后自动安装 Maven</span></div>
        <div class="row"><span class="row-label">下载文件哈希校验</span><a-switch :checked="cfg.verifyHash !== false" @change="(v) => save({ verifyHash: v })" /><span class="text-muted">防止文件损坏或被篡改</span></div>
      </div>
    </div>

    <!-- 自动扫描识别 -->
    <div class="wem-card">
      <div class="wem-card-head">
        <div class="wem-card-title"><SearchOutlined /> 自动扫描识别</div>
        <div class="toolbar">
          <a-button size="small" @click="rulesOpen = true">识别规则管理（{{ rulesCount }} 条）</a-button>
          <a-button size="small" @click="exportRules">导出规则</a-button>
          <a-button size="small" @click="importRules">导入规则</a-button>
        </div>
      </div>
      <div class="wem-card-body">
        <div class="row"><span class="row-label">软件启动时自动扫描</span><a-switch :checked="cfg.scanOnStart !== false" @change="(v) => save({ scanOnStart: v })" /></div>
        <div class="row"><span class="row-label">进入开发环境页自动轻量扫描</span><a-switch :checked="cfg.scanOnEnterPage !== false" @change="(v) => save({ scanOnEnterPage: v })" /></div>
        <div class="row"><span class="row-label">深度扫描</span><a-switch :checked="!!cfg.deepScan" @change="(v) => save({ deepScan: v })" /><span class="text-muted">识别更全，扫描耗时更长</span></div>
        <div class="row">
          <span class="row-label">扫描超时</span>
          <a-input-number :value="cfg.scanTimeoutSec || 90" size="small" :min="30" :max="600" @change="(v) => save({ scanTimeoutSec: v })" />
          <span class="text-muted">秒，防止长时间扫描卡死</span>
        </div>
        <div class="row">
          <span class="row-label">扫描并发线程数</span>
          <a-input-number :value="cfg.scanThreads || 4" size="small" :min="1" :max="16" @change="(v) => save({ scanThreads: v })" />
          <span class="text-muted">数值越高扫描越快，网络盘场景建议调低</span>
        </div>
        <div class="row">
          <span class="row-label">单路径校验超时</span>
          <a-input-number :value="cfg.pathTimeoutSec || 10" size="small" :min="2" :max="60" @change="(v) => save({ pathTimeoutSec: v })" />
          <span class="text-muted">秒，超过判定不可访问并跳过</span>
        </div>
        <div class="row">
          <span class="row-label">跳过系统保护目录</span>
          <a-switch :checked="cfg.scanSkipSystemDirs !== false" @change="(v) => save({ scanSkipSystemDirs: v })" />
          <span class="text-muted">关闭后可扫系统目录，但会出现大量权限拒绝告警</span>
        </div>
        <div class="row">
          <span class="row-label">检测网络映射盘</span>
          <a-switch :checked="!!cfg.scanDetectNetworkDrive" @change="(v) => save({ scanDetectNetworkDrive: v })" />
          <span class="row-label" style="width:auto">检测可移动磁盘</span>
          <a-switch :checked="cfg.scanDetectRemovable !== false" @change="(v) => save({ scanDetectRemovable: v })" />
        </div>
        <div class="row">
          <span class="row-label">PATH 校验忽略目录</span>
          <div style="flex:1">
            <div class="exclude-names">
              <a-tag v-for="(d, i) in pathIgnoreDirs" :key="d" closable @close="removeIgnoreDir(i)">{{ d }}</a-tag>
              <span v-if="!pathIgnoreDirs.length" class="text-muted" style="font-size:12px">校验所有 PATH 条目</span>
            </div>
            <a-input-search
              v-model:value="ignoreDirInput"
              size="small"
              class="mono"
              placeholder="输入目录路径后回车，支持尾部 * 通配"
              enter-button="添加"
              style="max-width: 420px; margin-top: 6px"
              @search="addIgnoreDir"
            />
          </div>
        </div>
        <div class="row">
          <span class="row-label">扫描缓存目录</span>
          <a-input :value="paths.cacheDir" readonly class="mono" style="width: 320px" />
          <a-button size="small" :disabled="portable" @click="chooseCacheDir">更换</a-button>
          <a-button size="small" danger @click="clearScanCache">清空扫描缓存</a-button>
          <span v-if="portable" class="text-muted">便携模式下锁定</span>
        </div>
        <div class="row">
          <span class="row-label">定时自动审计</span>
          <a-select :value="String(cfg.auditIntervalHours || 0)" size="small" style="width: 160px" @change="(v) => save({ auditIntervalHours: Number(v) })">
            <a-select-option value="0">关闭</a-select-option>
            <a-select-option value="24">每天</a-select-option>
            <a-select-option value="168">每周</a-select-option>
          </a-select>
          <span class="text-muted">到期后在启动时扫描，发现未纳入管理的软件会弹窗提醒</span>
        </div>
        <div class="row">
          <span class="row-label">自定义扫描目录</span>
          <div style="flex:1">
            <div v-for="(d, i) in scanCustomDirs" :key="i" class="mono" style="font-size:12px;margin-bottom:4px">
              {{ d }} <a class="danger-link" style="margin-left:8px" @click="removeDir(i)">移除</a>
            </div>
            <a-button size="small" @click="addScanDir">添加目录</a-button>
          </div>
        </div>
        <div class="row">
          <span class="row-label">扫描排除目录</span>
          <div style="flex:1">
            <div v-for="(d, i) in scanExcludeDirs" :key="i" class="mono" style="font-size:12px;margin-bottom:4px">
              {{ d }} <a class="danger-link" style="margin-left:8px" @click="removeExcludeDir(i)">移除</a>
            </div>
            <div v-if="!scanExcludeDirs.length" class="text-muted" style="font-size:12px;margin-bottom:6px">未排除任何目录。Windows、回收站等系统目录默认不会扫。</div>
            <a-button size="small" @click="addExcludeDir">添加排除目录</a-button>
          </div>
        </div>
        <div class="row">
          <span class="row-label">扫描排除软件名</span>
          <div style="flex:1">
            <div class="exclude-names">
              <a-tag v-for="(n, i) in scanExcludeNames" :key="n" closable @close="removeExcludeName(i)">{{ n }}</a-tag>
              <span v-if="!scanExcludeNames.length" class="text-muted" style="font-size:12px">未按名称排除</span>
            </div>
            <a-input-search
              v-model:value="excludeNameInput"
              size="small"
              placeholder="输入软件名后回车，例如 node"
              enter-button="添加"
              style="max-width: 360px; margin-top: 6px"
              @search="addExcludeName"
            />
          </div>
        </div>
        <div class="row">
          <span class="row-label">忽略软件清单</span>
          <div style="flex:1">
            <div v-for="(x, i) in ignoreList" :key="i" class="mono" style="font-size:12px;margin-bottom:4px">
              {{ x }} <a style="margin-left:8px" @click="restoreIgnored(x)">恢复</a>
            </div>
            <div v-if="!ignoreList.length" class="text-muted" style="font-size:12px">暂无被忽略的软件</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 备份与快照 -->
    <div class="wem-card">
      <div class="wem-card-head"><div class="wem-card-title"><SafetyCertificateOutlined /> 备份与快照</div></div>
      <div class="wem-card-body">
        <div class="row">
          <span class="row-label">定时自动备份</span>
          <a-select :value="cfg.backupSchedule || 'off'" size="small" style="width: 140px" @change="(v) => save({ backupSchedule: v })">
            <a-select-option value="off">关闭</a-select-option>
            <a-select-option value="daily">每天</a-select-option>
            <a-select-option value="weekly">每周</a-select-option>
          </a-select>
          <span class="row-label" style="width:auto">保留数量上限</span>
          <a-input-number :value="cfg.backupKeep || 20" size="small" :min="5" :max="200" @change="(v) => save({ backupKeep: v })" />
        </div>
        <div class="row">
          <span class="row-label">快照最大保存数量</span>
          <a-input-number :value="cfg.snapshotMax || 50" size="small" :min="10" :max="500" @change="(v) => save({ snapshotMax: v })" />
          <span class="text-muted">超出自动清理最早的自动快照</span>
        </div>
        <div class="row">
          <span class="row-label">备份存储目录</span>
          <a-input :value="paths.backupDir" readonly class="mono" style="width: 380px" />
          <a-button size="small" :disabled="portable" @click="chooseBackupDir">更换目录</a-button>
          <a-button size="small" @click="openPath(paths.backupDir)">打开</a-button>
          <span v-if="portable" class="text-muted">便携模式下锁定，备份随移动介质存储</span>
        </div>
        <div class="row">
          <span class="row-label">备份加密密码预设</span>
          <a-input-password :value="cfg.backupPassword" size="small" style="width: 240px" placeholder="用于增量备份与加密导出" @change="(e) => save({ backupPassword: e.target.value })" />
        </div>
        <div class="row">
          <span class="row-label">自动快照触发时机</span>
          <a-radio-group :value="cfg.snapshotTrigger || 'quit'" size="small" @change="(e) => save({ snapshotTrigger: e.target.value })">
            <a-radio-button value="start">软件启动时</a-radio-button>
            <a-radio-button value="quit">软件关闭时</a-radio-button>
            <a-radio-button value="off">关闭自动快照</a-radio-button>
          </a-radio-group>
          <span class="text-muted">写入系统前始终会自动生成快照，不受此项影响</span>
        </div>
        <div class="row">
          <span class="row-label">配置自动备份</span>
          <a-switch :checked="cfg.configAutoBackup !== false" @change="(v) => save({ configAutoBackup: v })" />
          <span class="row-label" style="width:auto">保留份数</span>
          <a-input-number :value="cfg.configBackupKeep || 5" size="small" :min="1" :max="50" @change="(v) => save({ configBackupKeep: v })" />
          <span class="text-muted">配置损坏时启动自动用最近一份修复</span>
        </div>
        <div class="row">
          <span class="row-label">快照压缩存储</span>
          <a-switch :checked="!!cfg.snapshotCompress" @change="(v) => save({ snapshotCompress: v })" />
          <span class="text-muted">关闭后快照为 JSON 明文，可用外部编辑器直接查看</span>
        </div>
      </div>
    </div>

    <!-- 日志 -->
    <div class="wem-card">
      <div class="wem-card-head">
        <div class="wem-card-title"><FileTextOutlined /> 操作日志与审计</div>
        <div class="toolbar">
          <a-button size="small" @click="openPath(paths.logs)">打开日志目录</a-button>
          <a-button size="small" @click="$router.push('/audit')">审计面板</a-button>
          <a-button size="small" danger @click="clearLogs">清空日志</a-button>
        </div>
      </div>
      <div class="wem-card-body">
        <div class="row"><span class="row-label">记录操作日志</span><a-switch :checked="cfg.logEnabled !== false" @change="(v) => save({ logEnabled: v })" /></div>
        <div class="row">
          <span class="row-label">日志保留天数</span>
          <a-input-number :value="cfg.logKeepDays || 30" size="small" :min="3" :max="365" @change="(v) => save({ logKeepDays: v })" />
          <span class="row-label" style="width:auto">日志保留份数</span>
          <a-input-number :value="cfg.logKeepCount || 10" size="small" :min="1" :max="100" @change="(v) => save({ logKeepCount: v })" />
          <span class="row-label" style="width:auto">任务日志保留天数</span>
          <a-input-number :value="cfg.taskLogKeepDays || 30" size="small" :min="3" :max="365" @change="(v) => save({ taskLogKeepDays: v })" />
        </div>
        <div class="row">
          <span class="row-label">性能追踪</span>
          <a-switch :checked="!!cfg.perfTrace" @change="(v) => save({ perfTrace: v })" />
          <span class="text-muted">在日志里记录扫描、快照生成的耗时，用于排查卡慢</span>
        </div>
        <div class="row">
          <span class="row-label">日志级别</span>
          <a-radio-group :value="cfg.logLevel || 'info'" size="small" @change="(e) => save({ logLevel: e.target.value })">
            <a-radio-button value="debug">调试</a-radio-button>
            <a-radio-button value="info">信息</a-radio-button>
            <a-radio-button value="warn">警告</a-radio-button>
            <a-radio-button value="error">错误</a-radio-button>
          </a-radio-group>
          <span class="row-label" style="width:auto">单文件大小上限</span>
          <a-input-number :value="cfg.logMaxSizeMB || 10" size="small" :min="1" :max="200" @change="(v) => save({ logMaxSizeMB: v })" />
          <span class="text-muted">MB</span>
        </div>
      </div>
    </div>

    <!-- 配置集 -->
    <div class="wem-card">
      <div class="wem-card-head"><div class="wem-card-title"><AppstoreOutlined /> 环境配置集</div></div>
      <div class="wem-card-body">
        <div class="row">
          <span class="row-label">切换前自动快照</span>
          <a-switch :checked="cfg.envsetSnapshotBefore !== false" @change="(v) => save({ envsetSnapshotBefore: v })" />
          <span class="text-muted">切换失败时以此快照回滚；关闭后风险自负</span>
        </div>
        <div class="row">
          <span class="row-label">导入默认冲突策略</span>
          <a-radio-group :value="cfg.envsetImportConflict || 'merge'" size="small" @change="(e) => save({ envsetImportConflict: e.target.value })">
            <a-radio-button value="overwrite">覆盖原有变量</a-radio-button>
            <a-radio-button value="merge">仅新增不覆盖</a-radio-button>
          </a-radio-group>
          <span class="text-muted">导入向导里仍可临时选择本次策略</span>
        </div>
        <div class="row">
          <span class="row-label">列表显示标签与备注</span>
          <a-switch :checked="cfg.envsetShowMeta !== false" @change="(v) => save({ envsetShowMeta: v })" />
        </div>
        <div class="row">
          <span class="row-label">切换前预校验 PATH</span>
          <a-switch :checked="cfg.envsetPreCheck !== false" @change="(v) => save({ envsetPreCheck: v })" />
          <span class="text-muted">提前列出配置内不存在的路径并告警</span>
        </div>
      </div>
    </div>

    <!-- 安全 -->
    <div class="wem-card">
      <div class="wem-card-head"><div class="wem-card-title"><LockOutlined /> 安全设置</div></div>
      <div class="wem-card-body">
        <div class="row"><span class="row-label">高危操作二次确认</span><a-switch :checked="cfg.confirmDanger !== false" @change="(v) => save({ confirmDanger: v })" /><span class="text-muted">删除系统变量、重置环境、批量卸载</span></div>
        <div class="row"><span class="row-label">变量编辑锁定保护</span><a-switch :checked="cfg.lockProtect !== false" @change="(v) => save({ lockProtect: v })" /></div>
        <div class="row"><span class="row-label">杀毒软件拦截提示</span><a-switch :checked="cfg.avWarning !== false" @change="(v) => save({ avWarning: v })" /></div>
        <div class="row"><span class="row-label">敏感变量检测</span><a-switch :checked="cfg.detectSensitive !== false" @change="(v) => save({ detectSensitive: v })" /></div>
        <div class="row"><span class="row-label">敏感变量脱敏导出</span><a-switch :checked="!!cfg.desensitizeExport" @change="(v) => save({ desensitizeExport: v })" /><span class="text-muted">批量导出、配置集 JSON、工具箱 .env 和变更说明会遮住密钥。快照和备份仍保留原值</span></div>
      </div>
    </div>

    <!-- 高级设置 -->
    <div class="wem-card">
      <div class="wem-card-head"><div class="wem-card-title"><SettingOutlined /> 高级设置</div></div>
      <div class="wem-card-body">
        <div class="row">
          <span class="row-label">命令行输出格式</span>
          <a-radio-group :value="cfg.cliOutputFormat || 'text'" size="small" @change="(e) => save({ cliOutputFormat: e.target.value })">
            <a-radio-button value="text">纯文本</a-radio-button>
            <a-radio-button value="json">JSON</a-radio-button>
          </a-radio-group>
          <span class="text-muted">缺省纯文本，只影响 --cli 的输出</span>
        </div>
        <div class="row">
          <span class="row-label">允许写入</span>
          <a-switch :checked="cfg.cliReadOnly === false" @change="(v) => save({ cliReadOnly: v ? false : true })" />
          <span class="text-muted">默认只读。打开允许写入后，--cli set 会直接写注册表</span>
        </div>
        <div class="row">
          <span class="row-label">命令行日志级别</span>
          <a-radio-group :value="cfg.cliLogLevel || 'info'" size="small" @change="(e) => save({ cliLogLevel: e.target.value })">
            <a-radio-button value="debug">调试</a-radio-button>
            <a-radio-button value="info">信息</a-radio-button>
            <a-radio-button value="warn">警告</a-radio-button>
            <a-radio-button value="error">错误</a-radio-button>
          </a-radio-group>
          <span class="text-muted">只影响 --cli，并且不会低于「操作日志」里的日志级别</span>
        </div>
        <div class="row">
          <span class="row-label">多实例运行</span>
          <a-switch :checked="!!cfg.allowMultiInstance" @change="(v) => save({ allowMultiInstance: v })" />
          <span class="text-muted">当前版本内置单实例锁，多开可能造成配置读写冲突，不建议开启</span>
        </div>
        <div class="row">
          <span class="row-label">配置文件自动修复</span>
          <a-switch :checked="cfg.configAutoRepair !== false" @change="(v) => save({ configAutoRepair: v })" />
          <span class="text-muted">启动时若 config.json 损坏，自动用最近配置备份恢复，不会崩溃退出</span>
        </div>
        <div class="row">
          <span class="row-label">审计日志</span>
          <a-switch :checked="cfg.auditLogEnabled !== false" @change="(v) => save({ auditLogEnabled: v })" />
          <a-button size="small" @click="openPath(paths.auditDir || '')">打开审计目录</a-button>
          <span class="text-muted">记录每次写入系统的时间、来源与前后值，软件内不提供删除</span>
        </div>
        <div class="row">
          <span class="row-label">便携模式提示</span>
          <a-switch :checked="cfg.portableShowHint !== false" @change="(v) => save({ portableShowHint: v })" />
          <span class="text-muted">{{ portable ? '当前正以便携模式运行，顶部会显示高亮提示' : '当前不是便携模式' }}</span>
        </div>
        <div class="row">
          <span class="row-label">启动时默认打开</span>
          <a-select :value="cfg.startPage || '/overview'" size="small" style="width: 180px" @change="(v) => save({ startPage: v })">
            <a-select-option value="/overview">环境变量总览</a-select-option>
            <a-select-option value="/snapshot">快照管理</a-select-option>
            <a-select-option value="/path">PATH 面板</a-select-option>
            <a-select-option value="/envsets">配置集</a-select-option>
            <a-select-option value="/search">全局搜索</a-select-option>
          </a-select>
        </div>
        <div class="row">
          <span class="row-label">重置与清理</span>
          <a-button size="small" @click="repairConfigNow">检查并修复配置</a-button>
          <a-button size="small" @click="resetAllSettings">重置全部设置</a-button>
          <a-button size="small" danger @click="clearAllSnapshots">清空全部快照</a-button>
          <a-button size="small" danger @click="deleteAllBackups">删除所有备份包</a-button>
          <span class="text-muted">重置设置不影响快照与备份文件</span>
        </div>
      </div>
    </div>

    <!-- 更新 -->
    <div class="wem-card">
      <div class="wem-card-head"><div class="wem-card-title"><CloudSyncOutlined /> 更新设置</div></div>
      <div class="wem-card-body">
        <div class="row">
          <span class="row-label">更新通道</span>
          <a-radio-group :value="cfg.updateChannel || 'stable'" size="small" @change="(e) => save({ updateChannel: e.target.value })">
            <a-radio-button value="stable">稳定版</a-radio-button>
            <a-radio-button value="pre">预发布版</a-radio-button>
          </a-radio-group>
          <span class="row-label" style="width:auto">启动时检查</span>
          <a-switch :checked="!!cfg.checkUpdateOnStart" @change="(v) => save({ checkUpdateOnStart: v })" />
          <span class="row-label" style="width:auto">更新源</span>
          <a-input :value="cfg.updateUrl" size="small" class="mono" style="width: 280px" placeholder="留空使用默认" @change="(e) => save({ updateUrl: e.target.value })" />
        </div>
        <div class="row">
          <span class="row-label">检查时机</span>
          <a-radio-group :value="cfg.updateSchedule || 'start'" size="small" @change="(e) => save({ updateSchedule: e.target.value })">
            <a-radio-button value="start">启动时</a-radio-button>
            <a-radio-button value="daily">每日一次</a-radio-button>
            <a-radio-button value="weekly">每周一次</a-radio-button>
          </a-radio-group>
          <span class="row-label" style="width:auto">新版本提醒</span>
          <a-radio-group :value="String(cfg.updateNotifyPopup !== false)" size="small" @change="(e) => save({ updateNotifyPopup: e.target.value === 'true' })">
            <a-radio-button value="true">主动弹窗</a-radio-button>
            <a-radio-button value="false">仅关于页标记</a-radio-button>
          </a-radio-group>
        </div>
        <div class="row">
          <span class="row-label">离线模式</span>
          <a-switch :checked="!!cfg.offlineMode" @change="(v) => save({ offlineMode: v })" />
          <span class="text-muted">开启后所有网络请求禁用：不检查更新、不拉取版本清单，本地功能不受影响</span>
        </div>
      </div>
    </div>

    <!-- 托盘 -->
    <div class="wem-card">
      <div class="wem-card-head"><div class="wem-card-title"><AppstoreOutlined /> 窗口与托盘</div></div>
      <div class="wem-card-body">
        <div class="row">
          <span class="row-label">关闭主窗口时</span>
          <a-radio-group :value="cfg.trayAction || 'minimize'" button-style="solid" size="small" @change="(e) => save({ trayAction: e.target.value })">
            <a-radio-button value="minimize">最小化到托盘</a-radio-button>
            <a-radio-button value="quit">直接退出程序</a-radio-button>
          </a-radio-group>
        </div>
        <div class="row">
          <span class="row-label">最小化按钮行为</span>
          <a-radio-group :value="cfg.minBtnAction || 'taskbar'" button-style="solid" size="small" @change="(e) => save({ minBtnAction: e.target.value })">
            <a-radio-button value="taskbar">最小化到任务栏</a-radio-button>
            <a-radio-button value="tray">最小化到托盘</a-radio-button>
          </a-radio-group>
        </div>
        <div class="row">
          <span class="row-label">双击托盘图标</span>
          <a-radio-group :value="cfg.trayDblClick || 'show'" button-style="solid" size="small" @change="(e) => save({ trayDblClick: e.target.value })">
            <a-radio-button value="show">打开主窗口</a-radio-button>
            <a-radio-button value="snapshot">打开快照面板</a-radio-button>
            <a-radio-button value="path">打开 PATH 面板</a-radio-button>
          </a-radio-group>
        </div>
        <div class="row">
          <span class="row-label">托盘右键菜单</span>
          <a-switch :checked="cfg.trayMenuEnabled !== false" @change="(v) => save({ trayMenuEnabled: v })" />
          <span class="text-muted">关闭后右键只保留「显示主窗口 / 退出程序」</span>
        </div>
        <div class="row" v-if="cfg.trayMenuEnabled !== false">
          <span class="row-label">菜单条目自定义</span>
          <a-checkbox :checked="(cfg.trayMenuItems || {}).backup !== false" @change="(e) => saveTrayItem('backup', e.target.checked)">立即备份</a-checkbox>
          <a-checkbox :checked="(cfg.trayMenuItems || {}).explorer !== false" @change="(e) => saveTrayItem('explorer', e.target.checked)">重启资源管理器</a-checkbox>
          <a-checkbox :checked="(cfg.trayMenuItems || {}).toolbox !== false" @change="(e) => saveTrayItem('toolbox', e.target.checked)">快捷工具箱</a-checkbox>
          <a-checkbox :checked="(cfg.trayMenuItems || {}).devenv !== false" @change="(e) => saveTrayItem('devenv', e.target.checked)">开发环境</a-checkbox>
        </div>
        <div class="row">
          <span class="row-label">托盘图标主题</span>
          <a-radio-group :value="cfg.trayIconTheme || 'auto'" button-style="solid" size="small" @change="(e) => save({ trayIconTheme: e.target.value })">
            <a-radio-button value="auto">跟随系统</a-radio-button>
            <a-radio-button value="light">固定浅色图标</a-radio-button>
            <a-radio-button value="dark">固定深色图标</a-radio-button>
          </a-radio-group>
          <span class="text-muted">需要程序目录存在 icon-light.ico / icon-dark.ico，否则使用默认图标</span>
        </div>
        <div class="row">
          <span class="row-label">窗口丢失修复</span>
          <a-button size="small" @click="resetWindow">重置窗口位置</a-button>
          <span class="text-muted">窗口跑到屏幕外或拔掉显示器后一键复位</span>
        </div>
        <div class="hint-box" style="margin-top: 12px">
          <InfoCircleOutlined />
          <div>托盘右键菜单：显示主窗口、立即执行环境变量备份、重启资源管理器、打开快捷工具箱、打开开发环境管理、退出程序。</div>
        </div>
      </div>
    </div>

    <!-- 安装登记 -->
    <div class="wem-card">
      <div class="wem-card-head">
        <div class="wem-card-title"><SafetyCertificateOutlined /> 安装登记</div>
        <div class="toolbar">
          <a-button size="small" :disabled="!install.installPath" @click="openPath(install.installPath)">打开程序目录</a-button>
          <a-button size="small" @click="openPath(paths.appData)">打开数据目录</a-button>
        </div>
      </div>
      <div class="wem-card-body">
        <div class="kv-list">
          <span class="kv-key">安装状态</span>
          <span class="kv-val">{{ install.installed ? '已由安装向导登记' : '未检测到安装登记（开发或便携运行）' }}</span>
          <span class="kv-key">安装版本</span><span class="kv-val">{{ install.version || '—' }}</span>
          <span class="kv-key">安装日期</span><span class="kv-val">{{ install.installDate || '—' }}</span>
          <span class="kv-key">程序目录</span><span class="kv-val">{{ install.installPath || '—' }}</span>
          <span class="kv-key">登记数据目录</span><span class="kv-val">{{ install.userDataRoot || '—' }}</span>
          <span class="kv-key">实际使用目录</span><span class="kv-val">{{ paths.appData || '—' }}</span>
          <span class="kv-key">更新地址</span><span class="kv-val">{{ install.updateUrl || '未登记' }}</span>
        </div>
        <div class="hint-box" style="margin-top: 12px">
          <InfoCircleOutlined />
          <div>
            安装器把程序放在「程序目录」，配置、快照、日志和导出放在「数据目录」。
            已安装时优先使用登记的数据目录（默认 <span class="mono">%LOCALAPPDATA%\WinEnvManager</span>）；
            没有登记时回落到 <span class="mono">%APPDATA%\win-env-manager</span>。主题和业务设置只写在数据目录，安装器不会改它们。
          </div>
        </div>
      </div>
    </div>

    <!-- 本地存储 -->
    <div class="wem-card">
      <div class="wem-card-head">
        <div class="wem-card-title"><FolderOpenOutlined /> 本地存储位置</div>
        <a-button size="small" @click="openPath(paths.appData)">打开数据目录</a-button>
      </div>
      <div class="wem-card-body">
        <div class="kv-list">
          <span class="kv-key">配置文件</span><span class="kv-val">{{ paths.config }}</span>
          <span class="kv-key">快照目录</span><span class="kv-val">{{ paths.snapshots }}</span>
          <span class="kv-key">日志目录</span><span class="kv-val">{{ paths.logs }}</span>
          <span class="kv-key">导出目录</span><span class="kv-val">{{ paths.exports }}</span>
          <span class="kv-key">备份目录</span><span class="kv-val">{{ paths.backupDir }}</span>
          <span class="kv-key">安装包缓存</span><span class="kv-val">{{ paths.cacheDir }}</span>
          <span class="kv-key">开发环境根目录</span><span class="kv-val">{{ paths.devRoot }}</span>
          <span class="kv-key">默认备份目录</span><span class="kv-val">{{ paths.defaultBackupDir }}</span>
        </div>
      </div>
    </div>

    <!-- 识别规则管理 -->
    <a-modal v-model:open="rulesOpen" title="软件识别规则管理" :footer="null" width="860px">
      <div class="toolbar" style="margin-bottom: 10px">
        <a-button type="primary" size="small" @click="addRule"><template #icon><PlusOutlined /></template>新增规则</a-button>
        <span class="text-muted">规则库版本 {{ dev.ruleVersion }}，共 {{ dev.rules.length }} 条（内置 + 自定义）</span>
      </div>
      <a-table
        size="small" row-key="id" :data-source="dev.rules" :pagination="{ pageSize: 10, size: 'small' }" :scroll="{ x: 780, y: 320 }"
        :columns="[{ title: '名称', key: 'name', width: 140 }, { title: '可执行文件', key: 'executableName', width: 160 }, { title: '分类', key: 'category', width: 140 }, { title: '变量模板', key: 'tpl', width: 90 }, { title: '来源', key: 'builtin', width: 80 }, { title: '操作', key: 'actions', width: 120 }]"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'name'"><span class="cell-name">{{ record.name }}</span></template>
          <template v-else-if="column.key === 'executableName'"><span class="mono">{{ record.executableName }}</span></template>
          <template v-else-if="column.key === 'tpl'">{{ (record.envTemplate || []).length }} 条</template>
          <template v-else-if="column.key === 'builtin'">
            <a-tag :color="record.builtin ? 'default' : 'green'">{{ record.builtin ? '内置' : '自定义' }}</a-tag>
          </template>
          <template v-else>
            <a-space size="small">
              <a @click="editRule(record)">{{ record.builtin ? '查看' : '编辑' }}</a>
              <a v-if="!record.builtin" class="danger-link" @click="delRule(record)">删除</a>
            </a-space>
          </template>
        </template>
      </a-table>
    </a-modal>

    <!-- 规则编辑 -->
    <a-modal v-model:open="ruleEditOpen" :title="ruleForm.id ? `识别规则 · ${ruleForm.name}` : '新增识别规则'" width="760px" ok-text="保存规则" cancel-text="取消" @ok="saveRule">
      <a-form layout="vertical">
        <a-row :gutter="10">
          <a-col :span="12"><a-form-item label="软件名称" required><a-input v-model:value="ruleForm.name" size="small" :disabled="ruleForm.builtin" /></a-form-item></a-col>
          <a-col :span="12"><a-form-item label="分类"><a-input v-model:value="ruleForm.category" size="small" :disabled="ruleForm.builtin" /></a-form-item></a-col>
        </a-row>
        <a-row :gutter="10">
          <a-col :span="12"><a-form-item label="可执行文件名" required><a-input v-model:value="ruleForm.executableName" size="small" class="mono" :disabled="ruleForm.builtin" /></a-form-item></a-col>
          <a-col :span="12"><a-form-item label="版本命令参数"><a-input v-model:value="ruleForm.versionCmd" size="small" class="mono" placeholder="--version" :disabled="ruleForm.builtin" /></a-form-item></a-col>
        </a-row>
        <a-form-item label="版本正则（捕获组 1 为版本号）"><a-input v-model:value="ruleForm.versionRegex" size="small" class="mono" :disabled="ruleForm.builtin" /></a-form-item>
        <a-form-item label="规则描述"><a-textarea v-model:value="ruleForm.description" :rows="2" :disabled="ruleForm.builtin" /></a-form-item>
        <a-form-item label="环境变量模板（JSON 数组）">
          <a-textarea v-model:value="ruleTplText" :rows="6" class="mono" placeholder='[{"varKey":"JAVA_HOME","varValue":"{{installPath}}","scope":"user","remark":"JDK 主目录"}]' />
        </a-form-item>
      </a-form>
      <div v-if="ruleForm.builtin" class="hint-box warn">
        <ExclamationCircleOutlined />
        <div>内置规则不可修改，如需定制请复制为自定义规则（导出后修改 ID 再导入）。</div>
      </div>
    </a-modal>

    <!-- ==================== 注册表设置（追加） ==================== -->
    <div class="wem-card">
      <div class="wem-card-head"><div class="wem-card-title"><SafetyCertificateOutlined /> 注册表设置</div></div>
      <div class="wem-card-body">
        <div class="row">
          <span class="row-label">打开注册表页面时自动预加载环境变量节点</span>
          <a-switch :checked="cfg.regPreloadOnOpen !== false" @change="(v) => save({ regPreloadOnOpen: v })" />
          <span class="text-muted">进入页面即展开 HKCU\Environment 与系统环境变量分支，省一次点击</span>
        </div>
        <div class="row">
          <span class="row-label">注册表备份默认存储目录</span>
          <a-input
            :value="cfg.regBackupDir"
            size="small"
            class="mono"
            style="width: 340px"
            placeholder="留空使用数据目录下的 registryBackup"
            @change="(e) => save({ regBackupDir: e.target.value })"
          />
          <a-button size="small" @click="chooseRegBackupDir">浏览…</a-button>
          <span class="text-muted">分支备份、批量替换备份与健康修复备份都会写到这里</span>
        </div>
        <div class="row">
          <span class="row-label">注册表备份最大保留数量</span>
          <a-input-number
            :value="cfg.regBackupKeep || 30"
            size="small"
            :min="1"
            :max="500"
            @change="(v) => save({ regBackupKeep: v })"
          />
          <span class="text-muted">份，超出后自动清理最早的备份；受保护备份不清理</span>
        </div>
        <div class="row">
          <span class="row-label">导入 reg 默认模式</span>
          <a-radio-group
            :value="cfg.regImportMode || 'merge'"
            size="small"
            button-style="solid"
            @change="(e) => save({ regImportMode: e.target.value })"
          >
            <a-radio-button value="merge">合并（覆盖同名值）</a-radio-button>
            <a-radio-button value="append">仅新增（跳过同名值）</a-radio-button>
          </a-radio-group>
          <span class="text-muted">导入向导里仍可临时改成本次策略</span>
        </div>
        <div class="row">
          <span class="row-label">注册表树异步加载</span>
          <a-switch :checked="cfg.regTreeLazy !== false" @change="(v) => save({ regTreeLazy: v })" />
          <span class="text-muted">建议保持开启；关闭后一次性递归读取，大分支可能明显卡顿</span>
        </div>
        <div class="row">
          <span class="row-label">修改前自动创建保底备份</span>
          <a-switch :checked="cfg.regAutoBackupBeforeWrite !== false" @change="(v) => save({ regAutoBackupBeforeWrite: v })" />
          <span class="text-muted">每次写键值、删键、导入前先备份所在分支，失败可回滚</span>
        </div>
        <div class="row">
          <span class="row-label">搜索是否检索二进制数据</span>
          <a-switch :checked="!!cfg.regSearchBinary" @change="(v) => save({ regSearchBinary: v })" />
          <span class="text-muted">默认关闭；开启后会把 REG_BINARY 转成十六进制参与匹配，性能消耗较大</span>
        </div>
      </div>
    </div>

    <!-- ==================== 定时任务设置（追加） ==================== -->
    <div class="wem-card">
      <div class="wem-card-head"><div class="wem-card-title"><AppstoreOutlined /> 定时任务设置</div></div>
      <div class="wem-card-body">
        <div class="row">
          <span class="row-label">任务失败桌面通知</span>
          <a-switch :checked="cfg.scheduleNotifyOnFail !== false" @change="(v) => save({ scheduleNotifyOnFail: v })" />
          <span class="text-muted">无人值守执行失败时弹出系统通知，便于及时发现</span>
        </div>
        <div class="row">
          <span class="row-label">任务日志最大保留条数</span>
          <a-input-number
            :value="cfg.scheduleLogKeep || 200"
            size="small"
            :min="20"
            :max="5000"
            @change="(v) => save({ scheduleLogKeep: v })"
          />
          <span class="text-muted">条，超出后清理最早的执行记录</span>
        </div>
        <div class="row">
          <span class="row-label">静默执行说明</span>
          <span class="text-muted">
            仅备份类只读操作可静默执行（系统环境快照、注册表分支备份、审计日志导出、环境健康诊断）；
            <b style="color: var(--wem-warning)">修改类操作禁止定时执行</b>，后端会直接拒绝创建。
          </span>
        </div>
      </div>
    </div>

    <!-- ==================== 配置备份与恢复（追加） ==================== -->
    <div class="wem-card">
      <div class="wem-card-head">
        <div class="wem-card-title"><CloudUploadOutlined /> 配置备份与恢复</div>
        <div class="toolbar">
          <a-button size="small" @click="openPackExport">导出完整配置包</a-button>
          <a-button size="small" @click="openPackImport">导入配置包</a-button>
        </div>
      </div>
      <div class="wem-card-body">
        <div class="hint-box">
          <InfoCircleOutlined />
          <div>
            配置包（<span class="mono">.wemcfg</span>）把程序设置、表格视图预设、识别规则、配置集、项目环境与注册表收藏夹打成一个文件，
            用于换机迁移或团队共享。可加密码加密；导入前会自动备份当前全部配置，导入完成后建议重启软件生效。
          </div>
        </div>
      </div>
    </div>

    <TableViewSettings />
    <PopupSettings />
    <ExtraProductSettings />

    <!-- 导出配置包 -->
    <a-modal
      v-model:open="packExportOpen"
      title="导出完整配置包"
      width="720px"
      ok-text="导出"
      cancel-text="取消"
      :confirm-loading="packExporting"
      @ok="doPackExport"
    >
      <div class="hint-box" style="margin-bottom: 10px">
        <InfoCircleOutlined />
        <div>勾选要打包的模块。没有数据的模块会自动跳过并在清单里标注原因。</div>
      </div>
      <div class="section-title">打包模块</div>
      <a-checkbox-group v-model:value="packModules" class="pack-modules">
        <a-checkbox v-for="m in packModuleOptions" :key="m.key" :value="m.key">{{ m.name }}</a-checkbox>
      </a-checkbox-group>
      <a-form layout="vertical" style="margin-top: 12px">
        <a-row :gutter="12">
          <a-col :span="12">
            <a-form-item label="备注">
              <a-input v-model:value="packForm.note" size="small" placeholder="例如：换机迁移 / 团队标准配置" :maxlength="120" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="标签（逗号分隔）">
              <a-input v-model:value="packForm.tagsText" size="small" placeholder="例如：开发,JDK17" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-form-item label="加密密码（可选）">
          <a-input-password v-model:value="packForm.password" size="small" placeholder="留空则不加密，任何人可直接查看内容" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 导入配置包 -->
    <a-modal
      v-model:open="packImportOpen"
      title="导入配置包"
      width="780px"
      ok-text="开始导入"
      cancel-text="取消"
      :ok-button-props="{ disabled: !packImportFile || !packImportPicked.length }"
      :confirm-loading="packImporting"
      @ok="doPackImport"
    >
      <div class="row" style="padding-top: 0">
        <span class="row-label">配置包文件</span>
        <a-input :value="packImportFile" size="small" class="mono" readonly placeholder="尚未选择文件" style="width: 380px" />
        <a-button size="small" @click="pickPackFile">选择文件…</a-button>
      </div>
      <div class="row">
        <span class="row-label">配置包密码</span>
        <a-input-password
          v-model:value="packImportPassword"
          size="small"
          style="width: 240px"
          placeholder="未加密的包留空"
          @press-enter="inspectPack"
        />
        <a-button size="small" :disabled="!packImportFile" @click="inspectPack">重新解析</a-button>
        <span class="text-muted">加密包必须输入正确密码才能读取清单</span>
      </div>

      <div v-if="packImportError" class="hint-box warn" style="margin-top: 10px">
        <ExclamationCircleOutlined />
        <div>{{ packImportError }}</div>
      </div>

      <template v-if="packManifest">
        <div class="kv-list" style="margin-top: 10px">
          <span class="kv-key">包版本</span><span class="kv-val">{{ packManifest.appVersion || '—' }}</span>
          <span class="kv-key">创建时间</span><span class="kv-val">{{ packManifest.createdAt || '—' }}</span>
          <span class="kv-key">备注</span><span class="kv-val">{{ packManifest.note || '—' }}</span>
          <span class="kv-key">标签</span>
          <span class="kv-val">
            <a-tag v-for="t in packManifest.tags || []" :key="t" color="blue">{{ t }}</a-tag>
            <span v-if="!(packManifest.tags || []).length">—</span>
          </span>
          <span class="kv-key">加密</span><span class="kv-val">{{ packEncrypted ? '已加密（AES-256-GCM）' : '未加密' }}</span>
        </div>

        <div v-if="packVersionWarning" class="hint-box warn" style="margin-top: 10px">
          <ExclamationCircleOutlined />
          <div>{{ packVersionWarning }}</div>
        </div>

        <div class="section-title">模块清单（勾选要导入的模块）</div>
        <div class="pack-list">
          <div v-for="m in packManifest.modules || []" :key="m.key" class="pack-item" :class="{ off: m.available === false }">
            <a-checkbox
              :checked="packImportPicked.includes(m.key)"
              :disabled="m.available === false"
              @change="(e) => togglePackModule(m.key, e.target.checked)"
            />
            <span class="pack-name">{{ m.name }}</span>
            <span class="text-muted pack-meta">
              <template v-if="m.available === false">{{ m.reason || '配置包中无此模块' }}</template>
              <template v-else>{{ m.count }} 项</template>
            </span>
          </div>
        </div>

        <div class="row" style="margin-top: 10px">
          <span class="row-label">冲突策略</span>
          <a-radio-group v-model:value="packImportMode" size="small" button-style="solid">
            <a-radio-button value="overwrite">覆盖</a-radio-button>
            <a-radio-button value="merge">合并</a-radio-button>
            <a-radio-button value="selected">仅选中模块</a-radio-button>
          </a-radio-group>
          <span class="text-muted">
            {{ packImportMode === 'overwrite' ? '用包内数据整体替换本地同名模块' : packImportMode === 'merge' ? '按 ID 合并，包内同 ID 覆盖本地' : '只导入勾选的模块，并按 ID 合并' }}
          </span>
        </div>

        <div class="hint-box warn" style="margin-top: 10px">
          <ExclamationCircleOutlined />
          <div>导入前会自动备份当前全部配置到数据目录的 configPack 下。导入完成后建议重启软件使设置全部生效。</div>
        </div>
      </template>
    </a-modal>
  </div>
</template>

<script setup>
import { computed, h, onMounted, reactive, ref } from 'vue'
import { Modal, message } from 'ant-design-vue'
import {
  BgColorsOutlined, BulbOutlined, BulbFilled, DesktopOutlined, RocketOutlined,
  SafetyCertificateOutlined, FileTextOutlined, AppstoreOutlined, FolderOpenOutlined,
  InfoCircleOutlined, CloudDownloadOutlined, SearchOutlined, LockOutlined,
  CloudSyncOutlined, PlusOutlined, ExclamationCircleOutlined, CloudUploadOutlined
} from '@ant-design/icons-vue'
import TableViewSettings from '@/components/settings/TableViewSettings.vue'
import PopupSettings from '@/components/settings/PopupSettings.vue'
import ExtraProductSettings from '@/components/settings/ExtraProductSettings.vue'
import { useEnvStore } from '@/store/env'
import { useUiStore } from '@/store/ui'
import { useDevStore } from '@/store/dev'
import api from '@/api'

const env = useEnvStore()
const ui = useUiStore()
const dev = useDevStore()

const cfg = reactive({})
const paths = reactive({})
const install = reactive({
  installed: false,
  installPath: '',
  userDataRoot: '',
  version: '',
  installDate: '',
  updateUrl: ''
})
const autoLaunch = ref(false)
const launchLoading = ref(false)
const logFiles = ref([])
const rulesOpen = ref(false)
const ruleEditOpen = ref(false)
const ruleForm = reactive({ id: '', name: '', category: '', executableName: '', versionCmd: '', versionRegex: '', description: '', builtin: false, envTemplate: [] })
const ruleTplText = ref('{}')

const presetColors = ['#165DFF', '#722ED1', '#13C2C2', '#52C41A', '#FA8C16', '#F5222D']
const mirrorKeys = [
  { key: 'mirrorNode', label: 'Node.js', placeholder: 'https://npmmirror.com/mirrors/node' },
  { key: 'mirrorPython', label: 'Python', placeholder: 'https://npmmirror.com/mirrors/python' },
  { key: 'mirrorGo', label: 'Go', placeholder: 'https://mirrors.aliyun.com/golang' },
  { key: 'mirrorJdk', label: 'JDK', placeholder: 'https://mirrors.tuna.tsinghua.edu.cn/Adoptium' },
  { key: 'mirrorMaven', label: 'Maven', placeholder: 'https://mirrors.tuna.tsinghua.edu.cn/apache/maven' },
  { key: 'mirrorGradle', label: 'Gradle', placeholder: 'https://mirrors.cloud.tencent.com/gradle' },
  { key: 'mirrorGithub', label: 'GitHub', placeholder: 'https://ghfast.top/https://github.com' }
]

const scanCustomDirs = computed(() => env.config.scanCustomDirs || [])
const scanExcludeDirs = computed(() => env.config.scanExcludeDirs || [])
const scanExcludeNames = computed(() => env.config.scanExcludeNames || [])
const excludeNameInput = ref('')
const ignoreList = computed(() => env.config.scanIgnoreList || [])
const pathIgnoreDirs = computed(() => env.config.pathIgnoreDirs || [])
const ignoreDirInput = ref('')

async function addIgnoreDir() {
  const d = String(ignoreDirInput.value || '').trim()
  if (!d) return
  const list = [...(env.config.pathIgnoreDirs || [])]
  if (!list.some((x) => x.toLowerCase() === d.toLowerCase())) list.push(d)
  ignoreDirInput.value = ''
  await save({ pathIgnoreDirs: list })
}

async function removeIgnoreDir(i) {
  const list = [...(env.config.pathIgnoreDirs || [])]
  list.splice(i, 1)
  await save({ pathIgnoreDirs: list })
}
const rulesCount = computed(() => dev.rules.length)

async function load() {
  const res = await api.config.get()
  if (res.ok) {
    Object.assign(cfg, res.data.config)
    Object.assign(paths, res.data.paths)
    Object.assign(env.config, res.data.config)
    if (res.data.install) {
      Object.assign(install, res.data.install)
      cfg.portable = !!res.data.install.portable
    }
  }
  const logs = await api.log.list()
  if (logs.ok) logFiles.value = logs.data.files
  const al = await api.app.getAutoLaunch()
  if (al.ok) autoLaunch.value = al.data
  dev.loadRules()
}

async function save(patch) {
  Object.assign(cfg, patch)
  Object.assign(env.config, patch)
  const res = await api.config.set(patch)
  if (res.ok) {
    const hotkey = res.data && res.data.hotkey
    if (hotkey && hotkey.ok === false) message.warning(hotkey.message || '快捷键没有注册成功')
    else message.success('设置已保存')
    await load()
  } else {
    message.error(res.message)
  }
}

function onThemeChange(e) {
  ui.setTheme(e.target.value)
  message.success('主题已切换')
}

const portable = computed(() => !!cfg.portable)

function saveTrayItem(key, val) {
  save({ trayMenuItems: { ...(cfg.trayMenuItems || {}), [key]: val } })
}

async function resetWindow() {
  const res = await api.win.resetBounds()
  if (res.ok) message.success('窗口位置已复位')
  else message.error(res.message)
}

async function chooseCacheDir() {
  const picked = await api.fs.selectFolder({ title: '选择扫描缓存目录', defaultPath: paths.cacheDir })
  if (picked.ok && !picked.data.canceled) await save({ cacheDir: picked.data.path })
}

function clearScanCache() {
  Modal.confirm({
    title: '清空扫描缓存？',
    content: '只清掉本机识别结果缓存，下次自动扫描会重新识别。安装包缓存不受影响。',
    okText: '清空', okType: 'danger', cancelText: '取消',
    onOk: () => {
      dev.clearScanResultCache()
      message.success('已清空扫描结果缓存')
    }
  })
}

async function repairConfigNow() {
  const res = await api.configRepair()
  if (!res.ok) {
    message.error(res.message)
    return
  }
  const data = res.data || {}
  if (data.repaired && data.backupUsed) message.success('配置文件已损坏，已用最近一次备份恢复并写回')
  else if (data.repaired) message.warning(data.reason || '配置文件已损坏，已隔离坏文件并写回默认配置')
  else message.success('配置检查完成，文件正常')
  await load()
}

function resetAllSettings() {
  Modal.confirm({
    title: '重置全部设置？',
    content: '所有设置将恢复出厂默认值。快照、备份与审计日志不会被删除。',
    okText: '重置', okType: 'danger', cancelText: '取消',
    onOk: async () => {
      const res = await api.configReset()
      if (res.ok) {
        message.success('设置已重置')
        await load()
      } else message.error(res.message)
    }
  })
}

function clearAllSnapshots() {
  Modal.confirm({
    title: '清空全部快照？',
    content: '所有快照（含受保护快照）将被永久删除，该操作不可撤销。请确认已有可用备份。',
    okText: '全部删除', okType: 'danger', cancelText: '取消',
    onOk: async () => {
      const res = await api.snapshot.list()
      if (!res.ok) return message.error(res.message)
      let n = 0
      for (const s of res.data || []) {
        const r = await api.snapshot.remove(s.id)
        if (r.ok) n += 1
      }
      message.success(`已删除 ${n} 个快照`)
    }
  })
}

function deleteAllBackups() {
  Modal.confirm({
    title: '删除所有备份包？',
    content: `备份目录 ${paths.backupDir || ''} 下的全部备份文件将被删除，该操作不可撤销。`,
    okText: '全部删除', okType: 'danger', cancelText: '取消',
    onOk: async () => {
      const res = await api.backup.list()
      if (!res.ok) return message.error(res.message)
      let n = 0
      for (const f of (res.data && res.data.files) || []) {
        const r = await api.backup.remove(f.file || f)
        if (r.ok) n += 1
      }
      message.success(`已删除 ${n} 个备份文件`)
    }
  })
}

async function onAutoLaunch(v) {
  launchLoading.value = true
  try {
    const res = await api.app.setAutoLaunch(v)
    if (res.ok) {
      autoLaunch.value = res.data
      message.success(res.data ? '已设置开机自启' : '已取消开机自启')
    } else message.error(res.message)
  } finally {
    launchLoading.value = false
  }
}

async function chooseDevRoot() {
  const picked = await api.fs.selectFolder({ title: '选择默认安装根目录', defaultPath: cfg.devRoot })
  if (picked.ok && !picked.data.canceled) await save({ devRoot: picked.data.path })
}

async function chooseBackupDir() {
  const picked = await api.fs.selectFolder({ title: '选择备份存储目录', defaultPath: paths.backupDir })
  if (picked.ok && !picked.data.canceled) await save({ backupDir: picked.data.path })
}

async function chooseRegBackupDir() {
  const picked = await api.fs.selectFolder({ title: '选择注册表备份目录', defaultPath: cfg.regBackupDir })
  if (!picked.ok) {
    message.error(picked.message)
    return
  }
  if (picked.data && !picked.data.canceled) await save({ regBackupDir: picked.data.path })
}

/* ---------------------- 配置备份与恢复 ---------------------- */

const packExportOpen = ref(false)
const packExporting = ref(false)
const packModules = ref([])
const packForm = reactive({ note: '', tagsText: '', password: '' })
const packModuleOptions = [
  { key: 'config', name: '程序设置' },
  { key: 'tableLayout', name: '表格视图预设与条件格式' },
  { key: 'scanRules', name: '软件识别规则库' },
  { key: 'envsets', name: '配置集与互斥组' },
  { key: 'projects', name: '项目环境与模板' },
  { key: 'registryFavorites', name: '注册表收藏夹' }
]

const packImportOpen = ref(false)
const packImporting = ref(false)
const packImportFile = ref('')
const packImportError = ref('')
const packImportPassword = ref('')
const packManifest = ref(null)
const packEncrypted = ref(false)
const packVersionWarning = ref('')
const packImportPicked = ref([])
const packImportMode = ref('overwrite')

function openPackExport() {
  packModules.value = packModuleOptions.map((m) => m.key)
  packForm.note = ''
  packForm.tagsText = ''
  packForm.password = ''
  packExportOpen.value = true
}

async function doPackExport() {
  if (!packModules.value.length) {
    message.warning('请至少选择一个模块')
    return
  }
  packExporting.value = true
  try {
    const tags = String(packForm.tagsText || '')
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean)
    const res = await api.configPack.exportPack({
      modules: packModules.value.slice(),
      note: packForm.note,
      tags,
      password: packForm.password
    })
    if (!res.ok) {
      message.error(res.message)
      return
    }
    if (!res.data || !res.data.file) return
    message.success(`配置包已导出：${res.data.file}`)
    packExportOpen.value = false
  } finally {
    packExporting.value = false
  }
}

function resetPackImport() {
  packImportFile.value = ''
  packImportError.value = ''
  packImportPassword.value = ''
  packManifest.value = null
  packEncrypted.value = false
  packVersionWarning.value = ''
  packImportPicked.value = []
  packImportMode.value = 'overwrite'
}

function openPackImport() {
  resetPackImport()
  packImportOpen.value = true
}

async function pickPackFile() {
  const picked = await api.configPack.pickOpen()
  if (!picked.ok) {
    message.error(picked.message)
    return
  }
  if (!picked.data || !picked.data.file) return
  packImportFile.value = picked.data.file
  await inspectPack()
}

async function inspectPack() {
  if (!packImportFile.value) {
    message.warning('请先选择配置包文件')
    return
  }
  packImportError.value = ''
  packManifest.value = null
  packVersionWarning.value = ''
  const res = await api.configPack.inspectPack({
    file: packImportFile.value,
    password: packImportPassword.value
  })
  if (!res.ok) {
    packImportError.value = res.message || '配置包解析失败'
    return
  }
  const data = res.data || {}
  packManifest.value = data.manifest || null
  packEncrypted.value = !!data.encrypted
  packVersionWarning.value = data.versionWarning || ''
  packImportPicked.value = ((data.manifest && data.manifest.modules) || [])
    .filter((m) => m.available !== false)
    .map((m) => m.key)
}

function togglePackModule(key, checked) {
  if (checked) {
    if (!packImportPicked.value.includes(key)) packImportPicked.value = [...packImportPicked.value, key]
  } else {
    packImportPicked.value = packImportPicked.value.filter((k) => k !== key)
  }
}

async function doPackImport() {
  if (!packImportFile.value) {
    message.warning('请先选择配置包文件')
    return
  }
  if (!packImportPicked.value.length) {
    message.warning('请至少选择一个要导入的模块')
    return
  }
  packImporting.value = true
  try {
    const res = await api.configPack.importPack({
      file: packImportFile.value,
      password: packImportPassword.value,
      modules: packImportPicked.value.slice(),
      mode: packImportMode.value
    })
    if (!res.ok) {
      message.error(res.message)
      return
    }
    const data = res.data || {}
    const done = (data.imported || []).length
    const skipped = (data.skipped || []).length
    if (done) {
      Modal.success({
        title: '配置导入完成',
        content:
          `已导入 ${done} 个模块${skipped ? `，跳过 ${skipped} 个` : ''}。` +
          `\n导入前已自动备份当前配置：${data.backupFile || '—'}` +
          '\n\n建议重启软件，使全部设置与配置生效。',
        okText: '知道了'
      })
    } else {
      message.error('没有任何模块被导入，请检查配置包内容')
      return
    }
    packImportOpen.value = false
    await load()
  } finally {
    packImporting.value = false
  }
}

async function openPath(p) {
  if (!p) return
  const res = await api.tool.openFolder(p)
  if (!res.ok) message.error(res.message)
}

async function addScanDir() {
  const picked = await api.fs.selectFolder({ title: '添加自定义扫描目录' })
  if (picked.ok && !picked.data.canceled) {
    const list = [...(env.config.scanCustomDirs || []), picked.data.path]
    await save({ scanCustomDirs: list })
  }
}

async function removeDir(i) {
  const list = [...(env.config.scanCustomDirs || [])]
  list.splice(i, 1)
  await save({ scanCustomDirs: list })
}

async function addExcludeDir() {
  const picked = await api.fs.selectFolder({ title: '添加扫描排除目录' })
  if (picked.ok && !picked.data.canceled) {
    const list = [...(env.config.scanExcludeDirs || [])]
    if (!list.some((d) => d.toLowerCase() === picked.data.path.toLowerCase())) list.push(picked.data.path)
    await save({ scanExcludeDirs: list })
  }
}

async function removeExcludeDir(i) {
  const list = [...(env.config.scanExcludeDirs || [])]
  list.splice(i, 1)
  await save({ scanExcludeDirs: list })
}

async function addExcludeName(raw) {
  const name = String(raw || excludeNameInput.value || '').trim()
  if (!name) return
  const list = [...(env.config.scanExcludeNames || [])]
  if (!list.some((n) => n.toLowerCase() === name.toLowerCase())) list.push(name)
  excludeNameInput.value = ''
  await save({ scanExcludeNames: list })
}

async function removeExcludeName(i) {
  const list = [...(env.config.scanExcludeNames || [])]
  list.splice(i, 1)
  await save({ scanExcludeNames: list })
}

async function restoreIgnored(key) {
  await api.devenv.removeIgnore(key)
  await save({ scanIgnoreList: (env.config.scanIgnoreList || []).filter((x) => x !== key) })
  message.success('已恢复该软件的展示')
}

function showCache(res) {
  if (!res.ok) return message.error(res.message)
  const mb = (res.data.size / 1024 / 1024).toFixed(2)
  Modal.info({
    title: '安装包缓存占用',
    content: `目录：${res.data.dir}\n共 ${res.data.count} 个文件，占用 ${mb} MB`,
    okText: '知道了'
  })
}

async function clearCache() {
  Modal.confirm({
    title: '清空安装包缓存？',
    content: '清空后重复部署相同版本需要重新下载。',
    okText: '清空',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      const res = await api.devenv.clearCache()
      if (res.ok) message.success(`已删除 ${res.data} 项`)
    }
  })
}

function clearLogs() {
  Modal.confirm({
    title: '确认清空全部日志？',
    content: '该操作不可撤销。',
    okText: '清空',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      const res = await api.log.clear()
      if (res.ok) {
        message.success(`已清空 ${res.data} 个日志文件`)
        await load()
      } else message.error(res.message)
    }
  })
}

/* ------------------------------ 识别规则 ------------------------------ */

function addRule() {
  Object.assign(ruleForm, { id: '', name: '', category: '编程语言运行时', executableName: '', versionCmd: '--version', versionRegex: '', description: '', builtin: false, envTemplate: [] })
  ruleTplText.value = JSON.stringify([{ varKey: '', varValue: '{{installPath}}', scope: 'user', remark: '', pathPosition: '' }], null, 2)
  ruleEditOpen.value = true
}

function editRule(record) {
  Object.assign(ruleForm, JSON.parse(JSON.stringify(record)))
  ruleTplText.value = JSON.stringify(record.envTemplate || [], null, 2)
  ruleEditOpen.value = true
}

async function saveRule() {
  let tpl
  try {
    tpl = JSON.parse(ruleTplText.value)
  } catch (err) {
    return message.error(`环境变量模板 JSON 解析失败：${err.message}`)
  }
  const res = await api.rules.save({ ...ruleForm, envTemplate: tpl })
  if (res.ok) {
    message.success('规则已保存')
    ruleEditOpen.value = false
    dev.loadRules()
  } else message.error(res.message)
}

async function delRule(record) {
  Modal.confirm({
    title: `删除规则「${record.name}」？`,
    okText: '删除', okType: 'danger', cancelText: '取消',
    onOk: async () => {
      const res = await api.rules.remove(record.id)
      if (res.ok) {
        message.success('已删除')
        dev.loadRules()
      } else message.error(res.message)
    }
  })
}

async function exportRules() {
  const res = await api.rules.exportAll()
  if (!res.ok) return message.error(res.message)
  const saved = await api.fs.saveFile({ title: '导出识别规则', defaultPath: 'wem-rules.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
  if (!saved.ok || saved.data.canceled) return
  await api.fs.writeTextFile({ file: saved.data.path, content: res.data })
  message.success('规则已导出')
}

function importRules() {
  Modal.confirm({
    title: '导入识别规则',
    content: '请选择此前导出的规则 JSON 文件。重复 ID 自动覆盖原有规则，错误规则单独列出不导入。',
    okText: '选择文件',
    cancelText: '取消',
    onOk: async () => {
      const picked = await api.fs.selectFile({ title: '选择规则文件', filters: [{ name: 'JSON', extensions: ['json'] }] })
      if (!picked.ok || picked.data.canceled) return
      const read = await api.fs.readTextFile(picked.data.path)
      if (!read.ok) return message.error(read.message)
      const res = await api.rules.importAll(read.data)
      if (res.ok) {
        message.success(`导入 ${res.data.imported} 条，跳过 ${res.data.skipped.length} 条，当前共 ${res.data.total} 条`)
        dev.loadRules()
      } else message.error(res.message)
    }
  })
}

onMounted(load)
</script>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 0;
  border-bottom: 1px dashed var(--wem-border);
  flex-wrap: wrap;
}

.row:last-child {
  border-bottom: none;
}

.row-label {
  width: 190px;
  flex: 0 0 190px;
  color: var(--wem-text-2);
  font-size: var(--wem-fs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.color-input {
  width: 42px;
  height: 26px;
  border: 1px solid var(--wem-border);
  border-radius: 6px;
  background: none;
  cursor: pointer;
  padding: 0;
}

.mirror-grid {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mirror-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mirror-key {
  width: 78px;
  flex: 0 0 78px;
  font-size: 11.5px;
  color: var(--wem-text-3);
}

.danger-link {
  color: var(--wem-danger);
}

.exclude-names {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.pack-modules {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 6px 12px;
}

.pack-list {
  border: 1px solid var(--wem-border);
  border-radius: 8px;
  background: var(--wem-card-alt);
  padding: 8px 10px;
  max-height: 220px;
  overflow: auto;
}

.pack-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  border-bottom: 1px dashed var(--wem-border);
  font-size: 12.5px;
}

.pack-item:last-child {
  border-bottom: none;
}

.pack-item.off {
  opacity: 0.66;
}

.pack-name {
  flex: 0 0 auto;
  color: var(--wem-text);
}

.pack-meta {
  margin-left: auto;
  font-size: 12px;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  margin: 10px 0 6px;
}
</style>
