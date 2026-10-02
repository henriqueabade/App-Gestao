/**
 * Plano de contas (etapa 6; fase B, 02/10/2026: o plano da AEA).
 *
 * Desde a fase B (sql/contabilidade_fase_b.sql) o plano é o da AEA
 * (Mastermaq), INTEIRO: código reduzido de 5 dígitos ("00528"), classificação
 * ("4.01.01.01.002"), natureza (D/C), sintética ou analítica, conta-pai. Só as
 * marcadas "em uso" (as da Santíssimo) aparecem nas listas de escolha; o resto
 * fica no plano, para consulta e para marcar quando precisar.
 *
 * - O tipo diz como a conta entra no resultado: receita, dedução, custo,
 *   despesa; ativo, passivo, patrimônio e transferência NÃO são resultado.
 * - A conta da AEA não muda de nome, código nem tipo (é do escritório): muda
 *   "em uso", "o comprovante basta" (resposta 1 a do dono: imposto, conta de
 *   consumo e tarifa se provam com o comprovante do banco) e a observação.
 * - DESDOBRAMENTO (resposta do dono): a conta que se desdobra (fornecedores
 *   00223, clientes 00028, aplicações 00020) ganha subcontas no app com final
 *   próprio de três dígitos — 00020.001 Rende Fácil, 00020.002 CDB… Para a AEA
 *   vale o código da conta de cima.
 * - A conta a pagar guarda a categoria com o código ("00383 · Energia
 *   Eletrica"): o nome sozinho repete no plano da AEA. Categoria antiga (só o
 *   nome) ainda acha a conta quando o nome é único entre as em uso.
 * - Não se apaga: desativa. Conta com regra ativa não desativa nem sai de uso.
 * - As contas criadas à mão continuam como antes (nome único entre elas).
 */
const c = require('../../financeiro/comum');
const b = require('../base');
const eventos = require('../eventos');

const TIPOS = {
  receita: 'Receita', deducao: 'Dedução da receita', custo: 'Custo', despesa: 'Despesa',
  ativo: 'Ativo', passivo: 'Passivo',
  transferencia: 'Transferência (não é resultado)', patrimonio: 'Patrimônio (aporte, retirada)', outro: 'Outro'
};
const ORDEM = Object.keys(TIPOS);
/** Os tipos que entram no resultado do mês (receita − dedução − custo − despesa). */
const DO_RESULTADO = new Set(['receita', 'deducao', 'custo', 'despesa']);
const ORIGENS = { aea: 'Plano da AEA', desdobrado: 'Desdobramento', padrao: 'Veio com o app', manual: 'Criada à mão' };
const SQL_ARQUIVO_FASE_B = 'sql/contabilidade_fase_b.sql';
/** Até 999 desdobramentos por conta (final .001 a .999). */
const LIMITE_DESDOBRAMENTOS = 999;

const sim = v => v === true || v === 'true';
const ativa = p => p && p.ativa !== false && p.ativa !== 'false';
const daAea = p => p?.origem === 'aea';
const desdobrado = p => p?.origem === 'desdobrado';
const emUso = p => sim(p?.em_uso);
const analitica = p => p && p.analitica !== false && p.analitica !== 'false';
/** A linha do plano veio do banco com as colunas da fase B? */
const temFaseB = p => Boolean(p) && Object.prototype.hasOwnProperty.call(p, 'em_uso');
/** O nome para comparar: sem acento, sem maiúscula, sem espaço sobrando ("Serviços" = "servicos"). */
const chaveNome = n => String(n ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();

/** O código que a tela mostra: o reduzido da AEA (ou do desdobramento); na conta à mão, o que ela tiver. */
const codigoDeExibicao = p => p?.codigo_reduzido || p?.codigo || null;
/** "00528 · Industrialização de Mercadorias". */
const rotulo = p => (codigoDeExibicao(p) ? `${codigoDeExibicao(p)} · ${p.nome}` : p.nome);
/** A categoria que a conta a pagar guarda: com o código no plano da AEA; o nome na conta à mão. */
const rotuloDeCategoria = p => (daAea(p) || desdobrado(p) ? rotulo(p) : p.nome);

/**
 * Pode ser escolhida (classificação, regra, categoria)? A da AEA só analítica
 * e em uso; o desdobramento e a conta à mão, ativos. Pura.
 */
const selecionavel = p => ativa(p) && (daAea(p) ? emUso(p) && analitica(p) : true);

/** Os segmentos numéricos da classificação ("4.01.01" → [4, 1, 1]); null se não for numérica. */
function segmentos(codigo) {
  const t = String(codigo ?? '').trim();
  return /^\d+(\.\d+)*$/.test(t) ? t.split('.').map(Number) : null;
}

function compararCodigos(x, y) {
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined) return -1;
    if (y[i] === undefined) return 1;
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return 0;
}

