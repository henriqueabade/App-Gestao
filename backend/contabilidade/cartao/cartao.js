/**
 * Fase G (02/10/2026) — o cartão de crédito do BB pela fatura em XLSX.
 * Regras do dono:
 *   - a fatura vem sempre em XLSX; "fatura do cartão a importar" fica
 *     pendente para fechar a competência (a do vencimento no mês);
 *   - ao importar, as notas casam com as compras pelo valor, entendendo o
 *     parcelado (a nota sai cheia: parcela × nº de parcelas);
 *   - na dúvida (valores iguais, duas notas) o usuário escolhe entre as
 *     possibilidades delimitadas (as sugestões);
 *   - a compra abaixo do limite (R$ 50, configurável) não precisa de nota.
 *
 *   importar ........ guarda os dados da fatura (o arquivo não), confere as
 *                     contas, herda a nota das parcelas já ligadas, casa as
 *                     notas e concilia o pagamento da fatura no extrato;
 *   conferir ........ o mesmo, de novo (a nota que chegou depois, o extrato);
 *   ligarNota/semNota/desfazer ... a decisão de cada compra (vale para todas
 *                     as parcelas da mesma compra);
 *   pendências ...... (pura) a fatura do mês a importar, a que não fecha, as
 *                     compras sem nota (crítico), as de antes do início e a
 *                     fatura sem o pagamento (avisos).
 *
 * O pagamento da fatura é a liquidação "fatura_cartao" (conciliação, critério
 * "cartao"); a classificação vai pela origem "cartao" (00744, regra do SQL).
 */
const c = require('../../financeiro/comum');
const b = require('../base');
const eventos = require('../eventos');
const arquivos = require('../arquivos');
const parametros = require('../parametros');
const leitura = require('./leitura');

const FATURAS = 'contabil_cartao_faturas';
const COMPRAS = 'contabil_cartao_compras';
const TIPOS = { compra: 'Compra', credito: 'Crédito / estorno', pagamento: 'Pagamento da fatura', encargo: 'Encargo do banco' };
const SITUACOES = {
  com_nota: 'Com nota', com_recibo: 'Com recibo anexado', sem_nota: 'Sem nota (decidido)', abaixo_do_limite: 'Abaixo do limite',
  anterior: 'Compra de antes do início', pendente: 'Falta a nota', nao_se_aplica: 'Não precisa de nota'
};
const CRITERIOS = { automatico: 'casada pelo valor e pela data', escolhido: 'escolhida à mão', parcela: 'a mesma da parcela anterior' };
const VISOES = { todas: 'Todas', pendentes: 'Faltam notas', com_nota: 'Com nota' };
const MAX_ARQUIVOS = 12;
/** A nota pode sair uns dias antes da compra (pedido) ou depois (entrega). */
const JANELA_NOTA = { antes: 5, depois: 10 };
/** O pagamento da fatura: até 10 dias antes do vencimento ou 6 depois (fim de semana, feriado). */
const JANELA_PAGAMENTO = { antes: 10, depois: 6 };

const cent = v => Math.round(Math.abs(Number(v) || 0) * 100);
const norm = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const GENERICAS = new Set(['LTDA', 'EIRELI', 'COMERCIO', 'LOJA', 'LOJAS', 'MERCADO', 'SUPERMERCADO', 'SUPERMERCADOS', 'PAGAMENTO', 'PAG', 'COMPRA', 'BRASIL', 'MINAS']);

