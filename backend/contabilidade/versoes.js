/**
 * Versões do fechamento (etapa 7). Cada vez que a competência fecha, fica uma
 * versão (competencia_fechamentos) com:
 *   foto          os números congelados: o resultado por conta do plano, o
 *                 extrato de cada conta (com o saldo que o banco informou), a
 *                 conciliação e os números de cada fonte do checklist
 *   lancamentos   cada lançamento do extrato do mês com a conta do plano que
 *                 valia (a classificação do mês fechado passa a ser esta)
 *   pendencias    o que sobrou (documentais, avisos) e o que foi ignorado
 *   hash          sha256 dos lançamentos (duas versões iguais têm o mesmo)
 *
 * Depois de fechado, o que o sistema diz hoje pode mudar (uma NF-e cancelada,
 * uma regra nova, um recebimento estornado no Financeiro): `divergencias`
 * compara a foto com o de agora. Nada disso reescreve a versão — reabrir e
 * fechar de novo cria a próxima, e `compararVersoes` mostra o que mudou.
 *
 * Só funções puras e a leitura; quem grava é fechamento.js.
 */
const crypto = require('crypto');
const c = require('../financeiro/comum');
const b = require('./base');

const DO_RESULTADO = new Set(['receita', 'deducao', 'custo', 'despesa']);
const dm = iso => { const d = c.dia(iso); return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '—'; };

// ------------------------------------------------------------------ leitura

/** As versões de uma competência (da 1ª para a última); null sem o SQL da etapa 7. */
async function lerVersoes(api, competencia) {
  const linhas = await b.lerOpcional(api, 'competencia_fechamentos', { competencia: String(competencia) });
  if (!linhas) return null;
  return linhas.filter(v => v && v.competencia === String(competencia))
    .map(v => ({ ...v, foto: c.jsonDe(v.foto, {}), lancamentos: c.jsonDe(v.lancamentos, []), pendencias: c.jsonDe(v.pendencias, []) }))
    .sort((x, y) => Number(x.versao) - Number(y.versao));
}

const ultima = versoes => (c.lista(versoes).length ? versoes[versoes.length - 1] : null);

/** A classificação congelada de cada lançamento: Map id -> lançamento da versão. Pura. */
function congeladoDe(versao) {
  return new Map(c.lista(versao?.lancamentos).map(l => [String(l.id), l]));
}

// ------------------------------------------------------------------ a foto (puras)

/** O lançamento como fica na versão: o dado do banco e a conta do plano que valia. Pura. */
function lancamentoDaFoto(m, cls = null) {
  return {
    id: m.id, data: c.dia(m.data), valor: c.centavos(m.valor), descricao: m.descricao ? String(m.descricao).slice(0, 160) : null,
    conta_financeira_id: m.conta_id ?? null, estado_conciliacao: m.estado_conciliacao || 'pendente',
    conta_id: cls?.conta_id ?? null, conta: cls?.conta ?? null, ...(cls?.conta_codigo ? { conta_codigo: cls.conta_codigo } : {}),
    conta_tipo: cls?.conta_tipo ?? null, criterio: cls?.criterio ?? null
  };
}

/** sha256 dos lançamentos congelados (id, dia, valor, conta do banco, conta do plano). Pura. */
function hashDe(lancamentos) {
  const base = c.lista(lancamentos).map(l => [Number(l.id), l.data, c.centavos(l.valor).toFixed(2), l.conta_financeira_id ?? null, l.conta_id ?? null])
    .sort((x, y) => x[0] - y[0]);
  return crypto.createHash('sha256').update(JSON.stringify(base)).digest('hex');
}

/**
 * O resultado do mês a partir do total por conta do plano: receitas,
 * deduções, custos e despesas (com o sinal do banco), o resultado, o que não
 * é resultado (transferência, patrimônio) e o que ficou sem conta. Pura.
 */
function resultadoDe(porConta) {
  const grupos = c.lista(porConta);
  const soma = f => c.centavos(grupos.filter(f).reduce((s, g) => s + (Number(g.resultado) || 0), 0));
  return {
    receitas: soma(g => g.tipo === 'receita'),
    deducoes: soma(g => g.tipo === 'deducao'),
    custos: soma(g => g.tipo === 'custo'),
    despesas: soma(g => g.tipo === 'despesa'),
    resultado: soma(g => DO_RESULTADO.has(g.tipo)),
    fora_do_resultado: soma(g => g.conta_id && !DO_RESULTADO.has(g.tipo)),
    sem_classificacao: soma(g => !g.conta_id),
    por_conta: grupos.map(g => ({
      conta_id: g.conta_id ?? null, conta: g.conta, ...(g.conta_codigo ? { conta_codigo: g.conta_codigo } : {}), tipo: g.tipo || null,
      entradas: g.entradas, saidas: g.saidas, resultado: g.resultado, quantidade: g.quantidade
    }))
  };
}

// ------------------------------------------------------------------ comparações (puras)

const numeroDaFonte = (fontes, chave) => (c.lista(fontes).find(f => f && f.chave === chave) || {}).numeros || null;

/** Os números das fontes que a contabilidade recebe, por extenso, para comparar. Pura. */
const COMPARAVEIS = [
  ['nfe_saida', 'NF-e de saída autorizadas', n => `${n.autorizadas} · ${c.reais(n.valor_autorizado)}`],
  ['nfe_saida', 'NF-e de saída canceladas', n => String(n.canceladas)],
  ['recebimentos', 'Recebido no mês', n => `${n.recebidos} · ${c.reais(n.recebido)}`],
  ['documentos_recebidos', 'NF-e de entrada', n => `${n.nfe?.quantidade ?? 0} · ${c.reais(n.nfe?.total ?? 0)}`],
  ['documentos_recebidos', 'NFS-e', n => `${n.nfse?.quantidade ?? 0} · ${c.reais(n.nfse?.total ?? 0)}`],
  ['contas_pagar', 'Contas pagas no mês', n => `${n.pago_no_mes?.quantidade ?? 0} · ${c.reais(n.pago_no_mes?.total ?? 0)}`]
];

