/**
 * Fase F (02/10/2026) — o que a empresa pagou em nome de OUTRA empresa (a
 * Artdeco). Resposta do dono: o boleto em que o pagador é a Artdeco e que a
 * Santíssimo pagou é conta A RECEBER da Artdeco (reembolso), não despesa; o
 * Pix que a Artdeco manda abate.
 *
 *   criarSozinhos ... cada comprovante do BB (fase D) ligado ao débito do
 *                     extrato cujo PAGADOR é outra empresa (CPF/CNPJ inteiro,
 *                     diferente do da empresa) vira um item a receber dela, e
 *                     o débito fica conciliado com ele (critério "terceiro");
 *   receberSozinho .. o crédito do terceiro (o CPF/CNPJ dele no lançamento ou
 *                     o nome na descrição do banco) liga ao item de mesmo
 *                     valor, ou a todos os em aberto quando a soma bate;
 *   criar/cancelar .. à mão: um débito que é de terceiro sem comprovante; o
 *                     item lançado por engano (solta o débito);
 *   listar .......... por terceiro: cada item, o débito, o que voltou, o saldo;
 *   pendências ...... (pura) o saldo a receber de cada terceiro e o item sem o
 *                     débito conciliado — avisos.
 *
 * O que voltou é a conciliação que diz (vínculos "terceiro_devolvido"). A
 * classificação usa a regra de origem "terceiro" (a conta do plano é da AEA:
 * pendência 68).
 */
const c = require('../../financeiro/comum');
const b = require('../base');
const eventos = require('../eventos');

const TABELA = 'contabil_terceiros_itens';
const SITUACOES = { aberto: 'A receber', quitado: 'Recebido', cancelado: 'Cancelado' };
const VISOES = { abertos: 'A receber', mes: 'Do mês', todos: 'Todos' };
const TIPOS_VINCULO = new Set(['terceiro_pago', 'terceiro_devolvido']);
/** Palavras que não servem para achar o terceiro na descrição do banco. */
const GENERICAS = new Set(['LTDA', 'EIRELI', 'EPP', 'CIA', 'COMERCIO', 'INDUSTRIA', 'SERVICOS', 'EMPRESA', 'BANCO', 'BRASIL', 'MINAS', 'GERAIS', 'PIX', 'RECEBIDO', 'ENVIADO']);

const cent = v => Math.round(Math.abs(Number(v) || 0) * 100);
const docCheio = v => (/^\d{11}$|^\d{14}$/.test(b.digitos(v)) ? b.digitos(v) : null);
const norm = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const lerTodos = api => b.lerOpcional(api, TABELA);

/** A palavra do nome que acha o terceiro na descrição do banco ("ARTDECO MOVEIS LTDA" → "ARTDECO"). Pura. */
function palavraChave(nome) {
  return norm(nome).split(' ').find(p => p.length >= 4 && !GENERICAS.has(p)) || null;
}

/** O item a receber que um comprovante do BB gera (o pagador é outra empresa), ou null. Pura. */
function itemDoComprovante(cp, empresaDoc) {
  if (!cp || cp.situacao !== 'ligado' || !cp.movimento_id) return null;
  const doc = docCheio(cp.pagador_documento);
  const empresa = b.digitos(empresaDoc);
  if (!doc || !empresa || doc === empresa) return null;
  const nome = String(cp.pagador_nome || '').trim() || b.documentoFormatado(doc);
  const oQue = cp.tipo === 'boleto' ? 'Boleto' : cp.tipo === 'convenio' ? 'Conta/guia' : 'Pagamento';
  return {
    terceiro_nome: nome.slice(0, 200), terceiro_documento: doc, data: c.dia(cp.data), valor: c.centavos(cp.valor),
    competencia: String(c.dia(cp.data) || '').slice(0, 7), movimento_id: Number(cp.movimento_id), comprovante_id: Number(cp.id), origem: 'comprovante',
    descricao: `${oQue} de ${cp.favorecido_nome || 'favorecido'} pago pela empresa em nome de ${nome}`.slice(0, 300)
  };
}

