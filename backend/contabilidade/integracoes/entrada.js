/**
 * A caixa de entrada das buscas automáticas (contabil_dfe_recebidos): cada
 * NF-e (SEFAZ) ou NFS-e (ADN) em que a empresa aparece, uma linha por chave.
 *
 *   nova ........ só o resumo (NF-e ainda sem ciência) ou a NFS-e que ainda
 *                 não entrou nos documentos;
 *   completa .... o XML completo chegou (NF-e depois da ciência);
 *   registrada .. virou documento em "Documentos recebidos";
 *   ignorada .... alguém disse, com motivo, que não é despesa da empresa — ou
 *                 guardou como "Histórico" a nota do mês anterior ao início
 *                 da Contabilidade (é da empresa, mas não entra).
 *
 * A nota do mês anterior ao início não é registrada sozinha: espera a
 * decisão (registrar ou guardar como histórico). As de antes dele nem
 * chegam aqui (faseDaNota, decisão do dono em 02/10/2026).
 *
 * Gravar nunca piora o que já há: XML não some, registrada/ignorada não
 * voltam a nova, cancelada não volta a autorizada. Os eventos da nota
 * (cancelamento pelo emitente, ciência…) ficam na lista `eventos`.
 */
const c = require('../../financeiro/comum');
const b = require('../base');
const documentos = require('../documentosRecebidos');
const nfseAdn = require('./nfseAdn');

const TABELA = 'contabil_dfe_recebidos';
const ORIGENS = { sefaz_nfe: 'SEFAZ', nfse_adn: 'ADN' };
const STATUS = { nova: 'Nova', completa: 'XML completo', registrada: 'Registrada', ignorada: 'Ignorada' };
/* As visões da caixa de entrada (recebem a linha). A nota cancelada pelo
   emitente que nunca foi registrada não é pendência (não há o que fazer);
   aparece em "todas". A mesma regra de pendenciasDoMes (o painel). */
const VISOES = {
  pendentes: l => (l.status === 'nova' || l.status === 'completa') && l.situacao_nota !== 'cancelada',
  registradas: l => l.status === 'registrada',
  ignoradas: l => l.status === 'ignorada',
  todas: () => true
};
const FINAIS = new Set(['registrada', 'ignorada']);
/** O motivo de quem guardou como histórico começa assim (é uma "ignorada" que é nossa). */
const PREFIXO_HISTORICO = 'Histórico';

const vazio = v => v === null || v === undefined || v === '';

/**
 * Onde a nota cai em relação ao mês em que a Contabilidade começa
 * (`primeira`, AAAA-MM): 'antes' (antes do mês anterior: não entra),
 * 'anterior' (o mês anterior: fica para decidir — registrar ou guardar como
 * histórico), 'dentro' (do início em diante: o fluxo normal). Sem data ou
 * sem início, null (o fluxo normal). Pura.
 */
function faseDaNota(dataEmissao, primeira) {
  const mes = String(c.dia(dataEmissao) || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(mes) || !/^\d{4}-\d{2}$/.test(String(primeira || ''))) return null;
  const anterior = c.somarMeses(primeira, -1);
  if (mes < anterior) return 'antes';
  if (mes === anterior) return 'anterior';
  return 'dentro';
}

/** Todas as linhas (null = falta o SQL). */
function lerTodas(api) {
  return b.lerOpcional(api, TABELA);
}

const chaveDe = (origem, chave) => `${origem}|${chave}`;

/**
 * Junta o que chegou com o que já havia, sem piorar. Devolve só os campos a
 * gravar (e se é inserção). Pura.
 */
