(async function(){
  const overlay = document.getElementById('detalhesProspeccaoOverlay');
  if(!overlay) return;
  overlay.classList.remove('hidden');
  const close = () => Modal.close('detalhesProspeccao');
  overlay.addEventListener('click', e => { if(e.target === overlay) close(); });
  const btnClose = document.getElementById('fecharDetalhesProspeccao');
  if(btnClose) btnClose.addEventListener('click', close);
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

  overlay.querySelectorAll('a[data-external]').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      window.electronAPI.openExternal(a.href);
    });
  });
})();
