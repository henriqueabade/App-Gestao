/**
 * Ajustes por PESSOA na CMS, no Royalty e na Produção (pedido do dono,
 * 06/10/2026).
 *
 * O "Registrar ajuste" antigo mexia na PARCELA do cliente (a base da
 * comissão — ajustes.js, que a devolução continua usando). O que o
 * Financeiro precisa no dia a dia é outra coisa: acertar o que UMA pessoa
 * recebe no mês, sem tocar no pedido do cliente — uma bonificação, um
 * adiantamento que já foi pago, uma correção, um desconto:
 *
 *   - área: CMS (o dono do cliente), Royalty (o desenhista) ou Produção (o
 *     processo — marcenaria, acabamento… — e, se houver rateio, o
 *     colaborador, que aparece na linha);
 *   - tipo: os que SOMAM (acréscimo, bonificação, correção para mais,
 *     outros) e os que DESCONTAM (desconto, adiantamento já pago, estorno,
 *     correção para menos, outros); o sinal fica gravado com o ajuste;
 *   - valor, data, a competência em que entra (o mês escolhido), uma
 *     referência livre (ex.: PED115), o motivo e a observação;
 *   - o ajuste vira um item do fechamento daquele mês, da pessoa
 *     (`itensDeComissao` em comissoes.apurar; `linhasDeProducao` em
 *     producao.lerBase), e aparece no resumo e nos relatórios;
 *   - se a pessoa termina o mês NEGATIVA, a diferença não se paga: passa para
 *     o mês seguinte como "Ajuste restante do mês anterior" e abate o que ela
 *     tiver lá (o saldo do último fechamento, e a projeção dos meses ainda
 *     abertos — comissoes/producao.restantesProjetados). Na produção a conta
 *     é por processo, que é como a produção fecha e se paga;
 *   - competência já fechada não recebe ajuste (o fechamento é congelado);
 *   - cancelar, só enquanto o ajuste não entrou num fechamento.
 *
 * SQL: sql/financeiro_ajustes_pessoa.sql. Sem ele nada quebra: a leitura
 * devolve `null` (quem chama trata como lista vazia) e o registro responde
 * 409 com `sql_pendente`.
 */
const c = require('./comum');

const SQL_ARQUIVO = 'sql/financeiro_ajustes_pessoa.sql';
const SQL_FALTANDO = `Falta rodar ${SQL_ARQUIVO} no banco e reiniciar a API.`;
const TABELA = 'financeiro_ajustes_pessoa';

const AREAS = { cms: 'CMS', royalty: 'Royalty', producao: 'Produção' };
/** CMS e Royalty fecham juntos (comissões); a produção fecha à parte. */
const FECHAMENTO_DA_AREA = { cms: 'comissao', royalty: 'comissao', producao: 'producao' };

const TIPOS = {
  acrescimo: { rotulo: 'Acréscimo', sinal: 1 },
  bonificacao: { rotulo: 'Bonificação', sinal: 1 },
  correcao_mais: { rotulo: 'Correção para mais', sinal: 1 },
  outros_mais: { rotulo: 'Outros (soma)', sinal: 1 },
  desconto: { rotulo: 'Desconto', sinal: -1 },
  adiantamento: { rotulo: 'Adiantamento já pago', sinal: -1 },
  estorno: { rotulo: 'Estorno', sinal: -1 },
  correcao_menos: { rotulo: 'Correção para menos', sinal: -1 },
  outros_menos: { rotulo: 'Outros (desconta)', sinal: -1 }
};

/** Até quantos meses à frente se lança um ajuste. */
const MESES_A_FRENTE = 12;

// ------------------------------------------------------------- contas puras

/** "1.234,56", "1234.56" ou 1234.56 em número; NaN quando não é. Pura. */
function lerValor(v) {
  if (typeof v === 'number') return v;
  const texto = String(v ?? '').replace(/[R$\s]/g, '');
  if (!texto) return NaN;
  return Number(texto.includes(',') ? texto.replace(/\./g, '').replace(',', '.') : texto);
}

/** O valor com o sinal do tipo (o que desconta é negativo). Pura. */
function valorComSinal(a) {
  return c.centavos(Math.abs(Number(a?.valor) || 0) * (Number(a?.sinal) < 0 ? -1 : 1));
}

const rotuloDoTipo = tipo => TIPOS[tipo]?.rotulo || String(tipo || 'Ajuste');

