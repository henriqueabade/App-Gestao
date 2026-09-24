/**
 * Rateio da PRODUÇÃO entre colaboradores, processo a processo (24/09/2026).
 *
 * A produção paga por PROCESSO de cada PEÇA (marcenaria, acabamento,
 * montagem, embalagem…). O rateio diz **quem fez** cada um desses processos
 * e **quanto por cento** leva: a unidade é o par `pedido_item_id + setor_id`,
 * e o valor a repartir é o que aquele processo paga na competência.
 *
 * Decisões do dono (24/09/2026):
 *   - **por processo**, não por peça (quem fez a marcenaria pode não ser quem
 *     montou); a tela tem o atalho "mesma divisão em todos os processos desta
 *     peça" para quem quiser dividir a peça inteira de uma vez;
 *   - a soma de cada processo vai até 100% e **nunca passa**;
 *   - **fechar a competência de PRODUÇÃO exige 100%** em todo processo
 *     contabilizado — só quando existe colaborador cadastrado (sem ninguém, o
 *     recurso não está em uso e o Financeiro fecha como sempre fechou);
 *   - dá para ratear **a qualquer momento**, no que já foi decidido no mês:
 *     processo que ainda não foi confirmado nem aparece como linha da
 *     competência, então não há o que dividir;
 *   - remover é desligar (`ativo`), para o rastro não sumir.
 *
 * As contas são puras (testáveis sem rede); as de baixo falam com a API.
 * SQL: sql/producao_colaboradores_rateio.sql. Sem ele nada quebra: a tela
 * avisa e o fechamento não passa a exigir nada.
 */
const c = require('./comum');
const auditoria = require('./auditoria');

const SQL_ARQUIVO = 'sql/producao_colaboradores_rateio.sql';
const SQL_FALTANDO = `Falta rodar ${SQL_ARQUIVO} no banco e reiniciar a API.`;
const TABELAS = ['producao_colaboradores', 'producao_rateios'];
/** Tudo distribuído. Percentuais são guardados com 4 casas. */
const TOTAL = 100;
const CASAS = 4;
const TOLERANCIA = 0.0001;

const ativo = v => !(v === false || v === 'false' || v === 0 || v === 'f');
const arredondar = v => Math.round((Number(v) + Number.EPSILON) * 10 ** CASAS) / 10 ** CASAS;
/** A chave de um processo de uma peça: é a unidade do rateio. */
const chaveDoProcesso = (pedidoItemId, setorId) => `${pedidoItemId}:${setorId}`;

function sqlPendente() {
  return c.erro(SQL_FALTANDO, 409, { sql_pendente: true, arquivo: SQL_ARQUIVO });
}

// ------------------------------------------------------------- contas puras

/** O percentual digitado ("12,5", "12.5", 12.5) em número; null se não for. Pura. */
function lerPercentual(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const texto = String(valor).replace('%', '').replace(',', '.').trim();
  const n = Number(texto);
  return Number.isFinite(n) ? arredondar(n) : null;
}

/** Quanto já está distribuído num processo. Pura. */
function somaDosPercentuais(linhas) {
  return arredondar((linhas || []).filter(l => l && ativo(l.ativo)).reduce((s, l) => s + (Number(l.percentual) || 0), 0));
}

/** Quanto ainda cabe (nunca negativo). Pura. */
function restanteDoRateio(linhas) {
  return arredondar(Math.max(0, TOTAL - somaDosPercentuais(linhas)));
}

/** O processo está 100% distribuído? Pura. */
function rateioCompleto(linhas) {
  return Math.abs(somaDosPercentuais(linhas) - TOTAL) <= TOLERANCIA;
}

/** 12.5 → "12,5%"; 100 → "100%". Pura. */
function formatarPercentual(v) {
  const n = arredondar(Number(v) || 0);
  const texto = Number.isInteger(n) ? String(n) : String(n).replace('.', ',');
  return `${texto}%`;
}

/**
 * Pode entrar esta linha? Devolve a mensagem do problema, ou null.
 *
 * `ignorarId` é a própria linha quando se está EDITANDO — senão o percentual
 * dela contaria duas vezes contra o restante. Pura.
 */
