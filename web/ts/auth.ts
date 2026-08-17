// 登录 / 注册 / 初始化向导

import { api, errMsg } from './api';
import { qs } from './util';
import { toast } from './toast';

export function initAuth(): void {
  const form = qs<HTMLFormElement>('#auth-form');
  const page = document.body.dataset.page;
  if (!form || (page !== 'login' && page !== 'register' && page !== 'setup')) return;

  const errorEl = qs<HTMLElement>('#auth-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (errorEl) errorEl.hidden = true;

    const fd = new FormData(form);
    const username = String(fd.get('username') || '').trim();
    const email = String(fd.get('email') || '').trim();
    const displayName = String(fd.get('displayName') || '').trim();
    const password = String(fd.get('password') || '');
    const confirm = String(fd.get('confirm') || '');
    const submitBtn = form.querySelector<HTMLButtonElement>('button[type=submit]');
    const label = submitBtn?.textContent || '提交';

    if (page !== 'login') {
      if (password !== confirm) {
        showError(errorEl, '两次输入的密码不一致');
        return;
      }
      if (password.length < 8 || password.length > 64) {
        showError(errorEl, '密码长度需为 8-64 字符');
        return;
      }
      if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
        showError(errorEl, '密码需同时包含字母与数字');
        return;
      }
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '请稍候…';
    }
    try {
      if (page === 'login') {
        await api('/auth/login', {
          method: 'POST',
          body: {
            identity: String(fd.get('identity') || '').trim(),
            password,
            remember: fd.get('remember') === 'on',
          },
        });
        location.href = '/';
      } else {
        await api('/auth/register', {
          method: 'POST',
          body: {
            username,
            email: email || undefined,
            display_name: displayName || undefined,
            password,
          },
        });
        // 注册后自动登录
        await api('/auth/login', { method: 'POST', body: { identity: username, password, remember: true } });
        toast('账号创建成功', 'success');
        setTimeout(() => {
          location.href = '/';
        }, 350);
      }
    } catch (err) {
      showError(errorEl, errMsg(err));
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = label;
      }
    }
  });
}

function showError(errorEl: HTMLElement | null, msg: string): void {
  if (errorEl) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  } else {
    toast(msg, 'error');
  }
}
