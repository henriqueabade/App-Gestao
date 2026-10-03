/**
 * Fase I (02/10/2026) — o pacote por pagamento. Regra do dono: "o boleto
 * sempre junto do comprovante, do pagamento, da nota e do extrato".
 *
 * Cada pagamento do mês (conta a pagar, comissão/produção, reembolso) vira
 * uma pasta em 06-Pagamentos com:
 *   - o dossiê do pagamento, gerado na hora (dossiePagamento.js): a conta, a
 *     parcela, a nota, o boleto, o lançamento do extrato e o comprovante;
 *   - o comprovante do banco (refeito dos dados, fase D, ou o anexado);
 *   - o espelho do boleto do DDA (gerado na hora, fase H) e o boleto do
 *     fornecedor anexado, se houver;
 *   - os outros arquivos anexados ao pagamento ou à conta (recibo, guia…).
 *
 * A nota vai no mês fiscal dela (05-Recebidos) e não se repete aqui. O dossiê
 * diz onde ela está: neste pacote; no pacote do mês em que foi enviada (achado
 * pelo SHA-256 do arquivo no registro dos pacotes); ou que ainda vai no pacote
 * do mês dela.
 *
 * `planoDosPagamentos` é pura (as listas já lidas); `carregar` lê tudo.
 */
const c = require('../../financeiro/comum');
const b = require('../base');
const arquivos = require('../arquivos');
const titulos = require('../titulos');
const documentos = require('../documentosRecebidos');
const liquidacoes = require('../conciliacao/liquidacoes');

const PASTA_AVULSOS = 'Comprovantes sem pagamento';
const TIPOS_DE_PAGAMENTO = new Set(['titulo_pagamento', 'financeiro_pagamento', 'reembolso']);
const CRITERIOS = {
  automatico: 'automático', sugestao: 'sugestão aceita', composicao: 'soma aceita', manual: 'escolhido à mão', conta_criada: 'conta lançada do extrato',
  parcela_paga: 'conta paga pela conciliação', dda_pago: 'boleto do DDA lançado e pago'
};

