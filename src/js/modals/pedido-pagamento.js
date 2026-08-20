/**
 * Modal "Pagamento do pedido".
 *
 * Repactuação de condição de pagamento num pedido JÁ EM PRODUÇÃO. O escopo é
 * estreito de propósito: condição (à vista / a prazo), forma, prazos — e o que
 * decorre disso, que são os descontos e o total. Peças, quantidades e preços
 * unitários não se tocam aqui; para isso existe o orçamento, antes da
 * conversão.
 *
 * A conta de desconto é a MESMA do orçamento: 5% por levar mais de uma peça,
 * mais 5% por pagar à vista, e o que passar disso é desconto especial
 * negociado — que sobrevive à troca de condição. Trocar "a prazo" por "à
 * vista" acrescenta os 5%; o caminho de volta os remove, sem mexer no especial.
 *
 * Quem confere e grava é o backend (`PUT /api/pedidos/:id/pagamento`), que
 * refaz esta mesma conta a partir dos itens gravados. O cálculo aqui existe
 * para o usuário ver o total antes de confirmar, não para ser a fonte da
 * verdade.
 */
(async () => {
  const overlayId = 'pagamentoPedido';
  const overlay = document.getElementById('pagamentoPedidoOverlay');
  if (!overlay) return;

  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }

  const close = () => {
    document.removeEventListener('keydown', onEsc);
    Modal.close(overlayId);
  };
  const onEsc = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  document.addEventListener('keydown', onEsc);
  overlay.querySelector('#voltarPagamentoPedido')?.addEventListener('click', close);
  overlay.querySelector('#cancelarPagamentoPedido')?.addEventListener('click', close);

  const el = id => overlay.querySelector(`#${id}`);
  const condicaoSel = el('pagamentoPedidoCondicao');
  const formaSel = el('pagamentoPedidoForma');
  const box = el('pagamentoPedidoBox');
  const vencimentosBox = el('pagamentoPedidoVencimentos');
  const vencimentosLista = el('pagamentoPedidoVencimentosLista');
  const mensagemEl = el('pagamentoPedidoMensagem');
  const salvarBtn = el('salvarPagamentoPedido');

  const pedidoId = window.selectedOrderId;

  // Sem devolver o contexto o modal reabre vazio depois de uma queda
  // (ver docs/restauracao-de-trabalho.md).
  window.EstadoTrabalho?.registrarContexto?.(overlayId,
    () => ({ selectedOrderId: window.selectedOrderId }));

  const formatarMoeda = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  /**
   * Nome do cliente.
   *
   * `cliente_nome` vem no próprio detalhe do pedido, e é essa a fonte: o cache
   * de `pedidos.js` nem sempre alcança o escopo do modal — era por isso que o
   * campo saía como "—" com o cliente cadastrado — e buscar em
   * `/api/clientes/:id` exigiria permissão no módulo de Clientes, que quem
   * mexe em pedido não necessariamente tem.
   */
  function nomeDoCliente(dados) {
    return dados?.cliente_nome
        || window.obterNomeCliente?.(dados?.cliente_id)
        || '—';
  }

  function exibirMensagem(tipo, texto) {
    if (!mensagemEl) return;
    mensagemEl.textContent = texto;
    mensagemEl.classList.remove('hidden');
    mensagemEl.style.color = tipo === 'erro' ? 'var(--color-red)' : 'var(--color-green)';
  }
  const limparMensagem = () => mensagemEl?.classList.add('hidden');

  let parcelamentoCarregado = typeof window.Parcelamento !== 'undefined';
  function carregarParcelamento() {
    return new Promise(resolve => {
      if (parcelamentoCarregado) { resolve(); return; }
      const s = document.createElement('script');
      s.src = '../js/utils/parcelamento.js';
      s.onload = () => { parcelamentoCarregado = true; resolve(); };
      document.head.appendChild(s);
    });
  }

  // ------------------------------------------------------------- desconto
  // Espelha backend/descontos.js. Se um dos dois mudar, o outro tem de mudar
  // junto — o backend recusa o salvamento quando as parcelas não fecham com o
  // total que ele calcula, então a divergência aparece como erro, não como
  // número errado gravado.
  const descontoPadrao = (qtd, condicao) =>
    (Number(qtd) > 1 ? 5 : 0) + (condicao === 'vista' ? 5 : 0);

  let pedido = null;
  let itens = [];
  let condicaoOriginal = 'vista';

  /** Percentuais da linha na condição escolhida, preservando o especial. */
  function percentuaisDaLinha(item, condicao) {
    const atual = (Number(item.desconto_pagamento_prc) || 0)
                + (Number(item.desconto_especial_prc) || 0);
    const especialPreservado = Math.max(atual - descontoPadrao(item.quantidade, condicaoOriginal), 0);
    const total = especialPreservado + descontoPadrao(item.quantidade, condicao);
    const pagamento = Math.min(descontoPadrao(item.quantidade, condicao), total);
    return { pagamento, especial: Math.max(total - pagamento, 0) };
  }

  function calcularTotais(condicao) {
    let subtotal = 0;
    let descPag = 0;
    let descEsp = 0;
    for (const item of itens) {
      const qtd = Number(item.quantidade) || 0;
      const unitario = Number(item.valor_unitario) || 0;
      const { pagamento, especial } = percentuaisDaLinha(item, condicao);
      subtotal += unitario * qtd;
      descPag += unitario * (pagamento / 100) * qtd;
      descEsp += unitario * (especial / 100) * qtd;
    }
    return { subtotal, descPag, descEsp, total: subtotal - descPag - descEsp };
  }

  function totalEmCentavos() {
    return Math.round(calcularTotais(condicaoSel.value).total * 100);
  }

  function pintarTotais() {
    const t = calcularTotais(condicaoSel.value);
    el('pagamentoPedidoSubtotal').textContent = formatarMoeda(t.subtotal);
    el('pagamentoPedidoDescPag').textContent = formatarMoeda(t.descPag);
    el('pagamentoPedidoDescEsp').textContent = formatarMoeda(t.descEsp);
    el('pagamentoPedidoTotal').textContent = formatarMoeda(t.total);
    if (condicaoSel.value === 'prazo' && window.Parcelamento) {
      window.Parcelamento.updateTotal('pagamentoPedidoParcelamento', totalEmCentavos());
    }
    pintarVencimentos();
  }

  /** Data de emissão como base dos vencimentos — igual ao orçamento. */
  function dataBase() {
    return new Date(pedido?.data_emissao || Date.now());
  }

  function vencimentoEm(dias) {
    const d = new Date(dataBase().getTime() + (Number(dias) || 0) * 86400000);
    return d.toISOString().split('T')[0];
  }

  function diasEscolhidos() {
    if (condicaoSel.value === 'vista') {
      const v = el('pagamentoPedidoPrazoVista')?.value;
      return v === '' || v == null ? [] : [Number(v)];
    }
    const dados = window.Parcelamento?.getData('pagamentoPedidoParcelamento');
    return (dados?.items || []).map(it => it.dueInDays).filter(d => d !== null && d !== undefined);
  }

  function pintarVencimentos() {
    const dias = diasEscolhidos();
    if (!dias.length) {
      vencimentosBox.classList.add('hidden');
      vencimentosLista.innerHTML = '';
      return;
    }
    vencimentosBox.classList.remove('hidden');
    vencimentosLista.innerHTML = dias.map((d, i) => {
      const data = new Date(`${vencimentoEm(d)}T00:00:00`).toLocaleDateString('pt-BR');
      const rotulo = dias.length > 1 ? `${i + 1}ª — ` : '';
      return `<span class="badge-info px-3 py-1 rounded-full text-xs font-medium">${rotulo}${data} (${d} dias)</span>`;
    }).join('');
  }

  // ------------------------------------------------------------- condição
  function montarCampoCondicao(prefill) {
    if (condicaoSel.value === 'vista') {
      box.innerHTML = `
        <div class="relative w-48">
          <input id="pagamentoPedidoPrazoVista" type="number" min="0" step="1" placeholder=" "
                 class="peer w-full bg-input border border-inputBorder rounded-lg px-4 py-3 text-white placeholder-transparent focus:border-primary focus:ring-2 focus:ring-primary/50 transition" />
          <label for="pagamentoPedidoPrazoVista" class="absolute left-4 top-0 -translate-y-full text-xs text-gray-300 pointer-events-none">Prazo (dias)</label>
        </div>`;
      const input = el('pagamentoPedidoPrazoVista');
      if (prefill?.items?.[0]?.dueInDays != null) input.value = prefill.items[0].dueInDays;
      pintarVencimentos();
      return Promise.resolve();
    }

    box.innerHTML = '<div id="pagamentoPedidoParcelamento"></div>';
    return carregarParcelamento().then(() => {
      window.Parcelamento.init('pagamentoPedidoParcelamento', {
        getTotal: totalEmCentavos,
        prefill
      });
      pintarVencimentos();
    });
  }

  // O utilitário de parcelamento não avisa quando as linhas mudam, e o
  // conteúdo de `box` é substituído a cada troca de condição. Por isso os
  // ouvintes ficam no PRÓPRIO box e são registrados uma vez só: presos ao
  // conteúdo, eles se acumulariam a cada ida e volta entre à vista e a prazo.
  box.addEventListener('input', pintarVencimentos);
  box.addEventListener('change', pintarVencimentos);

  condicaoSel.addEventListener('change', async () => {
    limparMensagem();
    await montarCampoCondicao();
    pintarTotais();
  });

  // ------------------------------------------------------------ carga
  try {
    const resp = await fetchApi(`/api/pedidos/${pedidoId}`);
    if (!resp.ok) throw new Error('Não foi possível carregar o pedido.');
    pedido = await resp.json();
    itens = Array.isArray(pedido.itens) ? pedido.itens : [];

    if (String(pedido.situacao || '').trim() !== 'Produção') {
      // Chegar aqui significa que a situação mudou entre a listagem e a
      // abertura. Melhor dizer do que deixar salvar e receber 409.
      exibirMensagem('erro', 'Este pedido não está mais em produção; o pagamento não pode ser alterado.');
      salvarBtn.disabled = true;
    }

    condicaoOriginal = Number(pedido.parcelas) > 1 ? 'prazo' : 'vista';
    condicaoSel.value = condicaoOriginal;

    el('pagamentoPedidoNumero').textContent = pedido.numero ? `Pedido ${pedido.numero}` : '';
    el('pagamentoPedidoEmissao').textContent = pedido.data_emissao
      ? new Date(pedido.data_emissao).toLocaleDateString('pt-BR')
      : '—';

    // Quantidade de PEÇAS, não de linhas: um pedido de uma linha com 12
    // unidades são 12 peças. Contar linhas dizia "1 peça" para um pedido de
    // uma dúzia.
    const totalPecas = itens.reduce((soma, it) => soma + (Number(it.quantidade) || 0), 0);
    el('pagamentoPedidoItens').textContent =
      `${totalPecas} ${totalPecas === 1 ? 'peça' : 'peças'}`;

    el('pagamentoPedidoCliente').textContent = nomeDoCliente(pedido);

    if (pedido.forma_pagamento) {
      formaSel.value = pedido.forma_pagamento;
      formaSel.setAttribute('data-filled', 'true');
    }
    formaSel.addEventListener('change', () => {
      formaSel.setAttribute('data-filled', formaSel.value ? 'true' : 'false');
      limparMensagem();
    });

    // Os dias vêm de `prazo` ("30" ou "30/60/90"); os valores, das parcelas.
    const prazos = String(pedido.prazo || '').split('/').map(p => parseInt(p, 10)).filter(n => !Number.isNaN(n));
    const detalhes = Array.isArray(pedido.parcelas_detalhes) ? pedido.parcelas_detalhes : [];
    const prefill = {
      count: Math.max(detalhes.length, 1),
      mode: String(pedido.tipo_parcela) === 'diferente' ? 'custom' : 'equal',
      items: detalhes.map((p, i) => ({
        amount: Math.round((Number(p.valor) || 0) * 100),
        dueInDays: prazos[i] ?? 0
      }))
    };
    if (!prefill.items.length && prazos.length) {
      prefill.items = prazos.map(d => ({ amount: 0, dueInDays: d }));
    }

    await montarCampoCondicao(prefill);
    pintarTotais();
  } catch (err) {
    console.error('Erro ao carregar o pedido para pagamento:', err);
    exibirMensagem('erro', err?.message || 'Não foi possível carregar o pedido.');
    salvarBtn.disabled = true;
  } finally {
    window.dispatchEvent(new CustomEvent('pedidoModalLoaded', { detail: overlayId }));
  }

  // ------------------------------------------------------------- gravação
  let emAndamento = false;

  function travarBotao(travado) {
    if (!salvarBtn) return;
    salvarBtn.disabled = travado;
    salvarBtn.classList.toggle('btn-loading', travado);
    salvarBtn.setAttribute('aria-busy', travado ? 'true' : 'false');
  }

  /** Parcelas no formato de `pedido_parcelas`, ou null com o motivo. */
  function montarParcelas() {
    const totais = calcularTotais(condicaoSel.value);

    if (condicaoSel.value === 'vista') {
      const dias = el('pagamentoPedidoPrazoVista')?.value;
      if (dias === '' || dias == null) return { erro: 'Informe o prazo em dias.' };
      return {
        prazo: String(Number(dias)),
        tipoParcela: 'a vista',
        parcelas: [{ valor: totais.total, data_vencimento: vencimentoEm(dias), numero_parcela: 1 }]
      };
    }

    const dados = window.Parcelamento?.getData('pagamentoPedidoParcelamento');
    if (!dados || !dados.canRegister) {
      return { erro: 'Complete o parcelamento: as parcelas precisam somar o total.' };
    }
    return {
      prazo: dados.items.map(it => it.dueInDays).join('/'),
      tipoParcela: dados.mode === 'equal' ? 'igual' : 'diferente',
      parcelas: dados.items.map((it, i) => ({
        valor: it.amount / 100,
        data_vencimento: vencimentoEm(it.dueInDays),
        numero_parcela: i + 1
      }))
    };
  }

  salvarBtn?.addEventListener('click', async () => {
    if (emAndamento) return;
    limparMensagem();

    if (!formaSel.value) {
      exibirMensagem('erro', 'Selecione a forma de pagamento.');
      return;
    }
    const montagem = montarParcelas();
    if (montagem.erro) {
      exibirMensagem('erro', montagem.erro);
      return;
    }

    const totais = calcularTotais(condicaoSel.value);
    emAndamento = true;
    travarBotao(true);
    try {
      const confirmou = await window.DialogPadrao.confirm({
        title: 'Alterar pagamento',
        message: `O total do pedido passará para ${formatarMoeda(totais.total)}. Confirmar a alteração?`,
        confirmText: 'Sim',
        cancelText: 'Não'
      });
      if (!confirmou) return;

      const executar = async () => {
        const resp = await fetchApi(`/api/pedidos/${pedidoId}/pagamento`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            condicao: condicaoSel.value,
            forma_pagamento: formaSel.value,
            prazo: montagem.prazo,
            tipo_parcela: montagem.tipoParcela,
            parcelas_detalhes: montagem.parcelas
          })
        });

        let corpo = null;
        try { corpo = await resp.json(); } catch (_) {}
        if (!resp.ok) throw new Error(corpo?.error || 'Não foi possível salvar o pagamento.');

        window.showToast?.('Pagamento do pedido atualizado.', 'success');
        window.carregarPedidos?.();
        setTimeout(close, 300);
      };

      if (typeof window.BotaoAcao?.comCarregamento === 'function') {
        await window.BotaoAcao.comCarregamento(executar, 'Salvando o pagamento...');
      } else {
        await executar();
      }
    } catch (err) {
      console.error('Erro ao salvar o pagamento do pedido:', err);
      exibirMensagem('erro', err?.message || 'Falha ao salvar o pagamento.');
    } finally {
      emAndamento = false;
      travarBotao(false);
    }
  });
})();
