/**
 * Modais do Financeiro — Comissões e Produção.
 *
 * Um script para os modais do módulo: a anatomia é a mesma — Voltar,
 * Cancelar/Fechar e Esc fecham; a ação principal fica no rodapé — e o que
 * muda de um para outro são as contas de conferência e as listas mostradas.
 * Quem abre diz qual é o modal por `window.financeiroModalContexto.overlayId`
 * (ver `finAbrirModal` em financeiro.js), e um modal abre outro por cima
 * (detalhes, relatório, fechamento) pelo mesmo caminho, com `empilhar`.
 *
 * Os modais FISCAIS são reais e falam com /api/fiscal: Configuração fiscal
 * (certificado, SEFAZ, e-mail, inutilização), Pedidos aguardando NF-e
 * (painel + emissão pelo modal dos Pedidos, aberto por cima) e Notas fiscais
 * (lista com DANFE, XML, e-mail, carta de correção, cancelamento e consulta).
 * O relatório "Pedidos aguardando NF" também lê o painel. Comissões e
 * produção (fase G) são reais e falam com /api/financeiro: Registrar ajuste,
 * Registrar produção, Fechar competência, Confirmar pagamento, Relatórios
 * (visualizar, PDF e planilha), Detalhes da parcela e do pedido, Comissões
 * atrasadas, Produção da competência e Regras de comissão e produção. As
 * contas de tela (impacto do ajuste, saldo da produção, aging, totais, CSV)
 * ficam em funções puras, expostas em `window.FinanceiroModais` para os testes.
 *
 * Datas são texto 'YYYY-MM-DD' somadas por Date.UTC: passar pelo relógio local
 * volta um dia em São Paulo. Percentuais de CMS e Royalty vêm das regras (backend).
 */
