<template>
  <div>
    <a-tabs v-model:active-key="tab" type="card" size="small">
      <!-- ==================== 子标签1：环境市场 ==================== -->
      <a-tab-pane key="market" tab="环境市场">
        <div class="toolbar" style="margin-bottom: 12px">
          <a-input v-model:value="marketSearch" size="small" style="width: 220px" placeholder="搜索软件名 / 别名">
            <template #prefix><SearchOutlined /></template>
          </a-input>
          <a-select v-model:value="marketCategory" size="small" style="width: 160px" allow-clear placeholder="全部分类">
            <a-select-option v-for="c in dev.categories" :key="c" :value="c">{{ c }}</a-select-option>
          </a-select>
          <span class="text-muted">下载源：</span>
          <a-radio-group v-model:value="downloadSource" size="small" button-style="solid" @change="downloadSourceTouched = true">
            <a-radio-button value="official">官方源</a-radio-button>
            <a-radio-button value="mirror">国内镜像</a-radio-button>
          </a-radio-group>
          <a-button size="small" @click="openDir('dev')">
            <template #icon><FolderOpenOutlined /></template>
            安装根目录
          </a-button>
          <a-button size="small" @click="openDir('cache')">
            <template #icon><DatabaseOutlined /></template>
            安装包缓存
          </a-button>
          <a-button size="small" @click="openRuleLibrary">
            <template #icon><FileTextOutlined /></template>
            识别规则库
          </a-button>
        </div>

        <div class="market-grid">
          <div v-for="it in marketItems" :key="it.id" class="market-card">
            <div class="market-head">
              <span class="market-name">{{ it.name }}</span>
              <a-tag :color="installedTag(it).color">{{ installedTag(it).text }}</a-tag>
            </div>
            <div class="market-desc">{{ it.description }}</div>
            <div class="market-meta">
              <span>{{ it.category }}</span>
              <span v-if="it.sizeHint">· {{ it.sizeHint }}</span>
              <span>· {{ it.installMode === 'portable' ? '绿色解压' : '静默安装' }}</span>
              <span v-if="it.requires && it.requires.length">· 依赖 {{ it.requires.join('、') }}</span>
            </div>
            <div class="toolbar" style="margin-top: 10px">
              <a-select v-model:value="versionPick[it.id]" size="small" style="width: 150px" placeholder="选择版本">
                <a-select-option v-for="v in it.versions" :key="v" :value="v">{{ v }}</a-select-option>
              </a-select>
              <a-button type="primary" size="small" @click="openDeploy(it)">
                <template #icon><RocketOutlined /></template>
                一键部署
              </a-button>
              <a-button size="small" @click="showTemplate(it)">环境变量模板</a-button>
            </div>
          </div>
          <div v-if="!marketItems.length" class="empty-block">没有匹配的软件</div>
        </div>

        <!-- 全局任务日志面板 -->
        <div class="wem-card" style="margin-top: 14px">
          <div class="wem-card-head">
            <div class="wem-card-title"><FileTextOutlined /> 任务日志</div>
            <div class="toolbar">
              <a-button size="small" @click="$router.push('/devenv')">任务队列</a-button>
            </div>
          </div>
          <div class="wem-card-body tight">
            <div v-if="!taskLogs.length" class="empty-block">暂无任务日志</div>
            <div v-for="(l, i) in taskLogs" :key="i" class="log-line mono" :class="l.level">
              [{{ fmtTime(l.at) }}] {{ l.text }}
            </div>
          </div>
        </div>
      </a-tab-pane>

      <!-- ==================== 子标签2：已安装管理 ==================== -->
      <a-tab-pane key="installed" tab="已安装管理">
        <div class="toolbar" style="margin-bottom: 12px">
          <a-button type="primary" size="small" :loading="dev.scanning" @click="rescan">
            <template #icon><SearchOutlined /></template>
            {{ dev.scanning ? '扫描中…' : '重新扫描本机环境' }}
          </a-button>
          <a-button v-if="dev.scanning" size="small" danger @click="dev.cancelScan()">取消扫描</a-button>
          <a-button size="small" :disabled="!selectedDiscovered.length" @click="batchAdopt">
            <template #icon><PlusOutlined /></template>
            批量纳入管理（{{ selectedDiscovered.length }}）
          </a-button>
          <a-switch v-model:checked="deepScan" checked-children="深度" un-checked-children="快速" @change="deepScanTouched = true" />
          <span v-if="dev.scanProgress" class="text-muted">{{ dev.scanProgress.message }}</span>
          <span v-if="lastScanText" class="text-muted">上次扫描：{{ lastScanText }}</span>
        </div>

        <a-progress v-if="dev.scanning" :percent="dev.scanProgress ? Math.round(dev.scanProgress.percent || 0) : 0" size="small" />

        <!-- 已纳入管理 -->
        <div class="wem-card" style="margin-top: 12px">
          <div class="wem-card-head">
            <div class="wem-card-title"><CheckCircleOutlined style="color:#00b42a" /> ✅ 已纳入管理（{{ dev.managedItems.length }}）</div>
          </div>
          <div class="wem-card-body tight">
            <WemTable
              table-id="devenv-managed"
              row-key="id"
              :rows="managedRows"
              :columns="managedColumns"
              :page-size="10"
              :capabilities="readCaps"
              empty-text="还没有纳入管理的环境"
            >
              <template #cell="{ row, column }">
                <template v-if="column.key === 'version'"><span class="mono">{{ row.versionText }}</span></template>
                <template v-else-if="column.key === 'installPath'"><span class="cell-path" :title="row.installPath">{{ row.installPath }}</span></template>
                <template v-else-if="column.key === 'sources'">
                  <a-tag v-for="s in row.sources || []" :key="s" color="default">{{ sourceName(s) }}</a-tag>
                </template>
                <template v-else-if="column.key === 'status'">
                  <a-tag color="green">正常</a-tag>
                </template>
                <template v-else-if="column.key === 'actions'">
                  <a-space size="small" @click.stop>
                    <a @click.stop="validateOne(row)">校验环境</a>
                    <a @click.stop="openInstallDir(row)">打开目录</a>
                    <a @click.stop="showVars(row)">查看关联变量</a>
                    <a @click.stop="adopt(row)">修复环境</a>
                    <a class="danger-link" @click.stop="uninstallItem(row)">卸载</a>
                  </a-space>
                </template>
                <span v-else>{{ row[column.dataIndex || column.key] }}</span>
              </template>
            </WemTable>
          </div>
        </div>

        <!-- 自动发现 -->
        <div class="wem-card">
          <div class="wem-card-head">
            <div class="wem-card-title"><SearchOutlined style="color:#165dff" /> 🔍 自动发现（未纳入管理，{{ dev.discoveredItems.length }}）</div>
            <span class="text-muted">勾选后可批量生成环境变量模板，统一进入草稿预览</span>
          </div>
          <div class="wem-card-body tight">
            <WemTable
              ref="discoveredTable"
              table-id="devenv-discovered"
              row-key="id"
              :rows="discoveredRows"
              :columns="discoveredColumns"
              :page-size="10"
              :capabilities="discoverCaps"
              :batch-actions="discoverBatch"
              empty-text="没有待纳入的发现项"
              @selection-change="onDiscoverSelect"
              @batch="onDiscoverBatch"
            >
              <template #cell="{ row, column }">
                <template v-if="column.key === 'version'"><span class="mono">{{ row.versionText }}</span></template>
                <template v-else-if="column.key === 'installPath'"><span class="cell-path" :title="row.installPath">{{ row.installPath }}</span></template>
                <template v-else-if="column.key === 'sources'">
                  <a-tag v-for="s in row.sources || []" :key="s" color="default">{{ sourceName(s) }}</a-tag>
                </template>
                <template v-else-if="column.key === 'actions'">
                  <a-space size="small" @click.stop>
                    <a @click.stop="adopt(row)">纳入管理</a>
                    <a @click.stop="showDetail(row)">详情</a>
                    <a @click.stop="validateOne(row)">校验环境</a>
                    <a class="danger-link" @click.stop="ignoreItem(row)">忽略</a>
                  </a-space>
                </template>
                <span v-else>{{ row[column.dataIndex || column.key] }}</span>
              </template>
            </WemTable>
          </div>
        </div>
      </a-tab-pane>

      <!-- ==================== 子标签3：任务队列 ==================== -->
      <a-tab-pane key="tasks" tab="任务队列">
        <div class="toolbar" style="margin-bottom: 12px">
          <a-button size="small" @click="dev.loadTasks()"><template #icon><ReloadOutlined /></template>刷新</a-button>
          <a-button size="small" @click="api.task.pauseAll().then(dev.loadTasks)">全部暂停</a-button>
          <a-button size="small" @click="api.task.resumeAll().then(dev.loadTasks)">全部继续</a-button>
          <a-button size="small" @click="api.task.clearFinished().then(dev.loadTasks)">清空已完成任务</a-button>
          <span class="text-muted">并发下载数：</span>
          <a-input-number v-model:value="concurrency" size="small" :min="1" :max="5" style="width: 70px" @change="setConcurrency" />
        </div>

        <div class="wem-card">
          <div class="wem-card-body tight">
            <WemTable
              table-id="devenv-tasks"
              row-key="id"
              :rows="taskRows"
              :columns="taskColumns"
              :page-size="10"
              :capabilities="readCaps"
              :row-class="taskRowClass"
              empty-text="任务队列是空的"
            >
              <template #cell="{ row, column }">
                <template v-if="column.key === 'status'">
                  <a-tag :color="statusColor(row.status)">{{ row.statusText }}</a-tag>
                </template>
                <template v-else-if="column.key === 'progress'">
                  <a-progress
                    v-if="row.status === 'running' || row.status === 'paused'"
                    :percent="Math.round(row.progress || 0)" size="small"
                    :status="row.status === 'paused' ? 'normal' : 'active'"
                  />
                  <div v-if="row.total" class="text-muted mono" style="font-size:11px">
                    {{ formatBytes(row.received) }} / {{ formatBytes(row.total) }} · {{ formatSpeed(row.speed) }}
                  </div>
                  <div v-if="row.phase" class="text-muted" style="font-size:11px">{{ row.phase }}</div>
                  <span v-if="row.status !== 'running' && row.status !== 'paused' && !row.total">{{ row.statusText }}</span>
                </template>
                <template v-else-if="column.key === 'createdAt'">{{ fmtTime(row.createdAt) }}</template>
                <template v-else-if="column.key === 'actions'">
                  <a-space size="small" @click.stop>
                    <a @click.stop="showLogs(row)">日志</a>
                    <a v-if="row.status === 'running'" @click.stop="api.task.pause(row.id).then(dev.loadTasks)">暂停</a>
                    <a v-if="row.status === 'paused'" @click.stop="api.task.resume(row.id).then(dev.loadTasks)">继续</a>
                    <a v-if="['failed','cancelled'].includes(row.status)" @click.stop="api.task.retry(row.id).then(dev.loadTasks)">重试</a>
                    <a v-if="['queued','running','paused'].includes(row.status)" class="danger-link" @click.stop="api.task.cancel(row.id).then(dev.loadTasks)">取消</a>
                  </a-space>
                </template>
                <span v-else>{{ row[column.dataIndex || column.key] }}</span>
              </template>
            </WemTable>
          </div>
        </div>
      </a-tab-pane>

      <!-- ==================== 子标签4：环境审计 ==================== -->
      <a-tab-pane key="audit" tab="环境审计">
        <div class="toolbar" style="margin-bottom: 12px">
          <a-button type="primary" size="small" :loading="dev.auditing" @click="runAudit">
            <template #icon><SafetyOutlined /></template>
            {{ dev.auditing ? '审计中…' : '一键全盘审计' }}
          </a-button>
          <a-switch v-model:checked="auditDeep" checked-children="深度扫描" un-checked-children="快速扫描" />
          <template v-if="dev.audit">
            <a-button size="small" @click="exportReport('md')">导出 Markdown</a-button>
            <a-button size="small" @click="exportReport('html')">导出 HTML</a-button>
            <a-button size="small" @click="exportReport('csv')">导出 CSV</a-button>
          </template>
        </div>

        <div v-if="!dev.audit" class="empty-block">
          一键全盘审计：先执行本机软件自动扫描识别，再比对系统真实状态与已纳入管理环境，输出问题清单与一键修复方案。
        </div>

        <template v-else>
          <div class="stat-grid" style="margin-bottom: 12px">
            <div class="stat-card"><div class="stat-label">扫描软件</div><div class="stat-value">{{ dev.audit.total }}</div></div>
            <div class="stat-card"><div class="stat-label">已纳入管理</div><div class="stat-value" style="color:#00b42a">{{ dev.audit.managed }}</div></div>
            <div class="stat-card"><div class="stat-label">待接管</div><div class="stat-value" style="color:#ff7d00">{{ dev.audit.discovered }}</div></div>
            <div class="stat-card"><div class="stat-label">异常 ❌</div><div class="stat-value" style="color:#f53f3f">{{ dev.audit.summary.errors }}</div></div>
            <div class="stat-card"><div class="stat-label">警告 ⚠️</div><div class="stat-value" style="color:#ff7d00">{{ dev.audit.summary.warns }}</div></div>
          </div>

          <div class="wem-card">
            <div class="wem-card-head">
              <div class="wem-card-title"><AlertOutlined /> 工具管理内环境一致性检查</div>
              <span class="text-muted">每条问题可一键修复，修复方案直接写入草稿变量区</span>
            </div>
            <div class="wem-card-body tight">
              <WemTable
                table-id="devenv-issues"
                row-key="__key"
                :rows="issueRows"
                :columns="issueColumns"
                :page-size="10"
                :capabilities="readCaps"
                :row-class="issueRowClass"
                empty-text="未发现问题"
              >
                <template #cell="{ row, column }">
                  <template v-if="column.key === 'risk'">
                    <a-tag :color="{ high: 'red', medium: 'orange', low: 'blue' }[row.risk] || 'default'">
                      {{ row.riskText }}
                    </a-tag>
                  </template>
                  <template v-else-if="column.key === 'level'">
                    <a-tag :color="row.level === 'error' ? 'red' : 'orange'">
                      {{ row.level === 'error' ? '异常' : '警告' }}
                    </a-tag>
                  </template>
                  <template v-else-if="column.key === 'detail'"><span class="mono">{{ row.detail }}</span></template>
                  <template v-else-if="column.key === 'actions'">
                    <a-button size="small" type="primary" ghost :disabled="!(row.fix || []).length" @click.stop="fixIssue(row)">一键修复</a-button>
                  </template>
                  <span v-else>{{ row[column.dataIndex || column.key] }}</span>
                </template>
              </WemTable>
            </div>
          </div>

          <div class="split-2" style="margin-top: 14px">
            <div class="wem-card">
              <div class="wem-card-head"><div class="wem-card-title">PATH 有效性</div></div>
              <div class="wem-card-body">
                <div class="kv-list">
                  <span class="kv-key">无效条目</span><span class="kv-val">{{ dev.audit.invalidPaths.length }}</span>
                  <span class="kv-key">重复条目</span><span class="kv-val">{{ dev.audit.dupPaths.length }}</span>
                </div>
                <div v-for="p in dev.audit.invalidPaths" :key="p" class="mono" style="color:#f53f3f;font-size:12px;margin-top:6px">{{ p }}</div>
                <div v-for="p in dev.audit.dupPaths" :key="'d'+p" class="mono" style="color:#ff7d00;font-size:12px">{{ p }}</div>
              </div>
            </div>
            <div class="wem-card">
              <div class="wem-card-head"><div class="wem-card-title">多版本共存</div></div>
              <div class="wem-card-body">
                <div v-for="c in dev.audit.conflicts" :key="c.ruleId" style="margin-bottom:8px">
                  <b>{{ c.name }}</b>
                  <div v-for="i in c.items" :key="i.id" class="mono text-muted" style="font-size:12px">
                    {{ i.version || '未知版本' }} @ {{ i.installPath }}
                  </div>
                </div>
                <div v-if="!dev.audit.conflicts.length" class="empty-block">无多版本冲突</div>
              </div>
            </div>
          </div>
        </template>
      </a-tab-pane>
    </a-tabs>

    <!-- 一键部署向导 -->
    <a-modal v-model:open="deployOpen" title="一键部署向导" width="700px" ok-text="确认提交，进入任务队列" cancel-text="取消" @ok="submitDeploy">
      <a-steps :current="0" size="small" style="margin-bottom: 14px">
        <a-step title="选择版本" /><a-step title="安装目录" /><a-step title="变量预览" /><a-step title="提交任务" />
      </a-steps>

      <template v-if="deployItem">
        <a-form layout="vertical" style="margin-top: 4px">
          <a-row :gutter="12">
            <a-col :span="12">
              <a-form-item label="版本">
                <a-select v-model:value="deployForm.version" size="small" @change="onDeployVersion">
                  <a-select-option v-for="v in deployItem.versions" :key="v" :value="v">{{ v }}</a-select-option>
                </a-select>
              </a-form-item>
            </a-col>
            <a-col :span="12">
              <a-form-item label="安装目录">
                <a-input :value="deployForm.installDir" size="small" class="mono" @update:value="onInstallDirInput" />
              </a-form-item>
            </a-col>
          </a-row>
          <a-row :gutter="12">
            <a-col :span="12">
              <a-form-item label="安装模式">
                <a-radio-group v-model:value="deployForm.mode" size="small">
                  <a-radio-button value="portable">绿色压缩包解压</a-radio-button>
                  <a-radio-button value="silent">exe 静默安装</a-radio-button>
                </a-radio-group>
              </a-form-item>
            </a-col>
            <a-col :span="12">
              <a-form-item label="变量写入域">
                <a-radio-group v-model:value="deployForm.scope" size="small">
                  <a-radio-button value="user">用户变量</a-radio-button>
                  <a-radio-button value="system">系统变量{{ env.admin ? '' : '（需提权）' }}</a-radio-button>
                </a-radio-group>
              </a-form-item>
            </a-col>
          </a-row>
        </a-form>

        <div class="hint-box" style="margin-bottom: 10px">
          <InfoCircleOutlined />
          <div>所有新增/修改变量仅存入草稿内存区，不会直接写入注册表，等待全局【保存写入系统】。</div>
        </div>

        <div class="section-title">本次将新增 / 修改的环境变量（可取消勾选）</div>
        <a-spin :spinning="planLoading">
          <a-table
            size="small" row-key="name" :data-source="deployPlan" :pagination="false"
            :row-selection="{ selectedRowKeys: planKeys, onChange: (k) => (planKeys = k) }"
            :columns="planColumns" :scroll="{ x: 640, y: 200 }"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'op'">
                <a-tag :color="{ create: 'green', update: 'orange', same: 'default' }[record.op]">
                  {{ { create: '新增', update: '修改', same: '已存在' }[record.op] }}
                </a-tag>
              </template>
              <template v-else-if="column.key === 'scope'">
                <a-tag :color="record.scope === 'machine' ? 'purple' : 'blue'">{{ record.scope === 'machine' ? '系统' : '用户' }}</a-tag>
              </template>
              <template v-else-if="column.key === 'name'"><span class="mono">{{ record.name }}</span></template>
              <template v-else-if="column.key === 'value'"><span class="cell-path">{{ record.value }}</span></template>
            </template>
          </a-table>
        </a-spin>

        <div class="options" style="margin-top: 12px">
          <a-checkbox v-model:checked="deployForm.verify">部署完成自动校验版本</a-checkbox>
          <a-checkbox v-model:checked="deployForm.shortcut">添加桌面快捷方式</a-checkbox>
          <a-checkbox v-if="deployItem.registerService" v-model:checked="deployForm.service">注册 Windows 服务</a-checkbox>
        </div>
      </template>
    </a-modal>

    <!-- 纳入管理向导 -->
    <a-modal v-model:open="adoptOpen" title="纳入管理 · 环境变量预览" width="700px" ok-text="提交至草稿区" cancel-text="取消" @ok="submitAdopt">
      <div class="hint-box" style="margin-bottom: 10px">
        <InfoCircleOutlined />
        <div>自动识别安装路径与版本，推荐配套 HOME 变量与 PATH 模板；可修改路径、勾选变量，提交后进入草稿区等待统一写入。</div>
      </div>
      <div class="kv-list" style="margin-bottom: 10px">
        <span class="kv-key">软件</span><span class="kv-val">{{ adoptItem && adoptItem.name }}</span>
        <span class="kv-key">版本</span><span class="kv-val">{{ adoptItem && adoptItem.version }}</span>
        <span class="kv-key">安装路径</span><span class="kv-val">{{ adoptItem && adoptItem.installPath }}</span>
        <span class="kv-key">识别来源</span><span class="kv-val">{{ adoptItem && adoptItem.sources.map(sourceName).join('、') }}</span>
      </div>
      <a-table
        size="small" row-key="name" :data-source="adoptPlan" :pagination="false"
        :row-selection="{ selectedRowKeys: adoptKeys, onChange: (k) => (adoptKeys = k) }"
        :columns="planColumns" :scroll="{ x: 640, y: 220 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'op'">
            <a-tag :color="{ create: 'green', update: 'orange', same: 'default' }[record.op]">
              {{ { create: '新增', update: '修改', same: '已存在' }[record.op] }}
            </a-tag>
          </template>
          <template v-else-if="column.key === 'scope'">
            <a-tag :color="record.scope === 'machine' ? 'purple' : 'blue'">{{ record.scope === 'machine' ? '系统' : '用户' }}</a-tag>
          </template>
          <template v-else-if="column.key === 'name'"><span class="mono">{{ record.name }}</span></template>
          <template v-else-if="column.key === 'value'"><span class="cell-path">{{ record.value }}</span></template>
        </template>
      </a-table>
    </a-modal>

    <!-- 任务日志 -->
    <a-modal v-model:open="logsOpen" :title="`任务日志 · ${logsTask && logsTask.name}`" :footer="null" width="760px">
      <div class="toolbar" style="margin-bottom: 8px">
        <a-button size="small" @click="copyLogs">一键复制文本</a-button>
        <a-tag v-if="logsTask" :color="statusColor(logsTask.status)">{{ statusText(logsTask.status) }}</a-tag>
        <a-tag v-if="logsTask && logsTask.error" color="red">{{ logsTask.error }}</a-tag>
      </div>
      <div class="task-log mono">
        <div v-for="(l, i) in logsTask ? logsTask.logs : []" :key="i" :class="l.level">
          [{{ fmtTime(l.at) }}] {{ l.text }}
        </div>
        <div v-if="!logsTask || !logsTask.logs || !logsTask.logs.length" class="empty-block">暂无日志</div>
      </div>
    </a-modal>

    <!-- 关联变量 -->
    <a-modal v-model:open="varsOpen" :title="`关联变量 · ${varsItem && varsItem.name}`" :footer="null" width="720px">
      <a-table size="small" row-key="name" :data-source="varsItem ? varsItem.variables : []" :pagination="false" :columns="planColumns">
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'op'">
            <a-tag :color="{ create: 'green', update: 'orange', same: 'default' }[record.op]">
              {{ { create: '新增', update: '修改', same: '已存在' }[record.op] }}
            </a-tag>
          </template>
          <template v-else-if="column.key === 'scope'">
            <a-tag :color="record.scope === 'machine' ? 'purple' : 'blue'">{{ record.scope === 'machine' ? '系统' : '用户' }}</a-tag>
          </template>
          <template v-else-if="column.key === 'name'"><span class="mono">{{ record.name }}</span></template>
          <template v-else-if="column.key === 'value'"><span class="cell-path">{{ record.value }}</span></template>
        </template>
      </a-table>
    </a-modal>

    <!-- 软件详情 -->
    <a-modal v-model:open="detailOpen" :title="`扫描详情 · ${detailItem && detailItem.name}`" :footer="null" width="720px">
      <div class="kv-list">
        <span class="kv-key">软件名称</span><span class="kv-val">{{ detailItem && detailItem.name }}</span>
        <span class="kv-key">版本</span><span class="kv-val">{{ detailItem && detailItem.version }}</span>
        <span class="kv-key">安装路径</span><span class="kv-val">{{ detailItem && detailItem.installPath }}</span>
        <span class="kv-key">可执行文件</span><span class="kv-val">{{ detailItem && detailItem.exePath }}</span>
        <span class="kv-key">识别来源</span><span class="kv-val">{{ detailItem && detailItem.sources.map(sourceName).join('、') }}</span>
        <span class="kv-key">识别规则</span><span class="kv-val">{{ detailItem && detailItem.ruleId }}</span>
        <span class="kv-key">是否已纳管</span><span class="kv-val">{{ detailItem && detailItem.managed ? '是' : '否' }}</span>
      </div>
    </a-modal>

    <RuleLibraryModal v-model:open="ruleOpen" :rules="ruleRecords" @save="onRulesSave" />
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { Modal, message } from 'ant-design-vue'
import {
  SearchOutlined, FolderOpenOutlined, DatabaseOutlined, RocketOutlined, FileTextOutlined,
  CheckCircleOutlined, PlusOutlined, ReloadOutlined, SafetyOutlined, AlertOutlined, InfoCircleOutlined
} from '@ant-design/icons-vue'
import { useDevStore } from '@/store/dev'
import { useEnvStore } from '@/store/env'
import { useUiStore } from '@/store/ui'
import api from '@/api'
import { formatBytes, formatSpeed, formatTime, clipText } from '@/lib/helpers'
import RuleLibraryModal from '@/components/rules/RuleLibraryModal.vue'
import WemTable from '@/components/wem-table/WemTable.vue'

