/**
 * Citações com # no chat interno (12/10/2026): tarefas, clientes, prospecções,
 * contatos, pedidos, orçamentos e produtos — sempre restritas ao que o PERFIL
 * de quem busca ou lê pode ver (pedido do dono).
 *
 *   buscar   ao digitar "#": só os tipos que a pessoa vê, e dentro deles só o
 *            que ela vê (tarefa: a regra das Tarefas — as próprias, as em que
 *            participa e as que o perfil deixa ver dos outros);
 *   resolver ao mostrar a mensagem: o nome de cada citação é lido COM AS
 *            PERMISSÕES DE QUEM LÊ. Sem a permissão, a citação aparece como
 *            "sem acesso" (o nome não sai daqui). A mensagem guarda só
 *            {tipo, id} — nunca o nome.
 *
 * Roda no programa (o backend local), com o token de quem pede; a API do chat
 * só guarda as marcas [[#tipo:id]].
 */
const { createApiClient } = require('./apiHttpClient');
const permissoesRepo = require('./permissionsRepository');

const lista = r => (Array.isArray(r) ? r : r && typeof r === 'object' && !r.error ? [r] : []);
const comparavel = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const MAXIMO_RESULTADOS = 12;

const nomeDoCliente = c => c?.nome_fantasia || c?.razao_social || null;

/**
 * Cada tipo: a permissão de ver, a tabela, as colunas lidas e como vira
 * rótulo. `vinculoCliente`: o documento mostra o nome do cliente junto.
 */
const TIPOS = {
  cliente: { chave: 'cli.view', tabela: 'clientes', select: 'id,nome_fantasia,razao_social', rotulo: c => nomeDoCliente(c) || `Cliente ${c.id}`, busca: c => [c.nome_fantasia, c.razao_social] },
  prospeccao: { chave: 'pros.view', tabela: 'prospeccoes', select: 'id,nome_fantasia,razao_social,status', rotulo: p => nomeDoCliente(p) || `Prospecção ${p.id}`, busca: p => [p.nome_fantasia, p.razao_social] },
  contato: { chave: 'ctt.view', tabela: 'contatos', select: 'id,nome_fantasia,razao_social,nome', rotulo: c => c.nome_fantasia || c.razao_social || c.nome || `Contato ${c.id}`, busca: c => [c.nome_fantasia, c.razao_social, c.nome] },
  pedido: { chave: 'ped.view', tabela: 'pedidos', select: 'id,numero,cliente_id,situacao', rotulo: p => p.numero || `Pedido ${p.id}`, busca: p => [p.numero], vinculoCliente: true },
  orcamento: { chave: 'orc.view', tabela: 'orcamentos', select: 'id,numero,cliente_id,situacao', rotulo: o => o.numero || `Orçamento ${o.id}`, busca: o => [o.numero], vinculoCliente: true },
  produto: { chave: 'prod.view', tabela: 'produtos', select: 'id,codigo,nome', rotulo: p => [p.codigo, p.nome].filter(Boolean).join(' — ') || `Produto ${p.id}`, busca: p => [p.codigo, p.nome] },
  tarefa: { chave: 'tarefas.view', rotulo: t => t.titulo || `Tarefa ${t.id}`, busca: t => [t.titulo] }
};
const ROTULO_DO_TIPO = { cliente: 'Cliente', prospeccao: 'Prospecção', contato: 'Contato', pedido: 'Pedido', orcamento: 'Orçamento', produto: 'Produto', tarefa: 'Tarefa' };

/** Os tipos que a pessoa pode citar (e ver citados). */
async function tiposPermitidos(req) {
  const { obterPermissoesEfetivas, carregarUsuarioAtual } = require('./permissionsController');
  const [permissoes, usuario] = await Promise.all([obterPermissoesEfetivas(req), carregarUsuarioAtual(req)]);
  const sup = permissoesRepo.isSupAdmin(usuario);
  return new Set(Object.entries(TIPOS).filter(([, t]) => sup || permissoesRepo.can(permissoes, t.chave)).map(([tipo]) => tipo));
}

/** As tarefas que a pessoa vê (a mesma regra da tela de Tarefas). */
async function tarefasVisiveis(req) {
  const controle = require('./tarefasController');
  const R = require('./tarefasRegras');
  const ctx = await controle.montarContexto(req);
  const [tarefas, participantes] = await Promise.all([
    ctx.api.get('/api/tarefas', { query: { select: 'id,titulo,status,responsavel_id,criado_por,visibilidade,excluida_em,cliente_id,prospeccao_id,prazo' } }).then(lista).catch(() => []),
    ctx.api.get('/api/tarefa_participantes').then(lista).catch(() => [])
  ]);
  return tarefas.filter(t => !t.excluida_em && R.podeVerTarefa(t, { usuarioId: ctx.usuarioId, escopo: ctx.escopo, participantes }));
}