/** Confere o que veio da tela. Pura. */
function validar(entrada, { hoje }) {
  const area = String(entrada?.area || '');
  if (!AREAS[area]) throw c.erro('Escolha onde vai o ajuste: CMS, Royalty ou Produção.');
  const tipo = String(entrada?.tipo || '');
  if (!TIPOS[tipo]) throw c.erro('Escolha o tipo de ajuste.');
  const valor = c.centavos(lerValor(entrada?.valor));
  if (!(valor > 0)) throw c.erro('Informe o valor do ajuste (maior que zero).');
  const data = String(entrada?.data_ajuste || '').slice(0, 10);
  if (!c.dataValida(data)) throw c.erro('Informe a data do ajuste.');
  const competencia = c.competenciaValida(entrada?.competencia) ? String(entrada.competencia) : c.competenciaDe(data);
  const limite = c.somarMeses(c.competenciaDe(hoje), MESES_A_FRENTE);
  if (competencia > limite) throw c.erro(`O ajuste pode entrar até ${c.rotuloCompetencia(limite)} (12 meses à frente).`);
  const motivo = c.texto(entrada?.motivo, 200);
  if (motivo.replace(/[^\p{L}]/gu, '').length < 5) throw c.erro('Diga o motivo do ajuste (ao menos 5 letras).');

  let beneficiario = c.texto(entrada?.beneficiario, 120);
  let setorId = null;
  let colaboradorId = null;
  if (area === 'producao') {
    setorId = Number(entrada?.setor_id);
    if (!(Number.isInteger(setorId) && setorId > 0)) throw c.erro('Escolha o processo da produção.');
    const col = Number(entrada?.colaborador_id);
    colaboradorId = Number.isInteger(col) && col > 0 ? col : null;
    beneficiario = '';
  } else if (!beneficiario) {
    throw c.erro(area === 'cms' ? 'Escolha quem recebe a CMS (o dono do cliente).' : 'Escolha o desenhista que recebe o Royalty.');
  }
  return {
    area, tipo, sinal: TIPOS[tipo].sinal, valor, data, competencia, beneficiario, setorId, colaboradorId,
    referencia: c.texto(entrada?.referencia, 120) || null, motivo, observacao: c.texto(entrada?.observacao, 1000) || null
  };
}

/** Os ajustes que já entraram num fechamento (pelo item congelado). Pura. */
function idsNoFechamento(congelados = []) {
  const ids = new Map();
  for (const i of congelados || []) {
    const id = i?.ajuste_pessoa_id ?? i?.detalhes?.ajuste_pessoa_id;
    if (id !== null && id !== undefined && id !== '') ids.set(String(id), i);
  }
  return ids;
}

const ativo = a => a && a.status === 'ativo';
const naturalDe = a => String(a?.competencia || '').trim() || c.competenciaDe(a?.data_ajuste);
const comReferencia = (texto, a) => `${texto}${a?.referencia ? ` · ref. ${a.referencia}` : ''}`;

/** O que o item congelado guarda do ajuste (para o relatório e o histórico). */
const resumoDoAjuste = a => ({
  id: a.id, area: a.area, tipo: a.tipo, rotulo: rotuloDoTipo(a.tipo), sinal: Number(a.sinal) < 0 ? -1 : 1,
  valor: c.centavos(a.valor), data: c.dia(a.data_ajuste), referencia: a.referencia || null,
  motivo: a.motivo || null, observacao: a.observacao || null, criado_por: a.criado_por ?? null
});

/**
 * Os ajustes de CMS e Royalty ainda fora de fechamento, como ITENS do
 * fechamento de comissões (o mesmo formato dos itens de ajuste das
 * parcelas). `competenciaAlvo` vem de comissoes.js (o mês natural, ou o
 * próximo a fechar se o natural já fechou). Pura.
 */
