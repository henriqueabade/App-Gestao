// chat/chat.js — o chat interno (pedido do dono, 12/10/2026): conversas ao
// vivo entre os usuários, no molde do chat do ClickUp.
//
//   direta   duas pessoas (a chave "menor:maior" dos ids não deixa repetir);
//   grupo    fechado: só quem está dentro vê e convida;
//   canal    aberto: aparece para todos, e qualquer um entra e sai.
//
// Tudo aqui confere a PARTICIPAÇÃO: só lê e escreve numa conversa quem está
// nela (nem o Sup Admin lê conversa alheia — ele só arquiva canal e grupo).
// Mensagem não se apaga: "apagar" marca apagada_em; editar guarda o texto
// anterior em chat_mensagens_versoes. As tabelas: sql/chat_interno.sql do
// App-Gestão (a rota genérica /api/:tabela não as abre).
//
// Puro em relação ao Express: cada função recebe o id de quem pede e devolve
// os dados ou lança erro({status}). As rotas (e o "ao vivo") ficam em
// chat/rotas.js; a presença, em chat/presenca.js.
//
// O MESMO arquivo existe no App-Gestão (backend/chat/chat.js), que o usa com
// BANCO=DEV (banco local). Mudou aqui, copie lá (scripts/copiar-chat-da-api.js).
// ------------------------------------------------------------------

const TIPOS = ["direta", "grupo", "canal"];
const MAXIMO_TEXTO = 4000;
const MAXIMO_NOME = 60;
const MAXIMO_MEMBROS_NOVOS = 50;
const LIMITE_PADRAO = 50;
const LIMITE_MAXIMO = 200;
const MAXIMO_REFERENCIAS = 20;
const STATUS = ["automatico", "ocupado", "ausente", "invisivel"];
// O que dá para citar com # (quem vê o nome é conferido no programa, pela permissão).
const TIPOS_DE_REFERENCIA = ["tarefa", "cliente", "prospeccao", "contato", "pedido", "orcamento", "produto"];
// As reações oferecidas (texto livre viraria lugar de recado escondido).
const REACOES = ["👍", "❤️", "😂", "😮", "😢", "🙏", "✅", "👀", "🎉", "🔥", "👏", "💯"];

const SQL_FALTANDO = "O chat ainda não está no banco: rode sql/chat_interno.sql e reinicie a API.";

function erro(status, mensagem, extra = {}) {
  const e = new Error(mensagem);
  e.status = status;
  Object.assign(e, extra);
  return e;
}

const limpo = (texto, maximo) => (typeof texto === "string" ? texto.replace(/\r\n?/g, "\n").trim().slice(0, maximo) : "");
const linhaUnica = (texto, maximo) => limpo(texto, maximo).replace(/\s+/g, " ");
const inteiro = v => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const ativo = status => ["ativo", "ativa", "active"].includes(String(status ?? "").trim().toLowerCase());

/** "Sup Admin", "SUP-ADMIN", "Super Admin"… (a mesma regra do programa). */
function ehSupAdmin(usuario) {
  const perfil = String(usuario?.perfil ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[\s._-]+/g, "").toLowerCase();
  return perfil === "supadmin" || perfil === "superadmin";
}

/** Os ids citados com @ (só números, sem repetir). Pura. */
function idsDasMencoes(lista) {
  return [...new Set((Array.isArray(lista) ? lista : []).map(inteiro).filter(Boolean))].slice(0, 100);
}

/** As citações com # ([{tipo, id}]), só os tipos conhecidos. Pura. */
function referenciasValidas(lista) {
  const vistas = new Set();
  const saida = [];
  for (const r of Array.isArray(lista) ? lista : []) {
    const tipo = String(r?.tipo || "");
    const id = inteiro(r?.id);
    if (!TIPOS_DE_REFERENCIA.includes(tipo) || !id) continue;
    const chave = `${tipo}:${id}`;
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    saida.push({ tipo, id });
    if (saida.length >= MAXIMO_REFERENCIAS) break;
  }
  return saida;
}

/**
 * As marcas dentro do texto (o programa as põe ao escolher na lista):
 *   [[@5]]            menção ao usuário 5 (avisado no sino);
 *   [[#cliente:12]]   citação do cliente 12 (cada um vê o nome se tiver a
 *                     permissão de ver clientes — o programa confere).
 * Quem decide o que foi citado é o texto, não uma lista à parte. Pura.
 */
const RE_MENCAO = /\[\[@(\d{1,9})\]\]/g;
const RE_REFERENCIA = new RegExp(`\\[\\[#(${TIPOS_DE_REFERENCIA.join("|")}):(\\d{1,12})\\]\\]`, "g");
function extrairMarcas(texto) {
  const t = String(texto || "");
  return {
    mencoes: idsDasMencoes([...t.matchAll(RE_MENCAO)].map(m => m[1])),
    referencias: referenciasValidas([...t.matchAll(RE_REFERENCIA)].map(m => ({ tipo: m[2] ? m[1] : null, id: m[2] })))
  };
}

