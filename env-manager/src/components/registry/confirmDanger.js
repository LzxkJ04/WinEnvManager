/**
 * 注册表模块高危确认的薄封装。
 *
 * dialogService 只导出 danger(options)，其中可用字段为
 * title / warning / columns / rows / hint；kind='danger' 时
 * WemDialogHost 会强制要求勾选风险确认复选框才能点「确认执行」。
 * 这里把正文里的补充说明并入 warning，避免调用方误用不存在的 content 字段。
 */
import { danger } from '@/components/dialogs/dialogService'

export function confirmDanger(options = {}) {
  const parts = [options.warning, options.content].filter(Boolean)
  return danger({
    title: options.title || '⚠️ 注册表修改高危警告',
    warning: parts.join('\n\n'),
    hint: options.hint || '建议先对该注册表分支创建注册表备份，出问题可以回滚。',
    rows: options.rows || [],
    columns: options.columns || []
  })
}

export default confirmDanger