function itensDeComissao({ ajustes = [], estado, competenciaAlvo }) {
  const fechados = idsNoFechamento(estado?.congelados);
  return (ajustes || [])
    .filter(a => ativo(a) && (a.area === 'cms' || a.area === 'royalty') && !fechados.has(String(a.id)))
    .map(a => {
      const v = valorComSinal(a);
      const natural = naturalDe(a);
      const motivo = comReferencia(`${rotuloDoTipo(a.tipo)} (${AREAS[a.area]}): ${a.motivo}`, a);
      return {
        chave: `ajuste_pessoa:${a.id}`, tipo_item: 'ajuste', ajuste_pessoa_id: a.id,
        pedido_id: null, pedido: null, cliente_id: null, cliente: null, nf: null, numero_parcela: null, parcela: null,
        recebimento_id: null, data_referencia: c.dia(a.data_ajuste),
        competencia_natural: natural, competencia: competenciaAlvo(natural, estado?.proxima),
        valor_parcela: null, ajustes: null, base: null, pct_cms: null, pct_royalty: null,
        cms: a.area === 'cms' ? v : 0, royalty: a.area === 'royalty' ? v : 0, total: v, motivo,
        detalhes: {
          beneficiarios: [{ tipo: a.area, beneficiario: a.beneficiario, percentual: null, valor: v }],
          ajuste_pessoa_id: a.id, ajuste_pessoa: resumoDoAjuste(a), motivo
        }
      };
    });
}

/**
 * Os ajustes da produção ainda fora de fechamento, como LINHAS da produção
 * (as do processo escolhido: é por processo que a produção soma, fecha e
 * leva o saldo negativo). `processos`/`colaboradores`: Map id → nome. Pura.
 */
function linhasDeProducao({ ajustes = [], estado, competenciaAlvo, processos = new Map(), colaboradores = new Map() }) {
  const fechados = idsNoFechamento(estado?.congelados);
  return (ajustes || [])
    .filter(a => ativo(a) && a.area === 'producao' && !fechados.has(String(a.id)))
    .map(a => {
      const v = valorComSinal(a);
      const natural = naturalDe(a);
      const setor = processos.get(String(a.setor_id)) || a.setor || `processo ${a.setor_id}`;
      const colaborador = a.colaborador_id ? (colaboradores.get(String(a.colaborador_id)) || a.beneficiario || null) : null;
      return {
        evento_id: null, ajuste_pessoa_id: a.id, tipo_item: 'ajuste', pedido_id: null, pedido: '—', cliente_id: null,
        pedido_item_id: null, produto_id: null,
        // Sem código de peça, a coluna "Produto" mostra o texto inteiro: o ajuste, para quem e o motivo.
        produto: comReferencia(`Ajuste (${rotuloDoTipo(a.tipo)})${colaborador ? ` · ${colaborador}` : ''} — ${a.motivo}`, a),
        produto_codigo: null, produto_nome: null,
        setor_id: a.setor_id ?? null, setor, data: c.dia(a.data_ajuste), quantidade: 0, estorno_de: null,
        competencia_natural: natural, competencia: competenciaAlvo(natural, estado?.proxima),
        valor_unitario: null, valor_peca: null, fracao: null, regra: null, valor_origem: 'ajuste', sem_valor: false,
        total: v, status_item: 'Ajuste', observacao: a.observacao || null,
        motivo: comReferencia(`${rotuloDoTipo(a.tipo)}: ${a.motivo}`, a),
        colaborador_id: a.colaborador_id ?? null, colaborador, ajuste_pessoa: resumoDoAjuste(a)
      };
    });
}

/** O nome de um usuário no mapa (historicoSocial guarda a chave em número). */
const nomeDe = (nomes, id) => (id === null || id === undefined ? null : (nomes.get(Number(id)) || nomes.get(String(id)) || null));

/** Um ajuste para a tela (lista do modal e relatório). Pura. */
function paraTela(a, { nomes = new Map(), congelados = new Map() } = {}) {
  const item = congelados.get(String(a.id)) || null;
  return {
    id: a.id, area: a.area, area_rotulo: AREAS[a.area] || a.area,
    beneficiario: a.beneficiario, setor_id: a.setor_id ?? null, setor: a.setor || null, colaborador_id: a.colaborador_id ?? null,
    tipo: a.tipo, tipo_rotulo: rotuloDoTipo(a.tipo), sinal: Number(a.sinal) < 0 ? -1 : 1,
    valor: c.centavos(a.valor), valor_com_sinal: valorComSinal(a),
    data_ajuste: c.dia(a.data_ajuste), competencia: naturalDe(a), referencia: a.referencia || null,
    motivo: a.motivo || '', observacao: a.observacao || null, status: a.status,
    criado_por: a.criado_por ?? null, criado_por_nome: nomeDe(nomes, a.criado_por), criado_em: a.criado_em || null,
    cancelado_por_nome: nomeDe(nomes, a.cancelado_por),
    cancelado_em: a.cancelado_em || null, motivo_cancelamento: a.motivo_cancelamento || null,
    no_fechamento: Boolean(item), fechamento_competencia: item ? (item.competencia || null) : null
  };
}

