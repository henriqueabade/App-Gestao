/**
 * Histórico "de rede social" de Prospecções e Clientes.
 *
 * O histórico de cada ficha (prospeccao_historico / cliente_historico) é a
 * linha do tempo; por cima dele:
 *   - curtida num evento ou num comentário (historico_curtidas);
 *   - comentário num evento, com resposta sem limite de níveis
 *     (historico_comentarios.resposta_de);
 *   - observação: um evento "publicou" escrito por alguém, que também recebe
 *     curtida, comentário e anexo;
 *   - anexo num comentário ou numa observação (historico_anexos, conteúdo em
 *     partes de 512 KB em historico_anexo_partes — cada envio fica abaixo do
 *     limite de 1 MB do corpo da API);
 *   - edição do próprio comentário: o texto anterior vai para
 *     historico_comentario_versoes, que só o Sup Admin lê;
 *   - exclusão só pelo Sup Admin, por MARCA (excluido_em/excluido_por):
 *     nada some do banco;
 *   - aviso no sino (notificacoes) para quem criou a ficha e quem fez a ação
 *     comentada (e o autor do comentário respondido/curtido).
 *
 * Tabelas: sql/historico_social.sql. Sem elas o histórico continua aparecendo
 * (só leitura) e a resposta traz `sql_pendente: true`.
 */

const LIMITE_ANEXO_BYTES = 20 * 1024 * 1024;
const TAMANHO_PARTE = 512 * 1024;
const LIMITE_TEXTO = 5000;

/** Cada ficha que tem histórico social. */
const ORIGENS = {
  prospeccao: {
    tabela: 'prospeccao_historico', coluna: 'prospeccao_id', tabelaRegistro: 'prospeccoes',
    permissao: 'pros.details.view', rotulo: 'a prospecção', pagina: 'prospeccoes'
  },
  cliente: {
    tabela: 'cliente_historico', coluna: 'cliente_id', tabelaRegistro: 'clientes',
    permissao: 'cli.details.view', rotulo: 'o cliente', pagina: 'clientes'
  },
  // A linha do tempo de cada tarefa (sql/tarefas_calendario.sql). Quem vê é
  // decidido tarefa a tarefa (backend/tarefasController.js, podeVerTarefa),
  // não só pela permissão do módulo.
  tarefa: {
    tabela: 'tarefa_historico', coluna: 'tarefa_id', tabelaRegistro: 'tarefas',
    permissao: 'tarefas.view', rotulo: 'a tarefa', pagina: 'tarefas'
  }
};

function erro(status, mensagem, extra = {}) {
  const e = new Error(mensagem);
  e.status = status;
  Object.assign(e, extra);
  return e;
}

const texto = v => (v === undefined || v === null ? '' : String(v).trim());
const lista = r => (Array.isArray(r) ? r : []);
const mesmoId = (a, b) => a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);

/**
 * O SQL ainda não rodou? Cada caminho diz de um jeito:
 *   - API remota: 404 "Tabela 'x' não encontrada." — ou 400 "Nenhuma coluna
 *     válida." quando a tabela existe mas a coluna nova (excluido_em) não;
 *   - banco DEV: código 42P01 (tabela) ou 42703 (coluna).
 */
function semTabela(err) {
  if (['42P01', '42703'].includes(String(err?.code || ''))) return true;
  const texto = `${err?.message} ${JSON.stringify(err?.body || {})}`;
  if (err?.status === 404) return /Tabela|does not exist|relation/i.test(texto);
  if (err?.status === 400) return /Nenhuma coluna v[áa]lida/i.test(texto);
  return false;
}

function origemValida(origem) {
  const o = ORIGENS[origem];
  if (!o) throw erro(400, 'Origem inválida: use prospeccao ou cliente.');
  return o;
}

// ------------------------------------------------------------ puras

/** Texto de comentário/observação: sem espaço nas pontas, obrigatório, até 5000 letras. */
function textoValido(bruto, { rotulo = 'O comentário' } = {}) {
  const t = texto(bruto);
  if (!t) throw erro(400, `${rotulo} está vazio.`);
  if (t.length > LIMITE_TEXTO) throw erro(400, `${rotulo} passou de ${LIMITE_TEXTO} caracteres.`);
  return t;
}