/** O que voltou e o que falta de um item (os vínculos valendo da conciliação). Pura. */
function situacaoDoItem(item, vinculos = []) {
  const meus = c.lista(vinculos).filter(v => v && !v.desfeito_em && String(v.alvo_id) === String(item.id));
  const devolvido = c.centavos(meus.filter(v => v.alvo_tipo === 'terceiro_devolvido').reduce((s, v) => s + Number(v.valor || 0), 0));
  const restante = c.centavos(Math.max(0, Number(item.valor) - devolvido));
  const situacao = item.situacao === 'cancelado' ? 'cancelado' : (restante <= 0.009 ? 'quitado' : 'aberto');
  return { devolvido, restante, situacao, debito_ligado: meus.some(v => v.alvo_tipo === 'terceiro_pago') };
}

const normalizar = i => ({ ...i, id: Number(i.id), data: c.dia(i.data), valor: c.centavos(i.valor), competencia: String(i.competencia || '').trim() });

/** Tudo numa leitura (null sem o SQL da fase F). */
async function lerTudo(api) {
  const itens = await lerTodos(api);
  if (itens === null) return null;
  const vinculos = ((await b.lerOpcional(api, 'conciliacao_vinculos').catch(() => null)) || []).filter(v => v && !v.desfeito_em && TIPOS_VINCULO.has(v.alvo_tipo));
  return { itens: itens.filter(Boolean).map(normalizar), vinculos };
}

/** A chave do terceiro (o CPF/CNPJ; sem ele, o nome). Pura. */
const chaveDoTerceiro = i => (i.terceiro_documento ? `doc:${i.terceiro_documento}` : `nome:${norm(i.terceiro_nome)}`);

/**
 * As pendências do mês (fonte das contas a pagar), avisos: o saldo a receber
 * de cada terceiro e os itens do mês sem o débito conciliado. Pura.
 */
function pendencias({ competencia, dados }) {
  if (!dados) return [];
  const fim = b.ultimoDia(competencia);
  const saida = [];
  const grupos = new Map();
  for (const i of dados.itens.filter(x => x.situacao !== 'cancelado' && x.data <= fim)) {
    const s = situacaoDoItem(i, dados.vinculos);
    if (s.restante <= 0.009) continue;
    const k = chaveDoTerceiro(i);
    const g = grupos.get(k) || { nome: i.terceiro_nome, documento: i.terceiro_documento, total: 0, itens: 0, desde: i.data };
    g.total = c.centavos(g.total + s.restante);
    g.itens++;
    if (i.data < g.desde) g.desde = i.data;
    grupos.set(k, g);
  }
  for (const [k, g] of grupos) {
    saida.push({
      nivel: 'aviso', chave: `terceiro_saldo_${k.replace(/[^a-z0-9]+/gi, '_').slice(0, 60)}`, titulo: `${g.nome} deve ${c.reais(g.total)} à empresa`,
      descricao: `${c.plural(g.itens, 'pagamento feito', 'pagamentos feitos')} em nome dela${g.documento ? ` (${b.documentoFormatado(g.documento)})` : ''} desde ${c.impressa(g.desde)} · o Pix que ela mandar liga sozinho; confira em Terceiros`,
      data: g.desde, acao: 'Ver', filtro: { acao: 'terceiros' }
    });
  }
  const semDebito = dados.itens.filter(i => i.situacao !== 'cancelado' && i.competencia === competencia && !situacaoDoItem(i, dados.vinculos).debito_ligado);
  if (semDebito.length) {
    saida.push({
      nivel: 'aviso', chave: 'terceiros_sem_debito', titulo: `${c.plural(semDebito.length, 'pagamento de terceiro', 'pagamentos de terceiros')} sem o débito do extrato conciliado`,
      descricao: 'O débito já estava conciliado com outra coisa (ou ainda não chegou): confira em Terceiros', data: semDebito[0].data, acao: 'Ver', filtro: { acao: 'terceiros' }
    });
  }
  return saida;
}

// ------------------------------------------------------------------ gravação

/** Concilia um lançamento com itens (débito: o pago; crédito: o devolvido). */
async function ligar(api, m, itens, { tipo, usuarioId = null, detalhe }) {
  const conciliacao = require('../conciliacao/conciliacao');
  return conciliacao.gravar(api, m, itens.map(i => ({ tipo, id: i.id, restante: i.parte })), { criterio: 'terceiro', detalhe, usuarioId });
}

const empresaDoc = async api => b.digitos((await require('../../fiscal/configuracaoFiscal').carregar(api).catch(() => null))?.cnpj);