/**
 * O valor da pessoa no mês com e sem um ajuste novo, e o que fica para o mês
 * seguinte se terminar negativa. `atual` é o que ela tem hoje no mês (com os
 * ajustes já lançados). Pura — a tela faz a mesma conta.
 */
function impacto({ atual = 0, valor = 0, sinal = 1 }) {
  const antes = c.centavos(atual);
  const depois = c.centavos(antes + Math.abs(Number(valor) || 0) * (Number(sinal) < 0 ? -1 : 1));
  return { antes, depois, a_pagar: depois > 0 ? depois : 0, restante: depois < 0 ? depois : 0 };
}

// ------------------------------------------------------------------ banco

function tabelaAusente(err) {
  const bruto = `${err?.message || ''} ${err?.body?.error || ''} ${err?.body?.detalhe || ''} ${err?.code || ''}`;
  if (/42P01/.test(bruto)) return true;
  return bruto.includes(TABELA) && (/does not exist|não encontrada|não existe/i.test(bruto) || err?.status === 404);
}

const sqlPendente = () => c.erro(SQL_FALTANDO, 409, { sql_pendente: true, arquivo: SQL_ARQUIVO });

/** Todos os ajustes; `null` quando falta o SQL (quem soma trata como nenhum). */
async function lerTodos(api, query = {}) {
  try {
    const linhas = c.lista(await api.get(`/api/${TABELA}`, { query }));
    return linhas.filter(l => l && Object.entries(query).every(([col, v]) => String(l[col]) === String(v)));
  } catch (e) {
    if (tabelaAusente(e)) return null;
    throw e;
  }
}

/** Os desenhistas: o cadastro (/api/desenhistas) e o "Desenhado por" das peças. */
async function nomesDeDesenhistas(api) {
  const [cadastro, produtos] = await Promise.all([
    api.get('/api/desenhistas').then(c.lista).catch(() => []),
    api.get('/api/produtos', { query: { select: 'id,desenhado_por' } }).then(c.lista).catch(() => [])
  ]);
  return unicos([...cadastro.map(d => d?.nome), ...produtos.map(p => p?.desenhado_por)]);
}