function mesclar(atual, novo) {
  const saida = {};
  const campos = ['nsu', 'numero', 'serie', 'municipio', 'emitente_documento', 'emitente_nome', 'data_emissao', 'valor', 'tipo'];
  for (const k of campos) if (!vazio(novo[k]) && (vazio(atual?.[k]) || k === 'nsu')) saida[k] = novo[k];
  if (!vazio(novo.xml) && vazio(atual?.xml)) { saida.xml = novo.xml; saida.resumo = false; }
  if (novo.resumo === false && atual?.resumo !== false) saida.resumo = false;
  const situacao = atual?.situacao_nota === 'cancelada' ? 'cancelada' : (novo.situacao_nota || atual?.situacao_nota || null);
  if (situacao !== (atual?.situacao_nota || null)) saida.situacao_nota = situacao;
  const eventos = [...c.lista(c.jsonDe(atual?.eventos, []))];
  for (const e of c.lista(novo.eventos)) {
    if (!eventos.some(x => x.tpEvento === e.tpEvento && x.dhEvento === e.dhEvento && x.protocolo === e.protocolo)) eventos.push(e);
  }
  if (eventos.length !== c.lista(c.jsonDe(atual?.eventos, [])).length) saida.eventos = JSON.stringify(eventos);
  if (!atual || !FINAIS.has(atual.status)) {
    const temXml = !vazio(novo.xml) || !vazio(atual?.xml);
    const status = (novo.tipo || atual?.tipo) === 'nfse' || temXml ? 'completa' : 'nova';
    if (status !== atual?.status) saida.status = status;
  }
  return { campos: saida, inserir: !atual };
}

/** Grava (insere ou atualiza pela chave). `indice` = Map(origem|chave → linha), atualizado aqui. */
async function gravar(api, indice, dados) {
  const k = chaveDe(dados.origem, dados.chave);
  const atual = indice.get(k) || null;
  const { campos, inserir } = mesclar(atual, dados);
  if (inserir) {
    const linha = await b.inserir(api, TABELA, {
      origem: dados.origem, tipo: dados.tipo, chave: dados.chave, resumo: vazio(dados.xml), status: campos.status || 'nova',
      ...campos, recebido_em: c.agora(), atualizado_em: c.agora()
    });
    indice.set(k, linha);
    return { linha, novo: true, mudou: true };
  }
  if (!Object.keys(campos).length) return { linha: atual, novo: false, mudou: false };
  await b.atualizar(api, TABELA, atual.id, { ...campos, atualizado_em: c.agora() });
  const linha = { ...atual, ...campos };
  indice.set(k, linha);
  return { linha, novo: false, mudou: true };
}

/**
 * Um evento chegou (cancelamento, ciência…): entra na lista da nota. Nota
 * desconhecida só ganha linha se o evento a cancela (para ninguém registrar
 * uma nota cancelada). Devolve a linha (ou null).
 */
async function aplicarEvento(api, indice, { origem, tipo, evento }) {
  if (!evento?.chave) return null;
  const atual = indice.get(chaveDe(origem, evento.chave)) || null;
  if (!atual && !evento.cancela) return null;
  const registro = { tpEvento: evento.tpEvento || evento.codigo_evento || null, descricao: evento.descricao || null, dhEvento: evento.dhEvento || null, protocolo: evento.protocolo || null };
  const r = await gravar(api, indice, { origem, tipo, chave: evento.chave, eventos: [registro], ...(evento.cancela ? { situacao_nota: 'cancelada' } : {}) });
  return r.linha;
}

/** O índice origem|chave → linha. */
const indexar = linhas => new Map(c.lista(linhas).filter(Boolean).map(l => [chaveDe(l.origem, l.chave), l]));

/** As manifestações que dizem "não é nossa" (22b: a nota fica pendente até ser ignorada à mão). */
const RECUSAS = ['desconhecimento', 'nao_realizada'];
const ROTULO_RECUSA = { desconhecimento: 'desconhecimento', nao_realizada: 'operação não realizada' };

/** Foi guardada como histórico (uma "ignorada" que é da empresa, de antes do início)? Pura. */
const ehHistorico = l => l?.status === 'ignorada' && String(l.ignorado_motivo || '').startsWith(PREFIXO_HISTORICO);

/**
 * Uma linha para a tela: o que ela é e o que dá para fazer. `primeira` é o
 * mês em que a Contabilidade começa (para a nota do mês anterior pedir a
 * decisão). Pura.
 */
