/**
 * Histórico persistente de autoria, separado dos campos "última atividade".
 * Só o backend informa o ator; não existe uma rota pública para inserir,
 * alterar ou apagar eventos. A migração também impede UPDATE/DELETE/TRUNCATE.
 */
const express = require('express');
const { createApiClient } = require('./apiHttpClient');
const { exigirSupAdmin } = require('./permissionsController');
const { diaEmSaoPaulo, diaValido } = require('./faturamentoPedido');

const TABELA = 'usuarios_auditoria';
const SQL_ARQUIVO = 'backend/scripts/ddl_usuarios_auditoria.sql';
const FUSO = 'America/Sao_Paulo';
const MAX_REGISTROS = 50000;
const ORIGENS = new Set(['manual', 'automatico', 'sistema', 'nao_confirmada']);
const RESULTADOS = new Set(['sucesso', 'falha', 'cancelado']);
// Não guardar corpos HTTP inteiros: só campos de negócio explicitamente conhecidos.
const CAMPOS = new Set((
  'id nome codigo numero status situacao perfil modelo_permissoes_id email telefone ' +
  'quantidade quantidade_original quantidade_atual quantidade_anterior quantidade_depois ' +
  'preco preco_base preco_venda valor valor_unitario valor_unitario_desc valor_total valor_final valor_original ' +
  'valor_pago valor_recebido valor_devolvido desconto desconto_total desconto_pagamento desconto_especial ' +
  'desconto_pagamento_prc desconto_especial_prc ajuste_valor parcelas prazo numero_parcela ' +
  'cliente_id pedido_id pedido_item_id produto_id insumo_id orcamento_id fornecedor_id ' +
  'usuario_id responsavel_id dono setor_id etapa_id ultimo_insumo_id lote_id unidade processo etapa ' +
  'qtd_a_produzir qtd_usar_pronta qtd_produzir_parcial ordem ordem_insumo ativo infinito ' +
  'data data_emissao data_vencimento data_pagamento data_recebimento embarcar_previsao embarcar_real ' +
  'inicio_faturamento faturamento_regra competencia tipo categoria_id colecao_id transportadora_id ' +
  'condicao forma_pagamento forma_de_pagamento ncm cfop percentual aliquota peso altura largura comprimento ' +
  'item_id itens linhas parciais decisoes permissoes producao_ativa confirmado aprovado reprovado ' +
  'total subtotal valor_itens quantidade_antes juntar_em novas removidas'
).split(/\s+/));
const SENSIVEL = /senha|password|token|secret|segredo|credential|credencial|certificado|anexo|arquivo|base64|foto|avatar|imagem|xml|pdf|authorization|cookie|api_?key|private_?key|chave_acesso|observac|descricao|mensagem|comentario|conteudo|body|headers/i;
const RECURSOS = new Set((
  'usuarios clientes contatos prospeccoes produtos materia_prima pedidos orcamentos transportadoras ' +
  'pedidos_itens orcamentos_itens pedido_parcelas orcamento_parcelas produtos_insumos produtos_em_cada_ponto ' +
  'tabela_fixa reservas_estoque colecao categoria unidades etapas_producao producao_setores producao_valores ' +
  'producao_eventos comissao_regras recebimentos boletos devolucoes reembolsos financeiro_feriados ' +
  'ordens_pagamento financeiro_fechamentos financeiro_pagamentos tarefas pedido_itens_ext pedidos_itens_faltantes'
).split(/\s+/));

