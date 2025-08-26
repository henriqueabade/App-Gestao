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

  document.getElementById('fecharDetalhesProspeccao')?.addEventListener('click', () => loadPage('prospeccoes'));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDetalhesProspeccao);
} else {
  initDetalhesProspeccao();
}