const dev = useDevStore()
const env = useEnvStore()
const ui = useUiStore()

const tab = ref('market')
const marketSearch = ref('')
const marketCategory = ref(undefined)
const downloadSourceTouched = ref(false)
const downloadSource = ref(env.config.downloadSource === 'official' ? 'official' : 'mirror')
watch(() => env.config.downloadSource, (v) => {
  if (downloadSourceTouched.value) return
  if (v === 'official' || v === 'mirror') downloadSource.value = v
})
const versionPick = ref({})
const deepScanTouched = ref(false)
const deepScan = ref(env.config.deepScan === true)
watch(() => env.config.deepScan, (v) => {
  if (deepScanTouched.value) return
  deepScan.value = v === true
})
const auditDeep = ref(false)
const concurrency = ref(2)

const deployOpen = ref(false)
const deployItem = ref(null)
const deployForm = reactive({ version: '', installDir: '', mode: 'portable', scope: 'user', verify: true, shortcut: false, service: false })
const deployDirAuto = ref(true)
const deployPlan = ref([])
const planKeys = ref([])
const planLoading = ref(false)

const adoptOpen = ref(false)
const adoptItem = ref(null)
const adoptPlan = ref([])
const adoptKeys = ref([])

const logsOpen = ref(false)
const logsTask = ref(null)
const varsOpen = ref(false)
const varsItem = ref(null)
const detailOpen = ref(false)
const detailItem = ref(null)
const ruleOpen = ref(false)
const ruleRecords = ref([])