function problemaDaLinha({ linhas = [], colaboradorId, percentual, ignorarId = null }) {
  const pct = lerPercentual(percentual);
  if (pct === null) return 'Informe o percentual.';
  if (pct <= 0) return 'O percentual precisa ser maior que zero.';
  if (pct > TOTAL) return 'O percentual não pode passar de 100%.';
  if (colaboradorId === null || colaboradorId === undefined || colaboradorId === '') return 'Escolha o colaborador.';

  const vivas = (linhas || []).filter(l => l && ativo(l.ativo) && String(l.id) !== String(ignorarId));
  if (vivas.some(l => String(l.colaborador_id) === String(colaboradorId))) {
    return 'Este colaborador já está neste processo. Edite a linha dele em vez de somar outra.';
  }
  const restante = arredondar(Math.max(0, TOTAL - somaDosPercentuais(vivas)));
  if (restante <= TOLERANCIA) return 'Este processo já está 100% distribuído: não cabe mais ninguém.';
  if (pct - restante > TOLERANCIA) return `Só restam ${formatarPercentual(restante)} para distribuir neste processo.`;
  return null;
}

/**
 * Reparte um valor entre as linhas do rateio, sem perder centavo: a sobra do
 * arredondamento vai para a maior fatia (a mesma regra do parcelamento). Pura.
 */
function distribuirValor(valor, linhas) {
  const vivas = (linhas || []).filter(l => l && ativo(l.ativo));
  if (!vivas.length) return [];
  const total = c.centavos(valor);
  const partes = vivas.map(l => ({
    colaborador_id: l.colaborador_id ?? null,
    colaborador: l.colaborador || null,
    percentual: arredondar(Number(l.percentual) || 0),
    valor: c.centavos(total * (Number(l.percentual) || 0) / TOTAL)
  }));
  const somaPartes = c.centavos(partes.reduce((s, p) => s + p.valor, 0));
  const sobra = c.centavos(total - somaPartes);
  if (Math.abs(sobra) >= 0.01) {
    const maior = partes.reduce((a, b) => (Math.abs(b.valor) > Math.abs(a.valor) ? b : a), partes[0]);
    maior.valor = c.centavos(maior.valor + sobra);
  }
  return partes;
}

/**
 * Os PROCESSOS CONTABILIZADOS da competência, agrupados por peça.
 *
 * Entram só as linhas de produção de verdade (`tipo_item: 'producao'`) que
 * têm peça e processo: saldo de competência anterior e estorno sem peça não
 * se rateiam. Várias linhas do mesmo processo (registros em dias diferentes)
 * viram um só. Pura.
 *
 * @param {Array} linhas `montarCompetencia(...).linhas`
 * @returns {Array} uma entrada por PEÇA, com os processos dentro
 */
function pecasDaCompetencia(linhas = []) {
  const porProcesso = new Map();
  for (const l of (linhas || []).filter(Boolean)) {
    if (l.tipo_item !== 'producao') continue;
    if (l.pedido_item_id === null || l.pedido_item_id === undefined) continue;
    if (l.setor_id === null || l.setor_id === undefined) continue;
    const k = chaveDoProcesso(l.pedido_item_id, l.setor_id);
    const atual = porProcesso.get(k) || {
      chave: k, pedido_item_id: l.pedido_item_id, setor_id: l.setor_id, setor: l.setor,
      pedido_id: l.pedido_id ?? null, pedido: l.pedido || null, produto_id: l.produto_id ?? null,
      produto: l.produto || `peça ${l.pedido_item_id}`, quantidade: 0, valor: 0, data: null
    };
    atual.quantidade += Number(l.quantidade) || 0;
    atual.valor = c.centavos(atual.valor + (Number(l.total) || 0));
    // A data mais recente é a que a tela mostra ("decidido em").
    if (l.data && (!atual.data || String(l.data) > String(atual.data))) atual.data = c.dia(l.data);
    porProcesso.set(k, atual);
  }

  const porPeca = new Map();
  for (const p of porProcesso.values()) {
    const k = String(p.pedido_item_id);
    const peca = porPeca.get(k) || {
      pedido_item_id: p.pedido_item_id, pedido_id: p.pedido_id, pedido: p.pedido,
      produto_id: p.produto_id, produto: p.produto, processos: [], valor: 0
    };
    peca.processos.push(p);
    peca.valor = c.centavos(peca.valor + p.valor);
    porPeca.set(k, peca);
  }
  return [...porPeca.values()]
    .map(peca => ({
      ...peca,
      processos: peca.processos.sort((a, b) => String(a.setor).localeCompare(String(b.setor), 'pt-BR'))
    }))
    .sort((a, b) => String(a.pedido || '').localeCompare(String(b.pedido || ''), 'pt-BR', { numeric: true })
      || String(a.produto).localeCompare(String(b.produto), 'pt-BR'));
}