function erro(status, mensagem, extra = {}) {
  return Object.assign(new Error(mensagem), { status, ...extra });
}
/** Só metadados técnicos: nunca mensagem, URL completa, corpo, token ou stack. */
function diagnosticoFalha(e, fase) {
  const status = Number(e?.status_http ?? e?.status);
  const code = typeof e?.code === 'string' && /^[a-zA-Z0-9_.-]{1,80}$/.test(e.code) ? e.code : 'SEM_CODIGO';
  return { fase, code, ...(Number.isInteger(status) && status >= 400 && status <= 599 ? { status_http: status } : {}),
    ...(e instanceof TypeError ? { tipo: 'TypeError' } : {}) };
}
async function identificarUsuarioDaRequisicao(req, api) {
  // A API REST genérica recebe ids numéricos. /usuarios/me seria tratado
  // como WHERE id = 'me' e causaria erro de conversão em produção.
  const id = inteiroPositivo(require('./usuarioAtual').usuarioDaRequisicao(req));
  if (!id) throw erro(401, 'Sessão não identificada.', { code: 'AUDITORIA_SEM_USUARIO' });
  const resposta = await api.get(`/api/usuarios/${id}`);
  const usuario = Array.isArray(resposta) ? resposta[0] : resposta;
  if (!inteiroPositivo(usuario?.id) || id && Number(usuario.id) !== id) {
    throw erro(401, 'Sessão não identificada.', { code: 'AUDITORIA_SEM_USUARIO' });
  }
  return usuario;
}
function inteiroPositivo(valor) {
  const n = Number(valor);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
function identificador(valor, padrao = '') {
  if (typeof valor !== 'string') return padrao;
  const s = valor.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /^[a-z][a-z0-9_.-]{0,79}$/.test(s) ? s : padrao;
}
function idDaAcao(valor) {
  return typeof valor === 'string' && /^(?:[a-f0-9]{16,64}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(valor) ? valor.toLowerCase() : null;
}
function contextoSeguro(valor) {
  const contexto = objetoJson(valor, {});
  const saida = {};
  for (const campo of ['evento', 'tela', 'alvo_id', 'canal', 'rota']) {
    const bruto = contexto[campo];
    if (bruto === null || bruto === undefined) continue;
    const s = String(bruto);
    const caminho = campo === 'rota' || campo === 'tela';
    if (s.length <= (caminho ? 180 : 100) && (caminho
      ? /^\/?[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(s)
      : /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(s))) saida[campo] = s;
  }
  return saida;
}
function descricaoDoEvento({ acao, entidade, entidade_id: id }) {
  const verbos = {
    criar: 'Criou', alterar: 'Alterou', atualizar: 'Atualizou', excluir: 'Excluiu', consultar: 'Consultou',
    registrar: 'Registrou', salvar: 'Salvou', entrar: 'Entrou', sair: 'Saiu', exportar: 'Exportou', importar: 'Importou',
    enviar: 'Enviou', cancelar: 'Cancelou', confirmar: 'Confirmou', aprovar: 'Aprovou', rejeitar: 'Rejeitou',
    sincronizar: 'Sincronizou', gerar: 'Gerou', pagar: 'Pagou', estornar: 'Estornou', converter: 'Converteu',
    'alterar-senha': 'Alterou a senha de', 'redefinir-senha': 'Redefiniu a senha de', 'alterar-avatar': 'Alterou a foto de'
  };
  return `${verbos[acao] || acao.replace(/[_.-]/g, ' ')} ${entidade.replace(/[_.-]/g, ' ')}${id ? ` #${id}` : ''}.`.slice(0, 250);
}
function campoPermitido(campo) {
  if (typeof campo !== 'string' || campo.length > 160 || SENSIVEL.test(campo)) return false;
  const partes = campo.replace(/\[\d+\]/g, '').split('.');
  return partes.length <= 5 && partes.every(p => CAMPOS.has(p));
}
/** Seleção conservadora para a captura não consultar endpoints de arquivos/segredos. */
function recursoPermitido(caminho) {
  if (typeof caminho !== 'string' || caminho.includes('?')) return false;
  const partes = caminho.replace(/^\/api\//, '').replace(/^\//, '').split('/');
  return partes.length <= 2 && RECURSOS.has(partes[0]) && (!partes[1] || /^[1-9]\d*$/.test(partes[1]));
}
function valorSeguro(valor, profundidade = 0) {
  if (valor === undefined || valor === null) return null;
  if (typeof valor === 'boolean') return valor;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor.toISOString();
  if (typeof valor === 'string') {
    // Mesmo num campo permitido, não aceitar um token, PEM, data URI ou blob.
    if (/data:|-----BEGIN|bearer\s|(?:senha|password|token|secret|api[_ -]?key)\s*[:=]/i.test(valor)
      || /^[A-Za-z0-9+/_=-]{40,}$/.test(valor.trim()) || /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(valor)) return '[conteúdo omitido]';
    return valor.slice(0, 250);
  }
  if (profundidade >= 3 || Buffer.isBuffer(valor)) return null;
  if (Array.isArray(valor)) return valor.slice(0, 100).map(v => valorSeguro(v, profundidade + 1));
  if (typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).filter(([k]) => campoPermitido(k)).slice(0, 80)
      .map(([k, v]) => [k, valorSeguro(v, profundidade + 1)]));
  }
  return null;
}
function objetoJson(valor, padrao) {
  if (typeof valor === 'string') {
    try { return JSON.parse(valor); } catch (_) { return padrao; }
  }
  return valor && typeof valor === 'object' ? valor : padrao;
}

/** Só mudanças relevantes em campos permitidos; nunca os snapshots completos. */
function sanitizarMudancas({ antes = {}, depois = {}, mudancas = [] } = {}) {
  const explicitas = objetoJson(mudancas, []);
  const anterior = objetoJson(antes, {});
  const posterior = objetoJson(depois, {});
  const derivadas = Object.keys(posterior).map(campo => ({ campo, antes: anterior[campo], depois: posterior[campo] }));
  const resultado = [];
  const vistos = new Set();
  for (const m of [...(Array.isArray(explicitas) ? explicitas : []), ...derivadas]) {
    if (!m || !campoPermitido(m.campo) || vistos.has(m.campo)) continue;
    const a = valorSeguro(m.antes ?? m.valor_anterior);
    const d = valorSeguro(m.depois ?? m.valor_novo);
    if (JSON.stringify(a) === JSON.stringify(d)) continue;
    vistos.add(m.campo);
    resultado.push({ campo: m.campo, antes: a, depois: d });
    if (resultado.length === 80) break;
  }
  return resultado;
}

/** O id do ator é fornecido pelo chamador autenticado do BACKEND. */
function normalizarEvento(evento = {}) {
  const modulo = identificador(evento.modulo);
  const acao = identificador(evento.acao);
  if (!modulo || !acao) throw erro(400, 'Informe o módulo e a ação da auditoria.', { code: 'AUDITORIA_EVENTO_INVALIDO' });
  const origem = ORIGENS.has(evento.origem) ? evento.origem : 'nao_confirmada';
  const usuarioId = inteiroPositivo(evento.usuarioId);
  if (!usuarioId && origem !== 'sistema') throw erro(401, 'A auditoria precisa do usuário autenticado.', { code: 'AUDITORIA_SEM_USUARIO' });
  const entidade = identificador(evento.entidade, modulo);
  const brutoId = evento.entidadeId ?? evento.entidade_id;
  const entidadeId = brutoId !== null && brutoId !== undefined && /^(?:[1-9]\d{0,15}|\d{4}-(?:0[1-9]|1[0-2]))$/.test(String(brutoId))
    ? String(brutoId) : null;
  const mudancas = sanitizarMudancas(evento);
  const payload = {
    usuario_id: usuarioId, modulo, acao, entidade, entidade_id: entidadeId,
    origem, resultado: RESULTADOS.has(evento.resultado) ? evento.resultado : 'sucesso',
    mudancas: JSON.stringify(mudancas), acao_id: idDaAcao(evento.acao_id ?? evento.acaoId),
    contexto: JSON.stringify(contextoSeguro(evento.contexto))
    // criado_em é DEFAULT/trigger no banco; relógios enviados pela tela não entram.
  };
  payload.descricao = descricaoDoEvento(payload);
  return payload;
}

function tabelaAusente(e) {
  const mensagem = `${e?.message || ''} ${e?.body?.error || ''} ${e?.body?.detalhe || ''}`;
  return e?.code === '42P01' || (mensagem.includes(TABELA) && /does not exist|não existe|não encontrada|not found/i.test(mensagem));
}
function erroSql() {
  return erro(409, `A auditoria ainda não está disponível: execute ${SQL_ARQUIVO} e reinicie a API do banco.`, {
    code: 'AUDITORIA_USUARIOS_SQL', sql_pendente: true, arquivo: SQL_ARQUIVO
  });
}
async function registrar(api, evento = {}) {
  const payload = normalizarEvento(evento);
  try {
    const r = await api.post(`/api/${TABELA}`, payload);
    const linha = Array.isArray(r) ? r[0] : r;
    if (!inteiroPositivo(linha?.id)) throw erro(502, 'A API não confirmou a persistência da auditoria.', { code: 'AUDITORIA_SEM_CONFIRMACAO' });
    return { ok: true, id: linha.id, criado_em: linha.criado_em || null };
  } catch (e) {
    if (tabelaAusente(e)) return { ok: false, sql_pendente: true, code: 'AUDITORIA_USUARIOS_SQL', arquivo: SQL_ARQUIVO };
    return { ok: false, sql_pendente: false, code: e.code || 'AUDITORIA_GRAVACAO_FALHOU', diagnostico: diagnosticoFalha(e, 'inserir-evento') };
  }
}

/** Sem confiar em usuario_id, relógio ou ator enviados no corpo da requisição. */
async function registrarDaRequisicao(req, evento = {}) {
  const api = createApiClient(req);
  const usuario = await identificarUsuarioDaRequisicao(req, api);
  if (!inteiroPositivo(usuario?.id)) throw erro(401, 'Sessão não identificada.');
  return registrar(api, { ...evento, usuarioId: usuario.id });
}

function filtrosDe(query = {}) {
  const usuarioId = inteiroPositivo(query.usuario_id);
  if (!usuarioId) throw erro(400, 'Informe um usuário válido para consultar a auditoria.');
  const datas = {};
  for (const campo of ['inicio', 'fim']) {
    if (query[campo] !== undefined && query[campo] !== '') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(query[campo])) || !diaValido(query[campo])) throw erro(400, `Data ${campo} inválida.`);
      datas[campo] = query[campo];
    }
  }
  if (datas.inicio && datas.fim && datas.inicio > datas.fim) throw erro(400, 'O início deve ser anterior ao fim.');
  const filtros = { usuario_id: usuarioId, ...datas };
  for (const campo of ['modulo', 'acao', 'origem', 'resultado']) {
    if (query[campo] === undefined || query[campo] === '') continue;
    const valor = identificador(query[campo]);
    if (!valor || (campo === 'origem' && !ORIGENS.has(valor)) || (campo === 'resultado' && !RESULTADOS.has(valor))) throw erro(400, `Filtro ${campo} inválido.`);
    filtros[campo] = valor;
  }
  return filtros;
}