const selectedDiscoveredKeys = ref([])
const discoveredTable = ref(null)
const readCaps = {
  select: false,
  inline: false,
  drag: false,
  batchDelete: false,
  batchTag: false,
  batchEnable: false,
  batchCopy: false,
  batchExport: false,
  expand: false,
  summary: false,
  contextMenu: false,
  format: false,
  presets: false
}
const discoverCaps = { ...readCaps, select: true, batchCopy: true, batchExport: true }
const discoverBatch = [{ key: 'adopt', label: '纳入管理' }]

const sourceMap = {
  registry: '注册表',
  'path-scan': 'PATH 扫描',
  'dir-scan': '目录扫描',
  'home-var': 'HOME 变量',
  customDir: '自定义目录'
}
function sourceName(s) {
  return sourceMap[s] || s
}

const marketItems = computed(() => {
  let list = dev.catalog
  if (marketCategory.value) list = list.filter((i) => i.category === marketCategory.value)
  const kw = marketSearch.value.trim().toLowerCase()
  if (kw) list = list.filter((i) => i.name.toLowerCase().includes(kw) || i.id.toLowerCase().includes(kw))
  return list
})

const taskLogs = computed(() => {
  const out = []
  for (const t of dev.tasks) for (const l of t.logs || []) out.push(l)
  return out.sort((a, b) => b.at - a.at).slice(0, 60)
})