function linhaPublica(l, { primeira = null } = {}) {
  const eventos = c.lista(c.jsonDe(l.eventos, []));
  const cancelada = l.situacao_nota === 'cancelada';
  const aberta = l.status === 'nova' || l.status === 'completa';
  const nfe = l.tipo === 'nfe';
  const manifestou = ['ciencia', 'confirmacao'].includes(l.manifestacao);
  const decidir = aberta && !cancelada && faseDaNota(l.data_emissao, primeira) === 'anterior';
  const recusada = aberta && RECUSAS.includes(l.manifestacao);
  return {
    decidir, decidir_texto: decidir ? `De ${c.rotuloCompetencia(c.somarMeses(primeira, -1))}, antes do início da Contabilidade (${c.rotuloCompetencia(primeira)}): registre ou guarde como histórico.` : null,
    recusada, recusada_texto: recusada ? `Manifestada na SEFAZ como ${ROTULO_RECUSA[l.manifestacao]}: continua pendente até alguém ignorar, com o motivo.` : null,
    historico: ehHistorico(l),
    id: l.id, origem: l.origem, origem_rotulo: ORIGENS[l.origem] || l.origem, tipo: l.tipo, tipo_rotulo: nfe ? 'NF-e' : 'NFS-e',
    chave: l.chave, nsu: l.nsu || null, numero: l.numero || null, serie: l.serie || null, municipio: l.municipio || null,
    emitente_documento: b.documentoFormatado(l.emitente_documento), emitente_nome: l.emitente_nome || null,
    data_emissao: c.dia(l.data_emissao), valor: l.valor === null || l.valor === undefined ? null : c.centavos(l.valor),
    situacao_nota: l.situacao_nota || 'autorizada', cancelada,
    status: l.status, status_rotulo: ehHistorico(l) ? 'Histórico' : (STATUS[l.status] || l.status), so_resumo: l.resumo !== false && !l.xml,
    manifestacao: l.manifestacao || null, manifestacao_em: b.instanteBR(l.manifestacao_em), manifestacao_erro: l.manifestacao_erro || null,
    eventos: eventos.map(e => ({ descricao: e.descricao, dhEvento: e.dhEvento })),
    documento_recebido_id: l.documento_recebido_id ?? null, erro: l.erro || null,
    ignorado_motivo: l.ignorado_motivo || null, recebido_em: b.instanteBR(l.recebido_em),
    pode: {
      manifestar: nfe && aberta && !cancelada,
      baixar_xml: nfe && aberta && !l.xml && manifestou && !cancelada,
      registrar: aberta && !cancelada && (nfe ? Boolean(l.xml) : true),
      ignorar: aberta,
      historico: decidir,
      restaurar: l.status === 'ignorada'
    }
  };
}

/**
 * A lista da tela: por origem e visão, a mais nova primeiro. `primeiras`
 * = { origem: AAAA-MM } (o início de cada busca).
 */
async function listar(api, { origem = null, visao = 'pendentes', competencia = null, primeiras = {} } = {}) {
  const linhas = await lerTodas(api);
  if (linhas === null) return { sql_pendente: true, linhas: [], contagem: {} };
  const filtro = VISOES[visao] || VISOES.pendentes;
  const escolhidas = linhas.filter(l => l && (!origem || l.origem === origem) && filtro(l)
    && (!competencia || String(c.dia(l.data_emissao) || '').startsWith(competencia)))
    .sort((x, y) => String(y.data_emissao || '').localeCompare(String(x.data_emissao || '')) || Number(y.id) - Number(x.id));
  const contagem = {};
  for (const [v, f] of Object.entries(VISOES)) contagem[v] = linhas.filter(l => l && (!origem || l.origem === origem) && f(l)).length;
  return { sql_pendente: false, linhas: escolhidas.slice(0, 500).map(l => linhaPublica(l, { primeira: primeiras?.[l.origem] || null })), contagem };
}

async function lerLinha(api, id) {
  const linha = (await b.ler(api, TABELA, { id: Number(id) }))[0] || null;
  if (!linha) throw c.erro('Documento não encontrado na caixa de entrada.', 404);
  return linha;
}

