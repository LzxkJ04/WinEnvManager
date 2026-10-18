// Tauri 环境检测：非 Tauri 环境（纯浏览器预览）自动降级为演示模式
import { listen } from '@tauri-apps/api/event'

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

if (isTauri) {
  window.__TAURI_EVENT__ = { listen }
}