function contaPublica(p, uso = null) {
  return {
    id: p.id, codigo: codigoDeExibicao(p), classificacao: p.codigo || null, codigo_reduzido: p.codigo_reduzido || null,
    nome: p.nome, rotulo: rotulo(p), tipo: TIPOS[p.tipo] ? p.tipo : 'outro', tipo_rotulo: TIPOS[p.tipo] || TIPOS.outro,
    natureza: p.natureza || null, analitica: analitica(p), nivel: p.nivel === null || p.nivel === undefined ? null : Number(p.nivel),
    conta_pai_id: p.conta_pai_id ?? null, ativa: ativa(p), em_uso: daAea(p) ? emUso(p) : ativa(p),
    comprovante_basta: sim(p.comprovante_basta), desdobra: sim(p.desdobra), selecionavel: selecionavel(p),
    contato_id: p.contato_id ?? null, cliente_id: p.cliente_id ?? null, conta_financeira_id: p.conta_financeira_id ?? null,
    observacao: p.observacao || null, origem: p.origem || 'manual', origem_rotulo: ORIGENS[p.origem] || ORIGENS.manual,
    do_resultado: DO_RESULTADO.has(p.tipo),
    ...(uso ? { uso } : {})
  };
}

/**
 * Na ordem da classificação (a árvore da AEA, o desdobramento logo depois da
 * conta de cima); as contas sem classificação numérica depois, por tipo e
 * nome; as desativadas no fim. Pura.
 */
function ordenar(contas) {
  return [...c.lista(contas)].sort((x, y) => {
    const a = Number(ativa(y)) - Number(ativa(x));
    if (a) return a;
    const sx = segmentos(x.codigo);
    const sy = segmentos(y.codigo);
    if (sx && sy) return compararCodigos(sx, sy);
    if (sx || sy) return sx ? -1 : 1;
    return ORDEM.indexOf(x.tipo) - ORDEM.indexOf(y.tipo) || String(x.codigo || '').localeCompare(String(y.codigo || ''))
      || String(x.nome).localeCompare(String(y.nome), 'pt-BR');
  });
}

/** Os índices para achar conta por código reduzido e por nome. Pura. */
function indexar(plano) {
  const porReduzido = new Map();
  const porNome = new Map();
  for (const p of c.lista(plano)) {
    if (!p) continue;
    if (p.codigo_reduzido) porReduzido.set(String(p.codigo_reduzido), p);
    if (!selecionavel(p)) continue;
    const k = chaveNome(p.nome);
    porNome.set(k, [...(porNome.get(k) || []), p]);
  }
  return { porReduzido, porNome };
}

/**
 * A conta da categoria de uma conta a pagar: pelo código ("00383 · …") ou,
 * na categoria antiga (só o nome), pelo nome — quando só uma conta em uso tem
 * esse nome (a criada à mão vence a da AEA). Ambígua: null. Pura.
 */
function contaDaCategoria(categoria, plano, indice = null) {
  const texto = String(categoria ?? '').trim();
  if (!texto) return null;
  const idx = indice || indexar(plano);
  const m = /^(\d{5}(?:\.\d{3})?)\s*[·\-–]/.exec(texto);
  if (m) {
    const p = idx.porReduzido.get(m[1]);
    return p && ativa(p) ? p : null;
  }
  const candidatas = idx.porNome.get(chaveNome(texto)) || [];
  if (candidatas.length === 1) return candidatas[0];
  const proprias = candidatas.filter(p => !daAea(p));
  return proprias.length === 1 ? proprias[0] : null;
}

