// DoDoGo 前端入口：按页面分发初始化

import { initTheme } from './theme';
import { initTopbar } from './topbar';
import { initAuth } from './auth';
import { initHome } from './home';
import { initBoard } from './board';
import { initMetaList } from './meta-list';
import { initMembers } from './members';
import { initSettings } from './settings';
import { initSearch } from './search';
import { initNotifications } from './notifications';
import { initAdmin } from './admin';
import { initProjectIcons } from './project-icon';
import { initUserProfileLinks } from './user-profile';

function init(): void {
  initTheme();
  const page = document.body.dataset.page;
  if (page === 'login' || page === 'register' || page === 'setup') {
    initAuth();
    return;
  }
  if (page === 'error') return;

  initTopbar();
  void initProjectIcons();
  initUserProfileLinks();
  switch (page) {
    case 'home':
      initHome();
      break;
    case 'board':
      initBoard();
      break;
    case 'milestones':
      initMetaList('milestones');
      break;
    case 'releases':
      initMetaList('releases');
      break;
    case 'members':
      initMembers();
      break;
    case 'settings':
      initSettings();
      break;
    case 'search':
      initSearch();
      break;
    case 'notifications':
      initNotifications();
      break;
    case 'admin':
      initAdmin();
      break;
    default:
      break;
  }
}

init();
