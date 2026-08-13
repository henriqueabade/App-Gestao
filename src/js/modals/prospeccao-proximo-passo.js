/** Definir próximo passo — PUT /api/prospeccoes/:id/proximo-passo. */
(async function () {
  const overlay = document.getElementById('proximoPassoProspeccaoOverlay');
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
  const fechar = A.ligarFechamento(overlay, 'proximoPassoProspeccao',
    ['voltarProximoPasso', 'cancelarProximoPasso']);

  const prospeccao = A.alvo();
  if (!prospeccao?.id) {
    showToast('Prospecção não encontrada', 'error');
    fechar();
    return;
  }

  // Abre com o que já está agendado: este modal SUBSTITUI o próximo passo, e
  // abrir em branco faria o usuário apagar sem perceber o que havia.
  get('proximoPassoTexto').value = prospeccao.proximo_passo || '';
  get('proximoPassoData').value = prospeccao.proximo_passo_data
    ? String(prospeccao.proximo_passo_data).slice(0, 10)
    : '';

  get('proximoPassoForm')?.addEventListener('submit', e => e.preventDefault());
  setTimeout(() => get('proximoPassoTexto')?.focus(), 60);

  A.aoConfirmar(get('salvarProximoPasso'), async () => {
    const texto = A.texto(get('proximoPassoTexto').value);
    const data = get('proximoPassoData').value || null;

    // Uma data sem o que fazer nela não diz nada a quem for cobrar o retorno.
    if (data && !texto) {
      showToast('Descreva o que precisa ser feito nessa data', 'error');
      get('proximoPassoTexto').focus();
      return;
    }

    await A.enviar(`/api/prospeccoes/${prospeccao.id}/proximo-passo`, {
      method: 'PUT',
      body: JSON.stringify({ proximo_passo: texto, proximo_passo_data: data })
    }, {
      overlayId: 'proximoPassoProspeccao',
      sucesso: texto ? 'Próximo passo definido' : 'Próximo passo removido'
    });
  });

  window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'proximoPassoProspeccao' }));
})();