/** A conta criada/editada à mão, conferida. Pura. */
function validarConta(entrada = {}) {
  const nome = c.texto(entrada.nome, 80);
  if (nome.length < 2) throw c.erro('Dê um nome à conta (ex.: Serviços de Terceiros).');
  return {
    nome, codigo: c.texto(entrada.codigo, 20) || null, tipo: TIPOS[entrada.tipo] ? entrada.tipo : 'despesa',
    ativa: !(entrada.ativa === false || entrada.ativa === 'false'), observacao: String(entrada.observacao ?? '').trim().slice(0, 500) || null
  };
}

/** O próximo final de desdobramento (".001", ".012"…) da conta de cima, ou erro se passou de 999. Pura. */
function proximoFinal(pai, plano) {
  const base = String(pai.codigo_reduzido || '');
  const usados = c.lista(plano)
    .map(p => String(p?.codigo_reduzido || ''))
    .filter(r => r.startsWith(`${base}.`))
    .map(r => Number(r.slice(base.length + 1)))
    .filter(n => Number.isInteger(n) && n > 0);
  const proximo = (usados.length ? Math.max(...usados) : 0) + 1;
  if (proximo > LIMITE_DESDOBRAMENTOS) throw c.erro(`A conta ${base} já tem ${LIMITE_DESDOBRAMENTOS} desdobramentos.`, 409);
  return String(proximo).padStart(3, '0');
}

const lerPlano = api => b.ler(api, 'plano_contas');

/** Sem as colunas da fase B, o que é dela responde 409 dizendo o SQL. */
function exigirFaseB(plano) {
  if (!c.lista(plano).some(temFaseB)) {
    throw c.erro(`O plano da AEA ainda não está no banco: rode ${SQL_ARQUIVO_FASE_B} e reinicie a API.`, 409, { sql_pendente: true, sql_arquivo: SQL_ARQUIVO_FASE_B });
  }
}

/** O plano com o uso de cada conta (contas a pagar, regras, classificações à mão). */
async function listar(api) {
  const [plano, titulos, regras, classificacoes] = await Promise.all([
    lerPlano(api), b.lerOpcional(api, 'titulos_pagar').then(x => x || []),
    b.lerOpcional(api, 'classificacao_regras').then(x => x || []), b.lerOpcional(api, 'classificacoes').then(x => x || [])
  ]);
  const indice = indexar(plano);
  const contar = (lista, chave) => {
    const m = new Map();
    for (const x of lista) {
      const k = chave(x);
      if (k !== null && k !== undefined) m.set(String(k), (m.get(String(k)) || 0) + 1);
    }
    return m;
  };
  const porTitulo = contar(titulos.filter(t => t.status !== 'cancelado'), t => contaDaCategoria(t.categoria, plano, indice)?.id);
  const porRegra = contar(regras.filter(r => r.ativa !== false && r.ativa !== 'false'), r => r.conta_id);
  const porClassificacao = contar(classificacoes.filter(x => !x.substituida_em), x => x.conta_id);
  const filhos = contar(plano.filter(desdobrado), p => p.conta_pai_id);
  const uso = p => ({
    titulos: porTitulo.get(String(p.id)) || 0, regras: porRegra.get(String(p.id)) || 0,
    classificacoes: porClassificacao.get(String(p.id)) || 0, desdobramentos: filhos.get(String(p.id)) || 0
  });
  return {
    contas: ordenar(plano).map(p => contaPublica(p, uso(p))), tipos: TIPOS, origens: ORIGENS,
    fase_b: plano.some(temFaseB), sql_fase_b: SQL_ARQUIVO_FASE_B
  };
}