/** Os comprovantes de pagamento feitos em nome de outra empresa viram itens a receber (e o débito fica conciliado). */
async function criarSozinhos(api, { usuarioId = null } = {}) {
  const saida = { criados: 0, ligados: 0, meses: new Set(), falhas: [] };
  const itens = await lerTodos(api);
  if (itens === null) return { ...saida, meses: [] };
  const cps = ((await b.lerOpcional(api, 'contabil_comprovantes').catch(() => null)) || []).filter(x => x && x.situacao === 'ligado' && x.movimento_id);
  if (!cps.length) return { ...saida, meses: [] };
  const empresa = await empresaDoc(api);
  const jaTem = new Set(itens.filter(i => i && i.comprovante_id).map(i => String(i.comprovante_id)));
  for (const cp of cps) {
    if (jaTem.has(String(cp.id))) continue;
    const novo = itemDoComprovante(cp, empresa);
    if (!novo) continue;
    try {
      if (((await b.lerOpcional(api, 'competencia_contabil', { competencia: novo.competencia })) || [])[0]?.status === 'fechada') continue;
      const item = await b.inserir(api, TABELA, { ...novo, situacao: 'aberto', criado_em: c.agora(), criado_por: usuarioId, atualizado_em: c.agora() });
      jaTem.add(String(cp.id));
      saida.criados++;
      saida.meses.add(novo.competencia);
      await eventos.registrar(api, {
        tipo: 'terceiro_lancado', usuarioId, competencia: novo.competencia,
        descricao: `${novo.descricao}: ${c.reais(novo.valor)} em ${c.impressa(novo.data)} — a receber de ${novo.terceiro_nome} (pelo comprovante do BB)`,
        dados: { item_id: item.id, comprovante_id: cp.id, movimento_id: novo.movimento_id }
      });
      const m = (await b.ler(api, 'movimentos_bancarios', { id: Number(novo.movimento_id) }))[0] || null;
      if (m && (m.estado_conciliacao || 'pendente') === 'pendente' && Number(m.valor) < 0) {
        await ligar(api, m, [{ id: item.id, parte: Math.abs(Number(m.valor)) }], { tipo: 'terceiro_pago', usuarioId, detalhe: `Pago em nome de ${novo.terceiro_nome} (a receber), pelo comprovante do BB` });
        saida.ligados++;
      }
    } catch (e) {
      saida.falhas.push(`${novo.terceiro_nome} ${c.impressa(novo.data)}: ${e.message}`);
    }
  }
  return { ...saida, meses: [...saida.meses].sort() };
}

/** O crédito que veio do terceiro: o CPF/CNPJ dele no lançamento ou o nome na descrição do banco. Pura. */
function ehDoTerceiro(m, item) {
  const doc = item.terceiro_documento;
  if (doc && (b.digitos(m.contrapartida_documento) === doc || b.digitos(m.descricao).includes(doc))) return true;
  const chave = palavraChave(item.terceiro_nome);
  return Boolean(chave) && ` ${norm(m.descricao)} `.includes(` ${chave} `);
}

/**
 * Os créditos do mês que são devolução de um terceiro: ligam ao item de mesmo
 * valor (um só) ou a todos os em aberto do terceiro quando a soma bate. Pura
 * (sobre o que foi lido): devolve `[{ movimento, itens: [{ id, parte }] }]`.
 */
function devolucoes({ itens = [], vinculos = [], movimentos = [] }) {
  const abertos = itens.filter(i => i.situacao !== 'cancelado').map(i => ({ ...i, ...situacaoDoItem(i, vinculos) })).filter(i => i.restante > 0.009);
  const saida = [];
  const usados = new Set();
  for (const m of c.lista(movimentos).filter(x => Number(x.valor) > 0 && (x.estado_conciliacao || 'pendente') === 'pendente').sort((x, y) => String(c.dia(x.data)).localeCompare(String(c.dia(y.data))))) {
    const terceiros = new Set(abertos.filter(i => ehDoTerceiro(m, i)).map(chaveDoTerceiro));
    if (terceiros.size !== 1) continue;
    const doTerceiro = abertos.filter(i => terceiros.has(chaveDoTerceiro(i)) && !usados.has(i.id) && i.data <= c.dia(m.data));
    const mesmos = doTerceiro.filter(i => cent(i.restante) === cent(m.valor));
    let escolhidos = null;
    if (mesmos.length === 1) escolhidos = mesmos;
    else if (!mesmos.length && doTerceiro.length > 1 && cent(doTerceiro.reduce((s, i) => s + i.restante, 0)) === cent(m.valor)) escolhidos = doTerceiro;
    if (!escolhidos) continue;
    escolhidos.forEach(i => usados.add(i.id));
    saida.push({ movimento: m, itens: escolhidos.map(i => ({ id: i.id, parte: i.restante, nome: i.terceiro_nome })) });
  }
  return saida;
}