/**
 * O que mudou entre a versão fechada e o que o sistema diz hoje: lançamento
 * que entrou ou saiu, valor, a conta do plano que valeria hoje e os números
 * das fontes. `atual`: { lancamentos (no formato da foto, com a conta de
 * hoje), fontes (do painel) }. Pura.
 */
function divergencias(versao, atual) {
  if (!versao) return [];
  const lista = [];
  const antes = congeladoDe(versao);
  // Sem a lista de hoje (falta o SQL do extrato ou da conciliação), não compara lançamento.
  const comparaLancamentos = Array.isArray(atual?.lancamentos);
  const agora = new Map((comparaLancamentos ? atual.lancamentos : []).map(l => [String(l.id), l]));
  for (const [id, l] of agora) {
    const a = antes.get(id);
    if (!a) { lista.push({ tipo: 'lancamento_novo', titulo: `Lançamento de ${dm(l.data)} (${c.reais(l.valor)}) entrou depois do fechamento`, descricao: l.descricao || null }); continue; }
    if (c.centavos(a.valor) !== c.centavos(l.valor)) lista.push({ tipo: 'valor', titulo: `O valor do lançamento de ${dm(l.data)} mudou`, descricao: `no fechamento: ${c.reais(a.valor)}; hoje: ${c.reais(l.valor)}` });
    if (String(a.conta_id ?? '') !== String(l.conta_id ?? '')) {
      lista.push({ tipo: 'classificacao', titulo: `A conta do lançamento de ${dm(l.data)} (${c.reais(l.valor)}) seria outra hoje`, descricao: `no fechamento: ${a.conta || 'sem classificação'}; hoje: ${l.conta || 'sem classificação'}` });
    }
  }
  for (const [id, a] of antes) {
    if (comparaLancamentos && !agora.has(id)) lista.push({ tipo: 'lancamento_sumiu', titulo: `Lançamento de ${dm(a.data)} (${c.reais(a.valor)}) não está mais no extrato`, descricao: a.descricao || null });
  }
  const fontesAntes = versao.foto?.fontes || [];
  for (const [chave, rotulo, texto] of COMPARAVEIS) {
    const x = numeroDaFonte(fontesAntes, chave);
    const y = numeroDaFonte(atual?.fontes, chave);
    if (!x || !y) continue;
    const tx = texto(x);
    const ty = texto(y);
    if (tx !== ty) lista.push({ tipo: `fonte_${chave}`, titulo: `${rotulo} mudou depois do fechamento`, descricao: `no fechamento: ${tx}; hoje: ${ty}` });
  }
  return lista;
}

/**
 * Entre duas versões: o resultado por conta do plano que mudou e os
 * lançamentos que entraram, saíram ou mudaram de conta. Pura.
 */
function compararVersoes(anterior, atual) {
  if (!anterior || !atual) return null;
  const chaveConta = g => String(g.conta_id ?? 'sem');
  const porContaA = new Map(c.lista(anterior.foto?.resultado?.por_conta).map(g => [chaveConta(g), g]));
  const porContaB = new Map(c.lista(atual.foto?.resultado?.por_conta).map(g => [chaveConta(g), g]));
  const contas = [...new Set([...porContaA.keys(), ...porContaB.keys()])].map(k => {
    const x = porContaA.get(k);
    const y = porContaB.get(k);
    const antes = c.centavos(x?.resultado ?? 0);
    const depois = c.centavos(y?.resultado ?? 0);
    return { conta: (y || x).conta, antes, depois, diferenca: c.centavos(depois - antes) };
  }).filter(x => x.diferenca !== 0);
  const la = congeladoDe(anterior);
  const lb = congeladoDe(atual);
  return {
    de: Number(anterior.versao), para: Number(atual.versao), mesmo_hash: anterior.hash === atual.hash,
    resultado: { antes: c.centavos(anterior.foto?.resultado?.resultado ?? 0), depois: c.centavos(atual.foto?.resultado?.resultado ?? 0) },
    contas,
    novos: [...lb.keys()].filter(k => !la.has(k)).length,
    sairam: [...la.keys()].filter(k => !lb.has(k)).length,
    reclassificados: [...lb.entries()].filter(([k, l]) => la.has(k) && String(la.get(k).conta_id ?? '') !== String(l.conta_id ?? '')).length
  };
}

/** A versão que a tela vê (sem a lista inteira dos lançamentos). */
function publica(v, nomes = new Map()) {
  const r = v.foto?.resultado || null;
  return {
    id: v.id, versao: Number(v.versao), fechada_em: b.instanteBR(v.fechada_em), fechada_por: nomes.get(String(v.fechada_por)) || null,
    reaberta_em: b.instanteBR(v.reaberta_em), reaberta_por: nomes.get(String(v.reaberta_por)) || null, justificativa_reabertura: v.justificativa_reabertura || null,
    resultado: r, extrato: c.lista(v.foto?.extrato), conciliacao: v.foto?.conciliacao || null, contagem: v.foto?.contagem || null,
    lancamentos: c.lista(v.lancamentos).length, sem_classificacao: c.lista(v.lancamentos).filter(l => !l.conta_id).length,
    pendencias: c.lista(v.pendencias), hash: v.hash
  };
}

module.exports = {
  lerVersoes, ultima, congeladoDe, lancamentoDaFoto, hashDe, resultadoDe, divergencias, compararVersoes, publica, COMPARAVEIS
};