/** Cria ou edita a conta à mão (ou renomeia/desativa um desdobramento). A da AEA não se edita aqui. */
async function salvar(api, { id = null, entrada = {}, usuarioId = null }) {
  const dados = validarConta(entrada);
  const plano = await lerPlano(api);
  const atual = id ? plano.find(p => String(p.id) === String(id)) || null : null;
  if (id && !atual) throw c.erro('Conta do plano não encontrada.', 404);
  if (daAea(atual)) throw c.erro('Esta conta é do plano da AEA: nome, código e tipo não mudam aqui (marque "em uso" ou "o comprovante basta").', 409);
  // O desdobramento fica com o código e o tipo da conta de cima: muda o nome, a observação e se está ativo.
  if (desdobrado(atual)) Object.assign(dados, { codigo: atual.codigo, tipo: atual.tipo });
  const mesmoNome = plano.find(p => ['manual', 'padrao'].includes(p.origem || 'manual') && !desdobrado(atual)
    && chaveNome(p.nome) === chaveNome(dados.nome) && String(p.id) !== String(id));
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
  // Renomeada: as contas a pagar com a categoria antiga passam a usar a nova.
  let renomeadas = 0;
  if (atual && chaveNome(atual.nome) !== chaveNome(dados.nome)) {
    const antes = rotuloDeCategoria(atual);
    const depois = rotuloDeCategoria({ ...atual, ...dados });
    const titulos = (await b.lerOpcional(api, 'titulos_pagar')) || [];
    for (const t of titulos.filter(x => chaveNome(x.categoria) === chaveNome(antes))) {
      await b.atualizar(api, 'titulos_pagar', t.id, { categoria: depois.slice(0, 80), atualizado_em: c.agora() });
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
    descricao: atual ? `Conta do plano "${rotulo({ ...atual, ...dados })}" alterada${partes.length ? `: ${partes.join('; ')}` : ''}` : `Conta do plano "${dados.nome}" (${TIPOS[dados.tipo]}) criada`,
    dados: { conta_id: contaId }
  });
  return { id: contaId, renomeadas };
}

/**
 * "Em uso" e "o comprovante basta" de uma conta (fase B). Sair de uso não
 * pode com regra ativa nela (a regra classificaria numa conta escondida).
 */
async function marcar(api, id, { entrada = {}, usuarioId = null }) {
  const plano = await lerPlano(api);
  exigirFaseB(plano);
  const p = plano.find(x => String(x.id) === String(id)) || null;
  if (!p) throw c.erro('Conta do plano não encontrada.', 404);
  const campos = {};
  const mudou = [];
  if (entrada.em_uso !== undefined) {
    const quer = sim(entrada.em_uso);
    if (quer && daAea(p) && !analitica(p)) throw c.erro(`${rotulo(p)} é uma conta-título (sintética): marque uma das contas de baixo.`, 422);
    if (quer !== emUso(p)) {
      if (!quer) {
        const regras = (await b.lerOpcional(api, 'classificacao_regras')) || [];
        const usam = regras.filter(r => String(r.conta_id) === String(p.id) && r.ativa !== false && r.ativa !== 'false');
        if (usam.length) throw c.erro(`${c.plural(usam.length, 'regra ativa usa', 'regras ativas usam')} esta conta: mude a regra antes de tirar de uso.`, 409);
      }
      campos.em_uso = quer;
      mudou.push(quer ? 'em uso' : 'fora de uso');
    }
  }
  if (entrada.comprovante_basta !== undefined && sim(entrada.comprovante_basta) !== sim(p.comprovante_basta)) {
    campos.comprovante_basta = sim(entrada.comprovante_basta);
    mudou.push(campos.comprovante_basta ? 'o comprovante basta como documento' : 'pede nota ou recibo');
  }
  if (entrada.observacao !== undefined) {
    const obs = String(entrada.observacao ?? '').trim().slice(0, 500) || null;
    if (obs !== (p.observacao || null)) { campos.observacao = obs; mudou.push('observação'); }
  }
  if (!mudou.length) return { id: p.id, alterado: [] };
  await b.atualizar(api, 'plano_contas', p.id, { ...campos, atualizado_em: c.agora() });
  await eventos.registrar(api, { tipo: 'plano_conta_salva', usuarioId, descricao: `${rotulo(p)}: ${mudou.join(', ')}`, dados: { conta_id: p.id } });
  return { id: p.id, alterado: mudou };
}

/**
 * Desdobra a conta: uma subconta com o próximo final (".001", ".012"…),
 * do mesmo tipo e natureza, já em uso. `vinculo` liga a subconta ao
 * fornecedor (contato_id), ao cliente (cliente_id) ou à conta do banco
 * (conta_financeira_id) — é por ele que o app acha a subconta sozinho.
 */