/**
 * O estado de cada processo: quanto já foi distribuído, o que falta e quanto
 * cada um leva. Devolve a mesma árvore peça → processos. Pura.
 */
function estadoDasPecas({ pecas = [], rateios = [], colaboradores = [] }) {
  const nomeDo = new Map((colaboradores || []).filter(Boolean).map(x => [String(x.id), x.nome]));
  const porProcesso = new Map();
  for (const r of (rateios || []).filter(x => x && ativo(x.ativo))) {
    const k = chaveDoProcesso(r.pedido_item_id, r.setor_id);
    if (!porProcesso.has(k)) porProcesso.set(k, []);
    porProcesso.get(k).push({
      id: r.id, colaborador_id: r.colaborador_id,
      colaborador: nomeDo.get(String(r.colaborador_id)) || `colaborador ${r.colaborador_id}`,
      percentual: arredondar(Number(r.percentual) || 0), ativo: true
    });
  }

  return (pecas || []).map(peca => {
    const processos = peca.processos.map(p => {
      const linhas = (porProcesso.get(p.chave) || [])
        .sort((a, b) => b.percentual - a.percentual || String(a.colaborador).localeCompare(String(b.colaborador), 'pt-BR'));
      const distribuido = somaDosPercentuais(linhas);
      return {
        ...p,
        linhas: linhas.map(l => ({ ...l, valor: c.centavos((Number(p.valor) || 0) * l.percentual / TOTAL) })),
        distribuido,
        restante: arredondar(Math.max(0, TOTAL - distribuido)),
        completo: Math.abs(distribuido - TOTAL) <= TOLERANCIA
      };
    });
    const completos = processos.filter(p => p.completo).length;
    return {
      ...peca, processos,
      processos_completos: completos,
      completo: completos === processos.length && processos.length > 0
    };
  });
}

/** Os processos que ainda não fecham 100%. Pura. */
function processosPendentes(estado) {
  return (estado || []).flatMap(peca => peca.processos.filter(p => !p.completo).map(p => ({ ...p, produto: peca.produto, pedido: peca.pedido })));
}

/** Quantas PEÇAS e quantos PROCESSOS há no estado (são números diferentes). Pura. */
function contagem(estado) {
  const pecas = (estado || []).length;
  const processos = (estado || []).reduce((s, p) => s + p.processos.length, 0);
  return { pecas, processos, unidades: (estado || []).reduce((s, p) => s + p.processos.reduce((t, x) => t + (Number(x.quantidade) || 0), 0), 0) };
}

/** O que cada colaborador tem a receber, somando todos os processos. Pura. */
function resumoPorColaborador(estado) {
  const mapa = new Map();
  for (const peca of estado || []) {
    for (const processo of peca.processos) {
      for (const l of processo.linhas || []) {
        const k = String(l.colaborador_id);
        const atual = mapa.get(k) || { colaborador_id: l.colaborador_id, colaborador: l.colaborador, valor: 0, processos: 0 };
        atual.valor = c.centavos(atual.valor + (Number(l.valor) || 0));
        atual.processos += 1;
        mapa.set(k, atual);
      }
    }
  }
  return [...mapa.values()].sort((a, b) => b.valor - a.valor || String(a.colaborador).localeCompare(String(b.colaborador), 'pt-BR'));
}

/**
 * O bloqueio do fechamento da PRODUÇÃO, se houver. Pura.
 *
 * Só existe quando há colaborador cadastrado: sem nenhum, o rateio não está
 * em uso e o fechamento segue como sempre.
 */
function bloqueioDoFechamento({ estado = [], temColaboradores = false }) {
  if (!temColaboradores) return null;
  const faltando = processosPendentes(estado);
  if (!faltando.length) return null;
  const exemplos = faltando.slice(0, 3)
    .map(p => `${p.pedido || `pedido ${p.pedido_id}`} · ${p.produto} · ${p.setor} (${formatarPercentual(p.distribuido)} de 100%)`)
    .join('; ');
  return `${c.plural(faltando.length, 'processo ainda não foi distribuído', 'processos ainda não foram distribuídos')} entre os colaboradores: ${exemplos}${faltando.length > 3 ? '…' : ''}. Abra "Rateio da produção" e complete 100% de cada processo para fechar.`;
}

