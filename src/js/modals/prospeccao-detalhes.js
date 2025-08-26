(async function(){
  const overlay = document.getElementById('detalhesProspeccaoOverlay');
  if(!overlay) return;
  overlay.classList.remove('hidden');
  const close = () => Modal.close('detalhesProspeccao');
  overlay.addEventListener('click', e => { if(e.target === overlay) close(); });
  const btnBack = document.getElementById('voltarDetalhesProspeccao');
  if(btnBack) btnBack.addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); }});

  function setTab(id){
    overlay.querySelectorAll('[data-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== id));
    overlay.querySelectorAll('[role="tab"]').forEach(t => {
      const active = t.dataset.tab === id;
      t.setAttribute('aria-selected', active);
      if(active){
        t.classList.add('tab-active');
        t.classList.remove('text-gray-400','border-transparent');
      } else {
        t.classList.remove('tab-active');
        t.classList.add('text-gray-400','border-transparent');
      }
    });
  }

  overlay.querySelectorAll('[role="tab"]').forEach(t => {
    t.addEventListener('click', () => setTab(t.dataset.tab));
  });

  overlay.addEventListener('keydown', e => {
    if(e.target.getAttribute('role')==='tab'){
      const tabs = Array.from(overlay.querySelectorAll('[role="tab"]'));
      const current = tabs.indexOf(e.target);
      let target;
      switch(e.key){
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

  // Preenche os dados do prospecto no modal
  const data = window.prospectDetails || {
    initials: 'JW',
    name: 'Jennifer Wilson',
    company: 'Acme Corporation',
    ownerName: 'João Silva',
    email: 'jennifer@acme.com',
    phone: '(11) 3333-4444',
    cell: '(11) 99999-9999',
    status: 'Novo'
  };
  const placeholder = 'Não informado';
  const val = v => (v && String(v).trim()) ? v : placeholder;
  const get = id => document.getElementById(id);
  const setText = (el, text) => {
    const isPlaceholder = text === placeholder;
    el.textContent = text;
    el.title = text;
    el.classList.toggle('text-white/50', isPlaceholder);
    el.classList.toggle('text-white', !isPlaceholder);
  };
  const initialsEl = get('modalProspectInitials');
  if (initialsEl) initialsEl.textContent = data.initials;
  const nEl = get('modalProspectName');
  if (nEl) {
    const name = val(data.name);
    setText(nEl, name);
  }
  const cEl = get('modalProspectCompany');
  if (cEl) {
    const company = val(data.company);
    setText(cEl, company);
  }
  const headerNameEl = get('modalProspectNameHeader');
  if (headerNameEl) headerNameEl.textContent = val(data.name);
  const headerCompanyEl = get('modalProspectCompanyHeader');
  if (headerCompanyEl) headerCompanyEl.textContent = val(data.company);
  const ownerEl = get('modalProspectOwner');
  if (ownerEl) setText(ownerEl, val(data.ownerName));
  const emailLink = get('modalProspectEmailLink');
  const emailEl = get('modalProspectEmail');
  if (emailLink && emailEl) {
    const email = val(data.email);
    setText(emailEl, email);
    emailLink.setAttribute('aria-label', email !== placeholder ? `Copiar e-mail de ${data.name}` : 'E-mail não informado');
    if (email !== placeholder) {
      emailLink.addEventListener('click', e => {
        e.preventDefault();
        navigator.clipboard
          .writeText(data.email)
          .then(() => showToast('E-mail copiado!', 'success'));
      });
    }
  }
  const phoneLink = get('modalProspectPhoneLink');
  const phoneEl = get('modalProspectPhone');
  if (phoneLink && phoneEl) {
    const phone = val(data.phone);
    setText(phoneEl, phone);
    phoneLink.setAttribute('aria-label', phone !== placeholder ? `Copiar telefone de ${data.name}` : 'Telefone não informado');
    if (phone !== placeholder) {
      phoneLink.addEventListener('click', e => {
        e.preventDefault();
        navigator.clipboard
          .writeText(data.phone)
          .then(() => showToast('Telefone copiado!', 'success'));
      });
    }
  }
  const cellLink = get('modalProspectCellLink');
  const cellEl = get('modalProspectCell');
  if (cellLink && cellEl) {
    const cell = val(data.cell);
    setText(cellEl, cell);
    cellLink.setAttribute('aria-label', cell !== placeholder ? `Copiar celular de ${data.name}` : 'Celular não informado');
    if (cell !== placeholder) {
      cellLink.addEventListener('click', e => {
        e.preventDefault();
        navigator.clipboard
          .writeText(data.cell)
          .then(() => showToast('Celular copiado!', 'success'));
      });
    }
  }
  const companyMetaEl = get('modalProspectCompanyMeta');
  if (companyMetaEl) setText(companyMetaEl, val(data.company));
  const statusEl = get('modalProspectStatus');
  if (statusEl) {
    const status = val(data.status);
    const isPlaceholder = status === placeholder;
    statusEl.textContent = status;
    statusEl.title = status;
    statusEl.className = 'mt-1 inline-flex max-w-max px-2.5 py-1 rounded-full text-xs font-medium truncate ' + (isPlaceholder ? 'bg-white/5 text-white/50' : 'bg-emerald-500/20 text-emerald-200');
  }

  const notifyBtn = document.getElementById('toggleNotify');
  if(notifyBtn){
    notifyBtn.addEventListener('click', function(){
      const pressed = this.getAttribute('aria-pressed') === 'true';
      this.setAttribute('aria-pressed', String(!pressed));
      if(!pressed){
        this.classList.add('bg-primary/20');
        this.textContent = 'Notificações ✓';
      } else {
        this.classList.remove('bg-primary/20');
        this.textContent = 'Notificações';
      }
    });
  }

  const delBtn = document.getElementById('prospectDelete');
  if(delBtn){
    delBtn.addEventListener('click', () => {
      if(confirm('Deletar este prospect?')){
        console.log('delete');
      }
    });
  }

  const novaTarefaBtn = document.getElementById('btnNovaTarefa');
  if(novaTarefaBtn){
    novaTarefaBtn.addEventListener('click', () => {
      close();
      loadPage('tarefas');
    });
  }

  overlay.querySelectorAll('a[data-external]').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      window.electronAPI.openExternal(a.href);
    });
  });
})();