const semAcento = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const valorCurto = v => c.centavos(Math.abs(Number(v) || 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * O nome da pasta de um pagamento: "001 05-08 Imobiliaria Centro 2.500,00".
 * Curto (o Windows limita o caminho a 260) e sem acento. Pura.
 */
function nomeDaPasta(seq, pag) {
  const d = c.dia(pag.data) || '';
  const quem = semAcento(pag.nome || pag.rotulo || 'Pagamento').replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').slice(0, 3).join(' ').slice(0, 28).trim() || 'Pagamento';
  return `${String(seq).padStart(3, '0')} ${d.slice(8, 10)}-${d.slice(5, 7)} ${quem} ${valorCurto(pag.valor)}`;
}

/**
 * Onde está a nota (ou o documento) do pagamento. `pacotes` = as linhas de
 * contabil_pacotes; `caminhos` = Map id do arquivo -> caminho neste pacote
 * (só na hora de gerar). Pura.
 *   neste       vai neste pacote (05-Recebidos)
 *   enviada     foi num pacote marcado como enviado
 *   gerada      foi num pacote gerado, ainda não marcado como enviado
 *   outro_mes   é de outro mês e ainda não foi em pacote nenhum
 *   sem_arquivo registrada sem o arquivo
 */
function ondeEstaANota({ doc, arquivosDoDoc = [], competencia, pacotes = [], caminhos = new Map() }) {
  const shas = new Set(c.lista(arquivosDoDoc).map(a => String(a.sha256 || '').trim()).filter(Boolean));
  if (doc.competencia === competencia) {
    if (!arquivosDoDoc.length) return { situacao: 'sem_arquivo', texto: 'Registrada sem o arquivo (falta anexar a nota neste mês).' };
    const onde = c.lista(arquivosDoDoc).map(a => caminhos.get(String(a.id))).filter(Boolean);
    return { situacao: 'neste', texto: onde.length ? `Neste pacote: ${onde.join(' · ')}` : 'Neste pacote, na pasta 05-Recebidos.' };
  }
  const achados = [];
  for (const p of c.lista(pacotes)) {
    const lista = c.jsonDe(p.arquivos, []) || [];
    const item = lista.find(x => shas.has(String(x?.sha256 || '').trim()));
    if (item) achados.push({ p, item });
  }
  const mes = c.rotuloCompetencia(doc.competencia);
  if (achados.length) {
    const ordem = x => String(x.p.enviado_em || '') + String(x.p.gerado_em || '');
    achados.sort((x, y) => Number(Boolean(y.p.enviado_em)) - Number(Boolean(x.p.enviado_em)) || ordem(y).localeCompare(ordem(x)));
    const { p, item } = achados[0];
    const quando = iso => (b.instanteBR(iso) ? c.impressa(b.instanteBR(iso).slice(0, 10)) : null);
    const base = `pacote ${p.nome_arquivo || `de ${c.rotuloCompetencia(p.competencia)}`} (${c.rotuloCompetencia(p.competencia)}${p.versao ? `, versão ${p.versao}` : ''}), arquivo ${item.pasta}/${item.nome} (SHA-256 ${String(item.sha256).slice(0, 16)}…)`;
    return p.enviado_em
      ? { situacao: 'enviada', texto: `Enviada no ${base}, em ${quando(p.enviado_em)}${p.enviado_para ? ` para ${p.enviado_para}` : ''}.` }
      : { situacao: 'gerada', texto: `Foi no ${base}, gerado em ${quando(p.gerado_em)} (ainda não marcado como enviado).` };
  }
  if (!arquivosDoDoc.length) return { situacao: 'sem_arquivo', texto: `É de ${mes} e foi registrada sem o arquivo.` };
  return { situacao: 'outro_mes', texto: `É de ${mes}: vai no pacote daquele mês (ainda não foi em pacote nenhum).` };
}

/** O que a pasta mostra de um lançamento do extrato. Pura. */
function movimentoDaPasta(m, { contasBanco = new Map(), criterio = null } = {}) {
  return {
    id: Number(m.id), conta: contasBanco.get(String(m.conta_id)) || null, data: c.dia(m.data), valor: c.centavos(m.valor),
    descricao: m.descricao || null, documento: m.documento || null, contrapartida: b.documentoFormatado(m.contrapartida_documento) || null,
    estado: m.estado_conciliacao || 'pendente', criterio: criterio ? CRITERIOS[criterio] || criterio : null
  };
}

/**
 * As pastas dos pagamentos do mês. Recebe o que `carregar` leu (ou os
 * testes montam). Devolve `{ pagamentos, usados }`: `usados` são os
 * comprovantes e arquivos que vão nas pastas e saem das pastas gerais. Pura.
 */
function planoDosPagamentos({
  competencia, liquidacoesLista = [], pagamentosDeConta = new Map(), documentosPorId = new Map(), documentosDoFechamento = new Map(),
  reembolsos = new Map(), devolucoesDoPedido = new Map(), arquivosPorAlvo = new Map(), arquivosDeDocumento = new Set(),
  vinculosPorChave = new Map(), movimentosPorId = new Map(), contasBanco = new Map(), comprovantesDoMovimento = new Map(),
  boletoDaParcela = new Map(), boletosPorId = new Map(), pacotes = []
}) {
  const doMes = c.lista(liquidacoesLista)
    .filter(l => l && TIPOS_DE_PAGAMENTO.has(l.tipo) && !l.obrigacao && !l.estornado && String(l.data || '').startsWith(competencia))
    .sort((x, y) => String(x.data).localeCompare(String(y.data)) || x.tipo.localeCompare(y.tipo) || x.id - y.id);
  const usados = { comprovantes: new Set(), arquivos: new Set() };
  const arquivosDe = chave => c.lista(arquivosPorAlvo.get(chave));
  const pagamentos = doMes.map((l, i) => {
    const pag = {
      chave: l.chave, tipo: l.tipo, tipo_rotulo: l.tipo_rotulo, id: l.id, data: l.data, valor: c.centavos(l.valor_abs), forma: l.forma,
      rotulo: l.rotulo, nome: l.nome || null, documento: l.documento || null, no_banco: l.no_banco !== false,
      conta: null, parcela: null, pagamento: null, fechamento: null, reembolso: null,
      documentos: [], movimentos: [], comprovantes: [], dda: null, arquivos: [], faltas: []
    };
    pag.pasta = nomeDaPasta(i + 1, pag);
    const alvos = [];
    let docs = [];
    if (l.tipo === 'titulo_pagamento') {
      const tp = pagamentosDeConta.get(String(l.id)) || null;
      if (tp) {
        const { titulo: t, parcela: p } = tp;
        pag.conta = {
          id: t.id, descricao: t.descricao, fornecedor: t.fornecedor, fornecedor_documento: t.fornecedor_documento, categoria: t.categoria,
          numero_documento: t.numero_documento, competencia: t.competencia, valor_total: t.valor_total, situacao_rotulo: t.situacao_rotulo, origem: t.origem
        };
        pag.parcela = { id: p.id, numero: p.numero, de: p.de, vencimento: p.vencimento, valor: p.valor, linha_digitavel: p.linha_digitavel || null };
        pag.pagamento = { juros: p.pagamento.juros, desconto: p.pagamento.desconto, observacao: p.pagamento.observacao };
        if (!pag.nome) pag.nome = t.fornecedor || null;
        if (t.documento_recebido_id !== null && t.documento_recebido_id !== undefined && documentosPorId.get(String(t.documento_recebido_id))) {
          docs.push(documentosPorId.get(String(t.documento_recebido_id)));
        }
        pag.dda = boletoDaParcela.get(String(p.id)) || null;
        alvos.push(`pagamento:${l.id}`, `titulo:${t.id}`);
      } else {
        alvos.push(`pagamento:${l.id}`);
      }
    } else if (l.tipo === 'financeiro_pagamento') {
      pag.fechamento = { rotulo: l.rotulo, detalhe: l.detalhe || null };
      docs = c.lista(documentosDoFechamento.get(String(l.id)));
      alvos.push(`financeiro_pagamento:${l.id}`);
    } else {
      const r = reembolsos.get(String(l.id)) || null;
      pag.reembolso = { pedido_id: r?.pedido_id ?? null, rotulo: l.rotulo };
      pag.devolucoes = c.lista(devolucoesDoPedido.get(String(r?.pedido_id))).map(n => ({
        rotulo: `NF-e de devolução ${n.serie ?? ''}${n.serie !== null && n.serie !== undefined ? '/' : ''}${n.numero ?? ''}`.trim(), chave_acesso: n.chave_acesso || null,
        data_emissao: c.dia(n.data_emissao), valor_total: c.centavos(n.valor_total), competencia: String(c.dia(n.data_emissao) || '').slice(0, 7)
      }));
      alvos.push(`reembolso:${l.id}`);
    }
    pag.documentos = docs.filter(d => d && !d.excluido_em).map(d => ({
      id: d.id, rotulo: documentos.rotuloDoDocumento(d), tipo: d.tipo, tipo_rotulo: documentos.TIPOS[d.tipo] || d.tipo, chave_acesso: d.chave_acesso || null,
      emitente: d.emitente_nome || null, emitente_documento: b.documentoFormatado(d.emitente_documento) || null, data_emissao: c.dia(d.data_emissao),
      valor_total: c.centavos(d.valor_total), competencia: d.competencia, arquivos: arquivosDe(`documento_recebido:${d.id}`),
      onde: ondeEstaANota({ doc: d, arquivosDoDoc: arquivosDe(`documento_recebido:${d.id}`), competencia, pacotes })
    }));

    // Os anexos da pasta: os do pagamento e da conta (o boleto do fornecedor, o comprovante, o recibo…),
    // menos os que são o arquivo de uma nota (esses vão no mês fiscal dela).
    const vistos = new Set();
    for (const alvo of alvos) {
      for (const a of arquivosDe(alvo)) {
        if (vistos.has(String(a.id)) || arquivosDeDocumento.has(String(a.id))) continue;
        vistos.add(String(a.id));
        pag.arquivos.push(a);
        usados.arquivos.add(String(a.id));
      }
    }

    // O extrato: os lançamentos conciliados com este pagamento; o comprovante do BB ligado a cada um.
    for (const v of c.lista(vinculosPorChave.get(l.chave))) {
      const m = movimentosPorId.get(String(v.movimento_id));
      if (!m || pag.movimentos.some(x => x.id === Number(m.id))) continue;
      pag.movimentos.push(movimentoDaPasta(m, { contasBanco, criterio: v.criterio }));
      for (const cp of c.lista(comprovantesDoMovimento.get(String(m.id)))) {
        if (pag.comprovantes.some(x => x.id === cp.id)) continue;
        pag.comprovantes.push(cp);
        usados.comprovantes.add(String(cp.id));
        if (!pag.dda && cp.dda_boleto_id && boletosPorId.get(String(cp.dda_boleto_id))) pag.dda = boletosPorId.get(String(cp.dda_boleto_id));
      }
    }

    const temComprovante = pag.comprovantes.length || pag.arquivos.some(a => a.categoria === 'comprovante');
    if (pag.no_banco && !pag.movimentos.length) pag.faltas.push('Sem o lançamento do extrato (a conciliar)');
    if (pag.no_banco && !temComprovante) pag.faltas.push('Sem o comprovante do banco');
    const porBoleto = pag.forma === 'Boleto' || Boolean(b.digitos(pag.parcela?.linha_digitavel));
    if (porBoleto && !pag.dda && !pag.arquivos.some(a => a.categoria === 'boleto')) pag.faltas.push('Pago por boleto, sem o boleto');
    if (pag.tipo !== 'reembolso' && !pag.documentos.length && !pag.arquivos.some(a => arquivos.CATEGORIAS_DE_DOCUMENTO.has(a.categoria))) {
      pag.faltas.push('Sem nota, recibo ou guia ligados');
    }
    return pag;
  });
  return { pagamentos, usados };
}

/** O resumo de uma pasta para a tela (a prévia do pacote). Pura. */
function pastaPublica(pag) {
  const itens = ['Dossiê do pagamento'];
  if (pag.comprovantes.length || pag.arquivos.some(a => a.categoria === 'comprovante')) itens.push('Comprovante');
  if (pag.dda) itens.push('Espelho DDA');
  if (pag.arquivos.some(a => a.categoria === 'boleto')) itens.push('Boleto do fornecedor');
  const outros = pag.arquivos.filter(a => !['comprovante', 'boleto'].includes(a.categoria)).length;
  if (outros) itens.push(c.plural(outros, 'outro anexo', 'outros anexos'));
  return {
    chave: pag.chave, pasta: pag.pasta, tipo_rotulo: pag.tipo_rotulo, data: pag.data, valor: pag.valor, rotulo: pag.rotulo, nome: pag.nome,
    itens, notas: pag.documentos.map(d => ({ rotulo: d.rotulo, situacao: d.onde.situacao, texto: d.onde.texto })), faltas: pag.faltas
  };
}

// ------------------------------------------------------------------ leitura

const lerSePuder = (api, tabela) => api.get(`/api/${tabela}`).then(c.lista).catch(() => []);

/** O que as pastas precisam, numa leitura. Sem o SQL das contas a pagar, só os pagamentos de fechamento e reembolsos. */
async function carregar(api, { competencia, hoje }) {
  const comp = String(competencia);
  const [liqs, base, docs, arqs, vincArqs, vincConc, movs, contasLidas, cps, ddas, pacotes, reembolsosLidos, devolucoes] = await Promise.all([
    liquidacoes.carregar(api, { de: `${comp}-01`, ate: b.ultimoDia(comp) }),
    titulos.lerBase(api).catch(e => (e?.extra?.sql_pendente ? null : Promise.reject(e))),
    b.lerOpcional(api, 'documentos_recebidos'), b.lerOpcional(api, 'contabil_arquivos'), b.lerOpcional(api, 'contabil_arquivo_vinculos'),
    b.lerOpcional(api, 'conciliacao_vinculos'), b.lerOpcional(api, 'movimentos_bancarios'), b.lerOpcional(api, 'contas_financeiras'),
    b.lerOpcional(api, 'contabil_comprovantes').catch(() => null), b.lerOpcional(api, 'contabil_dda_boletos').catch(() => null),
    b.lerOpcional(api, 'contabil_pacotes').catch(() => null),
    lerSePuder(api, 'reembolsos'), lerSePuder(api, 'notas_devolucao')
  ]);
  const pagamentosDeConta = new Map();
  if (base) {
    for (const t of titulos.montarTodos(base, hoje)) {
      for (const p of t.parcelas) if (p.pagamento) pagamentosDeConta.set(String(p.pagamento.id), { titulo: t, parcela: p });
    }
  }
  const docsVivos = c.lista(docs).filter(d => d && !d.excluido_em);
  const documentosDoFechamento = new Map();
  for (const d of docsVivos) {
    if (d.financeiro_pagamento_id === null || d.financeiro_pagamento_id === undefined) continue;
    const k = String(d.financeiro_pagamento_id);
    documentosDoFechamento.set(k, [...(documentosDoFechamento.get(k) || []), d]);
  }
  const vivos = new Map(c.lista(arqs).filter(a => a && a.completo !== false && a.completo !== 'false' && !a.excluido_em).map(a => [String(a.id), a]));
  const arquivosPorAlvo = new Map();
  const arquivosDeDocumento = new Set();
  for (const v of c.lista(vincArqs)) {
    const a = vivos.get(String(v.arquivo_id));
    if (!a) continue;
    const k = `${v.alvo_tipo}:${v.alvo_id}`;
    arquivosPorAlvo.set(k, [...(arquivosPorAlvo.get(k) || []), arquivos.publico(a)]);
    if (v.alvo_tipo === 'documento_recebido') arquivosDeDocumento.add(String(a.id));
  }
  const vinculosPorChave = new Map();
  for (const v of c.lista(vincConc).filter(x => x && !x.desfeito_em)) {
    const k = liquidacoes.chaveDe(v.alvo_tipo, v.alvo_id);
    vinculosPorChave.set(k, [...(vinculosPorChave.get(k) || []), v]);
  }
  const comprovantesMod = require('../comprovantes/comprovantes');
  const comprovantesDoMovimento = new Map();
  for (const cp of c.lista(cps).filter(x => x && x.situacao === 'ligado' && x.movimento_id).map(comprovantesMod.normalizar)) {
    const k = String(cp.movimento_id);
    comprovantesDoMovimento.set(k, [...(comprovantesDoMovimento.get(k) || []), cp]);
  }
  const dda = require('../dda/dda');
  const boletos = c.lista(ddas).filter(Boolean).map(dda.normalizar);
  const devolucoesDoPedido = new Map();
  for (const n of c.lista(devolucoes).filter(Boolean)) {
    const k = String(n.pedido_id);
    devolucoesDoPedido.set(k, [...(devolucoesDoPedido.get(k) || []), n]);
  }
  return planoDosPagamentos({
    competencia: comp, liquidacoesLista: liqs, pagamentosDeConta,
    documentosPorId: new Map(docsVivos.map(d => [String(d.id), d])), documentosDoFechamento,
    reembolsos: new Map(c.lista(reembolsosLidos).filter(Boolean).map(r => [String(r.id), r])), devolucoesDoPedido,
    arquivosPorAlvo, arquivosDeDocumento, vinculosPorChave,
    movimentosPorId: new Map(c.lista(movs).filter(Boolean).map(m => [String(m.id), m])),
    contasBanco: new Map(c.lista(contasLidas).filter(Boolean).map(x => [String(x.id), x.nome])),
    comprovantesDoMovimento,
    boletoDaParcela: new Map(boletos.filter(x => x.situacao === 'vinculado' && x.parcela_id).map(x => [String(x.parcela_id), x])),
    boletosPorId: new Map(boletos.map(x => [String(x.id), x])),
    pacotes: c.lista(pacotes)
  });
}

module.exports = { PASTA_AVULSOS, TIPOS_DE_PAGAMENTO, nomeDaPasta, ondeEstaANota, movimentoDaPasta, planoDosPagamentos, pastaPublica, carregar };
