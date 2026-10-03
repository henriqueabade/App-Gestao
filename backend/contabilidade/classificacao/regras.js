/**
 * Regras de classificação (etapa 6): "quando isto, esta conta do plano".
 *
 *   descricao      a descrição do banco contém o texto (sem acento, palavra
 *                  inteira: "TARIFA" casa "Tarifa pacote", não "TARIFAÇO")
 *   contrapartida  o CNPJ/CPF da contrapartida (a API do BB traz)
 *   fornecedor     o fornecedor da conta a pagar (contato)
 *   cfop           um dos CFOPs da NF-e de entrada (lista com vírgula)
 *   origem         de onde veio o dinheiro conciliado: recebimento de pedido,
 *                  reembolso, pagamento de comissões ou de produção
 *
 * Vence a de maior prioridade; empate, o texto mais longo (mais específico);
 * depois a mais antiga. Regra desativada não vale. As que vieram com o app
 * (origem "padrao") se editam como as outras.
 *
 * As "sugeridas" saem das classificações feitas à mão: a mesma descrição
 * (sem as palavras genéricas do banco) classificada na mesma conta 2 vezes ou
 * mais vira proposta de regra — só entra se alguém criar.
 */
const c = require('../../financeiro/comum');
const b = require('../base');
const eventos = require('../eventos');
const planoMod = require('./plano');

const CONDICOES = {
  descricao: 'Descrição do banco contém',
  contrapartida: 'CNPJ/CPF da contrapartida',
  fornecedor: 'Fornecedor da conta a pagar',
  cfop: 'CFOP da NF-e de entrada',
  origem: 'Origem do dinheiro conciliado'
};
const ORIGENS = {
  recebimento: 'Recebimento de pedido', reembolso: 'Reembolso de devolução', comissao: 'Pagamento de comissões', producao: 'Pagamento de produção',
  // Fase F: o que a empresa pagou em nome de outra (a receber) e a devolução dela.
  terceiro: 'Pago em nome de terceiro / devolução (a receber)'
};
const SENTIDOS = { ambos: 'Entrada e saída', credito: 'Só entrada', debito: 'Só saída' };
const GENERICAS = new Set([
  'PIX', 'TED', 'DOC', 'TEF', 'ENVIADO', 'ENVIADA', 'RECEBIDO', 'RECEBIDA', 'PAGAMENTO', 'PAGTO', 'PGTO', 'BOLETO', 'TRANSFERENCIA', 'TRANSF',
  'DEBITO', 'CREDITO', 'AUTOMATICO', 'COMPRA', 'CARTAO', 'DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'EM', 'PARA', 'CONTA', 'SIMULADO'
]);

const normalizar = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const ativa = r => r && r.ativa !== false && r.ativa !== 'false';

/** A regra conferida (o valor já no formato em que se compara). Pura. */
function validarRegra(entrada = {}) {
  const condicao = CONDICOES[entrada.condicao_tipo] ? entrada.condicao_tipo : null;
  if (!condicao) throw c.erro('Escolha quando a regra vale (descrição, CNPJ/CPF, fornecedor, CFOP ou origem).');
  let valor = '';
  if (condicao === 'descricao') {
    valor = normalizar(entrada.valor).slice(0, 200);
    if (valor.length < 3) throw c.erro('Escreva o texto da descrição (ao menos 3 letras).');
  } else if (condicao === 'contrapartida') {
    valor = b.digitos(entrada.valor);
    if (![11, 14].includes(valor.length)) throw c.erro('Informe o CNPJ (14 dígitos) ou o CPF (11).');
  } else if (condicao === 'fornecedor') {
    valor = String(entrada.valor ?? '').trim();
    if (!/^\d+$/.test(valor)) throw c.erro('Escolha o fornecedor.');
  } else if (condicao === 'cfop') {
    const lista = [...new Set(String(entrada.valor ?? '').split(/[^0-9]+/).filter(x => /^\d{4}$/.test(x)))];
    if (!lista.length) throw c.erro('Informe o CFOP (4 dígitos; mais de um separados por vírgula).');
    valor = lista.join(',');
  } else {
    valor = ORIGENS[entrada.valor] ? entrada.valor : '';
    if (!valor) throw c.erro('Escolha a origem do dinheiro.');
  }
  const conta = String(entrada.conta_id ?? '');
  if (!/^\d+$/.test(conta)) throw c.erro('Escolha a conta do plano.');
  const prioridade = Math.trunc(Number(entrada.prioridade) || 0);
  return {
    condicao_tipo: condicao, valor, sentido: SENTIDOS[entrada.sentido] ? entrada.sentido : 'ambos', conta_id: Number(conta),
    prioridade: Math.max(-100, Math.min(100, prioridade)), ativa: !(entrada.ativa === false || entrada.ativa === 'false'),
    observacao: String(entrada.observacao ?? '').trim().slice(0, 500) || null
  };
}