/** Um pedaço do texto para o aviso ("Muito bom, vamos…"). */
function trecho(t, max = 90) {
  const s = texto(t).replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/**
 * Curtidas agrupadas: por evento e por comentário, com o total, se EU curti
 * e os nomes de quem curtiu (para o "Fulano, Beltrano e mais 2").
 */
function agruparCurtidas(curtidas = [], usuarioId, nomes = new Map()) {
  const porItem = new Map();
  const porComentario = new Map();
  for (const c of lista(curtidas)) {
    const mapa = c.comentario_id ? porComentario : porItem;
    const chave = String(c.comentario_id || c.item_id);
    const atual = mapa.get(chave) || { total: 0, curti: false, quem: [] };
    atual.total += 1;
    if (mesmoId(c.usuario_id, usuarioId)) atual.curti = true;
    atual.quem.push(nomes.get(Number(c.usuario_id)) || 'Alguém');
    mapa.set(chave, atual);
  }
  return { porItem, porComentario };
}

/**
 * Quem recebe o aviso: sem repetir e nunca quem fez a ação. `candidatos` são
 * ids (quem criou a ficha, quem fez o evento, autor do comentário respondido).
 */
function destinatarios(candidatos = [], ator) {
  const vistos = new Set();
  const saida = [];
  for (const id of candidatos) {
    if (id === null || id === undefined || id === '') continue;
    const n = Number(id);
    if (!Number.isFinite(n) || mesmoId(n, ator) || vistos.has(n)) continue;
    vistos.add(n);
    saida.push(n);
  }
  return saida;
}

/** O que o aviso diz, por tipo. */
function textoDoAviso(tipo, { autor = 'Alguém', registro = '', conteudo = '', alvo = 'evento' } = {}) {
  const onde = registro ? ` em ${registro}` : '';
  const citado = conteudo ? `: “${trecho(conteudo)}”` : '';
  switch (tipo) {
    case 'comentario': return { titulo: 'Novo comentário', mensagem: `${autor} comentou${onde}${citado}` };
    case 'resposta': return { titulo: 'Resposta ao seu comentário', mensagem: `${autor} respondeu${onde}${citado}` };
    case 'observacao': return { titulo: 'Nova observação', mensagem: `${autor} publicou uma observação${onde}${citado}` };
    case 'curtida': return { titulo: 'Curtida', mensagem: `${autor} curtiu ${alvo === 'comentario' ? 'seu comentário' : 'seu registro'}${onde}` };
    default: return { titulo: 'Histórico', mensagem: `${autor} mexeu no histórico${onde}` };
  }
}

/** Arquivo → partes de até 512 KB, cada uma em base64 (decodificáveis separadas). */
function partesDoArquivo(buffer, tamanho = TAMANHO_PARTE) {
  const partes = [];
  for (let i = 0; i < buffer.length; i += tamanho) partes.push(buffer.subarray(i, i + tamanho).toString('base64'));
  return partes;
}

/** Nome de arquivo seguro para guardar e mostrar (sem caminho, até 200 caracteres). */
function nomeDeArquivo(bruto) {
  const base = texto(bruto).split(/[\\/]/).pop().replace(/[\u0000-\u001f]/g, '').trim();
  return (base || 'arquivo').slice(0, 200);
}

/**
 * Monta a resposta da linha do tempo. Pura: recebe tudo já lido.
 *
 * Quem não é Sup Admin não vê evento excluído (nem os comentários dele), e o
 * comentário excluído vira um "comentário removido" sem texto — as respostas
 * dele continuam no lugar. O Sup Admin vê tudo, marcado, e as versões
 * anteriores de cada comentário editado.
 */
function montarLinhaDoTempo({
  origem, registroId, itens = [], comentarios = [], curtidas = [], anexos = [], versoes = [],
  nomes = new Map(), usuarioId = null, supAdmin = false, criadorId = null, sqlPendente = false
}) {
  const nome = id => (id === null || id === undefined ? null : nomes.get(Number(id)) || null);
  const { porItem, porComentario } = agruparCurtidas(curtidas, usuarioId, nomes);
  const anexosVisiveis = lista(anexos).filter(a => a.completo !== false && (supAdmin || !a.excluido_em));
  const anexoPublico = a => ({ id: a.id, nome: a.nome_arquivo, tipo: a.tipo_mime || null, tamanho: Number(a.tamanho_bytes) || 0, usuario_id: a.usuario_id ?? null });
  const versoesPorComentario = new Map();
  if (supAdmin) {
    for (const v of lista(versoes)) {
      const k = String(v.comentario_id);
      if (!versoesPorComentario.has(k)) versoesPorComentario.set(k, []);
      versoesPorComentario.get(k).push({ texto: v.texto, editado_em: v.editado_em, editado_por: nome(v.editado_por) });
    }
    for (const arr of versoesPorComentario.values()) arr.sort((a, b) => String(a.editado_em).localeCompare(String(b.editado_em)));
  }

  const itensVisiveis = lista(itens).filter(i => supAdmin || !i.excluido_em);
  const idsVisiveis = new Set(itensVisiveis.map(i => String(i.id)));
  const comentariosVisiveis = lista(comentarios).filter(c => idsVisiveis.has(String(c.item_id)));
  const contagemComentarios = new Map();
  for (const c of comentariosVisiveis) {
    if (c.excluido_em && !supAdmin) continue;
    contagemComentarios.set(String(c.item_id), (contagemComentarios.get(String(c.item_id)) || 0) + 1);
  }

  const saidaItens = itensVisiveis
    .map(i => {
      const curt = porItem.get(String(i.id)) || { total: 0, curti: false, quem: [] };
      return {
        ...i,
        usuario: nome(i.usuario_id),
        excluido: Boolean(i.excluido_em),
        excluido_por_nome: nome(i.excluido_por),
        curtidas: curt.total, curti: curt.curti, quem_curtiu: curt.quem,
        comentarios: contagemComentarios.get(String(i.id)) || 0,
        anexos: anexosVisiveis.filter(a => mesmoId(a.item_id, i.id) && !a.comentario_id).map(anexoPublico)
      };
    })
    .sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)) || Number(b.id) - Number(a.id));

  const saidaComentarios = comentariosVisiveis
    .map(c => {
      const curt = porComentario.get(String(c.id)) || { total: 0, curti: false, quem: [] };
      const oculto = Boolean(c.excluido_em) && !supAdmin;
      return {
        id: c.id, item_id: c.item_id, resposta_de: c.resposta_de ?? null,
        usuario_id: oculto ? null : c.usuario_id, usuario: oculto ? null : nome(c.usuario_id),
        texto: oculto ? null : c.texto, criado_em: c.criado_em, editado_em: c.editado_em || null,
        editado: Boolean(c.editado_em),
        excluido: Boolean(c.excluido_em), excluido_por_nome: supAdmin ? nome(c.excluido_por) : null,
        motivo_exclusao: supAdmin ? c.motivo_exclusao || null : null,
        curtidas: oculto ? 0 : curt.total, curti: oculto ? false : curt.curti, quem_curtiu: oculto ? [] : curt.quem,
        anexos: oculto ? [] : anexosVisiveis.filter(a => mesmoId(a.comentario_id, c.id)).map(anexoPublico),
        ...(supAdmin ? { versoes: versoesPorComentario.get(String(c.id)) || [] } : {})
      };
    })
    .sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)) || Number(a.id) - Number(b.id));

  return {
    origem, registro_id: Number(registroId), sql_pendente: Boolean(sqlPendente),
    eu: { id: usuarioId === null ? null : Number(usuarioId), nome: nome(usuarioId), sup_admin: Boolean(supAdmin) },
    criador_id: criadorId === null || criadorId === undefined ? null : Number(criadorId),
    limite_anexo_bytes: LIMITE_ANEXO_BYTES,
    itens: saidaItens,
    comentarios: saidaComentarios
  };
}

