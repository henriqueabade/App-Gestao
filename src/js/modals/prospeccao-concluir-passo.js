/**
 * Concluir o passo planejado — POST /api/prospeccoes/:id/concluir-passo.
 *
 * Fecha o combinado em aberto registrando o que aconteceu e, no mesmo gesto,
 * decide o rumo: seguir onde está, avançar no funil ou converter em cliente.
 *
 * A conversão NÃO acontece aqui. O backend devolve `converter: true` e este
 * modal abre o fluxo próprio, que confere os dados fiscais e pede status e
 * dono do cliente — pular essas checagens criaria cliente pela metade.
 */
(async function () {
  const overlay = document.getElementById('concluirPassoOverlay');
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
  const fechar = A.ligarFechamento(overlay, 'concluirPasso',
    ['voltarConcluirPasso', 'cancelarConcluirPasso']);

  const prospeccao = A.alvo();
  if (!prospeccao?.id) {
    showToast('Prospecção não encontrada', 'error');
    fechar();
    return;
  }

  const passo = (prospeccao.proximo_passo || '').trim();
  if (!passo) {
    showToast('Não há passo planejado para concluir', 'info');
    fechar();
    return;
  }

  get('concluirPassoTexto').textContent = passo;
  if (prospeccao.proximo_passo_data) {
    const [a, m, d] = String(prospeccao.proximo_passo_data).slice(0, 10).split('-').map(Number);
    if (a && m && d) {
      const alvo = new Date(a, m - 1, d);
      const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
      const atrasado = alvo < hoje;
      get('concluirPassoData').innerHTML = `Agendado para ${alvo.toLocaleDateString('pt-BR')}` +
        (atrasado ? ' <span class="prox-passo-atrasado">· atrasado</span>' : '');
    }
  }

  // Data/hora local no formato do <input type="datetime-local">.
  const agora = new Date();
  agora.setMinutes(agora.getMinutes() - agora.getTimezoneOffset());
  get('concluirData').value = agora.toISOString().slice(0, 16);

  // Contatos desta prospecção — o backend recusa contato de outra.
  const contatos = Array.isArray(window.prospeccaoAcaoContatos) ? window.prospeccaoAcaoContatos : [];
  if (contatos.length) {
    get('concluirContato').innerHTML = '<option value="">Não especificado</option>' +
      contatos.map(c => {
        const rotulo = c.cargo ? `${c.nome} — ${c.cargo}` : c.nome;
        return `<option value="${A.esc(c.id)}">${A.esc(rotulo)}</option>`;
      }).join('');
    const principal = contatos.find(c => c.principal);
    if (principal) get('concluirContato').value = String(principal.id);
  }

  // Etapas de destino: a atual sai da lista, porque "mover para onde já está"
  // não é movimento.
  const etapas = (window.PROSPECCOES_ETAPAS?.length ? window.PROSPECCOES_ETAPAS : A.ETAPAS_PADRAO)
    .filter(e => e !== prospeccao.etapa);
  get('concluirEtapa').innerHTML = etapas.map(e => `<option value="${A.esc(e)}">${A.esc(e)}</option>`).join('');

  // ---------------------------------------------------------------------
  // Desfecho
  // ---------------------------------------------------------------------
  const seletorEtapa = get('concluirEtapa');
  const motivoPerda = get('concluirMotivoPerda');

  function desfechoEscolhido() {
    return overlay.querySelector('input[name="desfecho"]:checked')?.value || 'nada';
  }

  function refletirDesfecho() {
    const escolha = desfechoEscolhido();
    seletorEtapa.disabled = escolha !== 'etapa';
    // Motivo só existe para Perdido — e aí é obrigatório, como no modal de
    // mover no funil.
    const perdido = escolha === 'etapa' && seletorEtapa.value === 'Perdido';
    motivoPerda.classList.toggle('hidden', !perdido);
  }

  overlay.querySelectorAll('input[name="desfecho"]').forEach(r => {
    r.addEventListener('change', refletirDesfecho);
  });
  seletorEtapa.addEventListener('change', refletirDesfecho);
  refletirDesfecho();

  get('concluirPassoForm')?.addEventListener('submit', e => e.preventDefault());
  setTimeout(() => get('concluirNota')?.focus(), 60);

  // ---------------------------------------------------------------------
  // Confirmar
  // ---------------------------------------------------------------------
  A.aoConfirmar(get('confirmarConcluirPasso'), async () => {
    const nota = A.texto(get('concluirNota').value);
    if (!nota) {
      showToast('Descreva o que aconteceu', 'error');
      get('concluirNota').focus();
      return;
    }

    const escolha = desfechoEscolhido();
    const corpo = {
      nota,
      data: get('concluirData').value ? new Date(get('concluirData').value).toISOString() : undefined,
      contato_id: get('concluirContato').value ? Number(get('concluirContato').value) : null,
      converter: escolha === 'converter'
    };

    if (escolha === 'etapa') {
      corpo.etapa = seletorEtapa.value;
      if (seletorEtapa.value === 'Perdido') {
        const motivo = A.texto(motivoPerda.value);
        if (!motivo) {
          showToast('Informe o motivo da perda', 'error');
          motivoPerda.focus();
          return;
        }
        corpo.motivo_perda = motivo;
      }
    }

    // A chave presente é o que sinaliza intenção ao backend. Enviada sempre,
    // porque aqui o passo antigo SEMPRE se encerra: ou dá lugar ao novo, ou
    // fica em branco.
    corpo.proximo_passo = A.texto(get('concluirProximoPasso').value);
    corpo.proximo_passo_data = get('concluirProximoPassoData').value || null;

    if (corpo.proximo_passo_data && !corpo.proximo_passo) {
      showToast('Descreva o que precisa ser feito nessa data', 'error');
      get('concluirProximoPasso').focus();
      return;
    }

    const resultado = await A.enviar(`/api/prospeccoes/${prospeccao.id}/concluir-passo`, {
      method: 'POST',
      body: JSON.stringify(corpo)
    }, {
      overlayId: 'concluirPasso',
      sucesso: 'Passo concluído'
    });

    // Conversão escolhida: o modal próprio assume daqui, já com a ficha
    // recarregada por `A.enviar`.
    if (resultado?.converter) {
      window.prospeccaoAcaoAlvo = window.prospeccaoDetalhesCarregada || prospeccao;
      Modal.open('modals/prospeccoes/converter.html', '../js/modals/prospeccao-converter.js', 'converterProspeccao', true);
    }
  });

  window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'concluirPasso' }));
})();