const lastScanText = computed(() => {
  const at = env.config.lastScanAt
  return at ? formatTime(Number(at)) : ''
})

const managedColumns = [
  { title: '软件', key: 'name', dataIndex: 'name', width: 150 },
  { title: '版本', key: 'version', dataIndex: 'version', type: 'version', width: 120 },
  { title: '安装路径', key: 'installPath', dataIndex: 'installPath', ellipsis: true },
  { title: '识别来源', key: 'sources', dataIndex: 'sourcesText', width: 180 },
  { title: '运行状态', key: 'status', dataIndex: 'statusText', width: 90 },
  { title: '操作', key: 'actions', width: 280, fixed: 'right', sortable: false, filterable: false }
]

const discoveredColumns = [
  { title: '软件', key: 'name', dataIndex: 'name', width: 150 },
  { title: '版本', key: 'version', dataIndex: 'version', type: 'version', width: 120 },
  { title: '安装路径', key: 'installPath', dataIndex: 'installPath', ellipsis: true },
  { title: '识别来源', key: 'sources', dataIndex: 'sourcesText', width: 170 },
  { title: '操作', key: 'actions', width: 250, fixed: 'right', sortable: false, filterable: false }
]

const taskColumns = [
  { title: '任务名称', key: 'name', dataIndex: 'name', width: 220, ellipsis: true },
  { title: '状态', key: 'status', dataIndex: 'statusText', width: 90 },
  { title: '进度', key: 'progress', dataIndex: 'progress', type: 'number', width: 240, filterable: false },
  { title: '创建时间', key: 'createdAt', dataIndex: 'createdAt', type: 'date', width: 160 },
  { title: '操作', key: 'actions', width: 190, fixed: 'right', sortable: false, filterable: false }
]