async function desdobrar(api, id, { entrada = {}, usuarioId = null, plano: lido = null }) {
  const plano = lido || await lerPlano(api);
  exigirFaseB(plano);
  const pai = plano.find(x => String(x.id) === String(id)) || null;
  if (!pai) throw c.erro('Conta do plano não encontrada.', 404);
  if (!daAea(pai) || !analitica(pai)) throw c.erro('Só uma conta analítica do plano da AEA se desdobra.', 422);
  const nome = c.texto(entrada.nome, 80);
  if (nome.length < 2) throw c.erro('Dê um nome ao desdobramento (ex.: o fornecedor, o cliente, a aplicação).');
  const irmas = plano.filter(p => desdobrado(p) && String(p.conta_pai_id) === String(pai.id));
  const repetida = irmas.find(p => chaveNome(p.nome) === chaveNome(nome));
  if (repetida) throw c.erro(`${rotulo(repetida)} já existe.`, 409, { conta_id: repetida.id });
  const vinculo = {};
  for (const campo of ['contato_id', 'cliente_id', 'conta_financeira_id']) {
    const v = entrada[campo];
    if (v === undefined || v === null || v === '') continue;
    if (!/^\d+$/.test(String(v))) throw c.erro('Vínculo do desdobramento inválido.');
    vinculo[campo] = Number(v);
  }
  const fim = proximoFinal(pai, plano);
  const nova = await b.inserir(api, 'plano_contas', {
    codigo: `${pai.codigo}.${fim}`, codigo_reduzido: `${pai.codigo_reduzido}.${fim}`, nome, natureza: pai.natureza || null, analitica: true,
    nivel: (Number(pai.nivel) || 5) + 1, tipo: pai.tipo, ativa: true, origem: 'desdobrado', em_uso: true, comprovante_basta: sim(pai.comprovante_basta),
    conta_pai_id: pai.id, ...vinculo, criado_por: usuarioId, criado_em: c.agora()
  });
  if (!sim(pai.desdobra)) await b.atualizar(api, 'plano_contas', pai.id, { desdobra: true, atualizado_em: c.agora() }).catch(() => null);
  await eventos.registrar(api, {
    tipo: 'plano_conta_salva', usuarioId, descricao: `${rotulo(pai)} desdobrada: ${pai.codigo_reduzido}.${fim} · ${nome}`, dados: { conta_id: nova.id, conta_pai_id: pai.id }
  });
  return contaPublica({ ...nova, codigo: `${pai.codigo}.${fim}`, codigo_reduzido: `${pai.codigo_reduzido}.${fim}`, nome, tipo: pai.tipo, origem: 'desdobrado', em_uso: true, ativa: true, conta_pai_id: pai.id });
}

/**
 * O desdobramento da conta `reduzido` ligado ao fornecedor/cliente/conta do
 * banco — acha o que existe ou cria (com `nome`). Usado pelas partidas
 * contábeis (fornecedores 00223, clientes 00028, aplicações 00020).
 */
async function desdobramentoDe(api, { reduzido, campo, valor, nome, usuarioId = null }) {
  const plano = await lerPlano(api);
  const pai = plano.find(p => daAea(p) && String(p.codigo_reduzido) === String(reduzido)) || null;
  if (!pai) return null;
  const achado = plano.find(p => desdobrado(p) && String(p.conta_pai_id) === String(pai.id) && String(p[campo]) === String(valor) && ativa(p));
  if (achado) return achado;
  const criada = await desdobrar(api, pai.id, { entrada: { nome, [campo]: valor }, usuarioId, plano });
  return plano.find(p => String(p.id) === String(criada.id)) || { ...criada, codigo: criada.classificacao };
}

module.exports = {
  TIPOS, ORDEM, DO_RESULTADO, ORIGENS, SQL_ARQUIVO_FASE_B, LIMITE_DESDOBRAMENTOS,
  ativa, daAea, desdobrado, emUso, analitica, temFaseB, chaveNome, codigoDeExibicao, rotulo, rotuloDeCategoria, selecionavel,
  contaPublica, ordenar, indexar, contaDaCategoria, validarConta, proximoFinal,
  lerPlano, listar, salvar, marcar, desdobrar, desdobramentoDe
};