// ------------------------------------------------------------ leitura

/** Mapa id → nome de todos os usuários (uma leitura só: a API não filtra por lista). */
async function nomesDosUsuarios(api) {
  try {
    const usuarios = await api.get('/api/usuarios');
    return new Map(lista(usuarios).map(u => [Number(u.id), u.nome]));
  } catch (err) {
    console.warn('[historico-social] sem nomes de usuário:', err?.message || err);
    return new Map();
  }
}

/** A ficha e quem a criou (cliente antigo sem `criado_por`: o primeiro "criou" do histórico, ou o dono se for usuário). */
async function lerRegistro(api, origem, registroId, { itens = null, nomes = null } = {}) {
  const o = origemValida(origem);
  const registro = await api.get(`/api/${o.tabelaRegistro}/${registroId}`).catch(() => null);
  if (!registro || registro.error) throw erro(404, origem === 'cliente' ? 'Cliente não encontrado.' : 'Prospecção não encontrada.');
  let criador = registro.criado_por ?? null;
  if (!criador && origem === 'cliente') {
    const eventos = itens || lista(await api.get(`/api/${o.tabela}`, { query: { [o.coluna]: registroId } }).catch(() => []));
    const primeiro = eventos.filter(e => e.acao === 'criou' && e.usuario_id).sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)))[0];
    criador = primeiro?.usuario_id ?? null;
    if (!criador && registro.dono_cliente) {
      const mapa = nomes || await nomesDosUsuarios(api);
      const alvo = texto(registro.dono_cliente).toLowerCase();
      for (const [id, n] of mapa) if (texto(n).toLowerCase() === alvo) { criador = id; break; }
    }
  }
  // Na tarefa, além de quem criou, acompanham quem responde e quem participa.
  let interessados = [];
  if (origem === 'tarefa') {
    const participantes = lista(await api.get('/api/tarefa_participantes', { query: { tarefa_id: registroId } }).catch(() => []));
    interessados = [registro.responsavel_id, ...participantes.filter(p => p.status === 'aceito').map(p => p.usuario_id)];
  }
  return { registro, nome: texto(registro.nome_fantasia) || texto(registro.titulo) || `#${registroId}`, criadorId: criador, interessados };
}

