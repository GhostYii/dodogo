// Toast 轻提示

import { el, qs } from './util';

let container: HTMLElement | null = null;

export type ToastKind = 'info' | 'success' | 'error';

export function toast(message: string, kind: ToastKind = 'info', timeout = 3200): void {
  if (!container) {
    container = qs('#toasts') ?? document.body.appendChild(el('div', { id: 'toasts', class: 'toasts' }));
  }
  const t = el('div', { class: `toast toast-${kind}` });
  t.textContent = message;
  container.appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 260);
  }, timeout);
}
