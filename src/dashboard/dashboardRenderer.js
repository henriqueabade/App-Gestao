// Lógica de frontend da tela de Painel
// Renderer process logic
window.addEventListener('DOMContentLoaded', () => {
  function collectState() {
    const activeItem = document.querySelector('.sidebar-item.active');
    const sectionId = activeItem ? activeItem.getAttribute('data-section') : 'dashboard';
    const storage = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      storage[k] = localStorage.getItem(k);
    }
    return { sectionId, storage };
  }

  // Expose state collector globally so other modules can persist it
  window.collectState = collectState;

  const MODULE_CSS_IDS = [
    'materia-css',
    'crm-css',
    'products-css',
    'users-css',
    'orders-css',
    'budgets-css'
  ];

  const HTML_CACHE = {};
  function preloadHtml(path) {
    fetch(path).then(res => res.text()).then(t => { HTML_CACHE[path] = t; }).catch(() => {});
  }

  preloadHtml('../estoqueMateriaPrima/estoqueMateriaPrima.html');
  preloadHtml('../produtos/produtos.html');
  preloadHtml('../usuarios/usuarios.html');
  preloadHtml('../orders/orders.html');
  preloadHtml('../budgets/budgets.html');
  preloadHtml('../crm/html/crm_clients.html');

  function ensureCssLoaded(id, href) {
    return new Promise(resolve => {
      let link = document.getElementById(id);
      if (link) return resolve();
      link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = () => resolve();
      document.head.appendChild(link);
    });
  }

  function removeModuleCss(exceptId = null) {
    MODULE_CSS_IDS.forEach(id => {
      if (id !== exceptId) {
        const el = document.getElementById(id);
        if (el) el.remove();
      }
    });
  }

  function restoreState(state) {
    if (!state) return;
    if (state.storage) {
      Object.entries(state.storage).forEach(([k, v]) => localStorage.setItem(k, v));
    }
    if (state.sectionId) {
      const item = document.querySelector(`.sidebar-item[data-section="${state.sectionId}"]`);
      if (item) item.click();
    }
  }
  // Sales Chart
  const salesCtx = document.getElementById('salesChart').getContext('2d');
  const salesChart = new Chart(salesCtx, {
    type: 'line',
    data: {
      labels: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun'],
      datasets: [{
        label: 'Vendas (R$)',
        data: [3200, 2800, 3500, 4200, 3800, 4500],
        backgroundColor: 'rgba(217, 119, 6, 0.2)',
        borderColor: 'rgba(180, 83, 9, 1)',
        borderWidth: 2,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(0, 0, 0, 0.05)' }
        },
        x: { grid: { display: false } }
      }
    }
  });

  // Categories Chart
  const categoriesCtx = document.getElementById('categoriesChart').getContext('2d');
  const categoriesChart = new Chart(categoriesCtx, {
    type: 'doughnut',
    data: {
      labels: ['Decoração', 'Móveis', 'Iluminação', 'Têxteis', 'Outros'],
      datasets: [{
        data: [35, 25, 20, 15, 5],
        backgroundColor: [
          'rgba(180, 83, 9, 0.8)',
          'rgba(217, 119, 6, 0.8)',
          'rgba(245, 158, 11, 0.8)',
          'rgba(251, 191, 36, 0.8)',
          'rgba(254, 243, 199, 0.8)'
        ],
        borderColor: 'white',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' } }
    }
  });

  // Função para exibir mensagens do sistema no espaço reservado
  const messageBox = document.getElementById('system-messages');
  function showMessage(text) {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50';
    overlay.innerHTML = `
      <div class="bg-white p-4 rounded-lg space-y-4 w-full max-w-xs text-center">
        <p class="text-gray-800">${text}</p>
        <button id="msgOk" class="mx-auto bg-[#A394A7] hover:bg-[#8f8698] text-white px-4 py-2 rounded">OK</button>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#msgOk').addEventListener('click', () => overlay.remove());
  }
// disponibiliza helper global para outros modulos utilizarem
window.showSystemMessage = showMessage;

  // Carrega o módulo de matéria-prima apenas uma vez
  async function loadRawMaterialModule() {
    removeModuleCss('materia-css');
    const section = document.getElementById('raw-material-section');
    if (!section.dataset.loaded) {
      const path = '../estoqueMateriaPrima/estoqueMateriaPrima.html';
      const html = HTML_CACHE[path] || await (await fetch(path)).text();
      await ensureCssLoaded('materia-css', '../estoqueMateriaPrima/estoqueMateriaPrima.css');
      section.innerHTML = html;
      section.dataset.loaded = 'true';

      const script = document.createElement('script');
      script.src = '../estoqueMateriaPrima/estoqueMateriaPrimaRenderer.js';
      section.appendChild(script);
    } else {
      await ensureCssLoaded('materia-css', '../estoqueMateriaPrima/estoqueMateriaPrima.css');
    }
  }

  // Carrega o submódulo de CRM dinamicamente
  async function loadCrmModule(page = 'crm_clients') {
    removeModuleCss('crm-css');
    if (window.crmTasksCleanup) {
      window.crmTasksCleanup();
      window.crmTasksCleanup = null;
    }
    if (window.ModalManager) window.ModalManager.closeAll();
    const section = document.getElementById('crm-section');
    section.innerHTML = '';
    const path = `../crm/html/${page}.html`;
    const html = HTML_CACHE[path] || await (await fetch(path)).text();
    await ensureCssLoaded('crm-css', '../crm/css/style.css');
    section.innerHTML = html;
    const script = document.createElement('script');
    script.src = `../crm/js/crm.js?v=${Date.now()}`;
    script.onload = () => { if (window.initCrm) window.initCrm(); };
    section.appendChild(script);
    if (page === 'crm_clients') {
      const actions = document.createElement('script');
      actions.src = `../crm/js/crm_clientes.js?v=${Date.now()}`;
      actions.onload = () => {
        if (window.initClientes) window.initClientes();
        if (window.crmClientes && typeof window.crmClientes.carregarClientes === 'function') {
          window.crmClientes.carregarClientes();
        }
        if (window.feather) window.feather.replace({ class: 'w-5 h-5' });
      };
      section.appendChild(actions);
    } else if (page === 'crm_prospects') {
      const actions = document.createElement('script');
      actions.src = `../crm/js/prospects.js?v=${Date.now()}`;
      actions.onload = () => { if (window.initProspects) window.initProspects(); if (window.feather) window.feather.replace({ class: 'w-5 h-5' }); };
      section.appendChild(actions);
    } else if (page === 'crm_contacts') {
      const actions = document.createElement('script');
      actions.src = `../crm/js/contacts.js?v=${Date.now()}`;
      actions.onload = () => { if (window.initContacts) window.initContacts(); if (window.feather) window.feather.replace({ class: 'w-5 h-5' }); };
      section.appendChild(actions);
    } else if (page === 'crm_tasks') {
      const detail = document.createElement('script');
      detail.src = `../crm/js/tasksDetail.js?v=${Date.now()}`;
      detail.onload = () => { if (window.initTasks) window.initTasks(); if (window.feather) window.feather.replace({ class: 'w-5 h-5' }); };
      section.appendChild(detail);
    } else if (page === 'crm_calendar') {
      const tasks = document.createElement('script');
      tasks.src = `../crm/js/calendar.js?v=${Date.now()}`;
      tasks.onload = () => { if (window.initCalendar) window.initCalendar(); if (window.feather) window.feather.replace({ class: 'w-5 h-5' }); };
      section.appendChild(tasks);
    } else {
      if (window.feather) window.feather.replace({ class: 'w-5 h-5' });
    }
  }

  // Carrega o módulo de produtos toda vez que for acessado
  async function loadProductsModule() {
    removeModuleCss('products-css');
    const section = document.getElementById('products-section');
    section.innerHTML = '';
    const path = '../produtos/produtos.html';
    const html = HTML_CACHE[path] || await (await fetch(path)).text();
    await ensureCssLoaded('products-css', '../produtos/produtos.css');
    section.innerHTML = html;
    const script = document.createElement('script');
    script.src = '../produtos/produtosRenderer.js';
    section.appendChild(script);
  }
  // Carrega o módulo de usuários
  async function loadUsersModule() {
    removeModuleCss('users-css');
    // Remove any loaded CRM styles to avoid layout conflicts
    const crmCss = document.getElementById('crm-css');
    if (crmCss) crmCss.remove();
    const crmSection = document.getElementById('crm-section');
    if (crmSection) crmSection.innerHTML = '';
    const section = document.getElementById('permissions-section');
    section.innerHTML = '';
    const path = '../usuarios/usuarios.html';
    const html = HTML_CACHE[path] || await (await fetch(path)).text();
    const existing = document.getElementById('users-css');
    if (existing) existing.remove();
    await ensureCssLoaded('users-css', '../usuarios/usuarios.css');
    section.innerHTML = html;
    const script = document.createElement('script');
    script.src = '../usuarios/usuariosRenderer.js';
    section.appendChild(script);
  }

  // Carrega o módulo de pedidos toda vez que for acessado
  async function loadOrdersModule() {
    removeModuleCss('orders-css');
    const section = document.getElementById('orders-section');
    section.innerHTML = '';
    const path = '../orders/orders.html';
    const html = HTML_CACHE[path] || await (await fetch(path)).text();
    await ensureCssLoaded('orders-css', '../orders/orders.css');
    section.innerHTML = html;
    const script = document.createElement('script');
    script.src = '../orders/ordersRenderer.js';
    section.appendChild(script);
  }
  // Carrega o módulo de orçamentos
  async function loadBudgetsModule() {
    removeModuleCss('budgets-css');
    const section = document.getElementById("budgets-section");
    section.innerHTML = "";
    const path = '../budgets/budgets.html';
    const html = HTML_CACHE[path] || await (await fetch(path)).text();
    await ensureCssLoaded('budgets-css', '../budgets/budgets.css');
    section.innerHTML = html;
    const script = document.createElement("script");
    script.src = "../budgets/budgetsRenderer.js";
    section.appendChild(script);
  }

  
  // Navigation logic centralizado
  function initSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const sections = document.querySelectorAll('section');
    const sectionTitle = document.getElementById('section-title');
    const crmSubmenu = document.getElementById('crm-submenu');

    // remove manipulador antigo para evitar múltiplas inscrições
    sidebar.onclick = null;

    sidebar.onclick = async (e) => {
      const header = e.target.closest('#crm-header');
      const item = e.target.closest('.sidebar-item[data-section]');

      if (header && crmSubmenu) {
        e.preventDefault();
        crmSubmenu.classList.remove('hidden');
        sections.forEach(s => s.classList.add('hidden'));
        document.getElementById('crm-section').classList.remove('hidden');
        sectionTitle.textContent = 'CRM';
        if (window.ModalManager) window.ModalManager.closeAll();
        await loadCrmModule('crm_clients');
        document.querySelectorAll('.sidebar-item[data-section]').forEach(i => i.classList.remove('active'));
        const def = crmSubmenu.querySelector('[data-crm-section="crm_clients"]');
        if (def) def.classList.add('active');
        return;
      }

      if (item) {
        e.preventDefault();
        const sectionId = item.getAttribute('data-section');
        sections.forEach(s => s.classList.add('hidden'));
        document.getElementById(`${sectionId}-section`).classList.remove('hidden');
        if (sectionId !== 'crm' && crmSubmenu) crmSubmenu.classList.add('hidden');
        const labelEl = item.querySelector('.sidebar-text');
        sectionTitle.textContent = labelEl ? labelEl.textContent : sectionId;
        if (sectionId === 'raw-material') {
          await loadRawMaterialModule();
        } else if (sectionId === 'products') {
          await loadProductsModule();
        } else if (sectionId === 'permissions') {
          await loadUsersModule();
        } else if (sectionId === 'budgets') {
          await loadBudgetsModule();
        } else if (sectionId === 'orders') {
          await loadOrdersModule();
        }else if (sectionId === 'crm') {
          const page = item.dataset.crmSection || 'crm_clients';
          if (window.ModalManager) window.ModalManager.closeAll();
          await loadCrmModule(page);
        }
        document.querySelectorAll('.sidebar-item[data-section]').forEach(i => i.classList.remove('active'));
        item.classList.add('active');

        const navigateEvent = new CustomEvent('module-change', { detail: sectionId });
        document.dispatchEvent(navigateEvent);
      }
    };
  }

  initSidebar();

  function selectTab(tabId) {
    const item = document.querySelector(`.sidebar-item[data-section="${tabId}"]`);
    if (item) item.click();
  }

  if (window.electronAPI && window.electronAPI.onSelectTab) {
    window.electronAPI.onSelectTab(selectTab);
  }

  const savedData = localStorage.getItem('savedState');
  if (savedData) {
    try { restoreState(JSON.parse(savedData)); } catch (e) {}
    localStorage.removeItem('savedState');
  }

  // Close any visible overlays when navigating between modules
  document.addEventListener('module-change', () => {
    if (window.closeAllModals) window.closeAllModals();
    if (window.crmTasksCleanup) window.crmTasksCleanup();
  });

  // Mobile menu toggle
  const menuToggle = document.getElementById('menu-toggle');
  const sidebar = document.querySelector('.sidebar');
  if (menuToggle) {
    menuToggle.addEventListener('click', () => {
      sidebar.classList.toggle('hidden');
    });
  }

  const userData = JSON.parse(localStorage.getItem('user') || '{}');
  if (userData.nome) {
    document.getElementById('user-name').textContent = userData.nome;
    const initials = userData.nome.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    document.querySelector('#user-initials span').textContent = initials;
  }

  const statusEl = document.getElementById('server-status');

  function showSpinner() {
    if (!statusEl) return;
    statusEl.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'server-spin';
    statusEl.appendChild(div);
  }

  function showOk() {
    if (!statusEl) return;
    statusEl.innerHTML = '';
    const i = document.createElement('i');
    i.setAttribute('data-feather', 'check');
    i.className = 'server-ok';
    statusEl.appendChild(i);
    feather.replace();
  }

  function showError() {
    if (!statusEl) return;
    statusEl.innerHTML = '';
    const i = document.createElement('i');
    i.setAttribute('data-feather', 'x');
    i.className = 'server-error';
    statusEl.appendChild(i);
    feather.replace();
  }

  showSpinner();

  let checkInterval = null;
  function stopServerCheck() {
    if (checkInterval !== null) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
  }
  window.stopServerCheck = stopServerCheck;

  window.addEventListener('beforeunload', stopServerCheck);

  // Save interface state whenever the window is about to be closed
  window.addEventListener('beforeunload', () => {
    if (window.collectState && window.electronAPI && window.electronAPI.saveState) {
      window.electronAPI.saveState(window.collectState());
    }
  });

  async function saveAndLogout(reason = 'pin') {
    const state = collectState();
    await window.electronAPI.saveState(state);
    if (reason === 'offline') {
      localStorage.setItem('offlineDisconnect', '1');
    } else if (reason === 'pin') {
      localStorage.setItem('pinChanged', '1');
    }
    window.electronAPI.openLoginHidden();
    window.electronAPI.logout();
  }

  checkInterval = setInterval(async () => {
    if (!navigator.onLine) {
      showError();
      await saveAndLogout('offline');
      return;
    }
    try {
      const res = await window.electronAPI.checkPin();
      if (res && res.success) {
        showOk();
        setTimeout(showSpinner, 1000);
      } else if (res && !res.success) {
        showError();
        await saveAndLogout(res.reason || 'pin');
      } else {
        showError();
      }
    } catch (err) {
      showError();
      await saveAndLogout('offline');
    }
  }, 10000);

});