// ------------------------------------------------------------------ leitura

/**
 * A tabela desta fase ainda não existe? O `c.tabelaAusente` só conhece as
 * tabelas da fase G, então esta olha pelos nomes de cá.
 */
function tabelaAusente(err) {
  const bruto = `${err?.message || ''} ${err?.body?.error || ''} ${err?.body?.detalhe || ''} ${err?.code || ''}`;
  if (/42P01/.test(bruto)) return true;
  const cita = TABELAS.some(t => bruto.includes(t));
  return cita && (/does not exist|não encontrada|não existe/i.test(bruto) || err?.status === 404);
}

/** Lê uma tabela desta fase; sem o SQL, devolve null (quem chama decide). */
async function lerSePuder(api, tabela, query = {}) {
  try {
    const linhas = c.lista(await api.get(`/api/${tabela}`, { query }));
    return linhas.filter(l => l && Object.entries(query).every(([col, v]) => String(l[col]) === String(v)));
  } catch (e) {
    if (tabelaAusente(e)) return null;
    throw e;
  }
}

/** Os colaboradores, em ordem alfabética. `null` quando falta o SQL. */
async function listarColaboradores(api, { incluirDesligados = false } = {}) {
  const linhas = await lerSePuder(api, 'producao_colaboradores');
  if (linhas === null) return null;
  return linhas
    .filter(x => incluirDesligados || ativo(x.ativo))
    .map(x => ({ id: x.id, nome: x.nome, funcao: x.funcao || null, observacao: x.observacao || null, ativo: ativo(x.ativo) }))
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
}

/** Todos os rateios vivos. `null` quando falta o SQL. */
async function listarRateios(api) {
  const linhas = await lerSePuder(api, 'producao_rateios');
  if (linhas === null) return null;
  return linhas.filter(x => ativo(x.ativo));
}

/**
 * A visão do rateio de uma competência, pronta para a tela e para o
 * fechamento. Nunca quebra: sem o SQL desta fase devolve `sql_pendente` e
 * nenhum bloqueio.
 *
 * @param {Array} linhas `montarCompetencia(...).linhas` da produção
 */
async function lerVisao({ api, linhas = [] }) {
  const [colaboradores, rateios] = await Promise.all([listarColaboradores(api), listarRateios(api)]);
  if (colaboradores === null || rateios === null) {
    return {
      sql_pendente: true, arquivo: SQL_ARQUIVO, colaboradores: [], pecas: [], resumo: [],
      pendentes: 0, total: 0, contagem: { pecas: 0, processos: 0, unidades: 0 }, bloqueio: null
    };
  }
  const estado = estadoDasPecas({ pecas: pecasDaCompetencia(linhas), rateios, colaboradores });
  return {
    sql_pendente: false,
    colaboradores,
    pecas: estado,
    resumo: resumoPorColaborador(estado),
    pendentes: processosPendentes(estado).length,
    contagem: contagem(estado),
    total: c.centavos(estado.reduce((s, p) => s + (Number(p.valor) || 0), 0)),
    bloqueio: bloqueioDoFechamento({ estado, temColaboradores: colaboradores.length > 0 })
  };
}

// ------------------------------------------------------------ colaboradores

async function salvarColaborador({ api, dados = {}, usuarioId = null }) {
  const existentes = await listarColaboradores(api, { incluirDesligados: true });
  if (existentes === null) throw sqlPendente();
  const nome = c.texto(dados.nome, 120);
  if (nome.length < 2) throw c.erro('Informe o nome do colaborador.');
  const id = dados.id ?? null;
  const repetido = existentes.find(x => x.ativo && String(x.id) !== String(id)
    && String(x.nome).trim().toLowerCase() === nome.toLowerCase());
  if (repetido) throw c.erro(`Já existe um colaborador chamado "${repetido.nome}".`, 409);

  const campos = { nome, funcao: c.texto(dados.funcao, 80) || null, observacao: c.texto(dados.observacao, 300) || null };
  if (id) {
    const vivo = dados.ativo === undefined ? true : ativo(dados.ativo);
    await c.atualizar(api, 'producao_colaboradores', id, { ...campos, ativo: vivo, atualizado_por: usuarioId, atualizado_em: c.agora() });
    await auditoria.registrar(api, { tipo: 'colaborador_editado', descricao: `Colaborador "${nome}" atualizado.`, usuarioId }).catch(() => {});
    return { colaborador: { id, ...campos, ativo: vivo } };
  }
  const criado = await c.inserir(api, 'producao_colaboradores', { ...campos, ativo: true, criado_por: usuarioId, criado_em: c.agora() });
  await auditoria.registrar(api, { tipo: 'colaborador_criado', descricao: `Colaborador "${nome}" cadastrado.`, usuarioId }).catch(() => {});
  return { colaborador: criado };
}

