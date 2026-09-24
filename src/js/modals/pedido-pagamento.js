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
 *
 * Os vencimentos contam do início do faturamento do pedido, e não mais da
 * emissão (ver "Datas do faturamento" abaixo). A previsão de embarque e esse
 * início se alteram pelo botão "Embarque e faturamento", que abre o modal de
 * datas (`pedido-datas.js`) e tem permissão própria, `ped.dates.edit`.
 *
 * Desde 24/09/2026 (decisões do dono): as parcelas podem somar MAIS
 * (Adicional) ou MENOS (Desconto) que os itens, com justificativa — o total do
 * pedido passa a ser a soma —; e a parcela com boleto, pagamento ou ordem de
 * pagamento fica travada (só vai para o valor exato do boleto/pagamento).
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
    desligarOuvintesGlobais();
    Modal.close(overlayId);
  };
  const onEsc = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  document.addEventListener('keydown', onEsc);
  overlay.querySelector('#voltarPagamentoPedido')?.addEventListener('click', close);
  overlay.querySelector('#cancelarPagamentoPedido')?.addEventListener('click', close);

  // O modal de datas responde por evento no window. O ouvinte é deste modal e
  // sai com ele — inclusive quando ele é fechado por fora (`Modal.closeAll`
  // na troca de módulo), que não passa pelo `close` acima.
  window.addEventListener('pedido:datas-definidas', aoDefinirDatas);
  window.addEventListener('modalFechado', aoFecharModal);

  function desligarOuvintesGlobais() {
    document.removeEventListener('keydown', onEsc);
    window.removeEventListener('pedido:datas-definidas', aoDefinirDatas);
    window.removeEventListener('modalFechado', aoFecharModal);
  }

  function aoFecharModal(evento) {
    if (evento?.detail === overlayId) desligarOuvintesGlobais();
  }

  const el = id => overlay.querySelector(`#${id}`);
  const condicaoSel = el('pagamentoPedidoCondicao');
  const formaSel = el('pagamentoPedidoForma');
  const box = el('pagamentoPedidoBox');
  const vencimentosBox = el('pagamentoPedidoVencimentos');
  const vencimentosLista = el('pagamentoPedidoVencimentosLista');
  const resumoDatasEl = el('pagamentoPedidoDatasResumo');
  const mensagemEl = el('pagamentoPedidoMensagem');
  const salvarBtn = el('salvarPagamentoPedido');

  const pedidoId = window.selectedOrderId;

  // Sem devolver o contexto o modal reabre vazio depois de uma queda
  // (ver docs/restauracao-de-trabalho.md).
  window.EstadoTrabalho?.registrarContexto?.(overlayId,
    () => ({ selectedOrderId: window.selectedOrderId }));

  const formatarMoeda = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  /**
   * As travas das parcelas, na ordem do número, a partir do estado da
   * cobrança (GET /api/cobranca/pedidos/:id/boletos): boleto do BB, pagamento
   * registrado, boleto de fora ou ordem de pagamento. Centavos. Pura.
   */
  function travasDasLinhas(linhas) {
    const reais = c => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const travas = [];
    const ordenadas = (Array.isArray(linhas) ? linhas : []).slice()
      .sort((a, b) => (Number(a?.parcela?.numero_parcela) || 0) - (Number(b?.parcela?.numero_parcela) || 0));
    for (const l of ordenadas) {
      const n = Number(l?.parcela?.numero_parcela);
      if (!Number.isInteger(n) || n < 1) continue;
      let origem = null;
      let valor = null;
      if (l.tem_boleto_vivo && l.boleto) { origem = 'boleto do BB'; valor = l.boleto.valor; } else if (l.recebimento) { origem = 'pagamento registrado'; valor = l.recebimento.valor; } else if (l.boleto_externo) { origem = 'boleto de fora'; valor = l.boleto_externo.valor; } else if (l.ordem) { origem = 'ordem de pagamento'; valor = l.ordem.valor; }
      if (!origem) continue;
      const atual = Math.round((Number(l.parcela.valor) || 0) * 100);
      const permitido = valor === null || valor === undefined ? null : Math.round(Number(valor) * 100);
      travas[n - 1] = {
        atual, permitido,
        texto: permitido !== null && permitido !== atual
          ? `Tem ${origem} de ${reais(permitido)}: o valor fica em ${reais(atual)} ou vai exatamente para ${reais(permitido)}.`
          : `Tem ${origem}: o valor e o prazo desta parcela não mudam.`
      };
    }
    return travas;
  }

  /** A diferença das parcelas para os itens: + Adicional, − Desconto; centavos até 2 são arredondamento. Pura. */
  function ajusteDasParcelas(somaCentavos, totalCentavos) {
    const diferenca = Math.round(somaCentavos - totalCentavos);
    return Math.abs(diferenca) <= 2 ? 0 : diferenca;
  }

  let travas = [];

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

  // ==================================================================
  // Datas do faturamento — funções puras.
  //
  // Os vencimentos contam do INÍCIO DO FATURAMENTO (pedidos.inicio_faturamento),
  // definido na conversão ou em "Embarque e faturamento". No pedido antigo,
  // sem início gravado, contam do dia da emissão em São Paulo. É a MESMA conta
  // que o backend faz ao gravar — ele recalcula as datas e ignora as que
  // chegam daqui —; a tela só a mostra antes.
  //
  // Colunas DATE chegam como '2026-08-10' ou '2026-08-10T00:00:00.000Z' e são
  // CORTADAS, nunca passadas por new Date(): em São Paulo, a segunda é 9 de
  // agosto às 21h. A soma de dias é de calendário, em UTC. Somar
  // milissegundos ao instante da emissão, como se fazia, dava o dia UTC.
  //
  // Sem DOM e sem `window`: src/js/__tests__/pagamentoDatasPedido.test.js
  // recorta este trecho e o executa isolado.
  // ==================================================================
  const FUSO_PEDIDO = 'America/Sao_Paulo';

  /** 'YYYY-MM-DD' de uma coluna DATE, cortado do texto. */
  function diaDeColunaDate(valor) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor ?? '').trim());
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }

  /**
   * O dia, em São Paulo, de um instante (`data_emissao` é timestamp). Texto
   * só com a data volta como está.
   */
  function diaEmSaoPaulo(instante) {
    if (instante === null || instante === undefined || instante === '') return null;
    const texto = String(instante).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
    const quando = typeof instante?.getTime === 'function' ? instante : new Date(texto);
    if (Number.isNaN(quando.getTime())) return null;
    const partes = new Intl.DateTimeFormat('en-CA', {
      timeZone: FUSO_PEDIDO, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(quando);
    const parte = tipo => partes.find(p => p.type === tipo)?.value;
    return `${parte('year')}-${parte('month')}-${parte('day')}`;
  }

  /** Soma de calendário: '2026-08-10' + 15 → '2026-08-25'. */
  function somarDias(dia, dias) {
    const d = diaDeColunaDate(dia);
    const n = Number(dias);
    if (!d || !Number.isFinite(n)) return null;
    const [ano, mes, diaDoMes] = d.split('-').map(Number);
    return new Date(Date.UTC(ano, mes - 1, diaDoMes + Math.trunc(n))).toISOString().slice(0, 10);
  }

  /** Base dos vencimentos: o início do faturamento; no legado, o dia (SP) da emissão. */
  function baseDosVencimentos(dadosDoPedido, agora) {
    return diaDeColunaDate(dadosDoPedido?.inicio_faturamento)
      || diaEmSaoPaulo(dadosDoPedido?.data_emissao)
      || diaEmSaoPaulo(agora || new Date());
  }

  /** 'YYYY-MM-DD' → 'dd/mm/aaaa'; '—' quando não há data. */
  function formatarDia(dia) {
    const d = diaDeColunaDate(dia);
    return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—';
  }

  const textoDias = n => `${n} ${Number(n) === 1 ? 'dia' : 'dias'}`;

  const ROTULO_REGRA = { ao_embarcar: 'ao embarcar', ao_converter: 'na conversão', data: 'data específica' };

  /** A linha acima dos vencimentos: de onde eles partem. */
  function textoResumoDatas(dadosDoPedido, agora) {
    const previsao = diaDeColunaDate(dadosDoPedido?.embarcar_previsao);
    if (!previsao) return 'Sem previsão de embarque — defina em Embarque e faturamento';
    const regra = ROTULO_REGRA[dadosDoPedido?.faturamento_regra];
    return `Embarque previsto: ${formatarDia(previsao)} · Faturamento a partir de `
      + `${formatarDia(baseDosVencimentos(dadosDoPedido, agora))}${regra ? ` (${regra})` : ''}`;
  }

  /** Parcelas na ordem de `numero_parcela`: o upstream ignora o `order` do GET. */
  function ordenarPorNumeroParcela(lista) {
    return (Array.isArray(lista) ? lista.slice() : [])
      .sort((a, b) => (Number(a?.numero_parcela) || 0) - (Number(b?.numero_parcela) || 0));
  }
  // ==================================================================
  // fim das datas do faturamento
  // ==================================================================

  function vencimentoEm(dias) {
    return somarDias(baseDosVencimentos(pedido), Number(dias) || 0);
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
      const rotulo = dias.length > 1 ? `${i + 1}ª — ` : '';
      return `<span class="badge-info px-3 py-1 rounded-full text-xs font-medium">${rotulo}${formatarDia(vencimentoEm(d))} (${textoDias(d)})</span>`;
    }).join('');
  }

  function pintarResumoDatas() {
    if (resumoDatasEl) resumoDatasEl.textContent = pedido ? textoResumoDatas(pedido) : '';
  }

  // ------------------------------------------------ botão "Embarque e faturamento"
  // Recortado por src/js/__tests__/pagamentoDatasPedido.test.js.
  //
  // O botão fica À DIREITA da escolha do tipo de parcela, na altura de
  // "Diferentes". Quem desenha essa linha é o `parcelamento.js`, que também
  // serve aos orçamentos: pôr o botão no markup dele o levaria para lá. Então
  // é este modal que o insere, depois de cada `Parcelamento.init` — a linha é
  // refeita a cada troca de condição, e o botão volta para ela.

  /** Criado uma vez só: o mesmo elemento é reposto a cada nova linha. */
  function criarBotaoDatas(doc) {
    const botao = doc.createElement('button');
    botao.type = 'button';
    botao.id = 'pagamentoPedidoDatasBtn';
    botao.setAttribute('data-perm', 'ped.dates.edit');
    botao.className = 'btn-neutral ctl-botao border border-white/10 text-white';
    // A margem automática empurra o botão para a ponta direita da linha.
    botao.style.marginLeft = 'auto';
    botao.innerHTML = '<i class="fas fa-calendar-alt" aria-hidden="true"></i><span>Embarque e faturamento</span>';
    return botao;
  }

  /**
   * A linha onde o botão mora:
   *  - a prazo: a dos rádios de Modo. O rádio "Diferentes" fica dentro de um
   *    <label>, e a linha é o pai desse label (o label também é `.flex`, então
   *    um `closest('.flex')` pararia nele);
   *  - à vista, sem a linha de Modo: a do campo "Prazo (dias)".
   * Devolve a linha, ou null enquanto não há onde pôr.
   */
  function posicionarBotaoDatas(caixa, botao) {
    if (!caixa || !botao) return null;
    const diferentes = caixa.querySelector('input[value="custom"]');
    const prazoVista = caixa.querySelector('#pagamentoPedidoPrazoVista');
    const linha = diferentes?.closest('label')?.parentElement
      || prazoVista?.closest('[data-linha-prazo-vista]')
      || null;
    if (!linha) return null;
    // Numa tela estreita a linha quebra, em vez de espremer os rádios.
    linha.classList.add('flex-wrap');
    if (botao.parentElement !== linha) linha.appendChild(botao);
    return linha;
  }
  // ------------------------------------------------ fim do botão de datas

  let botaoDatas = null;
  const pedidoEmProducao = () => String(pedido?.situacao || '').trim() === 'Produção';

  function garantirBotaoDatas() {
    if (!botaoDatas) {
      botaoDatas = criarBotaoDatas(document);
      // A mesma trava do Salvar: as datas só mudam com o pedido em produção.
      if (!pedidoEmProducao()) {
        botaoDatas.disabled = true;
        botaoDatas.title = 'As datas só podem ser alteradas com o pedido em produção.';
      }
    }
    posicionarBotaoDatas(box, botaoDatas);
  }

  // ------------------------------------------------------------- condição
  function montarCampoCondicao(prefill) {
    if (condicaoSel.value === 'vista') {
      box.innerHTML = `
        <div class="flex flex-wrap items-center gap-4" data-linha-prazo-vista>
          <div class="relative w-48">
            <input id="pagamentoPedidoPrazoVista" type="number" min="0" step="1" placeholder=" "
                   class="peer w-full ctl-campo bg-input border border-inputBorder text-white placeholder-transparent focus:border-primary focus:ring-2 focus:ring-primary/50 transition" />
            <label for="pagamentoPedidoPrazoVista" class="absolute left-3 top-0 -translate-y-full text-xs text-gray-300 pointer-events-none">Prazo (dias)</label>
          </div>
        </div>`;
      const input = el('pagamentoPedidoPrazoVista');
      if (prefill?.items?.[0]?.dueInDays != null) input.value = prefill.items[0].dueInDays;
      garantirBotaoDatas();
      pintarVencimentos();
      return Promise.resolve();
    }

    box.innerHTML = '<div id="pagamentoPedidoParcelamento"></div>';
    return carregarParcelamento().then(() => {
      window.Parcelamento.init('pagamentoPedidoParcelamento', {
        getTotal: totalEmCentavos,
        prefill,
        // A soma pode sair dos itens (com justificativa) e a parcela com
        // boleto/pagamento/ordem fica travada (decisões do dono, 24/09/2026).
        permitirDiferenca: true,
        travas
      });
      garantirBotaoDatas();
      pintarVencimentos();
      pintarAjuste();
    });
  }

  // O utilitário de parcelamento não avisa quando as linhas mudam, e o
  // conteúdo de `box` é substituído a cada troca de condição. Por isso os
  // ouvintes ficam no PRÓPRIO box e são registrados uma vez só: presos ao
  // conteúdo, eles se acumulariam a cada ida e volta entre à vista e a prazo.
  box.addEventListener('input', pintarVencimentos);
  box.addEventListener('change', pintarVencimentos);
  // A diferença (Adicional/Desconto) acompanha as mesmas mudanças.
  for (const evento of ['input', 'change', 'focusout', 'click']) box.addEventListener(evento, () => setTimeout(pintarAjuste, 0));
  // O parcelamento só grava o prazo digitado no `blur` do campo, e no
  // Chromium o `change` vem ANTES do blur: repintando só em input/change, a
  // lista ficava uma edição atrasada. O `focusout` borbulha e chega depois do
  // blur, com o estado já atualizado.
  box.addEventListener('focusout', pintarVencimentos);
  // Mesmo motivo para o clique do botão de datas: ele é reposto a cada nova
  // linha, e o ouvinte no box vale para qualquer uma delas.
  box.addEventListener('click', evento => {
    const botao = evento.target?.closest?.('#pagamentoPedidoDatasBtn');
    if (!botao || botao.disabled) return;
    abrirDatasDoPedido();
  });

  condicaoSel.addEventListener('change', async () => {
    limparMensagem();
    await montarCampoCondicao();
    pintarTotais();
    pintarAjuste();
  });

  /** A soma das parcelas (centavos) — a prazo, do parcelamento; à vista, o total. */
  function somaDasParcelas() {
    if (condicaoSel.value !== 'prazo') return totalEmCentavos();
    const dados = window.Parcelamento?.getData('pagamentoPedidoParcelamento');
    return (dados?.items || []).reduce((s, it) => s + (Number(it.amount) || 0), 0);
  }

  /** Mostra a diferença para os itens e pede a justificativa quando ela existe. */
  function pintarAjuste() {
    const caixa = el('pagamentoPedidoAjuste');
    if (!caixa) return;
    const total = totalEmCentavos();
    const soma = somaDasParcelas();
    const ajuste = condicaoSel.value === 'prazo' ? ajusteDasParcelas(soma, total) : 0;
    caixa.classList.toggle('hidden', !ajuste);
    if (!ajuste) return;
    el('pagamentoPedidoAjusteTexto').textContent = `As parcelas somam ${formatarMoeda(soma / 100)}: ${formatarMoeda(Math.abs(ajuste) / 100)} ${ajuste > 0 ? 'a mais' : 'a menos'} que os itens (${ajuste > 0 ? 'Adicional' : 'Desconto'}). O total do pedido passa a ser ${formatarMoeda(soma / 100)}.`;
  }

  // ------------------------------------------------------ datas do pedido
  let abrindoDatas = false;

  async function abrirDatasDoPedido() {
    if (abrindoDatas || !pedido) return;
    limparMensagem();
    if (!pedidoEmProducao()) {
      exibirMensagem('erro', 'Este pedido não está mais em produção; as datas não podem ser alteradas.');
      return;
    }
    abrindoDatas = true;
    try {
      const cliente = nomeDoCliente(pedido);
      window.datasPedidoContext = {
        modo: 'pedido',
        pedidoId,
        numero: pedido.numero || '',
        cliente: cliente === '—' ? '' : cliente,
        // Os dias do FORMULÁRIO, mesmo ainda não salvos: é o que a pessoa
        // está vendo, e a prévia do modal de datas tem de bater com esta tela.
        prazos: diasEscolhidos(),
        embarcar_previsao: diaDeColunaDate(pedido.embarcar_previsao),
        inicio_faturamento: diaDeColunaDate(pedido.inicio_faturamento),
        faturamento_regra: pedido.faturamento_regra || null,
        dataConversao: diaEmSaoPaulo(pedido.data_emissao)
      };
      await Modal.open('modals/pedidos/datas.html', '../js/modals/pedido-datas.js', 'datasPedido', true);
    } catch (err) {
      console.error('Erro ao abrir as datas do pedido:', err);
      exibirMensagem('erro', 'Não foi possível abrir as datas do pedido.');
    } finally {
      abrindoDatas = false;
    }
  }

  /** O modal de datas gravou: atualiza o pedido em memória e repinta. */
  function aoDefinirDatas(evento) {
    if (!overlay.isConnected) { desligarOuvintesGlobais(); return; }
    const detalhe = evento?.detail;
    if (!detalhe || detalhe.source !== 'pedido-datas' || detalhe.modo !== 'pedido' || !pedido) return;
    const resposta = detalhe.resposta || {};
    const datas = detalhe.datas || {};
    for (const campo of ['embarcar_previsao', 'inicio_faturamento', 'faturamento_regra']) {
      const valor = resposta[campo] ?? datas[campo];
      if (valor !== undefined) pedido[campo] = valor;
    }
    pintarResumoDatas();
    pintarVencimentos();
    window.showToast?.('Datas do pedido atualizadas.', 'success');
    const avisos = (Array.isArray(resposta.avisos) ? resposta.avisos : [])
      .map(a => (typeof a === 'string' ? a : a?.mensagem || a?.message || ''))
      .filter(Boolean);
    if (avisos.length) window.showToast?.(avisos.join(' '), 'info');
    // A lista de pedidos mostra embarque e atraso: relê para não ficar velha.
    window.carregarPedidos?.();
  }

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
    // O dia da emissão em São Paulo: é o mesmo que serve de base aos
    // vencimentos do pedido antigo.
    el('pagamentoPedidoEmissao').textContent = formatarDia(diaEmSaoPaulo(pedido.data_emissao));

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
    // A posição i do prazo é a parcela de número i+1, então as parcelas são
    // ordenadas pelo número antes de casar uma coisa com a outra.
    const prazos = String(pedido.prazo || '').split('/').map(p => parseInt(p, 10)).filter(n => !Number.isNaN(n));
    const detalhes = ordenarPorNumeroParcela(pedido.parcelas_detalhes);
    // As travas: parcela com boleto, pagamento ou ordem (sem permissão de ver
    // boletos, a tela não sabe — o backend confere assim mesmo).
    try {
      const respCobranca = await fetchApi(`/api/cobranca/pedidos/${pedidoId}/boletos`);
      if (respCobranca.ok) travas = travasDasLinhas((await respCobranca.json())?.parcelas);
    } catch (_) { travas = []; }
    // Pedido já ajustado (soma ≠ itens) abre em "Diferentes", com a justificativa de antes.
    const jaAjustado = Math.abs(Number(pedido.ajuste_valor) || 0) > 0.02;
    if (el('pagamentoPedidoJustificativa')) el('pagamentoPedidoJustificativa').value = pedido.ajuste_motivo || '';
    const prefill = {
      count: Math.max(detalhes.length, 1),
      mode: String(pedido.tipo_parcela) === 'diferente' || jaAjustado ? 'custom' : 'equal',
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
    pintarResumoDatas();
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

  /**
   * Parcelas no formato de `pedido_parcelas`, ou null com o motivo.
   *
   * `data_vencimento` segue no corpo só por compatibilidade: o backend
   * recalcula cada uma a partir do início do faturamento e ignora a daqui.
   */
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
      return { erro: dados?.motivo || 'Complete o parcelamento: informe o valor e o prazo de cada parcela.' };
    }
    const soma = dados.items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
    const ajuste = ajusteDasParcelas(soma, totalEmCentavos());
    const justificativa = (el('pagamentoPedidoJustificativa')?.value || '').trim();
    if (ajuste && justificativa.length < 10) {
      return { erro: `As parcelas somam ${formatarMoeda(Math.abs(ajuste) / 100)} ${ajuste > 0 ? 'a mais' : 'a menos'} que os itens: escreva a justificativa (ao menos 10 letras) para salvar.` };
    }
    return {
      ajuste, soma, justificativa: ajuste ? justificativa : '',
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
      const totalNovo = montagem.ajuste ? montagem.soma / 100 : totais.total;
      const confirmou = await window.DialogPadrao.confirm({
        title: 'Alterar pagamento',
        message: montagem.ajuste
          ? `O total do pedido passará para ${formatarMoeda(totalNovo)} — itens ${formatarMoeda(totais.total)} ${montagem.ajuste > 0 ? '+ adicional' : '− desconto'} de ${formatarMoeda(Math.abs(montagem.ajuste) / 100)}. Justificativa: "${montagem.justificativa}". Confirmar a alteração?`
          : `O total do pedido passará para ${formatarMoeda(totalNovo)}. Confirmar a alteração?`,
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
            parcelas_detalhes: montagem.parcelas,
            justificativa: montagem.justificativa || undefined
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
