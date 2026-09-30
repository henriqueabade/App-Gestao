/**
 * Plano de contas (etapa 6): as categorias da contabilidade — o "Tipo" do
 * relatório mensal. Começa com as quatro do relatório de hoje e as que o app
 * usa para classificar sozinho (sql/contabilidade_classificacao.sql); o resto
 * se cadastra na tela.
 *
 * - O tipo diz como a conta entra no resultado: receita, dedução, custo,
 *   despesa; transferência (entre contas da empresa) e patrimônio (aporte,
 *   retirada) NÃO são resultado.
 * - Não se apaga: desativa. Conta com regra ativa não desativa (a regra
 *   classificaria numa conta que não aparece).
 * - Renomear leva junto a categoria das contas a pagar (elas guardam o nome).
 */
const c = require('../../financeiro/comum');
const b = require('../base');
const eventos = require('../eventos');

const TIPOS = {
  receita: 'Receita', deducao: 'Dedução da receita', custo: 'Custo', despesa: 'Despesa',
  transferencia: 'Transferência (não é resultado)', patrimonio: 'Patrimônio (aporte, retirada)', outro: 'Outro'
};
const ORDEM = Object.keys(TIPOS);
/** Os tipos que entram no resultado do mês (receita − dedução − custo − despesa). */
const DO_RESULTADO = new Set(['receita', 'deducao', 'custo', 'despesa']);

const ativa = p => p && p.ativa !== false && p.ativa !== 'false';
/** O nome para comparar: sem acento, sem maiúscula, sem espaço sobrando ("Serviços" = "servicos"). */
const chaveNome = n => String(n ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();

function contaPublica(p, uso = null) {
  return {
    id: p.id, codigo: p.codigo || null, nome: p.nome, tipo: TIPOS[p.tipo] ? p.tipo : 'outro', tipo_rotulo: TIPOS[p.tipo] || TIPOS.outro,
    ativa: ativa(p), observacao: p.observacao || null, origem: p.origem || 'manual', do_resultado: DO_RESULTADO.has(p.tipo),
    ...(uso ? { uso } : {})
  };
}

/** Na ordem dos tipos e do nome; as desativadas no fim. Pura. */
function ordenar(contas) {
  return [...c.lista(contas)].sort((x, y) => Number(ativa(y)) - Number(ativa(x))
    || ORDEM.indexOf(x.tipo) - ORDEM.indexOf(y.tipo) || String(x.codigo || '').localeCompare(String(y.codigo || ''))
    || String(x.nome).localeCompare(String(y.nome), 'pt-BR'));
}

/** A conta conferida. Pura. */
function validarConta(entrada = {}) {
  const nome = c.texto(entrada.nome, 80);
  if (nome.length < 2) throw c.erro('Dê um nome à conta (ex.: Serviços de Terceiros).');
  return {
    nome, codigo: c.texto(entrada.codigo, 20) || null, tipo: TIPOS[entrada.tipo] ? entrada.tipo : 'despesa',
    ativa: !(entrada.ativa === false || entrada.ativa === 'false'), observacao: String(entrada.observacao ?? '').trim().slice(0, 500) || null
  };
}

const lerPlano = api => b.ler(api, 'plano_contas');

/** O plano com o uso de cada conta (contas a pagar, regras, classificações à mão). */
async function listar(api) {
  const [plano, titulos, regras, classificacoes] = await Promise.all([
    lerPlano(api), b.lerOpcional(api, 'titulos_pagar').then(x => x || []),
    b.lerOpcional(api, 'classificacao_regras').then(x => x || []), b.lerOpcional(api, 'classificacoes').then(x => x || [])
  ]);
  const uso = p => ({
    titulos: titulos.filter(t => t.status !== 'cancelado' && chaveNome(t.categoria) === chaveNome(p.nome)).length,
    regras: regras.filter(r => String(r.conta_id) === String(p.id) && r.ativa !== false && r.ativa !== 'false').length,
    classificacoes: classificacoes.filter(x => !x.substituida_em && String(x.conta_id) === String(p.id)).length
  });
  return { contas: ordenar(plano).map(p => contaPublica(p, uso(p))), tipos: TIPOS };
}

async function salvar(api, { id = null, entrada = {}, usuarioId = null }) {
  const dados = validarConta(entrada);
  const plano = await lerPlano(api);
  const atual = id ? plano.find(p => String(p.id) === String(id)) || null : null;
  if (id && !atual) throw c.erro('Conta do plano não encontrada.', 404);
  const mesmoNome = plano.find(p => chaveNome(p.nome) === chaveNome(dados.nome) && String(p.id) !== String(id));
  if (mesmoNome) throw c.erro(`Já existe a conta "${mesmoNome.nome}" no plano.`, 409);
  if (atual && ativa(atual) && !dados.ativa) {
    const regras = (await b.lerOpcional(api, 'classificacao_regras')) || [];
    const usam = regras.filter(r => String(r.conta_id) === String(atual.id) && r.ativa !== false && r.ativa !== 'false');
    if (usam.length) throw c.erro(`${c.plural(usam.length, 'regra ativa usa', 'regras ativas usam')} esta conta: desative ou mude a regra antes.`, 409);
  }
  let contaId = id;
  try {
    if (atual) await b.atualizar(api, 'plano_contas', atual.id, { ...dados, atualizado_em: c.agora() });
    else contaId = (await b.inserir(api, 'plano_contas', { ...dados, origem: 'manual', criado_por: usuarioId, criado_em: c.agora() })).id;
  } catch (e) {
    if (c.ehDuplicado(e) && !e.extra?.sql_pendente) throw c.erro('Já existe uma conta com este nome no plano.', 409);
    throw e;
  }
  // Renomeada: as contas a pagar com o nome antigo passam a usar o novo.
  let renomeadas = 0;
  if (atual && chaveNome(atual.nome) !== chaveNome(dados.nome)) {
    const titulos = (await b.lerOpcional(api, 'titulos_pagar')) || [];
    for (const t of titulos.filter(x => chaveNome(x.categoria) === chaveNome(atual.nome))) {
      await b.atualizar(api, 'titulos_pagar', t.id, { categoria: dados.nome, atualizado_em: c.agora() });
      renomeadas++;
    }
  }
  const partes = atual ? [
    chaveNome(atual.nome) !== chaveNome(dados.nome) ? `nome "${atual.nome}" → "${dados.nome}"${renomeadas ? ` (${c.plural(renomeadas, 'conta a pagar acompanhou', 'contas a pagar acompanharam')})` : ''}` : null,
    atual.tipo !== dados.tipo ? `tipo ${TIPOS[atual.tipo] || atual.tipo} → ${TIPOS[dados.tipo]}` : null,
    ativa(atual) !== dados.ativa ? (dados.ativa ? 'reativada' : 'desativada') : null
  ].filter(Boolean) : [];
  await eventos.registrar(api, {
    tipo: 'plano_conta_salva', usuarioId,
    descricao: atual ? `Conta do plano "${dados.nome}" alterada${partes.length ? `: ${partes.join('; ')}` : ''}` : `Conta do plano "${dados.nome}" (${TIPOS[dados.tipo]}) criada`,
    dados: { conta_id: contaId }
  });
  return { id: contaId, renomeadas };
}

module.exports = { TIPOS, ORDEM, DO_RESULTADO, ativa, chaveNome, contaPublica, ordenar, validarConta, lerPlano, listar, salvar };