/**
 * Desliga um colaborador. Os processos em que ele aparece perdem a parte
 * dele — e voltam a ficar incompletos —, então o rateio dele sai junto:
 * deixar linha viva apontando para quem não existe mais é pior.
 */
async function removerColaborador({ api, id, usuarioId = null }) {
  const colaboradores = await listarColaboradores(api, { incluirDesligados: true });
  if (colaboradores === null) throw sqlPendente();
  const alvo = colaboradores.find(x => String(x.id) === String(id));
  if (!alvo) throw c.erro('Colaborador não encontrado.', 404);

  const rateios = (await listarRateios(api)) || [];
  const dele = rateios.filter(r => String(r.colaborador_id) === String(id));
  const quando = c.agora();
  for (const r of dele) {
    await c.atualizar(api, 'producao_rateios', r.id, { ativo: false, removido_por: usuarioId, removido_em: quando });
  }
  await c.atualizar(api, 'producao_colaboradores', id, { ativo: false, atualizado_por: usuarioId, atualizado_em: quando });
  await auditoria.registrar(api, {
    tipo: 'colaborador_desligado',
    descricao: `Colaborador "${alvo.nome}" desligado${dele.length ? ` (saiu de ${c.plural(dele.length, 'processo', 'processos')})` : ''}.`,
    usuarioId
  }).catch(() => {});
  return { ok: true, processos_afetados: dele.length };
}

// ------------------------------------------------------------------ rateio

/** Grava (ou edita) uma linha do rateio de UM processo. */
async function salvarLinha({ api, dados = {}, usuarioId = null }) {
  const rateios = await listarRateios(api);
  if (rateios === null) throw sqlPendente();
  const colaboradores = (await listarColaboradores(api)) || [];

  const pedidoItemId = Number(dados.pedido_item_id);
  const setorId = Number(dados.setor_id);
  if (!Number.isInteger(pedidoItemId) || pedidoItemId <= 0) throw c.erro('Peça inválida.');
  if (!Number.isInteger(setorId) || setorId <= 0) throw c.erro('Processo inválido.');
  const colaboradorId = Number(dados.colaborador_id);
  if (!colaboradores.some(x => Number(x.id) === colaboradorId)) throw c.erro('Escolha um colaborador ativo.');

  const doProcesso = rateios.filter(r => chaveDoProcesso(r.pedido_item_id, r.setor_id) === chaveDoProcesso(pedidoItemId, setorId));
  const problema = problemaDaLinha({ linhas: doProcesso, colaboradorId, percentual: dados.percentual, ignorarId: dados.id ?? null });
  if (problema) {
    throw c.erro(problema, 422, { restante: restanteDoRateio(doProcesso.filter(l => String(l.id) !== String(dados.id ?? null))) });
  }

  const percentual = lerPercentual(dados.percentual);
  const campos = {
    pedido_id: Number(dados.pedido_id) || null,
    pedido_item_id: pedidoItemId,
    setor_id: setorId,
    produto_id: dados.produto_id === null || dados.produto_id === undefined ? null : Number(dados.produto_id),
    colaborador_id: colaboradorId,
    percentual
  };
  const nome = colaboradores.find(x => Number(x.id) === colaboradorId)?.nome || `colaborador ${colaboradorId}`;
  if (dados.id) {
    await c.atualizar(api, 'producao_rateios', dados.id, campos);
    await auditoria.registrar(api, { tipo: 'rateio_editado', descricao: `Rateio da peça ${pedidoItemId} (processo ${setorId}): ${nome} passou a ${formatarPercentual(percentual)}.`, usuarioId }).catch(() => {});
    return { linha: { id: dados.id, ...campos, ativo: true, colaborador: nome } };
  }
  const criada = await c.inserir(api, 'producao_rateios', { ...campos, ativo: true, criado_por: usuarioId, criado_em: c.agora() });
  await auditoria.registrar(api, { tipo: 'rateio_criado', descricao: `Rateio da peça ${pedidoItemId} (processo ${setorId}): ${formatarPercentual(percentual)} para ${nome}.`, usuarioId }).catch(() => {});
  return { linha: criada };
}

