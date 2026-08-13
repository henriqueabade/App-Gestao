/** Adicionar nota — POST /api/prospeccoes/:id/notas. */
(async function () {
  const overlay = document.getElementById('notaProspeccaoOverlay');
  if (!overlay) return;

  if (!window.ProspeccaoAcoes) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '../js/modals/prospeccao-acoes-comum.js';
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  const A = window.ProspeccaoAcoes;
  const get = id => document.getElementById(id);
  const fechar = A.ligarFechamento(overlay, 'notaProspeccao',
    ['voltarNotaProspeccao', 'cancelarNotaProspeccao']);

  const prospeccao = A.alvo();
  if (!prospeccao?.id) {
    showToast('Prospecção não encontrada', 'error');
    fechar();
    return;
  }

  get('notaProspeccaoForm')?.addEventListener('submit', e => e.preventDefault());
  setTimeout(() => get('notaConteudo')?.focus(), 60);

  A.aoConfirmar(get('salvarNotaProspeccao'), async () => {
    const conteudo = A.texto(get('notaConteudo').value);
    if (!conteudo) {
      showToast('A nota não pode estar vazia', 'error');
      get('notaConteudo').focus();
      return;
    }

    await A.enviar(`/api/prospeccoes/${prospeccao.id}/notas`, {
      method: 'POST',
      body: JSON.stringify({ titulo: A.texto(get('notaTitulo').value), conteudo })
    }, { overlayId: 'notaProspeccao', sucesso: 'Nota adicionada' });
  });

  window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'notaProspeccao' }));
})();