/** Lê tudo o que a linha do tempo precisa de uma vez (1 ida em paralelo). */
async function carregarLinhaDoTempo(api, { origem, registroId, usuarioId, supAdmin }) {
  const o = origemValida(origem);
  let sqlPendente = false;
  const socialOuVazio = caminho => api.get(caminho, { query: { origem, registro_id: registroId } }).catch(err => {
    if (semTabela(err)) { sqlPendente = true; return []; }
    throw err;
  });
  const [itens, comentarios, curtidas, anexos, versoes, nomes] = await Promise.all([
    api.get(`/api/${o.tabela}`, { query: { [o.coluna]: registroId } }).catch(err => {
      if (semTabela(err)) { sqlPendente = true; return []; }
      throw err;
    }),
    socialOuVazio('/api/historico_comentarios'),
    socialOuVazio('/api/historico_curtidas'),
    socialOuVazio('/api/historico_anexos'),
    supAdmin ? socialOuVazio('/api/historico_comentario_versoes') : Promise.resolve([]),
    nomesDosUsuarios(api)
  ]);
  const { criadorId } = await lerRegistro(api, origem, registroId, { itens: lista(itens), nomes });
  return montarLinhaDoTempo({
    origem, registroId, itens, comentarios, curtidas, anexos, versoes, nomes, usuarioId, supAdmin, criadorId, sqlPendente
  });
}

// ------------------------------------------------------------ escrita

/** Grava eventos no histórico de uma ficha (falha não derruba quem chamou). */
async function registrarEventos(api, origem, registroId, eventos, usuarioId) {
  const o = origemValida(origem);
  const listaEventos = (Array.isArray(eventos) ? eventos : [eventos]).filter(Boolean);
  const criados = [];
  for (const evento of listaEventos) {
    try {
      criados.push(await api.post(`/api/${o.tabela}`, {
        [o.coluna]: Number(registroId),
        tipo: evento.tipo,
        acao: evento.acao,
        entidade: texto(evento.entidade) || null,
        campo: texto(evento.campo) || null,
        valor_anterior: evento.valor_anterior ?? null,
        valor_novo: evento.valor_novo ?? null,
        detalhe: evento.detalhe ?? null,
        observacao: texto(evento.observacao) || null,
        usuario_id: usuarioId ?? null
      }));
    } catch (err) {
      console.error(`[historico-social] falha ao gravar histórico de ${origem} ${registroId}:`, err?.message || err);
    }
  }
  return criados;
}