/** Liga sozinho as devoluções dos meses (créditos a conciliar). */
async function receberSozinho(api, { competencias = [], usuarioId = null } = {}) {
  const saida = { recebidos: 0, meses: new Set(), falhas: [] };
  const dados = await lerTudo(api);
  if (!dados || !dados.itens.length) return { ...saida, meses: [] };
  for (const comp of [...new Set(c.lista(competencias))].filter(x => c.competenciaValida(x)).sort()) {
    if (((await b.lerOpcional(api, 'competencia_contabil', { competencia: comp })) || [])[0]?.status === 'fechada') continue;
    const movimentos = (await b.lerOpcional(api, 'movimentos_bancarios', { competencia: comp })) || [];
    for (const d of devolucoes({ itens: dados.itens, vinculos: dados.vinculos, movimentos })) {
      try {
        const gravados = await ligar(api, d.movimento, d.itens, { tipo: 'terceiro_devolvido', usuarioId, detalhe: `${d.itens[0].nome} devolveu o que a empresa pagou em nome dela` });
        dados.vinculos.push(...gravados);
        saida.recebidos++;
        saida.meses.add(comp);
      } catch (e) {
        saida.falhas.push(`${d.itens[0].nome} ${c.impressa(c.dia(d.movimento.data))}: ${e.message}`);
      }
    }
  }
  if (saida.recebidos) {
    await eventos.registrar(api, {
      tipo: 'terceiro_recebido', usuarioId, competencia: [...saida.meses][0] || null,
      descricao: `${c.plural(saida.recebidos, 'devolução de terceiro ligada', 'devoluções de terceiros ligadas')} pela conciliação`, dados: { recebidos: saida.recebidos }
    });
  }
  return { ...saida, meses: [...saida.meses].sort() };
}

/** Os dois de uma vez (o que a conciliação automática chama). */
async function conferir(api, { competencias = [], usuarioId = null } = {}) {
  const a = await criarSozinhos(api, { usuarioId });
  const r = await receberSozinho(api, { competencias: [...new Set([...c.lista(competencias), ...a.meses])], usuarioId });
  return { criados: a.criados, ligados: a.ligados, recebidos: r.recebidos, falhas: [...a.falhas, ...r.falhas] };
}

/** À mão: um débito que é de terceiro (sem comprovante). O débito fica conciliado com o item. */
async function criar(api, { movimentoId, terceiroNome, terceiroDocumento = null, descricao = null, usuarioId = null }) {
  if ((await lerTodos(api)) === null) throw c.erro(b.SQL_FALTANDO_FASE_F, 409, { sql_pendente: true, sql_arquivo: b.SQL_ARQUIVO_FASE_F });
  const nome = c.texto(terceiroNome, 200);
  if (nome.length < 3) throw c.erro('Diga em nome de quem foi pago (a empresa ou a pessoa).');
  const doc = terceiroDocumento ? docCheio(terceiroDocumento) : null;
  if (terceiroDocumento && !doc) throw c.erro('O CPF/CNPJ do terceiro está incompleto.');
  if (doc && doc === await empresaDoc(api)) throw c.erro('Esse é o CNPJ da própria empresa.');
  const m = (await b.ler(api, 'movimentos_bancarios', { id: Number(movimentoId) }))[0] || null;
  if (!m) throw c.erro('Escolha o débito do extrato.', 404);
  if (!(Number(m.valor) < 0)) throw c.erro('O pagamento em nome do terceiro é um débito do extrato.', 422);
  if ((m.estado_conciliacao || 'pendente') !== 'pendente') throw c.erro('Este débito já está conciliado (ou ignorado): desfaça na Conciliação antes.', 409);
  await b.garantirAberta(api, m.competencia, 'lançar o pagamento do terceiro');
  const item = await b.inserir(api, TABELA, {
    terceiro_nome: nome, terceiro_documento: doc, descricao: c.texto(descricao, 300) || `${m.descricao || 'Pagamento'} — em nome de ${nome}`.slice(0, 300),
    data: c.dia(m.data), valor: c.centavos(Math.abs(Number(m.valor))), competencia: String(m.competencia || c.dia(m.data).slice(0, 7)),
    movimento_id: Number(m.id), origem: 'manual', situacao: 'aberto', criado_em: c.agora(), criado_por: usuarioId, atualizado_em: c.agora()
  });
  await ligar(api, m, [{ id: item.id, parte: Math.abs(Number(m.valor)) }], { tipo: 'terceiro_pago', usuarioId, detalhe: `Pago em nome de ${nome} (a receber), lançado à mão` });
  await eventos.registrar(api, {
    tipo: 'terceiro_lancado', usuarioId, competencia: m.competencia,
    descricao: `Débito de ${c.impressa(c.dia(m.data))} (${c.reais(Math.abs(Number(m.valor)))}) lançado como pago em nome de ${nome} — a receber`, dados: { item_id: item.id, movimento_id: m.id }
  });
  return { id: item.id, competencia: m.competencia };
}