function atendeFiltros(linha, filtros) {
  if (String(linha.usuario_id) !== String(filtros.usuario_id)) return false;
  const dia = diaEmSaoPaulo(linha.criado_em);
  if (!dia || (filtros.inicio && dia < filtros.inicio) || (filtros.fim && dia > filtros.fim)) return false;
  return ['modulo', 'acao', 'origem', 'resultado'].every(campo => !filtros[campo] || linha[campo] === filtros[campo]);
}

/**
 * A API de PROD faz filtros por igualdade e devolve a coleção completa;
 * não implementa os operadores PostgREST nem paginação (README.md).
 * O corte, os filtros por data e a paginação pertencem a este backend.
 */
async function carregarTodos(api, filtros, snapshot = null) {
  const iguais = Object.fromEntries(['modulo', 'acao', 'origem', 'resultado'].filter(c => filtros[c]).map(c => [c, filtros[c]]));
  let bruto;
  try {
    bruto = await api.get(`/api/${TABELA}`, { query: { usuario_id: filtros.usuario_id, ...iguais } });
  } catch (e) {
    if (tabelaAusente(e)) throw erroSql();
    throw e;
  }
  if (!Array.isArray(bruto)) throw erro(502, 'A API não confirmou a leitura completa da auditoria.', { code: 'AUDITORIA_LEITURA_INVALIDA' });
  const ids = new Set();
  let maiorId = 0;
  const linhas = [];
  for (const r of bruto) {
    const id = inteiroPositivo(r?.id);
    if (!id || ids.has(id)) throw erro(502, 'A API devolveu registros de auditoria inválidos ou repetidos.', { code: 'AUDITORIA_PAGINACAO_INVALIDA', export_incompleta: true });
    ids.add(id);
    maiorId = Math.max(maiorId, id);
    if ((snapshot === null || id <= snapshot) && atendeFiltros(r, filtros)) linhas.push(r);
    if (linhas.length > MAX_REGISTROS) throw erro(413, 'O período precisa ser dividido antes de exportar este histórico.', {
      code: 'AUDITORIA_LIMITE', export_incompleta: true, limite_registros: MAX_REGISTROS
    });
  }
  return { linhas, snapshot: snapshot ?? maiorId };
}

