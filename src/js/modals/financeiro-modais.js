/**
 * Modais do Financeiro — Comissões e Produção (etapa visual).
 *
 * Um script para os seis modais de ação (NF, recebimento, ajuste, produção,
 * fechar competência e relatórios): a anatomia é a mesma — Voltar/Cancelar/Esc
 * fecham, a ação principal fica no rodapé — e o que muda de um para outro é
 * pouco (as contas de conferência mostradas na tela). Quem abre diz qual é o
 * modal por `window.financeiroModalContexto.overlayId` (ver financeiro.js).
 *
 * Nada aqui grava: a ação principal abre o aviso "em implementação", já com a
 * trava de clique duplo do BotaoAcao, para o comportamento não mudar quando
 * o backend entrar. As contas de conferência (parcelas da NF, impacto do
 * ajuste, saldo da produção) são reais e ficam em funções puras, expostas em
 * `window.FinanceiroModais` para os testes e para o backend reaproveitar.
 *
 * Datas são texto 'YYYY-MM-DD' somadas por Date.UTC: passar pelo relógio local
 * volta um dia em São Paulo.
 */
(() => {
  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const TAXA_CMS = 0.10;      // taxas de exemplo da etapa visual
  const TAXA_ROYALTY = 0.10;

  const formatoMoeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  function formatarMoeda(valor) {
    if (valor === null || valor === undefined || valor === '') return '—';
    const numero = Number(valor);
    if (!Number.isFinite(numero)) return '—';
    return numero < 0 ? `- ${formatoMoeda.format(Math.abs(numero))}` : formatoMoeda.format(numero);
  }

  /** 'R$ 1.234,56', '1234,56' ou '1234.56' -> 1234.56; vazio -> null. */
  function lerMoeda(texto) {
    const limpo = String(texto ?? '').replace(/R\$/g, '').replace(/\s/g, '').trim();
    if (!limpo) return null;
    // Com vírgula, o ponto é milhar. Sem vírgula, "17.560" é dezessete mil
    // (pt-BR) e "1234.56" é decimal: o ponto de milhar sempre precede
    // exatamente três dígitos.
    const normalizado = limpo.includes(',')
      ? limpo.replace(/\./g, '').replace(',', '.')
      : (/^-?\d{1,3}(\.\d{3})+$/.test(limpo) ? limpo.replace(/\./g, '') : limpo);
    const numero = Number(normalizado);
    return Number.isFinite(numero) ? numero : null;
  }

  function partesDaData(texto) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(texto || ''));
    return m ? { ano: Number(m[1]), mes: Number(m[2]), dia: Number(m[3]) } : null;
  }

  function formatarData(texto) {
    const p = partesDaData(texto);
    return p ? `${String(p.dia).padStart(2, '0')}/${String(p.mes).padStart(2, '0')}/${p.ano}` : '—';
  }

  function somarDias(texto, dias) {
    const p = partesDaData(texto);
    if (!p) return null;
    const d = new Date(Date.UTC(p.ano, p.mes - 1, p.dia + Number(dias || 0)));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }

  /** 'YYYY-MM-DD' -> 'Setembro/2026' (o formato da descrição do módulo). */
  function competenciaDe(texto) {
    const p = partesDaData(texto);
    return p ? `${MESES[p.mes - 1]}/${p.ano}` : '—';
  }

  function rotuloCompetencia(valor) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(valor || ''));
    return m ? `${MESES[Number(m[2]) - 1]} / ${m[1]}` : '—';
  }

  function hojeLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** Competências de 12 meses atrás a 3 à frente; `selecionada` é 'YYYY-MM'. */
  function montarCompetencias(select, selecionada) {
    if (!select) return;
    const hoje = new Date();
    const atual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
    const alvo = /^\d{4}-\d{2}$/.test(String(selecionada || '')) ? selecionada : atual;
    select.replaceChildren();
    for (let desloca = -12; desloca <= 3; desloca++) {
      const total = hoje.getFullYear() * 12 + hoje.getMonth() + desloca;
      const valor = `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
      const opcao = document.createElement('option');
      opcao.value = valor;
      opcao.textContent = rotuloCompetencia(valor);
      if (valor === alvo) opcao.selected = true;
      select.appendChild(opcao);
    }
  }

  /**
   * Parcelas de uma NF: valor dividido em partes iguais em centavos, com a
   * sobra distribuída um centavo por parcela a partir da primeira — é assim
   * que as parcelas dos pedidos estão gravadas (1.731,30 / 1.731,29 / 1.731,29).
   * `prazos` em dias a partir da emissão; [0] é à vista.
   */
  function calcularParcelas(valor, prazos, emissao) {
    const total = Math.round(Number(valor) * 100);
    const lista = Array.isArray(prazos) && prazos.length ? prazos : [0];
    if (!Number.isFinite(total) || total <= 0) return [];
    const n = lista.length;
    const base = Math.floor(total / n);
    let sobra = total - base * n;
    return lista.map((prazo, i) => {
      const centavos = base + (sobra > 0 ? 1 : 0);
      if (sobra > 0) sobra -= 1;
      return {
        numero: i + 1,
        total: n,
        prazo: Number(prazo) || 0,
        vencimento: somarDias(emissao, Number(prazo) || 0),
        valor: centavos / 100
      };
    });
  }

  function lerPrazos(condicao) {
    const texto = String(condicao ?? '').trim();
    if (!texto) return null;
    const dias = texto.split('/').map(p => Number(p.trim()));
    return dias.every(d => Number.isFinite(d) && d >= 0) ? dias : null;
  }

  /** Impacto de um ajuste numa parcela (valores em R$; ajustes anteriores negativos). */
  function impactoDoAjuste(original, anteriores, novo) {
    const liquido = Math.round((Number(original || 0) + Number(anteriores || 0) - Number(novo || 0)) * 100) / 100;
    return {
      original: Number(original || 0),
      anteriores: Number(anteriores || 0),
      novo: -Number(novo || 0),
      liquido,
      cms: Math.round(liquido * TAXA_CMS * 100) / 100,
      royalty: Math.round(liquido * TAXA_ROYALTY * 100) / 100
    };
  }

  /** Status do item depois de lançar `agora` peças. */
  function statusAposRegistro(pedida, finalizada, agora) {
    const acumulado = Number(finalizada || 0) + Number(agora || 0);
    const restante = Math.max(0, Number(pedida || 0) - acumulado);
    let status = 'Aguardando produção';
    if (acumulado > 0 && restante > 0) status = 'Parcialmente finalizado';
    if (Number(pedida || 0) > 0 && restante === 0) status = 'Totalmente finalizado';
    return { acumulado, restante, status, excede: acumulado > Number(pedida || 0) };
  }

  window.FinanceiroModais = {
    formatarMoeda, lerMoeda, formatarData, somarDias, competenciaDe, rotuloCompetencia,
    calcularParcelas, lerPrazos, impactoDoAjuste, statusAposRegistro, TAXA_CMS, TAXA_ROYALTY
  };

  // ------------------------------------------------------------ base

  const contexto = window.financeiroModalContexto || {};
  const overlayId = contexto.overlayId;
  const overlay = overlayId ? document.getElementById(`${overlayId}Overlay`) : null;
  if (!overlay) return;

  const el = id => overlay.querySelector(`#${id}`);
  let processando = false;

  const fechar = () => {
    // Fechamento de competência em andamento não pode ser cancelado por engano.
    if (processando) return;
    desligar();
    window.Modal?.close(overlayId);
  };
  const aoEsc = e => { if (e.key === 'Escape') { e.preventDefault(); fechar(); } };
  const aoFecharPorFora = e => { if (e?.detail === overlayId) desligar(); };
  function desligar() {
    document.removeEventListener('keydown', aoEsc);
    window.removeEventListener('modalFechado', aoFecharPorFora);
  }
  document.addEventListener('keydown', aoEsc);
  window.addEventListener('modalFechado', aoFecharPorFora);
  overlay.querySelectorAll('[data-fin-fechar]').forEach(b => b.addEventListener('click', fechar));

  function avisarEmImplementacao(rotulo) {
    const mensagem = `"${rotulo}" ainda está em implementação.\nNada foi gravado.`;
    if (window.DialogPadrao?.info) {
      return window.DialogPadrao.info({ title: 'Função em implementação', message: mensagem });
    }
    window.alert(mensagem);
    return Promise.resolve(true);
  }

  overlay.querySelectorAll('[data-fin-principal]').forEach(botao => {
    botao.addEventListener('click', () => {
      const executar = async () => {
        if (botao.dataset.finSensivel === 'true') processando = true;
        try {
          await avisarEmImplementacao(botao.dataset.finPrincipal || 'Esta função');
        } finally {
          processando = false;
        }
      };
      if (window.BotaoAcao?.run) window.BotaoAcao.run(botao, executar);
      else executar();
    });
  });

  overlay.querySelectorAll('input[type="date"]').forEach(campo => { if (!campo.value) campo.value = hojeLocal(); });

  function ligarCampoMoeda(campo, aoMudar) {
    if (!campo) return;
    campo.addEventListener('input', () => aoMudar?.(lerMoeda(campo.value)));
    campo.addEventListener('blur', () => {
      const valor = lerMoeda(campo.value);
      campo.value = valor === null ? '' : formatoMoeda.format(valor);
    });
  }

  function mostrarMensagem(id, texto, tipo = 'erro') {
    const alvo = el(id);
    if (!alvo) return;
    alvo.textContent = texto || '';
    alvo.style.color = tipo === 'erro' ? 'var(--color-red)' : 'var(--color-primary)';
    alvo.classList.toggle('hidden', !texto);
  }

  function montarDatalist(lista, itens) {
    if (!lista) return;
    lista.replaceChildren();
    for (const item of itens) {
      const opcao = document.createElement('option');
      opcao.value = item.valor;
      if (item.rotulo) opcao.label = item.rotulo;
      lista.appendChild(opcao);
    }
  }

  // ------------------------------------------------- dados de exemplo

  const EXEMPLO = {
    pedidos: [
      { numero: '2548', cliente: 'Cliente Exemplo LTDA', valor: 21500 },
      { numero: '2521', cliente: 'Marcenaria Serrana', valor: 52680 },
      { numero: '2537', cliente: 'Casa Vicenzo', valor: 17560 },
      { numero: '2501', cliente: 'Decorações Silvia', valor: 60000 }
    ],
    recebimento: {
      pedido: '2521', nf: '18790', cliente: 'Marcenaria Serrana',
      parcelas: [
        { numero: '1/3', vencimento: '2026-09-24', valor: 17560, liquidada: true },
        { numero: '2/3', vencimento: '2026-10-24', valor: 17560, liquidada: false },
        { numero: '3/3', vencimento: '2026-11-23', valor: 17560, liquidada: false }
      ]
    },
    ajuste: {
      pedido: '2501', nf: '18345',
      parcelas: [
        { numero: '1/3', vencimento: '2026-09-24', original: 20000, anteriores: -1000, comissaoPaga: true },
        { numero: '2/3', vencimento: '2026-10-24', original: 20000, anteriores: 0, comissaoPaga: false },
        { numero: '3/3', vencimento: '2026-11-23', original: 20000, anteriores: 0, comissaoPaga: false }
      ]
    },
    producao: {
      pedido: '2537', cliente: 'Cliente Exemplo',
      itens: [
        { codigo: 'MES-120', nome: 'Mesa de jantar 1,20 m', pedida: 10, finalizada: 6 },
        { codigo: 'CAD-04', nome: 'Cadeira estofada', pedida: 40, finalizada: 40 },
        { codigo: 'APA-02', nome: 'Aparador 2 portas', pedida: 4, finalizada: 0 }
      ]
    },
    fechamento: {
      comissoes: { parcelas: 28, base: 184500, comissao: 18450, ajustes: -840, total: 17610 },
      producao: { pecas: 327, pintura: 4230, marcenaria: 5640, total: 9870 }
    }
  };

  // ------------------------------------------------------- montadores

  function montarRegistrarNf() {
    const pedidoCampo = el('finNfPedido');
    const clienteCampo = el('finNfCliente');
    const valorCampo = el('finNfValor');
    const condicaoSel = el('finNfCondicao');
    const emissaoCampo = el('finNfEmissao');
    const bloco = el('finNfParcelas');
    const corpo = el('finNfParcelasCorpo');

    montarDatalist(el('finNfPedidosLista'), EXEMPLO.pedidos.map(p => ({ valor: p.numero, rotulo: p.cliente })));

    const pedidoEscolhido = () => EXEMPLO.pedidos.find(p => p.numero === String(pedidoCampo.value).trim());

    function aoEscolherPedido() {
      const pedido = pedidoEscolhido();
      clienteCampo.value = pedido ? pedido.cliente : '';
      if (pedido && lerMoeda(valorCampo.value) === null) valorCampo.value = formatoMoeda.format(pedido.valor);
      atualizarParcelas();
    }

    function atualizarParcelas() {
      const valor = lerMoeda(valorCampo.value);
      const prazos = lerPrazos(condicaoSel.value);
      corpo.replaceChildren();
      const parcelas = valor && prazos ? calcularParcelas(valor, prazos, emissaoCampo.value) : [];
      bloco.classList.toggle('hidden', parcelas.length === 0);
      for (const p of parcelas) {
        const linha = document.createElement('tr');
        const celula = (texto, classe) => {
          const td = document.createElement('td');
          td.className = classe;
          td.textContent = texto;
          return td;
        };
        linha.append(
          celula(`${p.numero}/${p.total}`, 'px-4 py-3 text-white'),
          celula(p.prazo === 0 ? 'à vista' : `${p.prazo} dias`, 'px-4 py-3 text-right text-gray-300'),
          celula(formatarData(p.vencimento), 'px-4 py-3 text-white'),
          celula(formatarMoeda(p.valor), 'px-4 py-3 text-right text-white')
        );
        corpo.appendChild(linha);
      }
    }

    pedidoCampo.addEventListener('input', aoEscolherPedido);
    pedidoCampo.addEventListener('change', aoEscolherPedido);
    ligarCampoMoeda(valorCampo, atualizarParcelas);
    condicaoSel.addEventListener('change', atualizarParcelas);
    emissaoCampo.addEventListener('change', atualizarParcelas);
  }

  function montarRecebimento() {
    const dados = EXEMPLO.recebimento;
    el('finRecebimentoContexto').textContent = `Pedido ${dados.pedido} • NF ${dados.nf}`;
    el('finRecebimentoCliente').textContent = dados.cliente;
    el('finRecebimentoPedido').textContent = dados.pedido;
    el('finRecebimentoNf').textContent = dados.nf;

    const parcelaSel = el('finRecebimentoParcela');
    const valorCampo = el('finRecebimentoValor');
    const dataCampo = el('finRecebimentoData');
    parcelaSel.replaceChildren();
    dados.parcelas.forEach((p, i) => {
      const opcao = document.createElement('option');
      opcao.value = String(i);
      opcao.textContent = `${p.numero} • vencimento ${formatarData(p.vencimento)} • ${formatarMoeda(p.valor)}${p.liquidada ? ' • liquidada' : ''}`;
      opcao.disabled = p.liquidada;
      parcelaSel.appendChild(opcao);
    });
    const primeiraAberta = dados.parcelas.findIndex(p => !p.liquidada);
    parcelaSel.value = String(primeiraAberta >= 0 ? primeiraAberta : 0);

    function atualizarResumo() {
      const parcela = dados.parcelas[Number(parcelaSel.value)];
      const recebido = lerMoeda(valorCampo.value);
      const liquido = recebido ?? parcela?.valor ?? null;
      el('finRecebimentoLiquido').textContent = formatarMoeda(liquido);
      el('finRecebimentoCms').textContent = formatarMoeda(liquido === null ? null : liquido * TAXA_CMS);
      el('finRecebimentoRoyalty').textContent = formatarMoeda(liquido === null ? null : liquido * TAXA_ROYALTY);
      el('finRecebimentoCompetencia').textContent = competenciaDe(dataCampo.value);
    }

    parcelaSel.addEventListener('change', () => {
      const parcela = dados.parcelas[Number(parcelaSel.value)];
      if (parcela) valorCampo.value = formatoMoeda.format(parcela.valor);
      atualizarResumo();
    });
    ligarCampoMoeda(valorCampo, atualizarResumo);
    dataCampo.addEventListener('change', atualizarResumo);

    const inicial = dados.parcelas[Number(parcelaSel.value)];
    if (inicial) valorCampo.value = formatoMoeda.format(inicial.valor);
    atualizarResumo();
  }

  function montarAjuste() {
    const dados = EXEMPLO.ajuste;
    el('finAjusteContexto').textContent = `Pedido ${dados.pedido} • NF ${dados.nf}`;
    const parcelaSel = el('finAjusteParcela');
    const valorCampo = el('finAjusteValor');
    parcelaSel.replaceChildren();
    dados.parcelas.forEach((p, i) => {
      const opcao = document.createElement('option');
      opcao.value = String(i);
      opcao.textContent = `${p.numero} • vencimento ${formatarData(p.vencimento)} • ${formatarMoeda(p.original + p.anteriores)}`;
      parcelaSel.appendChild(opcao);
    });

    function atualizarImpacto() {
      const parcela = dados.parcelas[Number(parcelaSel.value)] || dados.parcelas[0];
      const novo = lerMoeda(valorCampo.value) || 0;
      const impacto = impactoDoAjuste(parcela.original, parcela.anteriores, novo);
      el('finAjusteOriginal').textContent = formatarMoeda(impacto.original);
      el('finAjusteAnteriores').textContent = formatarMoeda(impacto.anteriores);
      el('finAjusteNovo').textContent = formatarMoeda(impacto.novo);
      el('finAjusteLiquido').textContent = formatarMoeda(impacto.liquido);
      el('finAjusteCms').textContent = formatarMoeda(impacto.cms);
      el('finAjusteRoyalty').textContent = formatarMoeda(impacto.royalty);
      el('finAjusteEstorno').classList.toggle('hidden', !(parcela.comissaoPaga && novo > 0));
      mostrarMensagem('finAjusteMensagem', impacto.liquido < 0 ? 'O ajuste é maior que o valor que resta na parcela.' : '');
    }

    parcelaSel.addEventListener('change', atualizarImpacto);
    ligarCampoMoeda(valorCampo, atualizarImpacto);
    atualizarImpacto();
  }

  function montarProducao() {
    const dados = EXEMPLO.producao;
    el('finProducaoContexto').textContent = `Pedido ${dados.pedido} • ${dados.cliente}`;
    const produtoCampo = el('finProducaoProduto');
    const quantidadeCampo = el('finProducaoQuantidade');
    montarDatalist(el('finProducaoProdutosLista'),
      dados.itens.map(i => ({ valor: `${i.codigo} — ${i.nome}`, rotulo: `${i.pedida - i.finalizada} em aberto` })));

    const itemEscolhido = () => {
      const texto = String(produtoCampo.value).trim().toLowerCase();
      return dados.itens.find(i => `${i.codigo} — ${i.nome}`.toLowerCase() === texto || i.codigo.toLowerCase() === texto) || null;
    };

    function atualizar() {
      const item = itemEscolhido();
      const agora = Number(quantidadeCampo.value) || 0;
      el('finProducaoPedida').textContent = item ? String(item.pedida) : '—';
      el('finProducaoFinalizada').textContent = item ? String(item.finalizada) : '—';
      el('finProducaoSaldo').textContent = item ? String(item.pedida - item.finalizada) : '—';
      if (!item) {
        el('finProducaoStatus').value = '—';
        el('finProducaoAcumulado').textContent = '—';
        el('finProducaoRestante').textContent = '—';
        el('finProducaoConcluido').classList.add('hidden');
        mostrarMensagem('finProducaoMensagem', '');
        return;
      }
      const r = statusAposRegistro(item.pedida, item.finalizada, agora);
      el('finProducaoStatus').value = r.status;
      el('finProducaoAcumulado').textContent = String(r.acumulado);
      el('finProducaoRestante').textContent = String(r.restante);
      el('finProducaoConcluido').classList.toggle('hidden', !(r.restante === 0 && item.pedida > 0));
      mostrarMensagem('finProducaoMensagem', r.excede ? `A quantidade informada passa do saldo (${item.pedida - item.finalizada}).` : '');
    }

    produtoCampo.addEventListener('input', atualizar);
    produtoCampo.addEventListener('change', atualizar);
    quantidadeCampo.addEventListener('input', atualizar);
    atualizar();
  }

  function montarFechamento() {
    montarCompetencias(el('finFechamentoCompetencia'), contexto.competencia);
    const dados = EXEMPLO.fechamento;
    const preencher = (chave, texto) => {
      const alvo = overlay.querySelector(`[data-fin-valor="${chave}"]`);
      if (alvo) alvo.textContent = texto;
    };
    preencher('comissoes.parcelas', String(dados.comissoes.parcelas));
    preencher('comissoes.base', formatarMoeda(dados.comissoes.base));
    preencher('comissoes.comissao', formatarMoeda(dados.comissoes.comissao));
    preencher('comissoes.ajustes', formatarMoeda(dados.comissoes.ajustes));
    preencher('comissoes.total', formatarMoeda(dados.comissoes.total));
    preencher('producao.pecas', String(dados.producao.pecas));
    preencher('producao.pintura', formatarMoeda(dados.producao.pintura));
    preencher('producao.marcenaria', formatarMoeda(dados.producao.marcenaria));
    preencher('producao.total', formatarMoeda(dados.producao.total));

    const alternar = () => {
      const tipo = overlay.querySelector('input[name="finFechamentoTipo"]:checked')?.value || 'comissoes';
      el('finFechamentoResumoComissoes').classList.toggle('hidden', tipo !== 'comissoes');
      el('finFechamentoResumoProducao').classList.toggle('hidden', tipo !== 'producao');
    };
    overlay.querySelectorAll('input[name="finFechamentoTipo"]').forEach(r => r.addEventListener('change', alternar));
    alternar();
  }

  function montarRelatorios() {
    montarCompetencias(el('finRelCompetencia'), contexto.competencia);
    const abas = overlay.querySelectorAll('[data-fin-aba]');
    const paineis = { comissoes: el('finRelPainelComissoes'), producao: el('finRelPainelProducao') };

    abas.forEach(aba => aba.addEventListener('click', () => {
      abas.forEach(outra => {
        const ativa = outra === aba;
        outra.setAttribute('aria-selected', String(ativa));
        outra.classList.toggle('tab-active', ativa);
        outra.classList.toggle('text-gray-400', !ativa);
        outra.classList.toggle('border-transparent', !ativa);
      });
      for (const [chave, painel] of Object.entries(paineis)) {
        const ativa = chave === aba.dataset.finAba;
        painel.classList.toggle('hidden', !ativa);
        if (ativa) {
          const primeira = painel.querySelector('input[name="finRelatorio"]');
          if (primeira && !painel.querySelector('input[name="finRelatorio"]:checked')) primeira.checked = true;
        }
      }
    }));

    const filtro = el('finRelFiltro');
    const alternarFiltro = () => {
      const porPeriodo = filtro.value === 'periodo';
      el('finRelCompetenciaBloco').classList.toggle('hidden', porPeriodo);
      el('finRelPeriodoBloco').classList.toggle('hidden', !porPeriodo);
    };
    filtro.addEventListener('change', alternarFiltro);
    alternarFiltro();
  }

  const montadores = {
    finRegistrarNf: montarRegistrarNf,
    finRegistrarRecebimento: montarRecebimento,
    finRegistrarAjuste: montarAjuste,
    finRegistrarProducao: montarProducao,
    finFecharCompetencia: montarFechamento,
    finRelatorios: montarRelatorios
  };

  try {
    montadores[overlayId]?.();
  } catch (erro) {
    console.error('[financeiro] falha ao montar o modal', overlayId, erro);
  }

  // Revela só depois de montado, como os modais de Pedidos.
  overlay.classList.remove('hidden');
  overlay.removeAttribute('aria-hidden');
  window.Modal?.signalReady?.(overlayId);
})();
