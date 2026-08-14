/**
 * Mover a prospecção no funil — PATCH /api/prospeccoes/:id/etapa.
 *
 * É a única porta para trocar de etapa: o PUT de edição ignora `etapa` de
 * propósito, para que toda movimentação passe por `pros.stage.update` e deixe
 * rastro em prospeccao_etapas_historico.
 */
(async function () {
  const overlay = document.getElementById('etapaProspeccaoOverlay');
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
  const fechar = A.ligarFechamento(overlay, 'etapaProspeccao',
    ['voltarEtapaProspeccao', 'cancelarEtapaProspeccao']);

  const prospeccao = A.alvo();
  if (!prospeccao?.id) {
    showToast('Prospecção não encontrada', 'error');
    fechar();
    return;
  }

  const slug = e => String(e || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

  get('etapaAtualBadge').innerHTML =
    `<span class="badge-etapa badge-etapa--${slug(prospeccao.etapa)} px-3 py-1 rounded-full text-xs font-medium">${A.esc(prospeccao.etapa)}</span>`;

  // A etapa atual sai da lista: "mover para onde já está" não é movimento, e o
  // backend devolveria semMudanca.
  const etapas = (window.PROSPECCOES_ETAPAS?.length ? window.PROSPECCOES_ETAPAS : A.ETAPAS_PADRAO)
    .filter(e => e !== prospeccao.etapa);

  get('etapaNova').innerHTML = etapas
    .map(e => `<option value="${A.esc(e)}">${A.esc(e)}</option>`).join('');

  const seletor = get('etapaNova');
  const prob = get('etapaProbabilidade');
  const blocoMotivo = get('etapaMotivoBloco');
  const avisoGanho = get('etapaAvisoGanho');

  function refletirEtapa() {
    const etapa = seletor.value;
    // Motivo só existe para Perdido — e aí é obrigatório.
    blocoMotivo.classList.toggle('hidden', etapa !== 'Perdido');
    avisoGanho.classList.toggle('hidden', etapa !== 'Ganho');
    if (prob.dataset.editadoManualmente !== '1') {
      const sugerida = A.PROBABILIDADE_POR_ETAPA[etapa];
      if (sugerida !== undefined) prob.value = String(sugerida);
    }
  }

  prob.addEventListener('input', () => { prob.dataset.editadoManualmente = '1'; });
  seletor.addEventListener('change', refletirEtapa);
  refletirEtapa();

  get('etapaProspeccaoForm')?.addEventListener('submit', e => e.preventDefault());

  A.aoConfirmar(get('confirmarEtapaProspeccao'), async () => {
    const etapa = seletor.value;
    const motivo = A.texto(get('etapaMotivo').value);

    if (etapa === 'Perdido' && !motivo) {
      showToast('Informe o motivo da perda', 'error');
      get('etapaMotivo').focus();
      return;
    }

    const bruto = get('etapaProbabilidade').value.trim();
    let probabilidade;
    if (bruto) {
      const n = window.NumericInput?.parse ? window.NumericInput.parse(bruto) : Number(bruto.replace(',', '.'));
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        showToast('Probabilidade deve ficar entre 0 e 100', 'error');
        get('etapaProbabilidade').focus();
        return;
      }
      probabilidade = Math.round(n);
    }

    const resultado = await A.enviar(`/api/prospeccoes/${prospeccao.id}/etapa`, {
      method: 'PATCH',
      body: JSON.stringify({
        etapa,
        motivo_perda: motivo,
        observacao: A.texto(get('etapaObservacao').value),
        ...(probabilidade === undefined ? {} : { probabilidade })
      })
    }, {
      overlayId: 'etapaProspeccao',
      sucesso: `Prospecção movida para ${etapa}`,
      aoFalhar: (status, corpo) => {
        // Dados fiscais incompletos para Ganho, ou prospecção já convertida:
        // a mensagem do backend já diz exatamente o que falta.
        if (status === 422 || status === 409) {
          showToast(corpo.error || `Erro ${status}`, 'error');
          return true;
        }
        return false;
      }
    });

    if (!resultado) return;

    // Perdido encerra as propostas em aberto — o usuário precisa saber que
    // isso aconteceu, senão descobre depois pelo relatório.
    if (resultado.orcamentosRejeitados > 0) {
      const n = resultado.orcamentosRejeitados;
      showToast(
        n === 1 ? '1 orçamento em aberto foi rejeitado' : `${n} orçamentos em aberto foram rejeitados`,
        'info');
    }

    // Ganho é "fechou": o passo seguinte é virar cliente. Deixar a prospecção
    // parada em Ganho sem cliente é o que quebrava o fluxo — a conversão abre
    // na sequência para conferir os dados fiscais e pedir status e dono.
    if (resultado.converter) {
      window.prospeccaoAcaoAlvo = { ...prospeccao, etapa: 'Ganho' };
      Modal.open('modals/prospeccoes/converter.html',
        '../js/modals/prospeccao-converter.js', 'converterProspeccao', true);
    }
  });

  window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'etapaProspeccao' }));
})();
