/**
 * Modais do Financeiro — Comissões e Produção (etapa visual).
 *
 * Um script para os doze modais do módulo: a anatomia é a mesma — Voltar,
 * Cancelar/Fechar e Esc fecham; a ação principal fica no rodapé — e o que
 * muda de um para outro são as contas de conferência e as listas mostradas.
 * Quem abre diz qual é o modal por `window.financeiroModalContexto.overlayId`
 * (ver `finAbrirModal` em financeiro.js), e um modal abre outro por cima
 * (detalhes, relatório, fechamento) pelo mesmo caminho, com `empilhar`.
 *
 * Nada aqui grava: as ações principais abrem o aviso "em implementação", já
 * com a trava de clique duplo do BotaoAcao, para o comportamento não mudar
 * quando o backend entrar. As contas (parcelas da NF, impacto do ajuste,
 * saldo da produção, aging e totais dos relatórios) são reais e ficam em
 * funções puras, expostas em `window.FinanceiroModais` para os testes e para
 * o backend reaproveitar.
 *
 * Datas são texto 'YYYY-MM-DD' somadas por Date.UTC: passar pelo relógio local
 * volta um dia em São Paulo. Taxas de CMS e Royalty são as de exemplo da etapa.
 */
(() => {
  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const TAXA_CMS = 0.10;
  const TAXA_ROYALTY = 0.10;
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
  function montarCompetencias(select, selecionada) {
    if (!select) return;
    const hoje = new Date();
    const alvo = /^\d{4}-\d{2}$/.test(String(selecionada || '')) ? selecionada : competenciaAtual();
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

  /** Impacto de um ajuste numa parcela (valores em R$; ajustes anteriores negativos). */
  function impactoDoAjuste(original, anteriores, novo) {
    const liquido = centavos(Number(original || 0) + Number(anteriores || 0) - Number(novo || 0));
    return {
      original: Number(original || 0),
      anteriores: Number(anteriores || 0),
      novo: -Number(novo || 0),
      liquido,
      cms: centavos(liquido * TAXA_CMS),
      royalty: centavos(liquido * TAXA_ROYALTY)
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

  function faixaDeAtraso(dias) {
    const d = Number(dias) || 0;
    if (d <= 15) return '1–15';
    if (d <= 30) return '16–30';
    if (d <= 60) return '31–60';
    if (d <= 90) return '61–90';
    return '+90';
  }

  /** Enriquece as parcelas atrasadas com dias, faixa e comissão (CMS + Royalty). */
  function calcularAtrasadas(linhas, hoje) {
    return (linhas || []).map(l => {
      const dias = Math.max(0, diferencaDias(hoje, l.vencimento) ?? 0);
      const cms = centavos(l.liquido * TAXA_CMS);
      const royalty = centavos(l.liquido * TAXA_ROYALTY);
      return { ...l, dias, faixa: faixaDeAtraso(dias), cms, royalty, comissao: centavos(cms + royalty) };
    });
  }

  function resumoAtrasadas(linhas) {
    return linhas.reduce((r, l) => ({
      quantidade: r.quantidade + 1,
      liquido: centavos(r.liquido + l.liquido),
      comissao: centavos(r.comissao + l.comissao)
    }), { quantidade: 0, liquido: 0, comissao: 0 });
  }

  /** Aging sempre com as 5 faixas, mesmo vazias. */
  function agingDe(linhas) {
    return FAIXAS_ATRASO.map(faixa => {
      const da = linhas.filter(l => l.faixa === faixa);
      return {
        faixa,
        parcelas: da.length,
        liquido: centavos(da.reduce((s, l) => s + l.liquido, 0)),
        comissao: centavos(da.reduce((s, l) => s + l.comissao, 0))
      };
    });
  }

  function resumoProducao(linhas) {
    const soma = (setor) => centavos(linhas.filter(l => l.setor === setor).reduce((s, l) => s + l.total, 0));
    return {
      pecas: linhas.reduce((s, l) => s + l.quantidade, 0),
      pedidos: new Set(linhas.map(l => l.pedido)).size,
      pintura: soma('Pintura'),
      marcenaria: soma('Marcenaria'),
      total: centavos(linhas.reduce((s, l) => s + l.total, 0))
    };
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
      comissoes: { parcelas: 28, base: 92250, comissao: 18450, ajustes: -840, total: 17610 },
      producao: { pecas: 327, pintura: 4230, marcenaria: 5640, total: 9870 }
    },
    // 11 parcelas vencidas: líquido 36.600 -> comissão potencial 7.320 (20%).
    // As três com mais de 30 dias somam 21.400 -> 4.280, a pendência da tela.
    atrasadas: [
      { pedido: '2498', cliente: 'Marcenaria Serrana', nf: '18210', parcela: '2/3', vencimento: '2026-09-05', liquido: 2400 },
      { pedido: '2503', cliente: 'Casa Vicenzo', nf: '18240', parcela: '1/2', vencimento: '2026-09-08', liquido: 1600 },
      { pedido: '2490', cliente: 'Decorações Silvia', nf: '18190', parcela: '3/3', vencimento: '2026-08-28', liquido: 1900 },
      { pedido: '2487', cliente: 'Hotel Serra Verde', nf: '18170', parcela: '2/2', vencimento: '2026-08-22', liquido: 2100 },
      { pedido: '2511', cliente: 'Restaurante Oliva & Sal', nf: '18260', parcela: '1/3', vencimento: '2026-09-12', liquido: 1800 },
      { pedido: '2493', cliente: 'Pousada Mar Azul', nf: '18200', parcela: '2/2', vencimento: '2026-09-01', liquido: 1700 },
      { pedido: '2481', cliente: 'Café Grão Nobre', nf: '18150', parcela: '1/1', vencimento: '2026-08-18', liquido: 2000 },
      { pedido: '2506', cliente: 'Clínica Sorriso Pleno', nf: '18250', parcela: '1/2', vencimento: '2026-09-10', liquido: 1700 },
      { pedido: '2476', cliente: 'Cliente Exemplo LTDA', nf: '18120', parcela: '3/3', vencimento: '2026-08-05', liquido: 9000 },
      { pedido: '2469', cliente: 'Studio Ateliê Lúmen', nf: '18090', parcela: '2/2', vencimento: '2026-07-20', liquido: 7400 },
      { pedido: '2455', cliente: 'Móveis Aurora', nf: '18040', parcela: '1/1', vencimento: '2026-06-30', liquido: 5000 }
    ],
    // Produção da competência: 327 peças, pintura 4.230 + marcenaria 5.640 = 9.870.
    producaoCompetencia: [
      { pedido: '2548', cliente: 'Cliente Exemplo LTDA', codigo: 'CAD-04', produto: 'Cadeira estofada', setor: 'Marcenaria', quantidade: 100, unitario: 18, total: 1800, status: 'Finalizado', data: '2026-09-04' },
      { pedido: '2548', cliente: 'Cliente Exemplo LTDA', codigo: 'CAD-04', produto: 'Cadeira estofada', setor: 'Pintura', quantidade: 100, unitario: 12, total: 1200, status: 'Finalizado', data: '2026-09-09' },
      { pedido: '2521', cliente: 'Marcenaria Serrana', codigo: 'EST-02', produto: 'Estante 4 prateleiras', setor: 'Marcenaria', quantidade: 24, unitario: 60, total: 1440, status: 'Finalizado', data: '2026-09-05' },
      { pedido: '2521', cliente: 'Marcenaria Serrana', codigo: 'EST-02', produto: 'Estante 4 prateleiras', setor: 'Pintura', quantidade: 24, unitario: 35, total: 840, status: 'Finalizado', data: '2026-09-11' },
      { pedido: '2537', cliente: 'Casa Vicenzo', codigo: 'MES-120', produto: 'Mesa de jantar 1,20 m', setor: 'Marcenaria', quantidade: 6, unitario: 180, total: 1080, status: 'Parcial', data: '2026-09-08' },
      { pedido: '2537', cliente: 'Casa Vicenzo', codigo: 'MES-120', produto: 'Mesa de jantar 1,20 m', setor: 'Pintura', quantidade: 10, unitario: 57, total: 570, status: 'Parcial', data: '2026-09-12' },
      { pedido: '2540', cliente: 'Hotel Serra Verde', codigo: 'APA-02', produto: 'Aparador 2 portas', setor: 'Marcenaria', quantidade: 8, unitario: 165, total: 1320, status: 'Parcial', data: '2026-09-10' },
      { pedido: '2540', cliente: 'Hotel Serra Verde', codigo: 'APA-02', produto: 'Aparador 2 portas', setor: 'Pintura', quantidade: 8, unitario: 85, total: 680, status: 'Parcial', data: '2026-09-13' },
      { pedido: '2529', cliente: 'Pousada Mar Azul', codigo: 'BAN-01', produto: 'Banqueta alta', setor: 'Pintura', quantidade: 47, unitario: 20, total: 940, status: 'Finalizado', data: '2026-09-06' }
    ],
    // Previsão: líquido 162.500 -> comissão prevista 32.500.
    previsao: [
      { pedido: '2548', cliente: 'Cliente Exemplo LTDA', parcela: '1/3', vencimento: '2026-10-14', liquido: 21500 },
      { pedido: '2521', cliente: 'Marcenaria Serrana', parcela: '2/3', vencimento: '2026-10-24', liquido: 17560 },
      { pedido: '2521', cliente: 'Marcenaria Serrana', parcela: '3/3', vencimento: '2026-11-23', liquido: 17560 },
      { pedido: '2537', cliente: 'Casa Vicenzo', parcela: '1/1', vencimento: '2026-10-02', liquido: 17560 },
      { pedido: '2540', cliente: 'Hotel Serra Verde', parcela: '1/2', vencimento: '2026-10-10', liquido: 24000 },
      { pedido: '2540', cliente: 'Hotel Serra Verde', parcela: '2/2', vencimento: '2026-11-09', liquido: 24000 },
      { pedido: '2529', cliente: 'Pousada Mar Azul', parcela: '1/2', vencimento: '2026-10-05', liquido: 20160 },
      { pedido: '2529', cliente: 'Pousada Mar Azul', parcela: '2/2', vencimento: '2026-11-04', liquido: 20160 }
    ],
    // Apuradas no mês: base 92.250 -> comissão 18.450.
    apuradas: [
      { pedido: '2510', cliente: 'Café Grão Nobre', nf: '18255', parcela: '1/1', liquidacao: '2026-09-03', liquido: 21000 },
      { pedido: '2498', cliente: 'Marcenaria Serrana', nf: '18210', parcela: '1/3', liquidacao: '2026-09-05', liquido: 17750 },
      { pedido: '2488', cliente: 'Escritório Lima & Rocha', nf: '18175', parcela: '2/2', liquidacao: '2026-09-08', liquido: 14000 },
      { pedido: '2505', cliente: 'Clínica Sorriso Pleno', nf: '18245', parcela: '1/2', liquidacao: '2026-09-10', liquido: 15500 },
      { pedido: '2495', cliente: 'Loja Vila Madeira', nf: '18205', parcela: '1/1', liquidacao: '2026-09-12', liquido: 13000 },
      { pedido: '2515', cliente: 'Restaurante Oliva & Sal', nf: '18265', parcela: '1/2', liquidacao: '2026-09-14', liquido: 11000 }
    ],
    // Aguardando NF: 8 pedidos, 124.680.
    aguardandoNf: [
      { pedido: '2548', cliente: 'Cliente Exemplo LTDA', entrega: '2026-09-02', valor: 21500, condicao: '30 / 60 / 90' },
      { pedido: '2544', cliente: 'Arquiteta Júlia Mendes', entrega: '2026-09-04', valor: 9800, condicao: 'À vista' },
      { pedido: '2542', cliente: 'Studio Ateliê Lúmen', entrega: '2026-09-05', valor: 15320, condicao: '30 / 60' },
      { pedido: '2539', cliente: 'Hotel Serra Verde', entrega: '2026-09-08', valor: 24000, condicao: '30 / 60 / 90' },
      { pedido: '2536', cliente: 'Pousada Mar Azul', entrega: '2026-09-09', valor: 12400, condicao: '30 dias' },
      { pedido: '2533', cliente: 'Construtora Horizonte', entrega: '2026-09-10', valor: 18900, condicao: '30 / 60 / 90' },
      { pedido: '2531', cliente: 'Clínica Sorriso Pleno', entrega: '2026-09-11', valor: 11760, condicao: 'À vista' },
      { pedido: '2528', cliente: 'Loja Vila Madeira', entrega: '2026-09-12', valor: 11000, condicao: '30 / 60' }
    ],
    ajustesAnteriores: [
      { data: '2026-09-10', pedido: '2501', cliente: 'Decorações Silvia', tipo: 'Devolução', motivo: 'Peça devolvida com avaria', valor: -840, origem: 'Agosto/2026' },
      { data: '2026-08-22', pedido: '2476', cliente: 'Cliente Exemplo LTDA', tipo: 'Desconto comercial', motivo: 'Negociação de atraso na entrega', valor: -350, origem: 'Julho/2026' },
      { data: '2026-08-15', pedido: '2469', cliente: 'Studio Ateliê Lúmen', tipo: 'Abatimento', motivo: 'Diferença de acabamento', valor: -220, origem: 'Julho/2026' }
    ],
    naoRealizadas: [
      { pedido: '2462', cliente: 'Construtora Horizonte', nf: '18060', parcela: '2/2', motivo: 'Cancelamento parcial', liquido: 6500 },
      { pedido: '2449', cliente: 'Loja Vila Madeira', nf: '18010', parcela: '1/1', motivo: 'Pedido cancelado', liquido: 4200 }
    ],
    detalhesPedido: {
      '2548': { cliente: 'Cliente Exemplo LTDA', data: '2026-09-02', valor: 21500, condicao: '30 / 60 / 90', status: 'Entregue',
        observacoes: 'Entrega feita em duas etapas; cliente pediu NF única.',
        itens: [
          { codigo: 'CAD-04', descricao: 'Cadeira estofada', quantidade: 100, produzida: 100 },
          { codigo: 'MES-160', descricao: 'Mesa de jantar 1,60 m', quantidade: 2, produzida: 2 }
        ],
        notas: [{ nf: '18842', data: '2026-09-15', valor: 21500, parcelas: 3, status: 'Aberta' }] },
      '2521': { cliente: 'Marcenaria Serrana', data: '2026-08-20', valor: 52680, condicao: '30 / 60 / 90', status: 'Entregue',
        observacoes: '—',
        itens: [
          { codigo: 'EST-02', descricao: 'Estante 4 prateleiras', quantidade: 24, produzida: 24 },
          { codigo: 'RAC-01', descricao: 'Rack para TV', quantidade: 12, produzida: 12 }
        ],
        notas: [{ nf: '18790', data: '2026-08-25', valor: 52680, parcelas: 3, status: 'Parcial' }] },
      '2537': { cliente: 'Casa Vicenzo', data: '2026-09-01', valor: 17560, condicao: 'À vista', status: 'Produção',
        observacoes: 'Pintura em tom especial (ver amostra aprovada).',
        itens: [
          { codigo: 'MES-120', descricao: 'Mesa de jantar 1,20 m', quantidade: 10, produzida: 6 },
          { codigo: 'CAD-04', descricao: 'Cadeira estofada', quantidade: 40, produzida: 40 },
          { codigo: 'APA-02', descricao: 'Aparador 2 portas', quantidade: 4, produzida: 0 }
        ],
        notas: [] },
      '2501': { cliente: 'Decorações Silvia', data: '2026-08-10', valor: 60000, condicao: '30 / 60 / 90', status: 'Entregue',
        observacoes: 'Devolução de uma peça registrada em 10/09.',
        itens: [{ codigo: 'SOF-03', descricao: 'Sofá 3 lugares', quantidade: 6, produzida: 6 }],
        notas: [{ nf: '18345', data: '2026-08-25', valor: 60000, parcelas: 3, status: 'Parcial' }] }
    },
    parcelaPadrao: {
      pedido: '2501', cliente: 'Decorações Silvia', nf: '18345', parcela: '1/3', status: 'Liquidada',
      original: 20000, devolucoes: 2000, descontos: 1000, vencimento: '2026-09-24', liquidacao: '2026-09-20'
    }
  };

  /** Relatórios disponíveis para "Visualizar": colunas, linhas e totais. */
  const RELATORIOS = {
    'previsao-comissoes': {
      titulo: 'Previsão de comissões',
      colunas: [
        { chave: 'pedido', rotulo: 'Pedido', tipo: 'pedido' },
        { chave: 'cliente', rotulo: 'Cliente' },
        { chave: 'parcela', rotulo: 'Parcela' },
        { chave: 'vencimento', rotulo: 'Vencimento', tipo: 'data' },
        { chave: 'liquido', rotulo: 'Valor líquido', tipo: 'moeda', total: true },
        { chave: 'comissao', rotulo: 'Comissão prevista', tipo: 'moeda', total: true }
      ],
      linhas: () => EXEMPLO.previsao.map(l => ({ ...l, comissao: centavos(l.liquido * (TAXA_CMS + TAXA_ROYALTY)) }))
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
        { chave: 'comissao', rotulo: 'Comissão potencial', tipo: 'moeda', total: true }
      ],
      linhas: () => calcularAtrasadas(EXEMPLO.atrasadas, hojeLocal())
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
        { chave: 'comissao', rotulo: 'Total comissão', tipo: 'moeda', total: true }
      ],
      linhas: () => EXEMPLO.apuradas.map(l => {
        const cms = centavos(l.liquido * TAXA_CMS);
        const royalty = centavos(l.liquido * TAXA_ROYALTY);
        return { ...l, cms, royalty, comissao: centavos(cms + royalty) };
      })
    },
    'ajustes-anteriores': {
      titulo: 'Ajustes de períodos anteriores',
      colunas: [
        { chave: 'data', rotulo: 'Data', tipo: 'data' },
        { chave: 'pedido', rotulo: 'Pedido', tipo: 'pedido' },
        { chave: 'cliente', rotulo: 'Cliente' },
        { chave: 'tipo', rotulo: 'Tipo' },
        { chave: 'motivo', rotulo: 'Motivo' },
        { chave: 'origem', rotulo: 'Competência de origem' },
        { chave: 'valor', rotulo: 'Valor', tipo: 'moeda', total: true }
      ],
      linhas: () => EXEMPLO.ajustesAnteriores
    },
    'comissoes-nao-realizadas': {
      titulo: 'Comissões não realizadas',
      colunas: [
        { chave: 'pedido', rotulo: 'Pedido', tipo: 'pedido' },
        { chave: 'cliente', rotulo: 'Cliente' },
        { chave: 'nf', rotulo: 'NF' },
        { chave: 'parcela', rotulo: 'Parcela' },
        { chave: 'motivo', rotulo: 'Motivo' },
        { chave: 'liquido', rotulo: 'Valor líquido', tipo: 'moeda', total: true },
        { chave: 'comissao', rotulo: 'Comissão não realizada', tipo: 'moeda', total: true }
      ],
      linhas: () => EXEMPLO.naoRealizadas.map(l => ({ ...l, comissao: centavos(l.liquido * (TAXA_CMS + TAXA_ROYALTY)) }))
    },
    'producao-competencia': {
      titulo: 'Produção da competência',
      colunas: [
        { chave: 'pedido', rotulo: 'Pedido', tipo: 'pedido' },
        { chave: 'produto', rotulo: 'Produto' },
        { chave: 'setor', rotulo: 'Setor' },
        { chave: 'quantidade', rotulo: 'Quantidade', tipo: 'inteiro', total: true },
        { chave: 'unitario', rotulo: 'Valor unitário', tipo: 'moeda' },
        { chave: 'total', rotulo: 'Total', tipo: 'moeda', total: true },
        { chave: 'status', rotulo: 'Status' }
      ],
      linhas: () => EXEMPLO.producaoCompetencia
    },
    'pagamento-pintura': {
      titulo: 'Pagamento pintura',
      colunas: [
        { chave: 'pedido', rotulo: 'Pedido', tipo: 'pedido' },
        { chave: 'produto', rotulo: 'Produto' },
        { chave: 'data', rotulo: 'Finalização', tipo: 'data' },
        { chave: 'quantidade', rotulo: 'Quantidade', tipo: 'inteiro', total: true },
        { chave: 'unitario', rotulo: 'Valor unitário', tipo: 'moeda' },
        { chave: 'total', rotulo: 'Total', tipo: 'moeda', total: true }
      ],
      linhas: () => EXEMPLO.producaoCompetencia.filter(l => l.setor === 'Pintura')
    },
    'pagamento-marcenaria': {
      titulo: 'Pagamento marcenaria',
      colunas: [
        { chave: 'pedido', rotulo: 'Pedido', tipo: 'pedido' },
        { chave: 'produto', rotulo: 'Produto' },
        { chave: 'data', rotulo: 'Finalização', tipo: 'data' },
        { chave: 'quantidade', rotulo: 'Quantidade', tipo: 'inteiro', total: true },
        { chave: 'unitario', rotulo: 'Valor unitário', tipo: 'moeda' },
        { chave: 'total', rotulo: 'Total', tipo: 'moeda', total: true }
      ],
      linhas: () => EXEMPLO.producaoCompetencia.filter(l => l.setor === 'Marcenaria')
    },
    'producao-por-pedido': {
      titulo: 'Produção por pedido',
      colunas: [
        { chave: 'pedido', rotulo: 'Pedido', tipo: 'pedido' },
        { chave: 'cliente', rotulo: 'Cliente' },
        { chave: 'pecas', rotulo: 'Peças', tipo: 'inteiro', total: true },
        { chave: 'pintura', rotulo: 'Pintura', tipo: 'moeda', total: true },
        { chave: 'marcenaria', rotulo: 'Marcenaria', tipo: 'moeda', total: true },
        { chave: 'total', rotulo: 'Total', tipo: 'moeda', total: true }
      ],
      linhas: () => {
        const porPedido = new Map();
        for (const l of EXEMPLO.producaoCompetencia) {
          const g = porPedido.get(l.pedido) || { pedido: l.pedido, cliente: l.cliente, pecas: 0, pintura: 0, marcenaria: 0, total: 0 };
          g.pecas += l.quantidade;
          g[l.setor === 'Pintura' ? 'pintura' : 'marcenaria'] = centavos(g[l.setor === 'Pintura' ? 'pintura' : 'marcenaria'] + l.total);
          g.total = centavos(g.total + l.total);
          porPedido.set(l.pedido, g);
        }
        return [...porPedido.values()];
      }
    },
    'aguardando-nf': {
      titulo: 'Pedidos aguardando NF',
      colunas: [
        { chave: 'pedido', rotulo: 'Pedido', tipo: 'pedido' },
        { chave: 'cliente', rotulo: 'Cliente' },
        { chave: 'entrega', rotulo: 'Entrega', tipo: 'data' },
        { chave: 'condicao', rotulo: 'Condição' },
        { chave: 'dias', rotulo: 'Dias sem NF', tipo: 'inteiro' },
        { chave: 'valor', rotulo: 'Valor', tipo: 'moeda', total: true }
      ],
      linhas: () => EXEMPLO.aguardandoNf.map(l => ({ ...l, dias: Math.max(0, diferencaDias(hojeLocal(), l.entrega) ?? 0) }))
    }
  };

  /** Monta o relatório pronto para a tela: linhas e a linha de totais. */
  function montarRelatorio(chave) {
    const def = RELATORIOS[chave];
    if (!def) return null;
    const linhas = def.linhas();
    const totais = {};
    for (const c of def.colunas) {
      if (c.total) totais[c.chave] = c.tipo === 'inteiro'
        ? linhas.reduce((s, l) => s + Number(l[c.chave] || 0), 0)
        : centavos(linhas.reduce((s, l) => s + Number(l[c.chave] || 0), 0));
    }
    return { chave, titulo: def.titulo, colunas: def.colunas, linhas, totais };
  }

  window.FinanceiroModais = {
    formatarMoeda, lerMoeda, formatarData, somarDias, diferencaDias, competenciaDe, rotuloCompetencia,
    rotuloCompetenciaCurto, calcularParcelas, lerPrazos, impactoDoAjuste, statusAposRegistro,
    faixaDeAtraso, calcularAtrasadas, resumoAtrasadas, agingDe, resumoProducao, montarRelatorio,
    RELATORIOS: Object.keys(RELATORIOS), EXEMPLO, TAXA_CMS, TAXA_ROYALTY, FAIXAS_ATRASO
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
  // Modais empilhados: o Esc só fecha o de cima, senão fecharia a pilha inteira.
  const ehOModalDeCima = () => {
    const abertos = [...document.querySelectorAll('[data-fin-modal]')].filter(o => !o.classList.contains('hidden'));
    return abertos[abertos.length - 1] === overlay;
  };
  const aoEsc = e => {
    if (e.key !== 'Escape' || !ehOModalDeCima()) return;
    e.preventDefault();
    fechar();
  };
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

  /** Abre outro modal do módulo por cima deste (o módulo é quem sabe abrir). */
  const dadosDaLinha = new WeakMap();
  function abrirOutro(chave, extra = {}) {
    if (typeof window.FinanceiroAbrirModal === 'function') {
      window.FinanceiroAbrirModal(chave, null, { ...extra, empilhar: true, competencia: contexto.competencia });
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
    Produção: 'badge-warning', Fechada: 'badge-neutral', Cancelado: 'badge-danger'
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
      const botao = criar('button', 'fin-link-celula', String(bruto ?? '—'));
      botao.type = 'button';
      botao.dataset.finAbrir = 'detalhes-pedido';
      botao.dataset.finPedido = String(bruto ?? '');
      td.appendChild(botao);
      return td;
    }
    if (coluna.tipo === 'badge') { td.appendChild(badge(String(bruto ?? '—'))); return td; }
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
      if (abrir) {
        tr.dataset.finAbrir = abrir;
        tr.tabIndex = 0;
        dadosDaLinha.set(tr, l);
      }
      for (const c of colunas) tr.appendChild(celulaDe(l, c));
      tbody.appendChild(tr);
    }
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
        linha.append(
          criar('td', 'px-4 py-3 text-white', `${p.numero}/${p.total}`),
          criar('td', 'px-4 py-3 text-right text-gray-300', p.prazo === 0 ? 'à vista' : `${p.prazo} dias`),
          criar('td', 'px-4 py-3 text-white', formatarData(p.vencimento)),
          criar('td', 'px-4 py-3 text-right text-white', formatarMoeda(p.valor))
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

    const radios = overlay.querySelectorAll('input[name="finFechamentoTipo"]');
    if (contexto.tipo) radios.forEach(r => { r.checked = r.value === contexto.tipo; });
    const alternar = () => {
      const tipo = overlay.querySelector('input[name="finFechamentoTipo"]:checked')?.value || 'comissoes';
      el('finFechamentoResumoComissoes').classList.toggle('hidden', tipo !== 'comissoes');
      el('finFechamentoResumoProducao').classList.toggle('hidden', tipo !== 'producao');
    };
    radios.forEach(r => r.addEventListener('change', alternar));
    alternar();
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

    // "Visualizar" abre a folha de conferência de verdade; PDF e Excel ainda
    // são o aviso do botão principal.
    const gerar = overlay.querySelector('[data-fin-principal]');
    gerar.addEventListener('click', evento => {
      const formato = overlay.querySelector('input[name="finRelFormato"]:checked')?.value;
      if (formato !== 'visualizar') return;
      evento.stopImmediatePropagation();
      const relatorio = overlay.querySelector('input[name="finRelatorio"]:checked')?.value;
      const competencia = filtro.value === 'competencia' ? el('finRelCompetencia').value : null;
      const periodo = filtro.value === 'periodo' ? { inicio: el('finRelPeriodoInicio').value, fim: el('finRelPeriodoFim').value } : null;
      abrirOutro('visualizar-relatorio', { relatorio, competencia, periodo });
    }, true);
  }

  function montarDetalhesParcela() {
    const p = contexto.parcela || EXEMPLO.parcelaPadrao;
    const original = Number(p.original ?? p.liquido ?? 0);
    const devolucoes = Number(p.devolucoes || 0);
    const descontos = Number(p.descontos || 0);
    const liquido = centavos(original - devolucoes - descontos);
    const cms = centavos(liquido * TAXA_CMS);
    const royalty = centavos(liquido * TAXA_ROYALTY);
    const status = p.status || (p.liquidacao ? 'Liquidada' : (diferencaDias(hojeLocal(), p.vencimento) > 0 ? 'Atrasada' : 'Aberta'));

    el('finParcelaContexto').textContent = `Pedido ${p.pedido} • NF ${p.nf} • Parcela ${p.parcela}`;
    aplicarBadge(el('finParcelaStatus'), status);
    montarDl(el('finParcelaResumo'), [
      ['Valor original', formatarMoeda(original)],
      ['(-) Devoluções', formatarMoeda(devolucoes)],
      ['(-) Descontos', formatarMoeda(descontos)],
      ['Valor líquido', formatarMoeda(liquido), true],
      ['Vencimento', formatarData(p.vencimento)],
      ['Liquidação', p.liquidacao ? formatarData(p.liquidacao) : 'Não liquidada'],
      ['CMS', formatarMoeda(cms)],
      ['Royalty', formatarMoeda(royalty)],
      ['Total comissão', formatarMoeda(cms + royalty), true]
    ]);

    const ajustes = [];
    if (devolucoes) ajustes.push({ data: '2026-09-10', tipo: 'Devolução', motivo: 'Peça devolvida com avaria', valor: -devolucoes, usuario: 'Ana Paula' });
    if (descontos) ajustes.push({ data: '2026-09-12', tipo: 'Desconto comercial', motivo: 'Negociação com o cliente', valor: -descontos, usuario: 'Marcos' });
    montarLinhas(el('finParcelaAjustes'), ajustes, [
      { chave: 'data', tipo: 'data' }, { chave: 'tipo' }, { chave: 'motivo' },
      { chave: 'valor', tipo: 'moeda' }, { chave: 'usuario' }
    ]);
    if (!ajustes.length) {
      const tr = document.createElement('tr');
      const td = criar('td', 'px-4 py-6 text-center text-sm text-gray-400', 'Nenhum ajuste nesta parcela.');
      td.colSpan = 5;
      tr.appendChild(td);
      el('finParcelaAjustes').appendChild(tr);
    }

    const emissao = somarDias(p.vencimento, -30);
    const historico = [
      { quando: formatarDataCurta(emissao), titulo: `NF ${p.nf} emitida`, detalhe: formatarMoeda(original * 3) },
      { quando: formatarDataCurta(emissao), titulo: `Parcela ${p.parcela} gerada`, detalhe: `Vencimento ${formatarData(p.vencimento)}` }
    ];
    for (const a of ajustes) historico.push({ quando: formatarDataCurta(a.data), titulo: `${a.tipo} lançada`, detalhe: `${formatarMoeda(a.valor)} • ${a.usuario}` });
    if (p.liquidacao) {
      historico.push({ quando: formatarDataCurta(p.liquidacao), titulo: 'Liquidação registrada', detalhe: formatarMoeda(liquido) });
      historico.push({ quando: formatarDataCurta(p.liquidacao), titulo: 'Comissão apurada', detalhe: `${formatarMoeda(cms + royalty)} • ${competenciaDe(p.liquidacao)}` });
      historico.push({ quando: '15/10', titulo: 'Pagamento programado', detalhe: 'Competência de setembro' });
    } else {
      historico.push({ quando: formatarDataCurta(hojeLocal()), titulo: 'Aguardando recebimento', detalhe: `${Math.max(0, diferencaDias(hojeLocal(), p.vencimento) ?? 0)} dias em atraso` });
    }
    montarLinhaDoTempo(el('finParcelaHistorico'), historico);
    ligarAbas();
  }

  function montarDetalhesPedido() {
    const numero = String(contexto.pedido || '2548');
    const base = EXEMPLO.detalhesPedido[numero];
    const linhasProducao = EXEMPLO.producaoCompetencia.filter(l => l.pedido === numero);
    const atrasadas = calcularAtrasadas(EXEMPLO.atrasadas.filter(l => l.pedido === numero), hojeLocal());
    const cliente = base?.cliente || linhasProducao[0]?.cliente || atrasadas[0]?.cliente
      || EXEMPLO.previsao.find(l => l.pedido === numero)?.cliente || EXEMPLO.aguardandoNf.find(l => l.pedido === numero)?.cliente || '—';
    const dados = base || {
      cliente, data: null, valor: EXEMPLO.aguardandoNf.find(l => l.pedido === numero)?.valor ?? null,
      condicao: EXEMPLO.aguardandoNf.find(l => l.pedido === numero)?.condicao || '—',
      status: linhasProducao.some(l => l.status === 'Parcial') ? 'Produção' : 'Entregue', observacoes: '—',
      itens: [...new Map(linhasProducao.map(l => [l.codigo, { codigo: l.codigo, descricao: l.produto, quantidade: l.quantidade, produzida: l.quantidade }])).values()],
      notas: atrasadas.map(a => ({ nf: a.nf, data: somarDias(a.vencimento, -30), valor: a.liquido, parcelas: Number(a.parcela.split('/')[1]) || 1, status: 'Atrasada' }))
    };

    el('finPedidoTitulo').replaceChildren(Object.assign(document.createElement('i'), { className: 'fas fa-box mr-2' }), document.createTextNode(`Pedido ${numero}`));
    el('finPedidoCliente').textContent = dados.cliente;
    aplicarBadge(el('finPedidoStatus'), dados.status);
    el('finPedidoData').textContent = dados.data ? formatarData(dados.data) : '—';
    el('finPedidoValor').textContent = formatarMoeda(dados.valor);
    el('finPedidoCondicao').textContent = dados.condicao || '—';
    el('finPedidoStatusTexto').textContent = dados.status;
    el('finPedidoObservacoes').textContent = dados.observacoes || '—';

    montarLinhas(el('finPedidoItens'), dados.itens.map(i => ({
      ...i, saldo: i.quantidade - i.produzida,
      situacao: i.produzida >= i.quantidade ? 'Finalizado' : (i.produzida > 0 ? 'Parcial' : 'Aberta')
    })), [
      { chave: 'codigo' }, { chave: 'descricao' }, { chave: 'quantidade', tipo: 'inteiro' },
      { chave: 'produzida', tipo: 'inteiro' }, { chave: 'saldo', tipo: 'inteiro' }, { chave: 'situacao', tipo: 'badge' }
    ]);

    montarLinhas(el('finPedidoNotas'), dados.notas, [
      { chave: 'nf' }, { chave: 'data', tipo: 'data' }, { chave: 'valor', tipo: 'moeda' },
      { chave: 'parcelas', tipo: 'inteiro' }, { chave: 'status', tipo: 'badge' }
    ]);
    if (!dados.notas.length) {
      const tr = document.createElement('tr');
      const td = criar('td', 'px-4 py-6 text-center text-sm text-gray-400', 'Nenhuma NF registrada para este pedido.');
      td.colSpan = 5;
      tr.appendChild(td);
      el('finPedidoNotas').appendChild(tr);
    }

    montarLinhaDoTempo(el('finPedidoProducao'), linhasProducao
      .slice().sort((a, b) => String(a.data).localeCompare(String(b.data)))
      .map(l => ({ quando: formatarDataCurta(l.data), titulo: `${l.quantidade} × ${l.produto} finalizadas`, detalhe: `${l.setor} • ${formatarMoeda(l.total)}` })));

    const previsto = centavos(Number(dados.valor || 0) * (TAXA_CMS + TAXA_ROYALTY));
    const realizado = centavos(EXEMPLO.apuradas.filter(l => l.pedido === numero).reduce((s, l) => s + l.liquido * (TAXA_CMS + TAXA_ROYALTY), 0));
    const atrasado = resumoAtrasadas(atrasadas).comissao;
    const ajustes = centavos(EXEMPLO.ajustesAnteriores.filter(l => l.pedido === numero).reduce((s, l) => s + l.valor, 0) * (TAXA_CMS + TAXA_ROYALTY));
    montarDl(el('finPedidoComissoes'), [
      ['Comissão prevista', formatarMoeda(previsto)],
      ['Realizada', formatarMoeda(realizado)],
      ['Atrasada', formatarMoeda(atrasado)],
      ['Ajustes', formatarMoeda(ajustes)],
      ['Saldo previsto', formatarMoeda(centavos(previsto - realizado + ajustes)), true]
    ]);
    ligarAbas();
  }

  function montarConfirmarPagamento() {
    montarCompetencias(el('finPagamentoCompetencia'), contexto.competencia);
    const radios = overlay.querySelectorAll('input[name="finPagamentoTipo"]');
    if (contexto.tipo) radios.forEach(r => { r.checked = r.value === contexto.tipo; });
    const atualizar = () => {
      const tipo = overlay.querySelector('input[name="finPagamentoTipo"]:checked')?.value || 'comissao';
      el('finPagamentoValor').value = formatarMoeda(tipo === 'producao' ? EXEMPLO.fechamento.producao.total : EXEMPLO.fechamento.comissoes.total);
    };
    radios.forEach(r => r.addEventListener('change', atualizar));
    atualizar();
  }

  function montarVisualizarRelatorio() {
    const relatorio = montarRelatorio(contexto.relatorio) || montarRelatorio('comissoes-apuradas');
    const competencia = contexto.competencia || competenciaAtual();
    const filtro = contexto.periodo?.inicio
      ? `Período: ${formatarData(contexto.periodo.inicio)} a ${formatarData(contexto.periodo.fim)}`
      : `Competência: ${rotuloCompetenciaCurto(competencia)}`;

    el('finRelatorioTitulo').replaceChildren(Object.assign(document.createElement('i'), { className: 'fas fa-chart-line mr-2' }),
      document.createTextNode(`${relatorio.titulo} — ${rotuloCompetenciaCurto(competencia)}`));
    el('finRelatorioSubtitulo').textContent = 'Conferência antes da exportação';
    el('finRelatorioGeradoEm').textContent = `Gerado em ${formatarData(hojeLocal())}`;
    el('finRelatorioNome').textContent = relatorio.titulo;
    el('finRelatorioFiltro').textContent = filtro;

    const cabecalho = el('finRelatorioCabecalho');
    cabecalho.replaceChildren();
    for (const c of relatorio.colunas) {
      cabecalho.appendChild(criar('th', `px-4 py-3 text-xs ${['moeda', 'inteiro'].includes(c.tipo) ? 'text-right' : 'text-left'}`, c.rotulo));
    }
    montarLinhas(el('finRelatorioCorpo'), relatorio.linhas, relatorio.colunas.map(c => c.chave === 'dias' ? { ...c, enfase: true } : c));

    const totais = el('finRelatorioTotais');
    totais.replaceChildren();
    relatorio.colunas.forEach((c, i) => {
      const td = criar('td', `px-4 py-3 ${['moeda', 'inteiro'].includes(c.tipo) ? 'text-right' : 'text-left'}`);
      if (i === 0) td.textContent = `Total (${relatorio.linhas.length} ${relatorio.linhas.length === 1 ? 'registro' : 'registros'})`;
      else if (c.total) td.textContent = c.tipo === 'inteiro' ? String(relatorio.totais[c.chave]) : formatarMoeda(relatorio.totais[c.chave]);
      totais.appendChild(td);
    });
    el('finRelatorioVazio').classList.toggle('hidden', relatorio.linhas.length > 0);
  }

  function montarComissoesAtrasadas() {
    const todas = calcularAtrasadas(EXEMPLO.atrasadas, hojeLocal());
    const clienteSel = el('finAtrasadasCliente');
    for (const nome of [...new Set(todas.map(l => l.cliente))].sort((a, b) => a.localeCompare(b, 'pt-BR'))) {
      const opcao = document.createElement('option');
      opcao.value = nome;
      opcao.textContent = nome;
      clienteSel.appendChild(opcao);
    }
    // Os campos de data começam vazios: sem filtro de período.
    el('finAtrasadasInicio').value = '';
    el('finAtrasadasFim').value = '';

    const colunas = [
      { chave: 'pedido', tipo: 'pedido' }, { chave: 'cliente' }, { chave: 'nf' }, { chave: 'parcela' },
      { chave: 'vencimento', tipo: 'data' }, { chave: 'dias', tipo: 'inteiro', enfase: true },
      { chave: 'liquido', tipo: 'moeda' }, { chave: 'cms', tipo: 'moeda' }, { chave: 'royalty', tipo: 'moeda' },
      { chave: 'comissao', tipo: 'moeda', classe: 'font-semibold' }
    ];

    function filtrar() {
      const cliente = clienteSel.value;
      const pedido = String(el('finAtrasadasPedido').value).trim();
      const faixa = el('finAtrasadasFaixa').value;
      const inicio = el('finAtrasadasInicio').value;
      const fim = el('finAtrasadasFim').value;
      return todas.filter(l =>
        (!cliente || l.cliente === cliente)
        && (!pedido || l.pedido.includes(pedido))
        && (!faixa || l.faixa === faixa)
        && (!inicio || l.vencimento >= inicio)
        && (!fim || l.vencimento <= fim));
    }

    function desenhar() {
      const linhas = filtrar();
      const resumo = resumoAtrasadas(linhas);
      el('finAtrasadasQuantidade').textContent = String(resumo.quantidade);
      el('finAtrasadasLiquido').textContent = formatarMoeda(resumo.liquido);
      el('finAtrasadasComissao').textContent = formatarMoeda(resumo.comissao);
      montarLinhas(el('finAtrasadasCorpo'), linhas, colunas, { abrir: 'detalhes-parcela' });
      el('finAtrasadasVazio').classList.toggle('hidden', linhas.length > 0);
      overlay.querySelector('#finAtrasadasCorpo').closest('.fin-tabela').classList.toggle('hidden', linhas.length === 0);

      const aging = el('finAtrasadasAging');
      aging.replaceChildren();
      const maior = Math.max(1, ...agingDe(linhas).map(f => f.liquido));
      for (const f of agingDe(linhas)) {
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

    ['finAtrasadasCliente', 'finAtrasadasFaixa', 'finAtrasadasInicio', 'finAtrasadasFim'].forEach(id => el(id).addEventListener('change', desenhar));
    el('finAtrasadasPedido').addEventListener('input', desenhar);
    // Enter numa linha abre os detalhes, como o clique.
    el('finAtrasadasCorpo').addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const tr = e.target.closest('tr[data-fin-abrir]');
      if (tr) { e.preventDefault(); tr.click(); }
    });
    desenhar();
  }

  function montarProducaoCompetencia() {
    const todas = EXEMPLO.producaoCompetencia;
    const competencia = contexto.competencia || competenciaAtual();
    el('finProdCompCompetencia').textContent = rotuloCompetenciaCurto(competencia);
    const resumo = resumoProducao(todas);
    el('finProdCompPecas').textContent = String(resumo.pecas);
    el('finProdCompPedidos').textContent = String(resumo.pedidos);
    el('finProdCompPintura').textContent = formatarMoeda(resumo.pintura);
    el('finProdCompMarcenaria').textContent = formatarMoeda(resumo.marcenaria);
    el('finProdCompTotal').textContent = formatarMoeda(resumo.total);
    el('finProdCompRodape').textContent = formatarMoeda(resumo.total);

    const colunas = [
      { chave: 'pedido', tipo: 'pedido' }, { chave: 'produtoCompleto' }, { chave: 'setor' },
      { chave: 'quantidade', tipo: 'inteiro' }, { chave: 'unitario', tipo: 'moeda' },
      { chave: 'total', tipo: 'moeda', classe: 'font-semibold' }, { chave: 'status', tipo: 'badge' }
    ];

    function desenhar() {
      const setor = el('finProdCompSetor').value;
      const pedido = String(el('finProdCompPedido').value).trim();
      const produto = String(el('finProdCompProduto').value).trim().toLowerCase();
      const status = el('finProdCompItemStatus').value;
      const linhas = todas.filter(l =>
        (!setor || l.setor === setor)
        && (!pedido || l.pedido.includes(pedido))
        && (!produto || `${l.codigo} ${l.produto}`.toLowerCase().includes(produto))
        && (!status || l.status === status))
        .map(l => ({ ...l, produtoCompleto: `${l.codigo} — ${l.produto}` }));
      montarLinhas(el('finProdCompCorpo'), linhas, colunas);
      el('finProdCompVazio').classList.toggle('hidden', linhas.length > 0);
    }

    ['finProdCompSetor', 'finProdCompItemStatus'].forEach(id => el(id).addEventListener('change', desenhar));
    ['finProdCompPedido', 'finProdCompProduto'].forEach(id => el(id).addEventListener('input', desenhar));
    desenhar();
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
      const origem = c.origem === 'env' ? 'Lido das variáveis de ambiente (DEV).' : (c.guardadoEm ? `Guardado neste computador em ${formatarData(String(c.guardadoEm).slice(0, 10))}.` : '');
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
      alternarConfirmacao();
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
        const r = await fetchApi('/api/fiscal/certificado', { method: 'POST', body: JSON.stringify({ caminho, senha }) });
        el('finCfgCertSenha').value = '';
        pintarCertificado(r);
        window.showToast?.('Certificado guardado neste computador.', 'success');
      } catch (e) {
        mensagem(e.message);
      }
    }

    async function removerCertificado() {
      const ok = await (window.DialogPadrao?.confirm?.({
        title: 'Remover certificado',
        message: 'O certificado e a senha serão apagados deste computador. A emissão de NF-e aqui deixa de funcionar até cadastrar de novo.',
        confirmText: 'Remover'
      }) ?? Promise.resolve(true));
      if (!ok) return;
      try {
        await fetchApi('/api/fiscal/certificado', { method: 'DELETE' });
        pintarCertificado({ configurado: false });
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
    el('finCfg_ambiente')?.addEventListener('change', alternarConfirmacao);

    carregar();
  }

  const montadores = {
    finConfiguracaoFiscal: montarConfiguracaoFiscal,
    finRegistrarNf: montarRegistrarNf,
    finRegistrarRecebimento: montarRecebimento,
    finRegistrarAjuste: montarAjuste,
    finRegistrarProducao: montarProducao,
    finFecharCompetencia: montarFechamento,
    finRelatorios: montarRelatorios,
    finDetalhesParcela: montarDetalhesParcela,
    finDetalhesPedido: montarDetalhesPedido,
    finConfirmarPagamento: montarConfirmarPagamento,
    finVisualizarRelatorio: montarVisualizarRelatorio,
    finComissoesAtrasadas: montarComissoesAtrasadas,
    finProducaoCompetencia: montarProducaoCompetencia
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
