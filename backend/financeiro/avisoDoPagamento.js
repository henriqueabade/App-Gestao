/**
 * Avisar no sino quem recebeu a comissão ou a produção paga (decisão do
 * dono, 02/10/2026).
 *
 * Quem recebe é um NOME, não um usuário: na comissão, o beneficiário do
 * resumo congelado no fechamento (CMS = dono do cliente, Royalty = o
 * desenhista); na produção, o colaborador do rateio. Por isso quem confirma o
 * pagamento escolhe, para cada pessoa, o usuário que fica sabendo: a tela
 * sugere o de mesmo nome, e dá para trocar por outro ou não avisar ninguém.
 *
 * Fluxo: a tela grava os pagamentos (POST /api/financeiro/pagamentos, um por
 * linha escolhida) e depois manda os ids e as escolhas para cá (POST
 * /api/financeiro/pagamentos/avisos). O valor de cada pessoa sai dos
 * pagamentos gravados, nunca da tela; quem recebe CMS e Royalty no mesmo lote
 * ganha UM aviso com as duas linhas.
 */
const c = require('./comum');
const base = require('./base');

const TIPOS_COMISSAO = { cms: 'CMS', royalty: 'Royalty' };
const LOTE_VALIDO_MS = 30 * 60 * 1000;
const semAcento = t => String(t ?? '').normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();

/** O pagamento cobre a linha? Sem pessoa e sem tipo cobre tudo (a regra de fechamentos.alvoDoPagamento). Pura. */
const cobre = (p, linha) => (!p.tipo_comissao || p.tipo_comissao === linha.tipo)
  && (!p.beneficiario || semAcento(p.beneficiario) === semAcento(linha.beneficiario));

/** O resumo congelado da comissão em uma linha por tipo de cada pessoa. Pura. */
function linhasDaComissao(resumo = []) {
  const mapa = new Map();
  for (const r of Array.isArray(resumo) ? resumo : []) {
    if (!r?.beneficiario || !TIPOS_COMISSAO[r.tipo] || !(Number(r.valor) > 0)) continue;
    const chave = `${r.tipo}|${semAcento(r.beneficiario)}`;
    const linha = mapa.get(chave) || { tipo: r.tipo, beneficiario: r.beneficiario, valor: 0 };
    linha.valor = c.centavos(linha.valor + Number(r.valor));
    mapa.set(chave, linha);
  }
  return [...mapa.values()];
}

/**
 * Quem recebeu neste lote de pagamentos, com quanto. Comissão: cada linha do
 * resumo coberta por um pagamento do lote e por nenhum pagamento anterior
 * (cada linha só se paga uma vez); produção (paga de uma vez): o rateio.
 * Devolve [{ beneficiario, linhas: [{ tipo, valor }], total }]. Pura.
 */
function recebedoresDoLote({ tipo, resumo = [], pagamentos = [], lote = [], rateio = [] }) {
  if (!lote.length) return [];
  if (tipo === 'producao') {
    return (Array.isArray(rateio) ? rateio : [])
      .filter(r => r?.colaborador && Number(r.valor) > 0)
      .map(r => ({ beneficiario: r.colaborador, linhas: [{ tipo: null, valor: c.centavos(r.valor) }], total: c.centavos(r.valor) }));
  }
  const porId = p => Number(p.id) || 0;
  const linhas = linhasDaComissao(resumo);
  const porPessoa = new Map();
  for (const p of [...lote].sort((a, b) => porId(a) - porId(b))) {
    const anteriores = pagamentos.filter(q => porId(q) < porId(p));
    for (const linha of linhas) {
      if (!cobre(p, linha) || anteriores.some(q => cobre(q, linha))) continue;
      const chave = semAcento(linha.beneficiario);
      const pessoa = porPessoa.get(chave) || { beneficiario: linha.beneficiario, linhas: [], total: 0 };
      if (pessoa.linhas.some(l => l.tipo === linha.tipo)) continue;
      pessoa.linhas.push({ tipo: linha.tipo, valor: linha.valor });
      pessoa.total = c.centavos(pessoa.total + linha.valor);
      porPessoa.set(chave, pessoa);
    }
  }
  return [...porPessoa.values()];
}

/**
 * Os avisos: um por usuário escolhido, juntando as pessoas que ele recebe.
 * `escolhas`: [{ beneficiario, usuario_id }] (sem usuário = não avisar).
 * "sua comissão" quando o usuário é a própria pessoa; o nome dela quando
 * quem paga escolheu outro usuário. Pura.
 */