/** A entrada do "registrar" a partir da NFS-e lida do XML. Pura. */
function entradaDaNfse(l, lida, { gerarTitulo = false } = {}) {
  return {
    tipo: 'nfse', numero: lida.numero || l.numero, municipio: lida.municipio || l.municipio || 'Município não informado',
    codigo_verificacao: lida.codigo_verificacao, emitente_documento: lida.emitente_documento || l.emitente_documento,
    emitente_nome: lida.emitente_nome || l.emitente_nome, data_emissao: lida.data_emissao || c.dia(l.data_emissao),
    valor_total: lida.valor_servicos ?? l.valor, valor_iss: lida.valor_iss, iss_retido: Boolean(lida.iss_retido),
    valor_retencoes: lida.valor_retencoes, descricao: lida.descricao,
    gerar_titulo: gerarTitulo,
    arquivo: l.xml ? { nome: `NFSe-${l.chave}.xml`, tipo: 'application/xml', base64: Buffer.from(String(l.xml), 'utf8').toString('base64') } : null
  };
}

/** O documento já registrado que corresponde à linha (registro anterior, à mão ou pela busca). */
async function documentoExistente(api, l, lida = null) {
  const docs = (await b.ler(api, 'documentos_recebidos')).filter(d => d && !d.excluido_em);
  if (l.tipo === 'nfe') return docs.find(d => d.chave_acesso === l.chave) || null;
  const numero = String(lida?.numero || l.numero || '');
  const emitente = String(lida?.emitente_documento || l.emitente_documento || '');
  return docs.find(d => d.tipo === 'nfse' && String(d.numero) === numero && String(d.emitente_documento || '') === emitente) || null;
}

/**
 * Registra a linha em "Documentos recebidos". Já registrado antes (à mão)?
 * Só liga. Erro fica na linha (a busca automática segue com as outras).
 */
async function registrar(api, linhaOuId, { usuarioId = null, hoje, podeLancar = false, gerarTitulo = false, cnpjEmpresa = null } = {}) {
  const l = typeof linhaOuId === 'object' ? linhaOuId : await lerLinha(api, linhaOuId);
  if (FINAIS.has(l.status)) throw c.erro(l.status === 'registrada' ? 'Este documento já foi registrado.' : 'Este documento foi ignorado: restaure antes.', 409);
  if (l.situacao_nota === 'cancelada') throw c.erro('A nota foi cancelada pelo emitente: não entra nos documentos.', 409);
  let entrada;
  let automatico;
  let lida = null;
  if (l.tipo === 'nfe') {
    if (!l.xml) throw c.erro('Ainda não chegou o XML completo desta NF-e (dê ciência e busque de novo).', 409);
    entrada = { tipo: 'nfe', xml: l.xml, gerar_titulo: gerarTitulo };
    automatico = 'sefaz';
  } else {
    lida = l.xml ? nfseAdn.lerDocumento(l.xml, { cnpjEmpresa }) : {};
    entrada = entradaDaNfse(l, lida, { gerarTitulo });
    automatico = 'adn';
  }
  try {
    const r = await documentos.registrar(api, { entrada, usuarioId, hoje, podeLancar, automatico });
    await b.atualizar(api, TABELA, l.id, { status: 'registrada', documento_recebido_id: r.id, erro: null, atualizado_em: c.agora() });
    return { id: l.id, documento_recebido_id: r.id, titulo_id: r.titulo_id || null, avisos: r.avisos || [], ligado: false };
  } catch (e) {
    if (/já foi registrada/i.test(e.message || '')) {
      const existente = await documentoExistente(api, l, lida);
      if (existente) {
        await b.atualizar(api, TABELA, l.id, { status: 'registrada', documento_recebido_id: existente.id, erro: null, atualizado_em: c.agora() });
        return { id: l.id, documento_recebido_id: existente.id, titulo_id: null, avisos: ['Já estava registrado (à mão): só foi ligado.'], ligado: true };
      }
    }
    await b.atualizar(api, TABELA, l.id, { erro: String(e.message || e).slice(0, 1000), atualizado_em: c.agora() }).catch(() => {});
    throw e;
  }
}