/** O item lançado por engano: sai e solta o débito (que volta a ficar a conciliar). Com devolução ligada, não. */
async function cancelar(api, id, { motivo, usuarioId = null }) {
  const texto = c.texto(motivo, 500);
  if (texto.length < 5) throw c.erro('Diga por que o item sai (ao menos 5 letras).');
  const dados = await lerTudo(api);
  if (!dados) throw c.erro(b.SQL_FALTANDO_FASE_F, 409, { sql_pendente: true, sql_arquivo: b.SQL_ARQUIVO_FASE_F });
  const item = dados.itens.find(i => String(i.id) === String(id));
  if (!item) throw c.erro('Item não encontrado.', 404);
  if (item.situacao === 'cancelado') throw c.erro('Este item já está cancelado.', 409);
  if (situacaoDoItem(item, dados.vinculos).devolvido > 0) throw c.erro('O terceiro já devolveu parte: desfaça a devolução na Conciliação antes.', 409);
  await b.garantirAberta(api, item.competencia, 'cancelar o item');
  for (const v of dados.vinculos.filter(x => x.alvo_tipo === 'terceiro_pago' && String(x.alvo_id) === String(item.id))) {
    await b.atualizar(api, 'conciliacao_vinculos', v.id, { desfeito_em: c.agora(), desfeito_por: usuarioId, motivo_desfazer: `Item de terceiro cancelado: ${texto}`.slice(0, 500) });
    const outros = ((await b.lerOpcional(api, 'conciliacao_vinculos', { movimento_id: Number(v.movimento_id) })) || []).filter(x => x && !x.desfeito_em && String(x.id) !== String(v.id));
    if (!outros.length) await b.atualizar(api, 'movimentos_bancarios', v.movimento_id, { estado_conciliacao: 'pendente', conciliado_em: null, conciliado_por: null, conciliacao_observacao: null, conciliacao_diferenca: null });
  }
  await b.atualizar(api, TABELA, item.id, { situacao: 'cancelado', motivo: texto, cancelado_em: c.agora(), cancelado_por: usuarioId, atualizado_em: c.agora() });
  await eventos.registrar(api, {
    tipo: 'terceiro_cancelado', usuarioId, competencia: item.competencia,
    descricao: `Item de ${item.terceiro_nome} (${c.reais(item.valor)}, ${c.impressa(item.data)}) cancelado: ${texto}`, dados: { item_id: item.id }
  });
  return { id: item.id, situacao: 'cancelado' };
}

// ------------------------------------------------------------------ tela

const movPublico = m => (m ? { id: Number(m.id), data: c.dia(m.data), valor: c.centavos(m.valor), descricao: m.descricao || null, estado: m.estado_conciliacao || 'pendente' } : null);

