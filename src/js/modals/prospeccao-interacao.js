/**
 * Registrar interação — POST /api/prospeccoes/:id/interacoes.
 *
 * O mesmo POST aceita o próximo passo, e o formulário aproveita: registrar um
 * contato e esquecer de agendar o retorno é o jeito mais comum de perder um
 * negócio por esquecimento.
 */
(async function () {
  const overlay = document.getElementById('interacaoProspeccaoOverlay');
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
  const fechar = A.ligarFechamento(overlay, 'interacaoProspeccao',
    ['voltarInteracaoProspeccao', 'cancelarInteracaoProspeccao']);

  const prospeccao = A.alvo();
  if (!prospeccao?.id) {
    showToast('Prospecção não encontrada', 'error');
    fechar();
    return;
  }

  get('interacaoTipo').innerHTML = A.TIPOS_INTERACAO
    .map(t => `<option value="${A.esc(t)}">${A.esc(t)}</option>`).join('');

  // Data/hora local no formato do <input type="datetime-local">, que não aceita
  // o ISO com fuso.
  const agora = new Date();
  agora.setMinutes(agora.getMinutes() - agora.getTimezoneOffset());
  get('interacaoData').value = agora.toISOString().slice(0, 16);

  // Contatos da prospecção: o backend recusa contato de outra, então a lista
  // só pode conter os desta.
  const contatos = Array.isArray(window.prospeccaoAcaoContatos) ? window.prospeccaoAcaoContatos : [];
  if (contatos.length) {
    get('interacaoContato').innerHTML = '<option value="">Não especificado</option>' +
      contatos.map(c => {
        const rotulo = c.cargo ? `${c.nome} — ${c.cargo}` : c.nome;
        return `<option value="${A.esc(c.id)}">${A.esc(rotulo)}</option>`;
      }).join('');
    const principal = contatos.find(c => c.principal);
    if (principal) get('interacaoContato').value = String(principal.id);
  }

  // Duração só faz sentido para o que tem começo e fim.
  const TEM_DURACAO = new Set(['Ligação', 'Reunião', 'Visita']);
  function refletirTipo() {
    const mostrar = TEM_DURACAO.has(get('interacaoTipo').value);
    get('interacaoDuracaoBloco').classList.toggle('hidden', !mostrar);
    if (!mostrar) get('interacaoDuracao').value = '';
  }
  get('interacaoTipo').addEventListener('change', refletirTipo);
  refletirTipo();

  get('interacaoProspeccaoForm')?.addEventListener('submit', e => e.preventDefault());
  setTimeout(() => get('interacaoResumo')?.focus(), 60);

  A.aoConfirmar(get('salvarInteracaoProspeccao'), async () => {
    const resumo = A.texto(get('interacaoResumo').value);
    if (!resumo) {
      showToast('Informe um resumo da interação', 'error');
      get('interacaoResumo').focus();
      return;
    }

    const duracaoBruta = get('interacaoDuracao').value.trim();
    let duracao = null;
    if (duracaoBruta) {
      const n = window.NumericInput?.parse ? window.NumericInput.parse(duracaoBruta) : Number(duracaoBruta);
      if (!Number.isFinite(n) || n < 0) {
        showToast('Duração inválida', 'error');
        get('interacaoDuracao').focus();
        return;
      }
      duracao = Math.round(n);
    }

    const dataLocal = get('interacaoData').value;
    const contatoId = get('interacaoContato').value;
    const proximoPasso = A.texto(get('interacaoProximoPasso').value);
    const proximoPassoData = get('interacaoProximoPassoData').value || null;

    const corpo = {
      tipo: get('interacaoTipo').value,
      resumo,
      detalhe: A.texto(get('interacaoDetalhe').value),
      duracao_min: duracao,
      contato_id: contatoId ? Number(contatoId) : null,
      // O <input> devolve hora local sem fuso; o `new Date` reinterpreta no
      // fuso do usuário e o toISOString entrega o instante correto.
      data: dataLocal ? new Date(dataLocal).toISOString() : new Date().toISOString()
    };

    // Só manda o próximo passo se algo foi preenchido — o backend trata a
    // presença da chave como intenção de alterar, e enviar vazio à toa apagaria
    // o passo que já estava agendado.
    if (proximoPasso || proximoPassoData) {
      corpo.proximo_passo = proximoPasso;
      corpo.proximo_passo_data = proximoPassoData;
    }

    await A.enviar(`/api/prospeccoes/${prospeccao.id}/interacoes`, {
      method: 'POST',
      body: JSON.stringify(corpo)
    }, {
      overlayId: 'interacaoProspeccao',
      sucesso: 'Interação registrada'
    });
  });

  window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'interacaoProspeccao' }));
})();
