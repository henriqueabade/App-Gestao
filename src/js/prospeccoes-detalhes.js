function initDetalhesProspeccao() {
  function setTab(id) {
    document.querySelectorAll('[data-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== id));
    document.querySelectorAll('[role="tab"]').forEach(t => {
      const active = t.dataset.tab === id;
      t.setAttribute('aria-selected', active);
      if (active) {
        t.classList.add('tab-active');
        t.classList.remove('text-gray-400', 'border-transparent');
      } else {
        t.classList.remove('tab-active');
        t.classList.add('text-gray-400', 'border-transparent');
      }
    });
  }

  document.querySelectorAll('[role="tab"]').forEach(t => {
    t.addEventListener('click', () => setTab(t.dataset.tab));
  });

  document.addEventListener('keydown', e => {
    if (e.target.getAttribute('role') === 'tab') {
      const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
      const current = tabs.indexOf(e.target);
      let target;
      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          target = current < tabs.length - 1 ? current + 1 : 0;
          tabs[target].focus();
          setTab(tabs[target].dataset.tab);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          target = current > 0 ? current - 1 : tabs.length - 1;
          tabs[target].focus();
          setTab(tabs[target].dataset.tab);
          break;
      }
    }
  });

  setTab('overview');

  // Preenche os dados do prospecto no cabeçalho
  const prospect = window.prospectDetails || {
    initials: 'JW',
    name: 'Jennifer Wilson',
    company: 'Acme Corporation',
    ownerName: 'João Silva',
    email: 'jennifer@acme.com',
    phone: '(11) 99999-9999',
    mobile: '(11) 98888-7777',
    status: 'Novo'
  };
  const get = id => document.getElementById(id);
  const initialsEl = get('prospectInitials');
  if (initialsEl) initialsEl.textContent = prospect.initials;
  const headerNameEl = get('prospectNameHeader');
  if (headerNameEl) headerNameEl.textContent = prospect.name;
  const nameEl = get('prospectName');
  if (nameEl) {
    nameEl.textContent = prospect.name;
    nameEl.title = prospect.name;
  }
  const headerCompanyEl = get('prospectCompanyHeader');
  if (headerCompanyEl) headerCompanyEl.textContent = prospect.company;
  const companyEl = get('prospectCompany');
  if (companyEl) {
    companyEl.textContent = prospect.company;
    companyEl.title = prospect.company;
  }
  const ownerEl = get('prospectOwner');
  if (ownerEl) ownerEl.textContent = prospect.ownerName;
  const emailLink = get('prospectEmailLink');
  const emailEl = get('prospectEmail');
  if (emailLink && emailEl) {
    emailLink.href = `mailto:${prospect.email}`;
    emailLink.setAttribute('aria-label', `Enviar e-mail para ${prospect.name}`);
    emailEl.textContent = prospect.email;
    emailEl.title = prospect.email;
  }
  const phoneLink = get('prospectPhoneLink');
  const phoneEl = get('prospectPhone');
  if (phoneLink && phoneEl) {
    phoneLink.href = `tel:${prospect.phone}`;
    phoneLink.setAttribute('aria-label', `Ligar para ${prospect.name}`);
    phoneEl.textContent = prospect.phone;
  }
  const cellLink = get('prospectCellLink');
  const cellEl = get('prospectCell');
  if (cellLink && cellEl) {
    cellLink.href = `tel:${prospect.mobile}`;
    cellLink.setAttribute('aria-label', `Ligar para ${prospect.name} (celular)`);
    cellEl.textContent = prospect.mobile;
  }
  const companyMetaEl = get('prospectCompanyMeta');
  if (companyMetaEl) companyMetaEl.textContent = prospect.company;
  const statusEl = get('prospectStatus');
  if (statusEl) statusEl.textContent = prospect.status;

  const notifyBtn = document.getElementById('toggleNotify');
  if (notifyBtn) {
    notifyBtn.addEventListener('click', function () {
      const pressed = this.getAttribute('aria-pressed') === 'true';
      this.setAttribute('aria-pressed', String(!pressed));
      if (!pressed) {
        this.classList.add('bg-primary/20');
        this.textContent = 'Notificações ✓';
      } else {
        this.classList.remove('bg-primary/20');
        this.textContent = 'Notificações';
      }
    });
  }

  const delBtn = document.getElementById('prospectDelete');
  if (delBtn) {
    delBtn.addEventListener('click', () => {
      if (confirm('Deletar este prospect?')) {
        console.log('delete');
      }
    });
  }

  const novaTarefaBtn = document.getElementById('btnNovaTarefa');
  if (novaTarefaBtn) {
    novaTarefaBtn.addEventListener('click', () => loadPage('tarefas'));
  }

  document.querySelectorAll('a[data-external]').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      window.electronAPI.openExternal(a.href);
    });
  });

  document.getElementById('fecharDetalhesProspeccao')?.addEventListener('click', () => loadPage('prospeccoes'));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDetalhesProspeccao);
} else {
  initDetalhesProspeccao();
}