const issueColumns = [
  { title: '风险', key: 'risk', dataIndex: 'riskText', width: 90 },
  { title: '级别', key: 'level', dataIndex: 'levelText', width: 90 },
  { title: '问题', key: 'title', dataIndex: 'title', width: 260 },
  { title: '详情', key: 'detail', dataIndex: 'detail', ellipsis: true },
  { title: '操作', key: 'actions', width: 110, fixed: 'right', sortable: false, filterable: false }
]

const RISK_TEXT = { high: '高风险', medium: '中风险', low: '低风险' }

function decorateSoftware(item) {
  return {
    ...item,
    versionText: item.version || '未知',
    sourcesText: (item.sources || []).map(sourceName).join('、'),
    statusText: '正常'
  }
}

const managedRows = computed(() => (dev.managedItems || []).map(decorateSoftware))
const discoveredRows = computed(() => (dev.discoveredItems || []).map(decorateSoftware))
const selectedDiscovered = computed(() =>
  (dev.discoveredItems || []).filter((item) => selectedDiscoveredKeys.value.includes(item.id))
)
const taskRows = computed(() => (dev.tasks || []).map((task) => ({
  ...task,
  statusText: statusText(task.status)
})))
const issueRows = computed(() => {
  const list = dev.audit && Array.isArray(dev.audit.issues) ? dev.audit.issues : []
  return list.map((issue, index) => ({
    ...issue,
    __key: `${issue.level || 'info'}::${issue.title || 'issue'}::${index}`,
    riskText: RISK_TEXT[issue.risk] || issue.risk || '',
    levelText: issue.level === 'error' ? '异常' : '警告'
  }))
})