/**
 * O texto para fora do chat (o aviso no sino, o Windows): menção vira
 * "@Nome", citação vira "#cliente" (o nome do registro não sai daqui —
 * quem recebe pode não ter a permissão de vê-lo). Pura.
 */
function textoSimples(texto, nomes = new Map()) {
  return String(texto || "")
    .replace(RE_MENCAO, (_, id) => `@${nomes.get(String(id)) || "alguém"}`)
    .replace(RE_REFERENCIA, (_, tipo) => `#${ROTULO_DA_REFERENCIA[tipo] || tipo}`)
    .replace(/\s+/g, " ")
    .trim();
}
const ROTULO_DA_REFERENCIA = { tarefa: "tarefa", cliente: "cliente", prospeccao: "prospecção", contato: "contato", pedido: "pedido", orcamento: "orçamento", produto: "produto" };

const jsonDe = v => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (_) { return []; }
  }
  return [];
};

/**
 * @param {object} deps
 * @param {{query: Function, connect?: Function}} deps.pool
 * @param {() => Date} [deps.agora]
 */
function criarChat({ pool, agora = () => new Date() }) {
  async function q(sql, params = []) {
    try {
      return await pool.query(sql, params);
    } catch (err) {
      if (/relation "chat_/.test(String(err?.message || ""))) throw erro(503, SQL_FALTANDO, { code: "CHAT_SQL" });
      throw err;
    }
  }

  async function emTransacao(acao) {
    if (typeof pool.connect !== "function") return acao({ query: (s, p) => q(s, p) });
    const cliente = await pool.connect();
    try {
      await cliente.query("BEGIN");
      const r = await acao(cliente);
      await cliente.query("COMMIT");
      return r;
    } catch (err) {
      try { await cliente.query("ROLLBACK"); } catch (_) { /* a conexão caiu */ }
      if (/relation "chat_/.test(String(err?.message || ""))) throw erro(503, SQL_FALTANDO, { code: "CHAT_SQL" });
      throw err;
    } finally {
      cliente.release();
    }
  }

  // ------------------------------------------------------------ usuários

  /** Os usuários ativos (quem dá para chamar), com o que a lista mostra. */
  async function usuariosAtivos() {
    const { rows } = await pool.query("SELECT * FROM usuarios");
    return rows
      .filter(u => ativo(u.status))
      .map(u => ({ id: u.id, nome: u.nome || u.email || `Usuário ${u.id}`, perfil: u.perfil || null, foto_perfil: u.foto_perfil || null }))
      .sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
  }

  async function usuario(id) {
    const { rows } = await pool.query("SELECT * FROM usuarios WHERE id = $1", [id]);
    return rows[0] || null;
  }

  /** Quem está com o programa rodando (o sinal de minuto dos avisos do Windows). */
  async function comProgramaRodando(janelaMs = 3 * 60 * 1000) {
    try {
      const { rows } = await pool.query(
        "SELECT usuario_id, max(ultimo_uso_em) AS ultimo FROM avisos_dispositivos WHERE cancelado_em IS NULL GROUP BY usuario_id"
      );
      const limite = agora().getTime() - janelaMs;
      return new Set(rows.filter(r => r.ultimo && new Date(r.ultimo).getTime() >= limite).map(r => String(r.usuario_id)));
    } catch (_) {
      return new Set();
    }
  }

  // ------------------------------------------------------------- status

  async function statusDe(ids = null) {
    const { rows } = await q("SELECT usuario_id, status, mensagem, atualizado_em FROM chat_status");
    const mapa = new Map(rows.map(r => [String(r.usuario_id), { status: r.status, mensagem: r.mensagem || null, atualizado_em: r.atualizado_em }]));
    if (!ids) return mapa;
    return new Map([...ids].map(id => [String(id), mapa.get(String(id)) || { status: "automatico", mensagem: null }]));
  }

  async function gravarStatus(usuarioId, { status, mensagem } = {}) {
    const s = String(status || "automatico");
    if (!STATUS.includes(s)) throw erro(400, "Status inválido.");
    const recado = linhaUnica(mensagem, 120) || null;
    await q(
      `INSERT INTO chat_status (usuario_id, status, mensagem, atualizado_em) VALUES ($1, $2, $3, $4)
       ON CONFLICT (usuario_id) DO UPDATE SET status = EXCLUDED.status, mensagem = EXCLUDED.mensagem, atualizado_em = EXCLUDED.atualizado_em`,
      [usuarioId, s, recado, agora().toISOString()]
    );
    return { status: s, mensagem: recado };
  }

  // ---------------------------------------------------------- conversas

  async function participacao(usuarioId, conversaId, banco = { query: q }) {
    const { rows } = await banco.query(
      `SELECT c.*, p.papel, p.saiu_em, p.lida_ate_id
         FROM chat_conversas c LEFT JOIN chat_participantes p ON p.conversa_id = c.id AND p.usuario_id = $2
        WHERE c.id = $1`,
      [conversaId, usuarioId]
    );
    return rows[0] || null;
  }

  /** A conversa, se quem pede está nela (senão 404 — não diz que existe). */
  async function exigirParticipante(usuarioId, conversaId, banco) {
    const id = inteiro(conversaId);
    const c = id ? await participacao(usuarioId, id, banco) : null;
    if (!c || !c.papel || c.saiu_em) throw erro(404, "Conversa não encontrada.");
    if (c.arquivada_em) throw erro(409, "Esta conversa foi arquivada.");
    return c;
  }

  /** Os ids de quem está na conversa agora (para o "ao vivo"). */
  async function participantesAtivos(conversaId) {
    const { rows } = await q("SELECT usuario_id FROM chat_participantes WHERE conversa_id = $1 AND saiu_em IS NULL", [conversaId]);
    return rows.map(r => r.usuario_id);
  }

  /** As conversas de quem pede, com a última mensagem, as não lidas e as menções. */
  async function conversasDo(usuarioId) {
    const { rows } = await q(
      `SELECT c.id, c.tipo, c.nome, c.descricao, c.criado_por, c.criado_em, c.ultima_mensagem_em,
              p.lida_ate_id, p.silenciada, p.fixada, p.papel,
              m.id AS ult_id, m.texto AS ult_texto, m.autor_id AS ult_autor, m.criado_em AS ult_em,
              m.apagada_em AS ult_apagada, m.tipo AS ult_tipo,
              (SELECT count(*) FROM chat_mensagens x
                WHERE x.conversa_id = c.id AND x.id > p.lida_ate_id AND x.apagada_em IS NULL
                  AND x.autor_id IS DISTINCT FROM $1)::int AS nao_lidas,
              (SELECT count(*) FROM chat_mensagens x
                WHERE x.conversa_id = c.id AND x.id > p.lida_ate_id AND x.apagada_em IS NULL
                  AND x.mencoes @> to_jsonb($1::int))::int AS mencoes,
              (SELECT count(*) FROM chat_participantes y WHERE y.conversa_id = c.id AND y.saiu_em IS NULL)::int AS membros,
              (SELECT y.usuario_id FROM chat_participantes y WHERE y.conversa_id = c.id AND y.usuario_id <> $1 ORDER BY y.id LIMIT 1) AS outro_id,
              (SELECT y.lida_ate_id FROM chat_participantes y WHERE y.conversa_id = c.id AND y.usuario_id <> $1 ORDER BY y.id LIMIT 1) AS outro_lida_ate_id
         FROM chat_participantes p
         JOIN chat_conversas c ON c.id = p.conversa_id
         LEFT JOIN chat_mensagens m ON m.id = c.ultima_mensagem_id
        WHERE p.usuario_id = $1 AND p.saiu_em IS NULL AND c.arquivada_em IS NULL
        ORDER BY p.fixada DESC, COALESCE(c.ultima_mensagem_em, c.criado_em) DESC`,
      [usuarioId]
    );
    return rows.map(r => ({
      id: r.id, tipo: r.tipo, nome: r.nome || null, descricao: r.descricao || null, criado_por: r.criado_por,
      papel: r.papel, silenciada: Boolean(r.silenciada), fixada: Boolean(r.fixada),
      lida_ate_id: r.lida_ate_id, nao_lidas: r.nao_lidas, mencoes: r.mencoes, membros: r.membros,
      outro_id: r.tipo === "direta" ? r.outro_id : null,
      outro_lida_ate_id: r.tipo === "direta" ? r.outro_lida_ate_id : null,
      ultima: r.ult_id ? {
        id: r.ult_id, autor_id: r.ult_autor, tipo: r.ult_tipo, em: r.ult_em,
        texto: r.ult_apagada ? "" : String(r.ult_texto || "").slice(0, 160), apagada: Boolean(r.ult_apagada)
      } : null,
      atualizada_em: r.ultima_mensagem_em || r.criado_em
    }));
  }

  /** Os canais abertos (para descobrir e entrar), dizendo se já está neles. */
  async function canaisAbertos(usuarioId) {
    const { rows } = await q(
      `SELECT c.id, c.nome, c.descricao, c.criado_em,
              (SELECT count(*) FROM chat_participantes y WHERE y.conversa_id = c.id AND y.saiu_em IS NULL)::int AS membros,
              EXISTS (SELECT 1 FROM chat_participantes y WHERE y.conversa_id = c.id AND y.usuario_id = $1 AND y.saiu_em IS NULL) AS dentro
         FROM chat_conversas c
        WHERE c.tipo = 'canal' AND c.arquivada_em IS NULL
        ORDER BY lower(c.nome)`,
      [usuarioId]
    );
    return rows.map(r => ({ id: r.id, nome: r.nome, descricao: r.descricao || null, membros: r.membros, dentro: Boolean(r.dentro) }));
  }

  /**
   * O aviso do próprio chat ("Ana criou o grupo."). `quemFez` já leu: o aviso
   * da própria ação não conta como não lida para quem a fez.
   */
  async function mensagemDeSistema(banco, conversaId, texto, { quemFez = null } = {}) {
    const { rows } = await banco.query(
      "INSERT INTO chat_mensagens (conversa_id, autor_id, tipo, texto, criado_em) VALUES ($1, NULL, 'sistema', $2, $3) RETURNING id, criado_em",
      [conversaId, texto, agora().toISOString()]
    );
    await banco.query("UPDATE chat_conversas SET ultima_mensagem_id = $1, ultima_mensagem_em = $2 WHERE id = $3", [rows[0].id, rows[0].criado_em, conversaId]);
    if (quemFez) {
      await banco.query("UPDATE chat_participantes SET lida_ate_id = GREATEST(lida_ate_id, $1) WHERE conversa_id = $2 AND usuario_id = $3", [rows[0].id, conversaId, quemFez]);
    }
    return rows[0];
  }

  /** A última mensagem da conversa (quem chega vê o que havia, mas não como "não lida"). */
  async function ultimaDaConversa(banco, conversaId) {
    const { rows } = await banco.query("SELECT COALESCE(max(id), 0) AS id FROM chat_mensagens WHERE conversa_id = $1", [conversaId]);
    return Number(rows[0].id) || 0;
  }

  /** A direta com outra pessoa: acha a que existe ou cria. */
  async function abrirDireta(usuarioId, outroIdBruto) {
    const outroId = inteiro(outroIdBruto);
    if (!outroId || String(outroId) === String(usuarioId)) throw erro(400, "Escolha com quem conversar.");
    const outro = await usuario(outroId);
    if (!outro || !ativo(outro.status)) throw erro(404, "Este usuário não está ativo.");
    const chave = [Number(usuarioId), outroId].sort((a, b) => a - b).join(":");
    return emTransacao(async banco => {
      const quando = agora().toISOString();
      await banco.query(
        "INSERT INTO chat_conversas (tipo, chave_direta, criado_por, criado_em) VALUES ('direta', $1, $2, $3) ON CONFLICT (chave_direta) DO NOTHING",
        [chave, usuarioId, quando]
      );
      const { rows } = await banco.query("SELECT id FROM chat_conversas WHERE chave_direta = $1", [chave]);
      const id = rows[0].id;
      for (const u of [usuarioId, outroId]) {
        await banco.query(
          `INSERT INTO chat_participantes (conversa_id, usuario_id, papel, entrou_em) VALUES ($1, $2, 'membro', $3)
           ON CONFLICT (conversa_id, usuario_id) DO UPDATE SET saiu_em = NULL`,
          [id, u, quando]
        );
      }
      return { id };
    });
  }

  /** Grupo (fechado) ou canal (aberto). Quem cria é o administrador. */
  async function criarConversa(usuarioId, { tipo, nome, descricao, membros } = {}) {
    if (!["grupo", "canal"].includes(tipo)) throw erro(400, "Escolha grupo ou canal.");
    const nomeLimpo = linhaUnica(nome, MAXIMO_NOME);
    if (tipo === "canal" && nomeLimpo.replace(/[^\p{L}\p{N}]/gu, "").length < 2) throw erro(400, "Dê um nome ao canal.");
    const ativos = new Map((await usuariosAtivos()).map(u => [String(u.id), u]));
    const convidados = idsDasMencoes(membros).filter(id => String(id) !== String(usuarioId) && ativos.has(String(id))).slice(0, MAXIMO_MEMBROS_NOVOS);
    if (tipo === "grupo" && !convidados.length) throw erro(400, "Escolha quem participa do grupo.");
    if (tipo === "canal") {
      const { rows } = await q("SELECT id FROM chat_conversas WHERE tipo = 'canal' AND arquivada_em IS NULL AND lower(nome) = lower($1)", [nomeLimpo]);
      if (rows[0]) throw erro(409, `Já existe o canal "${nomeLimpo}".`);
    }
    const autor = ativos.get(String(usuarioId))?.nome || "Alguém";
    return emTransacao(async banco => {
      const quando = agora().toISOString();
      const { rows } = await banco.query(
        "INSERT INTO chat_conversas (tipo, nome, descricao, criado_por, criado_em) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        [tipo, nomeLimpo || null, linhaUnica(descricao, 200) || null, usuarioId, quando]
      );
      const id = rows[0].id;
      await banco.query("INSERT INTO chat_participantes (conversa_id, usuario_id, papel, entrou_em) VALUES ($1, $2, 'admin', $3)", [id, usuarioId, quando]);
      for (const u of convidados) {
        await banco.query("INSERT INTO chat_participantes (conversa_id, usuario_id, papel, entrou_em) VALUES ($1, $2, 'membro', $3)", [id, u, quando]);
      }
      await mensagemDeSistema(banco, id, tipo === "canal" ? `${autor} criou o canal.` : `${autor} criou o grupo.`, { quemFez: usuarioId });
      return { id };
    });
  }

  /** Entrar num canal aberto (ou voltar a ele). */
  async function entrarNoCanal(usuarioId, conversaIdBruto) {
    const id = inteiro(conversaIdBruto);
    const c = id ? await participacao(usuarioId, id) : null;
    if (!c || c.tipo !== "canal" || c.arquivada_em) throw erro(404, "Canal não encontrado.");
    if (c.papel && !c.saiu_em) return { id, ja_estava: true };
    const nome = (await usuario(usuarioId))?.nome || "Alguém";
    return emTransacao(async banco => {
      await banco.query(
        `INSERT INTO chat_participantes (conversa_id, usuario_id, papel, entrou_em) VALUES ($1, $2, 'membro', $3)
         ON CONFLICT (conversa_id, usuario_id) DO UPDATE SET saiu_em = NULL, entrou_em = EXCLUDED.entrou_em`,
        [id, usuarioId, agora().toISOString()]
      );
      // Quem entra vê a conversa de antes, sem ela virar "não lida".
      await mensagemDeSistema(banco, id, `${nome} entrou no canal.`, { quemFez: usuarioId });
      return { id };
    });
  }

  /** Sair de grupo ou canal (da direta não se sai). */
  async function sair(usuarioId, conversaId) {
    const c = await exigirParticipante(usuarioId, conversaId);
    if (c.tipo === "direta") throw erro(400, "Não dá para sair de uma conversa direta.");
    const nome = (await usuario(usuarioId))?.nome || "Alguém";
    return emTransacao(async banco => {
      await banco.query("UPDATE chat_participantes SET saiu_em = $1 WHERE conversa_id = $2 AND usuario_id = $3", [agora().toISOString(), c.id, usuarioId]);
      await mensagemDeSistema(banco, c.id, `${nome} saiu.`);
      return { id: c.id };
    });
  }

  /** Chamar mais gente para um grupo ou canal (quem está dentro chama). */
  async function adicionarMembros(usuarioId, conversaId, membros) {
    const c = await exigirParticipante(usuarioId, conversaId);
    if (c.tipo === "direta") throw erro(400, "Para conversar em mais gente, crie um grupo.");
    const ativos = new Map((await usuariosAtivos()).map(u => [String(u.id), u]));
    const { rows: dentro } = await q("SELECT usuario_id FROM chat_participantes WHERE conversa_id = $1 AND saiu_em IS NULL", [c.id]);
    const jaEstao = new Set(dentro.map(r => String(r.usuario_id)));
    const novos = idsDasMencoes(membros).filter(id => ativos.has(String(id)) && !jaEstao.has(String(id))).slice(0, MAXIMO_MEMBROS_NOVOS);
    if (!novos.length) throw erro(400, "Escolha quem entra (que ainda não esteja na conversa).");
    const quem = ativos.get(String(usuarioId))?.nome || "Alguém";
    return emTransacao(async banco => {
      const quando = agora().toISOString();
      // Quem chega vê o que já havia; "não lida" é só o aviso de que entrou.
      const ate = await ultimaDaConversa(banco, c.id);
      for (const u of novos) {
        await banco.query(
          `INSERT INTO chat_participantes (conversa_id, usuario_id, papel, entrou_em, lida_ate_id) VALUES ($1, $2, 'membro', $3, $4)
           ON CONFLICT (conversa_id, usuario_id) DO UPDATE SET saiu_em = NULL, entrou_em = EXCLUDED.entrou_em,
             lida_ate_id = GREATEST(chat_participantes.lida_ate_id, EXCLUDED.lida_ate_id)`,
          [c.id, u, quando, ate]
        );
      }
      const nomes = novos.map(id => ativos.get(String(id)).nome);
      await mensagemDeSistema(banco, c.id, `${quem} adicionou ${nomes.join(", ")}.`, { quemFez: usuarioId });
      return { id: c.id, novos };
    });
  }

  /** Renomear / descrever (o administrador da conversa ou o Sup Admin). */
  async function alterarConversa(usuarioId, conversaId, { nome, descricao } = {}) {
    const c = await exigirParticipante(usuarioId, conversaId);
    if (c.tipo === "direta") throw erro(400, "A conversa direta não tem nome.");
    const quem = await usuario(usuarioId);
    if (c.papel !== "admin" && !ehSupAdmin(quem)) throw erro(403, "Só quem administra a conversa muda o nome.");
    const novoNome = nome === undefined ? c.nome : linhaUnica(nome, MAXIMO_NOME);
    if (c.tipo === "canal" && novoNome.replace(/[^\p{L}\p{N}]/gu, "").length < 2) throw erro(400, "Dê um nome ao canal.");
    const novaDescricao = descricao === undefined ? c.descricao : (linhaUnica(descricao, 200) || null);
    return emTransacao(async banco => {
      await banco.query("UPDATE chat_conversas SET nome = $1, descricao = $2, atualizado_em = $3 WHERE id = $4", [novoNome || null, novaDescricao, agora().toISOString(), c.id]);
      if (novoNome !== c.nome) await mensagemDeSistema(banco, c.id, `${quem?.nome || "Alguém"} mudou o nome para "${novoNome}".`, { quemFez: usuarioId });
      return { id: c.id };
    });
  }

  /** Arquivar grupo ou canal (o administrador ou o Sup Admin). Não apaga nada. */
  async function arquivar(usuarioId, conversaIdBruto) {
    const id = inteiro(conversaIdBruto);
    const c = id ? await participacao(usuarioId, id) : null;
    if (!c || c.tipo === "direta") throw erro(404, "Conversa não encontrada.");
    const quem = await usuario(usuarioId);
    const admin = c.papel === "admin" && !c.saiu_em;
    if (!admin && !ehSupAdmin(quem)) throw erro(403, "Só quem administra a conversa (ou o Sup Admin) arquiva.");
    if (c.arquivada_em) return { id, ja_estava: true };
    await q("UPDATE chat_conversas SET arquivada_em = $1, arquivada_por = $2 WHERE id = $3", [agora().toISOString(), usuarioId, id]);
    return { id };
  }

  /** Silenciar / fixar (de cada um). */
  async function preferencias(usuarioId, conversaId, { silenciada, fixada } = {}) {
    const c = await exigirParticipante(usuarioId, conversaId);
    const campos = [];
    const valores = [];
    if (typeof silenciada === "boolean") { valores.push(silenciada); campos.push(`silenciada = $${valores.length}`); }
    if (typeof fixada === "boolean") { valores.push(fixada); campos.push(`fixada = $${valores.length}`); }
    if (!campos.length) return { id: c.id };
    valores.push(c.id, usuarioId);
    await q(`UPDATE chat_participantes SET ${campos.join(", ")} WHERE conversa_id = $${valores.length - 1} AND usuario_id = $${valores.length}`, valores);
    return { id: c.id };
  }

  /** Quem está na conversa (com o papel e até onde leu). */
  async function membros(usuarioId, conversaId) {
    const c = await exigirParticipante(usuarioId, conversaId);
    const { rows } = await q(
      "SELECT usuario_id, papel, entrou_em, lida_ate_id FROM chat_participantes WHERE conversa_id = $1 AND saiu_em IS NULL ORDER BY entrou_em",
      [c.id]
    );
    return rows.map(r => ({ usuario_id: r.usuario_id, papel: r.papel, entrou_em: r.entrou_em, lida_ate_id: r.lida_ate_id }));
  }

  // ----------------------------------------------------------- mensagens

  function paraMensagem(m, reacoes = [], resposta = null) {
    const apagada = Boolean(m.apagada_em);
    return {
      id: m.id, conversa_id: m.conversa_id, autor_id: m.autor_id, tipo: m.tipo,
      texto: apagada ? "" : m.texto,
      resposta_de: m.resposta_de || null,
      resposta,
      mencoes: apagada ? [] : jsonDe(m.mencoes),
      referencias: apagada ? [] : jsonDe(m.referencias),
      criado_em: m.criado_em, editada_em: m.editada_em || null, apagada,
      reacoes
    };
  }

  async function completar(linhas) {
    if (!linhas.length) return [];
    const ids = linhas.map(m => m.id);
    const { rows: reacoes } = await q(
      "SELECT mensagem_id, emoji, array_agg(usuario_id ORDER BY criado_em) AS usuarios FROM chat_reacoes WHERE mensagem_id = ANY($1) GROUP BY mensagem_id, emoji",
      [ids]
    );
    const porMensagem = new Map();
    for (const r of reacoes) {
      if (!porMensagem.has(r.mensagem_id)) porMensagem.set(r.mensagem_id, []);
      porMensagem.get(r.mensagem_id).push({ emoji: r.emoji, usuarios: r.usuarios.map(Number) });
    }
    const idsResposta = [...new Set(linhas.map(m => m.resposta_de).filter(Boolean))];
    const respostas = new Map();
    if (idsResposta.length) {
      const { rows } = await q("SELECT id, autor_id, texto, apagada_em FROM chat_mensagens WHERE id = ANY($1)", [idsResposta]);
      for (const r of rows) respostas.set(r.id, { id: r.id, autor_id: r.autor_id, texto: r.apagada_em ? "" : String(r.texto || "").slice(0, 200), apagada: Boolean(r.apagada_em) });
    }
    return linhas.map(m => paraMensagem(m, porMensagem.get(m.id) || [], m.resposta_de ? respostas.get(m.resposta_de) || null : null));
  }

  /** As mensagens (as mais novas por último). `antes`/`depois` = ids, para rolar e para buscar o que chegou. */
  async function mensagens(usuarioId, conversaId, { antes, depois, limite } = {}) {
    const c = await exigirParticipante(usuarioId, conversaId);
    const n = Math.min(LIMITE_MAXIMO, inteiro(limite) || LIMITE_PADRAO);
    const params = [c.id];
    let filtro = "";
    if (inteiro(antes)) { params.push(inteiro(antes)); filtro += ` AND id < $${params.length}`; }
    if (inteiro(depois)) { params.push(inteiro(depois)); filtro += ` AND id > $${params.length}`; }
    params.push(n + 1);
    const ordem = inteiro(depois) && !inteiro(antes) ? "ASC" : "DESC";
    const { rows } = await q(`SELECT * FROM chat_mensagens WHERE conversa_id = $1${filtro} ORDER BY id ${ordem} LIMIT $${params.length}`, params);
    const mais = rows.length > n;
    const lista = rows.slice(0, n);
    if (ordem === "DESC") lista.reverse();
    return { mensagens: await completar(lista), mais_antigas: ordem === "DESC" ? mais : undefined };
  }

  async function mensagemPorId(id) {
    const { rows } = await q("SELECT * FROM chat_mensagens WHERE id = $1", [id]);
    return rows[0] ? (await completar([rows[0]]))[0] : null;
  }

  /** Escrever. Devolve a mensagem e quem está na conversa (para avisar). */
  async function enviar(usuarioId, conversaId, { texto, resposta_de } = {}) {
    const c = await exigirParticipante(usuarioId, conversaId);
    const corpo = limpo(texto, MAXIMO_TEXTO + 1);
    if (!corpo) throw erro(400, "Escreva a mensagem.");
    if (corpo.length > MAXIMO_TEXTO) throw erro(400, `A mensagem passa de ${MAXIMO_TEXTO} letras.`);
    let resposta = null;
    if (resposta_de !== undefined && resposta_de !== null && resposta_de !== "") {
      const { rows } = await q("SELECT id FROM chat_mensagens WHERE id = $1 AND conversa_id = $2", [inteiro(resposta_de), c.id]);
      if (!rows[0]) throw erro(400, "A mensagem respondida não é desta conversa.");
      resposta = rows[0].id;
    }
    const participantes = await participantesAtivos(c.id);
    const dentro = new Set(participantes.map(String));
    const marcas = extrairMarcas(corpo);
    const citados = marcas.mencoes.filter(id => dentro.has(String(id)) && String(id) !== String(usuarioId));
    const refs = marcas.referencias;
    const criada = await emTransacao(async banco => {
      const quando = agora().toISOString();
      const { rows } = await banco.query(
        `INSERT INTO chat_mensagens (conversa_id, autor_id, tipo, texto, resposta_de, mencoes, referencias, criado_em)
         VALUES ($1, $2, 'texto', $3, $4, $5::jsonb, $6::jsonb, $7) RETURNING *`,
        [c.id, usuarioId, corpo, resposta, JSON.stringify(citados), JSON.stringify(refs), quando]
      );
      const m = rows[0];
      await banco.query("UPDATE chat_conversas SET ultima_mensagem_id = $1, ultima_mensagem_em = $2 WHERE id = $3", [m.id, m.criado_em, c.id]);
      // O que a própria pessoa escreveu ela já leu.
      await banco.query("UPDATE chat_participantes SET lida_ate_id = GREATEST(lida_ate_id, $1) WHERE conversa_id = $2 AND usuario_id = $3", [m.id, c.id, usuarioId]);
      return m;
    });
    return { mensagem: (await completar([criada]))[0], participantes, conversa: { id: c.id, tipo: c.tipo, nome: c.nome } };
  }

  async function mensagemDaConversa(usuarioId, mensagemIdBruto) {
    const id = inteiro(mensagemIdBruto);
    const { rows } = id ? await q("SELECT * FROM chat_mensagens WHERE id = $1", [id]) : { rows: [] };
    const m = rows[0];
    if (!m) throw erro(404, "Mensagem não encontrada.");
    const c = await exigirParticipante(usuarioId, m.conversa_id);
    return { m, c };
  }

  /** Editar a própria mensagem (o texto anterior fica guardado). */
  async function editar(usuarioId, mensagemId, { texto } = {}) {
    const { m, c } = await mensagemDaConversa(usuarioId, mensagemId);
    if (String(m.autor_id) !== String(usuarioId) || m.tipo !== "texto") throw erro(403, "Só quem escreveu edita a mensagem.");
    if (m.apagada_em) throw erro(409, "Esta mensagem foi apagada.");
    const corpo = limpo(texto, MAXIMO_TEXTO + 1);
    if (!corpo) throw erro(400, "Escreva a mensagem.");
    if (corpo.length > MAXIMO_TEXTO) throw erro(400, `A mensagem passa de ${MAXIMO_TEXTO} letras.`);
    if (corpo === m.texto) return { mensagem: await mensagemPorId(m.id), participantes: await participantesAtivos(c.id) };
    const dentro = new Set((await participantesAtivos(c.id)).map(String));
    const marcas = extrairMarcas(corpo);
    const citados = marcas.mencoes.filter(id => dentro.has(String(id)) && String(id) !== String(usuarioId));
    await emTransacao(async banco => {
      const quando = agora().toISOString();
      await banco.query("INSERT INTO chat_mensagens_versoes (mensagem_id, texto_anterior, editada_em, editada_por) VALUES ($1, $2, $3, $4)", [m.id, m.texto, quando, usuarioId]);
      await banco.query(
        "UPDATE chat_mensagens SET texto = $1, mencoes = $2::jsonb, referencias = $3::jsonb, editada_em = $4 WHERE id = $5",
        [corpo, JSON.stringify(citados), JSON.stringify(marcas.referencias), quando, m.id]
      );
    });
    return { mensagem: await mensagemPorId(m.id), participantes: [...dentro].map(Number), novasMencoes: citados.filter(id => !jsonDe(m.mencoes).map(String).includes(String(id))) };
  }

  /** "Apagar": a própria mensagem (ou qualquer uma, o Sup Admin). Fica marcada, não some. */
  async function apagar(usuarioId, mensagemId) {
    const { m, c } = await mensagemDaConversa(usuarioId, mensagemId);
    const quem = await usuario(usuarioId);
    if (String(m.autor_id) !== String(usuarioId) && !ehSupAdmin(quem)) throw erro(403, "Só quem escreveu apaga a mensagem.");
    if (m.tipo !== "texto") throw erro(400, "Aviso do sistema não se apaga.");
    if (!m.apagada_em) await q("UPDATE chat_mensagens SET apagada_em = $1, apagada_por = $2 WHERE id = $3", [agora().toISOString(), usuarioId, m.id]);
    return { mensagem: await mensagemPorId(m.id), participantes: await participantesAtivos(c.id) };
  }

  /** Reagir: a mesma reação de novo tira. */
  async function reagir(usuarioId, mensagemId, emoji) {
    const { m, c } = await mensagemDaConversa(usuarioId, mensagemId);
    if (!REACOES.includes(emoji)) throw erro(400, "Reação inválida.");
    if (m.apagada_em) throw erro(409, "Esta mensagem foi apagada.");
    const { rows } = await q("DELETE FROM chat_reacoes WHERE mensagem_id = $1 AND usuario_id = $2 AND emoji = $3 RETURNING id", [m.id, usuarioId, emoji]);
    if (!rows.length) {
      await q(
        "INSERT INTO chat_reacoes (mensagem_id, usuario_id, emoji, criado_em) VALUES ($1, $2, $3, $4) ON CONFLICT (mensagem_id, usuario_id, emoji) DO NOTHING",
        [m.id, usuarioId, emoji, agora().toISOString()]
      );
    }
    return { mensagem: await mensagemPorId(m.id), participantes: await participantesAtivos(c.id) };
  }

  /** Leu até a mensagem `ate` (nunca volta para trás). */
  async function marcarLida(usuarioId, conversaId, ateBruto) {
    const c = await exigirParticipante(usuarioId, conversaId);
    const { rows } = await q("SELECT max(id) AS ultima FROM chat_mensagens WHERE conversa_id = $1", [c.id]);
    const ultima = Number(rows[0]?.ultima) || 0;
    const ate = Math.min(inteiro(ateBruto) || ultima, ultima);
    await q("UPDATE chat_participantes SET lida_ate_id = GREATEST(lida_ate_id, $1) WHERE conversa_id = $2 AND usuario_id = $3", [ate, c.id, usuarioId]);
    return { id: c.id, ate, participantes: await participantesAtivos(c.id) };
  }

  /** Quantas mensagens não lidas no total (o número do botão). */
  async function totalNaoLidas(usuarioId) {
    const { rows } = await q(
      `SELECT count(*)::int AS total FROM chat_mensagens x
         JOIN chat_participantes p ON p.conversa_id = x.conversa_id AND p.usuario_id = $1 AND p.saiu_em IS NULL
         JOIN chat_conversas c ON c.id = x.conversa_id AND c.arquivada_em IS NULL
        WHERE x.id > p.lida_ate_id AND x.apagada_em IS NULL AND x.autor_id IS DISTINCT FROM $1 AND p.silenciada = FALSE`,
      [usuarioId]
    );
    return rows[0]?.total || 0;
  }

  /** Para o "digitando": é participante? (sem erro, só sim/não) */
  async function estaNaConversa(usuarioId, conversaId) {
    try {
      await exigirParticipante(usuarioId, conversaId);
      return true;
    } catch (_) {
      return false;
    }
  }

  return {
    usuariosAtivos, usuario, comProgramaRodando, statusDe, gravarStatus,
    conversasDo, canaisAbertos, abrirDireta, criarConversa, entrarNoCanal, sair, adicionarMembros,
    alterarConversa, arquivar, preferencias, membros, participantesAtivos, estaNaConversa,
    mensagens, mensagemPorId, enviar, editar, apagar, reagir, marcarLida, totalNaoLidas
  };
}

module.exports = {
  criarChat, erro, ehSupAdmin, idsDasMencoes, referenciasValidas, extrairMarcas, textoSimples,
  TIPOS, STATUS, REACOES, TIPOS_DE_REFERENCIA, MAXIMO_TEXTO, MAXIMO_NOME, SQL_FALTANDO
};
