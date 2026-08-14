/**
 * Campanha da prospecção — registra (POST) ou edita (PUT).
 *
 * O MESMO modal para os dois: quem abre define `window.prospeccaoCampanhaEditar`
 * quando é edição.
 */
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

  // Consome o sinal na hora: pendurado, faria a PRÓXIMA "Nova campanha" abrir
  // em modo edição e sobrescrever a anterior.
  const edicao = window.prospeccaoCampanhaEditar || null;
  delete window.prospeccaoCampanhaEditar;

  if (edicao) {
    get('tituloModalCampanha').textContent = 'Editar Campanha';
    get('campanhaNome').value = edicao.nome || '';
    get('campanhaCanal').value = edicao.canal || '';
    if (edicao.status) get('campanhaStatus').value = edicao.status;
    // Coluna DATE: corta em 10 para o input date, sem passar por `new Date`,
    // que deslocaria o dia pelo fuso.
    get('campanhaDataEnvio').value = String(edicao.data_envio || '').slice(0, 10);
    get('campanhaResposta').value = edicao.resposta || '';
    get('campanhaObservacao').value = edicao.observacao || '';
    window.EstadoTrabalho?.registrarContexto?.('campanhaProspeccao',
      () => ({ prospeccaoCampanhaEditar: edicao }));
  }

  // Piso do seletor de data: a campanha não pode ter sido enviada antes de a
  // prospecção existir. O backend recusa de qualquer forma — aqui o calendário
  // já nem oferece os dias impossíveis.
  const nascimento = String(prospeccao.criado_em || '').slice(0, 10);
  if (nascimento) get('campanhaDataEnvio')?.setAttribute('min', nascimento);

  get('campanhaProspeccaoForm')?.addEventListener('submit', e => e.preventDefault());
  setTimeout(() => get('campanhaNome')?.focus(), 60);

  A.aoConfirmar(get('salvarCampanhaProspeccao'), async () => {
    const nome = A.texto(get('campanhaNome').value);
    if (!nome) {
      showToast('Informe o nome da campanha', 'error');
      get('campanhaNome').focus();
      return;
    }

    await A.enviar(edicao
      ? `/api/prospeccoes/${prospeccao.id}/campanhas/${edicao.id}`
      : `/api/prospeccoes/${prospeccao.id}/campanhas`, {
      method: edicao ? 'PUT' : 'POST',
      body: JSON.stringify({
        nome,
        canal: A.texto(get('campanhaCanal').value),
        status: get('campanhaStatus').value,
        data_envio: get('campanhaDataEnvio').value || null,
        resposta: A.texto(get('campanhaResposta').value),
        observacao: A.texto(get('campanhaObservacao').value)
      })
    }, {
      overlayId: 'campanhaProspeccao',
      sucesso: edicao ? 'Campanha atualizada' : 'Campanha registrada'
    });
  });

  window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'campanhaProspeccao' }));
})();