function somarDias(iso, n) {
  const [a, m, d] = String(iso).split('-').map(Number);
  const t = new Date(Date.UTC(a, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

const normalizarFatura = f => ({
  ...f, id: Number(f.id), vencimento: c.dia(f.vencimento), competencia: String(f.competencia || '').trim(), valor_total: c.centavos(f.valor_total),
  valor_minimo: f.valor_minimo === null || f.valor_minimo === undefined ? null : c.centavos(f.valor_minimo),
  saldo_anterior: f.saldo_anterior === null || f.saldo_anterior === undefined ? null : c.centavos(f.saldo_anterior),
  limite: f.limite === null || f.limite === undefined ? null : c.centavos(f.limite),
  conferencias: c.jsonDe(f.conferencias, []) || [], linhas: c.jsonDe(f.linhas, []) || [], confere: f.confere === true || f.confere === 'true'
});
const normalizarCompra = x => ({
  ...x, id: Number(x.id), fatura_id: Number(x.fatura_id), ordem: Number(x.ordem) || 0, data: c.dia(x.data), valor: c.centavos(x.valor),
  valor_compra: c.centavos(x.valor_compra ?? x.valor), parcela_numero: x.parcela_numero ? Number(x.parcela_numero) : null,
  parcela_total: x.parcela_total ? Number(x.parcela_total) : null, documento_id: x.documento_id === null || x.documento_id === undefined ? null : Number(x.documento_id)
});
const valendo = f => !f.substituida_em;

/** A mesma compra em faturas diferentes (as parcelas): estabelecimento, dia, nº de parcelas e o valor da parcela. Pura. */
const chaveDaCompra = x => (x.parcela_total ? `${norm(x.descricao)}|${x.data}|${x.parcela_total}|${cent(x.valor)}` : `id:${x.id}`);

/** A palavra do estabelecimento que acha o emitente ("MERCADOLIVRE*LOJA" → MERCADOLIVRE). Pura. */
function palavraChave(texto) {
  return norm(texto).split(' ').find(p => p.length >= 4 && !GENERICAS.has(p) && !/^\d+$/.test(p)) || null;
}

/**
 * A situação de uma compra quanto à nota. `limite` (R$) e `inicio` (AAAA-MM)
 * vêm dos parâmetros; `comRecibo` = há nota/recibo anexado à compra. Pura.
 */
function situacaoDaCompra(x, { limite = 50, inicio = null, comRecibo = false } = {}) {
  if (x.tipo !== 'compra') return 'nao_se_aplica';
  if (x.documento_id) return 'com_nota';
  if (comRecibo) return 'com_recibo';
  if (x.decisao === 'sem_nota') return 'sem_nota';
  if (c.centavos(x.valor_compra) < c.centavos(limite)) return 'abaixo_do_limite';
  if (inicio && x.data && x.data.slice(0, 7) < inicio) return 'anterior';
  return 'pendente';
}

/** O documento pode ser a nota de uma compra no cartão? (vivo, nota/recibo, sem ser de fechamento nem "sem pagamento") Pura. */
const documentoServe = d => d && !d.excluido_em && ['nfe', 'nfse', 'outro'].includes(String(d.tipo || ''))
  && (d.financeiro_pagamento_id === null || d.financeiro_pagamento_id === undefined) && !(d.sem_pagamento === true || d.sem_pagamento === 'true') && c.centavos(d.valor_total) > 0;

/**
 * As notas que podem ser a de uma compra: o mesmo valor (ou a compra inteira
 * da parcelada, com a diferença de arredondamento das parcelas) e a emissão
 * perto do dia da compra. `contaAberta` (Set de ids) marca a nota que já tem
 * conta a pagar — essa só à mão. Pura.
 */
function candidatos(x, documentos, { contaAberta = new Set(), usados = new Map() } = {}) {
  if (!x.data) return [];
  const chave = palavraChave(x.descricao);
  const de = somarDias(x.data, -JANELA_NOTA.antes);
  const ate = somarDias(x.data, JANELA_NOTA.depois);
  const minha = chaveDaCompra(x);
  const saida = [];
  for (const d of documentos) {
    if (!documentoServe(d)) continue;
    const emissao = c.dia(d.data_emissao);
    if (!emissao || emissao < de || emissao > ate) continue;
    const dono = usados.get(String(d.id));
    if (dono && dono !== minha) continue;
    const valorDoc = cent(d.valor_total);
    const motivos = [];
    if (valorDoc === cent(x.valor_compra)) motivos.push(x.parcela_total ? `o valor da compra inteira (${x.parcela_total} × ${c.reais(x.valor)})` : 'o mesmo valor');
    else if (x.parcela_total && Math.abs(valorDoc - cent(x.valor) * x.parcela_total) <= x.parcela_total) motivos.push(`a compra inteira, com o arredondamento das ${x.parcela_total} parcelas`);
    else continue;
    const dias = Math.round((Date.parse(emissao) - Date.parse(x.data)) / 86400000);
    motivos.push(dias === 0 ? 'emitida no dia da compra' : `emitida ${Math.abs(dias)} ${Math.abs(dias) === 1 ? 'dia' : 'dias'} ${dias < 0 ? 'antes' : 'depois'}`);
    const nome = Boolean(chave) && ` ${norm(d.emitente_nome)} `.includes(` ${chave} `);
    if (nome) motivos.push('o nome do emitente');
    saida.push({ documento: d, motivos, nome, dias: Math.abs(dias), com_conta: contaAberta.has(String(d.id)) });
  }
  return saida.sort((p, q) => Number(q.nome) - Number(p.nome) || Number(p.com_conta) - Number(q.com_conta) || p.dias - q.dias || Number(p.documento.id) - Number(q.documento.id));
}

/**
 * O que casa sozinho e o que fica para escolher. Só as compras que ainda
 * precisam de nota (falta ou de antes do início). Automático só quando a
 * compra tem uma única nota possível (sem conta a pagar) e essa nota não
 * serve para outra compra. Pura: `{ automaticos: [{ compra_id, documento_id }],
 * sugestoes: Map(compra_id → candidatos) }`.
 */
function casarNotas({ compras = [], documentos = [], contaAberta = new Set(), limite = 50, inicio = null, comRecibo = new Set() }) {
  const usados = new Map();
  for (const x of compras) if (x.documento_id) usados.set(String(x.documento_id), chaveDaCompra(x));
  const abertas = compras.filter(x => ['pendente', 'anterior'].includes(situacaoDaCompra(x, { limite, inicio, comRecibo: comRecibo.has(String(x.id)) })));
  // Uma compra parcelada aparece em várias faturas: decide-se uma vez por compra.
  const porCompra = new Map();
  for (const x of abertas) if (!porCompra.has(chaveDaCompra(x))) porCompra.set(chaveDaCompra(x), x);
  const sugestoes = new Map();
  const quemQuer = new Map();
  for (const x of porCompra.values()) {
    const lista = candidatos(x, documentos, { contaAberta, usados });
    if (!lista.length) continue;
    sugestoes.set(x.id, lista);
    for (const k of lista) quemQuer.set(String(k.documento.id), [...(quemQuer.get(String(k.documento.id)) || []), x.id]);
  }
  const automaticos = [];
  for (const [id, lista] of sugestoes) {
    const livres = lista.filter(k => !k.com_conta);
    if (lista.length !== 1 || livres.length !== 1) continue;
    if ((quemQuer.get(String(livres[0].documento.id)) || []).length !== 1) continue;
    automaticos.push({ compra_id: id, documento_id: Number(livres[0].documento.id) });
  }
  return { automaticos, sugestoes };
}

/** As parcelas de uma compra já decidida em outra fatura herdam a nota (ou o "sem nota"). Pura. */
function herdarParcelas(compras = []) {
  const decididas = new Map();
  for (const x of compras) {
    if (!x.parcela_total || (!x.documento_id && x.decisao !== 'sem_nota')) continue;
    if (!decididas.has(chaveDaCompra(x))) decididas.set(chaveDaCompra(x), x);
  }
  const saida = [];
  for (const x of compras) {
    if (!x.parcela_total || x.documento_id || x.decisao) continue;
    const de = decididas.get(chaveDaCompra(x));
    if (de && de.id !== x.id) saida.push({ compra_id: x.id, de: de.id, documento_id: de.documento_id || null, decisao: de.documento_id ? null : 'sem_nota', motivo: de.documento_id ? null : de.motivo || null });
  }
  return saida;
}

/** Quanto do pagamento da fatura já está conciliado (vínculos "fatura_cartao"). Pura. */
function pagamentoDaFatura(f, vinculos = []) {
  const meus = c.lista(vinculos).filter(v => v && !v.desfeito_em && v.alvo_tipo === 'fatura_cartao' && String(v.alvo_id) === String(f.id));
  const pago = c.centavos(meus.reduce((s, v) => s + Math.abs(Number(v.valor) || 0), 0));
  return { pago, restante: c.centavos(Math.max(0, f.valor_total - pago)), movimentos: [...new Set(meus.map(v => Number(v.movimento_id)))] };
}

/**
 * As pendências do mês (fonte das contas a pagar). `dados` = lerTudo;
 * `config` = { ativo, limite }; `inicio` = o mês de início. Pura.
 */
function pendencias({ competencia, dados, config = { ativo: true, limite: 50 }, inicio = null, encerrada = false }) {
  if (!dados || !config.ativo) return [];
  if (parametros.antesDoInicio(competencia, inicio)) return [];
  const rotulo = c.rotuloCompetencia(competencia);
  const faturas = dados.faturas.filter(f => valendo(f) && f.competencia === competencia);
  const filtro = { acao: 'cartao' };
  if (!faturas.length) {
    return [{
      nivel: encerrada ? 'critico' : 'aviso', chave: `cartao_fatura_${competencia}`, titulo: `Fatura do cartão de ${rotulo} a importar`,
      descricao: 'O XLSX da fatura com vencimento neste mês (site do BB): o pagamento no extrato e as notas das compras dependem dela',
      data: b.ultimoDia(competencia), acao: 'Importar', filtro
    }];
  }
  const saida = [];
  for (const f of faturas) {
    const venc = `venc. ${c.impressa(f.vencimento)}`;
    if (!f.confere) {
      saida.push({
        nivel: 'critico', chave: `cartao_nao_confere_${f.id}`, titulo: `A fatura do cartão (${venc}) não fecha`,
        descricao: f.conferencias.filter(x => !x.ok).map(x => x.rotulo).join('; ') || 'Confira as contas da fatura', data: f.vencimento, acao: 'Ver', filtro
      });
    }
    const compras = dados.compras.filter(x => x.fatura_id === f.id);
    const sit = x => situacaoDaCompra(x, { limite: config.limite, inicio, comRecibo: dados.comRecibo?.has(String(x.id)) });
    const faltam = compras.filter(x => sit(x) === 'pendente');
    if (faltam.length) {
      const sugeridas = faltam.filter(x => dados.sugestoes?.has(x.id)).length;
      saida.push({
        nivel: 'critico', chave: `cartao_sem_nota_${f.id}`, titulo: `${c.plural(faltam.length, 'compra do cartão', 'compras do cartão')} sem nota (${venc})`,
        descricao: `Total ${c.reais(faltam.reduce((s, x) => s + x.valor_compra, 0))}${sugeridas ? ` · ${c.plural(sugeridas, 'tem nota sugerida', 'têm nota sugerida')}: escolha` : ''} · ou anexe o recibo, ou diga por que não tem`,
        data: faltam.map(x => x.data).sort()[0] || f.vencimento, acao: 'Ver', filtro
      });
    }
    const anteriores = compras.filter(x => sit(x) === 'anterior');
    if (anteriores.length) {
      saida.push({
        nivel: 'aviso', chave: `cartao_anteriores_${f.id}`, titulo: `${c.plural(anteriores.length, 'compra', 'compras')} de antes do início sem nota (${venc})`,
        descricao: `Total ${c.reais(anteriores.reduce((s, x) => s + x.valor_compra, 0))} · compras (ou parcelas) de antes de ${c.rotuloCompetencia(inicio)}: ligue a nota se tiver`,
        data: anteriores.map(x => x.data).sort()[0] || f.vencimento, acao: 'Ver', filtro
      });
    }
    const pg = pagamentoDaFatura(f, dados.vinculos);
    if (encerrada && pg.restante > 0.009) {
      saida.push({
        nivel: 'aviso', chave: `cartao_nao_paga_${f.id}`, titulo: `Fatura do cartão (${venc}) sem o pagamento conciliado`,
        descricao: `${pg.pago ? `Conciliado ${c.reais(pg.pago)}; ` : ''}falta ${c.reais(pg.restante)} · ligue o débito do extrato na Conciliação`, data: f.vencimento, acao: 'Ver', filtro
      });
    }
  }
  return saida;
}

// ------------------------------------------------------------------ leitura

const lerFaturas = api => b.lerOpcional(api, FATURAS);

/** Os parâmetros do cartão: ligado e o limite (padrão sim e R$ 50). */
async function config(api) {
  const v = (await parametros.ler(api).catch(() => ({ valores: {} }))).valores || {};
  return { ativo: String(v.cartao_ativo ?? 'sim') !== 'nao', limite: c.centavos(Number(v.cartao_limite_sem_nota ?? 50) || 0) };
}

/** As notas (documentos), as contas delas e os recibos anexados às compras. */
async function lerDocumentos(api) {
  const [docs, titulosLidos, vincArqs, arqs] = await Promise.all([
    b.lerOpcional(api, 'documentos_recebidos').then(x => x || []).catch(() => []),
    b.lerOpcional(api, 'titulos_pagar').then(x => x || []).catch(() => []),
    b.lerOpcional(api, 'contabil_arquivo_vinculos').then(x => x || []).catch(() => []),
    b.lerOpcional(api, 'contabil_arquivos').then(x => x || []).catch(() => [])
  ]);
  const contaAberta = new Set(titulosLidos.filter(t => t && t.status !== 'cancelado' && t.documento_recebido_id !== null && t.documento_recebido_id !== undefined).map(t => String(t.documento_recebido_id)));
  const vivos = new Map(arqs.filter(a => a && !a.excluido_em && a.completo !== false && a.completo !== 'false' && arquivos.CATEGORIAS_DE_DOCUMENTO.has(a.categoria)).map(a => [String(a.id), a]));
  const comRecibo = new Set(vincArqs.filter(v => v && v.alvo_tipo === 'cartao_compra' && vivos.has(String(v.arquivo_id))).map(v => String(v.alvo_id)));
  return { documentos: docs.filter(Boolean), contaAberta, comRecibo };
}

/** Tudo numa leitura (null sem o SQL da fase G). */
async function lerTudo(api, { comSugestoes = true } = {}) {
  const faturas = await lerFaturas(api);
  if (faturas === null) return null;
  const compras = ((await b.lerOpcional(api, COMPRAS)) || []).filter(Boolean).map(normalizarCompra);
  const vinculos = ((await b.lerOpcional(api, 'conciliacao_vinculos').catch(() => null)) || []).filter(v => v && !v.desfeito_em && v.alvo_tipo === 'fatura_cartao');
  const docs = await lerDocumentos(api);
  const cfg = await config(api);
  const inicio = await parametros.inicio(api);
  const valendoIds = new Set(faturas.filter(f => f && valendo(f)).map(f => Number(f.id)));
  const comprasValendo = compras.filter(x => valendoIds.has(x.fatura_id));
  const sugestoes = comSugestoes
    ? casarNotas({ compras: comprasValendo, documentos: docs.documentos, contaAberta: docs.contaAberta, limite: cfg.limite, inicio, comRecibo: docs.comRecibo }).sugestoes
    : new Map();
  return { faturas: faturas.filter(Boolean).map(normalizarFatura), compras: comprasValendo, vinculos, ...docs, config: cfg, inicio, sugestoes };
}

// ------------------------------------------------------------------ gravação

const competenciaFechada = async (api, comp) => ((await b.lerOpcional(api, 'competencia_contabil', { competencia: comp })) || [])[0]?.status === 'fechada';

/** Herda as parcelas e casa as notas que são únicas. Devolve quantas ligou. */
async function casarSozinho(api, { usuarioId = null } = {}) {
  const dados = await lerTudo(api, { comSugestoes: false });
  if (!dados) return { herdadas: 0, ligadas: 0, falhas: [] };
  const saida = { herdadas: 0, ligadas: 0, falhas: [] };
  const fechada = new Map();
  const podeMexer = async x => {
    const f = dados.faturas.find(y => y.id === x.fatura_id);
    if (!f) return false;
    if (!fechada.has(f.competencia)) fechada.set(f.competencia, await competenciaFechada(api, f.competencia));
    return !fechada.get(f.competencia);
  };
  for (const h of herdarParcelas(dados.compras)) {
    const x = dados.compras.find(y => y.id === h.compra_id);
    if (!(await podeMexer(x))) continue;
    await b.atualizar(api, COMPRAS, x.id, { documento_id: h.documento_id, criterio: h.documento_id ? 'parcela' : null, decisao: h.decisao, motivo: h.motivo, atualizado_em: c.agora() });
    Object.assign(x, { documento_id: h.documento_id, decisao: h.decisao, motivo: h.motivo });
    saida.herdadas++;
  }
  const { automaticos } = casarNotas({ compras: dados.compras, documentos: dados.documentos, contaAberta: dados.contaAberta, limite: dados.config.limite, inicio: dados.inicio, comRecibo: dados.comRecibo });
  for (const a of automaticos) {
    const x = dados.compras.find(y => y.id === a.compra_id);
    try {
      if (!(await podeMexer(x))) continue;
      const irmas = dados.compras.filter(y => chaveDaCompra(y) === chaveDaCompra(x) && !y.documento_id && !y.decisao);
      for (const y of irmas) await b.atualizar(api, COMPRAS, y.id, { documento_id: a.documento_id, criterio: y.id === x.id ? 'automatico' : 'parcela', atualizado_em: c.agora() });
      saida.ligadas++;
      const d = dados.documentos.find(z => String(z.id) === String(a.documento_id));
      await eventos.registrar(api, {
        tipo: 'cartao_nota_ligada', usuarioId, competencia: dados.faturas.find(f => f.id === x.fatura_id)?.competencia || null,
        descricao: `Compra no cartão de ${x.descricao} (${c.reais(x.valor_compra)}, ${c.impressa(x.data)}) ligada sozinha à nota ${d?.numero ? `nº ${d.numero} ` : ''}de ${d?.emitente_nome || 'emitente'} (${CRITERIOS.automatico})`,
        dados: { compra_id: x.id, documento_id: a.documento_id }
      });
    } catch (e) {
      saida.falhas.push(`${x.descricao}: ${e.message}`);
    }
  }
  return saida;
}

/** O pagamento de cada fatura no extrato: o débito do valor total perto do vencimento (um só). */
async function conciliarSozinho(api, { competencias = null, usuarioId = null } = {}) {
  const lidas = await lerFaturas(api);
  if (!lidas) return { ligados: 0, meses: [], falhas: [] };
  const conciliacao = require('../conciliacao/conciliacao');
  const vinculos = ((await b.lerOpcional(api, 'conciliacao_vinculos').catch(() => null)) || []).filter(v => v && !v.desfeito_em);
  const faturas = lidas.filter(Boolean).map(normalizarFatura).filter(valendo)
    .filter(f => !competencias || competencias.some(m => m === f.competencia || m === c.competenciaDe(somarDias(f.vencimento, JANELA_PAGAMENTO.depois))));
  const saida = { ligados: 0, meses: new Set(), falhas: [] };
  const usados = new Set(vinculos.map(v => String(v.movimento_id)));
  for (const f of faturas) {
    const pg = pagamentoDaFatura(f, vinculos);
    if (pg.restante <= 0.009 || pg.pago > 0) continue;
    const de = somarDias(f.vencimento, -JANELA_PAGAMENTO.antes);
    const ate = somarDias(f.vencimento, JANELA_PAGAMENTO.depois);
    const meses = [...new Set([c.competenciaDe(de), c.competenciaDe(ate)])];
    const movs = [];
    for (const m of meses) movs.push(...((await b.lerOpcional(api, 'movimentos_bancarios', { competencia: m })) || []));
    const certos = movs.filter(m => m && Number(m.valor) < 0 && (m.estado_conciliacao || 'pendente') === 'pendente' && !usados.has(String(m.id))
      && c.dia(m.data) >= de && c.dia(m.data) <= ate && cent(m.valor) === cent(f.valor_total));
    if (certos.length !== 1) continue;
    const m = certos[0];
    if (await competenciaFechada(api, m.competencia)) continue;
    try {
      await conciliacao.gravar(api, m, [{ tipo: 'fatura_cartao', id: f.id, restante: Math.abs(Number(m.valor)) }], {
        criterio: 'cartao', usuarioId, detalhe: `Fatura do cartão${f.cartao_final ? ` final ${f.cartao_final}` : ''} de venc. ${c.impressa(f.vencimento)} (${c.reais(f.valor_total)}), pela fatura importada`
      });
      usados.add(String(m.id));
      saida.ligados++;
      saida.meses.add(m.competencia);
    } catch (e) {
      saida.falhas.push(`Fatura de venc. ${c.impressa(f.vencimento)}: ${e.message}`);
    }
  }
  if (saida.ligados) {
    await eventos.registrar(api, {
      tipo: 'cartao_conciliado', usuarioId, competencia: [...saida.meses][0] || null,
      descricao: `${c.plural(saida.ligados, 'pagamento de fatura do cartão conciliado', 'pagamentos de fatura do cartão conciliados')} pela fatura importada`, dados: { ligados: saida.ligados }
    });
  }
  return { ...saida, meses: [...saida.meses].sort() };
}

/** Os dois de uma vez (o que a importação, o botão e a conciliação automática chamam). */
async function conferir(api, { competencias = null, usuarioId = null } = {}) {
  if ((await lerFaturas(api)) === null) return { herdadas: 0, ligadas: 0, pagamentos: 0, falhas: [] };
  const n = await casarSozinho(api, { usuarioId });
  const p = await conciliarSozinho(api, { competencias, usuarioId });
  return { herdadas: n.herdadas, ligadas: n.ligadas, pagamentos: p.ligados, meses: p.meses, falhas: [...n.falhas, ...p.falhas] };
}

/** A decisão da compra substituída passa para a mesma linha da fatura nova (estabelecimento, dia, valor, parcela). */
const marcaDaLinha = x => `${norm(x.descricao)}|${x.data}|${cent(x.valor)}|${x.parcela_numero || ''}/${x.parcela_total || ''}`;

/**
 * Importar o XLSX da fatura (`arquivos` = [{ nome, base64 }]). Guarda só os
 * dados (sem o número do cartão), substitui a fatura anterior do mesmo
 * vencimento e confere tudo.
 */
async function importar(api, { arquivos: entradas = [], usuarioId = null }) {
  if (!Array.isArray(entradas) || !entradas.length) throw c.erro('Escolha o XLSX da fatura do cartão (site do BB).');
  if ((await lerFaturas(api)) === null) throw c.erro(b.SQL_FALTANDO_FASE_G, 409, { sql_pendente: true, sql_arquivo: b.SQL_ARQUIVO_FASE_G });
  if (entradas.length > MAX_ARQUIVOS) throw c.erro(`Escolha no máximo ${MAX_ARQUIVOS} faturas por vez.`, 413);
  const saida = { lidos: 0, novos: 0, repetidos: 0, substituidos: 0, nao_conferem: 0, falhas: [], importadas: [] };
  for (const e of entradas) {
    const nome = arquivos.nomeDeArquivo(e?.nome || 'fatura.xlsx');
    const dados = Buffer.from(String(e?.base64 || ''), 'base64');
    if (!dados.length) continue;
    saida.lidos++;
    const sha = arquivos.sha256(dados);
    const existentes = ((await lerFaturas(api)) || []).filter(Boolean).map(normalizarFatura);
    if (existentes.some(x => x.sha256 === sha)) { saida.repetidos++; continue; }
    let lida;
    try {
      lida = await leitura.analisar(dados);
      await b.garantirAberta(api, lida.competencia, 'importar a fatura do cartão');
    } catch (err) {
      saida.falhas.push(`${nome}: ${err.message}`);
      continue;
    }
    const anterior = existentes.find(x => valendo(x) && x.vencimento === lida.vencimento && String(x.cartao_final || '') === String(lida.cartao_final || '')) || null;
    let decisoes = new Map();
    if (anterior) {
      const velhas = ((await b.lerOpcional(api, COMPRAS, { fatura_id: anterior.id })) || []).map(normalizarCompra);
      decisoes = new Map(velhas.filter(x => x.documento_id || x.decisao).map(x => [marcaDaLinha(x), x]));
      for (const v of ((await b.lerOpcional(api, 'conciliacao_vinculos')) || []).filter(v => v && !v.desfeito_em && v.alvo_tipo === 'fatura_cartao' && String(v.alvo_id) === String(anterior.id))) {
        await b.atualizar(api, 'conciliacao_vinculos', v.id, { desfeito_em: c.agora(), desfeito_por: usuarioId, motivo_desfazer: 'Fatura do cartão substituída por um XLSX mais novo' });
        const outros = ((await b.lerOpcional(api, 'conciliacao_vinculos', { movimento_id: Number(v.movimento_id) })) || []).filter(x => x && !x.desfeito_em && String(x.id) !== String(v.id));
        if (!outros.length) await b.atualizar(api, 'movimentos_bancarios', v.movimento_id, { estado_conciliacao: 'pendente', conciliado_em: null, conciliado_por: null, conciliacao_observacao: null, conciliacao_diferenca: null });
      }
      await b.atualizar(api, FATURAS, anterior.id, { substituida_em: c.agora(), substituida_por: usuarioId });
      saida.substituidos++;
    }
    const fatura = await b.inserir(api, FATURAS, {
      cartao_final: lida.cartao_final, titular: lida.titular, vencimento: lida.vencimento, competencia: lida.competencia, valor_total: lida.valor_total,
      valor_minimo: lida.valor_minimo, saldo_anterior: lida.saldo_anterior, limite: lida.limite, sha256: sha, nome_arquivo: nome, tamanho_bytes: dados.length,
      linhas: JSON.stringify(lida.linhas), conferencias: JSON.stringify(lida.conferencias), confere: lida.confere, importado_em: c.agora(), importado_por: usuarioId
    });
    for (const l of lida.lancamentos) {
      const antes = decisoes.get(marcaDaLinha(l)) || null;
      await b.inserir(api, COMPRAS, {
        fatura_id: Number(fatura.id), ordem: l.ordem, tipo: l.tipo, secao: l.secao, data: l.data, descricao: l.descricao, cidade: l.cidade, valor: l.valor,
        parcela_numero: l.parcela_numero, parcela_total: l.parcela_total, valor_compra: l.valor_compra,
        documento_id: antes?.documento_id ?? null, criterio: antes?.criterio ?? null, decisao: antes?.decisao ?? null, motivo: antes?.motivo ?? null,
        decidido_em: antes?.decidido_em ?? null, decidido_por: antes?.decidido_por ?? null, atualizado_em: c.agora()
      });
    }
    saida.novos++;
    if (!lida.confere) saida.nao_conferem++;
    saida.importadas.push({ id: fatura.id, competencia: lida.competencia, vencimento: lida.vencimento, confere: lida.confere, lancamentos: lida.lancamentos.length });
    await eventos.registrar(api, {
      tipo: 'cartao_fatura_importada', usuarioId, competencia: lida.competencia,
      descricao: `Fatura do cartão${lida.cartao_final ? ` final ${lida.cartao_final}` : ''} de venc. ${c.impressa(lida.vencimento)} importada: ${c.reais(lida.valor_total)}, `
        + `${c.plural(lida.lancamentos.filter(x => x.tipo === 'compra').length, 'compra', 'compras')}${lida.confere ? ' · as contas fecham' : ` · NÃO FECHA: ${lida.conferencias.filter(x => !x.ok).map(x => x.rotulo).join('; ')}`}`
        + `${anterior ? ' · substituiu a fatura anterior do mesmo vencimento' : ''}`,
      dados: { fatura_id: fatura.id, confere: lida.confere }
    });
  }
  const meses = [...new Set(saida.importadas.flatMap(x => [x.competencia, c.competenciaDe(somarDias(x.vencimento, JANELA_PAGAMENTO.depois))]))];
  const r = saida.novos ? await conferir(api, { competencias: meses, usuarioId }) : { herdadas: 0, ligadas: 0, pagamentos: 0, falhas: [] };
  const partes = [c.plural(saida.lidos, 'fatura lida', 'faturas lidas')];
  if (saida.novos) partes.push(c.plural(saida.novos, 'importada', 'importadas'));
  if (saida.repetidos) partes.push(`${c.plural(saida.repetidos, 'já estava', 'já estavam')} no app`);
  if (saida.substituidos) partes.push(c.plural(saida.substituidos, 'substituiu a do mesmo vencimento', 'substituíram as do mesmo vencimento'));
  if (saida.nao_conferem) partes.push(`${c.plural(saida.nao_conferem, 'não fecha', 'não fecham')} (veja as conferências)`);
  if (r.ligadas) partes.push(c.plural(r.ligadas, 'nota ligada sozinha', 'notas ligadas sozinhas'));
  if (r.herdadas) partes.push(c.plural(r.herdadas, 'parcela com a nota da anterior', 'parcelas com a nota da anterior'));
  if (r.pagamentos) partes.push(c.plural(r.pagamentos, 'pagamento conciliado no extrato', 'pagamentos conciliados no extrato'));
  return { ...saida, ligadas: r.ligadas, herdadas: r.herdadas, pagamentos: r.pagamentos, falhas: [...saida.falhas, ...r.falhas], resumo: partes.join(' · ') };
}

/** A compra (com a fatura dela) para decidir; o mês da fatura tem de estar aberto. */
async function compraParaDecidir(api, id, oQue) {
  if ((await lerFaturas(api)) === null) throw c.erro(b.SQL_FALTANDO_FASE_G, 409, { sql_pendente: true, sql_arquivo: b.SQL_ARQUIVO_FASE_G });
  const x = (await b.lerOpcional(api, COMPRAS, { id: Number(id) }) || [])[0];
  if (!x) throw c.erro('Compra não encontrada.', 404);
  const compra = normalizarCompra(x);
  if (compra.tipo !== 'compra') throw c.erro('Só a compra precisa de nota (pagamento, crédito e encargo não).', 422);
  const f = (await b.lerOpcional(api, FATURAS, { id: compra.fatura_id }) || []).map(normalizarFatura)[0];
  if (!f || !valendo(f)) throw c.erro('Esta fatura foi substituída: use a mais nova.', 409);
  await b.garantirAberta(api, f.competencia, oQue);
  const irmas = ((await b.lerOpcional(api, COMPRAS)) || []).map(normalizarCompra).filter(y => chaveDaCompra(y) === chaveDaCompra(compra));
  return { compra, fatura: f, irmas: irmas.length ? irmas : [compra] };
}

/** Ligar a nota escolhida (vale para todas as parcelas da compra). */
async function ligarNota(api, id, { documentoId, usuarioId = null }) {
  if (!/^\d+$/.test(String(documentoId ?? ''))) throw c.erro('Escolha a nota.');
  const { compra, fatura, irmas } = await compraParaDecidir(api, id, 'ligar a nota da compra');
  const d = (await b.lerOpcional(api, 'documentos_recebidos', { id: Number(documentoId) }) || [])[0];
  if (!d || d.excluido_em) throw c.erro('Nota não encontrada.', 404);
  if (!documentoServe(d)) throw c.erro('Este documento não serve como a nota da compra (é de um fechamento, "sem pagamento" ou sem valor).', 422);
  const outra = ((await b.lerOpcional(api, COMPRAS, { documento_id: Number(documentoId) })) || []).map(normalizarCompra).find(y => chaveDaCompra(y) !== chaveDaCompra(compra));
  if (outra) throw c.erro(`Esta nota já é a de outra compra (${outra.descricao}, ${c.impressa(outra.data)}).`, 409);
  for (const y of irmas) {
    await b.atualizar(api, COMPRAS, y.id, { documento_id: Number(documentoId), criterio: y.id === compra.id ? 'escolhido' : 'parcela', decisao: null, motivo: null, decidido_em: c.agora(), decidido_por: usuarioId, atualizado_em: c.agora() });
  }
  const contas = ((await b.lerOpcional(api, 'titulos_pagar', { documento_recebido_id: Number(documentoId) })) || []).filter(t => t && t.status !== 'cancelado');
  await eventos.registrar(api, {
    tipo: 'cartao_nota_ligada', usuarioId, competencia: fatura.competencia,
    descricao: `Compra no cartão de ${compra.descricao} (${c.reais(compra.valor_compra)}, ${c.impressa(compra.data)}) ligada à nota ${d.numero ? `nº ${d.numero} ` : ''}de ${d.emitente_nome || 'emitente'} (${CRITERIOS.escolhido})`,
    dados: { compra_id: compra.id, documento_id: Number(documentoId), parcelas: irmas.length }
  });
  const aviso = contas.length ? `A nota tem ${c.plural(contas.length, 'conta a pagar', 'contas a pagar')} lançada${contas.length > 1 ? 's' : ''} (${contas.map(t => t.descricao).join(', ')}): ela foi paga no cartão — cancele a conta em Contas a pagar.` : null;
  return { id: compra.id, documento_id: Number(documentoId), parcelas: irmas.length, aviso };
}

/** "Sem nota", com o motivo (vale para todas as parcelas da compra). */
async function semNota(api, id, { motivo, usuarioId = null }) {
  const texto = c.texto(motivo, 500);
  if (texto.length < 5) throw c.erro('Diga por que a compra não tem nota (ao menos 5 letras).');
  const { compra, fatura, irmas } = await compraParaDecidir(api, id, 'decidir a compra sem nota');
  for (const y of irmas) {
    await b.atualizar(api, COMPRAS, y.id, { documento_id: null, criterio: null, decisao: 'sem_nota', motivo: texto, decidido_em: c.agora(), decidido_por: usuarioId, atualizado_em: c.agora() });
  }
  await eventos.registrar(api, {
    tipo: 'cartao_sem_nota', usuarioId, competencia: fatura.competencia,
    descricao: `Compra no cartão de ${compra.descricao} (${c.reais(compra.valor_compra)}, ${c.impressa(compra.data)}) fica sem nota: ${texto}`, dados: { compra_id: compra.id }
  });
  return { id: compra.id, decisao: 'sem_nota', parcelas: irmas.length };
}

/** Desfaz a nota ou o "sem nota" (de todas as parcelas da compra). */
async function desfazer(api, id, { usuarioId = null } = {}) {
  const { compra, fatura, irmas } = await compraParaDecidir(api, id, 'desfazer a decisão da compra');
  if (!irmas.some(y => y.documento_id || y.decisao)) throw c.erro('Esta compra não tem nota ligada nem decisão.', 409);
  for (const y of irmas) {
    await b.atualizar(api, COMPRAS, y.id, { documento_id: null, criterio: null, decisao: null, motivo: null, decidido_em: c.agora(), decidido_por: usuarioId, atualizado_em: c.agora() });
  }
  await eventos.registrar(api, {
    tipo: 'cartao_desfeito', usuarioId, competencia: fatura.competencia,
    descricao: `Compra no cartão de ${compra.descricao} (${c.reais(compra.valor_compra)}, ${c.impressa(compra.data)}): a nota (ou o "sem nota") foi desfeita`, dados: { compra_id: compra.id }
  });
  return { id: compra.id };
}

// ------------------------------------------------------------------ tela

function notaPublica(d) {
  if (!d) return null;
  const documentos = require('../documentosRecebidos');
  return {
    id: Number(d.id), rotulo: documentos.rotuloDoDocumento(d), emitente: d.emitente_nome || null, emitente_documento: b.documentoFormatado(d.emitente_documento) || null,
    data_emissao: c.dia(d.data_emissao), valor_total: c.centavos(d.valor_total), competencia: d.competencia || null
  };
}

async function listar(api, { competencia }) {
  const comp = c.competenciaValida(competencia) ? String(competencia) : null;
  if (!comp) throw c.erro('Informe a competência (AAAA-MM).');
  const dados = await lerTudo(api);
  if (!dados) return { sql_pendente: true, sql_arquivo: b.SQL_ARQUIVO_FASE_G, competencia: comp, faturas: [], situacoes: SITUACOES, visoes: VISOES };
  const docs = new Map(dados.documentos.map(d => [String(d.id), d]));
  const movs = new Map(((await b.lerOpcional(api, 'movimentos_bancarios').catch(() => null)) || []).filter(m => m && dados.vinculos.some(v => String(v.movimento_id) === String(m.id))).map(m => [String(m.id), m]));
  const faturas = dados.faturas.filter(f => valendo(f) && f.competencia === comp).sort((x, y) => x.vencimento.localeCompare(y.vencimento)).map(f => {
    const compras = dados.compras.filter(x => x.fatura_id === f.id).sort((x, y) => x.ordem - y.ordem).map(x => {
      const situacao = situacaoDaCompra(x, { limite: dados.config.limite, inicio: dados.inicio, comRecibo: dados.comRecibo.has(String(x.id)) });
      return {
        id: x.id, ordem: x.ordem, tipo: x.tipo, tipo_rotulo: TIPOS[x.tipo] || x.tipo, secao: x.secao, data: x.data, descricao: x.descricao, cidade: x.cidade, valor: x.valor,
        parcela: x.parcela_total ? `${String(x.parcela_numero).padStart(2, '0')}/${String(x.parcela_total).padStart(2, '0')}` : null, valor_compra: x.valor_compra,
        situacao, situacao_rotulo: SITUACOES[situacao], criterio_rotulo: x.criterio ? CRITERIOS[x.criterio] || x.criterio : null, motivo: x.motivo || null,
        nota: notaPublica(x.documento_id ? docs.get(String(x.documento_id)) : null), com_recibo: dados.comRecibo.has(String(x.id)),
        sugestoes: ['pendente', 'anterior'].includes(situacao)
          ? (dados.sugestoes.get(x.id) || []).slice(0, 6).map(k => ({ ...notaPublica(k.documento), motivos: k.motivos, com_conta: k.com_conta }))
          : []
      };
    });
    const pg = pagamentoDaFatura(f, dados.vinculos);
    const conta = sit => compras.filter(x => x.situacao === sit).length;
    return {
      id: f.id, cartao_final: f.cartao_final, titular: f.titular, vencimento: f.vencimento, competencia: f.competencia, valor_total: f.valor_total, valor_minimo: f.valor_minimo,
      saldo_anterior: f.saldo_anterior, nome_arquivo: f.nome_arquivo, conferencias: f.conferencias, confere: f.confere,
      pagamento: { pago: pg.pago, restante: pg.restante, movimentos: pg.movimentos.map(id => movs.get(String(id))).filter(Boolean).map(m => ({ id: Number(m.id), data: c.dia(m.data), valor: c.centavos(m.valor), descricao: m.descricao || null })) },
      contagem: {
        compras: compras.filter(x => x.tipo === 'compra').length, com_nota: conta('com_nota') + conta('com_recibo'), sem_nota: conta('sem_nota'), abaixo_do_limite: conta('abaixo_do_limite'),
        anteriores: conta('anterior'), pendentes: conta('pendente'), valor_compras: c.centavos(compras.filter(x => x.tipo === 'compra').reduce((s, x) => s + x.valor, 0))
      },
      compras
    };
  });
  return { sql_pendente: false, competencia: comp, config: dados.config, inicio: dados.inicio, faturas, situacoes: SITUACOES, visoes: VISOES };
}

/** Os documentos ligados às compras do cartão (saem de "documento sem conta a pagar" e das obrigações). Pura. */
const documentosNoCartao = compras => new Set(c.lista(compras).filter(x => x && x.documento_id !== null && x.documento_id !== undefined).map(x => String(x.documento_id)));

module.exports = {
  FATURAS, COMPRAS, TIPOS, SITUACOES, CRITERIOS, VISOES, JANELA_NOTA, JANELA_PAGAMENTO,
  normalizarFatura, normalizarCompra, chaveDaCompra, palavraChave, situacaoDaCompra, documentoServe, candidatos, casarNotas, herdarParcelas, pagamentoDaFatura, pendencias,
  documentosNoCartao, config, lerTudo, casarSozinho, conciliarSozinho, conferir, importar, ligarNota, semNota, desfazer, listar
};