/**
 * A regra vale para este alvo? `alvo`: { descricao, contrapartida, sentido
 * ('credito'|'debito'), contato_id, cfops (lista), origem }. Pura.
 */
function casa(regra, alvo = {}) {
  if (!ativa(regra)) return false;
  if (regra.sentido && regra.sentido !== 'ambos' && alvo.sentido && regra.sentido !== alvo.sentido) return false;
  const valor = String(regra.valor ?? '');
  switch (regra.condicao_tipo) {
    case 'descricao': return Boolean(alvo.descricao) && ` ${normalizar(alvo.descricao)} `.includes(` ${normalizar(valor)} `);
    case 'contrapartida': return Boolean(alvo.contrapartida) && b.digitos(alvo.contrapartida) === valor;
    case 'fornecedor': return alvo.contato_id !== null && alvo.contato_id !== undefined && String(alvo.contato_id) === valor;
    case 'cfop': {
      const doAlvo = (Array.isArray(alvo.cfops) ? alvo.cfops : String(alvo.cfops ?? '').split(/[^0-9]+/)).map(String);
      return valor.split(',').some(x => doAlvo.includes(x));
    }
    case 'origem': return alvo.origem === valor;
    default: return false;
  }
}

/** A regra que vence para o alvo, entre as condições pedidas (ou null). Pura. */
function escolher(regras, alvo, { condicoes = Object.keys(CONDICOES) } = {}) {
  return c.lista(regras)
    .filter(r => condicoes.includes(r.condicao_tipo) && casa(r, alvo))
    .sort((x, y) => (Number(y.prioridade) || 0) - (Number(x.prioridade) || 0) || String(y.valor).length - String(x.valor).length || Number(x.id) - Number(y.id))[0] || null;
}

const generica = t => GENERICAS.has(t) || /^\d+$/.test(t) || t.length < 3;

/**
 * As palavras que identificam a descrição: sem as genéricas do começo ("PIX
 * ENVIADO", "PAGAMENTO DE BOLETO") e até `palavras` palavras que contam,
 * seguidas como estão ("CLIENTE DA LOJA": a regra casa a descrição inteira). Pura.
 */
function chaveDaDescricao(descricao, palavras = 2) {
  const tokens = normalizar(descricao).split(' ').filter(Boolean);
  let i = 0;
  while (i < tokens.length && generica(tokens[i])) i++;
  const escolhidos = [];
  let contam = 0;
  for (let j = i; j < tokens.length && contam < palavras; j++) {
    escolhidos.push(tokens[j]);
    if (!generica(tokens[j])) contam++;
  }
  while (escolhidos.length && generica(escolhidos[escolhidos.length - 1])) escolhidos.pop();
  const chave = escolhidos.join(' ');
  return chave.length >= 4 ? chave : null;
}

/**
 * Propostas de regra a partir das classificações à mão: a mesma chave de
 * descrição, no mesmo sentido, na mesma conta, 2 vezes ou mais — e que
 * nenhuma regra ativa de descrição já cubra. Pura.
 */
function sugeridas(manuais, regras) {
  const grupos = new Map();
  for (const m of c.lista(manuais)) {
    const chave = chaveDaDescricao(m.descricao);
    if (!chave || !m.conta_id) continue;
    const sentido = Number(m.valor) < 0 ? 'debito' : 'credito';
    const k = `${chave}|${sentido}|${m.conta_id}`;
    const g = grupos.get(k) || { condicao_tipo: 'descricao', valor: chave, sentido, conta_id: Number(m.conta_id), exemplos: [] };
    g.exemplos.push(m.descricao);
    grupos.set(k, g);
  }
  const descricoes = c.lista(regras).filter(r => ativa(r) && r.condicao_tipo === 'descricao');
  return [...grupos.values()]
    .filter(g => g.exemplos.length >= 2)
    .filter(g => !g.exemplos.every(d => descricoes.some(r => casa(r, { descricao: d, sentido: g.sentido }))))
    .map(g => ({ ...g, quantidade: g.exemplos.length, exemplos: g.exemplos.slice(0, 3) }))
    .sort((x, y) => y.quantidade - x.quantidade || x.valor.localeCompare(y.valor));
}

