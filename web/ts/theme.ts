// 深色 / 浅色主题（<html data-theme>，localStorage 持久化）

export function currentTheme(): string {
  return document.documentElement.getAttribute('data-theme') || 'light';
}

export function applyTheme(t: string): void {
  document.documentElement.setAttribute('data-theme', t);
  try {
    localStorage.setItem('dodogo-theme', t);
  } catch {
    /* ignore */
  }
}

export function initTheme(): void {
  const t = currentTheme();
  if (t !== 'dark' && t !== 'light') applyTheme('light');
}

export function toggleTheme(): void {
  applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}
