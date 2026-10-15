/** Captura por operação, com autoria isolada entre IPC, HTTP e segundo plano. */
const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');
const armazenamento = new AsyncLocalStorage();
const EMBRULHADO = Symbol('auditoria-captura');
const MAX_EVENTOS = 1000;
let sistemaAtivo = false;
const ultimasPorUsuario = new Map();
const filasPorUsuario = new Map();
const ESCRITAS = new Set(['post', 'put', 'patch', 'delete']);
const auditoria = () => require('./auditoriaUsuarios');

function semAuditoria(fn) { return armazenamento.run({ suprimido: true }, fn); }
function ativarCapturaSistema() { sistemaAtivo = true; }
function capturaSistemaAtiva() { return sistemaAtivo; }
/** Só o backend chama, depois de confirmar uma operação autenticada sem dados auditáveis (ex.: avatar). */
function confirmarMudancaProtegida(acao = 'alterar-avatar', alvoId = null) {
  const ctx = armazenamento.getStore();
  if (!ctx || ctx.suprimido || ctx.encerrando || !['alterar-avatar', 'alterar-senha'].includes(acao)) return false;
  ctx.protegida = true;
  ctx.acaoProtegida = acao;
  ctx.escrita = true;
  ctx.entidadeId = usuarioId(alvoId) || ctx.entidadeId || ctx.usuarioId;
  return true;
}
function usuarioId(valor) { const n = Number(valor); return Number.isSafeInteger(n) && n > 0 ? n : null; }
function idAcao(valor) { return typeof valor === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(valor) ? valor : null; }
function slug(valor, padrao = '') {
  if (typeof valor !== 'string') return padrao;
  const s = valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[:\s_]+/g, '-');
  return /^[a-z][a-z0-9_.-]{0,79}$/.test(s) ? s : padrao;
}
function caminhoSeguro(valor) {
  if (typeof valor !== 'string' || valor.includes('?') || valor.includes('#')) return null;
  const s = valor.replace(/^\/api\//, '/').replace(/^([^/])/, '/$1');
  return /^\/[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(s) ? s : null;
}
function recurso(caminho) {
  const seguro = caminhoSeguro(caminho);
  if (!seguro) return null;
  const [tabela, id] = seguro.slice(1).split('/');
  if (!auditoria().recursoPermitido(seguro)) return null;
  return { tabela, id: usuarioId(id), caminho: seguro };
}
function corpoSeguro(corpo) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo) || Buffer.isBuffer(corpo)) return {};
  return Object.fromEntries(Object.keys(corpo).filter(auditoria().campoPermitido).map(c => [c, auditoria().valorSeguro(corpo[c])]));
}
function corpoDaEntrada(payload) {
  if (Array.isArray(payload)) return payload.find(p => p && typeof p === 'object' && !Array.isArray(p)) || {};
  if (payload?.dados && typeof payload.dados === 'object' && !Array.isArray(payload.dados)) return { ...payload.dados, ...(payload.id === undefined ? {} : { id: payload.id }) };
  return payload?.body || payload?.data || payload || {};
}
function moduloDe(nome) {
  const texto = String(nome || '').toLowerCase();
  if (/materia[-_\s]?prima/.test(texto)) return 'materia-prima';
  for (const [rx, modulo] of [[/pedido/, 'pedidos'], [/orcamento/, 'orcamentos'], [/produto|tabela[-_]fixa/, 'produtos'],
    [/usuario|perfil/, 'usuarios'], [/cliente/, 'clientes'], [/contato/, 'contatos'], [/prospecc/, 'prospeccoes'],
    [/financeiro|producao|comissao|recebimento|boleto/, 'financeiro']]) {
    if (rx.test(texto)) return modulo;
  }
  const parte = texto.replace(/^\/api\//, '').replace(/^\//, '').split(/[/:_.-]/)[0];
  return ({ pedido: 'pedidos', pedidos: 'pedidos', orcamento: 'orcamentos', produto: 'produtos', usuario: 'usuarios',
    cliente: 'clientes', contato: 'contatos', prospeccao: 'prospeccoes', materia: 'materia-prima',
    tabela: 'produtos', reservas: 'produtos', producao: 'financeiro', comissao: 'financeiro' })[parte] || slug(parte, 'sistema');
}
function acaoDe(metodo, canal = '') {
  if (/senha|password/i.test(canal)) return 'alterar-senha';
  const s = String(canal).toLowerCase();
  if (/exclu|remov|delet/.test(s)) return 'excluir';
  if (/cri(ar|a|acao)|create|adicion|insert|cadastr/.test(s)) return 'criar';
  if (/atualiz|alter|salvar|save|update|edit/.test(s)) return 'atualizar';
  return ({ post: 'criar', put: 'atualizar', patch: 'atualizar', delete: 'excluir', get: 'consultar' })[String(metodo).toLowerCase()] || 'executar';
}
function criarContexto({ usuarioId: ator = null, canal = '', payload = {}, contexto = {}, metodo = null, req = null, sistema = false }, opcoes = {}) {
  contexto = contexto && typeof contexto === 'object' && !Array.isArray(contexto) ? contexto : {};
  const acaoId = idAcao(contexto.acao_id || contexto.acaoId);
  const origem = sistema ? 'sistema' : acaoId && ['manual', 'automatico'].includes(contexto.origem) ? contexto.origem : 'nao_confirmada';
  const seguro = corpoSeguro(corpoDaEntrada(payload));
  const rota = caminhoSeguro(canal);
  const idRota = rota?.split('/').find(p => /^[1-9]\d*$/.test(p));
  const entrada = corpoDaEntrada(payload);
  const protegida = /senha|password/i.test(canal) || entrada && typeof entrada === 'object' && Object.hasOwn(entrada, 'senha')
    ? 'alterar-senha' : /avatar|foto/i.test(canal) ? 'alterar-avatar' : null;
  return { usuarioId: usuarioId(ator), canal, metodo, req, payload: seguro,
    modulo: moduloDe(canal), acao: slug(contexto.operacao || contexto.acao, acaoDe(metodo, canal)),
    entidade: moduloDe(canal), entidadeId: idRota ?? usuarioId(seguro.id) ?? (['number', 'string'].includes(typeof payload) ? usuarioId(payload) : null),
    origem, acaoId: acaoId || randomUUID(),
    contexto: auditoria().contextoSeguro({ evento: contexto.evento || slug(canal.replace(/[\/]/g, '-').replace(/^-/, '')),
      tela: contexto.tela, alvo_id: contexto.alvo_id ?? idRota, canal: req ? 'http' : sistema ? 'sistema' : 'ipc', rota: req ? canal : undefined }),
    eventos: [], pendentes: new Set(), erros: [], encerrando: false, finalizado: false,
    protegida: false, acaoProtegida: protegida, escrita: false, falhaEfeito: false, opcoes, ultimaAcao: null };
}
function pendencia(ctx, code) {
  if (!ctx.erros.includes(code)) ctx.erros.push(code);
}
function enfileirar(ctx, evento) {
  if (ctx.eventos.length >= MAX_EVENTOS) { pendencia(ctx, 'AUDITORIA_LIMITE_EVENTOS'); return; }
  ctx.eventos.push(evento);
}
function origemDoEfeito(ctx) { return ctx.origem === 'manual' ? 'automatico' : ctx.origem; }
function mesmaEntidade(ctx, r) {
  return moduloDe(r.tabela) === ctx.modulo && (ctx.entidadeId === null || String(ctx.entidadeId) === String(r.id));
}

async function capturar(api, metodo, args, executar, ctx) {
  const [caminho, corpo] = args;
  const r = recurso(caminho);
  if (!r) {
    const resposta = await executar();
    if (ctx.acaoProtegida && resposta?.success !== false && resposta?.ok !== false && !resposta?.error) ctx.protegida = true;
    return resposta;
  }
  const seguro = metodo === 'delete' ? {} : corpoSeguro(corpo);
  const protegida = r.tabela === 'usuarios' && corpo && typeof corpo === 'object' && Object.hasOwn(corpo, 'senha');
  const camposEnviados = Object.keys(corpo && typeof corpo === 'object' ? corpo : {});
  if (r.tabela === 'usuarios' && camposEnviados.length && camposEnviados.every(c => /^(?:ultima_(?:atividade|entrada|saida|alteracao|acao)(?:_em)?|local_ultima_(?:alteracao|acao)|especificacao_ultima_(?:alteracao|acao))$/.test(c))) return executar();
  // Mesmo sem valores permitidos, guardar a operação e o resultado.
  // Conteúdos protegidos nunca são copiados para o evento.
  let antes = {};
  let antesConhecido = false;
  if (r.id && ['put', 'patch', 'delete'].includes(metodo) && (metodo === 'delete' || Object.keys(seguro).length)) {
    try {
      const bruto = await semAuditoria(() => api.get(caminho));
      const linha = Array.isArray(bruto) ? bruto[0] : bruto;
      if (linha && !linha.error) { antes = corpoSeguro(linha); antesConhecido = true; }
    } catch (_) { pendencia(ctx, 'AUDITORIA_ANTES_INDISPONIVEL'); }
  }
  let resultado;
  let falha;
  try { resultado = await executar(); } catch (e) { falha = e; }
  const linha = Array.isArray(resultado) ? resultado[0] : resultado;
  const sucesso = !falha && resultado?.success !== false && resultado?.ok !== false && !resultado?.error;
  ctx.falhaEfeito ||= !sucesso;
  const depois = metodo === 'delete' ? {} : Object.fromEntries(Object.keys(seguro).map(c => [c,
    linha && typeof linha === 'object' && Object.hasOwn(linha, c) ? auditoria().valorSeguro(linha[c]) : seguro[c]]));
  const anterior = metodo === 'delete' ? antes : Object.fromEntries(Object.keys(seguro).map(c => [c, antes[c]]));
  const mudancas = metodo === 'delete'
    ? Object.keys(anterior).map(campo => ({ campo, antes: anterior[campo], depois: null })).filter(m => m.antes !== null)
    : auditoria().sanitizarMudancas({ antes: anterior, depois });
  const mudou = mudancas.length > 0 && (metodo === 'post' || metodo === 'delete' && antesConhecido || antesConhecido);
  ctx.escrita ||= sucesso;
  ctx.protegida ||= protegida && sucesso;
  if (!protegida || mudancas.length) {
    enfileirar(ctx, { modulo: moduloDe(r.tabela), acao: acaoDe(metodo), entidade: r.tabela,
      entidadeId: r.id || usuarioId(linha?.id), origem: origemDoEfeito(ctx), resultado: sucesso ? 'sucesso' : 'falha',
      mudancas, _mudou: sucesso && mudou, _recurso: { ...r, id: r.id || usuarioId(linha?.id) } });
  }
  if (falha) throw falha;
  return resultado;
}

async function apiPara(ctx, apiReserva = null) {
  if (!ctx.apiPromise) {
    ctx.apiPromise = Promise.resolve().then(() => semAuditoria(() => ctx.opcoes.criarApi
      ? ctx.opcoes.criarApi() : ctx.req ? require('./apiHttpClient').createApiClientSemAuditoria(ctx.req) : apiReserva));
  }
  return ctx.apiPromise;
}
async function identificar(ctx, api) {
  if (ctx.usuarioId || ctx.origem === 'sistema') return;
  const usuario = await semAuditoria(() => api.get('/api/usuarios/me'));
  ctx.usuarioId = usuarioId(usuario?.id);
  if (!ctx.usuarioId) throw Object.assign(new Error('Sessão não identificada.'), { code: 'AUDITORIA_SEM_USUARIO' });
}
async function persistir(ctx, api, evento) {
  try {
    const r = await semAuditoria(() => auditoria().registrar(api, { ...evento, usuarioId: ctx.usuarioId, acao_id: ctx.acaoId, contexto: ctx.contexto }));
    if (!r.ok) pendencia(ctx, r.code || 'AUDITORIA_GRAVACAO_FALHOU');
    return r;
  } catch (e) { pendencia(ctx, e.code || 'AUDITORIA_GRAVACAO_FALHOU'); return { ok: false }; }
}
function descricaoDaUltima(ctx, raiz) {
  const base = auditoria().normalizarEvento({ ...raiz, usuarioId: ctx.usuarioId }).descricao;
  const composto = ['linhas', 'itens', 'decisoes'].some(c => Object.hasOwn(ctx.payload, c));
  const vistas = new Set();
  const detalhes = [];
  const rotulos = { nome: 'Nome', codigo: 'Código', quantidade: 'Quantidade', valor_total: 'Total', valor_final: 'Total final',
    valor_unitario: 'Valor unitário', preco_venda: 'Preço de venda', preco_base: 'Preço base', situacao: 'Situação', status: 'Status',
    desconto_total: 'Desconto total', data_vencimento: 'Vencimento', embarcar_previsao: 'Previsão de embarque' };
  const valor = (v, campo) => {
    if (v === null || v === undefined) return 'vazio';
    if (typeof v === 'number') return /^valor|^preco|desconto|ajuste_valor/.test(campo)
      ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : v.toLocaleString('pt-BR');
    if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
    return (typeof v === 'object' ? JSON.stringify(v) : String(v)).replace(/\s+/g, ' ').slice(0, 90);
  };
  for (const efeito of ctx.eventos) {
    if (!efeito._mudou || moduloDe(efeito._recurso.tabela) !== ctx.modulo) continue;
    for (const m of efeito.mudancas) {
      if (m.campo === 'id' || !composto && raiz.acao !== 'excluir' && !Object.hasOwn(ctx.payload, m.campo)) continue;
      const chave = `${efeito.entidade}:${efeito.entidadeId}:${m.campo}`;
      if (vistas.has(chave)) continue;
      vistas.add(chave);
      const referencia = composto ? ` (${efeito.entidade} #${efeito.entidadeId || '?'})` : '';
      detalhes.push(`${rotulos[m.campo] || m.campo.replace(/_/g, ' ')}${referencia}: ${valor(m.antes, m.campo)} → ${valor(m.depois, m.campo)}`);
      if (detalhes.length === 4) break;
    }
    if (detalhes.length === 4) break;
  }
  return `${base}${detalhes.length ? ` ${detalhes.join('; ')}.` : ''}`.slice(0, 500);
}
function eventoRaiz(ctx, sucesso) {
  sucesso = sucesso && !ctx.falhaEfeito;
  if (ctx.origem === 'sistema') return null;
  const consulta = String(ctx.metodo).toLowerCase() === 'get' || /get|list|load|buscar|consultar|listar|carregar/i.test(ctx.canal) && !ctx.escrita;
  if (consulta && ctx.origem !== 'manual') return null;
  if (!consulta && !ctx.eventos.length && !ctx.protegida && !Object.keys(ctx.payload).length) return null;
  const mudancas = [];
  for (const campo of Object.keys(ctx.payload)) {
    if (campo === 'id') continue;
    const efeito = ctx.eventos.find(e => mesmaEntidade(ctx, e._recurso) && e.mudancas.some(m => m.campo === campo));
    const m = efeito?.mudancas.find(m => m.campo === campo);
    // O parâmetro enviado não prova uma mudança: guardar somente diferenças observadas.
    if (m) mudancas.push(m);
  }
  const comandoComposto = ['linhas', 'itens', 'decisoes'].some(c => Object.hasOwn(ctx.payload, c));
  const direta = ctx.eventos.some(e => e._mudou && moduloDe(e._recurso.tabela) === ctx.modulo
    && (ctx.acao === 'excluir' || comandoComposto || mesmaEntidade(ctx, e._recurso)
      && e.mudancas.some(m => Object.hasOwn(ctx.payload, m.campo))));
  return { modulo: ctx.modulo, acao: consulta ? 'consultar' : ctx.protegida ? ctx.acaoProtegida || 'alterar-senha' : ctx.acao,
    entidade: ctx.entidade, entidadeId: ctx.entidadeId, origem: ctx.origem, resultado: sucesso ? 'sucesso' : 'falha', mudancas,
    _manualMudou: ctx.origem === 'manual' && sucesso && !consulta && (direta || ctx.protegida) };
}
async function finalizar(ctx, { sucesso = true, apiReserva = null } = {}) {
  if (ctx.finalizado) return ctx.status || { status: 'ok' };
  if (ctx.finalizacao) return ctx.finalizacao;
  ctx.encerrando = true;
  ctx.finalizacao = (async () => {
    await Promise.allSettled([...ctx.pendentes]);
    const raiz = eventoRaiz(ctx, sucesso);
    if (ctx.eventos.length || raiz) {
      try {
        const api = await apiPara(ctx, apiReserva);
        if (!api) throw Object.assign(new Error('Cliente de auditoria indisponível.'), { code: 'AUDITORIA_CLIENTE_AUSENTE' });
        await identificar(ctx, api);
        const registroRaiz = raiz ? await persistir(ctx, api, raiz) : null;
        for (const evento of ctx.eventos) await persistir(ctx, api, evento);
        if (raiz?._manualMudou && registroRaiz?.ok && !ctx.erros.length) {
          const acao = { timestamp: registroRaiz.criado_em || new Date().toISOString(), modulo: raiz.modulo,
            descricao: descricaoDaUltima(ctx, raiz) };
          const anterior = filasPorUsuario.get(ctx.usuarioId) || Promise.resolve();
          const gravacao = anterior.catch(() => {}).then(async () => {
            // HTTP e IPC podem terminar fora de ordem; a última ação nunca regride.
            const timestamp = new Date(acao.timestamp).getTime();
            if (timestamp < (ultimasPorUsuario.get(ctx.usuarioId) || 0)) return;
            const campos = require('./userActivity').camposDaAlteracao(acao);
            await semAuditoria(() => typeof api.updateUserActivity === 'function'
              ? api.updateUserActivity(ctx.usuarioId, campos) : api.put(`/api/usuarios/${ctx.usuarioId}`, campos));
            ultimasPorUsuario.set(ctx.usuarioId, timestamp);
            ctx.ultimaAcao = acao;
            if (ctx.opcoes.onManualChange) await semAuditoria(() => ctx.opcoes.onManualChange(acao));
          });
          filasPorUsuario.set(ctx.usuarioId, gravacao);
          try { await gravacao; }
          catch (_) { pendencia(ctx, 'AUDITORIA_ULTIMA_ALTERACAO_FALHOU'); }
          finally { if (filasPorUsuario.get(ctx.usuarioId) === gravacao) filasPorUsuario.delete(ctx.usuarioId); }
        }
      } catch (e) { pendencia(ctx, e.code || 'AUDITORIA_CAPTURA_FALHOU'); }
    }
    ctx.finalizado = true;
    ctx.status = ctx.erros.length ? { status: 'pendente', code: ctx.erros[0], codes: [...ctx.erros] } : { status: 'ok' };
    if (ctx.erros.length) {
      console.warn('[auditoria]', ctx.status.codes.join(','));
      if (ctx.opcoes.onAuditFailure) {
        try { await semAuditoria(() => ctx.opcoes.onAuditFailure(ctx.status)); } catch (_) { /* aviso não altera o resultado */ }
      }
    }
    return ctx.status;
  })();
  return ctx.finalizacao;
}

function comAuditoria(api, { sistema = false } = {}) {
  if (!api || api[EMBRULHADO]) return api;
  const embrulhado = { ...api };
  Object.defineProperty(embrulhado, EMBRULHADO, { value: true });
  for (const metodo of ESCRITAS) {
    if (typeof api[metodo] !== 'function') continue;
    embrulhado[metodo] = (...args) => {
      const atual = armazenamento.getStore();
      if (atual?.suprimido) return api[metodo](...args);
      const executar = () => api[metodo](...args);
      if (atual && !atual.encerrando && !atual.finalizado) {
        const p = capturar(api, metodo, args, executar, atual);
        atual.pendentes.add(p);
        p.then(() => atual.pendentes.delete(p), () => atual.pendentes.delete(p));
        return p;
      }
      if (!sistema) return executar();
      const ctx = criarContexto({ canal: String(args[0] || ''), metodo, payload: args[1], sistema: true });
      return armazenamento.run(ctx, async () => {
        try { return await capturar(api, metodo, args, executar, ctx); }
        finally { await finalizar(ctx, { apiReserva: api }); }
      });
    };
  }
  if (typeof api.query === 'function') {
    embrulhado.query = (caminho, opcoes = {}) => {
      const metodo = String(opcoes?.method || 'GET').toLowerCase();
      if (typeof caminho === 'string' && caminho.startsWith('/') && ESCRITAS.has(metodo)) {
        const corpo = opcoes.body || opcoes.data;
        const fachada = comAuditoria({ ...api, [metodo]: (...args) => api.query(args[0], metodo === 'delete' ? opcoes : { ...opcoes, body: args[1] }) }, { sistema });
        return metodo === 'delete' ? fachada.delete(caminho, opcoes) : fachada[metodo](caminho, corpo, opcoes);
      }
      return api.query(caminho, opcoes);
    };
  }
  if (typeof api.connect === 'function') embrulhado.connect = async (...args) => comAuditoria(await api.connect(...args), { sistema });
  return embrulhado;
}

async function executarIpc(info, fn, opcoes = {}) {
  const ctx = criarContexto(info, opcoes);
  return armazenamento.run(ctx, async () => {
    let sucesso = false;
    try {
      const r = await fn();
      sucesso = r?.success !== false && r?.ok !== false && !r?.error;
      return r;
    } finally { await finalizar(ctx, { sucesso }); }
  });
}
function contextoDosHeaders(req) {
  let contexto = {};
  try {
    const valor = req.headers?.['x-auditoria-contexto'];
    if (typeof valor === 'string' && valor.length <= 3000) contexto = JSON.parse(decodeURIComponent(valor));
  } catch (_) { /* desconhecido, nunca presumir manual */ }
  return { ...contexto, origem: req.headers?.['x-auditoria-origem'] || contexto.origem,
    acao_id: req.headers?.['x-auditoria-acao'] || req.headers?.['x-auditoria-acao-id'] || contexto.acao_id };
}
function middleware(req, res, next) {
  const caminho = String(req.originalUrl || req.url || '').split('?')[0];
  if (!caminho.startsWith('/api/') || caminho.startsWith('/api/auditoria-usuarios')) return next();
  const ctx = criarContexto({ canal: caminho, metodo: req.method, payload: req.body, contexto: contextoDosHeaders(req), req });
  const end = res.end;
  const json = res.json;
  let falhaDeclarada = false;
  res.json = function (corpo) { falhaDeclarada = corpo?.success === false || corpo?.ok === false || Boolean(corpo?.error); return json.call(this, corpo); };
  let encerrado = false;
  res.end = function (...args) {
    if (encerrado) return this;
    encerrado = true;
    // Sem alterar status/body de negócio. Nas respostas comuns (JSON), o
    // cabeçalho sai somente depois da persistência de todos os efeitos.
    armazenamento.run(ctx, async () => {
      const estado = await finalizar(ctx, { sucesso: res.statusCode < 400 && !falhaDeclarada });
      if (!res.headersSent) res.setHeader('X-Auditoria-Status', estado.status);
      end.apply(res, args);
    }).catch(() => { if (!res.headersSent) res.setHeader('X-Auditoria-Status', 'pendente'); end.apply(res, args); });
    return this;
  };
  armazenamento.run(ctx, next);
}

module.exports = { executarIpc, middleware, comAuditoria, semAuditoria, confirmarMudancaProtegida,
  ativarCapturaSistema, capturaSistemaAtiva, contextoDosHeaders, MAX_EVENTOS };