function onDiscoverSelect(keys) {
  selectedDiscoveredKeys.value = Array.isArray(keys) ? keys : []
}

function onDiscoverBatch(payload) {
  if (payload && payload.action === 'adopt') batchAdopt()
}

const planColumns = [
  { title: '状态', key: 'op', width: 78 },
  { title: '归属', key: 'scope', width: 70 },
  { title: '变量名', key: 'name', width: 170 },
  { title: '值', key: 'value', ellipsis: true },
  { title: '说明', key: 'remark', width: 140, ellipsis: true }
]

function fmtTime(ts) {
  return formatTime(ts)
}
function formatBytesAlias(v) {
  return formatBytes(v)
}

function installedTag(item) {
  const hit = dev.scanResult ? dev.scanResult.items.find((x) => x.ruleId === item.ruleId) : null
  if (!hit) return { color: 'default', text: '未扫描' }
  return hit.managed ? { color: 'green', text: '已安装' } : { color: 'blue', text: '可安装' }
}

/* ------------------------------ 环境市场 ------------------------------ */

function safeVersionDir(version) {
  return String(version || 'unknown').replace(/[<>:"/\\|?*]/g, '_')
}

function defaultInstallDir(item, version) {
  const root = env.config.devRoot || 'C:\\dev\\soft'
  if ((env.config.multiVersionMode || 'coexist') === 'overwrite') return `${root}\\${item.id}`
  return `${root}\\${item.id}\\${safeVersionDir(version)}`
}

function openDeploy(item) {
  deployItem.value = item
  deployForm.version = versionPick.value[item.id] || item.versions[0]
  deployDirAuto.value = true
  deployForm.installDir = defaultInstallDir(item, deployForm.version)
  deployForm.mode = item.installMode
  deployForm.scope = 'user'
  deployForm.verify = env.config.deployVerifyVersion !== false
  deployOpen.value = true
  loadPlan()
}

function onDeployVersion(version) {
  if (!deployDirAuto.value || !deployItem.value) return
  deployForm.installDir = defaultInstallDir(deployItem.value, version)
  loadPlan()
}

function onInstallDirInput(value) {
  deployDirAuto.value = false
  deployForm.installDir = value
}

async function loadPlan() {
  if (!deployItem.value) return
  planLoading.value = true
  try {
    const res = await api.devenv.buildPlan({
      ruleId: deployItem.value.ruleId,
      installPath: deployForm.installDir,
      scope: deployForm.scope
    })
    if (res.ok) {
      deployPlan.value = res.data.plan
      planKeys.value = res.data.plan.filter((p) => p.op !== 'same').map((p) => p.name)
    } else {
      message.error(res.message)
    }
  } finally {
    planLoading.value = false
  }
}

function showTemplate(item) {
  varsItem.value = { name: item.name, variables: [] }
  api.devenv.buildPlan({ ruleId: item.ruleId, installPath: `${env.config.devRoot || 'C:\\dev\\soft'}\\${item.id}` }).then((res) => {
    if (res.ok) varsItem.value = { name: item.name, variables: res.data.plan }
    varsOpen.value = true
  })
}

async function submitDeploy() {
  const selected = deployPlan.value.filter((p) => planKeys.value.includes(p.name))
  let dependsOn = []
  if (env.config.taskDepends === false) {
    message.info('已关闭任务依赖编排，本次不自动部署前置软件')
  } else {
    try {
      const dep = await selectedRequires(deployItem.value)
      dependsOn = dep.ids
      if (dep.names.length) message.info(`将先部署依赖：${dep.names.join('、')}`)
    } catch (err) {
      message.error(err.message || '依赖任务创建失败')
      return
    }
  }
  if (deployForm.mode === 'silent' && env.config.avWarning !== false) {
    message.warning('杀毒软件可能会拦截静默安装程序。若部署失败，请暂时允许该安装包，或改用绿色解压。')
  }
  const res = await api.devenv.deploy({
    itemId: deployItem.value.id,
    version: deployForm.version,
    installDir: deployForm.installDir,
    mode: deployForm.mode,
    source: downloadSource.value,
    scope: deployForm.scope,
    versionMode: env.config.multiVersionMode || 'coexist',
    verifyVersion: deployForm.verify !== false,
    options: { verify: deployForm.verify, shortcut: deployForm.shortcut, service: deployForm.service },
    dependsOn
  })
  if (res.ok) {
    message.success(`任务已加入队列：${res.data.name}`)
    ui.tip(`部署任务已创建：${deployItem.value.name}`, 'info')
    deployOpen.value = false
    dev.loadTasks()
  } else {
    message.error(res.message)
  }
}

function softwarePresent(id) {
  const pools = []
  if (dev.scanResult && Array.isArray(dev.scanResult.items)) pools.push(...dev.scanResult.items)
  pools.push(...(dev.managedItems || []), ...(dev.discoveredItems || []))
  return pools.some((row) => {
    if (!row || row.ignored) return false
    const rule = String(row.ruleId || '')
    const rowId = String(row.id || '')
    return rule === id || rowId === id
  })
}

/** 本机还没有的前置软件先入队，当前部署任务等它们成功后再开始。 */
async function selectedRequires(item) {
  const ids = []
  const names = []
  for (const reqId of item && item.requires ? item.requires : []) {
    if (softwarePresent(reqId)) continue
    const existing = (dev.tasks || []).find((task) =>
      task.type === 'deploy' && task.params && task.params.itemId === reqId &&
      ['queued', 'running', 'paused', 'success'].includes(task.status)
    )
    if (existing) {
      if (existing.status !== 'success') ids.push(existing.id)
      continue
    }
    const dep = (dev.catalog || []).find((entry) => entry.id === reqId)
    if (!dep) {
      message.warning(`清单里没有依赖「${reqId}」，将继续部署当前软件`)
      continue
    }
    const depVersion = versionPick.value[dep.id] || (dep.versions && dep.versions[0])
    const res = await api.devenv.deploy({
      itemId: dep.id,
      version: depVersion,
      installDir: defaultInstallDir(dep, depVersion),
      mode: dep.installMode,
      source: downloadSource.value,
      scope: deployForm.scope,
      versionMode: env.config.multiVersionMode || 'coexist',
      verifyVersion: deployForm.verify !== false
    })
    if (!res.ok || !res.data || !res.data.id) throw new Error((res && res.message) || `依赖 ${dep.name} 未能加入队列`)
    ids.push(res.data.id)
    names.push(dep.name)
  }
  if (ids.length) dev.loadTasks()
  return { ids, names }
}

/* ------------------------------ 已安装管理 ------------------------------ */

async function rescan() {
  const res = await dev.scan({ deep: deepScan.value, manual: true })
  if (res.ok) {
    if (res.data.cancelled) message.warning('扫描已取消')
    else message.success(`扫描完成，发现 ${res.data.items.length} 项`)
  } else {
    message.error(res.message)
  }
}

function adopt(record) {
  adoptItem.value = record
  adoptPlan.value = (record.variables || []).filter((v) => v.op !== 'same')
  adoptKeys.value = adoptPlan.value.map((v) => v.name)
  adoptOpen.value = true
}

function submitAdopt() {
  const selected = adoptPlan.value.filter((v) => adoptKeys.value.includes(v.name))
  const r = env.applyTemplateVars(selected, {
    source: 'env-market',
    originId: adoptItem.value.id,
    originName: `${adoptItem.value.name} 纳入管理`
  })
  adoptOpen.value = false
  if (r.errors.length) message.warning(`部分变量未能加入草稿：${r.errors.join('；')}`)
  else message.success(`已提交 ${r.added.length} 条变量到草稿区，等待【保存写入系统】`)
}

async function batchAdopt() {
  const targets = dev.discoveredItems.filter((i) => selectedDiscoveredKeys.value.includes(i.id))
  if (!targets.length) return
  let total = 0
  for (const t of targets) {
    const selected = (t.variables || []).filter((v) => v.op !== 'same')
    const r = env.applyTemplateVars(selected, { source: 'env-market', originId: t.id, originName: `${t.name} 纳入管理` })
    total += r.added.length
  }
  selectedDiscoveredKeys.value = []
  discoveredTable.value?.clearSelection()
  message.success(`已批量提交 ${total} 条变量到草稿区`)
}

async function validateOne(record) {
  const res = await api.devenv.validateItem(record)
  if (res.ok) {
    const d = res.data
    if (d.ok) message.success(`校验通过：${record.name} ${d.version}`)
    else Modal.warning({ title: `${record.name} 校验未通过`, content: `执行 ${d.cmd} 未取得版本输出，可能需要重新打开终端。` })
  } else {
    message.error(res.message)
  }
}

function showDetail(record) {
  detailItem.value = record
  detailOpen.value = true
}

function showVars(record) {
  varsItem.value = record
  varsOpen.value = true
}

async function ignoreItem(record) {
  await api.devenv.addIgnore(`${record.ruleId}::${record.installPath}`)
  if (dev.scanResult) {
    dev.scanResult.items = dev.scanResult.items.map((i) => (i.id === record.id ? { ...i, ignored: true } : i))
  }
  message.success('已加入忽略清单，下次扫描不再展示')
}

async function uninstallItem(record) {
  const run = async () => {
    const res = await api.devenv.uninstall({
      name: record.name,
      installPath: record.installPath,
      uninstallCmd: record.uninstall,
      mode: record.uninstall ? 'installer' : 'portable',
      ruleId: record.ruleId
    })
    if (res.ok) {
      // 变量标记待删除，进入草稿
      const vars = (record.variables || []).filter((v) => v.op === 'same')
      env.applyTemplateVars(vars.map((v) => ({ ...v, op: 'delete' })), {
        source: 'env-market',
        originId: `uninstall-${record.id}`,
        originName: `卸载 ${record.name}`
      })
      message.success('卸载任务已创建，关联变量已标记待删除（保存后生效）')
      dev.loadTasks()
    } else {
      message.error(res.message)
    }
  }
  if (env.config.confirmDanger === false) return run()
  Modal.confirm({
    title: `确认卸载 ${record.name}？`,
    content:
      '绿色版将删除安装目录并标记关联 HOME 变量、PATH 条目待删除；安装版将调用自带卸载程序。' +
      '不会删除你手动独立添加的同名变量。',
    okText: '确认卸载',
    okType: 'danger',
    cancelText: '取消',
    onOk: run
  })
}

/* ------------------------------ 任务队列 ------------------------------ */

function statusText(s) {
  return { queued: '排队', running: '执行中', paused: '已暂停', success: '成功', failed: '失败', cancelled: '已取消' }[s] || s
}
function statusColor(s) {
  return { queued: 'default', running: 'processing', paused: 'warning', success: 'success', failed: 'error', cancelled: 'default' }[s] || 'default'
}
function taskRowClass(record) {
  return record.status === 'failed' ? 'row-removed' : ''
}

function issueRowClass(record) {
  return record.level === 'error' ? 'row-removed' : 'row-modified'
}

async function openInstallDir(record) {
  const target = record && record.installPath
  if (!target) return message.warning('没有可打开的安装路径')
  const res = await api.tool.openFolder(target)
  if (!res.ok) message.error(res.message || '无法打开目录')
}

function showLogs(task) {
  logsTask.value = task
  logsOpen.value = true
}

async function copyLogs() {
  const text = (logsTask.value.logs || []).map((l) => `[${formatTime(l.at)}] [${l.level}] ${l.text}`).join('\r\n')
  try {
    await navigator.clipboard.writeText(text)
    message.success('日志已复制')
  } catch (_) {
    message.warning('复制失败')
  }
}

async function setConcurrency(v) {
  await api.task.setConcurrency(v)
  message.success(`并发下载数已设为 ${v}`)
}

/* ------------------------------ 环境审计 ------------------------------ */

async function runAudit() {
  const res = await dev.runAudit({ deep: auditDeep.value })
  if (res.ok) {
    const s = res.data.summary
    message.info(`审计完成：${s.errors} 个异常，${s.warns} 个警告`)
    ui.tip(`环境审计完成：${s.errors} 异常 / ${s.warns} 警告`, s.errors ? 'error' : 'success')
  } else {
    message.error(res.message)
  }
}

function fixIssue(issue) {
  const r = dev.applyFix(issue)
  if (r.errors.length) message.warning(`部分修复未能写入草稿：${r.errors.join('；')}`)
  else message.success(`已将 ${r.added.length} 条修复方案写入草稿区，等待【保存写入系统】`)
}

async function exportReport(format) {
  const res = await api.devenv.exportReport({ format, report: dev.audit })
  if (res.ok && !res.data.canceled) message.success(`报告已导出：${res.data.file}`)
}

function openDir(kind) {
  if (kind === 'dev') api.devenv.openDir('dev')
  else api.devenv.openDir('cache')
}

function unwrapRules(res) {
  if (Array.isArray(res)) return res
  const data = res && Object.prototype.hasOwnProperty.call(res, 'data') ? res.data : res
  if (Array.isArray(data)) return data
  if (data && Array.isArray(data.rules)) return data.rules
  if (data && Array.isArray(data.ruleList)) return data.ruleList
  return []
}

function mapRuleForModal(raw, index) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const enabled = src.enabled !== undefined ? !!src.enabled : src.enable !== false
  return {
    ...src,
    id: src.id || `rule-${index}`,
    name: src.name || '',
    category: src.category || '未分类',
    enabled,
    matchText: src.matchText || src.executableName || '',
    matchMode: src.matchMode || 'contains',
    versionCmd: src.versionCmd || '',
    remark: src.remark || src.description || '',
    builtin: !!src.builtin
  }
}

function toApiRule(rule) {
  const src = JSON.parse(JSON.stringify(rule || {}))
  const matchText = String(src.matchText || src.executableName || '').trim()
  const enabled = src.enabled !== undefined ? !!src.enabled : src.enable !== false
  const level = Number(src.parentLevels != null ? src.parentLevels : (src.installPathExtract && src.installPathExtract.level)) || 0
  const prevMode = src.installPathExtract && src.installPathExtract.mode
  let envTemplate = Array.isArray(src.envTemplate) ? src.envTemplate : []
  if (!envTemplate.length && src.homeVar) {
    envTemplate = [{
      varKey: src.homeVar,
      varValue: '{{installPath}}',
      scope: 'user',
      remark: src.remark || src.description || '',
      pathPosition: ''
    }]
  }
  return {
    id: src.id,
    name: src.name,
    alias: src.alias || [],
    category: src.category || '未分类',
    enable: enabled,
    description: src.remark || src.description || '',
    scanSource: src.scanSource || ['registry', 'path-scan', 'customDir'],
    executableName: matchText,
    versionCmd: src.versionCmd || '',
    versionRegex: src.versionRegex || '',
    installPathExtract: { mode: level > 0 ? 'parentNLevel' : (prevMode || 'self'), level },
    envTemplate,
    dependRuleIds: src.dependRuleIds || [],
    tags: src.tags || [],
    builtin: !!src.builtin
  }
}

function builtinDeleteRejected(resOrErr) {
  const msg = String((resOrErr && (resOrErr.message || resOrErr)) || '')
  return /内置|builtin|不可删除|不能删除/i.test(msg)
}

async function openRuleLibrary() {
  try {
    const res = await api.rules.list()
    if (res && res.ok === false) {
      message.error(res.message || '读取识别规则失败')
      return
    }
    ruleRecords.value = unwrapRules(res).map(mapRuleForModal)
    ruleOpen.value = true
  } catch (err) {
    message.error(err.message || '读取识别规则失败')
  }
}

async function onRulesSave(rules) {
  const incoming = Array.isArray(rules) ? rules : []
  const prev = ruleRecords.value.slice()
  const keep = new Set(incoming.map((r) => r && r.id).filter(Boolean))
  const errors = []
  for (const rule of incoming) {
    try {
      const res = await api.rules.save(toApiRule(rule))
      if (!res || res.ok === false) errors.push(`${rule.name || rule.id}：${(res && res.message) || '保存失败'}`)
    } catch (err) {
      errors.push(`${rule.name || rule.id}：${err.message || '保存失败'}`)
    }
  }
  for (const old of prev) {
    if (!old || !old.id || keep.has(old.id)) continue
    if (old.builtin) continue
    try {
      const res = await api.rules.remove(old.id)
      if (!res || res.ok === false) {
        if (builtinDeleteRejected(res)) continue
        errors.push(`删除 ${old.name || old.id}：${(res && res.message) || '失败'}`)
      }
    } catch (err) {
      if (builtinDeleteRejected(err)) continue
      errors.push(`删除 ${old.name || old.id}：${err.message || '失败'}`)
    }
  }
  if (errors.length) message.error([...new Set(errors)].slice(0, 3).join('；'))
  else message.success('识别规则已保存')
  try { await dev.loadRules() } catch (_) { /* 刷新失败不影响本次结果提示 */ }
}

onMounted(() => {
  dev.loadCatalog()
  dev.loadTasks()
  dev.loadRules()
  if (env.config.scanOnEnterPage !== false && !dev.scanResult && !dev.scanning) dev.scan({})
})
</script>

<style scoped>
.market-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
  gap: 12px;
}