async function nomesDosClientes(api, linhas) {
  const ids = [...new Set(linhas.map(l => l.cliente_id).filter(Boolean).map(String))];
  if (!ids.length) return new Map();
  const clientes = lista(await api.get('/api/clientes', { query: { select: 'id,nome_fantasia,razao_social' } }).catch(() => []));
  return new Map(clientes.filter(c => ids.includes(String(c.id))).map(c => [String(c.id), nomeDoCliente(c)]));
}

async function linhasDoTipo(req, tipo) {
  if (tipo === 'tarefa') return tarefasVisiveis(req);
  const cfg = TIPOS[tipo];
  return lista(await createApiClient(req).get(`/api/${cfg.tabela}`, { query: { select: cfg.select } }).catch(() => []));
}

function paraItem(tipo, linha, clientes = new Map()) {
  const cfg = TIPOS[tipo];
  const detalhe = cfg.vinculoCliente ? [clientes.get(String(linha.cliente_id)), linha.situacao].filter(Boolean).join(' · ') : tipo === 'tarefa' ? linha.status || null : null;
  return { tipo, id: Number(linha.id), rotulo: cfg.rotulo(linha), detalhe: detalhe || null, tipo_rotulo: ROTULO_DO_TIPO[tipo] };
}

/**
 * GET /api/chat/referencias/buscar?q=&tipo= — o que aparece ao digitar "#".
 * Sem `tipo`: todos os que a pessoa vê. Devolve também `tipos` (para as abas).
 */
async function buscar(req) {
  const permitidos = await tiposPermitidos(req);
  const pedido = String(req.query?.tipo || '');
  const tipos = pedido ? [pedido].filter(t => permitidos.has(t)) : [...permitidos];
  const termo = comparavel(req.query?.q);
  const itens = [];
  for (const tipo of tipos) {
    const linhas = await linhasDoTipo(req, tipo);
    const achados = linhas
      .filter(l => !termo || TIPOS[tipo].busca(l).some(v => comparavel(v).includes(termo)))
      .slice(0, MAXIMO_RESULTADOS);
    const clientes = TIPOS[tipo].vinculoCliente ? await nomesDosClientes(createApiClient(req), achados) : new Map();
    itens.push(...achados.map(l => paraItem(tipo, l, clientes)));
  }
  return { tipos: [...permitidos].map(t => ({ tipo: t, rotulo: ROTULO_DO_TIPO[t] })), itens: itens.slice(0, MAXIMO_RESULTADOS * 2) };
}

/**
 * POST /api/chat/referencias/resolver {itens: [{tipo, id}]} — os nomes, com as
 * permissões de quem lê. Sem permissão: { sem_acesso: true }; sumiu: { nao_encontrado: true }.
 */
async function resolver(req) {
  const pedidos = (Array.isArray(req.body?.itens) ? req.body.itens : [])
    .map(i => ({ tipo: String(i?.tipo || ''), id: Number(i?.id) }))
    .filter(i => TIPOS[i.tipo] && Number.isInteger(i.id) && i.id > 0)
    .slice(0, 200);
  const permitidos = await tiposPermitidos(req);
  const saida = [];
  const porTipo = new Map();
  for (const p of pedidos) {
    if (!porTipo.has(p.tipo)) porTipo.set(p.tipo, new Set());
    porTipo.get(p.tipo).add(p.id);
  }
  for (const [tipo, ids] of porTipo) {
    if (!permitidos.has(tipo)) {
      for (const id of ids) saida.push({ tipo, id, sem_acesso: true, tipo_rotulo: ROTULO_DO_TIPO[tipo] });
      continue;
    }
    const linhas = (await linhasDoTipo(req, tipo)).filter(l => ids.has(Number(l.id)));
    const clientes = TIPOS[tipo].vinculoCliente ? await nomesDosClientes(createApiClient(req), linhas) : new Map();
    const achados = new Map(linhas.map(l => [Number(l.id), paraItem(tipo, l, clientes)]));
    // Tarefa que existe mas a pessoa não vê também é "sem acesso".
    for (const id of ids) saida.push(achados.get(id) || { tipo, id, [tipo === 'tarefa' ? 'sem_acesso' : 'nao_encontrado']: true, tipo_rotulo: ROTULO_DO_TIPO[tipo] });
  }
  return { itens: saida };
}

module.exports = { TIPOS, ROTULO_DO_TIPO, tiposPermitidos, buscar, resolver, paraItem };