function montarAvisosDoPagamento({ tipo, competencia, recebedores = [], escolhas = [], nomes = new Map(), data, forma }) {
  const porNome = new Map(recebedores.map(r => [semAcento(r.beneficiario), r]));
  const porUsuario = new Map();
  for (const e of Array.isArray(escolhas) ? escolhas : []) {
    const usuario = Number(e?.usuario_id);
    const recebedor = porNome.get(semAcento(e?.beneficiario));
    if (!recebedor || !Number.isInteger(usuario) || usuario <= 0 || !nomes.has(usuario)) continue;
    const lista = porUsuario.get(usuario) || [];
    if (!lista.includes(recebedor)) lista.push(recebedor);
    porUsuario.set(usuario, lista);
  }
  const doQue = tipo === 'comissao' ? 'comissão' : 'produção';
  const rotulo = c.rotuloCompetencia(competencia);
  const quando = `${forma ? `${forma}, ` : ''}${c.impressa(data)}`;
  return [...porUsuario.entries()].map(([usuario, lista]) => {
    const total = c.centavos(lista.reduce((s, r) => s + r.total, 0));
    const proprio = lista.length === 1 && semAcento(lista[0].beneficiario) === semAcento(nomes.get(usuario));
    const linhaDe = (r, l) => `${proprio ? '' : `${r.beneficiario} — `}${l.tipo ? `${TIPOS_COMISSAO[l.tipo]}: ` : ''}${c.reais(l.valor)}`;
    const mudancas = (proprio && lista[0].linhas.length === 1) ? [] : lista.flatMap(r => r.linhas.map(l => linhaDe(r, l)));
    return {
      usuario,
      titulo: tipo === 'comissao' ? 'Comissão paga' : 'Produção paga',
      frase: autor => (proprio
        ? `${autor} confirmou o pagamento da sua ${doQue} de ${rotulo}: ${c.reais(total)} (${quando}).`
        : `${autor} confirmou o pagamento de ${doQue} de ${rotulo}: ${c.reais(total)} (${quando}).`),
      mudancas
    };
  });
}

/** POST /api/financeiro/pagamentos/avisos { tipo, competencia, pagamento_ids, avisar }. */
async function avisar({ api, entrada = {}, usuarioId = null, hoje, desde, agora = Date.now() }) {
  const tipo = String(entrada?.tipo || '');
  if (!['comissao', 'producao'].includes(tipo)) throw c.erro('Escolha comissões ou produção.');
  const competencia = String(entrada?.competencia || '');
  if (!c.competenciaValida(competencia)) throw c.erro('Competência inválida.');
  const escolhas = (Array.isArray(entrada?.avisar) ? entrada.avisar : []).filter(e => e && e.usuario_id);
  if (!escolhas.length) return { avisados: 0 };

  const fech = await base.lerFechamentos(api);
  const f = fech.fechamentos.find(x => x.tipo === tipo && x.competencia === competencia && x.status === 'fechado');
  if (!f) throw c.erro('Esta competência não está fechada.', 409);
  const pagamentos = fech.pagamentos.filter(p => String(p.fechamento_id) === String(f.id));
  const ids = new Set((Array.isArray(entrada?.pagamento_ids) ? entrada.pagamento_ids : []).map(String));
  // Só os pagamentos que esta pessoa acabou de gravar (nada de reavisar pagamento antigo).
  const lote = pagamentos.filter(p => ids.has(String(p.id))
    && (!p.criado_por || !usuarioId || String(p.criado_por) === String(usuarioId))
    && (!p.criado_em || agora - new Date(p.criado_em).getTime() <= LOTE_VALIDO_MS));
  if (!lote.length) throw c.erro('Não há pagamento recente desta competência para avisar.', 409);

  let rateio = [];
  if (tipo === 'producao') {
    const fechamentos = require('./fechamentos');
    const rateios = require('./rateios');
    const previa = await fechamentos.previa({ api, tipo: 'producao', competencia, hoje, desde });
    rateio = (await rateios.lerVisao({ api, linhas: previa.linhas || [] })).resumo || [];
  }
  const recebedores = recebedoresDoLote({ tipo, resumo: c.jsonDe(f.por_setor, []), pagamentos, lote, rateio });
  const nomes = await require('../historicoSocial').nomesDosUsuarios(api);
  const avisos = montarAvisosDoPagamento({
    tipo, competencia, recebedores, escolhas, nomes, data: lote[0].data_pagamento, forma: lote[0].forma
  });
  const { avisarPessoa } = require('../avisosEnvolvidos');
  let avisados = 0;
  for (const a of avisos) {
    const feitos = await avisarPessoa(api, {
      para: [a.usuario], usuarioId, origem: 'financeiro', registroId: f.id,
      tipo: 'pagamento_feito', titulo: a.titulo, frase: a.frase, mudancas: a.mudancas
    });
    avisados += feitos.length;
  }
  return { avisados };
}

module.exports = { TIPOS_COMISSAO, linhasDaComissao, recebedoresDoLote, montarAvisosDoPagamento, avisar };