.market-card {
  border: 1px solid var(--wem-border);
  border-radius: 12px;
  padding: 14px;
  background: var(--wem-card);
  transition: all 0.16s ease;
}

.market-card:hover {
  border-color: var(--wem-primary);
  box-shadow: var(--wem-shadow);
}

.market-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.market-name {
  font-size: 14px;
  font-weight: 600;
}

.market-desc {
  font-size: 12px;
  color: var(--wem-text-2);
  margin-top: 6px;
  line-height: 1.6;
  min-height: 32px;
}

.market-meta {
  font-size: 11.5px;
  color: var(--wem-text-3);
  margin-top: 6px;
  display: flex;
  gap: 6px;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  margin: 6px 0;
}

.options {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--wem-border);
  border-radius: 8px;
  background: var(--wem-card-alt);
  font-size: 12.5px;
}

.log-line {
  font-size: var(--wem-log-fs, 12px);
  padding: 3px 0;
  border-bottom: 1px dashed var(--wem-border);
  word-break: break-all;
}

.log-line.error {
  color: var(--wem-danger);
}

.log-line.warn {
  color: var(--wem-warning);
}

.task-log {
  max-height: 380px;
  overflow: auto;
  padding: 10px 12px;
  border: 1px solid var(--wem-border);
  border-radius: 8px;
  background: var(--wem-card-alt);
  font-size: var(--wem-log-fs, 12px);
  line-height: 1.7;
}

.task-log .error {
  color: var(--wem-danger);
}

.task-log .warn {
  color: var(--wem-warning);
}

.danger-link {
  color: var(--wem-danger);
}
</style>