(() => {
  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const FAIXAS_ATRASO = ['1–15', '16–30', '31–60', '61–90', '+90'];

  const formatoMoeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const centavos = v => Math.round(Number(v || 0) * 100) / 100;

  function formatarMoeda(valor) {
    if (valor === null || valor === undefined || valor === '') return '—';
    const numero = Number(valor);
    if (!Number.isFinite(numero)) return '—';
    return numero < 0 ? `- ${formatoMoeda.format(Math.abs(numero))}` : formatoMoeda.format(numero);
  }

  /** 'R$ 1.234,56', '1234,56', '17.560' ou '1234.56' -> número; vazio -> null. */
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

  function formatarDataCurta(texto) {
    const p = partesDaData(texto);
    return p ? `${String(p.dia).padStart(2, '0')}/${String(p.mes).padStart(2, '0')}` : '—';
  }

  function somarDias(texto, dias) {
    const p = partesDaData(texto);
    if (!p) return null;
    const d = new Date(Date.UTC(p.ano, p.mes - 1, p.dia + Number(dias || 0)));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }

  /** Dias inteiros de `b` até `a` (positivo quando `a` é depois). */
  function diferencaDias(a, b) {
    const pa = partesDaData(a);
    const pb = partesDaData(b);
    if (!pa || !pb) return null;
    return Math.round((Date.UTC(pa.ano, pa.mes - 1, pa.dia) - Date.UTC(pb.ano, pb.mes - 1, pb.dia)) / 86400000);
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

  function rotuloCompetenciaCurto(valor) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(valor || ''));
    return m ? `${MESES[Number(m[2]) - 1]}/${m[1]}` : '—';
  }

  function hojeLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function competenciaAtual() {
    return hojeLocal().slice(0, 7);
  }

  /** Competências de 12 meses atrás a 3 à frente; `selecionada` é 'YYYY-MM'. */
  /**
   * O seletor de competência do modal: mês (nomes), ano (2025–2100, também
   * digitável) e a lupa que entra no mês (src/js/utils/competencia.js). Só a
   * lupa (ou Enter no ano) muda o valor e dispara o `change` — escolher não
   * relê nada. `vazio` cria a opção "Todas" nas listas que filtram por mês.
   */
  function montarCompetencias(campo, selecionada, { vazio = '' } = {}) {
    if (!campo) return;
    const alvo = /^\d{4}-\d{2}$/.test(String(selecionada || '')) ? selecionada : competenciaAtual();
    if (window.Competencia) {
      window.Competencia.montar(campo, { valor: alvo, vazio });
      return;
    }
    // Sem o utilitário (HTML antigo): o valor ainda vale, e a leitura funciona.
    campo.value = alvo;
  }

  /** Muda a competência do modal por fora (pendência, "Hoje", filtro "Todas"). */
  function definirCompetencia(campo, valor) {
    if (!campo) return;
    if (window.Competencia) window.Competencia.definir(campo, valor);
    else campo.value = valor;
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
      const valorCentavos = base + (sobra > 0 ? 1 : 0);
      if (sobra > 0) sobra -= 1;
      return {
        numero: i + 1,
        total: n,
        prazo: Number(prazo) || 0,
        vencimento: somarDias(emissao, Number(prazo) || 0),
        valor: valorCentavos / 100
      };
    });
  }

  function lerPrazos(condicao) {
    const texto = String(condicao ?? '').trim();
    if (!texto) return null;
    const dias = texto.split('/').map(p => Number(p.trim()));
    return dias.every(d => Number.isFinite(d) && d >= 0) ? dias : null;
  }

  /**
   * Impacto de um ajuste numa parcela (a linha de GET /api/financeiro/parcelas):
   * valor líquido e comissão antes e depois, com os percentuais da parcela
   * (os do fechamento, se ela já foi fechada). Espelho de
   * backend/financeiro/ajustes.js: cada beneficiário arredondado, depois somado.
   */
  function impactoDoAjuste(parcela, valor) {
    const p = parcela || {};
    const novo = Number(valor || 0);
    const liquidoAntes = centavos(p.liquido);
    const liquido = centavos(Math.max(0, liquidoAntes - novo));
    const taxas = p.taxas || {};
    const parte = regras => centavos((regras || []).reduce((s, r) => s + centavos(liquido * (Number(r.percentual) || 0) / 100), 0));
    return {
      original: centavos(p.valor_original),
      anteriores: centavos(-(Number(p.ajustes_total || 0) + Number(p.abatimento_boleto || 0))),
      novo: centavos(-novo),
      liquido_antes: liquidoAntes,
      liquido,
      cms: parte(taxas.cms),
      royalty: parte(taxas.royalty),
      pct_cms: Number(taxas.pct_cms) || 0,
      pct_royalty: Number(taxas.pct_royalty) || 0,
      excede: novo > liquidoAntes,
      gera_estorno: Boolean(p.comissao_fechada) && p.estado_parcela === 'recebida'
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

  /**
   * O valor das próximas `quantidade` peças num processo: o valor da peça
   * inteira vezes a parte do processo que falta em cada uma (`proximas`, do
   * backend — a do estoque adiantada vale menos que 1). null sem regra.
   */
  function valorDasProximas(doProcesso, quantidade) {
    if (!doProcesso || doProcesso.valor_unitario === null || doProcesso.valor_unitario === undefined) return null;
    const partes = (doProcesso.proximas || []).slice(0, Math.max(0, Number(quantidade) || 0));
    return centavos(Number(doProcesso.valor_unitario) * partes.reduce((s, f) => s + (Number(f) || 0), 0));
  }

  function faixaDeAtraso(dias) {
    const d = Number(dias) || 0;
    if (d <= 15) return '1–15';
    if (d <= 30) return '16–30';
    if (d <= 60) return '31–60';
    if (d <= 90) return '61–90';
    return '+90';
  }

  /** Totais das parcelas atrasadas (linhas com `liquido` e `comissao`). */
  function resumoAtrasadas(linhas) {
    return (linhas || []).reduce((r, l) => ({
      quantidade: r.quantidade + 1,
      liquido: centavos(r.liquido + Number(l.liquido || 0)),
      comissao: centavos(r.comissao + Number(l.comissao || 0))
    }), { quantidade: 0, liquido: 0, comissao: 0 });
  }

  /** Aging sempre com as 5 faixas, mesmo vazias. */
  function agingDe(linhas) {
    return FAIXAS_ATRASO.map(faixa => {
      const da = (linhas || []).filter(l => (l.faixa || faixaDeAtraso(l.dias)) === faixa);
      return {
        faixa,
        parcelas: da.length,
        liquido: centavos(da.reduce((s, l) => s + Number(l.liquido || 0), 0)),
        comissao: centavos(da.reduce((s, l) => s + Number(l.comissao || 0), 0))
      };
    });
  }

  /** Os cartões do topo da Produção da competência: peças, pedidos, um por setor, total (e o que fica a compensar). */
  /**
   * PEÇAS e PROCESSOS são números diferentes, e confundi-los foi o defeito
   * que o dono pegou em 24/09/2026: 2 peças que passam por 4 processos cada
   * são 8 linhas de pagamento, mas continuam sendo 2 peças.
   */
  function indicadoresDaProducao(d) {
    const processos = Number(d?.processos ?? d?.contagem?.processos) || 0;
    const lista = [
      {
        rotulo: 'Peças finalizadas', valor: String(Number(d?.pecas ?? d?.contagem?.pecas) || 0),
        nota: processos ? `${processos} ${processos === 1 ? 'processo pago' : 'processos pagos'}` : ''
      },
      { rotulo: 'Processos pagos', valor: String(processos) },
      { rotulo: 'Pedidos envolvidos', valor: String(Number(d?.pedidos) || 0) },
      ...((d?.setores) || []).map(s => ({ rotulo: s.setor, valor: formatarMoeda(s.total) })),
      { rotulo: d?.fechado ? 'Total a pagar (fechado)' : 'Total a pagar', valor: formatarMoeda(d?.a_pagar ?? 0), destaque: true }
    ];
    if (Number(d?.a_compensar) < 0) lista.push({ rotulo: 'A compensar', valor: formatarMoeda(d.a_compensar), atencao: true });
    return lista;
  }

  /** '10' -> '10%', '7.5' -> '7,5%'. */
  function percentualTexto(valor) {
    const n = Number(valor);
    if (!Number.isFinite(n)) return '—';
    return `${String(Math.round(n * 10000) / 10000).replace('.', ',')}%`;
  }

  const SITUACOES_PARCELA = {
    prevista: 'Aberta', atrasada: 'Atrasada', apurada: 'Liquidada', fechada: 'Fechada', paga: 'Paga',
    nao_realizada: 'Cancelada', a_lancar: 'A lançar'
  };
  const TIPOS_AJUSTE = { devolucao: 'Devolução', desconto: 'Desconto comercial', abatimento: 'Abatimento', cancelamento: 'Cancelamento parcial', outros: 'Outros' };
  const TIPOS_REGRA = { cms: 'CMS', royalty: 'Royalty' };

  /** Parcelas para o ajuste: pedido, cliente ou NF contendo o texto. */
  function filtrarParcelasAjuste(linhas, busca = '') {
    const termo = String(busca || '').trim().toLowerCase();
    return (linhas || []).filter(l => !termo
      || String(l.pedido ?? '').toLowerCase().includes(termo)
      || String(l.cliente ?? '').toLowerCase().includes(termo)
      || String(l.nf ?? '').toLowerCase().includes(termo));
  }

  function rotuloDaParcelaAjuste(l) {
    return [
      `Pedido ${l.pedido}`,
      `parcela ${l.parcela || l.numero_parcela}`,
      l.cliente || null,
      `venc. ${formatarData(l.vencimento)}`,
      `líquido ${formatarMoeda(l.liquido)}`,
      SITUACOES_PARCELA[l.situacao] || null
    ].filter(Boolean).join(' • ');
  }

  /** "Vale para" de uma regra de comissão. */
  function alcanceDaRegra(r) {
    if (r?.escopo === 'cliente') return `Cliente: ${r.alvo || r.cliente_id}`;
    if (r?.escopo === 'pedido') return r.alvo || `Pedido ${r.pedido_id}`;
    return 'Todos os pedidos';
  }

  /** O valor de uma célula como texto de planilha (número com vírgula, sem R$). */
  function valorParaPlanilha(valor, tipo) {
    if (valor === null || valor === undefined || valor === '') return '';
    if (tipo === 'moeda') return Number(valor).toFixed(2).replace('.', ',');
    if (tipo === 'inteiro') return String(Number(valor) || 0);
    if (tipo === 'data') return formatarData(valor);
    return String(valor);
  }

  /**
   * O relatório como planilha CSV para o Excel: ponto e vírgula, BOM UTF-8,
   * aspas quando precisa, e a linha de totais no fim.
   */
  function relatorioEmCsv(relatorio) {
    const campo = t => (/[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
    const linhas = [relatorio.colunas.map(c => campo(c.rotulo)).join(';')];
    for (const l of relatorio.linhas) {
      linhas.push(relatorio.colunas.map(c => campo(valorParaPlanilha(l[c.chave], c.tipo === 'pedido' || c.tipo === 'pedido-real' ? 'texto' : c.tipo))).join(';'));
    }
    linhas.push(relatorio.colunas.map((c, i) => {
      if (i === 0) return campo(`Total (${relatorio.linhas.length})`);
      return c.total ? campo(valorParaPlanilha(relatorio.totais[c.chave], c.tipo)) : '';
    }).join(';'));
    return `\uFEFF${linhas.join('\r\n')}\r\n`;
  }

  // ------------------------------------------------ NF-e (funções puras)

  /** Como cada situação da nota aparece: rótulo, cor e o grupo do filtro. */
  const STATUS_NOTA = {
    autorizada: { rotulo: 'Autorizada', badge: 'badge-success', grupo: 'autorizada' },
    cancelada: { rotulo: 'Cancelada', badge: 'badge-danger', grupo: 'cancelada' },
    processando: { rotulo: 'Aguardando a SEFAZ', badge: 'badge-warning', grupo: 'processando' },
    enviando: { rotulo: 'Enviada, sem resposta', badge: 'badge-warning', grupo: 'processando' },
    cancelamento_pendente: { rotulo: 'Cancelamento pendente', badge: 'badge-warning', grupo: 'processando' },
    rejeitada: { rotulo: 'Rejeitada', badge: 'badge-danger', grupo: 'rejeitada' },
    denegada: { rotulo: 'Denegada', badge: 'badge-danger', grupo: 'rejeitada' },
    erro_tecnico: { rotulo: 'Erro técnico', badge: 'badge-danger', grupo: 'rejeitada' },
    rascunho: { rotulo: 'Rascunho', badge: 'badge-neutral', grupo: 'rascunho' }
  };

  function rotuloStatusNota(status) {
    return STATUS_NOTA[String(status || '')] || { rotulo: String(status || '—'), badge: 'badge-neutral', grupo: 'outro' };
  }

  /**
   * Filtra as notas da lista: competência ('YYYY-MM' ou '' = todas), grupo da
   * situação, ambiente e busca (nº da nota, do pedido, cliente ou chave).
   * Rascunho nunca aparece: é só um número reservado que a emissão reaproveita.
   */
  function filtrarNotas(notas, { competencia = '', status = '', ambiente = '', busca = '' } = {}) {
    const termo = String(busca || '').trim().toLowerCase();
    return (Array.isArray(notas) ? notas : []).filter(n => {
      if (!n || n.status_fiscal === 'rascunho') return false;
      if (competencia && !String(n.data_emissao || '').startsWith(competencia)) return false;
      if (status && rotuloStatusNota(n.status_fiscal).grupo !== status) return false;
      if (ambiente && n.ambiente !== ambiente) return false;
      if (termo) {
        const alvos = [n.numero, n.pedido_numero, n.cliente, n.chave_acesso].map(v => String(v ?? '').toLowerCase());
        if (!alvos.some(v => v.includes(termo))) return false;
      }
      return true;
    });
  }

  /** Indicadores da lista de notas (sobre as já filtradas por competência e ambiente). */
  function resumoDeNotas(notas) {
    const lista = Array.isArray(notas) ? notas : [];
    return {
      emitidas: lista.length,
      autorizadas: lista.filter(n => n.status_fiscal === 'autorizada').length,
      canceladas: lista.filter(n => n.status_fiscal === 'cancelada').length,
      valor: centavos(lista.filter(n => n.status_fiscal === 'autorizada').reduce((s, n) => s + Number(n.valor_total || 0), 0))
    };
  }

  /** "3x · Boleto", "À vista · Pix": a condição do pedido que aguarda nota. */
  function condicaoDoPedido(linha) {
    const n = Number(linha?.parcelas) || 0;
    const base = n > 1 ? `${n}x` : 'À vista';
    return linha?.forma_pagamento ? `${base} · ${linha.forma_pagamento}` : base;
  }

  /** As linhas de "aguardando NF-e" do painel: sem os dispensados (a não ser que se peça) e pela busca. */
  function linhasAguardando(painel, { incluirDispensados = false, busca = '' } = {}) {
    const termo = String(busca || '').trim().toLowerCase();
    return (painel?.aguardando_nf?.pedidos || []).filter(l => l
      && (incluirDispensados || !l.dispensada)
      && (!termo || [l.numero, l.cliente].some(v => String(v ?? '').toLowerCase().includes(termo))));
  }

  /**
   * Prévia dos encargos de um boleto de `valor` pela configuração da tela —
   * a mesma conta do backend (juros por dia = taxa mensal ÷ 30 sobre o
   * bruto; multa sobre o bruto). Pura: os campos chegam como texto.
   */
  function previaDeEncargos(valor, cfg = {}) {
    const bruto = centavos(valor);
    const numero = v => Number(String(v ?? '').replace(',', '.'));
    const partes = [];
    const taxa = numero(cfg.juros_percentual_mes) || 0;
    if (cfg.juros_tipo === 'valor_dia' && taxa > 0) partes.push(`juros de ${formatarMoeda(centavos(bruto * taxa / 100 / 30))} por dia de atraso (${String(taxa).replace('.', ',')}% ao mês)`);
    else if (cfg.juros_tipo === 'percentual_mes' && taxa > 0) partes.push(`juros de ${String(taxa).replace('.', ',')}% ao mês`);
    else partes.push('sem juros');
    const multa = numero(cfg.multa_percentual) || 0;
    partes.push(multa > 0 ? `multa de ${formatarMoeda(centavos(bruto * multa / 100))} (${String(multa).replace('.', ',')}%)` : 'sem multa');
    const protesto = cfg.protesto_dias === '' || cfg.protesto_dias === null || cfg.protesto_dias === undefined ? NaN : Number(cfg.protesto_dias);
    partes.push(Number.isFinite(protesto) ? `protesto ${protesto} dias após o vencimento` : 'sem protesto');
    const limite = Number(cfg.dias_limite_recebimento) || 0;
    partes.push(limite > 0 ? `pagável até ${limite} dias depois de vencido` : 'não aceita pagamento depois de vencido');
    return `Num boleto de ${formatarMoeda(bruto)}: ${partes.join(' · ')}.`;
  }

  /** O relatório "Pedidos aguardando NF" a partir do painel (só os que contam). */
  function linhasDoRelatorioAguardando(painel) {
    return linhasAguardando(painel).map(l => ({
      pedido: l.numero, pedido_id: l.pedido_id, cliente: l.cliente || '—', entrega: l.enviado_em,
      condicao: condicaoDoPedido(l), dias: l.dias_sem_nfe, valor: l.valor
    }));
  }

  // ------------------------------------------ contas a receber (reais)

  const ORIGENS_RECEBIMENTO = { boleto: 'Boleto pago', quitado_por_fora: 'Quitado por fora', manual: 'À mão' };
  const BOLETO_A_PAGAR = ['registrado', 'vencido', 'protestado'];
  const MOTIVOS_BAIXA_BOLETO = { quitado_por_fora: 'quitado por fora', cancelado: 'cancelado', reemissao: 'reemissão', banco: 'pelo banco', quitacao_estornada: 'quitação estornada' };
  const semAcento = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  /** A tag do boleto de uma parcela a receber. */
  function rotuloBoletoDaParcela(boleto) {
    if (!boleto) return { texto: 'Sem boleto', badge: 'badge-neutral' };
    const s = String(boleto.status || '');
    if (s === 'registrado') return { texto: 'Boleto registrado', badge: 'badge-success' };
    if (s === 'vencido') return { texto: 'Boleto vencido', badge: 'badge-warning' };
    if (s === 'protestado') return { texto: 'Boleto em protesto', badge: 'badge-danger' };
    if (s === 'erro') return { texto: 'Boleto recusado', badge: 'badge-danger' };
    if (s === 'pago') return { texto: 'Boleto pago', badge: 'badge-success' };
    if (s === 'baixado') return { texto: `Boleto baixado${MOTIVOS_BAIXA_BOLETO[boleto.motivo_baixa] ? ` (${MOTIVOS_BAIXA_BOLETO[boleto.motivo_baixa]})` : ''}`, badge: 'badge-neutral' };
    return { texto: `Boleto ${s}`, badge: 'badge-neutral' };
  }

  const boletoEmAberto = boleto => Boolean(boleto && BOLETO_A_PAGAR.includes(String(boleto.status)));

  /** Filtra as linhas de uma visão: busca por pedido, cliente ou NF; nas de parcela, pelo boleto. */
  function filtrarRecebimentos(linhas, { visao = 'recebidos', boleto = '', busca = '' } = {}) {
    const termo = semAcento(busca).trim();
    return (Array.isArray(linhas) ? linhas : []).filter(l => {
      if (termo && ![l.pedido, l.cliente, l.nf].some(v => semAcento(v).includes(termo))) return false;
      if (visao === 'recebidos' || !boleto) return true;
      if (boleto === 'aberto') return boletoEmAberto(l.boleto);
      if (boleto === 'sem') return !boletoEmAberto(l.boleto);
      if (boleto === 'erro') return l.boleto?.status === 'erro';
      return true;
    });
  }

  /** O total da lista: o recebido (só confirmados) ou o que falta receber. */
  function totalDaVisao(linhas, visao) {
    const lista = Array.isArray(linhas) ? linhas : [];
    if (visao === 'recebidos') return centavos(lista.filter(l => l.status === 'confirmado').reduce((s, l) => s + Number(l.valor || 0), 0));
    return centavos(lista.reduce((s, l) => s + Number(l.a_receber || 0), 0));
  }

  /** O texto de cada parcela no seletor de "Registrar recebimento". */
  function rotuloDaParcelaAberta(l) {
    const partes = [`Pedido ${l.pedido}`, l.cliente || 'sem cliente', `parcela ${l.parcela || l.numero_parcela}`, `vence ${formatarData(l.vencimento)}`, formatarMoeda(l.a_receber)];
    if (Number(l.dias_atraso) > 0) partes.push(`${l.dias_atraso} dias em atraso`);
    if (boletoEmAberto(l.boleto)) partes.push('boleto em aberto');
    if (l.controlada === false) partes.push('antes do controle');
    return partes.join(' · ');
  }

  /** O quadro de "Registrar recebimento": devido, recebido, diferença (juros/multa ou desconto) e competência. */
  function resumoDoRecebimento({ devido, recebido, data }) {
    const d = devido === null || devido === undefined ? null : centavos(devido);
    const r = recebido === null || recebido === undefined ? null : centavos(recebido);
    const diferenca = d === null || r === null ? null : centavos(r - d);
    return {
      devido: d,
      recebido: r,
      diferenca,
      rotuloDiferenca: diferenca === null || diferenca === 0 ? 'Diferença' : (diferenca > 0 ? 'Recebido a mais (juros, multa)' : 'Recebido a menos (desconto)'),
      competencia: competenciaDe(data)
    };
  }

  /** A tag de cada situação de aviso do BB (webhook). */
  const BADGE_DO_AVISO = { 'conciliado': 'badge-success', 'na fila': 'badge-warning', 'na fila (erro)': 'badge-danger', 'alerta': 'badge-danger', 'ignorado': 'badge-neutral' };

  /** O resultado de POST /api/cobranca/conciliar em uma frase, e os erros à parte. */
  function textoDaConciliacao(r, soFila = false) {
    if (r?.sql_pendente) return { texto: 'Os recebimentos ainda não estão ativados: rode sql/cobranca_recebimentos.sql e reinicie a API.', erros: [] };
    const f = r?.fila || {};
    const c = r?.consultas || {};
    const a = r?.acerto || {};
    const partes = [`${Number(f.lidos) || 0} aviso(s) do BB lido(s)`];
    if (Number(f.pagos)) partes.push(`${f.pagos} pagamento(s)`);
    if (Number(f.cancelados)) partes.push(`${f.cancelados} cancelamento(s)`);
    if (Number(f.ignorados)) partes.push(`${f.ignorados} ignorado(s)`);
    if (Number(f.alertas)) partes.push(`${f.alertas} alerta(s)`);
    if (!soFila) {
      partes.push(`${Number(c.consultados) || 0} boleto(s) consultado(s)`);
      if (Number(c.pagos)) partes.push(`${c.pagos} pago(s) na consulta`);
      if (Number(a.lancados)) partes.push(`${a.lancados} recebimento(s) lançado(s)`);
    }
    return { texto: `${partes.join(' · ')}.`, erros: [...(f.mensagens || []), ...(c.mensagens || []), ...(a.mensagens || [])] };
  }

  // --------------------------------------------------------- relatórios

  /**
   * Colunas de cada relatório. As linhas vêm do backend
   * (GET /api/financeiro/relatorios/:chave; "aguardando-nf", do painel fiscal)
   * e os totais são somados aqui. `pedido` abre os Detalhes do pedido;
   * `pedido-real`, o Visualizar pedido dos Pedidos.
   */
  /**
   * Pagamento de um processo: cada linha é um registro, com o valor da peça
   * inteira e o total (a peça do estoque adiantada paga só a parte que faltava).
   */
  const pagamentoDoProcesso = nome => ({
    titulo: `Pagamento ${nome.toLowerCase()}`,
    colunas: [
      { chave: 'pedido', rotulo: 'Pedido', tipo: 'pedido' },
      { chave: 'produto', rotulo: 'Produto', tipo: 'produto' },
      { chave: 'data', rotulo: 'Finalização', tipo: 'data' },
      { chave: 'quantidade', rotulo: 'Quantidade', tipo: 'inteiro', total: true },
      { chave: 'valor_peca', rotulo: 'Peça inteira', tipo: 'moeda' },
      { chave: 'regra', rotulo: 'Regra' },
      { chave: 'total', rotulo: 'Total', tipo: 'moeda', total: true }
    ]
  });

  const RELATORIOS = {
    // Previsto no mês = previstas + atrasadas (a atrasada passa para os meses
    // seguintes até ser paga — decisão do dono, 24/09/2026).
    'previsao-comissoes': {
      titulo: 'Previsão de comissões',
      colunas: [
        { chave: 'pedido', rotulo: 'Pedido', tipo: 'pedido' },
        { chave: 'cliente', rotulo: 'Cliente' },
        { chave: 'nf', rotulo: 'NF' },
        { chave: 'parcela', rotulo: 'Parcela' },
        { chave: 'vencimento', rotulo: 'Vencimento', tipo: 'data' },
        { chave: 'situacao', rotulo: 'Situação' },
        { chave: 'liquido', rotulo: 'Valor líquido', tipo: 'moeda', total: true },
        { chave: 'cms', rotulo: 'CMS', tipo: 'moeda', total: true },
        { chave: 'royalty', rotulo: 'Royalty', tipo: 'moeda', total: true },
        { chave: 'comissao', rotulo: 'Comissão prevista', tipo: 'moeda', total: true },
        { chave: 'beneficiarios', rotulo: 'Quem recebe', tipo: 'beneficiarios' }
      ]
    },
    'comissoes-atrasadas': {
      titulo: 'Comissões atrasadas',
      colunas: [
        { chave: 'pedido', rotulo: 'Pedido', tipo: 'pedido' },
        { chave: 'cliente', rotulo: 'Cliente' },
        { chave: 'nf', rotulo: 'NF' },
        { chave: 'parcela', rotulo: 'Parcela' },
        { chave: 'vencimento', rotulo: 'Vencimento', tipo: 'data' },
        { chave: 'dias', rotulo: 'Dias em atraso', tipo: 'inteiro' },
        { chave: 'liquido', rotulo: 'Valor líquido', tipo: 'moeda', total: true },
        { chave: 'cms', rotulo: 'CMS potencial', tipo: 'moeda', total: true },
        { chave: 'royalty', rotulo: 'Royalty', tipo: 'moeda', total: true },
        { chave: 'comissao', rotulo: 'Comissão potencial', tipo: 'moeda', total: true },
        { chave: 'beneficiarios', rotulo: 'Quem recebe', tipo: 'beneficiarios' }
      ]
    },
    'comissoes-apuradas': {
      titulo: 'Comissões apuradas',
      colunas: [
        { chave: 'pedido', rotulo: 'Pedido', tipo: 'pedido' },
        { chave: 'cliente', rotulo: 'Cliente' },
        { chave: 'nf', rotulo: 'NF' },
        { chave: 'parcela', rotulo: 'Parcela' },
        { chave: 'liquidacao', rotulo: 'Liquidação', tipo: 'data' },
        { chave: 'liquido', rotulo: 'Valor líquido', tipo: 'moeda', total: true },
        { chave: 'cms', rotulo: 'CMS', tipo: 'moeda', total: true },
        { chave: 'royalty', rotulo: 'Royalty', tipo: 'moeda', total: true },
        { chave: 'comissao', rotulo: 'Total comissão', tipo: 'moeda', total: true },
        { chave: 'beneficiarios', rotulo: 'Quem recebe', tipo: 'beneficiarios' }
      ]
    },
    'ajustes-anteriores': {
      titulo: 'Ajustes de períodos anteriores',
      colunas: [
        { chave: 'data', rotulo: 'Data', tipo: 'data' },
        { chave: 'pedido', rotulo: 'Pedido', tipo: 'pedido' },
        { chave: 'cliente', rotulo: 'Cliente' },
        { chave: 'parcela', rotulo: 'Parcela' },
        { chave: 'motivo', rotulo: 'Motivo' },
        { chave: 'origem', rotulo: 'Competência de origem' },
        { chave: 'cms', rotulo: 'CMS', tipo: 'moeda', total: true },
        { chave: 'royalty', rotulo: 'Royalty', tipo: 'moeda', total: true },
        { chave: 'valor', rotulo: 'Valor', tipo: 'moeda', total: true },
        { chave: 'beneficiarios', rotulo: 'Quem recebe', tipo: 'beneficiarios' }
      ]
    },
    'comissoes-nao-realizadas': {
      titulo: 'Comissões não realizadas',
      colunas: [
        { chave: 'data', rotulo: 'Data', tipo: 'data' },
        { chave: 'pedido', rotulo: 'Pedido', tipo: 'pedido' },
        { chave: 'cliente', rotulo: 'Cliente' },
        { chave: 'nf', rotulo: 'NF' },
        { chave: 'parcela', rotulo: 'Parcela' },
        { chave: 'motivo', rotulo: 'Motivo' },
        { chave: 'liquido', rotulo: 'Valor que saiu da base', tipo: 'moeda', total: true },
        { chave: 'comissao', rotulo: 'Comissão não realizada', tipo: 'moeda', total: true }
      ]
    },
    'producao-competencia': {
      titulo: 'Produção da competência',
      colunas: [
        { chave: 'pedido', rotulo: 'Pedido', tipo: 'pedido' },
        { chave: 'data', rotulo: 'Finalização', tipo: 'data' },
        { chave: 'produto', rotulo: 'Produto', tipo: 'produto' },
        { chave: 'setor', rotulo: 'Processo' },
        { chave: 'quantidade', rotulo: 'Quantidade', tipo: 'inteiro', total: true },
        { chave: 'unitario', rotulo: 'Valor por peça (média)', tipo: 'moeda' },
        { chave: 'total', rotulo: 'Total', tipo: 'moeda', total: true },
        { chave: 'status', rotulo: 'Status' }
      ]
    },
    'pagamento-marcenaria': pagamentoDoProcesso('Marcenaria'),
    'pagamento-acabamento': pagamentoDoProcesso('Acabamento'),
    'pagamento-montagem': pagamentoDoProcesso('Montagem'),
    'pagamento-embalagem': pagamentoDoProcesso('Embalagem'),
    'producao-por-pedido': {
      titulo: 'Produção por pedido',
      colunas: [
        { chave: 'pedido', rotulo: 'Pedido', tipo: 'pedido' },
        { chave: 'cliente', rotulo: 'Cliente' },
        { chave: 'pecas', rotulo: 'Peças', tipo: 'inteiro', total: true },
        { chave: 'marcenaria', rotulo: 'Marcenaria', tipo: 'moeda', total: true },
        { chave: 'acabamento', rotulo: 'Acabamento', tipo: 'moeda', total: true },
        { chave: 'montagem', rotulo: 'Montagem', tipo: 'moeda', total: true },
        { chave: 'embalagem', rotulo: 'Embalagem', tipo: 'moeda', total: true },
        { chave: 'outros', rotulo: 'Outros processos', tipo: 'moeda', total: true },
        { chave: 'total', rotulo: 'Total', tipo: 'moeda', total: true }
      ]
    },
    // Fiscal: as linhas vêm do painel fiscal; o número abre o Visualizar pedido de verdade.
    'aguardando-nf': {
      titulo: 'Pedidos aguardando NF-e',
      colunas: [
        { chave: 'pedido', rotulo: 'Pedido', tipo: 'pedido-real' },
        { chave: 'cliente', rotulo: 'Cliente' },
        { chave: 'entrega', rotulo: 'Enviado em', tipo: 'data' },
        { chave: 'condicao', rotulo: 'Condição' },
        { chave: 'dias', rotulo: 'Dias sem NF-e', tipo: 'inteiro' },
        { chave: 'valor', rotulo: 'Valor', tipo: 'moeda', total: true }
      ]
    }
  };

  /** Relatórios de comissão: a linha leva à parcela. */
  const RELATORIOS_DE_PARCELA = new Set(['previsao-comissoes', 'comissoes-atrasadas', 'comissoes-apuradas', 'ajustes-anteriores', 'comissoes-nao-realizadas']);

  /** O relatório pronto para a tela: as linhas dadas e a linha de totais. */
  function montarRelatorio(chave, extra = {}) {
    const def = RELATORIOS[chave];
    if (!def) return null;
    const linhas = Array.isArray(extra.linhas) ? extra.linhas : [];
    const totais = {};
    for (const c of def.colunas) {
      if (c.total) totais[c.chave] = c.tipo === 'inteiro'
        ? linhas.reduce((s, l) => s + Number(l[c.chave] || 0), 0)
        : centavos(linhas.reduce((s, l) => s + Number(l[c.chave] || 0), 0));
    }
    return { chave, titulo: def.titulo, colunas: def.colunas, linhas, totais };
  }

  const chaveDoBeneficiario = nome => semAcento(nome).trim();

  /**
   * As duas primeiras células de uma linha de "quem recebe": o tipo como
   * etiqueta (CMS preenchida, Royalty vazada) e a pessoa com a cor dela — a
   * mesma cor em todas as telas (src/js/utils/beneficiarios.js).
   */
  function celulasDeBeneficiario(b) {
    const tipo = criar('td', 'px-4 py-3 text-left');
    tipo.appendChild(criar('span', `fin-etiqueta-benef__tipo fin-etiqueta-benef__tipo--${b.tipo === 'royalty' ? 'royalty' : 'cms'}`, TIPOS_REGRA[b.tipo] || b.tipo));
    const quem = criar('td', 'px-4 py-3 text-left text-white');
    const caixa = criar('div', 'fin-benef__nome');
    if (window.Beneficiarios) caixa.appendChild(window.Beneficiarios.ponto(b.beneficiario));
    caixa.appendChild(criar('span', null, b.beneficiario || '—'));
    quem.appendChild(caixa);
    return [tipo, quem];
  }

  /** A legenda (CMS = dono do cliente, Royalty = desenhista) embaixo de uma tabela. */
  function pintarLegendaBenef(id, lista = []) {
    const alvo = el(id);
    if (!alvo) return;
    if (!window.Beneficiarios || !lista.length) { alvo.replaceChildren(); return; }
    alvo.replaceChildren(window.Beneficiarios.legenda([]));
  }

  /** As opções do filtro "quem recebe": os tipos e as pessoas que aparecem nas linhas. */
  function opcoesDeBeneficiario(linhas) {
    const pessoas = new Map();
    const tipos = new Set();
    for (const l of linhas) {
      for (const b of l.benef_lista || []) {
        if (!b?.beneficiario) continue;
        tipos.add(b.tipo === 'royalty' ? 'royalty' : 'cms');
        const k = chaveDoBeneficiario(b.beneficiario);
        if (!pessoas.has(k)) pessoas.set(k, b.beneficiario);
      }
    }
    return {
      tipos: ['cms', 'royalty'].filter(t => tipos.has(t)),
      pessoas: [...pessoas].map(([chave, nome]) => ({ chave, nome })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    };
  }

  /**
   * Filtro por quem recebe ('tipo:cms', 'tipo:royalty' ou 'pessoa:<chave>'):
   * ficam só as linhas em que a pessoa (ou o tipo) tem parte, e os valores
   * passam a ser a parte dela — assim o total do relatório bate com o filtro.
   */
  function filtrarPorBeneficiario(linhas, filtro) {
    if (!filtro) return linhas;
    const [campo, valor] = String(filtro).split(':');
    const cabe = b => (campo === 'tipo'
      ? (b.tipo === 'royalty' ? 'royalty' : 'cms') === valor
      : chaveDoBeneficiario(b.beneficiario) === valor);
    const saida = [];
    for (const l of linhas) {
      const lista = (l.benef_lista || []).filter(cabe);
      if (!lista.length) continue;
      const somaDe = royalty => centavos(lista
        .filter(b => (b.tipo === 'royalty') === royalty)
        .reduce((s, b) => s + (Number(b.valor) || 0), 0));
      const cms = somaDe(false);
      const royalty = somaDe(true);
      const total = centavos(cms + royalty);
      const linha = { ...l, benef_lista: lista, cms, royalty, beneficiarios: lista.map(b => `${b.beneficiario}${b.percentual == null ? '' : ` ${percentualTexto(b.percentual)}`}`).join(' · ') };
      if (l.comissao !== undefined) linha.comissao = total;
      if (l.valor !== undefined) linha.valor = total;
      saida.push(linha);
    }
    return saida;
  }

  const rotuloDoFiltroBenef = (filtro, opcoes) => {
    if (!filtro) return '';
    const [campo, valor] = String(filtro).split(':');
    if (campo === 'tipo') return valor === 'royalty' ? 'Royalty' : 'CMS';
    return opcoes.pessoas.find(p => p.chave === valor)?.nome || valor;
  };

  // ------------------------------------------------------------ atividade (puras)

  /** Os tipos do histórico em grupos (a etiqueta e o filtro "Tipo"). */
  const GRUPOS_ATIVIDADE = {
    nfe: { rotulo: 'NF-e', badge: 'badge-info', icone: 'fa-file-invoice' },
    ajuste: { rotulo: 'Ajustes', badge: 'badge-warning', icone: 'fa-undo' },
    producao: { rotulo: 'Produção', badge: 'badge-info', icone: 'fa-hammer' },
    fechamento: { rotulo: 'Fechamentos', badge: 'badge-neutral', icone: 'fa-lock' },
    pagamento: { rotulo: 'Pagamentos', badge: 'badge-success', icone: 'fa-check-circle' },
    regra: { rotulo: 'Regras e prazos', badge: 'badge-neutral', icone: 'fa-percent' },
    devolucao: { rotulo: 'Devoluções', badge: 'badge-danger', icone: 'fa-undo-alt' }
  };

  /** O grupo de um tipo do histórico do Financeiro ou da SEFAZ. Pura. */
  function grupoDaAtividade(tipo, fiscal = false) {
    const t = String(tipo || '');
    if (fiscal) return 'nfe';
    if (t.startsWith('ajuste')) return 'ajuste';
    if (t.startsWith('producao')) return 'producao';
    if (t === 'competencia_fechada') return 'fechamento';
    if (t === 'pagamento_confirmado' || t === 'reembolso_confirmado') return 'pagamento';
    if (t === 'devolucao_registrada') return 'devolucao';
    return 'regra';
  }

  const ETIQUETA_FISCAL = {
    autorizada: ['NF-e autorizada', 'badge-success'], cancelada: ['NF-e cancelada', 'badge-danger'],
    rejeitada: ['NF-e recusada', 'badge-danger'], processando: ['NF-e na SEFAZ', 'badge-info'], cce: ['Carta de correção', 'badge-warning']
  };

  /**
   * O histórico do Financeiro e o da SEFAZ numa linha só, do mais novo para o
   * mais antigo, cada um com quem fez (o da SEFAZ é o sistema). Pura.
   */
  function juntarAtividade(financeiro = [], fiscal = []) {
    const itens = [
      ...financeiro.map(e => ({
        id: `f${e.id}`, quando: e.quando, grupo: grupoDaAtividade(e.tipo),
        etiqueta: e.rotulo || e.tipo, badge: GRUPOS_ATIVIDADE[grupoDaAtividade(e.tipo)].badge,
        texto: e.descricao || e.rotulo || '', valor: e.valor ?? null,
        usuario_id: e.usuario_id ?? null, usuario: e.usuario || null
      })),
      ...fiscal.map((e, i) => {
        const [etiqueta, badgeFiscal] = ETIQUETA_FISCAL[e.tipo] || ['NF-e', 'badge-info'];
        return {
          id: `n${e.nota_id ?? ''}-${e.tipo}-${i}`, quando: e.quando, grupo: 'nfe',
          etiqueta, badge: badgeFiscal, texto: [e.titulo, e.detalhe].filter(Boolean).join(' — '), valor: null,
          usuario_id: null, usuario: null, sistema: true
        };
      })
    ].filter(i => i.quando);
    return itens.sort((a, b) => String(b.quando).localeCompare(String(a.quando)));
  }

  /** O dia de um instante no fuso de quem vê (o banco guarda em UTC: 23h30 aqui já é o dia seguinte lá). */
  function diaLocal(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso || '').slice(0, 10);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** "Hoje", "Ontem" ou a data, para o cabeçalho de cada dia. Pura. */
  function rotuloDoDia(iso, hoje = hojeLocal()) {
    const dia = diaLocal(iso);
    if (!dia) return '—';
    if (dia === hoje) return `Hoje · ${formatarData(dia)}`;
    const ontem = somarDias(hoje, -1);
    if (dia === ontem) return `Ontem · ${formatarData(dia)}`;
    return formatarData(dia);
  }

  /** As iniciais de quem fez (a bolinha quando não há foto). */
  const iniciais = nome => String(nome || '?').trim().split(/\s+/).filter(Boolean)
    .map((p, i, todos) => (i === 0 || i === todos.length - 1 ? p[0] : '')).join('').toUpperCase().slice(0, 2) || '?';

  /**
   * A ordem da tabela de valores da produção (Regras › Produção): as regras
   * de TODAS AS PEÇAS sempre primeiro (regra do dono, 21/09/2026), depois as
   * de cada peça. Em cada grupo, os processos na ordem da lista ao lado
   * (Marcenaria, Acabamento, Montagem, Embalagem) e, entre peças, pelo código.
   * `etapas`: [{ id, ordem }]. Pura.
   */
  function ordenarValoresDeProducao(valores, etapas = []) {
    const semPeca = v => v.produto_id === null || v.produto_id === undefined;
    const ordemDe = new Map((etapas || []).map(e => [String(e.id), Number(e.ordem) || 0]));
    const ordem = v => (ordemDe.has(String(v.etapa_id)) ? ordemDe.get(String(v.etapa_id)) : Number.MAX_SAFE_INTEGER);
    const peca = v => String(v.produto_codigo || v.produto || '');
    return (valores || []).slice().sort((a, b) =>
      (semPeca(a) === semPeca(b) ? 0 : (semPeca(a) ? -1 : 1))
      || ordem(a) - ordem(b)
      || String(a.etapa || '').localeCompare(String(b.etapa || ''), 'pt-BR')
      || peca(a).localeCompare(peca(b), 'pt-BR', { numeric: true }));
  }

  window.FinanceiroModais = {
    ordenarValoresDeProducao,
    formatarMoeda, lerMoeda, formatarData, somarDias, diferencaDias, competenciaDe, rotuloCompetencia,
    rotuloCompetenciaCurto, calcularParcelas, lerPrazos, impactoDoAjuste, statusAposRegistro, valorDasProximas,
    faixaDeAtraso, resumoAtrasadas, agingDe, indicadoresDaProducao, percentualTexto, montarRelatorio, relatorioEmCsv,
    filtrarParcelasAjuste, rotuloDaParcelaAjuste, alcanceDaRegra, SITUACOES_PARCELA, TIPOS_AJUSTE,
    rotuloStatusNota, filtrarNotas, resumoDeNotas, condicaoDoPedido, linhasAguardando, linhasDoRelatorioAguardando, previaDeEncargos,
    rotuloBoletoDaParcela, filtrarRecebimentos, totalDaVisao, rotuloDaParcelaAberta, resumoDoRecebimento, ORIGENS_RECEBIMENTO,
    textoDaConciliacao, BADGE_DO_AVISO,
    opcoesDeBeneficiario, filtrarPorBeneficiario, rotuloDoFiltroBenef,
    grupoDaAtividade, juntarAtividade, diaLocal, rotuloDoDia, iniciais, GRUPOS_ATIVIDADE,
    RELATORIOS: Object.keys(RELATORIOS), RELATORIOS_DE_PARCELA: [...RELATORIOS_DE_PARCELA], FAIXAS_ATRASO
  };

  // ------------------------------------------------------------ base

  const contexto = window.financeiroModalContexto || {};
  const overlayId = contexto.overlayId;
  const overlay = overlayId ? document.getElementById(`${overlayId}Overlay`) : null;
  if (!overlay) return;

  const el = id => overlay.querySelector(`#${id}`);
  let processando = false;
  // Um modal de Pedidos aberto por cima deste (emitir NF-e, visualizar,
  // cancelar, e-mail, carta): enquanto ele está aberto, o Esc é dele.
  let filhoAberto = false;
  // Ao fechar, a tela relê o painel fiscal: o que se fez aqui muda os números.
  const RECARREGAM_O_PAINEL = new Set(['finAguardandoNfe', 'finNotasFiscais', 'finConfiguracaoFiscal', 'finConfiguracaoCobranca', 'finRecebimentos', 'finRegistrarRecebimento',
    'finRegistrarAjuste', 'finRegistrarProducao', 'finFecharCompetencia', 'finFecharProducao', 'finConfirmarPagamento', 'finConfirmarReembolso', 'finRegras', 'finDetalhesParcela']);
  const recarregarPainel = () => { if (RECARREGAM_O_PAINEL.has(overlayId)) window.FinanceiroRecarregar?.(); };

  const fechar = () => {
    // Fechamento de competência em andamento não pode ser cancelado por engano.
    if (processando) return;
    desligar();
    window.Modal?.close(overlayId);
    recarregarPainel();
  };
  // Modais empilhados: o Esc só fecha o de cima, senão fecharia a pilha inteira.
  const ehOModalDeCima = () => {
    const abertos = [...document.querySelectorAll('[data-fin-modal]')].filter(o => !o.classList.contains('hidden'));
    return abertos[abertos.length - 1] === overlay;
  };
  const aoEsc = e => {
    if (e.key !== 'Escape' || filhoAberto || !ehOModalDeCima()) return;
    e.preventDefault();
    fechar();
  };
  const aoFecharPorFora = e => { if (e?.detail === overlayId) { desligar(); recarregarPainel(); } };
  // Ouvintes globais que um montador liga (a lista que se relê quando outro modal grava): saem junto.
  const aoDesligar = [];
  function desligar() {
    document.removeEventListener('keydown', aoEsc);
    window.removeEventListener('modalFechado', aoFecharPorFora);
    aoDesligar.splice(0).forEach(fn => fn());
  }
  document.addEventListener('keydown', aoEsc);
  window.addEventListener('modalFechado', aoFecharPorFora);
  overlay.querySelectorAll('[data-fin-fechar]').forEach(b => b.addEventListener('click', fechar));

  function avisarEmImplementacao(rotulo) {
    const mensagem = `"${rotulo}" ainda está em implementação.\nNada foi gravado.`;
    if (window.DialogPadrao?.info) {
      return window.DialogPadrao.info({ title: 'Função em implementação', tom: 'aviso', icone: 'fa-person-digging', message: `"${rotulo}" ainda está em implementação.`, nota: 'Nada foi gravado.' });
    }
    window.alert(mensagem);
    return Promise.resolve(true);
  }

  /**
   * Botão que chama `BotaoAcao.run` no próprio clique precisa da marca
   * `data-acao-gerida`: sem ela a rede automática do BotaoAcao (captura no
   * document) o marca como ocupado antes deste handler, e o `run` desiste
   * achando que é um segundo clique — o botão não faria nada.
   */
  function acionar(botao, fn) {
    botao.dataset.acaoGerida = 'true';
    botao.addEventListener('click', () => (window.BotaoAcao?.run ? window.BotaoAcao.run(botao, fn) : fn()));
  }

  overlay.querySelectorAll('[data-fin-principal]').forEach(botao => {
    botao.dataset.acaoGerida = 'true';
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

  /** Abre outro modal do módulo por cima deste (o módulo é quem sabe abrir). */
  const dadosDaLinha = new WeakMap();
  function abrirOutro(chave, extra = {}) {
    if (typeof window.FinanceiroAbrirModal === 'function') {
      window.FinanceiroAbrirModal(chave, null, { ...extra, empilhar: true, competencia: extra.competencia || contexto.competencia });
    } else {
      avisarEmImplementacao(chave);
    }
  }
  overlay.addEventListener('click', evento => {
    const alvo = evento.target.closest('[data-fin-abrir]');
    if (!alvo || !overlay.contains(alvo)) return;
    evento.stopPropagation();
    const extra = {};
    if (alvo.dataset.finRelatorio) extra.relatorio = alvo.dataset.finRelatorio;
    if (alvo.dataset.finTipo) extra.tipo = alvo.dataset.finTipo;
    if (alvo.dataset.finPedido) extra.pedido = alvo.dataset.finPedido;
    if (dadosDaLinha.has(alvo)) extra.parcela = dadosDaLinha.get(alvo);
    abrirOutro(alvo.dataset.finAbrir, extra);
  });

  /**
   * Abre um modal de Pedidos POR CIMA deste, com o spinner da casa
   * (Modal.openWithSpinner): ele espera o aviso de pronto — o
   * `pedidoModalLoaded` de quem o dispara ou o `signalReady` do próprio modal
   * — e só então revela a tela. Ao fechar, `aoFechar` relê a lista daqui.
   *
   * O `esperar` que algumas chamadas ainda passam é ignorado: hoje TODO modal
   * daqui abre com spinner, porque abrir vazio e preencher depois é
   * justamente o defeito que se queria tirar.
   */
  function abrirModalDePedido(htmlPath, scriptPath, id, opcoes = {}) {
    if (typeof window.Modal?.open !== 'function') return;
    const aoFechar = opcoes.aoFechar || null;
    filhoAberto = true;
    const aoFecharFilho = e => {
      if (e?.detail !== id) return;
      window.removeEventListener('modalFechado', aoFecharFilho);
      filhoAberto = false;
      aoFechar?.();
    };
    window.addEventListener('modalFechado', aoFecharFilho);
    if (typeof window.Modal.openWithSpinner === 'function') {
      window.Modal.openWithSpinner(htmlPath, scriptPath, id, { keepExisting: true });
      return;
    }
    window.Modal.open(htmlPath, scriptPath, id, true);
  }

  /** O Visualizar pedido de verdade (Pedidos), por cima deste modal. */
  function abrirVisualizarPedido(pedidoId) {
    if (!pedidoId) return;
    window.selectedOrderId = pedidoId;
    abrirModalDePedido('modals/pedidos/visualizar.html', '../js/modals/pedido-visualizar.js', 'visualizarPedido', { esperar: true });
  }
  overlay.addEventListener('click', evento => {
    const alvo = evento.target.closest('[data-fin-pedido-id]');
    if (!alvo || !overlay.contains(alvo) || !alvo.dataset.finPedidoId) return;
    evento.stopPropagation();
    abrirVisualizarPedido(Number(alvo.dataset.finPedidoId));
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

  /** Abas no padrão da casa: `[data-fin-aba]` mostra o `[data-fin-painel]` de mesmo nome. */
  function ligarAbas() {
    const abas = overlay.querySelectorAll('[data-fin-aba]');
    if (!abas.length) return;
    abas.forEach(aba => aba.addEventListener('click', () => {
      abas.forEach(outra => {
        const ativa = outra === aba;
        outra.setAttribute('aria-selected', String(ativa));
        outra.classList.toggle('tab-active', ativa);
        outra.classList.toggle('text-gray-400', !ativa);
        outra.classList.toggle('border-transparent', !ativa);
      });
      overlay.querySelectorAll('[data-fin-painel]').forEach(painel => {
        const ativa = painel.dataset.finPainel === aba.dataset.finAba;
        painel.classList.toggle('hidden', !ativa);
        if (ativa && painel.querySelector('input[type="radio"]') && !painel.querySelector('input[type="radio"]:checked')) {
          painel.querySelector('input[type="radio"]').checked = true;
        }
      });
    }));
  }

  function criar(tag, classe, texto) {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto != null) e.textContent = texto;
    return e;
  }

  const BADGES = {
    Liquidada: 'badge-success', Paga: 'badge-success', Finalizada: 'badge-success', Finalizado: 'badge-success',
    Entregue: 'badge-success', Atrasada: 'badge-danger', Aberta: 'badge-info', Parcial: 'badge-warning',
    Produção: 'badge-warning', Fechada: 'badge-neutral', Cancelado: 'badge-danger',
    Cancelada: 'badge-danger', 'A lançar': 'badge-warning', 'Não iniciado': 'badge-neutral', Autorizada: 'badge-success',
    Enviado: 'badge-info', Aprovado: 'badge-info', Pendente: 'badge-warning', Saldo: 'badge-neutral'
  };

  function badge(status) {
    const b = criar('span', `${BADGES[status] || 'badge-neutral'} px-3 py-1 rounded-full text-xs font-medium`, status);
    return b;
  }

  function aplicarBadge(alvo, status) {
    if (!alvo) return;
    alvo.className = `${BADGES[status] || 'badge-neutral'} px-3 py-1 rounded-full text-xs font-medium justify-self-end`;
    alvo.textContent = status;
  }

  function celulaDe(linha, coluna) {
    const td = criar('td', `px-4 py-3 ${['moeda', 'inteiro'].includes(coluna.tipo) ? 'text-right' : 'text-left'} ${coluna.classe || ''}`);
    const bruto = linha[coluna.chave];
    if (coluna.tipo === 'pedido') {
      // Linha sem pedido (saldo de fechamento): só o texto.
      if (linha.pedido_id === null || linha.pedido_id === undefined) {
        td.textContent = bruto === null || bruto === undefined || bruto === '' ? '—' : String(bruto);
        return td;
      }
      const botao = criar('button', 'fin-link-celula', String(bruto ?? '—'));
      botao.type = 'button';
      botao.dataset.finAbrir = 'detalhes-pedido';
      botao.dataset.finPedido = String(linha.pedido_id);
      td.appendChild(botao);
      return td;
    }
    // Pedido de verdade (linha vinda do backend): abre o Visualizar pedido dos Pedidos.
    if (coluna.tipo === 'pedido-real') {
      const botao = criar('button', 'fin-link-celula', String(bruto ?? '—'));
      botao.type = 'button';
      botao.dataset.finPedidoId = String(linha.pedido_id ?? '');
      td.appendChild(botao);
      return td;
    }
    if (coluna.tipo === 'badge') { td.appendChild(badge(String(bruto ?? '—'))); return td; }
    // Peça: só o código, em etiqueta; o nome inteiro aparece ao passar o mouse.
    // (O nome inteiro na coluna era o que empurrava as tabelas de produção para
    // a rolagem de lado.) O PDF e a planilha continuam com o texto completo.
    if (coluna.tipo === 'produto') {
      const completo = String(linha.produto ?? linha.produtoCompleto ?? '').trim();
      const codigo = String(linha.produto_codigo ?? '').trim();
      if (!codigo) { td.textContent = completo || '—'; return td; }
      const tag = criar('span', 'fin-tag-produto', codigo);
      tag.title = completo || codigo;
      tag.setAttribute('aria-label', completo || codigo);
      td.appendChild(tag);
      return td;
    }
    // Quem recebe: uma etiqueta por pessoa, com a cor dela e o tipo (CMS/Royalty).
    if (coluna.tipo === 'beneficiarios') {
      const lista = linha.benef_lista || [];
      if (!lista.length || !window.Beneficiarios) { td.textContent = bruto ? String(bruto) : '—'; return td; }
      const caixa = criar('div', 'fin-etiquetas-benef');
      for (const b of lista) {
        const titulo = [`${b.tipo === 'royalty' ? 'Royalty' : 'CMS'} de ${b.beneficiario}`,
          b.percentual == null ? null : `${percentualTexto(b.percentual)}`,
          b.valor == null ? null : formatarMoeda(b.valor)].filter(Boolean).join(' · ');
        caixa.appendChild(window.Beneficiarios.etiqueta(b.beneficiario, b.tipo, { titulo }));
      }
      td.appendChild(caixa);
      return td;
    }
    if (coluna.tipo === 'moeda') td.textContent = formatarMoeda(bruto);
    else if (coluna.tipo === 'data') td.textContent = formatarData(bruto);
    else if (coluna.tipo === 'inteiro') td.textContent = bruto == null ? '—' : String(bruto);
    else td.textContent = bruto == null || bruto === '' ? '—' : String(bruto);
    if (coluna.tipo === 'inteiro' && coluna.enfase) {
      const n = Number(bruto) || 0;
      if (n > 60) td.classList.add('fin-dias--critico');
      else if (n > 30) td.classList.add('fin-dias--alto');
    }
    return td;
  }

  function montarLinhas(tbody, linhas, colunas, { abrir = null } = {}) {
    tbody.replaceChildren();
    for (const l of linhas) {
      const tr = document.createElement('tr');
      // `abrir` pode ser o modal ou uma função da linha (null = a linha não abre nada).
      const destino = typeof abrir === 'function' ? abrir(l) : abrir;
      if (destino) {
        tr.dataset.finAbrir = destino;
        tr.tabIndex = 0;
        dadosDaLinha.set(tr, l);
      }
      for (const c of colunas) tr.appendChild(celulaDe(l, c));
      tbody.appendChild(tr);
    }
  }

  // ------------------------------------------------------- carregamento

  /**
   * O carregamento padrão das listas do Financeiro.
   *
   * Enquanto o servidor responde, a tabela mostra linhas de esqueleto (o
   * brilho de `.fin-esqueleto`) e a caixa fica `aria-busy`. Sem isso, aplicar
   * um filtro parecia travar: a lista antiga continuava na tela, sem sinal
   * nenhum de que algo estava acontecendo.
   *
   * O contador também resolve a corrida: trocar o filtro duas vezes seguidas
   * fazia a resposta mais LENTA (a do filtro antigo) chegar por último e
   * apagar a certa.
   */
  /** O spinner da casa (órbita + logo), o mesmo da abertura dos modais. */
  function spinnerDaCasa(classeExtra = '') {
    const indicador = criar('span', `app-loading-indicator fin-spinner ${classeExtra}`.trim());
    indicador.setAttribute('aria-hidden', 'true');
    const nucleo = criar('span', 'module-loading-core');
    const logo = document.createElement('img');
    logo.src = '../assets/Logo.ico';
    logo.alt = '';
    nucleo.appendChild(logo);
    indicador.append(criar('span', 'module-loading-orbit'), nucleo);
    return indicador;
  }

  /** A tabela durante a leitura: uma linha só, com o spinner e o que está sendo lido. */
  function esqueletoNaTabela(tbody, colunas = 4, _linhas = 5, texto = 'Carregando…') {
    if (!tbody) return;
    const tr = document.createElement('tr');
    tr.className = 'fin-linha-carregando';
    tr.setAttribute('role', 'status');
    tr.setAttribute('aria-live', 'polite');
    const td = criar('td');
    td.colSpan = Math.max(1, colunas);
    const caixa = criar('div', 'fin-carregando-caixa');
    caixa.append(spinnerDaCasa(), criar('span', 'fin-carregando-texto', texto));
    td.appendChild(caixa);
    tr.appendChild(td);
    tbody.replaceChildren(tr);
  }

  function marcarOcupado(alvo, ocupado) {
    if (!alvo) return;
    alvo.classList.toggle('fin-carregando', Boolean(ocupado));
    alvo.setAttribute('aria-busy', ocupado ? 'true' : 'false');
  }

  /**
   * Uma leitura de lista: `comecar()` liga o esqueleto e devolve o número da
   * leitura; `terminar(n)` devolve false quando a resposta chegou atrasada
   * (outro filtro já foi aplicado) — nesse caso a tela não é mexida.
   */
  function criarCarregamento({ tbody = null, colunas = 4, linhas = 5, caixas = [], aviso = null, vazio = null } = {}) {
    let leitura = 0;
    const tabela = () => tbody?.closest?.('.fin-tabela') || null;
    const alvos = () => [...caixas, tabela()].filter(Boolean);
    return {
      comecar() {
        const minha = ++leitura;
        alvos().forEach(a => marcarOcupado(a, true));
        // O texto de "lendo…" vai para dentro da tabela, junto do spinner.
        if (aviso) aviso.classList.add('hidden');
        // A lista pode ter ficado escondida no filtro anterior (nenhuma linha):
        // sem isto o spinner nasceria dentro de uma tabela invisível e a tela
        // parecia travada.
        tabela()?.classList.remove('hidden');
        vazio?.classList.add('hidden');
        esqueletoNaTabela(tbody, colunas, linhas, (aviso?.textContent || '').trim() || 'Carregando…');
        return minha;
      },
      atual: () => leitura,
      terminar(minha) {
        if (minha !== leitura) return false;
        alvos().forEach(a => marcarOcupado(a, false));
        if (aviso) aviso.classList.add('hidden');
        return true;
      }
    };
  }

  function montarDl(dl, pares) {
    dl.replaceChildren();
    for (const [rotulo, valor, destaque] of pares) {
      const linha = criar('div', 'fin-dl__linha');
      linha.appendChild(criar('dt', null, rotulo));
      const dd = criar('dd', destaque ? 'fin-dl__destaque' : null, valor);
      linha.appendChild(dd);
      dl.appendChild(linha);
    }
  }

  function montarLinhaDoTempo(lista, eventos) {
    lista.replaceChildren();
    if (!eventos.length) {
      lista.appendChild(criar('li', 'fin-vazio', 'Nenhum evento registrado.'));
      return;
    }
    for (const e of eventos) {
      const item = criar('li', 'fin-evento');
      const texto = criar('div', 'fin-evento__texto');
      texto.appendChild(criar('span', 'fin-evento__titulo', e.titulo));
      if (e.detalhe) texto.appendChild(criar('span', 'fin-evento__detalhe', e.detalhe));
      item.append(criar('span', 'fin-evento__hora', e.quando), texto);
      lista.appendChild(item);
    }
  }

  // ------------------------------------------------------- montadores

  // ------------------------------------------------ recebimentos (reais)
  //
  // "Registrar recebimento": GET /api/cobranca/recebimentos?visao=abertas e
  // POST /api/cobranca/recebimentos. "Recebimentos": as quatro visões, com
  // estorno, o boleto (modal dos Pedidos) e o registro por cima.

  function montarRecebimento() {
    const buscaCampo = el('finRecebimentoBusca');
    const parcelaSel = el('finRecebimentoParcela');
    const valorCampo = el('finRecebimentoValor');
    const dataCampo = el('finRecebimentoData');
    const formaSel = el('finRecebimentoForma');
    const registrarBtn = el('finRecebimentoRegistrar');
    const aviso = el('finRecebimentoAvisoBoleto');
    const hoje = hojeLocal();
    dataCampo.max = hoje;
    let abertas = [];
    let sqlPendente = false;
    // Fase G: base e percentuais de cada parcela, para mostrar a comissão que o recebimento gera.
    let comissoesPor = new Map();
    // Vinda de uma linha da lista de recebimentos: já escolhida.
    const pedida = contexto.parcela && contexto.parcela.pedido_id ? contexto.parcela : null;

    const chaveDe = l => `${l.pedido_id}:${l.numero_parcela}`;
    const escolhida = () => abertas.find(l => chaveDe(l) === parcelaSel.value) || null;

    function montarOpcoes() {
      const selecionada = parcelaSel.value;
      const visiveis = filtrarRecebimentos(abertas, { visao: 'abertas', busca: buscaCampo.value });
      parcelaSel.replaceChildren();
      const vazio = document.createElement('option');
      vazio.value = '';
      vazio.textContent = visiveis.length ? 'Escolha a parcela' : 'Nenhuma parcela em aberto com esta busca';
      parcelaSel.appendChild(vazio);
      for (const l of visiveis.slice(0, 300)) {
        const opcao = document.createElement('option');
        opcao.value = chaveDe(l);
        opcao.textContent = rotuloDaParcelaAberta(l);
        parcelaSel.appendChild(opcao);
      }
      if (visiveis.some(l => chaveDe(l) === selecionada)) parcelaSel.value = selecionada;
    }

    function pintarEscolhida({ trocouParcela = false } = {}) {
      const l = escolhida();
      el('finRecebimentoCliente').textContent = l?.cliente || '—';
      el('finRecebimentoPedido').textContent = l ? `${l.pedido} · parcela ${l.parcela || l.numero_parcela}` : '—';
      el('finRecebimentoNf').textContent = l?.nf || '—';
      el('finRecebimentoContexto').textContent = l ? `Pedido ${l.pedido}${l.nf ? ` • NF ${l.nf}` : ''}` : '';
      if (trocouParcela && l) valorCampo.value = formatoMoeda.format(Number(l.a_receber) || 0);
      const aberto = l && ['registrado', 'vencido', 'protestado'].includes(String(l.boleto?.status || ''));
      aviso.textContent = aberto
        ? `Esta parcela tem boleto em aberto no Banco do Brasil (${l.boleto.nosso_numero}). Ao registrar, o boleto será BAIXADO no banco como quitado por fora e não poderá mais ser pago.`
        : '';
      aviso.classList.toggle('hidden', !aberto);
      atualizarResumo();
    }

    function atualizarResumo() {
      const l = escolhida();
      const r = resumoDoRecebimento({ devido: l ? l.a_receber : null, recebido: lerMoeda(valorCampo.value), data: dataCampo.value });
      el('finRecebimentoDevido').textContent = formatarMoeda(r.devido);
      el('finRecebimentoLiquido').textContent = formatarMoeda(r.recebido);
      el('finRecebimentoDiferencaRotulo').textContent = r.rotuloDiferenca;
      el('finRecebimentoDiferenca').textContent = r.diferenca === null ? '—' : formatarMoeda(Math.abs(r.diferenca));
      el('finRecebimentoCompetencia').textContent = r.competencia;
      const c = l ? comissoesPor.get(chaveDe(l)) : null;
      const i = c ? impactoDoAjuste(c, 0) : null;
      el('finRecebimentoBase').textContent = i ? formatarMoeda(i.liquido) : '—';
      el('finRecebimentoCms').textContent = i ? `${formatarMoeda(i.cms)} (${percentualTexto(i.pct_cms)})` : '—';
      el('finRecebimentoRoyalty').textContent = i ? `${formatarMoeda(i.royalty)} (${percentualTexto(i.pct_royalty)})` : '—';
    }

    async function carregar() {
      mostrarMensagem('finRecebimentoMensagem', '');
      el('finRecebimentoCarregando').classList.remove('hidden');
      try {
        const corpo = await fetchApi(`/api/cobranca/recebimentos?visao=abertas&competencia=${encodeURIComponent(contexto.competencia || competenciaAtual())}`);
        abertas = Array.isArray(corpo?.linhas) ? corpo.linhas : [];
        sqlPendente = Boolean(corpo?.sql_pendente);
        if (sqlPendente) mostrarMensagem('finRecebimentoMensagem', 'Os recebimentos ainda não estão ativados: rode sql/cobranca_recebimentos.sql no banco e reinicie a API.');
      } catch (e) {
        abertas = [];
        mostrarMensagem('finRecebimentoMensagem', e.status === 403 ? 'Você não tem permissão para ver as parcelas a receber.' : e.message);
      } finally {
        el('finRecebimentoCarregando').classList.add('hidden');
      }
      montarOpcoes();
      if (pedida) {
        parcelaSel.value = `${pedida.pedido_id}:${pedida.numero_parcela}`;
        if (!escolhida()) mostrarMensagem('finRecebimentoMensagem', `A parcela ${pedida.numero_parcela} do pedido ${pedida.pedido || pedida.pedido_id} não está mais em aberto.`);
      }
      pintarEscolhida({ trocouParcela: true });
      if (pode('financeiro.comissao.view')) {
        // Em segundo plano: sem as regras (ou sem o SQL da fase G), a prévia só fica em branco.
        fetchApi('/api/financeiro/parcelas?visao=ajustaveis')
          .then(corpo => {
            comissoesPor = new Map((corpo?.linhas || []).map(x => [chaveDe(x), x]));
            atualizarResumo();
          })
          .catch(() => {});
      }
    }

    async function registrar() {
      mostrarMensagem('finRecebimentoMensagem', '');
      const l = escolhida();
      if (sqlPendente) { mostrarMensagem('finRecebimentoMensagem', 'Os recebimentos ainda não estão ativados: rode sql/cobranca_recebimentos.sql no banco e reinicie a API.'); return; }
      if (!l) { mostrarMensagem('finRecebimentoMensagem', 'Escolha a parcela.'); return; }
      const valor = lerMoeda(valorCampo.value);
      if (!dataCampo.value) { mostrarMensagem('finRecebimentoMensagem', 'Informe a data do recebimento.'); return; }
      if (dataCampo.value > hoje) { mostrarMensagem('finRecebimentoMensagem', 'A data do recebimento não pode ser futura.'); return; }
      if (!(valor > 0)) { mostrarMensagem('finRecebimentoMensagem', 'Informe o valor recebido.'); return; }
      if (!formaSel.value) { mostrarMensagem('finRecebimentoMensagem', 'Informe como o valor foi recebido.'); return; }
      const aberto = ['registrado', 'vencido', 'protestado'].includes(String(l.boleto?.status || ''));
      const confirmado = await window.DialogPadrao?.confirm?.({
        title: aberto ? 'Baixar o boleto e registrar?' : 'Registrar o recebimento?',
        message: `${formatarMoeda(valor)} recebidos em ${formatarData(dataCampo.value)} (${formaSel.value}) na parcela ${l.parcela || l.numero_parcela} do pedido ${l.pedido}. Competência ${competenciaDe(dataCampo.value)}.`
          + (aberto ? ` O boleto ${l.boleto.nosso_numero} será BAIXADO no Banco do Brasil e não poderá mais ser pago. Não tem volta.` : ''),
        confirmText: aberto ? 'Baixar e registrar' : 'Registrar'
      });
      if (!confirmado) return;
      processando = true;
      try {
        const r = await fetchApi('/api/cobranca/recebimentos', {
          method: 'POST',
          body: JSON.stringify({
            pedido_id: l.pedido_id, numero_parcela: l.numero_parcela, data_recebimento: dataCampo.value, valor_recebido: valor,
            forma: formaSel.value, observacao: el('finRecebimentoObservacoes').value, ...(aberto ? { baixar_boleto: true } : {})
          })
        });
        const avisos = Array.isArray(r?.avisos) ? r.avisos : [];
        window.showToast?.(aberto ? 'Boleto baixado e recebimento registrado.' : 'Recebimento registrado.', avisos.length ? 'info' : 'success');
        if (avisos.length && window.DialogPadrao?.info) {
          await window.DialogPadrao.info({
            title: 'Recebimento registrado com aviso', tom: 'aviso', icone: 'fa-hand-holding-dollar',
            message: `O recebimento de ${formatarMoeda(valor)} entrou na parcela ${l.parcela || l.numero_parcela} do pedido ${l.pedido}, mas confira:`,
            secoes: [{ titulo: 'Avisos', icone: 'fa-triangle-exclamation', lista: avisos }]
          });
        }
        window.dispatchEvent(new CustomEvent('financeiro:recebimentos-alterados'));
        processando = false;
        fechar();
      } catch (e) {
        mostrarMensagem('finRecebimentoMensagem', e.status === 403 ? 'Você não tem permissão para esta ação.' : e.message);
      } finally {
        processando = false;
      }
    }

    buscaCampo.addEventListener('input', () => { montarOpcoes(); pintarEscolhida({ trocouParcela: true }); });
    parcelaSel.addEventListener('change', () => pintarEscolhida({ trocouParcela: true }));
    ligarCampoMoeda(valorCampo, atualizarResumo);
    dataCampo.addEventListener('change', atualizarResumo);
    if (registrarBtn) {
      registrarBtn.dataset.acaoGerida = 'true';
      registrarBtn.addEventListener('click', () => (window.BotaoAcao?.run ? window.BotaoAcao.run(registrarBtn, registrar) : registrar()));
    }
    return carregar();
  }

  function montarRecebimentos() {
    const visaoSel = el('finRecebimentosVisao');
    const competenciaSel = el('finRecebimentosCompetencia');
    const boletoSel = el('finRecebimentosBoleto');
    const busca = el('finRecebimentosBusca');
    const cabeca = el('finRecebimentosCabeca');
    const corpo = el('finRecebimentosCorpo');
    const tabela = corpo.closest('.fin-tabela');
    montarCompetencias(competenciaSel, contexto.competencia);
    if (['recebidos', 'a_receber', 'em_atraso', 'abertas'].includes(contexto.visao)) visaoSel.value = contexto.visao;
    if (contexto.filtro?.boleto) boletoSel.value = contexto.filtro.boleto;
    let dados = null;

    const COLUNAS = {
      recebidos: ['Recebido em', 'Pedido', 'Cliente', 'NF', 'Parcela', 'Origem', 'Forma', 'Valor', 'Situação', 'Ações'],
      parcelas: ['Vencimento', 'Pedido', 'Cliente', 'NF', 'Parcela', 'A receber', 'Atraso', 'Boleto', 'Ações']
    };
    const DIREITA = new Set(['Valor', 'A receber', 'Atraso']);

    function pintarCabeca(visao) {
      const tr = document.createElement('tr');
      for (const rotulo of COLUNAS[visao === 'recebidos' ? 'recebidos' : 'parcelas']) {
        tr.appendChild(criar('th', `px-4 py-3 text-xs ${DIREITA.has(rotulo) ? 'text-right' : 'text-left'}`, rotulo));
      }
      cabeca.replaceChildren(tr);
    }

    const carregamento = criarCarregamento({ tbody: corpo, colunas: 9, aviso: el('finRecebimentosCarregando'), vazio: el('finRecebimentosVazio') });

    async function carregarLista() {
      mostrarMensagem('finRecebimentosMensagem', '');
      const minha = carregamento.comecar();
      let lido = null;
      let erro = null;
      try {
        lido = await fetchApi(`/api/cobranca/recebimentos?visao=${encodeURIComponent(visaoSel.value)}&competencia=${encodeURIComponent(competenciaSel.value || '')}`);
      } catch (e) {
        erro = e;
      }
      // Resposta atrasada (o filtro já mudou de novo): não mexe na tela.
      if (!carregamento.terminar(minha)) return;
      dados = erro ? null : lido;
      if (erro) mostrarMensagem('finRecebimentosMensagem', erro.status === 403 ? 'Você não tem permissão para ver os recebimentos.' : erro.message);
      desenhar();
    }

    function desenhar() {
      const visao = visaoSel.value;
      const resumo = dados?.resumo || {};
      el('finRecebimentosRecebido').textContent = formatarMoeda(resumo.recebido?.total ?? null);
      el('finRecebimentosAReceber').textContent = formatarMoeda(resumo.a_receber?.total ?? null);
      el('finRecebimentosAtraso').textContent = formatarMoeda(resumo.em_atraso?.total ?? null);
      el('finRecebimentosBoletos').textContent = formatarMoeda(resumo.boletos_abertos?.total ?? null);
      el('finRecebimentosDesde').textContent = dados?.desde ? `Parcelas controladas a partir de ${formatarData(dados.desde)}` : 'Contas a receber dos pedidos faturados';
      el('finRecebimentosSemSql').classList.toggle('hidden', !dados?.sql_pendente);
      // Competência não muda "em atraso" nem "todas em aberto"; o filtro de boleto não vale para recebidos.
      const semCompetencia = ['em_atraso', 'abertas'].includes(visao);
      competenciaSel.disabled = semCompetencia;
      if (window.Competencia) window.Competencia.desabilitar(competenciaSel, semCompetencia);
      boletoSel.disabled = visao === 'recebidos';

      pintarCabeca(visao);
      const linhas = filtrarRecebimentos(dados?.linhas || [], { visao, boleto: boletoSel.value, busca: busca.value });
      corpo.replaceChildren();
      for (const l of linhas) corpo.appendChild(visao === 'recebidos' ? linhaRecebido(l) : linhaParcela(l));
      el('finRecebimentosVazio').classList.toggle('hidden', linhas.length > 0 || !dados);
      tabela?.classList.toggle('hidden', linhas.length === 0);
      const total = totalDaVisao(linhas, visao);
      el('finRecebimentosTotal').textContent = linhas.length ? `${linhas.length} ${linhas.length === 1 ? 'linha' : 'linhas'} · ${visao === 'recebidos' ? 'recebido' : 'a receber'}: ${formatarMoeda(total)}` : '';
    }

    const celula = (conteudo, classe = 'px-4 py-3') => {
      const td = criar('td', classe);
      if (conteudo && typeof conteudo === 'object') td.appendChild(conteudo);
      else td.textContent = conteudo == null || conteudo === '' ? '—' : String(conteudo);
      return td;
    };
    const linkDoPedido = l => {
      const b = criar('button', 'fin-link-celula', String(l.pedido || l.pedido_id || '—'));
      b.type = 'button';
      b.dataset.finPedidoId = String(l.pedido_id ?? '');
      return b;
    };
    const tag = (texto, classe, titulo = '') => {
      const s = criar('span', `${classe} px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap`, texto);
      if (titulo) s.title = titulo;
      return s;
    };
    const botaoEm = (caixa, texto, fn, { classe = 'btn-neutral text-white', perm = null, titulo = '' } = {}) => {
      const b = criar('button', `${classe} px-3 py-1 rounded-md text-xs font-medium`, texto);
      b.type = 'button';
      if (perm) b.dataset.perm = perm;
      if (titulo) b.title = titulo;
      acionar(b, fn);
      caixa.appendChild(b);
    };

    function linhaRecebido(l) {
      const tr = document.createElement('tr');
      const estornado = l.status !== 'confirmado';
      const acoes = criar('div', 'flex flex-wrap gap-2');
      if (!estornado && l.origem !== 'boleto') {
        botaoEm(acoes, 'Estornar', () => estornar(l), { classe: 'btn-danger text-white', perm: 'financeiro.recebimento.estornar', titulo: 'Desfazer este recebimento' });
      }
      if (l.boleto_id) botaoEm(acoes, 'Boleto', () => abrirBoleto({ id: l.boleto_id }, l), { perm: 'financeiro.boleto.view', titulo: 'Ver o boleto' });
      const forma = [l.forma, l.canal && l.canal !== l.forma ? l.canal : ''].filter(Boolean).join(' · ');
      tr.append(
        celula(formatarData(l.data), 'px-4 py-3 text-white'), celula(linkDoPedido(l)), celula(l.cliente), celula(l.nf),
        celula(String(l.numero_parcela ?? '—')), celula(tag(ORIGENS_RECEBIMENTO[l.origem] || l.origem, l.origem === 'boleto' ? 'badge-success' : 'badge-info')),
        celula(forma), celula(formatarMoeda(l.valor), 'px-4 py-3 text-right'),
        celula(estornado ? tag('Estornado', 'badge-danger', l.motivo_estorno || '') : tag('Confirmado', 'badge-success', l.data_credito ? `Crédito em ${formatarData(l.data_credito)}` : '')),
        celula(acoes)
      );
      return tr;
    }

    function linhaParcela(l) {
      const tr = document.createElement('tr');
      const acoes = criar('div', 'flex flex-wrap gap-2');
      botaoEm(acoes, 'Registrar', () => abrirOutro('registrar-recebimento', { parcela: { pedido_id: l.pedido_id, numero_parcela: l.numero_parcela, pedido: l.pedido } }),
        { classe: 'btn-success', perm: 'financeiro.recebimento.registrar', titulo: 'Registrar o recebimento desta parcela' });
      if (l.boleto?.id) botaoEm(acoes, 'Boleto', () => abrirBoleto(l.boleto, l), { perm: 'financeiro.boleto.view', titulo: 'Situação no BB, prorrogar, abatimento e baixa' });
      const b = rotuloBoletoDaParcela(l.boleto);
      const boletoCelula = criar('div', 'flex flex-col gap-1');
      boletoCelula.appendChild(tag(b.texto, b.badge, l.boleto?.erro || l.boleto?.nosso_numero || ''));
      if (l.controlada === false) boletoCelula.appendChild(tag('antes do controle', 'badge-neutral', 'Venceu antes da data em que o app passou a controlar os recebimentos'));
      const atraso = celula(Number(l.dias_atraso) > 0 ? `${l.dias_atraso} dias` : '—', 'px-4 py-3 text-right');
      if (Number(l.dias_atraso) > 60) atraso.classList.add('fin-dias--critico');
      else if (Number(l.dias_atraso) > 15) atraso.classList.add('fin-dias--alto');
      tr.append(
        celula(formatarData(l.vencimento), 'px-4 py-3 text-white'), celula(linkDoPedido(l)), celula(l.cliente), celula(l.nf),
        celula(l.parcela), celula(formatarMoeda(l.a_receber), 'px-4 py-3 text-right'), atraso, celula(boletoCelula), celula(acoes)
      );
      return tr;
    }

    /** O modal "Boleto" dos Pedidos, por cima deste; ao fechar, a lista se relê. */
    function abrirBoleto(boleto, l) {
      window.boletoDetalheContext = { boletoId: boleto.id, pedidoId: l.pedido_id, numero: l.pedido || '', parcela: l.numero_parcela };
      abrirModalDePedido('modals/pedidos/boleto-detalhe.html', '../js/modals/pedido-boleto-detalhe.js', 'boletoDetalhe', { aoFechar: carregarLista });
    }

    async function estornar(l) {
      mostrarMensagem('finRecebimentosMensagem', '');
      const motivo = await pedirMotivo(l);
      if (motivo === null) return;
      try {
        await fetchApi(`/api/cobranca/recebimentos/${encodeURIComponent(l.id)}/estornar`, { method: 'POST', body: JSON.stringify({ motivo }) });
        window.showToast?.('Recebimento estornado.', 'success');
        window.FinanceiroRecarregar?.();
      } catch (e) {
        mostrarMensagem('finRecebimentosMensagem', e.status === 403 ? 'Você não tem permissão para estornar recebimentos.' : e.message);
      }
      await carregarLista();
    }

    /**
     * O motivo do estorno, numa caixa montada aqui (o DialogPadrao não tem
     * campo de texto). null = desistiu.
     */
    function pedirMotivo(l) {
      return new Promise(resolver => {
        // .app-message-overlay: a caixa sobe para a top layer (src/utils/dialogTopLayer.js), acima dos modais.
        const fundo = criar('div', 'app-message-overlay fixed inset-0 bg-black/50 flex items-center justify-center p-4');
        const caixa = criar('div', 'w-full max-w-md glass-surface backdrop-blur-xl rounded-2xl border border-white/10 p-6 space-y-4');
        caixa.setAttribute('role', 'dialog');
        caixa.setAttribute('aria-modal', 'true');
        caixa.appendChild(criar('h3', 'ctl-modal-titulo text-white', 'Estornar o recebimento?'));
        caixa.appendChild(criar('p', 'text-sm text-gray-300', `${formatarMoeda(l.valor)} de ${formatarData(l.data)} — pedido ${l.pedido}, parcela ${l.numero_parcela}. A parcela volta a ficar em aberto${l.origem === 'quitado_por_fora' ? ' e pode ganhar um boleto novo (o boleto baixado continua baixado)' : ''}.`));
        const campo = criar('textarea', 'w-full ctl-campo bg-input border border-inputBorder text-white placeholder-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/50 transition');
        campo.rows = 3;
        campo.maxLength = 500;
        campo.placeholder = 'Motivo do estorno (obrigatório)';
        caixa.appendChild(campo);
        const erroEl = criar('p', 'hidden text-sm', 'Diga o motivo (ao menos 5 letras).');
        erroEl.style.color = 'var(--color-red)';
        caixa.appendChild(erroEl);
        const rodape = criar('div', 'ctl-acoes justify-end');
        const voltar = criar('button', 'btn-neutral ctl-botao text-white', 'Voltar');
        const confirmar = criar('button', 'btn-danger ctl-botao text-white', 'Estornar');
        voltar.type = 'button';
        confirmar.type = 'button';
        rodape.append(voltar, confirmar);
        caixa.appendChild(rodape);
        fundo.appendChild(caixa);
        const sair = valor => {
          document.removeEventListener('keydown', aoTecla, true);
          filhoAberto = false;
          fundo.remove();
          resolver(valor);
        };
        const aoTecla = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); sair(null); } };
        voltar.addEventListener('click', () => sair(null));
        confirmar.addEventListener('click', () => {
          const texto = campo.value.trim();
          if (texto.length < 5) { erroEl.classList.remove('hidden'); campo.focus(); return; }
          sair(texto);
        });
        document.addEventListener('keydown', aoTecla, true);
        filhoAberto = true;
        document.body.appendChild(fundo);
        campo.focus();
      });
    }

    async function conciliar() {
      mostrarMensagem('finRecebimentosMensagem', '');
      try {
        const r = await fetchApi('/api/cobranca/conciliar', { method: 'POST', body: '{}' });
        const t = textoDaConciliacao(r);
        mostrarMensagem('finRecebimentosMensagem', `Conciliação: ${t.texto}${t.erros.length ? ` ${t.erros.slice(0, 3).join(' | ')}` : ''}`, t.erros.length ? 'erro' : 'ok');
        window.FinanceiroRecarregar?.();
      } catch (e) {
        mostrarMensagem('finRecebimentosMensagem', e.status === 403 ? 'Você não tem permissão para conciliar.' : e.message);
      }
      await carregarLista();
    }

    // Um recebimento registrado por cima relê a lista.
    const aoAlterar = () => carregarLista();
    window.addEventListener('financeiro:recebimentos-alterados', aoAlterar);
    aoDesligar.push(() => window.removeEventListener('financeiro:recebimentos-alterados', aoAlterar));

    visaoSel.addEventListener('change', carregarLista);
    competenciaSel.addEventListener('change', carregarLista);
    boletoSel.addEventListener('change', desenhar);
    busca.addEventListener('input', desenhar);
    const ligarBotao = (id, fn) => {
      const botao = el(id);
      if (!botao) return;
      botao.dataset.acaoGerida = 'true';
      botao.addEventListener('click', () => (window.BotaoAcao?.run ? window.BotaoAcao.run(botao, fn) : fn()));
    };
    ligarBotao('finRecebimentosConciliar', conciliar);
    ligarBotao('finRecebimentosRegistrar', () => abrirOutro('registrar-recebimento'));
    return carregarLista();
  }

  // ------------------------------------------ comissões e produção (fase G)
  //
  // Tudo lê e grava em /api/financeiro. Depois de gravar, o evento
  // `financeiro:alterado` faz as listas abertas por baixo se relerem.

  const avisarAlteracao = () => window.dispatchEvent(new CustomEvent('financeiro:alterado'));

  /** Relê quando outro modal gravar algo (o ouvinte sai junto com o modal). */
  function aoAlterar(fn) {
    const ouvinte = () => fn();
    window.addEventListener('financeiro:alterado', ouvinte);
    aoDesligar.push(() => window.removeEventListener('financeiro:alterado', ouvinte));
  }

  const pode = chave => (typeof window.Permissoes?.pode === 'function' ? window.Permissoes.pode(chave) : true);

  const SQL_G = 'Comissões e produção ainda não estão ativadas: rode sql/financeiro_comissoes_producao.sql no banco e reinicie a API.';
  function textoDoErro(e, semPermissao) {
    if (e?.status === 403) return semPermissao;
    if (e?.corpo?.sql_pendente) return /\.sql\b/.test(String(e?.message || '')) ? e.message : SQL_G;
    return e?.message || 'Erro inesperado.';
  }

  function opcao(valor, texto) {
    const o = document.createElement('option');
    o.value = valor;
    o.textContent = texto;
    return o;
  }

  function celulaG(conteudo, classe = 'px-4 py-3') {
    const td = criar('td', classe);
    if (conteudo && typeof conteudo === 'object') td.appendChild(conteudo);
    else td.textContent = conteudo === null || conteudo === undefined || conteudo === '' ? '—' : String(conteudo);
    return td;
  }

  function tagG(texto, classe, titulo = '') {
    const s = criar('span', `${classe} px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap`, texto);
    if (titulo) s.title = titulo;
    return s;
  }

  /**
   * 'dd/mm/aaaa às hh:mm' de um instante do banco (TIMESTAMPTZ), em
   * Brasília. É o que as etiquetas de "confirmado" e "decidido" mostram no
   * hover — o dono quer saber QUANDO cada decisão foi tomada.
   */
  function instanteCurto(instante) {
    if (!instante) return '';
    const texto = String(instante);
    const soDia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
    if (soDia) return `${soDia[3]}/${soDia[2]}/${soDia[1]}`;
    const d = new Date(texto);
    if (Number.isNaN(d.getTime())) return '';
    const partes = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(d);
    const v = t => partes.find(p => p.type === t)?.value;
    return `${v('day')}/${v('month')}/${v('year')} às ${v('hour')}:${v('minute')}`;
  }

  function botaoG(caixa, texto, fn, { classe = 'btn-neutral text-white', perm = null, titulo = '' } = {}) {
    const b = criar('button', `${classe} px-3 py-1 rounded-md text-xs font-medium`, texto);
    b.type = 'button';
    if (perm) b.dataset.perm = perm;
    if (titulo) b.title = titulo;
    acionar(b, fn);
    caixa.appendChild(b);
    return b;
  }

  function linhaVazia(tbody, colunas, texto) {
    const tr = document.createElement('tr');
    const td = criar('td', 'px-4 py-6 text-center text-sm text-gray-400', texto);
    td.colSpan = colunas;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  /**
   * Uma caixa com campo de texto (o motivo), acima dos modais. null = desistiu.
   * Mesma caixa do estorno de recebimento.
   */
  function pedirTexto({ titulo, mensagem, placeholder = 'Motivo (obrigatório)', confirmar = 'Confirmar', minimo = 5 }) {
    return new Promise(resolver => {
      const fundo = criar('div', 'app-message-overlay fixed inset-0 bg-black/50 flex items-center justify-center p-4');
      const caixa = criar('div', 'w-full max-w-md glass-surface backdrop-blur-xl rounded-2xl border border-white/10 p-6 space-y-4');
      caixa.setAttribute('role', 'dialog');
      caixa.setAttribute('aria-modal', 'true');
      caixa.appendChild(criar('h3', 'ctl-modal-titulo text-white', titulo));
      if (mensagem) caixa.appendChild(criar('p', 'text-sm text-gray-300', mensagem));
      const campo = criar('textarea', 'w-full ctl-campo bg-input border border-inputBorder text-white placeholder-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/50 transition');
      campo.rows = 3;
      campo.maxLength = 500;
      campo.placeholder = placeholder;
      caixa.appendChild(campo);
      const erroEl = criar('p', 'hidden text-sm', `Escreva o motivo (ao menos ${minimo} letras).`);
      erroEl.style.color = 'var(--color-red)';
      caixa.appendChild(erroEl);
      const rodape = criar('div', 'ctl-acoes justify-end');
      const voltar = criar('button', 'btn-neutral ctl-botao text-white', 'Voltar');
      const ok = criar('button', 'btn-danger ctl-botao text-white', confirmar);
      voltar.type = 'button';
      ok.type = 'button';
      rodape.append(voltar, ok);
      caixa.appendChild(rodape);
      fundo.appendChild(caixa);
      const sair = valor => {
        document.removeEventListener('keydown', aoTecla, true);
        filhoAberto = false;
        fundo.remove();
        resolver(valor);
      };
      const aoTecla = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); sair(null); } };
      voltar.addEventListener('click', () => sair(null));
      ok.addEventListener('click', () => {
        const texto = campo.value.trim();
        if (texto.length < minimo) { erroEl.classList.remove('hidden'); campo.focus(); return; }
        sair(texto);
      });
      document.addEventListener('keydown', aoTecla, true);
      filhoAberto = true;
      document.body.appendChild(fundo);
      campo.focus();
    });
  }

  const nomeDaPeca = item => (item ? ([item.codigo, item.nome].filter(Boolean).join(' — ') || `item ${item.id}`) : '—');

  // ------------------------------------------ relatórios: busca e exportação

  /** As linhas de um relatório: do backend (ou do painel fiscal, no de NF-e). */
  async function buscarRelatorio(chave, { competencia, periodo }) {
    let linhas;
    let filtro;
    if (chave === 'aguardando-nf') {
      const painel = await fetchApi(`/api/fiscal/painel?competencia=${encodeURIComponent(competencia)}`);
      linhas = linhasDoRelatorioAguardando(painel);
      filtro = `Enviados desde ${formatarData(painel.desde)} sem NF-e`;
    } else {
      const consulta = periodo?.inicio
        ? `inicio=${encodeURIComponent(periodo.inicio)}&fim=${encodeURIComponent(periodo.fim)}`
        : `competencia=${encodeURIComponent(competencia)}`;
      const r = await fetchApi(`/api/financeiro/relatorios/${encodeURIComponent(chave)}?${consulta}`);
      linhas = Array.isArray(r?.linhas) ? r.linhas : [];
      filtro = r?.filtro || '';
    }
    return { ...montarRelatorio(chave, { linhas }), filtro, competencia, periodo: periodo?.inicio ? periodo : null };
  }

  const tituloDoRelatorio = r => (r.periodo ? r.titulo : `${r.titulo} — ${rotuloCompetenciaCurto(r.competencia)}`);

  function textoDaCelula(valor, tipo) {
    if (tipo === 'moeda') return formatarMoeda(valor);
    if (tipo === 'data') return formatarData(valor);
    if (tipo === 'inteiro') return valor === null || valor === undefined ? '—' : String(valor);
    return valor === null || valor === undefined || valor === '' ? '—' : String(valor);
  }

  /** A folha do relatório como documento para o PDF, montada com DOM (dado nenhum vira HTML). */
  function documentoDoRelatorio(r) {
    const doc = document.implementation.createHTMLDocument(tituloDoRelatorio(r));
    const estilo = doc.createElement('style');
    estilo.textContent = [
      '@page { size: A4 landscape; margin: 12mm; }',
      'body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 10px; }',
      'h1 { font-size: 15px; margin: 0 0 2px; }',
      'p { margin: 0 0 8px; color: #555; }',
      'table { width: 100%; border-collapse: collapse; }',
      'th, td { border-bottom: 1px solid #ddd; padding: 4px 6px; text-align: left; white-space: nowrap; }',
      'th { background: #f1ede0; }',
      '.num { text-align: right; }',
      'tfoot td { font-weight: bold; border-top: 2px solid #b6a03e; }'
    ].join('\n');
    doc.head.appendChild(estilo);
    const add = (pai, tag, texto = null, classe = null) => {
      const e = doc.createElement(tag);
      if (texto !== null) e.textContent = texto;
      if (classe) e.className = classe;
      pai.appendChild(e);
      return e;
    };
    const num = c => (['moeda', 'inteiro'].includes(c.tipo) ? 'num' : null);
    add(doc.body, 'h1', tituloDoRelatorio(r));
    add(doc.body, 'p', `Santíssimo Decor • Comissões e Produção • ${r.filtro || ''} • gerado em ${formatarData(hojeLocal())}`);
    const tabela = add(doc.body, 'table');
    const cabeca = add(add(tabela, 'thead'), 'tr');
    for (const c of r.colunas) add(cabeca, 'th', c.rotulo, num(c));
    const corpo = add(tabela, 'tbody');
    for (const l of r.linhas) {
      const tr = add(corpo, 'tr');
      for (const c of r.colunas) add(tr, 'td', textoDaCelula(l[c.chave], c.tipo), num(c));
    }
    const pe = add(add(tabela, 'tfoot'), 'tr');
    r.colunas.forEach((c, i) => add(pe, 'td', i === 0 ? `Total (${r.linhas.length})` : (c.total ? textoDaCelula(r.totais[c.chave], c.tipo) : ''), num(c)));
    return `<!DOCTYPE html>${doc.documentElement.outerHTML}`;
  }

  function tratarSalvamento(resultado, mensagemOk) {
    if (!resultado) throw new Error('Exportação indisponível neste ambiente.');
    if (resultado.canceled) { window.showToast?.('Exportação cancelada.', 'info'); return; }
    if (!resultado.success) throw new Error(resultado.message || 'Não foi possível salvar o arquivo.');
    window.showToast?.(mensagemOk, 'success');
  }

  /** PDF pelo Electron; "Excel" é uma planilha CSV (ponto e vírgula), que o Excel abre. */
  async function exportarRelatorio(formato, r) {
    const nome = `${r.chave}-${r.periodo ? `${r.periodo.inicio}_${r.periodo.fim}` : r.competencia}`;
    if (formato === 'excel') {
      const res = await window.electronAPI?.salvarTextoComoArquivo?.({
        conteudo: relatorioEmCsv(r), nomeSugerido: nome, extensao: 'csv', titulo: 'Salvar planilha do relatório', descricao: 'Planilha (Excel)'
      });
      return tratarSalvamento(res, 'Planilha salva.');
    }
    const res = await window.electronAPI?.salvarHtmlComoPdf?.({ html: documentoDoRelatorio(r), nomeSugerido: nome, titulo: 'Salvar relatório em PDF' });
    return tratarSalvamento(res, 'Relatório salvo em PDF.');
  }

  function montarAjuste() {
    const buscaCampo = el('finAjusteBusca');
    const parcelaSel = el('finAjusteParcela');
    const tipoSel = el('finAjusteTipo');
    const valorCampo = el('finAjusteValor');
    const dataCampo = el('finAjusteData');
    const hoje = hojeLocal();
    dataCampo.max = hoje;
    let linhas = [];
    // Vinda dos Detalhes da parcela: já escolhida.
    const pedida = contexto.parcela && contexto.parcela.pedido_id ? contexto.parcela : null;
    const chaveDe = l => `${l.pedido_id}:${l.numero_parcela}`;
    const escolhida = () => linhas.find(l => chaveDe(l) === parcelaSel.value) || null;
    const boletoAberto = l => BOLETO_A_PAGAR.includes(String(l?.boleto?.status || ''));

    function montarOpcoes() {
      const selecionada = parcelaSel.value;
      const visiveis = filtrarParcelasAjuste(linhas, buscaCampo.value);
      parcelaSel.replaceChildren(opcao('', visiveis.length ? 'Escolha a parcela' : 'Nenhuma parcela com esta busca'));
      for (const l of visiveis.slice(0, 300)) parcelaSel.appendChild(opcao(chaveDe(l), rotuloDaParcelaAjuste(l)));
      if (visiveis.some(l => chaveDe(l) === selecionada)) parcelaSel.value = selecionada;
    }

    function atualizar() {
      const l = escolhida();
      const valor = lerMoeda(valorCampo.value) || 0;
      el('finAjusteContexto').textContent = l ? `Pedido ${l.pedido}${l.nf ? ` • NF ${l.nf}` : ''} • Parcela ${l.parcela}` : '';
      if (!l) {
        ['finAjusteOriginal', 'finAjusteAnteriores', 'finAjusteNovo', 'finAjusteLiquido', 'finAjusteCms', 'finAjusteRoyalty'].forEach(id => { el(id).textContent = '—'; });
        el('finAjustePctCms').textContent = '';
        el('finAjustePctRoyalty').textContent = '';
        ['finAjusteEstorno', 'finAjusteBoleto', 'finAjusteSemRegra'].forEach(id => el(id).classList.add('hidden'));
        return;
      }
      const i = impactoDoAjuste(l, valor);
      el('finAjusteOriginal').textContent = formatarMoeda(i.original);
      el('finAjusteAnteriores').textContent = formatarMoeda(i.anteriores);
      el('finAjusteNovo').textContent = formatarMoeda(i.novo);
      el('finAjusteLiquido').textContent = formatarMoeda(i.liquido);
      el('finAjusteCms').textContent = formatarMoeda(i.cms);
      el('finAjusteRoyalty').textContent = formatarMoeda(i.royalty);
      el('finAjustePctCms').textContent = `(${percentualTexto(i.pct_cms)})`;
      el('finAjustePctRoyalty').textContent = `(${percentualTexto(i.pct_royalty)})`;
      el('finAjusteEstorno').classList.toggle('hidden', !(i.gera_estorno && valor > 0));
      el('finAjusteSemRegra').classList.toggle('hidden', !l.sem_regra);
      let aviso = '';
      if (boletoAberto(l)) {
        aviso = tipoSel.value === 'abatimento'
          ? `Esta parcela tem boleto em aberto no BB (${l.boleto.nosso_numero}): o abatimento é feito no próprio boleto (Recebimentos → Boleto), e ele já reduz a base da comissão.`
          : `Esta parcela tem boleto em aberto no BB (${l.boleto.nosso_numero}), que continua cobrando o valor cheio. Se o cliente vai pagar menos, conceda o abatimento no boleto em vez de registrar aqui — os dois juntos descontariam em dobro.`;
      }
      el('finAjusteBoletoTexto').textContent = aviso;
      el('finAjusteBoleto').classList.toggle('hidden', !aviso);
      mostrarMensagem('finAjusteMensagem', i.excede ? `O ajuste passa do valor líquido que resta na parcela (${formatarMoeda(i.liquido_antes)}).` : '');
    }

    async function carregar() {
      mostrarMensagem('finAjusteMensagem', '');
      el('finAjusteCarregando').classList.remove('hidden');
      try {
        const corpo = await fetchApi('/api/financeiro/parcelas?visao=ajustaveis');
        linhas = Array.isArray(corpo?.linhas) ? corpo.linhas : [];
      } catch (e) {
        linhas = [];
        mostrarMensagem('finAjusteMensagem', textoDoErro(e, 'Você não tem permissão para ver as parcelas.'));
      } finally {
        el('finAjusteCarregando').classList.add('hidden');
      }
      montarOpcoes();
      if (pedida) {
        parcelaSel.value = `${pedida.pedido_id}:${pedida.numero_parcela}`;
        if (!escolhida()) mostrarMensagem('finAjusteMensagem', `A parcela ${pedida.numero_parcela} do pedido ${pedida.pedido || pedida.pedido_id} não aceita ajuste (cancelada ou fora das contas).`);
      }
      atualizar();
    }

    async function registrar() {
      mostrarMensagem('finAjusteMensagem', '');
      const l = escolhida();
      const valor = lerMoeda(valorCampo.value);
      const motivo = el('finAjusteMotivo').value.trim();
      const erro = !l ? 'Escolha a parcela.'
        : !tipoSel.value ? 'Escolha o tipo de ajuste.'
          : !(valor > 0) ? 'Informe o valor do ajuste.'
            : !dataCampo.value ? 'Informe a data do ajuste.'
              : dataCampo.value > hoje ? 'A data do ajuste não pode ser futura.'
                : motivo.length < 3 ? 'Diga o motivo do ajuste.' : '';
      if (erro) { mostrarMensagem('finAjusteMensagem', erro); return; }
      const i = impactoDoAjuste(l, valor);
      if (i.excede) { mostrarMensagem('finAjusteMensagem', `O ajuste passa do valor líquido que resta na parcela (${formatarMoeda(i.liquido_antes)}).`); return; }
      if (tipoSel.value === 'abatimento' && boletoAberto(l)) { mostrarMensagem('finAjusteMensagem', 'Parcela com boleto em aberto: conceda o abatimento no próprio boleto.'); return; }
      const confirmado = await window.DialogPadrao?.confirm?.({
        title: 'Registrar o ajuste?',
        message: `${TIPOS_AJUSTE[tipoSel.value]} de ${formatarMoeda(valor)} na parcela ${l.parcela} do pedido ${l.pedido}. Novo valor líquido: ${formatarMoeda(i.liquido)}; comissão: ${formatarMoeda(centavos(i.cms + i.royalty))}.`
          + (i.gera_estorno ? ' A comissão desta parcela já foi fechada: a diferença entra como estorno na próxima competência.' : ''),
        confirmText: 'Registrar'
      });
      if (!confirmado) return;
      processando = true;
      try {
        await fetchApi('/api/financeiro/ajustes', {
          method: 'POST',
          body: JSON.stringify({
            pedido_id: l.pedido_id, numero_parcela: l.numero_parcela, tipo: tipoSel.value, valor,
            data_ajuste: dataCampo.value, motivo, observacao: el('finAjusteObservacoes').value
          })
        });
        window.showToast?.('Ajuste registrado.', 'success');
        avisarAlteracao();
        processando = false;
        fechar();
      } catch (e) {
        mostrarMensagem('finAjusteMensagem', textoDoErro(e, 'Você não tem permissão para registrar ajustes.'));
      } finally {
        processando = false;
      }
    }

    buscaCampo.addEventListener('input', () => { montarOpcoes(); atualizar(); });
    parcelaSel.addEventListener('change', atualizar);
    tipoSel.addEventListener('change', atualizar);
    ligarCampoMoeda(valorCampo, atualizar);
    acionar(el('finAjusteRegistrar'), registrar);
    return carregar();
  }

  /**
   * Registrar produção. Depois de gravar, o modal continua aberto no mesmo
   * pedido (várias peças costumam ser lançadas em sequência) e a lista de
   * registros mostra o que entrou; o painel se relê ao fechar.
   */
  function montarProducao() {
    const buscaCampo = el('finProducaoPedidoBusca');
    const pedidoSel = el('finProducaoPedido');
    const produtoSel = el('finProducaoProduto');
    const setorSel = el('finProducaoSetor');
    const qtdCampo = el('finProducaoQuantidade');
    const dataCampo = el('finProducaoData');
    const hoje = hojeLocal();
    dataCampo.max = hoje;
    let pedidos = [];
    let dados = null;
    let pedidoAtual = 0;

    function montarPedidos() {
      const termo = buscaCampo.value.trim().toLowerCase();
      const atual = pedidoSel.value;
      const visiveis = pedidos.filter(p => !termo || String(p.numero).toLowerCase().includes(termo) || String(p.cliente || '').toLowerCase().includes(termo) || String(p.id) === atual);
      pedidoSel.replaceChildren(opcao('', visiveis.length ? 'Escolha o pedido' : 'Nenhum pedido com esta busca'));
      for (const p of visiveis.slice(0, 300)) pedidoSel.appendChild(opcao(String(p.id), [p.numero, p.cliente, p.situacao].filter(Boolean).join(' • ')));
      if (visiveis.some(p => String(p.id) === atual)) pedidoSel.value = atual;
    }

    const itemEscolhido = () => (dados?.itens || []).find(i => String(i.id) === produtoSel.value) || null;
    const setorDoItem = item => (item?.setores || []).find(s => String(s.setor_id) === setorSel.value) || null;

    /** Só os processos por que a peça escolhida passa (com insumo e pagamento ligado). */
    function montarSetores() {
      const item = itemEscolhido();
      const atual = setorSel.value;
      const doItem = new Set((item?.setores || []).map(s => String(s.setor_id)));
      const lista = (dados?.setores || []).filter(s => !item || doItem.has(String(s.id)));
      setorSel.replaceChildren(opcao('', item && !lista.length ? 'A peça não tem processo a registrar' : 'Selecione'));
      for (const s of lista) setorSel.appendChild(opcao(String(s.id), s.nome));
      if (lista.some(s => String(s.id) === atual)) setorSel.value = atual;
      else if (lista.length === 1) setorSel.value = String(lista[0].id);
    }

    function montarItens() {
      const itens = dados?.itens || [];
      produtoSel.replaceChildren(opcao('', dados ? (itens.length ? 'Escolha a peça' : 'O pedido não tem itens') : 'Escolha o pedido primeiro'));
      for (const i of itens) produtoSel.appendChild(opcao(String(i.id), `${nomeDaPeca(i)} • ${i.quantidade} un.`));
      if (itens.length === 1) produtoSel.value = String(itens[0].id);
      montarSetores();
    }

    function atualizar() {
      const item = itemEscolhido();
      const s = setorDoItem(item);
      const agora = Number(qtdCampo.value) || 0;
      el('finProducaoContexto').textContent = dados ? [`Pedido ${dados.pedido.numero}`, dados.pedido.cliente].filter(Boolean).join(' • ') : '';
      el('finProducaoPedida').textContent = s ? String(s.pedida) : (item ? String(item.quantidade) : '—');
      el('finProducaoFinalizada').textContent = s ? String(s.finalizada) : '—';
      el('finProducaoSaldo').textContent = s ? String(s.saldo) : '—';
      el('finProducaoUnitario').textContent = !s ? '—'
        : (s.valor_unitario === null ? 'sem valor' : `${formatarMoeda(s.valor_unitario)}${s.valor_origem === 'padrao' ? ' (padrão)' : ''}`);
      el('finProducaoUnitario').title = s?.regra ? `Regra: ${s.regra}` : '';
      const estoque = Boolean(item && item.do_estoque > 0);
      el('finProducaoEstoque').textContent = estoque
        ? `${item.do_estoque} das ${item.quantidade} peças do pedido saem do estoque: pagam só os insumos que ainda faltavam em cada processo (e entram primeiro no registro).`
        : '';
      el('finProducaoEstoque').classList.toggle('hidden', !estoque);
      el('finProducaoSemValor').classList.toggle('hidden', !(s && s.valor_unitario === null));
      if (!item || !s) {
        el('finProducaoStatus').value = '—';
        el('finProducaoAcumulado').textContent = '—';
        el('finProducaoRestante').textContent = '—';
        el('finProducaoTotal').textContent = '—';
        el('finProducaoConcluido').classList.add('hidden');
        mostrarMensagem('finProducaoMensagem', dados && !dados.pedido.pode_produzir
          ? `O pedido está "${dados.pedido.situacao}": só se registra produção de pedido aprovado, em produção, enviado ou entregue.` : '');
        return;
      }
      const r = statusAposRegistro(s.pedida, s.finalizada, agora);
      el('finProducaoStatus').value = r.status;
      el('finProducaoAcumulado').textContent = String(r.acumulado);
      el('finProducaoRestante').textContent = String(r.restante);
      const valorAgora = valorDasProximas(s, agora);
      el('finProducaoTotal').textContent = valorAgora === null ? '—' : formatarMoeda(valorAgora);
      el('finProducaoConcluido').classList.toggle('hidden', !(r.restante === 0 && s.pedida > 0));
      mostrarMensagem('finProducaoMensagem', r.excede ? `A quantidade passa do saldo (${s.saldo}).` : '');
    }

    function desenharRegistros() {
      const corpo = el('finProducaoRegistros');
      corpo.replaceChildren();
      const eventos = dados?.eventos || [];
      const vazio = el('finProducaoSemRegistros');
      vazio.textContent = dados ? 'Nenhuma produção registrada neste pedido.' : 'Escolha um pedido para ver os registros.';
      vazio.classList.toggle('hidden', eventos.length > 0);
      corpo.closest('.fin-tabela').classList.toggle('hidden', eventos.length === 0);
      for (const e of eventos) {
        const item = (dados.itens || []).find(i => String(i.id) === String(e.pedido_item_id));
        const acoes = criar('div', 'flex flex-wrap gap-2');
        const estornavel = e.status === 'ativo' && !e.estornado_em && !e.estorno_de && Number(e.quantidade) > 0;
        if (estornavel) botaoG(acoes, 'Estornar', () => estornar(e, item), { classe: 'btn-danger text-white', perm: 'financeiro.producao.registrar', titulo: 'Desfazer este registro' });
        let situacao;
        if (e.status === 'estornado') situacao = tagG('Estornado', 'badge-danger', e.motivo_estorno || '');
        else if (e.estorno_de) situacao = tagG('Estorno', 'badge-warning', e.observacao || '');
        else if (e.estornado_em) situacao = tagG('Estornado depois de fechar', 'badge-warning', e.motivo_estorno || '');
        else situacao = tagG('Registrado', 'badge-success', e.observacao || '');
        const tr = document.createElement('tr');
        tr.append(
          celulaG(formatarData(e.data_finalizacao), 'px-4 py-3 text-white'), celulaG(item ? nomeDaPeca(item) : `item ${e.pedido_item_id}`),
          celulaG(e.setor || '—'), celulaG(String(e.quantidade), 'px-4 py-3 text-right'), celulaG(situacao), celulaG(acoes)
        );
        corpo.appendChild(tr);
      }
    }

    async function carregarPedido({ manterEscolha = false } = {}) {
      const id = pedidoSel.value;
      const itemAntes = produtoSel.value;
      const setorAntes = setorSel.value;
      const meu = ++pedidoAtual;
      dados = null;
      if (id) {
        el('finProducaoCarregando').classList.remove('hidden');
        try {
          const lido = await fetchApi(`/api/financeiro/producao/pedidos/${encodeURIComponent(id)}`);
          if (meu !== pedidoAtual) return;
          dados = lido;
        } catch (e) {
          if (meu !== pedidoAtual) return;
          mostrarMensagem('finProducaoMensagem', textoDoErro(e, 'Você não tem permissão para registrar produção.'));
        } finally {
          if (meu === pedidoAtual) el('finProducaoCarregando').classList.add('hidden');
        }
      }
      montarItens();
      if (manterEscolha) {
        produtoSel.value = itemAntes;
        setorSel.value = setorAntes;
      }
      desenharRegistros();
      atualizar();
    }

    async function carregar() {
      el('finProducaoCarregando').classList.remove('hidden');
      try {
        const corpo = await fetchApi('/api/financeiro/producao/pedidos');
        pedidos = Array.isArray(corpo?.pedidos) ? corpo.pedidos : [];
      } catch (e) {
        pedidos = [];
        mostrarMensagem('finProducaoMensagem', textoDoErro(e, 'Você não tem permissão para registrar produção.'));
      } finally {
        el('finProducaoCarregando').classList.add('hidden');
      }
      montarPedidos();
      if (contexto.pedidoId) {
        pedidoSel.value = String(contexto.pedidoId);
        await carregarPedido();
        return;
      }
      montarItens();
      desenharRegistros();
      atualizar();
    }

    async function registrar() {
      mostrarMensagem('finProducaoMensagem', '');
      const item = itemEscolhido();
      const s = setorDoItem(item);
      const qtd = Number(qtdCampo.value);
      const erro = !dados ? 'Escolha o pedido.'
        : !item ? 'Escolha a peça do pedido.'
          : !s ? 'Escolha o processo.'
            : !(Number.isInteger(qtd) && qtd > 0) ? 'Informe quantas peças foram finalizadas (número inteiro).'
              : qtd > s.saldo ? `A quantidade passa do saldo (${s.saldo}).`
                : !dataCampo.value ? 'Informe a data da finalização.'
                  : dataCampo.value > hoje ? 'A data da finalização não pode ser futura.' : '';
      if (erro) { mostrarMensagem('finProducaoMensagem', erro); return; }
      const setorNome = (dados.setores.find(x => String(x.id) === setorSel.value) || {}).nome || '';
      const valorAgora = valorDasProximas(s, qtd);
      const parcial = (s.proximas || []).slice(0, qtd).some(f => f < 1);
      const confirmado = await window.DialogPadrao?.confirm?.({
        title: 'Registrar a produção?',
        message: `${qtd} × ${nomeDaPeca(item)} finalizada(s) em ${setorNome} no dia ${formatarData(dataCampo.value)} (pedido ${dados.pedido.numero}).`
          + (valorAgora === null ? ' Esta peça ainda não tem regra de produção neste processo.' : ` Valor: ${formatarMoeda(valorAgora)}${parcial ? ' (parte das peças saiu do estoque com o processo adiantado)' : ''}.`),
        confirmText: 'Registrar'
      });
      if (!confirmado) return;
      processando = true;
      try {
        const r = await fetchApi('/api/financeiro/producao', {
          method: 'POST',
          body: JSON.stringify({
            pedido_id: dados.pedido.id, pedido_item_id: item.id, etapa_id: Number(setorSel.value), quantidade: qtd,
            data_finalizacao: dataCampo.value, observacao: el('finProducaoObservacoes').value
          })
        });
        window.showToast?.(r?.item?.saldo === 0 ? 'Produção registrada: item finalizado neste processo.' : 'Produção registrada.', 'success');
        avisarAlteracao();
        qtdCampo.value = '';
        el('finProducaoObservacoes').value = '';
        processando = false;
        await carregarPedido({ manterEscolha: true });
      } catch (e) {
        mostrarMensagem('finProducaoMensagem', textoDoErro(e, 'Você não tem permissão para registrar produção.'));
      } finally {
        processando = false;
      }
    }

    async function estornar(e, item) {
      const motivo = await pedirTexto({
        titulo: 'Estornar este registro?',
        mensagem: `${e.quantidade} × ${item ? nomeDaPeca(item) : 'peça'} em ${e.setor || 'processo'} (${formatarData(e.data_finalizacao)}). Se a produção deste mês já foi fechada, o estorno entra como desconto no próximo fechamento.`,
        placeholder: 'Motivo do estorno (obrigatório)',
        confirmar: 'Estornar'
      });
      if (motivo === null) return;
      mostrarMensagem('finProducaoMensagem', '');
      try {
        const r = await fetchApi(`/api/financeiro/producao/${encodeURIComponent(e.id)}/estornar`, { method: 'POST', body: JSON.stringify({ motivo }) });
        window.showToast?.(r?.ja_fechado ? 'Estornado: o desconto entra no próximo fechamento.' : 'Registro estornado.', 'success');
        avisarAlteracao();
      } catch (err) {
        mostrarMensagem('finProducaoMensagem', textoDoErro(err, 'Você não tem permissão para estornar produção.'));
      }
      await carregarPedido({ manterEscolha: true });
    }

    buscaCampo.addEventListener('input', montarPedidos);
    pedidoSel.addEventListener('change', () => { mostrarMensagem('finProducaoMensagem', ''); carregarPedido(); });
    produtoSel.addEventListener('change', () => { montarSetores(); atualizar(); });
    setorSel.addEventListener('change', atualizar);
    qtdCampo.addEventListener('input', atualizar);
    acionar(el('finProducaoRegistrar'), registrar);
    return carregar();
  }

  function pintarSituacao(alvo, texto) {
    if (!alvo) return;
    const classe = texto === 'Paga' ? 'badge-success'
      : (texto === 'Fechada' ? 'badge-info' : (texto === 'Em aberto' || texto === 'A pagar' ? 'badge-warning' : 'badge-neutral'));
    alvo.className = `${classe} px-3 py-1 rounded-full text-xs font-medium justify-self-end`;
    alvo.textContent = texto;
  }

  /** Fechar competência — COMISSÕES (a produção tem tela própria: montarFecharProducao). */
  function montarFechamento() {
    const compSel = el('finFechamentoCompetencia');
    montarCompetencias(compSel, contexto.competencia);
    const confirmarBtn = el('finFechamentoConfirmar');
    let previa = null;
    let leitura = 0;
    const tipoAtual = () => 'comissao';
    const preencher = (chave, texto) => {
      const alvo = overlay.querySelector(`[data-fin-valor="${chave}"]`);
      if (alvo) alvo.textContent = texto;
    };

    function pintar() {
      const p = previa;
      el('finFechamentoBeneficiariosBloco').classList.toggle('hidden', !(p?.beneficiarios || []).length);
      pintarSituacao(el('finFechamentoSituacao'), !p ? '—' : (p.fechamento?.pagamento ? 'Paga' : (p.fechado ? 'Fechada' : 'Em aberto')));
      const info = [];
      if (p) {
        info.push(`Pagamento até ${formatarData(p.pagar_ate)}`);
        if (p.fechamento?.pagamento) info.push(`paga em ${formatarData(p.fechamento.pagamento.data_pagamento)}`);
        if (!p.fechado && p.proxima) info.push(`próxima a fechar: ${rotuloCompetenciaCurto(p.proxima)}`);
      }
      el('finFechamentoInfo').textContent = info.join(' · ');

      const moeda = v => (p ? formatarMoeda(v) : '—');
      preencher('comissoes.parcelas', p ? String(p.parcelas) : '—');
      preencher('comissoes.base', moeda(p?.base));
      preencher('comissoes.comissao', moeda(p?.comissao));
      preencher('comissoes.ajustes', moeda(p?.ajustes));
      preencher('comissoes.compensar', moeda(p?.a_compensar));
      preencher('comissoes.total', moeda(p?.a_pagar));
      const corpo = el('finFechamentoBeneficiarios');
      corpo.replaceChildren();
      for (const b of p?.beneficiarios || []) {
        const tr = document.createElement('tr');
        tr.append(...celulasDeBeneficiario(b), celulaG(formatarMoeda(b.valor), 'px-4 py-3 text-right'));
        corpo.appendChild(tr);
      }
      pintarLegendaBenef('finFechamentoBeneficiariosLegenda', p?.beneficiarios || []);
      overlay.querySelectorAll('[data-fin-compensar]').forEach(x => x.classList.toggle('hidden', !(p && Number(p.a_compensar) < 0)));

      const aberta = Boolean(p) && !p.fechado;
      const bloqueios = aberta ? (p.bloqueios || []) : [];
      el('finFechamentoBloqueiosLista').replaceChildren(...bloqueios.map(b => criar('li', null, b)));
      el('finFechamentoBloqueios').classList.toggle('hidden', !bloqueios.length);
      const avisos = aberta ? (p.avisos || []) : [];
      el('finFechamentoAvisos').replaceChildren(...avisos.map(a => criar('li', null, a)));
      el('finFechamentoAvisos').classList.toggle('hidden', !avisos.length);
      el('finFechamentoAvisoFixo').classList.toggle('hidden', Boolean(p?.fechado));
      confirmarBtn.classList.toggle('hidden', Boolean(p?.fechado));
    }

    async function carregar() {
      const minha = ++leitura;
      previa = null;
      mostrarMensagem('finFechamentoMensagem', '');
      el('finFechamentoCarregando').classList.remove('hidden');
      pintar();
      try {
        const lida = await fetchApi(`/api/financeiro/fechamentos/previa?tipo=${tipoAtual()}&competencia=${encodeURIComponent(compSel.value)}`);
        if (minha !== leitura) return;
        previa = lida;
      } catch (e) {
        if (minha !== leitura) return;
        mostrarMensagem('finFechamentoMensagem', textoDoErro(e, 'Você não tem permissão para ver comissões e produção.'));
      } finally {
        if (minha === leitura) el('finFechamentoCarregando').classList.add('hidden');
      }
      pintar();
    }

    async function confirmarFechamento() {
      mostrarMensagem('finFechamentoMensagem', '');
      if (!previa) return;
      if (!previa.pode_fechar) {
        mostrarMensagem('finFechamentoMensagem', (previa.bloqueios || []).join(' ') || 'Esta competência não pode ser fechada agora.');
        return;
      }
      const confirmado = await window.DialogPadrao?.confirm?.({
        title: 'Fechar as comissões?',
        message: `Fechar as comissões de ${rotuloCompetenciaCurto(compSel.value)}: ${formatarMoeda(previa.a_pagar)} a pagar até ${formatarData(previa.pagar_ate)}.`
          + ' Depois disso nada desta competência muda; correções entram como ajustes no mês seguinte. Não tem volta.',
        confirmText: 'Fechar competência'
      });
      if (!confirmado) return;
      processando = true;
      try {
        const r = await fetchApi('/api/financeiro/fechamentos', { method: 'POST', body: JSON.stringify({ tipo: 'comissao', competencia: compSel.value }) });
        window.showToast?.(`Comissões fechadas: ${formatarMoeda(r?.total ?? 0)} a pagar até ${formatarData(r?.pagar_ate)}.`, 'success');
        avisarAlteracao();
        processando = false;
        fechar();
      } catch (e) {
        processando = false;
        // Relê (outra máquina pode ter fechado) e mantém o motivo à vista.
        await carregar();
        mostrarMensagem('finFechamentoMensagem', textoDoErro(e, 'Você não tem permissão para fechar competência.'));
      } finally {
        processando = false;
      }
    }

    compSel.addEventListener('change', carregar);
    acionar(el('finFechamentoVerItens'), () => abrirOutro('visualizar-relatorio', { relatorio: 'comissoes-apuradas', competencia: compSel.value }));
    acionar(confirmarBtn, confirmarFechamento);
    return carregar();
  }

  /**
   * Fechar competência — PRODUÇÃO.
   *
   * O pedido que entra em produção já traz o que há para produzir (a fila de
   * cada peça em cada processo). Aqui vai um CARD por pedido: a peça abre e,
   * em cada processo, o usuário diz quantas unidades ficaram PRONTAS — o que
   * sobra fica pendente e volta no mês seguinte. "Nada pronto" (zero) também
   * é decisão, e sem decisão em todas as unidades a competência não fecha.
   */
  function montarFecharProducao() {
    const compSel = el('finFecharProducaoCompetencia');
    const caixaCards = el('finFecharProducaoCards');
    const confirmarBtn = el('finFecharProducaoConfirmar');
    montarCompetencias(compSel, contexto.competencia);
    let dados = null;
    let previa = null;
    let leitura = 0;
    const abertas = new Set();   // peças expandidas: 'pedido:item'
    const escolhas = new Map();  // 'item:etapa' -> unidades prontas (antes de confirmar)

    const chaveDaPeca = (pedido, peca) => `${pedido.pedido_id}:${peca.pedido_item_id}`;
    const chaveDoProcesso = (peca, processo) => `${peca.pedido_item_id}:${processo.etapa_id}`;
    /** Quantas unidades ainda cabem na decisão (o saldo mais o que já foi confirmado no mês). */
    const limite = processo => processo.saldo + (processo.decidido?.prontas || 0);
    /** A escolha da tela; vazio (null) = ninguém decidiu ainda. */
    const escolhido = (peca, processo) => {
      const k = chaveDoProcesso(peca, processo);
      if (escolhas.has(k)) return escolhas.get(k);
      return processo.decidido ? processo.decidido.prontas : null;
    };
    const aviso = texto => mostrarMensagem('finFecharProducaoMensagem', texto);
    const nomeDaPecaCurto = peca => [peca.codigo, peca.nome].filter(Boolean).join(' — ') || `peça ${peca.pedido_item_id}`;
    const faltamNaPeca = peca => peca.processos.filter(p => limite(p) > 0 && escolhido(peca, p) === null).length;

    // ------------------------------------------------------------ desenho
    function linhaDoProcesso(pedido, peca, processo) {
      const linha = criar('div', 'flex flex-wrap items-center justify-between gap-3 px-3 py-2 rounded-lg border border-white/10');
      const esquerda = criar('div', 'min-w-0');
      esquerda.appendChild(criar('p', 'text-sm text-white', processo.nome));
      const detalhe = [
        `${processo.saldo} un. a decidir de ${processo.pedida}`,
        processo.valor_unitario === null ? 'sem regra de produção' : `${formatarMoeda(processo.valor_unitario)} por peça inteira`,
        processo.valor_pendente === null ? null : `pendente ${formatarMoeda(processo.valor_pendente)}`
      ].filter(Boolean).join(' · ');
      const sub = criar('p', 'text-xs text-gray-400', detalhe);
      if (processo.regra) sub.title = `Regra: ${processo.regra}`;
      esquerda.appendChild(sub);
      if (processo.decidido) {
        esquerda.appendChild(criar('p', 'text-xs', `Já decidido ${processo.decidido.rotulo}: ${processo.decidido.prontas} pronta(s), ${processo.decidido.pendentes} pendente(s)`));
        esquerda.lastChild.style.color = 'var(--color-green)';
      }

      const controles = criar('div', 'flex items-center gap-2');
      const campo = criar('input', 'w-20 ctl-campo ctl-campo--pequeno bg-input border border-inputBorder text-white text-right focus:border-primary focus:ring-2 focus:ring-primary/50 transition');
      campo.type = 'number';
      campo.min = '0';
      campo.max = String(limite(processo));
      campo.step = '1';
      campo.placeholder = '—';
      const atual = escolhido(peca, processo);
      campo.value = atual === null ? '' : String(atual);
      campo.setAttribute('aria-label', `Unidades prontas em ${processo.nome}`);
      const marcar = valor => {
        escolhas.set(chaveDoProcesso(peca, processo), valor);
        campo.value = String(valor);
        pintarCabecaDaPeca(pedido, peca);
      };
      const tudo = criar('button', 'btn-success ctl-botao ctl-botao--pequeno', 'Tudo');
      tudo.type = 'button';
      tudo.title = 'Todas as unidades ficaram prontas';
      tudo.addEventListener('click', () => marcar(limite(processo)));
      const nada = criar('button', 'btn-danger ctl-botao ctl-botao--pequeno text-white', 'Nada');
      nada.type = 'button';
      nada.title = 'Nada ficou pronto: tudo fica pendente para o mês seguinte';
      nada.addEventListener('click', () => marcar(0));
      campo.addEventListener('input', () => {
        const n = Math.max(0, Math.min(limite(processo), Math.trunc(Number(campo.value) || 0)));
        escolhas.set(chaveDoProcesso(peca, processo), campo.value === '' ? null : n);
        pintarCabecaDaPeca(pedido, peca);
      });
      campo.addEventListener('blur', () => {
        const escolha = escolhido(peca, processo);
        if (escolha !== null) campo.value = String(escolha);
      });
      controles.append(tudo, nada, campo, criar('span', 'text-xs text-gray-400', `de ${limite(processo)}`));
      linha.append(esquerda, controles);
      return linha;
    }

    /** A etiqueta do cabeçalho da peça (decidida / quantas faltam). */
    function pintarCabecaDaPeca(pedido, peca) {
      const alvo = caixaCards.querySelector(`[data-peca="${chaveDaPeca(pedido, peca)}"] [data-estado]`);
      if (!alvo) return;
      const faltam = faltamNaPeca(peca);
      alvo.className = `${faltam ? 'badge-warning' : 'badge-success'} px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap`;
      alvo.textContent = faltam ? `${faltam} processo(s) a decidir` : 'Tudo decidido';
      // O hover diz QUANDO esta peça foi decidida (pedido do dono, 24/09/2026).
      alvo.title = faltam
        ? 'Falta dizer quantas unidades ficaram prontas nestes processos'
        : (peca.decidida_em ? `Decidida em ${instanteCurto(peca.decidida_em)}` : 'Todos os processos desta peça já foram decididos');
    }

    function blocoDaPeca(pedido, peca) {
      const chave = chaveDaPeca(pedido, peca);
      const bloco = criar('div', 'rounded-lg border border-white/10');
      bloco.dataset.peca = chave;

      const cabeca = criar('button', 'w-full flex items-center justify-between gap-3 px-4 py-3 text-left');
      cabeca.type = 'button';
      const esquerda = criar('div', 'min-w-0');
      const nomeInteiro = nomeDaPecaCurto(peca);
      const codigo = criar('span', 'fin-tag-produto fin-tag-produto--bordo', peca.codigo || nomeInteiro);
      codigo.title = nomeInteiro;
      codigo.setAttribute('aria-label', nomeInteiro);
      const linhaCodigo = criar('div', 'flex items-center gap-2 flex-wrap');
      linhaCodigo.appendChild(codigo);
      // "Tudo" e "Nada" da PEÇA inteira, na frente do código (pedido do dono,
      // 24/09/2026): decidem todos os processos dela de uma vez. Peça já
      // decidida mantém os botões VISÍVEIS, só inativos.
      const marcarPeca = valor => {
        for (const processo of peca.processos) {
          if (!processo.saldo) continue;
          escolhas.set(chaveDoProcesso(peca, processo), valor === 'tudo' ? limite(processo) : 0);
        }
        pintar();
      };
      const botaoDaPeca = (rotulo, classe, titulo, valor) => {
        const b = criar('button', `${classe} ctl-botao ctl-botao--pequeno`, rotulo);
        b.type = 'button';
        b.title = titulo;
        b.dataset.perm = 'financeiro.producao.registrar';
        b.disabled = peca.decidida;
        if (peca.decidida) b.title = `Peça já decidida${peca.decidida_em ? ` em ${instanteCurto(peca.decidida_em)}` : ''}`;
        // O clique é da peça, não do cabeçalho que abre/fecha o bloco.
        b.addEventListener('click', e => { e.stopPropagation(); if (!b.disabled) marcarPeca(valor); });
        return b;
      };
      linhaCodigo.append(
        botaoDaPeca('Tudo', 'btn-success', 'Todas as unidades de todos os processos desta peça ficaram prontas', 'tudo'),
        botaoDaPeca('Nada', 'btn-danger text-white', 'Nada desta peça ficou pronto: tudo fica pendente para o mês seguinte', 'nada')
      );
      esquerda.appendChild(linhaCodigo);
      esquerda.appendChild(criar('p', 'text-xs text-gray-400 mt-1', `${peca.quantidade} un.${peca.do_estoque ? ` · ${peca.do_estoque} do estoque (paga só o que faltava)` : ''}`));
      const direita = criar('div', 'flex items-center gap-2');
      const estado = criar('span', 'badge-warning px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap', '');
      estado.dataset.estado = 'true';
      const seta = criar('i', 'fas fa-chevron-down text-xs text-gray-400');
      direita.append(estado, seta);
      cabeca.append(esquerda, direita);

      const corpo = criar('div', 'px-4 pb-4 space-y-2');
      for (const processo of peca.processos) corpo.appendChild(linhaDoProcesso(pedido, peca, processo));
      const rodape = criar('div', 'flex justify-end pt-1');
      const confirmar = criar('button', 'btn-success ctl-botao', 'Confirmar peça');
      confirmar.type = 'button';
      confirmar.dataset.perm = 'financeiro.producao.registrar';
      acionar(confirmar, () => confirmarPeca(pedido, peca));
      rodape.appendChild(confirmar);
      corpo.appendChild(rodape);
      corpo.classList.toggle('hidden', !abertas.has(chave));
      seta.classList.toggle('fa-chevron-up', abertas.has(chave));

      cabeca.addEventListener('click', () => {
        const aberto = abertas.has(chave);
        if (aberto) abertas.delete(chave); else abertas.add(chave);
        corpo.classList.toggle('hidden', aberto);
        seta.classList.toggle('fa-chevron-up', !aberto);
      });

      bloco.append(cabeca, corpo);
      return bloco;
    }

    function cardDoPedido(pedido) {
      const card = criar('div', 'glass-surface rounded-xl border border-white/10 px-5 py-5 space-y-4');
      const topo = criar('div', 'flex items-start justify-between gap-3');
      const titulo = criar('div', 'min-w-0');
      titulo.appendChild(criar('p', 'text-white font-semibold truncate', `Pedido ${pedido.numero}`));
      titulo.appendChild(criar('p', 'text-xs text-gray-400 truncate', [pedido.cliente, pedido.situacao].filter(Boolean).join(' • ')));
      topo.append(titulo, pedido.confirmado
        ? tagG('Confirmado', 'badge-success', pedido.confirmado_em
          ? `Tudo confirmado em ${instanteCurto(pedido.confirmado_em)}`
          : 'Todas as peças deste pedido já foram decididas')
        : tagG(`${pedido.unidades_pendentes} un. a decidir`, 'badge-warning', 'Diga, em cada processo de cada peça, quantas unidades ficaram prontas'));
      card.appendChild(topo);

      const etiquetas = criar('div', 'flex flex-wrap items-center gap-2');
      etiquetas.appendChild(tagG(`Pendente: ${formatarMoeda(pedido.valor_pendente)}`, 'badge-neutral'));
      if (pedido.sem_valor) {
        // O hover diz QUAIS peças estão sem regra (pedido do dono, 24/09/2026).
        const quais = (pedido.pecas_sem_valor || []).join(', ');
        etiquetas.appendChild(tagG('Peça sem regra de produção', 'badge-danger',
          `${quais ? `${quais}. ` : ''}Acerte em "Regras" ou no cadastro da peça: sem valor a competência não fecha`));
      }
      // "Tudo pronto" e "Nada pronto" do PEDIDO inteiro. Já confirmado: os
      // dois continuam VISÍVEIS, só inativos, com a data no hover.
      const botaoDoPedido = (rotulo, classe, titulo, fn) => {
        const b = criar('button', `${classe} ctl-botao ctl-botao--pequeno`, rotulo);
        b.type = 'button';
        b.dataset.perm = 'financeiro.producao.registrar';
        b.title = pedido.confirmado
          ? `Pedido já confirmado${pedido.confirmado_em ? ` em ${instanteCurto(pedido.confirmado_em)}` : ''}`
          : titulo;
        b.disabled = Boolean(pedido.confirmado);
        if (!pedido.confirmado) acionar(b, fn);
        return b;
      };
      etiquetas.append(
        botaoDoPedido('Tudo pronto neste pedido', 'btn-success', 'Todas as unidades de todos os processos ficaram prontas', () => confirmarPedidoInteiro(pedido)),
        botaoDoPedido('Nada pronto', 'btn-danger text-white', 'Nada deste pedido ficou pronto: tudo fica pendente para o mês seguinte', () => marcarPedidoInteiro(pedido, 'nada'))
      );
      card.appendChild(etiquetas);

      for (const peca of pedido.pecas) card.appendChild(blocoDaPeca(pedido, peca));
      return card;
    }

    function pintar() {
      const totais = dados?.totais || null;
      el('finFecharProducaoPedidos').textContent = totais ? `${totais.pendentes} de ${totais.pedidos}` : '—';
      el('finFecharProducaoUnidades').textContent = totais ? String(totais.unidades_pendentes) : '—';
      el('finFecharProducaoPendente').textContent = totais ? formatarMoeda(totais.valor_pendente) : '—';
      el('finFecharProducaoConfirmado').textContent = previa ? formatarMoeda(previa.a_pagar) : '—';
      pintarSituacao(el('finFecharProducaoSituacao'), !previa ? '—' : (previa.fechamento?.pagamento ? 'Paga' : (previa.fechado ? 'Fechada' : 'Em aberto')));

      caixaCards.replaceChildren();
      for (const pedido of dados?.pedidos || []) caixaCards.appendChild(cardDoPedido(pedido));
      for (const pedido of dados?.pedidos || []) for (const peca of pedido.pecas) pintarCabecaDaPeca(pedido, peca);
      el('finFecharProducaoVazio').classList.toggle('hidden', Boolean(dados?.pedidos?.length) || !dados);

      // Peças e processos são coisas diferentes: 2 peças × 4 processos = 8
      // linhas de pagamento, mas 2 peças (defeito pego pelo dono em 24/09).
      el('finFecharProducaoPecas').textContent = previa
        ? `${previa.contagem?.pecas ?? previa.pecas ?? 0} · ${previa.contagem?.processos ?? previa.processos ?? 0} processo(s)`
        : '—';
      el('finFecharProducaoTotal').textContent = previa ? formatarMoeda(previa.a_pagar) : '—';
      const processos = el('finFecharProducaoProcessos');
      processos.replaceChildren();
      for (const s of previa?.setores || []) {
        const linha = criar('div', 'flex items-center justify-between px-4 py-3');
        linha.append(
          criar('span', 'text-sm text-gray-400', `${s.setor} (${s.pecas} ${Math.abs(s.pecas) === 1 ? 'peça' : 'peças'})`),
          criar('span', 'text-sm text-white', formatarMoeda(s.total))
        );
        processos.appendChild(linha);
      }

      const aberta = Boolean(previa) && !previa.fechado;
      const bloqueios = aberta ? (previa.bloqueios || []) : [];
      el('finFecharProducaoBloqueiosLista').replaceChildren(...bloqueios.map(b => criar('li', null, b)));
      el('finFecharProducaoBloqueios').classList.toggle('hidden', !bloqueios.length);
      const avisos = aberta ? (previa.avisos || []) : [];
      el('finFecharProducaoAvisos').replaceChildren(...avisos.map(a => criar('li', null, a)));
      el('finFecharProducaoAvisos').classList.toggle('hidden', !avisos.length);
      confirmarBtn.classList.toggle('hidden', Boolean(previa?.fechado));
    }

    // ------------------------------------------------------------ dados
    async function carregar() {
      const minha = ++leitura;
      aviso('');
      el('finFecharProducaoCarregando').classList.remove('hidden');
      try {
        const [pend, prev] = await Promise.all([
          fetchApi(`/api/financeiro/producao/pendencias?competencia=${encodeURIComponent(compSel.value)}`),
          fetchApi(`/api/financeiro/fechamentos/previa?tipo=producao&competencia=${encodeURIComponent(compSel.value)}`).catch(() => null)
        ]);
        if (minha !== leitura) return;
        dados = pend;
        previa = prev;
        el('finFecharProducaoSemSql').classList.add('hidden');
      } catch (e) {
        if (minha !== leitura) return;
        dados = null;
        if (e?.corpo?.sql_pendente) {
          el('finFecharProducaoSemSqlTexto').textContent = e.message;
          el('finFecharProducaoSemSql').classList.remove('hidden');
        } else {
          aviso(textoDoErro(e, 'Você não tem permissão para ver a produção.'));
        }
      } finally {
        if (minha === leitura) el('finFecharProducaoCarregando').classList.add('hidden');
      }
      pintar();
    }

    async function enviarDecisoes(pedido, decisoes, mensagem) {
      try {
        await fetchApi('/api/financeiro/producao/confirmar', {
          method: 'POST',
          body: JSON.stringify({ competencia: compSel.value, pedido_id: pedido.pedido_id, decisoes })
        });
        window.showToast?.(mensagem, 'success');
        avisarAlteracao();
        await carregar();
      } catch (e) {
        aviso(textoDoErro(e, 'Você não tem permissão para registrar produção.'));
      }
    }

    async function confirmarPeca(pedido, peca) {
      aviso('');
      const decisoes = [];
      for (const processo of peca.processos) {
        if (!limite(processo)) continue;
        const valor = escolhido(peca, processo);
        if (valor === null) {
          aviso(`${nomeDaPecaCurto(peca)}: diga quantas unidades ficaram prontas em ${processo.nome} (pode ser zero).`);
          return;
        }
        decisoes.push({ pedido_item_id: peca.pedido_item_id, etapa_id: processo.etapa_id, prontas: valor });
      }
      if (!decisoes.length) return;
      abertas.delete(chaveDaPeca(pedido, peca));
      await enviarDecisoes(pedido, decisoes, `${nomeDaPecaCurto(peca)} confirmada no pedido ${pedido.numero}.`);
    }

    async function confirmarPedidoInteiro(pedido) {
      const confirmado = await window.DialogPadrao?.confirm?.({
        title: 'Tudo pronto neste pedido?',
        message: `Todas as unidades pendentes do pedido ${pedido.numero} entram como prontas nesta competência `
          + `(${pedido.unidades_pendentes} un., ${formatarMoeda(pedido.valor_pendente)}).`,
        confirmText: 'Confirmar tudo'
      });
      if (!confirmado) return;
      const decisoes = pedido.pecas.flatMap(peca => peca.processos
        .filter(processo => limite(processo) > 0)
        .map(processo => ({ pedido_item_id: peca.pedido_item_id, etapa_id: processo.etapa_id, prontas: limite(processo) })));
      if (!decisoes.length) return;
      for (const peca of pedido.pecas) abertas.delete(chaveDaPeca(pedido, peca));
      await enviarDecisoes(pedido, decisoes, `Pedido ${pedido.numero} confirmado por inteiro.`);
    }

    /**
     * "Nada pronto": nenhuma unidade do pedido ficou pronta — tudo volta no
     * mês seguinte. É a outra ponta do "Tudo pronto" (pedido do dono,
     * 24/09/2026), e pede confirmação porque joga a competência inteira do
     * pedido para a frente.
     */
    async function marcarPedidoInteiro(pedido) {
      const confirmado = await window.DialogPadrao?.confirm?.({
        title: 'Nada pronto neste pedido?', tom: 'aviso', icone: 'fa-industry',
        message: `Nenhuma unidade pendente do pedido ${pedido.numero} entra nesta competência `
          + `(${pedido.unidades_pendentes} un., ${formatarMoeda(pedido.valor_pendente)} ficam para o mês seguinte).`,
        confirmText: 'Nada ficou pronto', confirmVariant: 'danger'
      });
      if (!confirmado) return;
      const decisoes = pedido.pecas.flatMap(peca => peca.processos
        .filter(processo => limite(processo) > 0)
        .map(processo => ({ pedido_item_id: peca.pedido_item_id, etapa_id: processo.etapa_id, prontas: 0 })));
      if (!decisoes.length) return;
      for (const peca of pedido.pecas) abertas.delete(chaveDaPeca(pedido, peca));
      await enviarDecisoes(pedido, decisoes, `Pedido ${pedido.numero}: nada ficou pronto nesta competência.`);
    }

    async function fecharCompetencia() {
      aviso('');
      if (!previa) return;
      // Tudo confirmado, mas o rateio ainda não está fechado: em vez de
      // barrar, leva direto para a tela de distribuir (pedido do dono,
      // 24/09/2026) — é o último passo antes de fechar.
      const rateio = previa.rateio;
      if (rateio && !rateio.sql_pendente && rateio.colaboradores > 0 && rateio.pendentes > 0
        && !(previa.bloqueios || []).some(b => /confirmar a produção|sem valor/i.test(b))) {
        const ir = await window.DialogPadrao?.confirm?.({
          title: 'Falta dizer quem fez o quê', tom: 'aviso', icone: 'fa-users',
          message: `${rateio.pendentes === 1 ? '1 processo ainda não foi distribuído' : `${rateio.pendentes} processos ainda não foram distribuídos`} entre os colaboradores. `
            + 'A competência só fecha com 100% de cada processo distribuído.',
          confirmText: 'Distribuir agora'
        });
        if (ir) abrirOutro('rateio-producao', { competencia: compSel.value });
        return;
      }
      if (!previa.pode_fechar) {
        aviso((previa.bloqueios || []).join(' ') || 'Esta competência não pode ser fechada agora.');
        return;
      }
      const confirmado = await window.DialogPadrao?.confirm?.({
        title: 'Fechar a produção?',
        message: `Fechar a produção de ${rotuloCompetenciaCurto(compSel.value)}: ${formatarMoeda(previa.a_pagar)} a pagar até ${formatarData(previa.pagar_ate)}.`
          + ' O que ficou pendente volta no mês seguinte. Depois disso nada desta competência muda. Não tem volta.',
        confirmText: 'Fechar competência'
      });
      if (!confirmado) return;
      processando = true;
      try {
        const r = await fetchApi('/api/financeiro/fechamentos', { method: 'POST', body: JSON.stringify({ tipo: 'producao', competencia: compSel.value }) });
        window.showToast?.(`Produção fechada: ${formatarMoeda(r?.total ?? 0)} a pagar até ${formatarData(r?.pagar_ate)}.`, 'success');
        avisarAlteracao();
        processando = false;
        fechar();
      } catch (e) {
        processando = false;
        await carregar();
        aviso(textoDoErro(e, 'Você não tem permissão para fechar competência.'));
      } finally {
        processando = false;
      }
    }

    compSel.addEventListener('change', () => { escolhas.clear(); abertas.clear(); carregar(); });
    acionar(confirmarBtn, fecharCompetencia);
    return carregar();
  }

  function montarConfirmarPagamento() {
    const compSel = el('finPagamentoCompetencia');
    montarCompetencias(compSel, contexto.competencia);
    const radios = overlay.querySelectorAll('input[name="finPagamentoTipo"]');
    if (contexto.tipo) radios.forEach(r => { r.checked = r.value === contexto.tipo; });
    const dataCampo = el('finPagamentoData');
    const formaSel = el('finPagamentoForma');
    const confirmarBtn = el('finPagamentoConfirmar');
    const caixaQuem = el('finPagamentoQuemRecebe');
    const listaQuem = el('finPagamentoBeneficiarios');
    const tudoCampo = el('finPagamentoTudo');
    const hoje = hojeLocal();
    dataCampo.max = hoje;
    const listas = {};
    const escolhidos = new Set(); // as linhas de "quem recebe" marcadas (tipo|pessoa)
    const TIPOS_COMISSAO = { cms: 'CMS', royalty: 'Royalty' };
    const semAcento = t => String(t ?? '').normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
    const somaDe = linhas => Math.round(linhas.reduce((s, l) => s + l.valor, 0) * 100) / 100;
    const tipoAtual = () => overlay.querySelector('input[name="finPagamentoTipo"]:checked')?.value || 'comissao';
    const atual = () => (listas[tipoAtual()] || []).find(f => f.competencia === compSel.value) || null;

    /**
     * Quem recebe as comissões da competência: o resumo congelado no
     * fechamento vira uma linha por tipo (CMS/Royalty) de cada pessoa, já
     * dizendo se aquela linha foi paga — sozinha, junto com o tipo inteiro,
     * junto com a pessoa inteira ou no pagamento de tudo.
     */
    function linhasDe(f) {
      if (!f || f.tipo !== 'comissao') return [];
      const mapa = new Map();
      for (const r of (f.resumo || [])) {
        if (!r?.beneficiario || !TIPOS_COMISSAO[r.tipo]) continue;
        const chave = `${r.tipo}|${semAcento(r.beneficiario)}`;
        const linha = mapa.get(chave) || { chave, tipo: r.tipo, beneficiario: r.beneficiario, valor: 0, pago: null };
        linha.valor = Math.round((linha.valor + (Number(r.valor) || 0)) * 100) / 100;
        mapa.set(chave, linha);
      }
      const linhas = [...mapa.values()]
        .sort((a, b) => b.valor - a.valor || String(a.beneficiario).localeCompare(String(b.beneficiario), 'pt-BR'));
      for (const linha of linhas) {
        linha.pago = (f.pagamentos || []).find(p => (!p.beneficiario || semAcento(p.beneficiario) === semAcento(linha.beneficiario))
          && (!p.tipo_comissao || p.tipo_comissao === linha.tipo)) || null;
      }
      return linhas;
    }

    function pintarQuemRecebe(f) {
      const linhas = linhasDe(f);
      caixaQuem.classList.toggle('hidden', !linhas.length);
      listaQuem.replaceChildren();
      for (const chave of [...escolhidos]) {
        if (!linhas.some(l => l.chave === chave && !l.pago)) escolhidos.delete(chave);
      }
      if (!linhas.length) return linhas;
      for (const linha of linhas) {
        const item = criar('li', 'fin-benef__item');
        const nome = criar('label', 'fin-benef__nome');
        const marca = criar('input');
        marca.type = 'checkbox';
        marca.style.accentColor = 'var(--color-primary)';
        marca.checked = escolhidos.has(linha.chave);
        marca.disabled = Boolean(linha.pago) || tudoCampo.checked;
        marca.addEventListener('change', () => {
          if (marca.checked) escolhidos.add(linha.chave); else escolhidos.delete(linha.chave);
          pintar();
        });
        nome.appendChild(marca);
        if (window.Beneficiarios) nome.appendChild(window.Beneficiarios.ponto(linha.beneficiario));
        nome.appendChild(criar('span', null, linha.beneficiario));
        nome.appendChild(criar('span', `fin-etiqueta-benef__tipo fin-etiqueta-benef__tipo--${linha.tipo}`, TIPOS_COMISSAO[linha.tipo]));
        if (linha.pago) nome.appendChild(criar('span', 'fin-benef__pago', `pago em ${formatarData(linha.pago.data)}`));
        item.append(nome, criar('span', 'fin-benef__valor', formatarMoeda(linha.valor)));
        listaQuem.appendChild(item);
      }
      const legenda = el('finPagamentoLegenda');
      if (legenda && window.Beneficiarios) legenda.replaceChildren(window.Beneficiarios.legenda([]));
      return linhas;
    }

    function pintar() {
      const lida = Boolean(listas[tipoAtual()]);
      const f = atual();
      const linhas = pintarQuemRecebe(f);
      const porPessoa = Boolean(linhas.length) && !tudoCampo.checked;
      const selecionadas = linhas.filter(l => !l.pago && escolhidos.has(l.chave));
      const falta = f ? Number(f.falta_pagar ?? f.total) || 0 : 0;
      const pago = f ? Number(f.pago) || 0 : 0;
      const valor = !f ? null : (porPessoa ? somaDe(selecionadas) : falta);
      el('finPagamentoValor').value = valor == null ? '—' : formatarMoeda(valor);
      const selo = el('finPagamentoSelecao');
      if (selo) {
        selo.textContent = !f ? '—'
          : porPessoa ? `selecionado: ${formatarMoeda(somaDe(selecionadas))}`
            : `falta pagar: ${formatarMoeda(falta)}`;
      }
      pintarSituacao(el('finPagamentoSituacao'), !lida ? '—'
        : (!f ? 'Não fechada' : (!(falta > 0) && pago > 0 ? 'Paga' : (pago > 0 ? 'Parcial' : 'A pagar'))));
      let info = '';
      if (lida) {
        const nome = tipoAtual() === 'comissao' ? 'As comissões' : 'A produção';
        const prazo = `pagamento até ${formatarData(f?.pagar_ate)}${f?.pagar_ate && hoje > f.pagar_ate ? ' — prazo vencido' : ''}`;
        if (!f) info = `${nome} de ${rotuloCompetenciaCurto(compSel.value)} ainda não foi fechada: feche a competência antes de confirmar o pagamento.`;
        else if (!(Number(f.total) > 0)) info = 'Não há valor a pagar nesta competência (o saldo ficou para compensar no mês seguinte).';
        else if (!(falta > 0)) info = `Paga por inteiro: ${formatarMoeda(pago)} em ${f.pagamentos?.length === 1 ? '1 pagamento' : `${f.pagamentos?.length || 1} pagamentos`}.`;
        else if (pago > 0) info = `Já foram pagos ${formatarMoeda(pago)} de ${formatarMoeda(f.total)}; faltam ${formatarMoeda(falta)} — ${prazo}.`;
        else info = `Fechada; ${prazo}.`;
      }
      el('finPagamentoInfo').textContent = info;
      confirmarBtn.classList.toggle('hidden', !(falta > 0));
    }

    async function carregar() {
      const tipo = tipoAtual();
      if (!listas[tipo]) {
        try {
          const r = await fetchApi(`/api/financeiro/fechamentos?tipo=${tipo}`);
          listas[tipo] = Array.isArray(r?.fechamentos) ? r.fechamentos : [];
        } catch (e) {
          mostrarMensagem('finPagamentoMensagem', textoDoErro(e, 'Você não tem permissão para ver os fechamentos.'));
        }
      }
      pintar();
    }

    async function confirmarPagamento() {
      mostrarMensagem('finPagamentoMensagem', '');
      const f = atual();
      const linhas = linhasDe(f);
      const porPessoa = Boolean(linhas.length) && !tudoCampo.checked;
      const alvos = porPessoa ? linhas.filter(l => !l.pago && escolhidos.has(l.chave)) : [];
      const falta = f ? Number(f.falta_pagar ?? f.total) || 0 : 0;
      const valor = porPessoa ? somaDe(alvos) : falta;
      const erro = !f ? 'Esta competência ainda não foi fechada.'
        : !(Number(f.total) > 0) ? 'Não há valor a pagar nesta competência.'
          : !(falta > 0) ? 'O pagamento desta competência já foi confirmado por inteiro.'
            : porPessoa && !alvos.length ? 'Escolha quem foi pago (ou marque "Pagar tudo o que falta").'
              : !dataCampo.value ? 'Informe a data do pagamento.'
                : dataCampo.value > hoje ? 'A data do pagamento não pode ser futura.'
                  : !formaSel.value ? 'Informe como foi pago.' : '';
      if (erro) { mostrarMensagem('finPagamentoMensagem', erro); return; }
      const tipo = tipoAtual();
      const quem = porPessoa ? alvos.map(l => `${TIPOS_COMISSAO[l.tipo]} de ${l.beneficiario}`).join(', ') : 'tudo o que falta';
      const confirmado = await window.DialogPadrao?.confirm?.({
        title: 'Confirmar o pagamento?',
        message: `${tipo === 'comissao' ? 'Comissões' : 'Produção'} de ${rotuloCompetenciaCurto(compSel.value)} — ${quem}: `
          + `${formatarMoeda(valor)} pagos em ${formatarData(dataCampo.value)} (${formaSel.value}). Não tem volta.`,
        confirmText: 'Confirmar pagamento'
      });
      if (!confirmado) return;
      const base = { tipo, competencia: compSel.value, data_pagamento: dataCampo.value, forma: formaSel.value, observacao: el('finPagamentoObservacoes').value };
      // Um pagamento por beneficiário escolhido: cada um fica registrado com o nome dele.
      const envios = porPessoa ? alvos.map(l => ({ ...base, beneficiario: l.beneficiario, tipo_comissao: l.tipo })) : [base];
      processando = true;
      let feitos = 0;
      let atrasado = false;
      try {
        for (const corpo of envios) {
          const r = await fetchApi('/api/financeiro/pagamentos', { method: 'POST', body: JSON.stringify(corpo) });
          feitos += 1;
          atrasado = atrasado || Boolean(r?.atrasado);
        }
        window.showToast?.(atrasado ? 'Pagamento confirmado (depois do prazo).' : 'Pagamento confirmado.', 'success');
        avisarAlteracao();
        processando = false;
        fechar();
      } catch (e) {
        // Se parte já entrou, a tela recarrega para mostrar o que falta.
        const parcial = feitos ? `${feitos} de ${envios.length} pagamentos já foram gravados. ` : '';
        mostrarMensagem('finPagamentoMensagem', parcial + textoDoErro(e, 'Você não tem permissão para confirmar pagamentos.'));
        if (feitos) {
          avisarAlteracao();
          listas[tipo] = null;
          escolhidos.clear();
          await carregar();
        }
      } finally {
        processando = false;
      }
    }

    radios.forEach(r => r.addEventListener('change', () => { escolhidos.clear(); carregar(); }));
    compSel.addEventListener('change', () => { escolhidos.clear(); pintar(); });
    tudoCampo?.addEventListener('change', pintar);
    acionar(confirmarBtn, confirmarPagamento);
    return carregar();
  }

  /**
   * Confirmar reembolso: o que voltou para o cliente numa devolução de pedido
   * (nasce pendente em Pedidos → Visualizar → Devolução). A pendência do painel
   * já chega com o reembolso escolhido; pela ação rápida, escolhe-se na lista.
   */
  function montarConfirmarReembolso() {
    const qualSel = el('finReembolsoQual');
    const dataCampo = el('finReembolsoData');
    const formaSel = el('finReembolsoForma');
    const confirmarBtn = el('finReembolsoConfirmar');
    const hoje = hojeLocal();
    dataCampo.max = hoje;
    dataCampo.value = hoje;
    let pendentes = [];
    const atual = () => pendentes.find(r => String(r.id) === qualSel.value) || null;

    function pintar() {
      const r = atual();
      el('finReembolsoValor').value = r ? formatarMoeda(r.valor) : '—';
      pintarSituacao(el('finReembolsoSituacao'), r ? 'A pagar' : '—');
      confirmarBtn.classList.toggle('hidden', !r);
    }

    async function carregar() {
      try {
        const r = await fetchApi('/api/devolucoes/reembolsos?status=pendente');
        pendentes = Array.isArray(r?.reembolsos) ? r.reembolsos : [];
        qualSel.replaceChildren(...(pendentes.length ? [] : [opcao('', 'Nenhum reembolso a pagar')]),
          ...pendentes.map(x => opcao(String(x.id), [`Pedido ${x.pedido}`, x.cliente || '', formatarMoeda(x.valor)].filter(Boolean).join(' · '))));
        formaSel.replaceChildren(opcao('', 'Selecione'), ...(Array.isArray(r?.formas) ? r.formas : []).map(x => opcao(x, x)));
        if (contexto.reembolso_id && pendentes.some(x => String(x.id) === String(contexto.reembolso_id))) qualSel.value = String(contexto.reembolso_id);
      } catch (e) {
        mostrarMensagem('finReembolsoMensagem', e?.corpo?.sql_pendente
          ? 'Falta ativar a devolução no banco: rode sql/devolucoes.sql e reinicie a API.'
          : textoDoErro(e, 'Você não tem permissão para ver os reembolsos.'));
      }
      pintar();
    }

    async function confirmarReembolso() {
      mostrarMensagem('finReembolsoMensagem', '');
      const r = atual();
      const erro = !r ? 'Escolha o reembolso.'
        : !dataCampo.value ? 'Informe a data do reembolso.'
          : dataCampo.value > hoje ? 'A data do reembolso não pode ser futura.'
            : !formaSel.value ? 'Informe como foi pago.' : '';
      if (erro) { mostrarMensagem('finReembolsoMensagem', erro); return; }
      const confirmado = await window.DialogPadrao?.confirm?.({
        title: 'Confirmar o reembolso?',
        message: `Pedido ${r.pedido}${r.cliente ? ` (${r.cliente})` : ''}: ${formatarMoeda(r.valor)} devolvidos ao cliente em ${formatarData(dataCampo.value)} (${formaSel.value}). Não tem volta.`,
        confirmText: 'Confirmar reembolso'
      });
      if (!confirmado) return;
      processando = true;
      try {
        await fetchApi(`/api/devolucoes/reembolsos/${encodeURIComponent(r.id)}/confirmar`, {
          method: 'POST',
          body: JSON.stringify({ data_pagamento: dataCampo.value, forma: formaSel.value, observacao: el('finReembolsoObservacoes').value })
        });
        window.showToast?.('Reembolso confirmado.', 'success');
        avisarAlteracao();
        processando = false;
        fechar();
      } catch (e) {
        mostrarMensagem('finReembolsoMensagem', textoDoErro(e, 'Você não tem permissão para confirmar reembolsos.'));
      } finally {
        processando = false;
      }
    }

    qualSel.addEventListener('change', pintar);
    acionar(confirmarBtn, confirmarReembolso);
    return carregar();
  }

  function montarRelatorios() {
    montarCompetencias(el('finRelCompetencia'), contexto.competencia);
    ligarAbas();
    const filtro = el('finRelFiltro');
    const alternarFiltro = () => {
      const porPeriodo = filtro.value === 'periodo';
      el('finRelCompetenciaBloco').classList.toggle('hidden', porPeriodo);
      el('finRelPeriodoBloco').classList.toggle('hidden', !porPeriodo);
    };
    filtro.addEventListener('change', alternarFiltro);
    alternarFiltro();
    if (contexto.relatorio) {
      const radio = [...overlay.querySelectorAll('input[name="finRelatorio"]')].find(r => r.value === contexto.relatorio);
      if (radio) {
        radio.checked = true;
        const aba = radio.closest('[data-fin-painel]')?.dataset.finPainel;
        if (aba) overlay.querySelector(`[data-fin-aba="${aba}"]`)?.click();
      }
    }

    async function gerar() {
      mostrarMensagem('finRelatoriosMensagem', '');
      const formato = overlay.querySelector('input[name="finRelFormato"]:checked')?.value || 'visualizar';
      const relatorio = overlay.querySelector('input[name="finRelatorio"]:checked')?.value;
      if (!relatorio) { mostrarMensagem('finRelatoriosMensagem', 'Escolha o relatório.'); return; }
      const porPeriodo = filtro.value === 'periodo';
      const competencia = porPeriodo ? (contexto.competencia || competenciaAtual()) : el('finRelCompetencia').value;
      const periodo = porPeriodo ? { inicio: el('finRelPeriodoInicio').value, fim: el('finRelPeriodoFim').value } : null;
      if (periodo && (!periodo.inicio || !periodo.fim)) { mostrarMensagem('finRelatoriosMensagem', 'Informe o período (de e até).'); return; }
      if (periodo && periodo.inicio > periodo.fim) { mostrarMensagem('finRelatoriosMensagem', 'O período está invertido.'); return; }
      if (formato === 'visualizar') {
        abrirOutro('visualizar-relatorio', { relatorio, competencia, periodo });
        return;
      }
      try {
        const dados = await buscarRelatorio(relatorio, { competencia, periodo });
        if (!dados.linhas.length) { mostrarMensagem('finRelatoriosMensagem', 'Nenhum registro para este relatório com esse filtro.'); return; }
        await exportarRelatorio(formato, dados);
      } catch (e) {
        mostrarMensagem('finRelatoriosMensagem', textoDoErro(e, 'Você não tem permissão para ver este relatório.'));
      }
    }

    acionar(el('finRelGerar'), gerar);
  }

  async function montarVisualizarRelatorio() {
    const chave = RELATORIOS[contexto.relatorio] ? contexto.relatorio : 'comissoes-apuradas';
    const competencia = contexto.competencia || competenciaAtual();
    const periodo = contexto.periodo?.inicio ? contexto.periodo : null;
    let relatorio = { ...montarRelatorio(chave, { linhas: [] }), competencia, periodo, filtro: '' };
    let carregado = false;
    let quemRecebe = '';
    const temColunaBenef = (RELATORIOS[chave]?.colunas || []).some(c => c.tipo === 'beneficiarios');
    const selQuem = el('finRelatorioQuemRecebe');
    // Relatório de comissão: a linha abre os Detalhes da parcela.
    const destinoDaLinha = l => (RELATORIOS_DE_PARCELA.has(chave) && l.pedido_id && l.numero_parcela ? 'detalhes-parcela' : null);

    /** O relatório como está na tela: já filtrado por quem recebe (é o que se exporta). */
    function visivel() {
      const linhas = filtrarPorBeneficiario(relatorio.linhas, quemRecebe);
      const opcoes = opcoesDeBeneficiario(relatorio.linhas);
      const marca = quemRecebe ? ` • Quem recebe: ${rotuloDoFiltroBenef(quemRecebe, opcoes)}` : '';
      return { ...relatorio, ...montarRelatorio(chave, { linhas }), filtro: `${relatorio.filtro || ''}${marca}` };
    }

    /** O filtro só existe onde há quem receba: monta as opções a cada leitura. */
    function pintarFiltroBenef() {
      const bloco = el('finRelatorioQuemRecebeBloco');
      if (!bloco || !selQuem) return;
      const opcoes = opcoesDeBeneficiario(relatorio.linhas);
      const tem = temColunaBenef && (opcoes.pessoas.length > 0 || opcoes.tipos.length > 0);
      bloco.classList.toggle('hidden', !tem);
      if (!tem) { quemRecebe = ''; return; }
      const escolhido = quemRecebe;
      selQuem.replaceChildren(opcao('', 'Todos'));
      if (opcoes.tipos.length > 1) {
        const grupo = criar('optgroup');
        grupo.label = 'Tipo';
        for (const t of opcoes.tipos) grupo.appendChild(opcao(`tipo:${t}`, t === 'royalty' ? 'Royalty' : 'CMS'));
        selQuem.appendChild(grupo);
      }
      if (opcoes.pessoas.length) {
        const grupo = criar('optgroup');
        grupo.label = 'Pessoa';
        for (const p of opcoes.pessoas) grupo.appendChild(opcao(`pessoa:${p.chave}`, p.nome));
        selQuem.appendChild(grupo);
      }
      selQuem.value = [...selQuem.options].some(o => o.value === escolhido) ? escolhido : '';
      quemRecebe = selQuem.value;
      const legenda = el('finRelatorioLegendaBenef');
      if (legenda && window.Beneficiarios) legenda.replaceChildren(window.Beneficiarios.legenda([]));
    }

    function pintar() {
      pintarFiltroBenef();
      const mostrado = visivel();
      el('finRelatorioTitulo').replaceChildren(Object.assign(document.createElement('i'), { className: 'fas fa-chart-line mr-2' }),
        document.createTextNode(tituloDoRelatorio(mostrado)));
      el('finRelatorioSubtitulo').textContent = 'Conferência antes da exportação';
      el('finRelatorioGeradoEm').textContent = `Gerado em ${formatarData(hojeLocal())}`;
      el('finRelatorioNome').textContent = mostrado.titulo;
      el('finRelatorioFiltro').textContent = mostrado.filtro || (periodo ? `Período: ${formatarData(periodo.inicio)} a ${formatarData(periodo.fim)}` : `Competência: ${rotuloCompetenciaCurto(competencia)}`);
      const cabecalho = el('finRelatorioCabecalho');
      cabecalho.replaceChildren();
      for (const c of mostrado.colunas) {
        cabecalho.appendChild(criar('th', `px-4 py-3 text-xs ${['moeda', 'inteiro'].includes(c.tipo) ? 'text-right' : 'text-left'}`, c.rotulo));
      }
      montarLinhas(el('finRelatorioCorpo'), mostrado.linhas, mostrado.colunas.map(c => (c.chave === 'dias' ? { ...c, enfase: true } : c)), { abrir: destinoDaLinha });
      const totais = el('finRelatorioTotais');
      totais.replaceChildren();
      mostrado.colunas.forEach((c, i) => {
        const td = criar('td', `px-4 py-3 ${['moeda', 'inteiro'].includes(c.tipo) ? 'text-right' : 'text-left'}`);
        if (i === 0) td.textContent = `Total (${mostrado.linhas.length} ${mostrado.linhas.length === 1 ? 'registro' : 'registros'})`;
        else if (c.total) td.textContent = c.tipo === 'inteiro' ? String(mostrado.totais[c.chave]) : formatarMoeda(mostrado.totais[c.chave]);
        totais.appendChild(td);
      });
      el('finRelatorioVazio').classList.toggle('hidden', !carregado || mostrado.linhas.length > 0);
    }

    const carregamento = criarCarregamento({
      tbody: el('finRelatorioCorpo'), colunas: (RELATORIOS[chave]?.colunas || []).length || 6, aviso: el('finRelatorioCarregando'), vazio: el('finRelatorioVazio')
    });

    async function carregar() {
      const minha = carregamento.comecar();
      let lido = null;
      try {
        lido = await buscarRelatorio(chave, { competencia, periodo });
      } catch (e) {
        lido = { ...montarRelatorio(chave, { linhas: [] }), competencia, periodo, filtro: textoDoErro(e, 'Sem permissão para ver este relatório.') };
      }
      if (!carregamento.terminar(minha)) return;
      relatorio = lido;
      carregado = true;
      pintar();
    }

    const exportar = formato => async () => {
      // Sai o que está na tela: com o filtro de quem recebe, se houver.
      const mostrado = visivel();
      if (!mostrado.linhas.length) { window.showToast?.('Nada para exportar.', 'info'); return; }
      try {
        await exportarRelatorio(formato, mostrado);
      } catch (e) {
        window.showToast?.(e.message || 'Não foi possível exportar.', 'error');
      }
    };
    acionar(el('finRelatorioPdf'), exportar('pdf'));
    acionar(el('finRelatorioExcel'), exportar('excel'));
    selQuem?.addEventListener('change', () => { quemRecebe = selQuem.value; pintar(); });
    aoAlterar(carregar);
    pintar();
    return carregar();
  }

  function montarDetalhesParcela() {
    const alvo = contexto.parcela || {};
    ligarAbas();
    const registrarBtn = el('finParcelaRegistrarAjuste');
    let dados = null;
    const carregamento = criarCarregamento({ tbody: el('finParcelaBeneficiarios'), colunas: 4, linhas: 3, aviso: el('finParcelaCarregando') });

    function pintar() {
      const d = dados;
      el('finParcelaContexto').textContent = d ? [`Pedido ${d.pedido}`, d.cliente, d.nf ? `NF ${d.nf}` : null, `Parcela ${d.parcela}`].filter(Boolean).join(' • ') : '';
      aplicarBadge(el('finParcelaStatus'), d ? d.situacao_rotulo : '—');
      const corpoB = el('finParcelaBeneficiarios');
      const corpoF = el('finParcelaFechamentos');
      const corpoA = el('finParcelaAjustes');
      [corpoB, corpoF, corpoA].forEach(c => c.replaceChildren());
      if (!d) {
        el('finParcelaResumo').replaceChildren();
        el('finParcelaHistorico').replaceChildren();
        return;
      }

      const pares = [['Valor original', formatarMoeda(d.valor_original)]];
      if (Number(d.abatimento_boleto)) pares.push(['(-) Abatimento no boleto', formatarMoeda(d.abatimento_boleto)]);
      pares.push(
        ['(-) Devoluções', formatarMoeda(d.devolucoes)],
        ['(-) Descontos, abatimentos e outros', formatarMoeda(d.descontos)],
        ['Valor líquido', formatarMoeda(d.liquido), true],
        ['Vencimento', formatarData(d.vencimento)],
        ['Liquidação', d.recebimento
          ? `${formatarData(d.recebimento.data)}${d.recebimento.forma ? ` (${d.recebimento.forma})` : ''}`
          : (Number(d.dias_atraso) > 0 ? `Não liquidada — ${d.dias_atraso} dias em atraso` : 'Não liquidada')],
        [`CMS (${percentualTexto(d.taxas?.pct_cms)})`, formatarMoeda(d.potencial?.cms)],
        [`Royalty (${percentualTexto(d.taxas?.pct_royalty)})`, formatarMoeda(d.potencial?.royalty)],
        ['Total comissão', formatarMoeda(d.potencial?.total), true]
      );
      if (d.comissao_fechada) pares.push(['Já fechado (somando ajustes fechados)', formatarMoeda(d.congelado?.total)]);
      if ((d.pendentes || []).length) {
        const aFechar = centavos(d.pendentes.reduce((s, i) => s + Number(i.total || 0), 0));
        pares.push([`A fechar em ${[...new Set(d.pendentes.map(i => rotuloCompetenciaCurto(i.competencia)))].join(', ')}`, formatarMoeda(aFechar)]);
      }
      if (d.sem_regra) pares.push(['Regra de comissão', 'Nenhuma cadastrada para este pedido']);
      if (d.taxas?.congeladas) pares.push(['Percentuais', 'Os do fechamento (mudar a regra não altera esta parcela)']);
      montarDl(el('finParcelaResumo'), pares);

      const bens = d.potencial?.beneficiarios || [];
      if (!bens.length) linhaVazia(corpoB, 4, 'Sem regra de CMS/Royalty para esta parcela.');
      for (const b of bens) {
        const tr = document.createElement('tr');
        tr.append(...celulasDeBeneficiario(b),
          celulaG(percentualTexto(b.percentual), 'px-4 py-3 text-right'), celulaG(formatarMoeda(b.valor), 'px-4 py-3 text-right'));
        corpoB.appendChild(tr);
      }
      pintarLegendaBenef('finParcelaBeneficiariosLegenda', bens);

      if (!(d.fechamentos || []).length) linhaVazia(corpoF, 5, 'A comissão desta parcela ainda não entrou em fechamento.');
      for (const f of d.fechamentos || []) {
        const tr = document.createElement('tr');
        tr.append(
          celulaG(rotuloCompetenciaCurto(f.competencia), 'px-4 py-3 text-white'),
          celulaG(f.tipo_item === 'parcela' ? 'Comissão' : `Ajuste${f.motivo ? `: ${f.motivo}` : ''}`),
          celulaG(formatarMoeda(f.total), 'px-4 py-3 text-right'),
          celulaG(formatarData(f.pagar_ate)),
          celulaG(f.pagamento ? tagG(`Paga em ${formatarData(f.pagamento.data)}`, 'badge-success', f.pagamento.forma || '') : tagG('A pagar', 'badge-warning'))
        );
        corpoF.appendChild(tr);
      }

      if (!(d.ajustes || []).length) linhaVazia(corpoA, 7, 'Nenhum ajuste nesta parcela.');
      for (const a of d.ajustes || []) {
        const acoes = criar('div', 'flex flex-wrap gap-2');
        if (a.status === 'ativo' && !a.no_fechamento) {
          botaoG(acoes, 'Cancelar', () => cancelarAjuste(a), { classe: 'btn-danger text-white', perm: 'financeiro.ajuste.registrar', titulo: 'Desfazer este ajuste (ainda não entrou em fechamento)' });
        }
        const situacao = a.status !== 'ativo' ? tagG('Cancelado', 'badge-danger', a.motivo_cancelamento || '')
          : (a.no_fechamento ? tagG('Fechado', 'badge-neutral', 'Já entrou num fechamento de comissões') : tagG('Ativo', 'badge-success'));
        const tr = document.createElement('tr');
        tr.append(
          celulaG(formatarData(a.data), 'px-4 py-3 text-white'), celulaG(a.rotulo),
          celulaG([a.motivo, a.observacao].filter(Boolean).join(' — ')), celulaG(formatarMoeda(-a.valor), 'px-4 py-3 text-right'),
          celulaG(a.usuario || '—'), celulaG(situacao), celulaG(acoes)
        );
        corpoA.appendChild(tr);
      }

      montarLinhaDoTempo(el('finParcelaHistorico'), (d.historico || []).map(h => ({ quando: h.quando, titulo: h.titulo, detalhe: h.detalhe })));
      registrarBtn.classList.toggle('hidden', d.situacao === 'nao_realizada');
    }

    async function carregar() {
      if (!alvo.pedido_id || !alvo.numero_parcela) {
        el('finParcelaCarregando').classList.add('hidden');
        mostrarMensagem('finParcelaMensagem', 'Parcela não informada.');
        registrarBtn.classList.add('hidden');
        return;
      }
      mostrarMensagem('finParcelaMensagem', '');
      const minha = carregamento.comecar();
      let lido = null;
      let erro = null;
      try {
        lido = await fetchApi(`/api/financeiro/parcelas/${encodeURIComponent(alvo.pedido_id)}/${encodeURIComponent(alvo.numero_parcela)}`);
      } catch (e) {
        erro = e;
      }
      if (!carregamento.terminar(minha)) return;
      dados = erro ? null : lido;
      if (erro) mostrarMensagem('finParcelaMensagem', textoDoErro(erro, 'Você não tem permissão para ver as comissões.'));
      pintar();
    }

    async function cancelarAjuste(a) {
      const motivo = await pedirTexto({
        titulo: 'Cancelar este ajuste?',
        mensagem: `${a.rotulo} de ${formatarMoeda(a.valor)} (${formatarData(a.data)}): o valor volta para a base da comissão.`,
        placeholder: 'Por que está sendo cancelado (obrigatório)',
        confirmar: 'Cancelar ajuste'
      });
      if (motivo === null) return;
      try {
        await fetchApi(`/api/financeiro/ajustes/${encodeURIComponent(a.id)}/cancelar`, { method: 'POST', body: JSON.stringify({ motivo }) });
        window.showToast?.('Ajuste cancelado.', 'success');
        avisarAlteracao();
      } catch (e) {
        mostrarMensagem('finParcelaMensagem', textoDoErro(e, 'Você não tem permissão para cancelar ajustes.'));
      }
    }

    aoAlterar(carregar);
    acionar(registrarBtn, () => abrirOutro('registrar-ajuste', { parcela: { pedido_id: alvo.pedido_id, numero_parcela: alvo.numero_parcela, pedido: dados?.pedido } }));
    return carregar();
  }

  function montarDetalhesPedido() {
    const pedidoId = Number(contexto.pedido || contexto.pedidoId) || null;
    ligarAbas();
    let dados = null;
    const carregamento = criarCarregamento({ tbody: el('finPedidoParcelas'), colunas: 6, linhas: 3, aviso: el('finPedidoCarregando') });

    function pintar() {
      const d = dados;
      el('finPedidoTitulo').replaceChildren(Object.assign(document.createElement('i'), { className: 'fas fa-box mr-2' }),
        document.createTextNode(`Pedido ${d?.pedido.numero || pedidoId || '—'}`));
      el('finPedidoCliente').textContent = d?.pedido.cliente || '';
      aplicarBadge(el('finPedidoStatus'), d?.pedido.situacao || '—');
      ['finPedidoItens', 'finPedidoNotas', 'finPedidoProducao', 'finPedidoParcelas'].forEach(id => el(id).replaceChildren());
      if (!d) return;
      el('finPedidoData').textContent = formatarData(d.pedido.data);
      el('finPedidoValor').textContent = formatarMoeda(d.pedido.valor);
      el('finPedidoCondicao').textContent = d.pedido.condicao || '—';
      el('finPedidoStatusTexto').textContent = d.pedido.situacao || '—';
      el('finPedidoObservacoes').textContent = d.pedido.observacoes || '—';

      montarLinhas(el('finPedidoItens'), (d.itens || []).map(i => ({
        ...i, por_setor_texto: (i.por_setor || []).map(s => `${s.setor} ${s.finalizada}`).join(' · ') || '—'
      })), [
        { chave: 'codigo' }, { chave: 'descricao' }, { chave: 'quantidade', tipo: 'inteiro' }, { chave: 'produzida', tipo: 'inteiro' },
        { chave: 'saldo', tipo: 'inteiro' }, { chave: 'por_setor_texto' }, { chave: 'situacao', tipo: 'badge' }
      ]);
      if (!(d.itens || []).length) linhaVazia(el('finPedidoItens'), 7, 'O pedido não tem itens.');

      montarLinhas(el('finPedidoNotas'), (d.notas || []).map(n => ({ ...n, situacao: rotuloStatusNota(n.status).rotulo })), [
        { chave: 'nf' }, { chave: 'data', tipo: 'data' }, { chave: 'valor', tipo: 'moeda' }, { chave: 'parcelas', tipo: 'inteiro' }, { chave: 'situacao', tipo: 'badge' }
      ]);
      if (!(d.notas || []).length) linhaVazia(el('finPedidoNotas'), 5, 'Nenhuma NF-e emitida para este pedido.');

      const corpoP = el('finPedidoProducao');
      for (const e of d.producao || []) {
        const situacao = e.status === 'estornado' ? tagG('Estornado', 'badge-danger')
          : (e.quantidade < 0 ? tagG('Estorno', 'badge-warning') : (e.estornado ? tagG('Estornado depois de fechar', 'badge-warning') : tagG('Registrado', 'badge-success')));
        const tr = document.createElement('tr');
        // Peça: o código em etiqueta (o nome inteiro no passar do mouse), como nos relatórios.
        const peca = e.produto_codigo ? tagG(e.produto_codigo, 'fin-tag-produto', e.produto || e.produto_codigo) : (e.produto || '—');
        tr.append(celulaG(formatarData(e.data), 'px-4 py-3 text-white'), celulaG(peca), celulaG(e.setor || '—'),
          celulaG(String(e.quantidade), 'px-4 py-3 text-right'), celulaG(situacao));
        corpoP.appendChild(tr);
      }
      if (!(d.producao || []).length) linhaVazia(corpoP, 5, 'Nenhuma produção registrada neste pedido.');

      const c = d.comissoes || {};
      const taxas = c.taxas ? `CMS ${percentualTexto(c.taxas.pct_cms)} · Royalty ${percentualTexto(c.taxas.pct_royalty)}` : '—';
      montarDl(el('finPedidoComissoes'), [
        ['Percentuais', c.sem_regra ? 'Sem regra de CMS/Royalty cadastrada' : taxas],
        ['Prevista (parcelas a receber)', formatarMoeda(c.prevista)],
        ['Das quais atrasada', formatarMoeda(c.atrasada)],
        ['Realizada (parcelas recebidas)', formatarMoeda(c.realizada)],
        ['Já fechada', formatarMoeda(c.fechada)],
        ['Paga', formatarMoeda(c.paga)],
        ['Reduzida por ajustes', formatarMoeda(c.ajustes)],
        ['Saldo a pagar', formatarMoeda(centavos(Number(c.prevista || 0) + Number(c.realizada || 0) - Number(c.paga || 0))), true]
      ]);
      montarLinhas(el('finPedidoParcelas'), (d.parcelas || []).map(p => ({ ...p, situacao_texto: p.situacao_rotulo })), [
        { chave: 'parcela' }, { chave: 'vencimento', tipo: 'data' }, { chave: 'liquido', tipo: 'moeda' }, { chave: 'comissao', tipo: 'moeda' }, { chave: 'situacao_texto', tipo: 'badge' },
        { chave: 'beneficiarios', tipo: 'beneficiarios' }
      ], { abrir: 'detalhes-parcela' });
      if (!(d.parcelas || []).length) linhaVazia(el('finPedidoParcelas'), 6, 'O pedido ainda não tem parcelas faturadas.');
      pintarLegendaBenef('finPedidoParcelasLegenda', (d.parcelas || []).flatMap(p => p.benef_lista || []));

      montarLinhaDoTempo(el('finPedidoHistorico'), (d.historico || []).map(h => ({ quando: formatarDataCurta(h.quando), titulo: h.titulo, detalhe: h.detalhe })));
    }

    async function carregar() {
      if (!pedidoId) {
        el('finPedidoCarregando').classList.add('hidden');
        mostrarMensagem('finPedidoMensagem', 'Pedido não informado.');
        pintar();
        return;
      }
      mostrarMensagem('finPedidoMensagem', '');
      const minha = carregamento.comecar();
      let lido = null;
      let erro = null;
      try {
        lido = await fetchApi(`/api/financeiro/pedidos/${encodeURIComponent(pedidoId)}`);
      } catch (e) {
        erro = e;
      }
      if (!carregamento.terminar(minha)) return;
      dados = erro ? null : lido;
      if (erro) mostrarMensagem('finPedidoMensagem', textoDoErro(erro, 'Você não tem permissão para ver comissões e produção.'));
      pintar();
    }

    acionar(el('finPedidoAbrirCompleto'), () => abrirVisualizarPedido(pedidoId));
    aoAlterar(carregar);
    return carregar();
  }

  function montarComissoesAtrasadas() {
    const clienteSel = el('finAtrasadasCliente');
    // Os campos de data começam vazios: sem filtro de período.
    el('finAtrasadasInicio').value = '';
    el('finAtrasadasFim').value = '';
    let todas = [];
    let carregado = false;

    const quemSel = el('finAtrasadasQuemRecebe');
    const carregamento = criarCarregamento({ tbody: el('finAtrasadasCorpo'), colunas: 11, aviso: el('finAtrasadasCarregando'), vazio: el('finAtrasadasVazio') });

    const colunas = [
      { chave: 'pedido', tipo: 'pedido' }, { chave: 'cliente' }, { chave: 'nf' }, { chave: 'parcela' },
      { chave: 'vencimento', tipo: 'data' }, { chave: 'dias', tipo: 'inteiro', enfase: true },
      { chave: 'liquido', tipo: 'moeda' }, { chave: 'cms', tipo: 'moeda' }, { chave: 'royalty', tipo: 'moeda' },
      { chave: 'comissao', tipo: 'moeda', classe: 'font-semibold' },
      { chave: 'beneficiarios', tipo: 'beneficiarios' }
    ];

    function montarClientes() {
      const atual = clienteSel.value;
      clienteSel.replaceChildren(opcao('', 'Todos'));
      for (const nome of [...new Set(todas.map(l => l.cliente).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'))) {
        clienteSel.appendChild(opcao(nome, nome));
      }
      clienteSel.value = [...clienteSel.options].some(o => o.value === atual) ? atual : '';
    }

    /** Filtro por quem recebe: os tipos e as pessoas que aparecem nas parcelas atrasadas. */
    function montarQuemRecebe() {
      if (!quemSel) return;
      const atual = quemSel.value;
      const opcoes = opcoesDeBeneficiario(todas);
      quemSel.replaceChildren(opcao('', 'Todos'));
      if (opcoes.tipos.length > 1) {
        const grupo = criar('optgroup');
        grupo.label = 'Tipo';
        for (const t of opcoes.tipos) grupo.appendChild(opcao(`tipo:${t}`, t === 'royalty' ? 'Royalty' : 'CMS'));
        quemSel.appendChild(grupo);
      }
      if (opcoes.pessoas.length) {
        const grupo = criar('optgroup');
        grupo.label = 'Pessoa';
        for (const p of opcoes.pessoas) grupo.appendChild(opcao(`pessoa:${p.chave}`, p.nome));
        quemSel.appendChild(grupo);
      }
      quemSel.value = [...quemSel.options].some(o => o.value === atual) ? atual : '';
      quemSel.closest('div')?.classList.toggle('hidden', !opcoes.pessoas.length);
    }

    function filtrar() {
      const cliente = clienteSel.value;
      const pedido = String(el('finAtrasadasPedido').value).trim();
      const faixa = el('finAtrasadasFaixa').value;
      const inicio = el('finAtrasadasInicio').value;
      const fim = el('finAtrasadasFim').value;
      const linhas = todas.filter(l =>
        (!cliente || l.cliente === cliente)
        && (!pedido || String(l.pedido).includes(pedido))
        && (!faixa || l.faixa === faixa)
        && (!inicio || String(l.vencimento) >= inicio)
        && (!fim || String(l.vencimento) <= fim));
      // Com quem recebe escolhido, os valores viram a parte dele (o total bate com o filtro).
      return filtrarPorBeneficiario(linhas, quemSel?.value || '');
    }

    function desenhar() {
      const linhas = filtrar();
      const resumo = resumoAtrasadas(linhas);
      el('finAtrasadasQuantidade').textContent = carregado ? String(resumo.quantidade) : '—';
      el('finAtrasadasLiquido').textContent = carregado ? formatarMoeda(resumo.liquido) : '—';
      el('finAtrasadasComissao').textContent = carregado ? formatarMoeda(resumo.comissao) : '—';
      montarLinhas(el('finAtrasadasCorpo'), linhas, colunas, { abrir: 'detalhes-parcela' });
      pintarLegendaBenef('finAtrasadasLegenda', linhas.flatMap(l => l.benef_lista || []));
      el('finAtrasadasVazio').classList.toggle('hidden', !carregado || linhas.length > 0);
      el('finAtrasadasCorpo').closest('.fin-tabela').classList.toggle('hidden', linhas.length === 0);

      const aging = el('finAtrasadasAging');
      aging.replaceChildren();
      const faixas = agingDe(linhas);
      const maior = Math.max(1, ...faixas.map(f => f.liquido));
      for (const f of faixas) {
        const linha = criar('div', 'fin-aging__linha');
        linha.appendChild(criar('span', 'fin-aging__faixa', `${f.faixa} dias`));
        const barra = criar('div', 'fin-aging__barra');
        const cheio = criar('span', 'fin-aging__cheio');
        cheio.style.width = `${Math.round((f.liquido / maior) * 100)}%`;
        if (f.faixa === '61–90' || f.faixa === '+90') cheio.classList.add('fin-aging__cheio--critico');
        barra.appendChild(cheio);
        linha.appendChild(barra);
        linha.appendChild(criar('span', 'fin-aging__numeros', `${f.parcelas} ${f.parcelas === 1 ? 'parcela' : 'parcelas'} • ${formatarMoeda(f.liquido)} • comissão ${formatarMoeda(f.comissao)}`));
        aging.appendChild(linha);
      }
    }

    async function carregar() {
      mostrarMensagem('finAtrasadasMensagem', '');
      const minha = carregamento.comecar();
      try {
        // As atrasadas DO MÊS escolhido no Financeiro: as que venceram até ele
        // e não estavam pagas (o mês passado mostra a foto do fim dele).
        const competencia = contexto.competencia || competenciaAtual();
        const corpo = await fetchApi(`/api/financeiro/parcelas?visao=atrasadas&competencia=${encodeURIComponent(competencia)}`);
        todas = (Array.isArray(corpo?.linhas) ? corpo.linhas : []).map(l => ({ ...l, dias: l.dias_atraso, faixa: l.faixa || faixaDeAtraso(l.dias_atraso) }));
        const fotoDoFim = corpo?.referencia && corpo?.hoje && corpo.referencia < corpo.hoje;
        el('finAtrasadasSubtitulo').textContent = `${rotuloCompetenciaCurto(competencia)} · ${fotoDoFim ? `como estava no fim do mês (${formatarData(corpo.referencia)})` : `posição em ${formatarData(corpo?.referencia || corpo?.hoje)}`}`;
        el('finAtrasadasSemRegras').classList.toggle('hidden', corpo?.tem_regras !== false);
      } catch (e) {
        todas = [];
        mostrarMensagem('finAtrasadasMensagem', textoDoErro(e, 'Você não tem permissão para ver comissões.'));
      } finally {
        carregado = true;
        carregamento.terminar(minha);
      }
      montarClientes();
      montarQuemRecebe();
      desenhar();
    }

    ['finAtrasadasCliente', 'finAtrasadasQuemRecebe', 'finAtrasadasFaixa', 'finAtrasadasInicio', 'finAtrasadasFim'].forEach(id => el(id)?.addEventListener('change', desenhar));
    el('finAtrasadasPedido').addEventListener('input', desenhar);
    // Enter numa linha abre os detalhes, como o clique.
    el('finAtrasadasCorpo').addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const tr = e.target.closest('tr[data-fin-abrir]');
      if (tr) { e.preventDefault(); tr.click(); }
    });
    aoAlterar(carregar);
    desenhar();
    return carregar();
  }

  function montarProducaoCompetencia() {
    const mesSel = el('finProdCompMes');
    montarCompetencias(mesSel, contexto.competencia);
    const setorSel = el('finProdCompSetor');
    const fecharBtn = el('finProdCompFechar');
    let dados = null;
    const carregamento = criarCarregamento({ tbody: el('finProdCompCorpo'), colunas: 8, aviso: el('finProdCompCarregando'), vazio: el('finProdCompVazio') });

    const colunas = [
      { chave: 'pedido', tipo: 'pedido' }, { chave: 'data', tipo: 'data' }, { chave: 'produto', tipo: 'produto' }, { chave: 'setor' },
      { chave: 'quantidade', tipo: 'inteiro' }, { chave: 'valor_unitario', tipo: 'moeda' },
      { chave: 'total', tipo: 'moeda', classe: 'font-semibold' }, { chave: 'status_item', tipo: 'badge' }
    ];

    function pintarTopo() {
      el('finProdCompCompetencia').textContent = rotuloCompetenciaCurto(mesSel.value);
      const d = dados;
      pintarSituacao(el('finProdCompStatus'), !d ? '—' : (d.fechamento?.pagamento ? 'Paga' : (d.fechado ? 'Fechada' : 'Em aberto')));
      el('finProdCompSubtitulo').textContent = d?.fechado ? 'Peças congeladas no fechamento produtivo' : 'Peças finalizadas que entram no fechamento produtivo';
      el('finProdCompInfo').textContent = d ? `Pagamento até ${formatarData(d.pagar_ate)}${d.fechamento?.pagamento ? ` · paga em ${formatarData(d.fechamento.pagamento.data_pagamento)}` : ''}` : '';

      const caixa = el('finProdCompIndicadores');
      const indicadores = d ? indicadoresDaProducao(d) : [];
      caixa.replaceChildren();
      caixa.className = `fin-indicadores${indicadores.length >= 5 ? ' fin-indicadores--5' : (indicadores.length === 4 ? ' fin-indicadores--4' : '')}`;
      for (const i of indicadores) {
        const cartao = criar('div', `fin-indicador${i.destaque ? ' fin-indicador--destaque' : ''}${i.atencao ? ' fin-indicador--atencao' : ''}`);
        cartao.append(criar('span', 'fin-indicador__rotulo', i.rotulo), criar('strong', 'fin-indicador__valor', i.valor));
        // A nota explica a diferença entre peça e processo, embaixo do número.
        if (i.nota) cartao.appendChild(criar('span', 'text-xs text-gray-400', i.nota));
        caixa.appendChild(cartao);
      }

      const atual = setorSel.value;
      setorSel.replaceChildren(opcao('', 'Todos'));
      for (const nome of [...new Set((d?.linhas || []).map(l => l.setor).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'))) {
        setorSel.appendChild(opcao(nome, nome));
      }
      setorSel.value = [...setorSel.options].some(o => o.value === atual) ? atual : '';

      const bloqueios = d && !d.fechado ? (d.bloqueios || []).filter(b => !/já foram fechadas/.test(b)) : [];
      el('finProdCompBloqueiosTexto').textContent = bloqueios.join(' ');
      el('finProdCompBloqueios').classList.toggle('hidden', !bloqueios.length);
      fecharBtn.classList.toggle('hidden', !d || Boolean(d.fechado));
    }

    function desenhar() {
      const setor = setorSel.value;
      const pedido = String(el('finProdCompPedido').value).trim();
      const produto = String(el('finProdCompProduto').value).trim().toLowerCase();
      const status = el('finProdCompItemStatus').value;
      const linhas = (dados?.linhas || []).filter(l =>
        (!setor || l.setor === setor)
        && (!pedido || String(l.pedido).includes(pedido))
        && (!produto || String(l.produto || '').toLowerCase().includes(produto))
        && (!status || l.status_item === status));
      montarLinhas(el('finProdCompCorpo'), linhas, colunas);
      el('finProdCompRodape').textContent = formatarMoeda(centavos(linhas.reduce((s, l) => s + Number(l.total || 0), 0)));
      el('finProdCompVazio').classList.toggle('hidden', !dados || linhas.length > 0);
    }

    async function carregar() {
      const minha = carregamento.comecar();
      mostrarMensagem('finProdCompMensagem', '');
      let lido = null;
      let erro = null;
      try {
        lido = await fetchApi(`/api/financeiro/producao?competencia=${encodeURIComponent(mesSel.value)}`);
      } catch (e) {
        erro = e;
      }
      if (!carregamento.terminar(minha)) return;
      dados = erro ? null : lido;
      if (erro) mostrarMensagem('finProdCompMensagem', textoDoErro(erro, 'Você não tem permissão para ver a produção.'));
      pintarTopo();
      desenhar();
    }

    mesSel.addEventListener('change', carregar);
    ['finProdCompSetor', 'finProdCompItemStatus'].forEach(id => el(id).addEventListener('change', desenhar));
    ['finProdCompPedido', 'finProdCompProduto'].forEach(id => el(id).addEventListener('input', desenhar));
    // O "Fechar competência" daqui é o da PRODUÇÃO: abre a tela de confirmar
    // peça a peça, não a de comissões (defeito que o dono pegou em 24/09/2026).
    acionar(fecharBtn, () => abrirOutro('fechar-producao', { competencia: mesSel.value }));
    acionar(el('finProdCompRelatorio'), () => abrirOutro('visualizar-relatorio', { relatorio: 'producao-competencia', competencia: mesSel.value }));
    aoAlterar(carregar);
    pintarTopo();
    return carregar();
  }

  // ------------------------------------------------------------ atividade

  function montarAtividade() {
    const linha = el('finAtividadeLinha');
    const busca = el('finAtividadeBusca');
    const tipoSel = el('finAtividadeTipo');
    const quemSel = el('finAtividadeQuem');
    let itens = [];
    let fotos = new Map();
    let base = '';

    for (const [chave, g] of Object.entries(GRUPOS_ATIVIDADE)) tipoSel.appendChild(opcao(chave, g.rotulo));

    /** A foto de quem fez: data: e http: valem como vieram; caminho, contra a base da API. */
    const urlDaFoto = valor => {
      const bruto = String(valor || '').trim();
      if (!bruto) return null;
      if (/^(https?:|data:|blob:|file:)/i.test(bruto)) return bruto;
      return base ? `${base.replace(/\/+$/, '')}${bruto.startsWith('/') ? '' : '/'}${bruto}` : null;
    };

    function avatar(item) {
      const caixa = criar('span', 'fin-avatar');
      if (item.sistema) {
        caixa.classList.add('fin-avatar--sistema');
        caixa.title = 'Sistema (SEFAZ)';
        caixa.appendChild(Object.assign(document.createElement('i'), { className: 'fas fa-landmark' }));
        return caixa;
      }
      const nome = item.usuario || (item.usuario_id ? `Usuário ${item.usuario_id}` : 'Sistema');
      caixa.title = nome;
      const foto = fotos.get(String(item.usuario_id));
      if (foto) {
        const img = document.createElement('img');
        img.src = foto;
        img.alt = nome;
        img.loading = 'lazy';
        // Foto que não carrega volta para as iniciais.
        img.addEventListener('error', () => { img.remove(); caixa.textContent = iniciais(nome); });
        caixa.appendChild(img);
      } else {
        caixa.textContent = iniciais(nome);
        caixa.style.background = window.Beneficiarios?.cor ? window.Beneficiarios.cor(nome) : '';
      }
      return caixa;
    }

    function desenhar() {
      const termo = semAcento(busca.value).trim();
      const grupo = tipoSel.value;
      const quem = quemSel.value;
      const visiveis = itens.filter(i => (!grupo || i.grupo === grupo)
        && (!quem || (quem === 'sistema' ? i.sistema : String(i.usuario_id) === quem))
        && (!termo || semAcento(`${i.texto} ${i.etiqueta} ${i.usuario || ''}`).includes(termo)));
      el('finAtividadeContagem').textContent = `${visiveis.length} ${visiveis.length === 1 ? 'movimento' : 'movimentos'}`;
      linha.replaceChildren();
      let diaAtual = null;
      for (const item of visiveis) {
        const dia = diaLocal(item.quando);
        if (dia !== diaAtual) {
          diaAtual = dia;
          linha.appendChild(criar('li', 'fin-linha-tempo__dia', rotuloDoDia(item.quando)));
        }
        const li = criar('li', 'fin-linha-tempo__item');
        const corpo = criar('div', 'fin-linha-tempo__corpo');
        const topo = criar('div', 'fin-linha-tempo__topo');
        topo.append(
          criar('strong', 'fin-linha-tempo__quem', item.sistema ? 'Sistema (SEFAZ)' : (item.usuario || (item.usuario_id ? `Usuário ${item.usuario_id}` : 'Sistema'))),
          criar('span', 'fin-linha-tempo__hora', horaDe(item.quando)),
          criar('span', `${item.badge} fin-linha-tempo__tag`, item.etiqueta)
        );
        corpo.appendChild(topo);
        corpo.appendChild(criar('p', 'fin-linha-tempo__texto', item.texto || '—'));
        if (item.valor !== null && item.valor !== undefined) corpo.appendChild(criar('p', 'fin-linha-tempo__valor', formatarMoeda(item.valor)));
        li.append(avatar(item), corpo);
        linha.appendChild(li);
      }
      el('finAtividadeVazio').classList.toggle('hidden', visiveis.length > 0);
    }

    function montarQuem() {
      const pessoas = new Map();
      for (const i of itens) if (i.usuario_id !== null && i.usuario_id !== undefined) pessoas.set(String(i.usuario_id), i.usuario || `Usuário ${i.usuario_id}`);
      quemSel.replaceChildren(opcao('', 'Todos'));
      for (const [id, nome] of [...pessoas].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))) quemSel.appendChild(opcao(id, nome));
      if (itens.some(i => i.sistema)) quemSel.appendChild(opcao('sistema', 'Sistema (SEFAZ)'));
    }

    async function carregar() {
      mostrarMensagem('finAtividadeMensagem', '');
      el('finAtividadeCarregando').classList.remove('hidden');
      el('finAtividadeCarregando').replaceChildren(spinnerDaCasa(), criar('span', 'fin-carregando-texto', 'Carregando a atividade…'));
      try { base = (await window.apiConfig?.getApiBaseUrl?.()) || ''; } catch (_) { base = ''; }
      // As três leituras são independentes: sem permissão de NF-e (403) ou
      // sem a lista de usuários, o resto aparece do mesmo jeito.
      const [fin, fisc, usuarios] = await Promise.all([
        fetchApi('/api/financeiro/atividade?limite=300').catch(e => ({ erro: e })),
        fetchApi('/api/fiscal/atividade?limite=200').catch(() => ({ itens: [] })),
        fetchApi('/api/usuarios/lista').catch(() => [])
      ]);
      el('finAtividadeCarregando').classList.add('hidden');
      if (fin?.erro) mostrarMensagem('finAtividadeMensagem', textoDoErro(fin.erro, 'Você não tem permissão para ver a atividade do Financeiro.'));
      fotos = new Map((Array.isArray(usuarios) ? usuarios : [])
        .map(u => [String(u.id), urlDaFoto(u.foto_perfil_url || u.foto_perfil || u.fotoPerfil || u.foto_usuario || u.avatar || u.avatar_url || u.avatarUrl || null)])
        .filter(([, url]) => url));
      itens = juntarAtividade(fin?.itens || [], fisc?.itens || []);
      montarQuem();
      desenhar();
    }

    busca.addEventListener('input', desenhar);
    tipoSel.addEventListener('change', desenhar);
    quemSel.addEventListener('change', desenhar);
    return carregar();
  }

  /** "14:32" de um instante (no fuso de quem vê). */
  function horaDe(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  /**
   * Regras de comissão e produção: tabelas editáveis (CMS do dono do
   * cliente, o % do Royalty dos desenhistas, os processos e o valor de cada
   * um — em R$ ou em % da tabela fixa —, feriados e prazos). Quem só vê tem
   * tudo em leitura.
   */
  function montarRegras() {
    ligarAbas();
    const podeEditar = pode('financeiro.regras.editar');
    el('finRegrasSomenteLeitura').classList.toggle('hidden', podeEditar);
    let dados = null;
    const listas = {};
    const erroDe = e => textoDoErro(e, 'Você não tem permissão para editar as regras.');
    const avisar = texto => mostrarMensagem('finRegrasMensagem', texto);
    const carregamento = criarCarregamento({ tbody: el('finRegrasCorpo'), colunas: 6, linhas: 3, aviso: el('finRegrasCarregando'), vazio: el('finRegrasVazio') });

    async function carregar() {
      const minha = carregamento.comecar();
      try {
        dados = await fetchApi('/api/financeiro/regras');
        el('finRegrasSemSql').classList.add('hidden');
      } catch (e) {
        dados = null;
        if (e?.corpo?.sql_pendente) {
          el('finRegrasSemSqlTexto').textContent = textoDoErro(e, '');
          el('finRegrasSemSql').classList.remove('hidden');
        } else avisar(textoDoErro(e, 'Você não tem permissão para ver as regras.'));
      } finally {
        carregamento.terminar(minha);
      }
      pintarDonos();
      pintarRegras();
      pintarSetores();
      pintarValores();
      pintarCalendario();
    }

    /** Clientes, pedidos e peças para escolher (lidos uma vez, quando precisa). */
    async function lista(alvo) {
      if (!listas[alvo]) {
        try {
          const r = await fetchApi(`/api/financeiro/buscas/${alvo}`);
          listas[alvo] = Array.isArray(r) ? r : [];
        } catch (e) {
          avisar(textoDoErro(e, 'Sem permissão para listar.'));
          return [];
        }
      }
      return listas[alvo];
    }

    // ------------------------------------------------ regras de comissão
    const tipoSel = el('finRegraTipo');
    const benefSel = el('finRegraBeneficiario');
    const escopoSel = el('finRegraEscopo');
    const alvoSel = el('finRegraAlvo');
    const alvoBusca = el('finRegraAlvoBusca');
    let editandoRegra = null;
    const semAcento = t => String(t ?? '').normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
    const ehRoyalty = () => tipoSel.value === 'royalty';

    /** Quem pode receber CMS: os donos de cliente. O nome de uma regra antiga que não é mais de um dono aparece marcado. */
    function pintarDonos(atual = benefSel.value) {
      const donos = dados?.donos || [];
      benefSel.replaceChildren(opcao('', donos.length ? 'Escolha o dono do cliente' : 'Nenhum usuário é dono de cliente'));
      for (const d of donos) benefSel.appendChild(opcao(d, d));
      const doLista = donos.find(d => semAcento(d) === semAcento(atual));
      if (atual && !doLista) benefSel.appendChild(opcao(atual, `${atual} (não é dono de cliente)`));
      benefSel.value = doLista || atual || '';
    }

    function pintarQuemRecebe() {
      benefSel.classList.toggle('hidden', ehRoyalty());
      el('finRegraBeneficiarioRoyalty').classList.toggle('hidden', !ehRoyalty());
    }

    async function montarAlvo(selecionado = null) {
      const escopo = escopoSel.value;
      el('finRegraAlvoBloco').classList.toggle('hidden', escopo === 'todos');
      if (escopo === 'todos') return;
      el('finRegraAlvoRotulo').firstChild.textContent = escopo === 'cliente' ? 'Cliente ' : 'Pedido ';
      const clientes = await lista('clientes');
      // CMS: só os clientes do dono escolhido (e os pedidos deles). Royalty: todos.
      const dono = ehRoyalty() ? null : benefSel.value;
      const clientesValidos = ehRoyalty() ? clientes : clientes.filter(c => dono && semAcento(c.dono) === semAcento(dono));
      const idsValidos = new Set(clientesValidos.map(x => String(x.id)));
      const nomeCliente = new Map(clientes.map(x => [String(x.id), x.nome]));
      const itens = escopo === 'cliente' ? clientesValidos : (await lista('pedidos')).filter(p => idsValidos.has(String(p.cliente_id)));
      const rotulo = x => (escopo === 'cliente' ? x.nome : [x.numero, nomeCliente.get(String(x.cliente_id)), x.situacao].filter(Boolean).join(' • '));
      const atual = selecionado !== null && selecionado !== undefined ? String(selecionado) : alvoSel.value;
      const termo = alvoBusca.value.trim().toLowerCase();
      const visiveis = itens.filter(x => !termo || rotulo(x).toLowerCase().includes(termo) || String(x.id) === atual);
      const semItens = !ehRoyalty() && !dono ? 'Escolha antes quem recebe'
        : termo ? 'Nada com esta busca'
          : escopo === 'cliente' ? (ehRoyalty() ? 'Nenhum cliente' : 'Este dono não tem clientes') : 'Nenhum pedido';
      alvoSel.replaceChildren(opcao('', visiveis.length ? (escopo === 'cliente' ? 'Escolha o cliente' : 'Escolha o pedido') : semItens));
      for (const x of visiveis.slice(0, 500)) alvoSel.appendChild(opcao(String(x.id), rotulo(x)));
      alvoSel.value = visiveis.some(x => String(x.id) === atual) ? atual : '';
    }

    function limparFormRegra() {
      editandoRegra = null;
      el('finRegraFormTitulo').textContent = 'Nova regra';
      el('finRegraSalvar').textContent = 'Incluir regra';
      el('finRegraCancelarEdicao').classList.add('hidden');
      tipoSel.value = 'cms';
      pintarDonos('');
      pintarQuemRecebe();
      el('finRegraPercentual').value = '';
      el('finRegraObservacao').value = '';
      escopoSel.value = 'todos';
      alvoBusca.value = '';
      montarAlvo();
    }

    function editarRegra(r) {
      editandoRegra = r;
      el('finRegraFormTitulo').textContent = r.tipo === 'royalty' ? 'Alterando: Royalty' : `Alterando: ${TIPOS_REGRA[r.tipo]} de ${r.beneficiario}`;
      el('finRegraSalvar').textContent = 'Salvar alteração';
      el('finRegraCancelarEdicao').classList.remove('hidden');
      tipoSel.value = r.tipo;
      pintarDonos(r.tipo === 'royalty' ? '' : r.beneficiario);
      pintarQuemRecebe();
      el('finRegraPercentual').value = String(r.percentual).replace('.', ',');
      el('finRegraObservacao').value = r.observacao || '';
      escopoSel.value = r.escopo;
      alvoBusca.value = '';
      montarAlvo(r.escopo === 'cliente' ? r.cliente_id : (r.escopo === 'pedido' ? r.pedido_id : null));
      el('finRegraPercentual').focus();
    }

    const corpoDaRegra = (r, mudancas = {}) => JSON.stringify({
      tipo: r.tipo, beneficiario: r.tipo === 'royalty' ? null : r.beneficiario, percentual: r.percentual, escopo: r.escopo,
      cliente_id: r.cliente_id ?? null, pedido_id: r.pedido_id ?? null, observacao: r.observacao ?? null, ativo: r.ativo, ...mudancas
    });
    const quemRecebeDaRegra = r => (r.tipo === 'royalty' ? 'o desenhista de cada peça' : r.beneficiario);

    async function salvarRegra() {
      avisar('');
      const escopo = escopoSel.value;
      const bruto = String(el('finRegraPercentual').value).replace(/[\s%]/g, '').replace(',', '.');
      const percentual = Number(bruto);
      const nova = {
        tipo: tipoSel.value,
        beneficiario: ehRoyalty() ? null : benefSel.value,
        percentual,
        escopo,
        cliente_id: escopo === 'cliente' ? (Number(alvoSel.value) || null) : null,
        pedido_id: escopo === 'pedido' ? (Number(alvoSel.value) || null) : null,
        observacao: el('finRegraObservacao').value.trim() || null,
        ativo: editandoRegra ? editandoRegra.ativo : true
      };
      const erro = !ehRoyalty() && !nova.beneficiario ? 'Escolha o dono do cliente que recebe a CMS.'
        : (!bruto || !Number.isFinite(percentual) || percentual < 0 || percentual > 100) ? 'O percentual vai de 0 a 100.'
          : (escopo === 'cliente' && !nova.cliente_id) ? 'Escolha o cliente da regra.'
            : (escopo === 'pedido' && !nova.pedido_id) ? 'Escolha o pedido da regra.' : '';
      if (erro) { avisar(erro); return; }
      try {
        if (editandoRegra) await fetchApi(`/api/financeiro/regras/${encodeURIComponent(editandoRegra.id)}`, { method: 'PUT', body: JSON.stringify(nova) });
        else await fetchApi('/api/financeiro/regras', { method: 'POST', body: JSON.stringify(nova) });
        window.showToast?.(editandoRegra ? 'Regra alterada.' : 'Regra incluída.', 'success');
        limparFormRegra();
        avisarAlteracao();
        await carregar();
      } catch (e) {
        avisar(erroDe(e));
      }
    }

    /** Excluir some com a linha (só Sup Admin); o que já foi fechado não muda. */
    async function excluirRegra(r) {
      const confirmado = await window.DialogPadrao?.confirm?.({
        title: 'Excluir a regra?',
        message: `${TIPOS_REGRA[r.tipo]} ${percentualTexto(r.percentual)} para ${quemRecebeDaRegra(r)} (${alcanceDaRegra(r)}) sai da lista para sempre. `
          + 'O que já foi fechado mantém os percentuais com que fechou; o que ainda não foi fechado deixa de ter esta comissão. '
          + 'Para guardar o histórico, use "Desativar".',
        confirmText: 'Excluir'
      });
      if (!confirmado) return;
      avisar('');
      try {
        await fetchApi(`/api/financeiro/regras/${encodeURIComponent(r.id)}`, { method: 'DELETE' });
        window.showToast?.('Regra excluída.', 'success');
        if (editandoRegra?.id === r.id) limparFormRegra();
        avisarAlteracao();
        await carregar();
      } catch (e) {
        avisar(textoDoErro(e, 'Só o Sup Admin exclui uma regra.'));
      }
    }

    async function alternarRegra(r) {
      const confirmado = await window.DialogPadrao?.confirm?.({
        title: r.ativo ? 'Desativar a regra?' : 'Reativar a regra?',
        message: `${TIPOS_REGRA[r.tipo]} ${percentualTexto(r.percentual)} para ${quemRecebeDaRegra(r)} (${alcanceDaRegra(r)}). `
          + (r.ativo ? 'O que ainda não foi fechado deixa de ter esta comissão.' : 'Volta a valer para o que ainda não foi fechado.'),
        confirmText: r.ativo ? 'Desativar' : 'Reativar'
      });
      if (!confirmado) return;
      avisar('');
      try {
        await fetchApi(`/api/financeiro/regras/${encodeURIComponent(r.id)}`, { method: 'PUT', body: corpoDaRegra(r, { ativo: !r.ativo }) });
        window.showToast?.(r.ativo ? 'Regra desativada.' : 'Regra reativada.', 'success');
        if (editandoRegra?.id === r.id) limparFormRegra();
        avisarAlteracao();
        await carregar();
      } catch (e) {
        avisar(erroDe(e));
      }
    }

    function pintarRegras() {
      const corpo = el('finRegrasCorpo');
      corpo.replaceChildren();
      const regras = (dados?.regras || []).slice().sort((a, b) => Number(b.ativo) - Number(a.ativo)
        || String(a.tipo).localeCompare(String(b.tipo))
        || ['todos', 'cliente', 'pedido'].indexOf(a.escopo) - ['todos', 'cliente', 'pedido'].indexOf(b.escopo)
        || String(a.beneficiario).localeCompare(String(b.beneficiario), 'pt-BR'));
      el('finRegrasVazio').classList.toggle('hidden', !dados || regras.length > 0);
      corpo.closest('.fin-tabela').classList.toggle('hidden', regras.length === 0);
      for (const r of regras) {
        const acoes = criar('div', 'flex flex-wrap gap-2');
        if (podeEditar) {
          botaoG(acoes, 'Alterar', () => editarRegra(r), { perm: 'financeiro.regras.editar' });
          botaoG(acoes, r.ativo ? 'Desativar' : 'Reativar', () => alternarRegra(r), { classe: r.ativo ? 'btn-danger text-white' : 'btn-success', perm: 'financeiro.regras.editar' });
        }
        // Excluir de vez: só o Sup Admin (o backend confere de novo).
        if (dados?.pode_excluir) botaoG(acoes, 'Excluir', () => excluirRegra(r), { classe: 'btn-danger text-white', titulo: 'Apaga a regra (o fechado não muda)' });
        const tr = document.createElement('tr');
        if (!r.ativo) tr.classList.add('opacity-60');
        tr.append(
          celulaG(TIPOS_REGRA[r.tipo] || r.tipo), celulaG(r.beneficiario, 'px-4 py-3 text-white'),
          celulaG(percentualTexto(r.percentual), 'px-4 py-3 text-right'), celulaG(alcanceDaRegra(r)),
          celulaG(r.observacao || '—'), celulaG(r.ativo ? tagG('Ativa', 'badge-success') : tagG('Desativada', 'badge-neutral')), celulaG(acoes)
        );
        corpo.appendChild(tr);
      }
    }

    // ------------------------------------------------------ processos
    // Os mesmos da peça e da matéria-prima (etapas_producao): + inclui, − exclui
    // (só sem insumo), Renomear troca no banco, e o pagamento liga/desliga.
    const processoSel = el('finProcessoSelect');
    const processoAtual = () => (dados?.etapas || []).find(e => String(e.id) === processoSel.value) || null;
    const nomeComSituacao = e => (e.producao_ativa ? e.nome : `${e.nome} (pagamento desligado)`);

    function pintarSetores() {
      const etapas = dados?.etapas || [];
      const escolhido = processoSel.value;
      processoSel.replaceChildren();
      if (!etapas.length) processoSel.appendChild(opcao('', 'Nenhum processo cadastrado'));
      for (const e of etapas) processoSel.appendChild(opcao(String(e.id), nomeComSituacao(e)));
      if (etapas.some(e => String(e.id) === escolhido)) processoSel.value = escolhido;
      pintarProcessoEscolhido();

      const ul = el('finSetoresLista');
      ul.replaceChildren();
      for (const e of etapas) {
        const li = criar('li', 'flex items-center justify-between gap-3 py-2 cursor-pointer');
        li.appendChild(criar('span', `text-sm ${e.producao_ativa ? 'text-white' : 'text-gray-400'}`, e.nome));
        li.appendChild(e.producao_ativa ? tagG('Paga', 'badge-success') : tagG('Pagamento desligado', 'badge-neutral'));
        li.addEventListener('click', () => { processoSel.value = String(e.id); pintarProcessoEscolhido(); });
        ul.appendChild(li);
      }

      const sel = el('finValorSetor');
      const atual = sel.value;
      sel.replaceChildren(opcao('', 'Selecione'));
      for (const e of etapas) sel.appendChild(opcao(String(e.id), nomeComSituacao(e)));
      sel.value = [...sel.options].some(o => o.value === atual) ? atual : '';
    }

    function pintarProcessoEscolhido() {
      const e = processoAtual();
      el('finProcessoNome').value = e ? e.nome : '';
      const situacao = el('finProcessoSituacao');
      situacao.className = `${!e ? 'badge-neutral' : (e.producao_ativa ? 'badge-success' : 'badge-warning')} px-3 py-1 rounded-full text-xs font-medium`;
      situacao.textContent = !e ? '—' : (e.producao_ativa ? 'Pagamento ligado' : 'Pagamento desligado');
      const botao = el('finProcessoPagamento');
      const desligado = Boolean(e && !e.producao_ativa);
      botao.textContent = desligado ? 'Ligar pagamento' : 'Desligar pagamento';
      botao.classList.toggle('btn-danger', !desligado);
      botao.classList.toggle('text-white', true);
      botao.classList.toggle('btn-success', desligado);
      [botao, el('finProcessoRenomear'), el('finProcessoExcluir'), el('finProcessoNome')].forEach(c => { c.disabled = !podeEditar || !e; });
    }

    function abrirNovoProcesso(abrir) {
      el('finProcessoNovoBloco').classList.toggle('hidden', !abrir);
      el('finProcessoNovoNome').value = '';
      if (abrir) el('finProcessoNovoNome').focus();
    }

    /** Grava, relê e devolve a resposta (null se falhou — a mensagem já foi mostrada). */
    async function gravarProcesso(caminho, metodo, corpo, sucesso) {
      avisar('');
      try {
        const r = await fetchApi(caminho, { method: metodo, body: corpo ? JSON.stringify(corpo) : undefined });
        window.showToast?.(sucesso(r), 'success');
        avisarAlteracao();
        await carregar();
        return r || {};
      } catch (e) {
        avisar(erroDe(e));
        return null;
      }
    }

    async function incluirProcesso() {
      const nome = el('finProcessoNovoNome').value.trim();
      if (nome.length < 2) { avisar('Dê um nome ao processo.'); return; }
      const r = await gravarProcesso('/api/financeiro/etapas', 'POST', { nome }, () => `Processo ${nome} incluído.`);
      if (!r) return;
      abrirNovoProcesso(false);
      if (r.id !== null && r.id !== undefined) {
        processoSel.value = String(r.id);
        pintarProcessoEscolhido();
      }
    }

    async function renomearProcesso() {
      const e = processoAtual();
      if (!e) return;
      const nome = el('finProcessoNome').value.trim();
      if (nome.length < 2) { avisar('Dê um nome ao processo.'); return; }
      if (nome === e.nome) { avisar('O nome não mudou.'); return; }
      const confirmado = await window.DialogPadrao?.confirm?.({
        title: 'Renomear o processo?',
        message: `${e.nome} passa a se chamar ${nome}. Os insumos da matéria-prima, os lotes do estoque e os itens faltantes que usam ${e.nome} acompanham a troca.`,
        confirmText: 'Renomear'
      });
      if (!confirmado) return;
      await gravarProcesso(`/api/financeiro/etapas/${encodeURIComponent(e.id)}`, 'PUT', { nome },
        r => (r?.registros_renomeados ? `Processo renomeado: ${r.registros_renomeados} registro(s) acompanharam.` : 'Processo renomeado.'));
    }

    async function alternarPagamento() {
      const e = processoAtual();
      if (!e) return;
      const ligar = !e.producao_ativa;
      const confirmado = await window.DialogPadrao?.confirm?.({
        title: ligar ? 'Ligar o pagamento?' : 'Desligar o pagamento?',
        message: ligar
          ? `${e.nome} volta ao Registrar produção e volta a pagar o que ainda não foi fechado.`
          : `${e.nome} some do Registrar produção e deixa de pagar o que ainda não foi fechado. O processo continua nas peças e na matéria-prima.`,
        confirmText: ligar ? 'Ligar' : 'Desligar'
      });
      if (!confirmado) return;
      await gravarProcesso(`/api/financeiro/etapas/${encodeURIComponent(e.id)}`, 'PUT', { producao_ativa: ligar },
        () => (ligar ? `Pagamento de ${e.nome} ligado.` : `Pagamento de ${e.nome} desligado.`));
    }

    async function excluirProcesso() {
      const e = processoAtual();
      if (!e) return;
      const confirmado = await window.DialogPadrao?.confirm?.({
        title: 'Excluir o processo?',
        message: `${e.nome} sai da lista de processos. Só é possível se nenhum insumo da matéria-prima usar este processo.`,
        confirmText: 'Excluir'
      });
      if (!confirmado) return;
      await gravarProcesso(`/api/financeiro/etapas/${encodeURIComponent(e.id)}`, 'DELETE', null, () => `Processo ${e.nome} excluído.`);
    }

    // ----------------------------------------- valor de cada processo
    const produtoSel = el('finValorProduto');
    const produtoBusca = el('finValorProdutoBusca');
    const tipoValorSel = el('finValorTipo');
    const valorCampo = el('finValorValor');
    // A regra de todas as peças vale para toda peça sem regra própria ATIVA
    // naquele processo; a peça que tem a dela segue a dela
    // (backend/financeiro/producaoUnidades.js, regraDaPeca).
    const PADRAO_DO_PROCESSO = 'Todas as peças (vale para quem não tem regra própria ativa)';

    async function montarProdutos(selecionado) {
      const itens = await lista('produtos');
      // Na caixa aparece só o NOME; a busca continua achando pelo código.
      const rotulo = p => p.nome || p.codigo || `Peça ${p.id}`;
      const paraBusca = p => `${p.codigo || ''} ${p.nome || ''}`.toLowerCase();
      const atual = selecionado !== undefined ? String(selecionado) : produtoSel.value;
      const termo = produtoBusca.value.trim().toLowerCase();
      const visiveis = itens.filter(p => !termo || paraBusca(p).includes(termo) || String(p.id) === atual);
      produtoSel.replaceChildren(opcao('padrao', PADRAO_DO_PROCESSO));
      for (const p of visiveis.slice(0, 500)) produtoSel.appendChild(opcao(String(p.id), rotulo(p)));
      produtoSel.value = [...produtoSel.options].some(o => o.value === atual) ? atual : 'padrao';
    }

    const emPercentual = () => tipoValorSel.value === 'percentual';
    function pintarTipoValor() {
      el('finValorValorRotulo').firstChild.textContent = emPercentual() ? 'Percentual da tabela fixa (%) ' : 'Valor por peça ';
      valorCampo.placeholder = emPercentual() ? 'Ex.: 10 ou 7,5' : 'R$ 0,00';
    }
    const lerValorDoCampo = () => lerMoeda(String(valorCampo.value).replace(/%/g, ''));

    function editarValor(v) {
      el('finValorSetor').value = String(v.etapa_id);
      produtoBusca.value = '';
      montarProdutos(v.produto_id === null || v.produto_id === undefined ? 'padrao' : v.produto_id);
      tipoValorSel.value = v.tipo === 'percentual' ? 'percentual' : 'valor';
      pintarTipoValor();
      valorCampo.value = v.tipo === 'percentual'
        ? String(v.percentual ?? '').replace('.', ',')
        : formatoMoeda.format(Number(v.valor_unitario) || 0);
      valorCampo.focus();
    }

    /** Sem `remover`: grava o valor do formulário. Com `remover`: desliga aquela linha. */
    async function salvarValor(remover = null) {
      avisar('');
      const etapaId = remover ? Number(remover.etapa_id) : Number(el('finValorSetor').value);
      const escolha = remover ? (remover.produto_id === null || remover.produto_id === undefined ? 'padrao' : String(remover.produto_id)) : produtoSel.value;
      const corpo = { etapa_id: etapaId, produto_id: !escolha || escolha === 'padrao' ? null : Number(escolha) };
      if (!etapaId) { avisar('Escolha o processo.'); return; }
      if (remover) {
        const confirmado = await window.DialogPadrao?.confirm?.({
          title: 'Remover o valor?',
          message: remover.produto
            ? `${remover.etapa}: ${remover.produto} (${remover.descricao}). O que ainda não foi fechado desta peça passa a usar a regra de todas as peças, se houver.`
            : `${remover.etapa}: todas as peças (${remover.descricao}). As peças sem regra própria ativa ficam sem valor neste processo até que haja outra.`,
          confirmText: 'Remover'
        });
        if (!confirmado) return;
        corpo.remover = true;
      } else {
        const numero = lerValorDoCampo();
        if (emPercentual() ? (numero === null || numero < 0 || numero > 100) : (numero === null || numero < 0)) {
          avisar(emPercentual() ? 'O percentual vai de 0 a 100.' : 'Informe o valor por peça.');
          return;
        }
        corpo.tipo = emPercentual() ? 'percentual' : 'valor';
        corpo.valor = String(numero);
      }
      try {
        await fetchApi('/api/financeiro/valores', { method: 'POST', body: JSON.stringify(corpo) });
        window.showToast?.(remover ? 'Valor removido.' : 'Valor salvo.', 'success');
        if (!remover) valorCampo.value = '';
        avisarAlteracao();
        await carregar();
      } catch (e) {
        avisar(erroDe(e));
      }
    }

    function pintarValores() {
      const corpo = el('finValoresCorpo');
      corpo.replaceChildren();
      const semPeca = v => v.produto_id === null || v.produto_id === undefined;
      // "Todas as peças" sempre no topo (ordenarValoresDeProducao).
      const valores = ordenarValoresDeProducao(dados?.valores, dados?.etapas);
      el('finValoresVazio').classList.toggle('hidden', !dados || valores.length > 0);
      corpo.closest('.fin-tabela').classList.toggle('hidden', valores.length === 0);
      for (const v of valores) {
        const acoes = criar('div', 'flex flex-wrap gap-2');
        if (podeEditar) {
          botaoG(acoes, 'Alterar', () => editarValor(v), { perm: 'financeiro.regras.editar' });
          botaoG(acoes, 'Remover', () => salvarValor(v), { classe: 'btn-danger text-white', perm: 'financeiro.regras.editar' });
        }
        const tr = document.createElement('tr');
        tr.append(
          celulaG(v.etapa || '—', 'px-4 py-3 text-white'),
          celulaG(semPeca(v) ? tagG('Todas as peças', 'badge-info') : tagG(v.produto_codigo || v.produto, 'badge-warning', v.produto_nome || v.produto || '')),
          celulaG(v.descricao || '—'), celulaG(acoes)
        );
        corpo.appendChild(tr);
      }
    }

    // ------------------------------------------- calendário e prazos
    function pintarCalendario() {
      const cfg = dados?.configuracao || {};
      el('finCfgDiaComissao').value = String(cfg.comissao_dia_pagamento ?? 15);
      el('finCfgDiaUtil').value = String(cfg.producao_dia_util ?? 5);
      el('finCfgSabado').checked = Boolean(cfg.sabado_dia_util);

      const corpo = el('finFeriadosCorpo');
      corpo.replaceChildren();
      const feriados = dados?.feriados || [];
      el('finFeriadosVazio').classList.toggle('hidden', !dados || feriados.length > 0);
      corpo.closest('.fin-tabela').classList.toggle('hidden', feriados.length === 0);
      for (const f of feriados) {
        const acoes = criar('div', 'flex gap-2');
        if (podeEditar) botaoG(acoes, 'Retirar', () => retirarFeriado(f), { classe: 'btn-danger text-white', perm: 'financeiro.regras.editar' });
        const tr = document.createElement('tr');
        tr.append(celulaG(formatarData(f.data), 'px-4 py-3 text-white'), celulaG(f.descricao), celulaG(acoes));
        corpo.appendChild(tr);
      }

      const nacionais = el('finFeriadosNacionais');
      nacionais.replaceChildren();
      for (const f of dados?.feriados_nacionais || []) {
        const tr = document.createElement('tr');
        tr.append(celulaG(formatarData(f.data), 'px-4 py-3 text-white'), celulaG(f.descricao));
        nacionais.appendChild(tr);
      }
    }

    async function salvarPrazos() {
      avisar('');
      const corpo = {
        comissao_dia_pagamento: Number(el('finCfgDiaComissao').value),
        producao_dia_util: Number(el('finCfgDiaUtil').value),
        sabado_dia_util: el('finCfgSabado').checked
      };
      if (!Number.isInteger(corpo.comissao_dia_pagamento) || corpo.comissao_dia_pagamento < 1 || corpo.comissao_dia_pagamento > 28) { avisar('O dia do pagamento das comissões vai de 1 a 28.'); return; }
      if (!Number.isInteger(corpo.producao_dia_util) || corpo.producao_dia_util < 1 || corpo.producao_dia_util > 20) { avisar('O dia útil do pagamento da produção vai de 1 a 20.'); return; }
      try {
        await fetchApi('/api/financeiro/configuracao', { method: 'PUT', body: JSON.stringify(corpo) });
        window.showToast?.('Prazos salvos.', 'success');
        avisarAlteracao();
        await carregar();
      } catch (e) {
        avisar(erroDe(e));
      }
    }

    async function incluirFeriado() {
      avisar('');
      const data = el('finFeriadoData').value;
      const descricao = el('finFeriadoDescricao').value.trim();
      if (!data) { avisar('Informe a data do feriado.'); return; }
      if (descricao.length < 3) { avisar('Diga que feriado é.'); return; }
      try {
        await fetchApi('/api/financeiro/feriados', { method: 'POST', body: JSON.stringify({ data, descricao }) });
        window.showToast?.('Feriado incluído.', 'success');
        el('finFeriadoDescricao').value = '';
        avisarAlteracao();
        await carregar();
      } catch (e) {
        avisar(erroDe(e));
      }
    }

    async function retirarFeriado(f) {
      const confirmado = await window.DialogPadrao?.confirm?.({
        title: 'Retirar o feriado?',
        message: `${formatarData(f.data)} (${f.descricao}) volta a contar como dia útil.`,
        confirmText: 'Retirar'
      });
      if (!confirmado) return;
      avisar('');
      try {
        await fetchApi(`/api/financeiro/feriados/${encodeURIComponent(f.id)}`, { method: 'DELETE' });
        window.showToast?.('Feriado retirado.', 'success');
        avisarAlteracao();
        await carregar();
      } catch (e) {
        avisar(erroDe(e));
      }
    }

    // ------------------------------------------------------- ligações
    if (!podeEditar) {
      overlay.querySelectorAll('[data-fin-painel] input, [data-fin-painel] select, [data-fin-painel] textarea').forEach(c => { c.disabled = true; });
    }
    escopoSel.addEventListener('change', () => { alvoBusca.value = ''; alvoSel.value = ''; montarAlvo(); });
    tipoSel.addEventListener('change', () => { pintarQuemRecebe(); alvoSel.value = ''; montarAlvo(); });
    benefSel.addEventListener('change', () => { alvoBusca.value = ''; alvoSel.value = ''; montarAlvo(); });
    alvoBusca.addEventListener('input', () => montarAlvo());
    produtoBusca.addEventListener('input', () => montarProdutos());
    el('finRegraCancelarEdicao').addEventListener('click', limparFormRegra);
    processoSel.addEventListener('change', pintarProcessoEscolhido);
    el('finProcessoIncluir').addEventListener('click', () => abrirNovoProcesso(true));
    el('finProcessoNovoCancelar').addEventListener('click', () => abrirNovoProcesso(false));
    el('finProcessoNovoNome').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); el('finProcessoNovoSalvar').click(); } });
    tipoValorSel.addEventListener('change', () => { pintarTipoValor(); valorCampo.value = ''; });
    valorCampo.addEventListener('blur', () => {
      const n = lerValorDoCampo();
      valorCampo.value = n === null ? '' : (emPercentual() ? String(n).replace('.', ',') : formatoMoeda.format(n));
    });
    acionar(el('finRegraSalvar'), salvarRegra);
    acionar(el('finProcessoNovoSalvar'), incluirProcesso);
    acionar(el('finProcessoRenomear'), renomearProcesso);
    acionar(el('finProcessoPagamento'), alternarPagamento);
    acionar(el('finProcessoExcluir'), excluirProcesso);
    acionar(el('finValorSalvar'), () => salvarValor());
    acionar(el('finCfgSalvar'), salvarPrazos);
    acionar(el('finFeriadoIncluir'), incluirFeriado);
    // A lista de peças é grande: só é lida quando a aba Produção abre (e só para quem edita).
    overlay.querySelector('[data-fin-aba="producao"]')?.addEventListener('click', () => {
      if (podeEditar && !listas.produtos) montarProdutos('padrao');
    });
    produtoSel.replaceChildren(opcao('padrao', PADRAO_DO_PROCESSO));
    pintarQuemRecebe();
    pintarTipoValor();
    return carregar();
  }

  /**
   * Aba "Colaboradores (rateio)": quem participa das comissões e quanto por
   * cento cada um leva de CADA PEÇA contabilizada.
   *
   * A soma de uma peça vai até 100% e não passa — o backend recusa e a tela
   * já mostra o restante antes de tentar. Fechar a competência exige 100% em
   * toda peça, mas só quando há colaborador cadastrado (sem ninguém, o
   * recurso não está em uso). Ver backend/financeiro/rateios.js.
   */

  // ---------------------------------------------------- rateio da produção
  //
  // A produção paga por PROCESSO de cada peça. Aqui se diz quem fez cada um e
  // quanto por cento leva; a soma vai até 100% e não passa. Dá para ratear a
  // qualquer momento, no que já foi decidido no mês — o resto entra aqui
  // assim que for confirmado em "Fechar competência — produção".
  // Backend: backend/financeiro/rateios.js.

  function montarRateioProducao() {
    let estado = { colaboradores: [], pecas: [], resumo: [], pendentes: 0, sql_pendente: false, fechado: false, contagem: { pecas: 0, processos: 0 } };
    let editando = null;
    const avisar = (texto, tipo = 'erro') => mostrarMensagem('finRateioMensagem', texto, tipo);
    const erroDe = e => textoDoErro(e, 'Você não tem permissão para mexer no rateio.');
    const podeEditar = pode('financeiro.regras.editar');
    const pct = v => `${Number.isInteger(Number(v)) ? Number(v) : String(Number(v)).replace('.', ',')}%`;

    function pintarIndicadores() {
      const caixa = el('finRateioIndicadores');
      const c = estado.contagem || { pecas: 0, processos: 0 };
      const total = estado.total || 0;
      const lista = [
        { rotulo: 'Peças decididas', valor: String(c.pecas || 0), nota: `${c.processos || 0} ${c.processos === 1 ? 'processo' : 'processos'}` },
        { rotulo: 'Processos a distribuir', valor: String(estado.pendentes || 0), atencao: Boolean(estado.pendentes) },
        { rotulo: 'Colaboradores', valor: String((estado.colaboradores || []).length) },
        { rotulo: 'Produção da competência', valor: formatarMoeda(total), destaque: true }
      ];
      caixa.replaceChildren();
      for (const i of lista) {
        const cartao = criar('div', `fin-indicador${i.destaque ? ' fin-indicador--destaque' : ''}${i.atencao ? ' fin-indicador--atencao' : ''}`);
        cartao.append(criar('span', 'fin-indicador__rotulo', i.rotulo), criar('strong', 'fin-indicador__valor', i.valor));
        if (i.nota) cartao.appendChild(criar('span', 'text-xs text-gray-400', i.nota));
        caixa.appendChild(cartao);
      }
    }

    function pintarColaboradores() {
      const lista = el('finRateioColabLista');
      const vivos = (estado.colaboradores || []).filter(x => x.ativo !== false);
      el('finRateioColabTotal').textContent = vivos.length === 1 ? '1 pessoa' : `${vivos.length} pessoas`;
      lista.replaceChildren(...vivos.map(colab => {
        const li = criar('li', 'py-2 flex items-center justify-between gap-3');
        const dados = criar('div', 'min-w-0');
        dados.append(criar('p', 'text-sm text-white truncate', colab.nome));
        if (colab.funcao) dados.append(criar('p', 'text-xs text-gray-400 truncate', colab.funcao));
        const acoes = criar('div', 'ctl-acoes');
        if (podeEditar) {
          const editar = criar('button', 'btn-neutral ctl-botao ctl-botao--pequeno text-white', 'Editar');
          editar.type = 'button';
          editar.addEventListener('click', () => {
            editando = colab;
            el('finRateioColabNome').value = colab.nome;
            el('finRateioColabFuncao').value = colab.funcao || '';
            el('finRateioColabSalvar').textContent = 'Salvar';
            el('finRateioColabCancelar').classList.remove('hidden');
          });
          const desligar = criar('button', 'btn-danger ctl-botao ctl-botao--pequeno text-white', 'Desligar');
          desligar.type = 'button';
          acionar(desligar, () => removerColaborador(colab));
          acoes.append(editar, desligar);
        }
        li.append(dados, acoes);
        return li;
      }));
      el('finRateioColabVazio').classList.toggle('hidden', vivos.length > 0);
    }

    /** Um processo: quem já está nele, quanto falta e o formulário de incluir. */
    function linhaDoProcesso(peca, processo) {
      const caixa = criar('div', 'rounded-lg border border-white/10 bg-white/5 p-3 space-y-2');

      const topo = criar('div', 'flex flex-wrap items-center justify-between gap-3');
      const nome = criar('div', 'min-w-0');
      nome.append(criar('p', 'text-sm text-white truncate', processo.setor));
      nome.append(criar('p', 'text-xs text-gray-400 truncate',
        [`${processo.quantidade} un.`, formatarMoeda(processo.valor), processo.data ? `decidido em ${instanteCurto(processo.data)}` : ''].filter(Boolean).join(' · ')));
      const marca = criar('span', `${processo.completo ? 'badge-success' : 'badge-warning'} px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap`,
        processo.completo ? '100%' : `faltam ${pct(processo.restante)}`);
      topo.append(nome, marca);

      const trilho = criar('div', 'h-2 w-full rounded-full bg-white/10 overflow-hidden');
      const barra = criar('div', `h-2 rounded-full ${processo.completo ? 'bg-green' : 'bg-primary'}`);
      barra.style.width = `${Math.min(100, Number(processo.distribuido) || 0)}%`;
      trilho.appendChild(barra);
      caixa.append(topo, trilho);

      if (processo.linhas.length) {
        const linhas = criar('ul', 'space-y-1 text-sm');
        for (const l of processo.linhas) {
          const item = criar('li', 'flex items-center justify-between gap-3');
          item.append(criar('span', 'text-white truncate', `${l.colaborador} · ${pct(l.percentual)}`));
          const direita = criar('div', 'flex items-center gap-3 flex-shrink-0');
          direita.append(criar('span', 'text-xs text-gray-400', formatarMoeda(l.valor)));
          if (podeEditar && !estado.fechado) {
            const tirar = criar('button', 'btn-neutral ctl-botao ctl-botao--icone text-white');
            tirar.type = 'button';
            tirar.title = `Tirar ${l.colaborador} deste processo`;
            tirar.setAttribute('aria-label', tirar.title);
            const icone = criar('i', 'fas fa-times');
            icone.setAttribute('aria-hidden', 'true');
            tirar.appendChild(icone);
            acionar(tirar, () => removerLinha(l));
            direita.appendChild(tirar);
          }
          item.append(direita);
          linhas.appendChild(item);
        }
        caixa.appendChild(linhas);
      }

      if (podeEditar && !estado.fechado && !processo.completo) {
        const form = criar('div', 'flex flex-wrap items-end gap-2');
        const escolha = document.createElement('select');
        escolha.className = 'flex-1 min-w-0 appearance-none select-arrow ctl-campo ctl-campo--pequeno bg-input border border-inputBorder text-white focus:border-primary focus:ring-2 focus:ring-primary/50 transition';
        escolha.setAttribute('aria-label', `Colaborador de ${processo.setor}`);
        const jaEstao = new Set(processo.linhas.map(l => String(l.colaborador_id)));
        const livres = (estado.colaboradores || []).filter(x => x.ativo !== false && !jaEstao.has(String(x.id)));
        escolha.replaceChildren(...[opcao('', livres.length ? 'Quem fez?' : 'Todos já estão neste processo'), ...livres.map(x => opcao(String(x.id), x.nome))]);
        escolha.disabled = !livres.length;

        const valor = document.createElement('input');
        valor.type = 'text';
        valor.inputMode = 'decimal';
        valor.maxLength = 6;
        valor.placeholder = `até ${pct(processo.restante)}`;
        valor.className = 'w-24 ctl-campo ctl-campo--pequeno bg-input border border-inputBorder text-white placeholder-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/50 transition';
        valor.setAttribute('aria-label', `Percentual em ${processo.setor}`);

        const incluir = criar('button', 'btn-success ctl-botao ctl-botao--pequeno', 'Incluir');
        incluir.type = 'button';
        incluir.disabled = !livres.length;
        acionar(incluir, () => incluirLinha(peca, processo, escolha.value, valor.value || processo.restante));

        const tudo = criar('button', 'btn-neutral ctl-botao ctl-botao--pequeno text-white', `Dar os ${pct(processo.restante)}`);
        tudo.type = 'button';
        tudo.disabled = !livres.length;
        acionar(tudo, () => incluirLinha(peca, processo, escolha.value, processo.restante));

        form.append(escolha, valor, incluir, tudo);
        caixa.appendChild(form);
      }
      return caixa;
    }

    /** Uma peça: o cabeçalho, o atalho de copiar a divisão e os processos. */
    function blocoDaPeca(peca) {
      const li = criar('li', 'glass-surface rounded-xl border border-white/10 px-5 py-5 space-y-3');
      const topo = criar('div', 'flex flex-wrap items-start justify-between gap-3');
      const quem = criar('div', 'min-w-0');
      const linhaCodigo = criar('div', 'flex items-center gap-2 flex-wrap');
      const codigo = criar('span', 'fin-tag-produto fin-tag-produto--bordo', peca.produto);
      codigo.title = peca.produto;
      linhaCodigo.appendChild(codigo);
      quem.appendChild(linhaCodigo);
      quem.appendChild(criar('p', 'text-xs text-gray-400 mt-1 truncate',
        [peca.pedido || `pedido ${peca.pedido_id}`, `${peca.processos.length} ${peca.processos.length === 1 ? 'processo' : 'processos'}`, formatarMoeda(peca.valor)].filter(Boolean).join(' · ')));
      const marca = criar('span', `${peca.completo ? 'badge-success' : 'badge-warning'} px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap`,
        peca.completo ? 'peça distribuída' : `${peca.processos_completos} de ${peca.processos.length} processos`);
      topo.append(quem, marca);
      li.appendChild(topo);

      // O atalho que o dono pediu: um processo já dividido serve de modelo
      // para os outros da MESMA peça (quem divide a peça inteira igual).
      const modelo = peca.processos.find(p => p.completo);
      const faltam = peca.processos.filter(p => !p.completo);
      if (podeEditar && !estado.fechado && modelo && faltam.length) {
        const atalho = criar('button', 'btn-neutral ctl-botao ctl-botao--pequeno text-white',
          `Mesma divisão nos outros ${faltam.length === 1 ? 'processo' : `${faltam.length} processos`}`);
        atalho.type = 'button';
        atalho.title = `Copia a divisão de ${modelo.setor} para os processos desta peça que ainda não têm ninguém`;
        acionar(atalho, () => copiarNaPeca(peca, modelo));
        linhaCodigo.appendChild(atalho);
      }

      const processos = criar('div', 'space-y-2');
      for (const processo of peca.processos) processos.appendChild(linhaDoProcesso(peca, processo));
      li.appendChild(processos);
      return li;
    }

    function pintar() {
      pintarIndicadores();
      pintarColaboradores();
      el('finRateioPecas').replaceChildren(...(estado.pecas || []).map(blocoDaPeca));
      el('finRateioVazio').classList.toggle('hidden', (estado.pecas || []).length > 0);
      el('finRateioSemSql').classList.toggle('hidden', !estado.sql_pendente);
      pintarSituacao(el('finRateioSituacao'), estado.fechado ? 'Fechada' : (estado.pendentes ? 'Falta distribuir' : 'Em aberto'));

      const porPessoa = el('finRateioPorPessoaLista');
      porPessoa.replaceChildren(...(estado.resumo || []).map(r => {
        const li = criar('li', 'flex items-center justify-between gap-3');
        li.append(criar('span', 'text-white truncate', r.colaborador),
          criar('span', 'text-gray-300 flex-shrink-0', `${formatarMoeda(r.valor)} · ${r.processos === 1 ? '1 processo' : `${r.processos} processos`}`));
        return li;
      }));
      el('finRateioPorPessoa').classList.toggle('hidden', !(estado.resumo || []).length);

      // O que ainda espera decisão (os bloqueios que não são do rateio).
      const esperando = (estado.bloqueios || []).filter(b => !/distribuí/i.test(b));
      el('finRateioEsperandoTexto').textContent = esperando.join(' ');
      el('finRateioEsperando').classList.toggle('hidden', !esperando.length);

      const fecharBtn = el('finRateioFecharCompetencia');
      fecharBtn.disabled = !estado.pode_fechar;
      fecharBtn.title = estado.pode_fechar
        ? 'Fecha a competência da produção'
        : (estado.bloqueios || []).join(' ') || 'Esta competência não pode ser fechada agora.';
    }

    async function carregar() {
      const competencia = el('finRateioCompetencia').value;
      if (!competencia) return;
      el('finRateioCarregando').classList.remove('hidden');
      avisar('');
      try {
        const corpo = await fetchApi(`/api/financeiro/rateio?competencia=${encodeURIComponent(competencia)}`);
        estado = { ...corpo, colaboradores: corpo.colaboradores || [], pecas: corpo.pecas || [], resumo: corpo.resumo || [] };
        el('finRateioInfo').textContent = corpo.pagar_ate ? `Pagamento até ${formatarData(corpo.pagar_ate)}` : '';
        pintar();
        if (!corpo.sql_pendente && !estado.colaboradores.length) {
          avisar('Cadastre ao menos um colaborador para começar a distribuir. Sem ninguém cadastrado, o fechamento não exige rateio.', 'ok');
        }
      } catch (e) {
        avisar(erroDe(e));
      } finally {
        el('finRateioCarregando').classList.add('hidden');
      }
    }

    function limparFormulario() {
      editando = null;
      el('finRateioColabNome').value = '';
      el('finRateioColabFuncao').value = '';
      el('finRateioColabSalvar').textContent = 'Cadastrar';
      el('finRateioColabCancelar').classList.add('hidden');
    }

    async function salvarColaborador() {
      const nome = el('finRateioColabNome').value.trim();
      if (!nome) { avisar('Informe o nome do colaborador.'); return; }
      try {
        const corpo = { nome, funcao: el('finRateioColabFuncao').value.trim() || null };
        if (editando) await fetchApi(`/api/financeiro/colaboradores/${editando.id}`, { method: 'PUT', body: JSON.stringify(corpo) });
        else await fetchApi('/api/financeiro/colaboradores', { method: 'POST', body: JSON.stringify(corpo) });
        window.showToast?.(editando ? 'Colaborador atualizado.' : `${nome} entrou no rateio da produção.`, 'success');
        limparFormulario();
        await carregar();
      } catch (e) {
        avisar(erroDe(e));
      }
    }

    async function removerColaborador(colab) {
      const ok = await window.DialogPadrao?.confirm?.({
        title: 'Desligar o colaborador?', tom: 'aviso', icone: 'fa-user-minus', subtitle: colab.nome,
        nota: 'Ele sai dos processos em que estava, e esses processos voltam a ficar incompletos. O histórico guarda o que houve.',
        confirmText: 'Desligar', confirmVariant: 'danger'
      });
      if (!ok) return;
      try {
        await fetchApi(`/api/financeiro/colaboradores/${colab.id}`, { method: 'DELETE' });
        window.showToast?.(`${colab.nome} saiu do rateio.`, 'success');
        await carregar();
      } catch (e) {
        avisar(erroDe(e));
      }
    }

    async function incluirLinha(peca, processo, colaboradorId, percentual) {
      if (!colaboradorId) { avisar('Escolha quem fez este processo.'); return; }
      try {
        await fetchApi('/api/financeiro/rateio', {
          method: 'POST',
          body: JSON.stringify({
            pedido_id: peca.pedido_id, pedido_item_id: peca.pedido_item_id,
            setor_id: processo.setor_id, produto_id: peca.produto_id,
            colaborador_id: Number(colaboradorId), percentual
          })
        });
        await carregar();
      } catch (e) {
        avisar(erroDe(e));
      }
    }

    async function copiarNaPeca(peca, modelo) {
      try {
        const r = await fetchApi('/api/financeiro/rateio/peca', {
          method: 'POST',
          body: JSON.stringify({
            pedido_id: peca.pedido_id, pedido_item_id: peca.pedido_item_id, produto_id: peca.produto_id,
            setores: peca.processos.filter(p => p.setor_id !== modelo.setor_id).map(p => p.setor_id),
            linhas: modelo.linhas.map(l => ({ colaborador_id: l.colaborador_id, percentual: l.percentual }))
          })
        });
        window.showToast?.(`Divisão copiada para ${r.aplicados === 1 ? '1 processo' : `${r.aplicados} processos`}${r.pulados ? ` (${r.pulados} já tinha divisão)` : ''}.`, 'success');
        await carregar();
      } catch (e) {
        avisar(erroDe(e));
      }
    }

    async function removerLinha(linha) {
      try {
        await fetchApi(`/api/financeiro/rateio/${linha.id}`, { method: 'DELETE' });
        await carregar();
      } catch (e) {
        avisar(erroDe(e));
      }
    }

    async function fecharCompetencia() {
      if (!estado.pode_fechar) { avisar((estado.bloqueios || []).join(' ') || 'Esta competência não pode ser fechada agora.'); return; }
      const ok = await window.DialogPadrao?.confirm?.({
        title: 'Fechar a competência da produção?', tom: 'aviso', icone: 'fa-lock',
        message: `A produção de ${el('finRateioCompetencia').value} será congelada com o rateio como está: ${formatarMoeda(estado.total)} divididos entre ${(estado.resumo || []).length} ${(estado.resumo || []).length === 1 ? 'colaborador' : 'colaboradores'}.`,
        confirmText: 'Fechar competência'
      });
      if (!ok) return;
      try {
        await fetchApi('/api/financeiro/fechamentos', {
          method: 'POST', body: JSON.stringify({ tipo: 'producao', competencia: el('finRateioCompetencia').value })
        });
        window.showToast?.('Competência da produção fechada.', 'success');
        await carregar();
      } catch (e) {
        avisar(erroDe(e));
      }
    }

    const inicial = contexto.competencia || competenciaAtual();
    el('finRateioCompetencia').value = String(inicial).slice(0, 7);
    acionar(el('finRateioColabSalvar'), salvarColaborador);
    el('finRateioColabCancelar').addEventListener('click', limparFormulario);
    acionar(el('finRateioBuscar'), carregar);
    el('finRateioCompetencia').addEventListener('change', carregar);
    acionar(el('finRateioFecharCompetencia'), fecharCompetencia);
    return carregar();
  }

  // ------------------------------------------------ configuração fiscal
  //
  // O único modal desta etapa que fala com o backend de verdade:
  // GET/PUT /api/fiscal/configuracao, o certificado e o teste da SEFAZ.

  async function fetchApi(caminho, opcoes) {
    const base = await window.apiConfig.getApiBaseUrl();
    const resposta = await fetch(`${base}${caminho}`, {
      ...opcoes,
      headers: { 'Content-Type': 'application/json', ...(opcoes?.headers || {}) }
    });
    let corpo = null;
    try { corpo = await resposta.json(); } catch (_) { corpo = null; }
    if (!resposta.ok) {
      const e = new Error(corpo?.error || `O servidor respondeu com erro (${resposta.status}).`);
      e.status = resposta.status;
      // O que veio além da mensagem (pendências, a nota, o cStat da SEFAZ).
      e.corpo = corpo;
      throw e;
    }
    return corpo;
  }

  function montarConfiguracaoFiscal() {
    const campos = overlay.querySelectorAll('[data-fin-cfg]');
    let podeEditar = false;
    let ambienteNoBanco = 'homologacao';

    const texto = (id, valor) => { const e = el(id); if (e) e.textContent = valor ?? '—'; };
    const marcarTag = (id, classe, rotulo) => {
      const e = el(id);
      if (!e) return;
      e.className = `${classe} px-3 py-1 rounded-full text-xs font-medium ${id === 'finCfgAmbienteTag' ? 'justify-self-end' : ''}`;
      e.textContent = rotulo;
    };
    const mensagem = (txt, tipo = 'erro') => mostrarMensagem('finCfgMensagem', txt, tipo);

    function pintarCertificado(c) {
      const editar = el('finCfgCertEditar');
      if (!c || !c.configurado) {
        marcarTag('finCfgCertTag', 'badge-danger', 'Não configurado');
        ['finCfgCertTitular', 'finCfgCertCnpj', 'finCfgCertEmissor', 'finCfgCertValidade', 'finCfgCertConfere'].forEach(id => texto(id, '—'));
        const m = el('finCfgCertMensagem');
        m.textContent = c?.erro || 'Escolha o arquivo .pfx e informe a senha para guardar o certificado neste computador.';
        m.style.color = c?.erro ? 'var(--color-red)' : '';
        m.classList.remove('hidden');
        return;
      }
      marcarTag('finCfgCertTag', c.vencido ? 'badge-danger' : (c.venceEmBreve ? 'badge-warning' : 'badge-success'),
        c.vencido ? 'Vencido' : (c.venceEmBreve ? `Vence em ${c.diasRestantes} dias` : 'Válido'));
      texto('finCfgCertTitular', c.titular);
      texto('finCfgCertCnpj', c.cnpj ? c.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : '—');
      texto('finCfgCertEmissor', c.emissor);
      texto('finCfgCertValidade', `${formatarData(String(c.validoAte).slice(0, 10))} (${c.diasRestantes} dias)`);
      texto('finCfgCertConfere', c.confereComEmitente === null ? '—' : (c.confereComEmitente ? 'Sim' : 'NÃO — o CNPJ do certificado é outro'));
      const m = el('finCfgCertMensagem');
      const quando = c.guardadoEm ? ` em ${formatarData(String(c.guardadoEm).slice(0, 10))}` : '';
      const origem = c.origem === 'env' ? 'Lido das variáveis de ambiente (DEV).'
        : (c.origem === 'banco' ? `Guardado no banco${quando} — vale para todas as máquinas.` : (c.guardadoEm ? `Guardado só neste computador${quando}.` : ''));
      m.textContent = origem;
      m.style.color = '';
      m.classList.toggle('hidden', !origem);
      if (c.confereComEmitente === false) { m.textContent = 'Este certificado não é do CNPJ do emitente: a SEFAZ vai rejeitar a nota.'; m.style.color = 'var(--color-red)'; m.classList.remove('hidden'); }
      if (editar) editar.classList.toggle('hidden', !podeEditar);
    }

    function pintar(estado) {
      podeEditar = Boolean(estado?.pode_editar);
      ambienteNoBanco = estado?.ambiente_no_banco || 'homologacao';
      const cfg = estado?.configuracao || {};
      for (const campo of campos) {
        const valor = cfg[campo.dataset.finCfg];
        campo.value = valor === null || valor === undefined ? '' : String(valor);
        campo.disabled = !podeEditar;
      }
      el('finCfgSalvar')?.classList.toggle('hidden', !podeEditar);
      el('finCfgRodapeAviso').textContent = podeEditar
        ? 'Alterações valem para todos os usuários.'
        : 'Só o Sup Admin altera a configuração. Você vê o que está valendo.';

      const producao = estado?.ambiente === 'producao';
      marcarTag('finCfgAmbienteTag', producao ? 'badge-danger' : 'badge-warning', producao ? 'PRODUÇÃO' : 'Homologação');
      el('finCfgTravaMaquina')?.classList.toggle('hidden', !estado?.travado_em_homologacao_nesta_maquina);

      const pend = el('finCfgPendencias');
      const lista = Array.isArray(estado?.pendencias) ? estado.pendencias : [];
      pend.classList.toggle('hidden', !lista.length);
      pend.querySelector('span').textContent = lista.join(' • ');

      pintarCertificado(estado?.certificado);
      pintarEmail(estado?.email);
      pintarDestinos(Boolean(estado?.banco_chave_mestra));
      texto('finCfgInutAmbiente', producao ? 'produção' : 'homologação');
      el('finCfgInutSerie').value = String(estado?.numeracao?.serie ?? '');
      el('finCfgEmailSenhaBloco')?.classList.toggle('hidden', !podeEditar);
      alternarConfirmacao();
      carregarInutilizacoes();
    }

    /**
     * Onde certificado e senha do e-mail podem ser guardados: no banco só
     * quando esta máquina tem a chave mestra (senão, fica só o computador).
     */
    let bancoChaveMestra = false;
    function pintarDestinos(temChave) {
      bancoChaveMestra = temChave;
      for (const nome of ['finCfgCertDestino', 'finCfgEmailDestino']) {
        const radios = overlay.querySelectorAll(`input[name="${nome}"]`);
        radios.forEach(r => {
          if (r.value === 'banco') r.disabled = !temChave;
          if (!radios.length) return;
        });
        const marcado = Array.from(radios).some(r => r.checked && !r.disabled);
        if (!marcado) radios.forEach(r => { r.checked = r.value === (temChave ? 'banco' : 'computador'); });
      }
      el('finCfgCertDestinoAviso')?.classList.toggle('hidden', temChave);
    }
    const destinoEscolhido = nome => overlay.querySelector(`input[name="${nome}"]:checked`)?.value || (bancoChaveMestra ? 'banco' : 'computador');

    function pintarEmail(estadoEmail) {
      const e = el('finCfgEmailEstado');
      if (!e) return;
      if (!estadoEmail) { e.textContent = ''; return; }
      const partes = [];
      const onde = estadoEmail.origem === 'banco' ? 'no banco (todas as máquinas)' : (estadoEmail.origem === 'env' ? 'no .env (DEV)' : 'só neste computador');
      if (estadoEmail.senha_guardada) partes.push(`Senha guardada ${onde}${estadoEmail.guardada_em ? ` em ${formatarData(String(estadoEmail.guardada_em).slice(0, 10))}` : ''}.`);
      else partes.push('Sem senha do e-mail: o envio não funciona até guardá-la.');
      if (estadoEmail.erro) partes.push(estadoEmail.erro);
      if (Array.isArray(estadoEmail.pendencias) && estadoEmail.pendencias.length) partes.push(`Falta: ${estadoEmail.pendencias.join(', ')}.`);
      e.textContent = partes.join(' ');
      e.style.color = estadoEmail.senha_guardada && !estadoEmail.pendencias?.length ? 'var(--color-green)' : '';
    }

    async function guardarSenhaEmail() {
      mensagem('');
      const senha = el('finCfgEmailSenha').value;
      if (!senha) { mensagem('Informe a senha do e-mail.'); return; }
      try {
        const destino = destinoEscolhido('finCfgEmailDestino');
        const r = await fetchApi('/api/fiscal/email/senha', { method: 'POST', body: JSON.stringify({ senha, destino }) });
        el('finCfgEmailSenha').value = '';
        pintarEmail(r);
        window.showToast?.(destino === 'banco' ? 'Senha do e-mail guardada no banco, para todas as máquinas.' : 'Senha do e-mail guardada neste computador.', 'success');
      } catch (e) {
        mensagem(e.message);
      }
    }

    async function removerSenhaEmail() {
      const ok = await (window.DialogPadrao?.confirm?.({
        title: 'Remover a senha do e-mail?',
        message: 'A senha sai do banco e deste computador. O envio de NF-e por e-mail para de funcionar até guardá-la de novo.',
        confirmText: 'Remover'
      }) ?? Promise.resolve(true));
      if (!ok) return;
      try {
        pintarEmail(await fetchApi('/api/fiscal/email/senha', { method: 'DELETE' }));
      } catch (e) {
        mensagem(e.message);
      }
    }

    async function testarEmail() {
      mensagem('');
      try {
        const r = await fetchApi('/api/fiscal/email/testar', { method: 'POST', body: JSON.stringify({}) });
        window.showToast?.(`E-mail de teste enviado para ${r.para.join(', ')}.`, 'success');
      } catch (e) {
        mensagem(e.message);
      }
    }

    async function carregarInutilizacoes() {
      const bloco = el('finCfgInutLista');
      const corpo = el('finCfgInutLinhas');
      if (!bloco || !corpo) return;
      let lista = [];
      try { lista = await fetchApi('/api/fiscal/inutilizacoes'); } catch (_) { lista = []; }
      corpo.replaceChildren();
      for (const i of Array.isArray(lista) ? lista : []) {
        const tr = document.createElement('tr');
        const celula = (t, cor) => { const td = document.createElement('td'); td.className = 'px-4 py-2 text-white'; td.textContent = t; if (cor) td.style.color = cor; return td; };
        tr.append(
          celula(i.ambiente === 'producao' ? 'Produção' : 'Homologação'),
          celula(String(i.serie)),
          celula(i.numero_inicial === i.numero_final ? String(i.numero_inicial) : `${i.numero_inicial} a ${i.numero_final}`),
          celula(i.status === 'homologada' ? `Homologada (${i.codigo_status_sefaz || '102'})` : `Rejeitada: ${i.codigo_status_sefaz || ''} ${i.motivo_sefaz || ''}`.trim(), i.status === 'homologada' ? 'var(--color-green)' : 'var(--color-red)'),
          celula(i.protocolo || '—'),
          celula(formatarData(String(i.criado_em || '').slice(0, 10)))
        );
        corpo.appendChild(tr);
      }
      bloco.classList.toggle('hidden', !(Array.isArray(lista) && lista.length));
    }

    async function inutilizar() {
      const caixa = el('finCfgInutResultado');
      const mostrar = (t, cor) => { caixa.textContent = t; caixa.style.color = cor || ''; caixa.classList.remove('hidden'); };
      const serie = el('finCfgInutSerie').value.trim();
      const inicio = el('finCfgInutInicio').value.trim();
      const fim = el('finCfgInutFim').value.trim() || inicio;
      const justificativa = el('finCfgInutJustificativa').value.trim();
      if (!/^\d+$/.test(serie) || !/^\d+$/.test(inicio) || !/^\d+$/.test(fim)) { mostrar('Informe série e a faixa de números (só dígitos).', 'var(--color-red)'); return; }
      if (justificativa.length < 15) { mostrar('A justificativa precisa ter pelo menos 15 caracteres.', 'var(--color-red)'); return; }
      const ok = await window.DialogPadrao?.confirm?.({
        title: 'Inutilizar numeração na SEFAZ?',
        message: `Série ${serie}, ${inicio === fim ? `nº ${inicio}` : `do nº ${inicio} ao ${fim}`}. A SEFAZ registra e não dá para desfazer.`,
        confirmText: 'Inutilizar'
      });
      if (!ok) return;
      mostrar('Enviando à SEFAZ…');
      try {
        const r = await fetchApi('/api/fiscal/inutilizacoes', { method: 'POST', body: JSON.stringify({ serie: Number(serie), numero_inicial: Number(inicio), numero_final: Number(fim), justificativa }) });
        mostrar(`Inutilização homologada — SEFAZ ${r.sefaz.cStat}: ${r.sefaz.xMotivo}. Protocolo ${r.sefaz.protocolo || '—'}.`, 'var(--color-green)');
        el('finCfgInutInicio').value = ''; el('finCfgInutFim').value = ''; el('finCfgInutJustificativa').value = '';
        carregarInutilizacoes();
        carregar();
      } catch (e) {
        mostrar(e.message, 'var(--color-red)');
        carregarInutilizacoes();
      }
    }

    function alternarConfirmacao() {
      const escolhido = el('finCfg_ambiente')?.value;
      el('finCfgConfirmacaoProducao')?.classList.toggle('hidden', !(escolhido === 'producao' && ambienteNoBanco !== 'producao'));
    }

    async function carregar() {
      try {
        const estado = await fetchApi('/api/fiscal/configuracao');
        pintar(estado);
        el('finCfgConteudo').classList.remove('hidden');
      } catch (e) {
        const erroEl = el('finCfgErroGeral');
        erroEl.querySelector('span').textContent = e.message;
        erroEl.classList.remove('hidden');
      } finally {
        el('finCfgCarregando').classList.add('hidden');
      }
    }

    async function salvar() {
      mensagem('');
      const corpo = {};
      for (const campo of campos) corpo[campo.dataset.finCfg] = campo.value;
      const confirmacao = el('finCfgConfirmacao')?.value || '';
      if (confirmacao) corpo.confirmacao = confirmacao;
      try {
        const estado = await fetchApi('/api/fiscal/configuracao', { method: 'PUT', body: JSON.stringify(corpo) });
        pintar(estado);
        if (el('finCfgConfirmacao')) el('finCfgConfirmacao').value = '';
        window.showToast?.('Configuração fiscal salva.', 'success');
      } catch (e) {
        mensagem(e.message);
      }
    }

    async function escolherCertificado() {
      if (typeof window.electronAPI?.selecionarCertificadoFiscal !== 'function') {
        mensagem('A escolha do arquivo só funciona dentro do aplicativo.');
        return;
      }
      const caminho = await window.electronAPI.selecionarCertificadoFiscal();
      if (caminho) el('finCfgCertCaminho').value = caminho;
    }

    async function guardarCertificado() {
      mensagem('');
      const caminho = el('finCfgCertCaminho').value;
      const senha = el('finCfgCertSenha').value;
      if (!caminho) { mensagem('Escolha o arquivo .pfx do certificado.'); return; }
      if (!senha) { mensagem('Informe a senha do certificado.'); return; }
      try {
        const destino = destinoEscolhido('finCfgCertDestino');
        const r = await fetchApi('/api/fiscal/certificado', { method: 'POST', body: JSON.stringify({ caminho, senha, destino }) });
        el('finCfgCertSenha').value = '';
        pintarCertificado(r);
        window.showToast?.(destino === 'banco' ? 'Certificado guardado no banco, para todas as máquinas.' : 'Certificado guardado neste computador.', 'success');
      } catch (e) {
        mensagem(e.message);
      }
    }

    async function removerCertificado() {
      const ok = await (window.DialogPadrao?.confirm?.({
        title: 'Remover certificado',
        message: 'O certificado e a senha saem do banco e deste computador. A emissão de NF-e deixa de funcionar até cadastrar de novo.',
        confirmText: 'Remover'
      }) ?? Promise.resolve(true));
      if (!ok) return;
      try {
        pintarCertificado(await fetchApi('/api/fiscal/certificado', { method: 'DELETE' }));
      } catch (e) {
        mensagem(e.message);
      }
    }

    async function testarSefaz() {
      const resultado = el('finCfgSefazResultado');
      const detalhe = el('finCfgSefazDetalhe');
      resultado.textContent = 'Consultando a SEFAZ…';
      resultado.style.color = '';
      detalhe.classList.add('hidden');
      try {
        const r = await fetchApi('/api/fiscal/sefaz/status', { method: 'POST', body: JSON.stringify({}) });
        resultado.textContent = r.emOperacao ? 'Conectado: serviço em operação.' : `A SEFAZ respondeu ${r.cStat}: ${r.xMotivo}`;
        resultado.style.color = r.emOperacao ? 'var(--color-green)' : 'var(--color-primary-light)';
        texto('finCfgSefazAmbiente', r.ambiente === 'producao' ? 'Produção' : 'Homologação');
        texto('finCfgSefazStatus', `${r.cStat} — ${r.xMotivo}`);
        texto('finCfgSefazVersao', r.versaoAplicacao);
        texto('finCfgSefazTempo', `${r.tempoMs} ms`);
        detalhe.classList.remove('hidden');
      } catch (e) {
        resultado.textContent = e.message;
        resultado.style.color = 'var(--color-red)';
      }
    }

    /**
     * Emissão de teste: acha o pedido pelo número (ou pelo id), emite em
     * homologação e mostra o que a SEFAZ respondeu — ou as pendências.
     */
    async function emitirTeste() {
      const numeroPedido = (el('finCfgTestePedido')?.value || '').trim();
      const caixa = el('finCfgTesteResultado');
      // Linhas de texto (e uma lista de pendências) montadas por nós: nada do servidor vira HTML.
      const mostrar = (linhas, cor, pendencias = []) => {
        caixa.replaceChildren();
        for (const linha of [].concat(linhas).filter(Boolean)) {
          const div = document.createElement('div');
          div.textContent = linha;
          caixa.appendChild(div);
        }
        if (pendencias.length) {
          const ul = document.createElement('ul');
          ul.className = 'mt-2 ml-5 list-disc space-y-1';
          for (const p of pendencias) {
            const li = document.createElement('li');
            li.textContent = p?.mensagem || String(p);
            ul.appendChild(li);
          }
          caixa.appendChild(ul);
        }
        caixa.style.color = cor || '';
        caixa.classList.remove('hidden');
      };
      if (!numeroPedido) { mostrar('Informe o número do pedido.', 'var(--color-red)'); return; }
      mostrar('Montando, assinando e enviando à SEFAZ de homologação…');
      try {
        const porNumero = await fetchApi(`/api/pedidos?numero=${encodeURIComponent(numeroPedido)}`).catch(() => []);
        let pedido = (Array.isArray(porNumero) ? porNumero : []).find(p => String(p?.numero) === numeroPedido) || null;
        if (!pedido && /^\d+$/.test(numeroPedido)) {
          const porId = await fetchApi(`/api/pedidos?id=${numeroPedido}`).catch(() => []);
          pedido = (Array.isArray(porId) ? porId : []).find(p => String(p?.id) === numeroPedido) || null;
        }
        if (!pedido) throw new Error(`Pedido ${numeroPedido} não encontrado.`);

        const r = await fetchApi(`/api/fiscal/pedidos/${pedido.id}/emitir`, { method: 'POST', body: JSON.stringify({ ambiente: 'homologacao' }) });
        const n = r.nota || {};
        const situacao = r.autorizada ? 'Autorizada em homologação' : (r.processando ? 'Em processamento na SEFAZ' : 'Enviada');
        mostrar([
          `${situacao} — SEFAZ ${r.sefaz?.cStat ?? '?'}: ${r.sefaz?.xMotivo ?? ''}`,
          `NF-e série ${n.serie ?? '?'} nº ${n.numero ?? '?'} · chave ${n.chave_acesso ?? '—'}`,
          r.sefaz?.protocolo ? `Protocolo ${r.sefaz.protocolo}` : (r.sefaz?.recibo ? `Recibo ${r.sefaz.recibo} (consulte depois)` : ''),
          ...(r.avisos || []).map(a => `Aviso: ${a}`)
        ], r.autorizada ? 'var(--color-green)' : 'var(--color-primary-light)');
        window.showToast?.(r.autorizada ? `NF-e de teste nº ${n.numero} autorizada.` : 'NF-e enviada; aguardando a SEFAZ.', r.autorizada ? 'success' : 'info');
      } catch (e) {
        const corpo = e.corpo || {};
        const pendencias = Array.isArray(corpo.pendencias) ? corpo.pendencias : [];
        const nota = corpo.nota ? `Nota série ${corpo.nota.serie} nº ${corpo.nota.numero} ficou como "${corpo.nota.status_fiscal}".` : '';
        mostrar([e.message, nota], 'var(--color-red)', pendencias);
      }
    }

    const ligar = (id, fn) => {
      const botao = el(id);
      if (!botao) return;
      botao.dataset.acaoGerida = 'true';
      botao.addEventListener('click', () => (window.BotaoAcao?.run ? window.BotaoAcao.run(botao, fn) : fn()));
    };
    ligar('finCfgSalvar', salvar);
    ligar('finCfgCertEscolher', escolherCertificado);
    ligar('finCfgCertGuardar', guardarCertificado);
    ligar('finCfgCertRemover', removerCertificado);
    ligar('finCfgTestarSefaz', testarSefaz);
    ligar('finCfgTesteEmitir', emitirTeste);
    ligar('finCfgEmailGuardar', guardarSenhaEmail);
    ligar('finCfgEmailRemover', removerSenhaEmail);
    ligar('finCfgEmailTestar', testarEmail);
    ligar('finCfgInutilizar', inutilizar);
    el('finCfg_ambiente')?.addEventListener('change', alternarConfirmacao);

    return carregar();
  }

  // ------------------------------------------- pedidos aguardando NF-e
  //
  // REAL: GET /api/fiscal/painel da competência escolhida. "Emitir NF-e" abre
  // o modal de emissão dos Pedidos por cima (pedido já enviado: a nota sai
  // sem mudar a situação); "Sem NF-e" marca o pedido como enviado sem nota.

  function montarAguardandoNfe() {
    const competenciaSel = el('finAguardNfeCompetencia');
    const busca = el('finAguardNfeBusca');
    const incluir = el('finAguardNfeIncluirDispensados');
    const corpo = el('finAguardNfeCorpo');
    const tabela = corpo.closest('.fin-tabela');
    montarCompetencias(competenciaSel, contexto.competencia);
    const carregamento = criarCarregamento({ tbody: corpo, colunas: 7, aviso: el('finAguardNfeCarregando'), vazio: el('finAguardNfeVazio') });
    let painel = null;

    function pintarAmbiente(ambiente) {
      const tag = el('finAguardNfeAmbiente');
      if (!tag) return;
      const producao = ambiente === 'producao';
      tag.className = `${ambiente ? (producao ? 'badge-success' : 'badge-warning') : 'badge-neutral'} px-3 py-1 rounded-full text-xs font-medium justify-self-end`;
      tag.textContent = ambiente ? (producao ? 'Produção' : 'Homologação') : '—';
    }

    async function carregarLista() {
      mostrarMensagem('finAguardNfeMensagem', '');
      const minha = carregamento.comecar();
      let lido = null;
      let erro = null;
      try {
        lido = await fetchApi(`/api/fiscal/painel?competencia=${encodeURIComponent(competenciaSel.value || '')}`);
      } catch (e) {
        erro = e;
      }
      if (!carregamento.terminar(minha)) return;
      painel = erro ? null : lido;
      if (erro) mostrarMensagem('finAguardNfeMensagem', erro.status === 403 ? 'Você não tem permissão para ver as notas fiscais.' : erro.message);
      desenhar();
    }

    function desenhar() {
      const a = painel?.aguardando_nf || { quantidade: 0, total: 0, pedidos: [] };
      el('finAguardNfeQuantidade').textContent = painel ? String(a.quantidade || 0) : '—';
      el('finAguardNfeTotal').textContent = painel ? formatarMoeda(a.total || 0) : '—';
      el('finAguardNfeDesde').textContent = painel?.desde ? formatarData(painel.desde) : '—';
      pintarAmbiente(painel?.ambiente || null);
      const linhas = linhasAguardando(painel, { incluirDispensados: incluir.checked, busca: busca.value });
      corpo.replaceChildren();
      for (const l of linhas) corpo.appendChild(linhaAguardando(l));
      el('finAguardNfeVazio').classList.toggle('hidden', !painel || linhas.length > 0);
      tabela?.classList.toggle('hidden', linhas.length === 0);
    }

    function linhaAguardando(l) {
      const tr = document.createElement('tr');
      const celula = (conteudo, classe = 'px-4 py-3') => {
        const td = criar('td', classe);
        if (conteudo && typeof conteudo === 'object') td.appendChild(conteudo);
        else td.textContent = conteudo == null || conteudo === '' ? '—' : String(conteudo);
        return td;
      };
      const pedidoBtn = criar('button', 'fin-link-celula', String(l.numero));
      pedidoBtn.type = 'button';
      pedidoBtn.dataset.finPedidoId = String(l.pedido_id);

      const dias = celula(String(l.dias_sem_nfe), 'px-4 py-3 text-right');
      if (l.dias_sem_nfe > 30) dias.classList.add('fin-dias--critico');
      else if (l.dias_sem_nfe > 7) dias.classList.add('fin-dias--alto');

      let situacao;
      if (l.dispensada) {
        situacao = criar('span', 'badge-neutral px-3 py-1 rounded-full text-xs font-medium', 'S/NF');
        situacao.title = 'Marcado como enviado sem NF-e';
      } else if (l.ultima_nota) {
        const s = rotuloStatusNota(l.ultima_nota.status_fiscal);
        situacao = criar('span', `${s.badge} px-3 py-1 rounded-full text-xs font-medium`, `${l.ultima_nota.serie}/${l.ultima_nota.numero} ${s.rotulo.toLowerCase()}`);
        if (l.ultima_nota.motivo_sefaz) situacao.title = l.ultima_nota.motivo_sefaz;
      }

      const acoes = criar('div', 'flex flex-wrap gap-2');
      const emitir = criar('button', 'btn-success px-3 py-1 rounded-md text-xs font-medium', 'Emitir NF-e');
      emitir.type = 'button';
      emitir.dataset.perm = 'financeiro.nfe.emit';
      emitir.addEventListener('click', () => abrirEmissao(l));
      acoes.appendChild(emitir);
      if (!l.dispensada) {
        const semNf = criar('button', 'btn-neutral px-3 py-1 rounded-md text-xs font-medium text-white', 'Sem NF-e');
        semNf.type = 'button';
        semNf.dataset.perm = 'ped.status.ship';
        semNf.title = 'Marcar como enviado sem nota fiscal (S/NF)';
        acionar(semNf, () => marcarSemNfe(l));
        acoes.appendChild(semNf);
      }
      // A nota saiu por fora (contador, outro sistema): informa os dados e o
      // pedido sai desta lista. Os boletos de fora vão no mesmo modal.
      const deFora = criar('button', 'btn-neutral px-3 py-1 rounded-md text-xs font-medium text-white', 'NF-e de fora');
      deFora.type = 'button';
      deFora.dataset.perm = 'financeiro.nfe.emit';
      deFora.title = 'Informar a NF-e (e os boletos) emitidos fora do sistema';
      deFora.addEventListener('click', () => abrirDadosDeFora(l));
      acoes.appendChild(deFora);

      tr.append(
        celula(pedidoBtn), celula(l.cliente), celula(formatarData(l.enviado_em)), dias, celula(condicaoDoPedido(l)),
        celula(formatarMoeda(l.valor), 'px-4 py-3 text-right'), celula(situacao || '—'), celula(acoes)
      );
      return tr;
    }

    function abrirEmissao(l) {
      window.selectedOrderId = l.pedido_id;
      window.emitirNfeContext = { pedidoId: l.pedido_id, numero: String(l.numero), cliente: l.cliente || '' };
      abrirModalDePedido('modals/pedidos/emitir-nfe.html', '../js/modals/pedido-emitir-nfe.js', 'emitirNfePedido', { esperar: true, aoFechar: carregarLista });
    }

    function abrirDadosDeFora(l) {
      window.selectedOrderId = l.pedido_id;
      window.dadosExternosContext = { pedidoId: l.pedido_id, numero: String(l.numero), cliente: l.cliente || '', formaPagamento: l.forma_pagamento || '' };
      abrirModalDePedido('modals/pedidos/dados-externos.html', '../js/modals/pedido-dados-externos.js', 'dadosExternos', { esperar: true, aoFechar: carregarLista });
    }

    async function marcarSemNfe(l) {
      const ok = await (window.DialogPadrao?.confirm?.({
        title: 'Marcar como enviado sem NF-e?',
        message: `O pedido ${l.numero} sai da lista de "aguardando NF-e" e fica sinalizado como "sem nota" (S/NF). Use só quando a nota foi (ou será) emitida por fora.`,
        confirmText: 'Marcar sem NF-e'
      }) ?? Promise.resolve(true));
      if (!ok) return;
      try {
        await fetchApi(`/api/fiscal/pedidos/${encodeURIComponent(l.pedido_id)}/dispensar-nfe`, { method: 'POST', body: '{}' });
        window.showToast?.(`Pedido ${l.numero} marcado como enviado sem NF-e.`, 'success');
        await carregarLista();
      } catch (e) {
        mostrarMensagem('finAguardNfeMensagem', e.message);
      }
    }

    competenciaSel.addEventListener('change', carregarLista);
    busca.addEventListener('input', desenhar);
    incluir.addEventListener('change', desenhar);
    return carregarLista();
  }

  // ------------------------------------------------------ notas fiscais
  //
  // REAL: GET /api/fiscal/notas (todas, com a contagem de cartas), os pedidos
  // (número) e os clientes (nome). As ações reaproveitam o que o Visualizar
  // pedido já usa: NfeDocumentos (DANFE, XML) e os modais de cancelar,
  // e-mail e carta de correção, abertos por cima deste.

  function montarNotasFiscais() {
    const competenciaSel = el('finNotasCompetencia');
    const statusSel = el('finNotasStatus');
    const ambienteSel = el('finNotasAmbienteFiltro');
    const busca = el('finNotasBusca');
    const corpo = el('finNotasCorpo');
    const tabela = corpo.closest('.fin-tabela');
    // "Todas" é o mês vazio: a lista sai do filtro de competência.
    montarCompetencias(competenciaSel, contexto.competencia, { vazio: 'Todas' });
    // Uma pendência ("nota parada", "nota recusada") abre já filtrada, em todas as competências.
    if (contexto.filtro?.status) {
      statusSel.value = contexto.filtro.status;
      definirCompetencia(competenciaSel, '');
    }
    let notas = [];

    const carregamento = criarCarregamento({ tbody: corpo, colunas: 8, aviso: el('finNotasCarregando'), vazio: el('finNotasVazio') });

    async function carregarLista() {
      mostrarMensagem('finNotasMensagem', '');
      const minha = carregamento.comecar();
      let lidas = [];
      let erro = null;
      try {
        const [lista, pedidos, clientes] = await Promise.all([
          fetchApi('/api/fiscal/notas'),
          fetchApi('/api/pedidos').catch(() => []),
          fetchApi('/api/clientes/lista').catch(() => [])
        ]);
        const nomes = new Map((Array.isArray(clientes) ? clientes : []).map(c => [String(c.id), c.nome_fantasia || c.razao_social || c.nome || '']));
        const porId = new Map((Array.isArray(pedidos) ? pedidos : []).map(p => [String(p.id), p]));
        lidas = (Array.isArray(lista) ? lista : []).map(n => {
          const p = porId.get(String(n.pedido_id));
          return { ...n, pedido_numero: p?.numero ?? String(n.pedido_id ?? ''), cliente: nomes.get(String(p?.cliente_id)) || n.destinatario?.nome || '' };
        });
      } catch (e) {
        erro = e;
      }
      if (!carregamento.terminar(minha)) return;
      notas = erro ? [] : lidas;
      if (erro) mostrarMensagem('finNotasMensagem', erro.status === 403 ? 'Você não tem permissão para ver as notas fiscais.' : erro.message);
      desenhar();
    }

    /** De onde são as notas listadas: produção, homologação ou as duas (o filtro de ambiente separa). */
    function pintarAmbiente() {
      const tag = el('finNotasAmbiente');
      if (!tag) return;
      const temProducao = notas.some(n => n.ambiente === 'producao');
      const temHomologacao = notas.some(n => n.ambiente === 'homologacao');
      tag.className = `${temProducao ? 'badge-success' : (temHomologacao ? 'badge-warning' : 'badge-neutral')} px-3 py-1 rounded-full text-xs font-medium justify-self-end`;
      tag.textContent = temProducao && temHomologacao ? 'Produção e homologação' : (temProducao ? 'Produção' : (temHomologacao ? 'Homologação' : '—'));
    }

    function desenhar() {
      const filtros = { competencia: competenciaSel.value, status: statusSel.value, ambiente: ambienteSel.value, busca: busca.value };
      const r = resumoDeNotas(filtrarNotas(notas, { competencia: filtros.competencia, ambiente: filtros.ambiente }));
      el('finNotasEmitidas').textContent = String(r.emitidas);
      el('finNotasAutorizadas').textContent = String(r.autorizadas);
      el('finNotasCanceladas').textContent = String(r.canceladas);
      el('finNotasValor').textContent = formatarMoeda(r.valor);
      pintarAmbiente();
      const linhas = filtrarNotas(notas, filtros);
      corpo.replaceChildren();
      for (const n of linhas) corpo.appendChild(linhaNota(n));
      el('finNotasVazio').classList.toggle('hidden', linhas.length > 0);
      tabela?.classList.toggle('hidden', linhas.length === 0);
    }

    const contextoDaNota = n => ({ notaId: n.id, serie: n.serie, numero: n.numero, chave: n.chave_acesso, pedidoId: n.pedido_id, pedidoNumero: n.pedido_numero || '', email: n.destinatario?.email || '' });

    function linhaNota(n) {
      const tr = document.createElement('tr');
      const celula = (conteudo, classe = 'px-4 py-3') => {
        const td = criar('td', classe);
        if (conteudo && typeof conteudo === 'object') td.appendChild(conteudo);
        else td.textContent = conteudo == null || conteudo === '' ? '—' : String(conteudo);
        return td;
      };
      const s = rotuloStatusNota(n.status_fiscal);
      const situacao = criar('span', `${s.badge} px-3 py-1 rounded-full text-xs font-medium`, s.rotulo);
      if (n.motivo_sefaz) situacao.title = `${n.codigo_status_sefaz ? `${n.codigo_status_sefaz} — ` : ''}${n.motivo_sefaz}`;
      const ambiente = criar('span', `${n.ambiente === 'producao' ? 'badge-success' : 'badge-warning'} px-3 py-1 rounded-full text-xs font-medium`, n.ambiente === 'producao' ? 'Produção' : 'Homologação');
      const pedidoBtn = criar('button', 'fin-link-celula', String(n.pedido_numero || n.pedido_id || '—'));
      pedidoBtn.type = 'button';
      pedidoBtn.dataset.finPedidoId = String(n.pedido_id ?? '');

      const acoes = criar('div', 'flex flex-wrap gap-2');
      const botao = (texto, fn, { classe = 'btn-neutral text-white', perm = null, titulo = '' } = {}) => {
        const b = criar('button', `${classe} px-3 py-1 rounded-md text-xs font-medium`, texto);
        b.type = 'button';
        if (perm) b.dataset.perm = perm;
        if (titulo) b.title = titulo;
        acionar(b, fn);
        acoes.appendChild(b);
      };
      const documentos = ['autorizada', 'cancelada'].includes(n.status_fiscal) && n.tem_xml_autorizado;
      if (documentos) {
        botao('DANFE', () => window.NfeDocumentos?.gerarDanfe(n.id), { titulo: 'Gerar o DANFE em PDF' });
        botao('XML', () => window.NfeDocumentos?.salvarXml(n.id), { titulo: 'Salvar o XML da nota' });
        botao('E-mail', () => abrirDaNota(n, 'modals/pedidos/enviar-nfe-email.html', '../js/modals/pedido-enviar-nfe-email.js', 'enviarNfeEmail', 'emailNfeContext'), { perm: 'financeiro.nfe.emit', titulo: 'Enviar DANFE e XML por e-mail' });
      }
      if (n.status_fiscal === 'autorizada') {
        botao('Carta de correção', () => abrirDaNota(n, 'modals/pedidos/carta-correcao-nfe.html', '../js/modals/pedido-carta-correcao-nfe.js', 'cartaCorrecaoNfe', 'cartaCorrecaoContext'), { perm: 'financeiro.nfe.emit' });
        botao('Cancelar NF-e', () => abrirDaNota(n, 'modals/pedidos/cancelar-nfe.html', '../js/modals/pedido-cancelar-nfe.js', 'cancelarNfe', 'cancelarNfeContext'), { classe: 'btn-danger text-white', perm: 'financeiro.nfe.cancel' });
      }
      if (s.grupo === 'processando') {
        botao('Consultar na SEFAZ', () => consultar(n), { classe: 'btn-success', perm: 'financeiro.nfe.view' });
      }

      tr.append(
        celula(`${n.serie}/${n.numero}`, 'px-4 py-3 text-white font-medium'), celula(ambiente), celula(pedidoBtn), celula(n.cliente),
        celula(formatarData(n.data_emissao)), celula(formatarMoeda(n.valor_total), 'px-4 py-3 text-right'), celula(situacao),
        celula(n.cartas_correcao ? String(n.cartas_correcao) : '—', 'px-4 py-3 text-right'), celula(acoes)
      );
      return tr;
    }

    /** Cancelar, e-mail e carta: os modais dos Pedidos, com o contexto que eles esperam, por cima deste. */
    function abrirDaNota(n, htmlPath, scriptPath, id, nomeDoContexto) {
      window[nomeDoContexto] = contextoDaNota(n);
      abrirModalDePedido(htmlPath, scriptPath, id, { aoFechar: carregarLista });
    }

    async function consultar(n) {
      mostrarMensagem('finNotasMensagem', '');
      try {
        const r = await fetchApi(`/api/fiscal/notas/${encodeURIComponent(n.id)}/sincronizar`, { method: 'POST', body: '{}' });
        const texto = r.autorizada ? `NF-e ${n.serie}/${n.numero} autorizada.`
          : (r.naoConsta ? `A SEFAZ não recebeu a NF-e ${n.serie}/${n.numero}: o número será reaproveitado na próxima emissão.` : `SEFAZ ${r.sefaz?.cStat || ''}: ${r.sefaz?.xMotivo || 'ainda em processamento.'}`);
        mostrarMensagem('finNotasMensagem', texto, r.autorizada ? 'ok' : 'erro');
        window.showToast?.(texto, r.autorizada ? 'success' : 'info');
      } catch (e) {
        mostrarMensagem('finNotasMensagem', e.message);
      }
      await carregarLista();
    }

    [competenciaSel, statusSel, ambienteSel].forEach(campo => campo.addEventListener('change', desenhar));
    busca.addEventListener('input', desenhar);
    const atualizar = el('finNotasAtualizar');
    if (atualizar) acionar(atualizar, carregarLista);
    return carregarLista();
  }

  // ------------------------------------------- configuração de cobrança
  //
  // REAL: GET/PUT /api/cobranca/configuracao, o client_secret por
  // POST/DELETE /api/cobranca/credenciais e o teste POST /api/cobranca/testar.
  // Mesma anatomia da configuração fiscal.

  function montarConfiguracaoCobranca() {
    const campos = overlay.querySelectorAll('[data-fin-cob]');
    let podeEditar = false;
    let ambienteNoBanco = 'sandbox';
    let bancoChaveMestra = false;

    const texto = (id, valor) => { const e = el(id); if (e) e.textContent = valor ?? '—'; };
    const mensagem = (txt, tipo = 'erro') => mostrarMensagem('finCobMensagem', txt, tipo);
    const marcarTag = (id, classe, rotulo, extra = '') => {
      const e = el(id);
      if (!e) return;
      e.className = `${classe} px-3 py-1 rounded-full text-xs font-medium ${extra}`.trim();
      e.textContent = rotulo;
    };

    // Coluna que só existe depois do SQL da fase: sem ela o campo some e não vai no PUT.
    let colunasAusentes = new Set();
    function valoresDaTela() {
      const corpo = {};
      for (const campo of campos) {
        if (colunasAusentes.has(campo.dataset.finCob)) continue;
        corpo[campo.dataset.finCob] = campo.value;
      }
      return corpo;
    }

    function pintarPrevia() {
      const previa = el('finCobPrevia');
      if (previa) previa.textContent = previaDeEncargos(3327, valoresDaTela());
    }

    function pintarCredenciais(credenciais) {
      for (const ambiente of ['sandbox', 'producao']) {
        const c = credenciais?.[ambiente] || {};
        const onde = c.origem === 'banco' ? 'no banco (todas as máquinas)' : (c.origem === 'env' ? 'no .env (DEV)' : 'só neste computador');
        marcarTag(`finCobSecretTag_${ambiente}`, c.secret_guardado ? 'badge-success' : 'badge-danger', c.secret_guardado ? 'Secret guardado' : 'Sem secret');
        const partes = [];
        if (c.secret_guardado) partes.push(`Client secret guardado ${onde}${c.guardado_em ? ` em ${formatarData(String(c.guardado_em).slice(0, 10))}` : ''}.`);
        else partes.push('Sem client secret: o BB não dá o token sem ele.');
        if (c.erro) partes.push(c.erro);
        if (Array.isArray(c.pendencias) && c.pendencias.length) partes.push(`Falta: ${c.pendencias.join('; ')}.`);
        const estado = el(`finCobSecretEstado_${ambiente}`);
        if (estado) {
          estado.textContent = partes.join(' ');
          estado.style.color = c.secret_guardado && !c.pendencias?.length ? 'var(--color-green)' : '';
        }
      }
    }

    function pintarDestinos(temChave) {
      bancoChaveMestra = temChave;
      const radios = overlay.querySelectorAll('input[name="finCobSecretDestino"]');
      radios.forEach(r => { if (r.value === 'banco') r.disabled = !temChave; });
      const marcado = Array.from(radios).some(r => r.checked && !r.disabled);
      if (!marcado) radios.forEach(r => { r.checked = r.value === (temChave ? 'banco' : 'computador'); });
      el('finCobSecretDestinoAviso')?.classList.toggle('hidden', temChave);
    }
    const destinoEscolhido = () => overlay.querySelector('input[name="finCobSecretDestino"]:checked')?.value || (bancoChaveMestra ? 'banco' : 'computador');

    function alternarConfirmacao() {
      const escolhido = el('finCob_ambiente')?.value;
      el('finCobConfirmacaoProducao')?.classList.toggle('hidden', !(escolhido === 'producao' && ambienteNoBanco !== 'producao'));
    }

    function pintar(estado) {
      podeEditar = Boolean(estado?.pode_editar);
      ambienteNoBanco = estado?.ambiente_no_banco || 'sandbox';
      const cfg = estado?.configuracao || {};
      colunasAusentes = new Set(Array.from(campos)
        .filter(c => c.dataset.finCobColunaNova === 'true' && !Object.prototype.hasOwnProperty.call(cfg, c.dataset.finCob))
        .map(c => c.dataset.finCob));
      overlay.querySelectorAll('[data-fin-cob-bloco]').forEach(bloco => bloco.classList.toggle('hidden', colunasAusentes.has(bloco.dataset.finCobBloco)));
      for (const campo of campos) {
        const valor = cfg[campo.dataset.finCob];
        // DATE chega como '2026-09-16' ou '2026-09-16T00:00:00.000Z': o campo de data quer só o dia.
        campo.value = valor === null || valor === undefined ? '' : (campo.type === 'date' ? String(valor).slice(0, 10) : String(valor));
        campo.disabled = !podeEditar;
      }
      el('finCobSalvar')?.classList.toggle('hidden', !podeEditar);
      el('finCobSecretBloco')?.classList.toggle('hidden', !podeEditar);
      el('finCobRodapeAviso').textContent = podeEditar
        ? 'Alterações valem para todos os usuários.'
        : 'Só o Sup Admin altera a configuração. Você vê o que está valendo.';

      const producao = estado?.ambiente === 'producao';
      marcarTag('finCobAmbienteTag', producao ? 'badge-danger' : 'badge-warning', producao ? 'PRODUÇÃO' : 'Homologação (testes)', 'justify-self-end');
      el('finCobTravaMaquina')?.classList.toggle('hidden', !estado?.travado_em_sandbox_nesta_maquina);
      const teste = el('finCobTesteAmbiente');
      if (teste) teste.value = producao ? 'producao' : 'sandbox';
      const secretAmb = el('finCobSecretAmbiente');
      if (secretAmb) secretAmb.value = producao ? 'producao' : 'sandbox';

      const pend = el('finCobPendencias');
      const lista = estado?.credenciais?.[estado?.ambiente || 'sandbox']?.pendencias || [];
      if (pend) {
        pend.classList.toggle('hidden', !lista.length);
        pend.querySelector('span').textContent = `${producao ? 'Produção' : 'Homologação'}: ${lista.join(' • ')}`;
      }

      pintarCredenciais(estado?.credenciais);
      pintarDestinos(Boolean(estado?.banco_chave_mestra));
      texto('finCobNossoNumeroSandbox', estado?.nosso_numero?.sandbox || '—');
      texto('finCobNossoNumeroProducao', estado?.nosso_numero?.producao || '—');
      alternarConfirmacao();
      pintarPrevia();
    }

    // ------------------------------- webhook e conciliação automática (fase F)
    function pintarWebhook(w) {
      texto('finCobWebhookUrl', w?.url_modelo || '—');
      const a = w?.avisos || {};
      texto('finCobWebhookUltimo', a.ultimo_em || 'nenhum aviso recebido ainda');
      texto('finCobWebhookFila', `${Number(a.na_fila) || 0}${Number(a.com_erro) ? ` (${a.com_erro} com erro)` : ''}`);
      texto('finCobWebhookContagens', `${Number(a.conciliados) || 0} / ${Number(a.ignorados) || 0} / ${Number(a.alertas) || 0}`);
      const ag = w?.agenda || {};
      const u = ag.ultima_automatica;
      texto('finCobAgendaUltima', u ? `${u.quando}${u.maquina ? ` · ${u.maquina}` : ''}${u.erro ? ` · falhou: ${u.erro}` : (u.resumo ? ` · ${u.resumo}` : '')}` : 'ainda não rodou');
      texto('finCobAgendaProxima', ag.ligada === false ? 'desligada' : (ag.proxima_por_volta ? `${ag.proxima_por_volta} (com o app aberto em alguma máquina)` : '—'));
      el('finCobWebhookSemSql')?.classList.toggle('hidden', Boolean(ag.sql_pronto));

      const avisos = el('finCobWebhookAvisos');
      avisos.replaceChildren();
      for (const r of w?.recentes || []) {
        const tr = document.createElement('tr');
        const situacao = criar('span', `${BADGE_DO_AVISO[r.situacao] || 'badge-neutral'} px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap`, r.situacao);
        if (r.detalhe || r.mensagem) situacao.title = [r.mensagem, r.detalhe].filter(Boolean).join(' — ');
        const tdSit = criar('td', 'px-3 py-2');
        tdSit.appendChild(situacao);
        tr.append(criar('td', 'px-3 py-2 text-white whitespace-nowrap', r.quando || '—'), criar('td', 'px-3 py-2 break-all', r.nosso_numero || '—'), tdSit);
        avisos.appendChild(tr);
      }
      if (!(w?.recentes || []).length) {
        const tr = document.createElement('tr');
        const td = criar('td', 'px-3 py-3 text-gray-400', 'Nenhum aviso do BB chegou ainda.');
        td.colSpan = 3;
        tr.appendChild(td);
        avisos.appendChild(tr);
      }

      const execs = el('finCobExecucoes');
      execs.replaceChildren();
      for (const x of w?.execucoes || []) {
        const tr = document.createElement('tr');
        const resultado = x.erro ? `Falhou: ${x.erro}` : (x.terminou ? (x.resumo || '—') : 'não terminou');
        tr.append(criar('td', 'px-3 py-2 text-white whitespace-nowrap', x.quando || '—'), criar('td', 'px-3 py-2', `${x.como}${x.maquina ? ` · ${x.maquina}` : ''}`), criar('td', 'px-3 py-2', resultado));
        execs.appendChild(tr);
      }
      if (!(w?.execucoes || []).length) {
        const tr = document.createElement('tr');
        const td = criar('td', 'px-3 py-3 text-gray-400', ag.sql_pronto ? 'Nenhuma conciliação registrada ainda.' : 'O registro começa depois do SQL da fase F.');
        td.colSpan = 3;
        tr.appendChild(td);
        execs.appendChild(tr);
      }
    }

    async function carregarWebhook() {
      try {
        pintarWebhook(await fetchApi('/api/cobranca/webhook/estado'));
      } catch (e) {
        texto('finCobWebhookResultado', e.message);
      }
    }

    async function conciliarDaConfiguracao(soFila) {
      const saida = el('finCobWebhookResultado');
      saida.textContent = soFila ? 'Processando os avisos…' : 'Conciliando com o Banco do Brasil…';
      saida.style.color = '';
      try {
        const r = await fetchApi('/api/cobranca/conciliar', { method: 'POST', body: JSON.stringify(soFila ? { so_fila: true } : {}) });
        const t = textoDaConciliacao(r, soFila);
        saida.textContent = `${t.texto}${t.erros.length ? ` ${t.erros.slice(0, 3).join(' | ')}` : ''}`;
        saida.style.color = t.erros.length ? 'var(--color-red)' : 'var(--color-green)';
        window.FinanceiroRecarregar?.();
      } catch (e) {
        saida.textContent = e.status === 403 ? 'Você não tem permissão para conciliar.' : e.message;
        saida.style.color = 'var(--color-red)';
      }
      await carregarWebhook();
    }

    // ------------------------------------------------ parcela mínima
    // Grava por conta própria (PUT /api/cobranca/configuracao/parcela), com a
    // permissão "Alterar parcela mínima" — não é o Salvar do Sup Admin.
    const parcelaCampo = el('finCobParcelaMinima');
    const parcelaBotao = el('finCobParcelaSalvar');
    const avisoParcela = (txt, tipo = 'erro') => {
      const alvo = el('finCobParcelaMensagem');
      if (!alvo) return;
      alvo.textContent = txt || '';
      alvo.style.color = tipo === 'erro' ? 'var(--color-red)' : (tipo === 'ok' ? 'var(--color-green)' : '');
      alvo.classList.toggle('hidden', !txt);
    };
    const SQL_PARCELA = 'Falta rodar sql/desenhistas_producao_parcela.sql no banco e reiniciar a API para usar a parcela mínima.';

    async function carregarParcela() {
      if (!parcelaCampo) return;
      const podeParcela = pode('financeiro.parcela.editar');
      try {
        const r = await fetchApi('/api/cobranca/parcela-minima');
        parcelaCampo.value = r?.sql_pronto ? formatoMoeda.format(Number(r.parcela_minima) || 0) : '';
        parcelaCampo.disabled = !podeParcela || !r?.sql_pronto;
        parcelaBotao?.classList.toggle('hidden', !podeParcela);
        if (parcelaBotao) parcelaBotao.disabled = !r?.sql_pronto;
        avisoParcela(!r?.sql_pronto ? SQL_PARCELA : (podeParcela ? '' : 'Só quem tem a permissão "Alterar parcela mínima" muda este valor.'), r?.sql_pronto ? 'info' : 'erro');
      } catch (e) {
        parcelaCampo.disabled = true;
        parcelaBotao?.classList.add('hidden');
        avisoParcela(e.status === 403 ? 'Você não tem permissão para ver a parcela mínima.' : e.message);
      }
    }

    async function salvarParcela() {
      avisoParcela('');
      const valor = lerMoeda(parcelaCampo.value);
      if (valor === null || valor < 0) { avisoParcela('Informe a parcela mínima em reais.'); return; }
      try {
        const r = await fetchApi('/api/cobranca/configuracao/parcela', { method: 'PUT', body: JSON.stringify({ parcela_minima: valor }) });
        parcelaCampo.value = formatoMoeda.format(Number(r?.parcela_minima) || 0);
        avisoParcela('Parcela mínima salva: vale para as próximas divisões, abatimentos e devoluções.', 'ok');
        window.showToast?.('Parcela mínima salva.', 'success');
      } catch (e) {
        avisoParcela(e.status === 403 ? 'Você não tem a permissão "Alterar parcela mínima".' : (e?.corpo?.sql_pendente ? SQL_PARCELA : e.message));
      }
    }

    async function carregar() {
      try {
        pintar(await fetchApi('/api/cobranca/configuracao'));
        el('finCobConteudo').classList.remove('hidden');
        carregarWebhook();
        carregarParcela();
      } catch (e) {
        const erroEl = el('finCobErroGeral');
        erroEl.querySelector('span').textContent = e.message;
        erroEl.classList.remove('hidden');
      } finally {
        el('finCobCarregando').classList.add('hidden');
      }
    }

    async function salvar() {
      mensagem('');
      const corpo = valoresDaTela();
      const confirmacao = el('finCobConfirmacao')?.value || '';
      if (confirmacao) corpo.confirmacao = confirmacao;
      try {
        pintar(await fetchApi('/api/cobranca/configuracao', { method: 'PUT', body: JSON.stringify(corpo) }));
        if (el('finCobConfirmacao')) el('finCobConfirmacao').value = '';
        window.showToast?.('Configuração de cobrança salva.', 'success');
      } catch (e) {
        mensagem(e.message);
      }
    }

    async function guardarSecret() {
      mensagem('');
      const secret = el('finCobSecret').value;
      const ambiente = el('finCobSecretAmbiente').value;
      if (!secret) { mensagem('Informe o client secret.'); return; }
      try {
        const destino = destinoEscolhido();
        await fetchApi('/api/cobranca/credenciais', { method: 'POST', body: JSON.stringify({ ambiente, client_secret: secret, destino }) });
        el('finCobSecret').value = '';
        const nomeAmb = ambiente === 'producao' ? 'produção' : 'homologação';
        window.showToast?.(destino === 'banco' ? `Client secret de ${nomeAmb} guardado no banco, para todas as máquinas.` : `Client secret de ${nomeAmb} guardado neste computador.`, 'success');
        await carregar();
      } catch (e) {
        mensagem(e.message);
      }
    }

    async function removerSecret() {
      const ambiente = el('finCobSecretAmbiente').value;
      const ok = await (window.DialogPadrao?.confirm?.({
        title: `Remover o client secret de ${ambiente === 'producao' ? 'produção' : 'homologação'}?`,
        message: 'O secret sai do banco e deste computador. Os boletos desse ambiente param até guardá-lo de novo.',
        confirmText: 'Remover'
      }) ?? Promise.resolve(true));
      if (!ok) return;
      try {
        await fetchApi(`/api/cobranca/credenciais?ambiente=${encodeURIComponent(ambiente)}`, { method: 'DELETE' });
        await carregar();
      } catch (e) {
        mensagem(e.message);
      }
    }

    async function testar() {
      const resultado = el('finCobTesteResultado');
      const detalhe = el('finCobTesteDetalhe');
      resultado.textContent = 'Pedindo o token ao BB…';
      resultado.style.color = '';
      detalhe.classList.add('hidden');
      try {
        const r = await fetchApi('/api/cobranca/testar', { method: 'POST', body: JSON.stringify({ ambiente: el('finCobTesteAmbiente').value }) });
        const contaTestada = r.conta ? ` · agência ${r.conta.agencia} / conta ${r.conta.conta}${r.conta.teste ? ' (conta de teste do BB)' : ''}` : '';
        resultado.textContent = `Conectado ao BB (${r.ambiente === 'producao' ? 'produção' : 'homologação'})${contaTestada}.${r.observacao ? ` ${r.observacao}` : ''}`;
        resultado.style.color = 'var(--color-green)';
        texto('finCobTesteAmbienteTestado', `${r.ambiente === 'producao' ? 'Produção' : 'Homologação'}${r.hosts?.oauth ? ` · ${new URL(r.hosts.oauth).host}` : ''}`);
        texto('finCobTesteEscopos', (r.escopos || []).join(', ') || '—');
        texto('finCobTesteBoletos', r.boletosAbertos === null || r.boletosAbertos === undefined ? '—' : String(r.boletosAbertos));
        texto('finCobTesteOrigem', r.origem_secret === 'banco' ? 'banco' : (r.origem_secret === 'env' ? '.env (DEV)' : 'este computador'));
        texto('finCobTesteTempo', `${r.tempoMs} ms`);
        detalhe.classList.remove('hidden');
      } catch (e) {
        resultado.textContent = e.message;
        resultado.style.color = 'var(--color-red)';
      }
    }

    const ligar = (id, fn) => {
      const botao = el(id);
      if (!botao) return;
      botao.dataset.acaoGerida = 'true';
      botao.addEventListener('click', () => (window.BotaoAcao?.run ? window.BotaoAcao.run(botao, fn) : fn()));
    };
    ligar('finCobSalvar', salvar);
    ligar('finCobParcelaSalvar', salvarParcela);
    ligarCampoMoeda(parcelaCampo);
    ligar('finCobSecretGuardar', guardarSecret);
    ligar('finCobSecretRemover', removerSecret);
    ligar('finCobTestar', testar);
    // Trazer para o app os boletos que já existem no BB (emitidos antes, pelo
    // Gerenciador Financeiro). Abre POR CIMA: a configuração continua aberta.
    ligar('finCobImportar', () => {
      window.importarBoletosContext = {};
      // Com o spinner da casa: a tela só aparece depois de falar com o BB.
      if (typeof window.Modal.openWithSpinner === 'function') {
        window.Modal.openWithSpinner('modals/pedidos/importar-boletos.html', '../js/modals/pedido-importar-boletos.js', 'importarBoletos', { keepExisting: true });
        return;
      }
      window.Modal.open('modals/pedidos/importar-boletos.html', '../js/modals/pedido-importar-boletos.js', 'importarBoletos', true);
    });
    ligar('finCobWebhookAtualizar', carregarWebhook);
    ligar('finCobWebhookProcessar', () => conciliarDaConfiguracao(true));
    ligar('finCobWebhookConciliar', () => conciliarDaConfiguracao(false));
    el('finCob_ambiente')?.addEventListener('change', alternarConfirmacao);
    for (const chave of ['juros_tipo', 'juros_percentual_mes', 'multa_percentual', 'protesto_dias', 'dias_limite_recebimento']) {
      const campo = overlay.querySelector(`[data-fin-cob="${chave}"]`);
      campo?.addEventListener('input', pintarPrevia);
      campo?.addEventListener('change', pintarPrevia);
    }

    return carregar();
  }

  const montadores = {
    finConfiguracaoFiscal: montarConfiguracaoFiscal,
    finConfiguracaoCobranca: montarConfiguracaoCobranca,
    finAguardandoNfe: montarAguardandoNfe,
    finNotasFiscais: montarNotasFiscais,
    finRegistrarRecebimento: montarRecebimento,
    finRecebimentos: montarRecebimentos,
    finRegistrarAjuste: montarAjuste,
    finRegistrarProducao: montarProducao,
    finFecharCompetencia: montarFechamento,
    finFecharProducao: montarFecharProducao,
    finRelatorios: montarRelatorios,
    finDetalhesParcela: montarDetalhesParcela,
    finDetalhesPedido: montarDetalhesPedido,
    finConfirmarPagamento: montarConfirmarPagamento,
    finConfirmarReembolso: montarConfirmarReembolso,
    finVisualizarRelatorio: montarVisualizarRelatorio,
    finComissoesAtrasadas: montarComissoesAtrasadas,
    finProducaoCompetencia: montarProducaoCompetencia,
    finRegras: montarRegras,
    finRateioProducao: montarRateioProducao,
    finAtividade: montarAtividade
  };

  // Os montadores são assíncronos (leem o backend): o erro deles cai no mesmo lugar.
  let montagem;
  try {
    montagem = Promise.resolve(montadores[overlayId]?.());
  } catch (erro) {
    montagem = Promise.reject(erro);
  }

  // Revela só depois da PRIMEIRA leitura, como os modais dos outros módulos:
  // até lá fica o spinner da casa (financeiro.js, finSpinnerDoModal). Antes o
  // modal aparecia vazio e parecia travado enquanto o servidor respondia.
  const revelar = () => {
    overlay.classList.remove('hidden');
    overlay.removeAttribute('aria-hidden');
    window.Modal?.signalReady?.(overlayId);
  };
  montagem
    .catch(erro => console.error('[financeiro] falha ao montar o modal', overlayId, erro))
    .finally(() => {
      if (typeof window.FinanceiroModalPronto === 'function') window.FinanceiroModalPronto(overlayId, revelar);
      else revelar();
    });
})();