// ------------------------------------------------------------------ leitura e gravação

function rotuloDoValor(r, { contatos = new Map() } = {}) {
  if (r.condicao_tipo === 'origem') return ORIGENS[r.valor] || r.valor;
  if (r.condicao_tipo === 'fornecedor') return contatos.get(String(r.valor))?.nome || `Fornecedor ${r.valor}`;
  if (r.condicao_tipo === 'contrapartida') return b.documentoFormatado(r.valor);
  if (r.condicao_tipo === 'cfop') return r.valor.split(',').join(', ');
  return `"${r.valor}"`;
}

function regraPublica(r, { plano = new Map(), contatos = new Map() } = {}) {
  const conta = plano.get(String(r.conta_id)) || null;
  return {
    id: r.id, condicao_tipo: r.condicao_tipo, condicao_rotulo: CONDICOES[r.condicao_tipo] || r.condicao_tipo, valor: r.valor,
    valor_rotulo: rotuloDoValor(r, { contatos }), sentido: r.sentido || 'ambos', sentido_rotulo: SENTIDOS[r.sentido] || SENTIDOS.ambos,
    conta_id: r.conta_id, conta: conta ? planoMod.rotulo(conta) : null, conta_ativa: conta ? planoMod.selecionavel(conta) : false,
    prioridade: Number(r.prioridade) || 0, ativa: ativa(r), origem: r.origem || 'manual', observacao: r.observacao || null
  };
}

const lerRegras = api => b.ler(api, 'classificacao_regras');

async function lerContatosDasRegras(api, regras) {
  const ids = [...new Set(regras.filter(r => r.condicao_tipo === 'fornecedor').map(r => String(r.valor)))];
  const linhas = await Promise.all(ids.map(id => api.get(`/api/contatos/${id}`).catch(() => null)));
  return new Map(linhas.filter(x => x && !x.error && x.id !== undefined).map(x => [String(x.id), x]));
}

async function salvar(api, { id = null, entrada = {}, usuarioId = null }) {
  const dados = validarRegra(entrada);
  const conta = (await b.ler(api, 'plano_contas', { id: dados.conta_id }))[0] || null;
  if (!conta) throw c.erro('Conta do plano não encontrada.', 404);
  if (!ativa(conta)) throw c.erro(`A conta "${conta.nome}" está desativada: escolha outra.`, 409);
  if (!planoMod.selecionavel(conta)) throw c.erro(`A conta "${planoMod.rotulo(conta)}" não está em uso: marque-a em uso no Plano de contas antes.`, 409);
  let regraId = id;
  if (id) {
    const atual = (await lerRegras(api)).find(r => String(r.id) === String(id));
    if (!atual) throw c.erro('Regra não encontrada.', 404);
    await b.atualizar(api, 'classificacao_regras', atual.id, { ...dados, atualizado_em: c.agora() });
  } else {
    regraId = (await b.inserir(api, 'classificacao_regras', { ...dados, origem: 'manual', criado_por: usuarioId, criado_em: c.agora() })).id;
  }
  await eventos.registrar(api, {
    tipo: 'regra_salva', usuarioId,
    descricao: `Regra ${id ? 'alterada' : 'criada'}: ${CONDICOES[dados.condicao_tipo]} ${rotuloDoValor(dados)} → ${planoMod.rotulo(conta)}${dados.ativa ? '' : ' (desativada)'}`,
    dados: { regra_id: regraId }
  });
  return { id: regraId };
}

/**
 * A categoria sugerida para uma conta a pagar nova (fornecedor e CFOP da
 * NF-e) — com o código no plano da AEA ("00340 · Compra de Mercadorias");
 * sem o SQL da etapa 6 ou sem regra, null.
 */
async function categoriaSugerida(api, { contato_id = null, cfops = [] } = {}) {
  const [regras, plano] = await Promise.all([b.lerOpcional(api, 'classificacao_regras'), b.lerOpcional(api, 'plano_contas')]);
  if (!regras || !plano) return null;
  const r = escolher(regras, { contato_id, cfops }, { condicoes: ['fornecedor', 'cfop'] });
  const conta = r ? plano.find(p => String(p.id) === String(r.conta_id) && ativa(p)) : null;
  return conta ? planoMod.rotuloDeCategoria(conta) : null;
}

module.exports = {
  CONDICOES, ORIGENS, SENTIDOS, normalizar, validarRegra, casa, escolher, chaveDaDescricao, sugeridas,
  rotuloDoValor, regraPublica, lerRegras, lerContatosDasRegras, salvar, categoriaSugerida
};