/** Avisos no sino. Falha (tabela ausente, rede) só vai para o log. */
async function notificar(api, ids, aviso) {
  for (const usuarioId of ids) {
    try {
      await api.post('/api/notificacoes', { usuario_id: usuarioId, ...aviso });
    } catch (err) {
      console.warn('[historico-social] aviso não gravado:', err?.message || err);
    }
  }
}

async function lerEvento(api, origem, registroId, itemId) {
  const o = origemValida(origem);
  const item = await api.get(`/api/${o.tabela}/${itemId}`).catch(() => null);
  if (!item || item.error || !mesmoId(item[o.coluna], registroId)) throw erro(404, 'Evento não encontrado nesta ficha.');
  return item;
}

async function lerComentario(api, origem, registroId, comentarioId) {
  const c = await api.get(`/api/historico_comentarios/${comentarioId}`).catch(err => {
    if (semTabela(err)) throw erro(409, 'Rode o sql/historico_social.sql e reinicie a API.', { sql_pendente: true });
    return null;
  });
  if (!c || c.error || c.origem !== origem || !mesmoId(c.registro_id, registroId)) throw erro(404, 'Comentário não encontrado nesta ficha.');
  return c;
}

/** Tabela social ausente vira 409 com a instrução (e não um 500 mudo). */
async function escreverSocial(promessa) {
  try {
    return await promessa;
  } catch (err) {
    if (semTabela(err)) throw erro(409, 'O histórico social ainda não está ativado: rode sql/historico_social.sql e reinicie a API.', { sql_pendente: true });
    throw err;
  }
}

/** Nova observação (um evento "publicou" escrito à mão). */
async function publicarObservacao(api, { origem, registroId, texto: bruto, usuarioId, nomes }) {
  const conteudo = textoValido(bruto, { rotulo: 'A observação' });
  const { nome, criadorId, interessados = [] } = await lerRegistro(api, origem, registroId, { nomes });
  const o = ORIGENS[origem];
  const criado = await escreverSocial(api.post(`/api/${o.tabela}`, {
    [o.coluna]: Number(registroId), tipo: 'observacao', acao: 'publicou', entidade: 'Observação',
    observacao: conteudo, usuario_id: usuarioId ?? null
  }));
  const autor = nomes?.get(Number(usuarioId)) || 'Alguém';
  await notificar(api, destinatarios([criadorId, ...interessados], usuarioId), {
    tipo: 'observacao', ...textoDoAviso('observacao', { autor, registro: nome, conteudo }),
    origem, registro_id: Number(registroId), item_id: criado?.id ?? null, autor_id: usuarioId ?? null
  });
  return criado;
}

/** Comentário num evento (ou resposta a um comentário). Avisa quem criou a ficha, quem fez o evento e o autor respondido. */
async function comentar(api, { origem, registroId, itemId, respostaDe = null, texto: bruto, usuarioId, nomes }) {
  const conteudo = textoValido(bruto);
  const item = await lerEvento(api, origem, registroId, itemId);
  if (item.excluido_em) throw erro(409, 'Este evento foi excluído do histórico.');
  let pai = null;
  if (respostaDe) {
    pai = await lerComentario(api, origem, registroId, respostaDe);
    if (!mesmoId(pai.item_id, itemId)) throw erro(400, 'A resposta precisa ser no mesmo evento do comentário.');
    if (pai.excluido_em) throw erro(409, 'Este comentário foi removido.');
  }
  const criado = await escreverSocial(api.post('/api/historico_comentarios', {
    origem, registro_id: Number(registroId), item_id: Number(itemId),
    resposta_de: pai ? Number(pai.id) : null, usuario_id: usuarioId ?? null, texto: conteudo
  }));
  const { nome, criadorId, interessados = [] } = await lerRegistro(api, origem, registroId, { nomes });
  const autor = nomes?.get(Number(usuarioId)) || 'Alguém';
  const base = { origem, registro_id: Number(registroId), item_id: Number(itemId), comentario_id: criado?.id ?? null, autor_id: usuarioId ?? null };
  const paraPai = pai ? destinatarios([pai.usuario_id], usuarioId) : [];
  if (paraPai.length) await notificar(api, paraPai, { tipo: 'resposta', ...textoDoAviso('resposta', { autor, registro: nome, conteudo }), ...base });
  const demais = destinatarios([criadorId, item.usuario_id, ...interessados], usuarioId).filter(id => !paraPai.includes(id));
  if (demais.length) await notificar(api, demais, { tipo: 'comentario', ...textoDoAviso('comentario', { autor, registro: nome, conteudo }), ...base });
  return criado;
}