/**
 * Copia a divisão de um processo para TODOS os processos da mesma peça — o
 * atalho de quem divide a peça inteira do mesmo jeito (decisão do dono).
 *
 * Só entra onde ainda cabe: processo que já tem gente é deixado como está, e
 * volta na resposta como `pulados`, para a tela poder dizer.
 */
async function aplicarNaPeca({ api, dados = {}, usuarioId = null }) {
  const rateios = await listarRateios(api);
  if (rateios === null) throw sqlPendente();
  const pedidoItemId = Number(dados.pedido_item_id);
  const setores = (Array.isArray(dados.setores) ? dados.setores : []).map(Number).filter(n => Number.isInteger(n) && n > 0);
  const modelo = (Array.isArray(dados.linhas) ? dados.linhas : [])
    .map(l => ({ colaborador_id: Number(l.colaborador_id), percentual: lerPercentual(l.percentual) }))
    .filter(l => Number.isInteger(l.colaborador_id) && l.percentual > 0);
  if (!modelo.length) throw c.erro('Nada para copiar: distribua um processo primeiro.');
  if (!setores.length) throw c.erro('Nenhum outro processo nesta peça.');
  if (Math.abs(modelo.reduce((s, l) => s + l.percentual, 0) - TOTAL) > TOLERANCIA) {
    throw c.erro('Só dá para copiar uma divisão que fecha 100%.');
  }

  let aplicados = 0;
  const pulados = [];
  for (const setorId of setores) {
    const doProcesso = rateios.filter(r => chaveDoProcesso(r.pedido_item_id, r.setor_id) === chaveDoProcesso(pedidoItemId, setorId));
    if (somaDosPercentuais(doProcesso) > TOLERANCIA) { pulados.push(setorId); continue; }
    for (const l of modelo) {
      await c.inserir(api, 'producao_rateios', {
        pedido_id: Number(dados.pedido_id) || null, pedido_item_id: pedidoItemId, setor_id: setorId,
        produto_id: dados.produto_id === null || dados.produto_id === undefined ? null : Number(dados.produto_id),
        colaborador_id: l.colaborador_id, percentual: l.percentual,
        ativo: true, criado_por: usuarioId, criado_em: c.agora()
      });
    }
    aplicados += 1;
  }
  await auditoria.registrar(api, {
    tipo: 'rateio_copiado',
    descricao: `Divisão copiada para ${c.plural(aplicados, 'processo', 'processos')} da peça ${pedidoItemId}${pulados.length ? ` (${pulados.length} já tinha divisão)` : ''}.`,
    usuarioId
  }).catch(() => {});
  return { aplicados, pulados: pulados.length };
}

async function removerLinha({ api, id, usuarioId = null }) {
  const rateios = await listarRateios(api);
  if (rateios === null) throw sqlPendente();
  const alvo = rateios.find(r => String(r.id) === String(id));
  if (!alvo) throw c.erro('Linha do rateio não encontrada.', 404);
  await c.atualizar(api, 'producao_rateios', id, { ativo: false, removido_por: usuarioId, removido_em: c.agora() });
  await auditoria.registrar(api, { tipo: 'rateio_removido', descricao: `Rateio da peça ${alvo.pedido_item_id} sem a parte de ${formatarPercentual(alvo.percentual)}.`, usuarioId }).catch(() => {});
  return { ok: true };
}

module.exports = {
  SQL_ARQUIVO, SQL_FALTANDO, TABELAS, TOTAL, TOLERANCIA, chaveDoProcesso,
  lerPercentual, formatarPercentual, somaDosPercentuais, restanteDoRateio, rateioCompleto,
  problemaDaLinha, distribuirValor, pecasDaCompetencia, estadoDasPecas, processosPendentes,
  contagem, resumoPorColaborador, bloqueioDoFechamento,
  tabelaAusente, lerVisao, listarColaboradores, listarRateios,
  salvarColaborador, removerColaborador, salvarLinha, aplicarNaPeca, removerLinha
};