async function listar(api, { competencia = null, visao = 'abertos' } = {}) {
  const v = VISOES[visao] ? visao : 'abertos';
  const dados = await lerTudo(api);
  if (!dados) return { sql_pendente: true, sql_arquivo: b.SQL_ARQUIVO_FASE_F, visao: v, visoes: VISOES, terceiros: [], totais: null };
  const comp = c.competenciaValida(competencia) ? String(competencia) : null;
  const ids = new Set([...dados.itens.map(i => String(i.movimento_id)), ...dados.vinculos.map(x => String(x.movimento_id))]);
  const movs = new Map(((await b.lerOpcional(api, 'movimentos_bancarios').catch(() => null)) || []).filter(m => m && ids.has(String(m.id))).map(m => [String(m.id), m]));
  const cps = new Map(((await b.lerOpcional(api, 'contabil_comprovantes').catch(() => null)) || []).filter(Boolean).map(x => [String(x.id), x]));
  const linhas = dados.itens.map(i => {
    const s = situacaoDoItem(i, dados.vinculos);
    const meus = dados.vinculos.filter(x => String(x.alvo_id) === String(i.id));
    const cp = i.comprovante_id ? cps.get(String(i.comprovante_id)) || null : null;
    return {
      id: i.id, chave_terceiro: chaveDoTerceiro(i), terceiro_nome: i.terceiro_nome, terceiro_documento: b.documentoFormatado(i.terceiro_documento) || null,
      data: i.data, competencia: i.competencia, descricao: i.descricao, valor: i.valor, devolvido: s.devolvido, restante: s.restante, situacao: s.situacao, situacao_rotulo: SITUACOES[s.situacao],
      origem: i.origem, motivo: i.motivo || null, comprovante: cp ? { id: Number(cp.id), nome_arquivo: cp.nome_arquivo || null } : null,
      debito: movPublico(movs.get(String(i.movimento_id))), debito_ligado: s.debito_ligado,
      recebimentos: meus.filter(x => x.alvo_tipo === 'terceiro_devolvido').map(x => ({ valor: c.centavos(x.valor), movimento: movPublico(movs.get(String(x.movimento_id))) }))
    };
  }).filter(l => (v === 'abertos' ? l.situacao === 'aberto' : v === 'mes' ? (!comp || l.competencia === comp) : true))
    .sort((x, y) => x.data.localeCompare(y.data) || x.id - y.id);
  const grupos = new Map();
  for (const l of linhas) {
    const g = grupos.get(l.chave_terceiro) || { chave: l.chave_terceiro, nome: l.terceiro_nome, documento: l.terceiro_documento, itens: [], pago: 0, devolvido: 0, saldo: 0 };
    g.itens.push(l);
    if (l.situacao !== 'cancelado') {
      g.pago = c.centavos(g.pago + l.valor);
      g.devolvido = c.centavos(g.devolvido + l.devolvido);
      g.saldo = c.centavos(g.saldo + l.restante);
    }
    grupos.set(l.chave_terceiro, g);
  }
  const terceiros = [...grupos.values()].sort((x, y) => y.saldo - x.saldo || x.nome.localeCompare(y.nome, 'pt-BR'));
  return {
    sql_pendente: false, competencia: comp, visao: v, visoes: VISOES, terceiros,
    totais: { saldo: c.centavos(terceiros.reduce((s, g) => s + g.saldo, 0)), itens: linhas.filter(l => l.situacao === 'aberto').length }
  };
}

/** Os débitos a conciliar do mês (para lançar à mão um pagamento em nome de terceiro). */
async function debitosDoMes(api, { competencia }) {
  if (!c.competenciaValida(competencia)) throw c.erro('Informe a competência (AAAA-MM).');
  const movs = (await b.lerOpcional(api, 'movimentos_bancarios', { competencia: String(competencia) })) || [];
  return {
    competencia, debitos: movs.filter(m => m && Number(m.valor) < 0 && (m.estado_conciliacao || 'pendente') === 'pendente')
      .sort((x, y) => String(c.dia(x.data)).localeCompare(String(c.dia(y.data))) || Number(x.id) - Number(y.id)).map(movPublico)
  };
}

module.exports = {
  TABELA, SITUACOES, VISOES, palavraChave, itemDoComprovante, situacaoDoItem, chaveDoTerceiro, pendencias, ehDoTerceiro, devolucoes,
  lerTodos, lerTudo, criarSozinhos, receberSozinho, conferir, criar, cancelar, listar, debitosDoMes
};