/** O autor edita o próprio comentário; o texto anterior fica guardado (o Sup Admin vê). */
async function editarComentario(api, { origem, registroId, comentarioId, texto: bruto, usuarioId }) {
  const conteudo = textoValido(bruto);
  const c = await lerComentario(api, origem, registroId, comentarioId);
  if (!mesmoId(c.usuario_id, usuarioId)) throw erro(403, 'Só quem escreveu pode editar o comentário.');
  if (c.excluido_em) throw erro(409, 'Este comentário foi removido.');
  if (texto(c.texto) === conteudo) return c;
  await escreverSocial(api.post('/api/historico_comentario_versoes', {
    comentario_id: Number(c.id), origem, registro_id: Number(registroId), texto: c.texto, editado_por: usuarioId ?? null
  }));
  return api.put(`/api/historico_comentarios/${c.id}`, { texto: conteudo, editado_em: new Date().toISOString() });
}

/** Curtir/descurtir um evento ou um comentário. Devolve { curti }. */
async function alternarCurtida(api, { origem, registroId, itemId = null, comentarioId = null, usuarioId, nomes }) {
  if (!usuarioId) throw erro(401, 'Sessão sem usuário.');
  let alvoAutor = null;
  let alvo = 'evento';
  if (comentarioId) {
    const c = await lerComentario(api, origem, registroId, comentarioId);
    if (c.excluido_em) throw erro(409, 'Este comentário foi removido.');
    alvoAutor = c.usuario_id;
    alvo = 'comentario';
  } else {
    const item = await lerEvento(api, origem, registroId, itemId);
    if (item.excluido_em) throw erro(409, 'Este evento foi excluído do histórico.');
    alvoAutor = item.usuario_id;
  }
  const filtro = comentarioId
    ? { comentario_id: comentarioId, usuario_id: usuarioId }
    : { origem, item_id: itemId, usuario_id: usuarioId };
  const existentes = lista(await escreverSocial(api.get('/api/historico_curtidas', { query: filtro })))
    .filter(c => (comentarioId ? true : !c.comentario_id));
  if (existentes.length) {
    for (const c of existentes) await api.delete(`/api/historico_curtidas/${c.id}`);
    return { curti: false };
  }
  await escreverSocial(api.post('/api/historico_curtidas', {
    origem, registro_id: Number(registroId), item_id: comentarioId ? null : Number(itemId),
    comentario_id: comentarioId ? Number(comentarioId) : null, usuario_id: Number(usuarioId)
  }));
  const para = destinatarios([alvoAutor], usuarioId);
  if (para.length) {
    const { nome } = await lerRegistro(api, origem, registroId, { nomes });
    await notificar(api, para, {
      tipo: 'curtida', ...textoDoAviso('curtida', { autor: nomes?.get(Number(usuarioId)) || 'Alguém', registro: nome, alvo }),
      origem, registro_id: Number(registroId), item_id: comentarioId ? null : Number(itemId),
      comentario_id: comentarioId ? Number(comentarioId) : null, autor_id: Number(usuarioId)
    });
  }
  return { curti: true };
}

/** Sup Admin: marca o evento como excluído (nada sai do banco). */
async function excluirEvento(api, { origem, registroId, itemId, usuarioId, motivo }) {
  const o = origemValida(origem);
  const item = await lerEvento(api, origem, registroId, itemId);
  if (item.excluido_em) return item;
  return escreverSocial(api.put(`/api/${o.tabela}/${item.id}`, {
    excluido_em: new Date().toISOString(), excluido_por: usuarioId ?? null, motivo_exclusao: texto(motivo) || null
  }));
}