const semAcento = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
function unicos(nomes) {
  const mapa = new Map();
  for (const n of nomes) {
    const limpo = String(n ?? '').replace(/\s+/g, ' ').trim();
    if (limpo && !mapa.has(semAcento(limpo))) mapa.set(semAcento(limpo), limpo);
  }
  return [...mapa.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

/** As listas do modal: quem recebe em cada área, os tipos e as competências abertas. */
async function opcoes({ api }) {
  const regras = require('./regras');
  const rateios = require('./rateios');
  const base = require('./base');
  const comissoes = require('./comissoes');
  const [donos, desenhistas, tudo, colaboradores, fech, linhas] = await Promise.all([
    regras.donosDeClientes(api),
    nomesDeDesenhistas(api),
    regras.lerTudo(api),
    rateios.listarColaboradores(api).catch(() => null),
    base.lerFechamentos(api),
    lerTodos(api, {})
  ]);
  const regrasCms = tudo.regras.filter(r => r.tipo === 'cms' && regras.ativo(r.ativo)).map(r => r.beneficiario);
  const doAjuste = area => (linhas || []).filter(a => a.area === area).map(a => a.beneficiario);
  const estadoC = comissoes.estadoDosFechamentos({ ...fech, tipo: 'comissao' });
  const estadoP = comissoes.estadoDosFechamentos({ ...fech, tipo: 'producao' });
  return {
    sql_pendente: linhas === null,
    arquivo: SQL_ARQUIVO,
    areas: Object.entries(AREAS).map(([chave, rotulo]) => ({ chave, rotulo })),
    tipos: Object.entries(TIPOS).map(([chave, t]) => ({ chave, rotulo: t.rotulo, sinal: t.sinal })),
    pessoas: {
      cms: unicos([...donos, ...regrasCms, ...doAjuste('cms')]),
      royalty: unicos([...desenhistas, ...doAjuste('royalty')])
    },
    processos: tudo.etapas.filter(e => e.producao_ativa !== false).map(e => ({ id: e.id, nome: e.nome })),
    colaboradores: (colaboradores || []).map(x => ({ id: x.id, nome: x.nome })),
    proximas: { comissao: estadoC.proxima, producao: estadoP.proxima },
    fechadas: { comissao: [...estadoC.fechados.keys()], producao: [...estadoP.fechados.keys()] }
  };
}

/**
 * O mês de uma competência: os ajustes lançados nela (de todas as áreas) e o
 * que cada pessoa tem no mês hoje — é com isso que a tela mostra o "antes e
 * depois" e o que fica para o mês seguinte.
 */
async function doMes({ api, competencia, hoje, desde = null }) {
  if (!c.competenciaValida(competencia)) throw c.erro('Escolha a competência.');
  const fechamentos = require('./fechamentos');
  const producao = require('./producao');
  const comissoes = require('./comissoes');
  const nomesDosUsuarios = require('../historicoSocial').nomesDosUsuarios;
  const [dc, prod, linhas, nomes] = await Promise.all([
    fechamentos.dadosComissao(api, { competencia, hoje, desde }),
    producao.lerBase(api),
    lerTodos(api, {}),
    nomesDosUsuarios(api).catch(() => new Map())
  ]);
  const resumoC = comissoes.montarFechamento({ apuradas: dc.apuradas, estado: dc.estado, competencia, propria: true });
  const resumoP = producao.montarCompetencia({ pend: prod.pend, estado: prod.estado, competencia, propria: true });
  const congelados = new Map([...idsNoFechamento(dc.estado.congelados), ...idsNoFechamento(prod.estado.congelados)]);
  const doMesmo = (linhas || []).filter(a => naturalDe(a) === competencia)
    .sort((a, b) => String(b.criado_em || '').localeCompare(String(a.criado_em || '')) || Number(b.id) - Number(a.id));
  return {
    competencia,
    sql_pendente: linhas === null,
    fechada: { comissao: dc.estado.fechados.has(competencia), producao: prod.estado.fechados.has(competencia) },
    proximas: { comissao: dc.estado.proxima, producao: prod.estado.proxima },
    totais: {
      cms: resumoC.beneficiarios.filter(b => b.tipo === 'cms').map(b => ({ beneficiario: b.beneficiario, valor: c.centavos(b.valor) })),
      royalty: resumoC.beneficiarios.filter(b => b.tipo === 'royalty').map(b => ({ beneficiario: b.beneficiario, valor: c.centavos(b.valor) })),
      producao: resumoP.setores.map(s => ({ setor_id: s.setor_id, setor: s.setor, valor: c.centavos(s.total) }))
    },
    ajustes: doMesmo.map(a => paraTela(a, { nomes, congelados }))
  };
}

async function inserir(api, linha) {
  try {
    const criado = await api.post(`/api/${TABELA}`, linha);
    return { ...linha, ...(criado && typeof criado === 'object' && !Array.isArray(criado) ? criado : {}) };
  } catch (e) {
    if (tabelaAusente(e)) throw sqlPendente();
    throw e;
  }
}

const textoDoAjuste = (a, quem) => `${rotuloDoTipo(a.tipo)} de ${c.reais(a.valor)} (${Number(a.sinal) < 0 ? 'desconta' : 'soma'}) na ${AREAS[a.area]} de ${quem} em ${c.rotuloCompetencia(naturalDe(a))}`;

async function registrar({ api, entrada, usuarioId = null, hoje }) {
  const v = validar(entrada, { hoje });
  const base = require('./base');
  const comissoes = require('./comissoes');
  const auditoria = require('./auditoria');
  const tipoFechamento = FECHAMENTO_DA_AREA[v.area];
  const estado = comissoes.estadoDosFechamentos({ ...(await base.lerFechamentos(api)), tipo: tipoFechamento });
  if (estado.fechados.has(v.competencia) || (estado.proxima && v.competencia < estado.proxima)) {
    const qual = tipoFechamento === 'comissao' ? 'As comissões' : 'A produção';
    throw c.erro(`${qual} de ${c.rotuloCompetencia(v.competencia)} já ${tipoFechamento === 'comissao' ? 'foram fechadas' : 'foi fechada'}: o ajuste precisa entrar num mês aberto — ${c.rotuloCompetencia(estado.proxima)} ou depois.`, 409, { proxima: estado.proxima });
  }

  let beneficiario = v.beneficiario;
  let setor = null;
  if (v.area === 'producao') {
    const regras = require('./regras');
    const rateios = require('./rateios');
    const etapa = (await regras.lerTudo(api)).etapas.find(e => Number(e.id) === v.setorId);
    if (!etapa) throw c.erro('Processo da produção não encontrado.', 404);
    setor = etapa.nome;
    let colaborador = null;
    if (v.colaboradorId) {
      const lista = await rateios.listarColaboradores(api, { incluirDesligados: true });
      colaborador = (lista || []).find(x => Number(x.id) === v.colaboradorId) || null;
      if (!colaborador) throw c.erro('Colaborador não encontrado.', 404);
    }
    beneficiario = colaborador ? colaborador.nome : setor;
  }

  const ajuste = await inserir(api, {
    area: v.area, beneficiario, setor_id: v.setorId, setor, colaborador_id: v.colaboradorId,
    tipo: v.tipo, sinal: v.sinal, valor: v.valor, data_ajuste: v.data, competencia: v.competencia,
    referencia: v.referencia, motivo: v.motivo, observacao: v.observacao,
    status: 'ativo', criado_por: usuarioId, criado_em: c.agora()
  });
  const quem = setor && beneficiario !== setor ? `${beneficiario} (${setor})` : beneficiario;
  await auditoria.registrar(api, {
    tipo: 'ajuste_registrado', referenciaId: ajuste.id, valor: valorComSinal(ajuste), usuarioId,
    descricao: `${textoDoAjuste(ajuste, quem)}: ${v.motivo}${v.referencia ? ` · ref. ${v.referencia}` : ''}`,
    dados: { ajuste_pessoa: resumoDoAjuste(ajuste), beneficiario, setor }
  });
  return { ajuste: paraTela(ajuste) };
}

async function cancelar({ api, id, motivo, usuarioId = null }) {
  const texto = c.texto(motivo, 500);
  if (texto.length < 5) throw c.erro('Diga por que o ajuste está sendo cancelado.');
  const linhas = await lerTodos(api, { id: Number(id) });
  if (linhas === null) throw sqlPendente();
  const ajuste = linhas[0];
  if (!ajuste) throw c.erro('Ajuste não encontrado.', 404);
  if (ajuste.status !== 'ativo') throw c.erro('Este ajuste já foi cancelado.', 409);
  const base = require('./base');
  const fech = await base.lerFechamentos(api);
  const congelados = fech.itens.map(i => ({ ...i, detalhes: c.jsonDe(i.detalhes, {}) }));
  if (idsNoFechamento(congelados).has(String(ajuste.id))) {
    throw c.erro('Este ajuste já entrou num fechamento: não pode mais ser cancelado. Lance um ajuste ao contrário no mês aberto.', 409);
  }
  const campos = { status: 'cancelado', cancelado_em: c.agora(), cancelado_por: usuarioId, motivo_cancelamento: texto };
  try {
    await api.put(`/api/${TABELA}/${ajuste.id}`, campos);
  } catch (e) {
    if (tabelaAusente(e)) throw sqlPendente();
    throw e;
  }
  const auditoria = require('./auditoria');
  const avisos = require('../avisosEnvolvidos');
  const quem = ajuste.setor && ajuste.beneficiario !== ajuste.setor ? `${ajuste.beneficiario} (${ajuste.setor})` : ajuste.beneficiario;
  await auditoria.registrar(api, {
    tipo: 'ajuste_cancelado', referenciaId: ajuste.id, valor: c.centavos(-valorComSinal(ajuste)), usuarioId,
    descricao: `${textoDoAjuste(ajuste, quem)} cancelado: ${texto}`
  });
  // Quem lançou fica sabendo, com o motivo (como nos outros cancelamentos).
  await avisos.avisarPessoa(api, {
    para: ajuste.criado_por, usuarioId, origem: 'financeiro', tipo: 'registro_cancelado', titulo: 'Um ajuste seu foi cancelado',
    frase: autor => `${autor} cancelou o ajuste (${rotuloDoTipo(ajuste.tipo)}) de ${c.reais(ajuste.valor)} que você lançou na ${AREAS[ajuste.area]} de ${quem}.`,
    nota: `Motivo: ${texto}`
  }).catch(() => null);
  return { ajuste: paraTela({ ...ajuste, ...campos }) };
}

module.exports = {
  SQL_ARQUIVO, SQL_FALTANDO, TABELA, AREAS, FECHAMENTO_DA_AREA, TIPOS, MESES_A_FRENTE,
  lerValor, valorComSinal, rotuloDoTipo, validar, idsNoFechamento, itensDeComissao, linhasDeProducao, paraTela, impacto,
  tabelaAusente, lerTodos, opcoes, doMes, registrar, cancelar
};