function paraSaida(linha) {
  const saida = {
    id: linha.id, usuario_id: linha.usuario_id, criado_em: linha.criado_em,
    modulo: identificador(linha.modulo), acao: identificador(linha.acao), entidade: identificador(linha.entidade),
    entidade_id: /^(?:[1-9]\d{0,15}|\d{4}-(?:0[1-9]|1[0-2]))$/.test(String(linha.entidade_id)) ? String(linha.entidade_id) : null,
    origem: ORIGENS.has(linha.origem) ? linha.origem : 'nao_confirmada',
    resultado: RESULTADOS.has(linha.resultado) ? linha.resultado : 'sucesso',
    mudancas: sanitizarMudancas({ mudancas: linha.mudancas }), acao_id: idDaAcao(linha.acao_id), contexto: contextoSeguro(linha.contexto)
  };
  saida.descricao = descricaoDoEvento(saida);
  return saida;
}
async function listar(api, query = {}) {
  const filtros = filtrosDe(query);
  const pagina = query.pagina === undefined ? 1 : inteiroPositivo(query.pagina);
  const limite = query.limite === undefined ? 50 : inteiroPositivo(query.limite);
  const snapshotPedido = query.snapshot === undefined || query.snapshot === '' ? null : Number(query.snapshot);
  if (!pagina || !limite || limite > 500 || (snapshotPedido !== null && (!Number.isSafeInteger(snapshotPedido) || snapshotPedido < 0))) throw erro(400, 'Paginação inválida.');
  const carregado = await carregarTodos(api, filtros, snapshotPedido);
  const snapshot = carregado.snapshot;
  const filtradas = carregado.linhas.sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em) || Number(b.id) - Number(a.id));
  const total = filtradas.length;
  const inicio = (pagina - 1) * limite;
  const temMais = inicio + limite < total;
  return {
    registros: filtradas.slice(inicio, inicio + limite).map(paraSaida), total, pagina, limite,
    paginas: Math.ceil(total / limite), tem_mais: temMais, proxima_pagina: temMais ? pagina + 1 : null,
    completo: true, sql_pendente: false, fuso: FUSO, filtros, snapshot,
    aviso_historico: 'Este histórico começa com a ativação da auditoria; os antigos campos de última atividade não reconstituem eventos anteriores.'
  };
}