/** Sup Admin: marca o comentário como removido (as respostas continuam). */
async function excluirComentario(api, { origem, registroId, comentarioId, usuarioId, motivo }) {
  const c = await lerComentario(api, origem, registroId, comentarioId);
  if (c.excluido_em) return c;
  return api.put(`/api/historico_comentarios/${c.id}`, {
    excluido_em: new Date().toISOString(), excluido_por: usuarioId ?? null, motivo_exclusao: texto(motivo) || null
  });
}

/**
 * Anexo num comentário ou numa observação (só o autor anexa). Grava as
 * partes e só marca `completo` no fim: anexo que falhou no meio é apagado
 * (e as partes vão junto, pelo CASCADE).
 */
async function salvarAnexo(api, { origem, registroId, itemId = null, comentarioId = null, nome, tipo, base64, usuarioId }) {
  origemValida(origem);
  const buffer = Buffer.from(String(base64 || ''), 'base64');
  if (!buffer.length) throw erro(400, 'O arquivo está vazio.');
  if (buffer.length > LIMITE_ANEXO_BYTES) throw erro(413, `O arquivo passa do limite de ${LIMITE_ANEXO_BYTES / 1024 / 1024} MB.`);
  if (comentarioId) {
    const c = await lerComentario(api, origem, registroId, comentarioId);
    if (!mesmoId(c.usuario_id, usuarioId)) throw erro(403, 'Só quem escreveu o comentário anexa arquivos nele.');
  } else {
    const item = await lerEvento(api, origem, registroId, itemId);
    if (item.tipo !== 'observacao' || !mesmoId(item.usuario_id, usuarioId)) throw erro(403, 'Anexo direto só na sua própria observação.');
  }
  const partes = partesDoArquivo(buffer);
  const anexo = await escreverSocial(api.post('/api/historico_anexos', {
    origem, registro_id: Number(registroId), item_id: comentarioId ? null : Number(itemId),
    comentario_id: comentarioId ? Number(comentarioId) : null, nome_arquivo: nomeDeArquivo(nome),
    tipo_mime: texto(tipo).slice(0, 120) || null, tamanho_bytes: buffer.length, partes: partes.length,
    completo: false, usuario_id: usuarioId ?? null
  }));
  try {
    for (let i = 0; i < partes.length; i++) {
      await api.post('/api/historico_anexo_partes', { anexo_id: Number(anexo.id), ordem: i, dados: partes[i] });
    }
    return await api.put(`/api/historico_anexos/${anexo.id}`, { completo: true });
  } catch (err) {
    await api.delete(`/api/historico_anexos/${anexo.id}`).catch(() => null);
    throw err;
  }
}

/** O anexo inteiro (metadados + conteúdo em base64). */
async function lerAnexo(api, anexoId) {
  const anexo = await api.get(`/api/historico_anexos/${anexoId}`).catch(() => null);
  if (!anexo || anexo.error || !anexo.completo) throw erro(404, 'Anexo não encontrado.');
  const partes = lista(await api.get('/api/historico_anexo_partes', { query: { anexo_id: anexoId } }))
    .sort((a, b) => Number(a.ordem) - Number(b.ordem));
  if (partes.length !== Number(anexo.partes)) throw erro(409, 'O anexo está incompleto no banco.');
  const buffer = Buffer.concat(partes.map(p => Buffer.from(String(p.dados || ''), 'base64')));
  return { anexo, base64: buffer.toString('base64') };
}

module.exports = {
  ORIGENS, LIMITE_ANEXO_BYTES, TAMANHO_PARTE, LIMITE_TEXTO,
  erro, semTabela, origemValida, textoValido, trecho, agruparCurtidas, destinatarios, textoDoAviso,
  partesDoArquivo, nomeDeArquivo, montarLinhaDoTempo,
  nomesDosUsuarios, lerRegistro, carregarLinhaDoTempo, registrarEventos, notificar,
  publicarObservacao, comentar, editarComentario, alternarCurtida, excluirEvento, excluirComentario,
  salvarAnexo, lerAnexo
};
