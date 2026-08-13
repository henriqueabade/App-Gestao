/** Registrar campanha — POST /api/prospeccoes/:id/campanhas. */
(async function () {
  const overlay = document.getElementById('campanhaProspeccaoOverlay');
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
  const fechar = A.ligarFechamento(overlay, 'campanhaProspeccao',
    ['voltarCampanhaProspeccao', 'cancelarCampanhaProspeccao']);

  const prospeccao = A.alvo();
  if (!prospeccao?.id) {
    showToast('Prospecção não encontrada', 'error');
    fechar();
    return;
  }

  get('campanhaStatus').innerHTML = A.STATUS_CAMPANHA
    .map(s => `<option value="${A.esc(s)}">${A.esc(s)}</option>`).join('');

  get('campanhaProspeccaoForm')?.addEventListener('submit', e => e.preventDefault());
  setTimeout(() => get('campanhaNome')?.focus(), 60);

  A.aoConfirmar(get('salvarCampanhaProspeccao'), async () => {
    const nome = A.texto(get('campanhaNome').value);
    if (!nome) {
      showToast('Informe o nome da campanha', 'error');
      get('campanhaNome').focus();
      return;
    }

    await A.enviar(`/api/prospeccoes/${prospeccao.id}/campanhas`, {
      method: 'POST',
      body: JSON.stringify({
        nome,
        canal: A.texto(get('campanhaCanal').value),
        status: get('campanhaStatus').value,
        data_envio: get('campanhaDataEnvio').value || null,
        resposta: A.texto(get('campanhaResposta').value),
        observacao: A.texto(get('campanhaObservacao').value)
      })
    }, { overlayId: 'campanhaProspeccao', sucesso: 'Campanha registrada' });
  });

  window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'campanhaProspeccao' }));
})();