function criarRouter({ criarApi = createApiClient, guarda = exigirSupAdmin } = {}) {
  const router = express.Router();
  router.get('/', guarda, async (req, res) => {
    try { res.json(await listar(criarApi(req), req.query)); }
    catch (e) {
      const diagnostico = diagnosticoFalha(e, 'consultar-historico');
      console.warn('[auditoria]', JSON.stringify(diagnostico));
      res.status(e.status || 503).json({ error: e.status && e.status < 500 ? e.message : 'Não foi possível obter o histórico completo de auditoria.',
        code: e.code || 'AUDITORIA_LEITURA_FALHOU', sql_pendente: e.sql_pendente === true,
        diagnostico,
        ...(e.arquivo ? { arquivo: e.arquivo } : {}), ...(e.export_incompleta ? { export_incompleta: true } : {}) });
    }
  });
  return router;
}

module.exports = criarRouter();
Object.assign(module.exports, { registrar, registrarDaRequisicao, listar, criarRouter, normalizarEvento, sanitizarMudancas,
  campoPermitido, valorSeguro, recursoPermitido, contextoSeguro, filtrosDe, tabelaAusente, diagnosticoFalha,
  identificarUsuarioDaRequisicao, TABELA, SQL_ARQUIVO, FUSO, MAX_REGISTROS });
