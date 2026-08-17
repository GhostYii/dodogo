// Markdown 预览：POST /api/markdown/preview {text} → {html}

import { api } from './api';

export async function mdToHtml(text: string): Promise<string> {
  try {
    const d = await api<{ html: string }>('/markdown/preview', { body: { text } });
    return d.html || '<p class="muted">（空）</p>';
  } catch {
    return '<p class="muted">预览失败</p>';
  }
}