async function ignorar(api, id, { motivo, usuarioId = null }) {
  const m = c.texto(motivo, 500);
  if (m.length < 5) throw c.erro('Diga por que o documento é ignorado (ao menos 5 letras).');
  const l = await lerLinha(api, id);
  if (FINAIS.has(l.status)) throw c.erro(l.status === 'registrada' ? 'Já registrado: exclua pela ficha do documento.' : 'Já ignorado.', 409);
  await b.atualizar(api, TABELA, l.id, { status: 'ignorada', ignorado_motivo: m, ignorado_por: usuarioId, ignorado_em: c.agora(), atualizado_em: c.agora() });
  return { id: l.id, status: 'ignorada' };
}

/**
 * A nota do mês anterior ao início: é da empresa, mas não entra na
 * Contabilidade — fica guardada como histórico (sai das pendências, volta
 * por "Restaurar").
 */
async function guardarComoHistorico(api, id, { usuarioId = null, primeira = null } = {}) {
  const l = await lerLinha(api, id);
  if (FINAIS.has(l.status)) throw c.erro(l.status === 'registrada' ? 'Já registrado: exclua pela ficha do documento.' : 'Já está fora das pendências.', 409);
  if (faseDaNota(l.data_emissao, primeira) !== 'anterior') throw c.erro('Guardar como histórico é só para as notas do mês anterior ao início da Contabilidade.', 409);
  const motivo = `${PREFIXO_HISTORICO}: de ${c.rotuloCompetencia(c.somarMeses(primeira, -1))}, antes do início da Contabilidade (${c.rotuloCompetencia(primeira)}).`;
  await b.atualizar(api, TABELA, l.id, { status: 'ignorada', ignorado_motivo: motivo, ignorado_por: usuarioId, ignorado_em: c.agora(), atualizado_em: c.agora() });
  return { id: l.id, status: 'ignorada', historico: true, linha: l };
}

async function restaurar(api, id) {
  const l = await lerLinha(api, id);
  if (l.status !== 'ignorada') throw c.erro('Só se restaura o que foi ignorado.', 409);
  const status = l.tipo === 'nfse' || l.xml ? 'completa' : 'nova';
  await b.atualizar(api, TABELA, l.id, { status, ignorado_motivo: null, ignorado_por: null, ignorado_em: null, atualizado_em: c.agora() });
  return { id: l.id, status };
}

/**
 * O que a caixa de entrada diz ao checklist da competência: as notas do mês
 * que ainda não entraram e as registradas que o emitente cancelou. Pura.
 */
function pendenciasDoMes(linhas, competencia) {
  const doMes = c.lista(linhas).filter(l => l && String(c.dia(l.data_emissao) || '').startsWith(competencia));
  const abertas = doMes.filter(l => (l.status === 'nova' || l.status === 'completa') && l.situacao_nota !== 'cancelada');
  const canceladasRegistradas = c.lista(linhas).filter(l => l && l.status === 'registrada' && l.situacao_nota === 'cancelada');
  return {
    abertas: abertas.map(l => ({ id: l.id, tipo: l.tipo, origem: l.origem, emitente: l.emitente_nome, valor: c.centavos(l.valor || 0), data: c.dia(l.data_emissao), resumo: !l.xml })),
    canceladas: canceladasRegistradas.map(l => ({ id: l.id, tipo: l.tipo, chave: l.chave, emitente: l.emitente_nome, documento_recebido_id: l.documento_recebido_id, data: c.dia(l.data_emissao) }))
  };
}

module.exports = {
  TABELA, ORIGENS, STATUS, VISOES, PREFIXO_HISTORICO, RECUSAS, lerTodas, chaveDe, mesclar, gravar, aplicarEvento, indexar, faseDaNota, ehHistorico,
  linhaPublica, listar, lerLinha, entradaDaNfse, registrar, ignorar, guardarComoHistorico, restaurar, pendenciasDoMes
};
