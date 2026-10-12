// chat/rotas.js — as rotas /chat do chat interno (12/10/2026).
//
//   GET    /eventos                         o "ao vivo" (Server-Sent Events)
//   GET    /resumo                          tudo para abrir: eu, pessoas, conversas, canais
//   GET    /usuarios                        as pessoas, com a presença
//   GET    /conversas                       as minhas conversas
//   GET    /canais                          os canais abertos (para entrar)
//   POST   /conversas/direta {usuario_id}   abre (ou acha) a conversa com alguém
//   POST   /conversas {tipo, nome, descricao, membros}   grupo ou canal
//   PUT    /conversas/:id {nome, descricao}
//   POST   /conversas/:id/entrar | /sair | /arquivar
//   POST   /conversas/:id/membros {membros}
//   GET    /conversas/:id/membros
//   PUT    /conversas/:id/preferencias {silenciada, fixada}
//   GET    /conversas/:id/mensagens?antes=&depois=&limite=
//   POST   /conversas/:id/mensagens {texto, resposta_de}
//   POST   /conversas/:id/lida {ate}
//   POST   /conversas/:id/digitando
//   PUT    /mensagens/:id {texto}       DELETE /mensagens/:id
//   POST   /mensagens/:id/reacoes {emoji}
//   GET    /status        PUT /status {status, mensagem}
//   POST   /presenca {ativo}            mexendo (true) ou parado (false)
//
// `autenticar` põe req.user ({ id }): na API é o authMiddleware; no programa
// com BANCO=DEV, a sessão local. O MESMO arquivo existe no App-Gestão
// (backend/chat/rotas.js).
// ------------------------------------------------------------------

const express = require("express");
const { criarChat, REACOES, TIPOS_DE_REFERENCIA, textoSimples } = require("./chat");
const { criarPresenca } = require("./presenca");
const { criarEventos } = require("./eventos");

// Caiu a conexão (a tela recarregou): espera isto antes de dizer "Offline".
const GRACA_MS = 15 * 1000;

function criarRotasDoChat({ pool, autenticar, agora = () => new Date(), log = console } = {}) {
  const chat = criarChat({ pool, agora });
  const presenca = criarPresenca({ agora: () => agora().getTime() });
  const eventos = criarEventos();
  const router = express.Router();
  const ultimoEstado = new Map();
  const saidas = new Map();

  const eu = req => req.user && req.user.id;

  const rota = fn => async (req, res) => {
    try {
      const r = await fn(req, res);
      if (r !== undefined && !res.headersSent) res.json(r);
    } catch (err) {
      if (!err?.status) log.error("[chat] falha:", err?.message || err);
      if (!res.headersSent) res.status(err?.status || 500).json({ error: err?.status ? err.message : "Não foi possível agora. Tente de novo.", code: err?.code || null });
    }
  };

  async function presencaDe(ids) {
    const status = await chat.statusDe();
    const programa = await chat.comProgramaRodando();
    return ids.map(id => {
      const st = status.get(String(id)) || { status: "automatico", mensagem: null };
      const visto = presenca.ultimaVez(id);
      return {
        usuario_id: Number(id),
        estado: presenca.estado(id, { statusManual: st.status, programaRodando: programa.has(String(id)) }),
        recado: st.status === "invisivel" ? null : st.mensagem || null,
        visto_em: st.status === "invisivel" || !visto ? null : new Date(visto).toISOString()
      };
    });
  }

  /** Mudou o estado de alguém? Avisa todo mundo conectado (só quando muda). */
  async function difundirPresenca(usuarioId) {
    try {
      const [p] = await presencaDe([usuarioId]);
      const chave = `${p.estado}|${p.recado || ""}`;
      if (ultimoEstado.get(String(usuarioId)) === chave) return;
      ultimoEstado.set(String(usuarioId), chave);
      eventos.enviarTodos("presenca", p);
    } catch (err) {
      log.error("[chat] presença não difundida:", err?.message || err);
    }
  }

  async function usuariosComPresenca() {
    const lista = await chat.usuariosAtivos();
    const presencas = new Map((await presencaDe(lista.map(u => u.id))).map(p => [String(p.usuario_id), p]));
    return lista.map(u => ({ ...u, ...presencas.get(String(u.id)) }));
  }

  /** @mencionado: aviso no sino (mesmo com a conversa silenciada). */
  async function avisarMencoes(autorId, conversa, mensagem, ids) {
    if (!ids || !ids.length) return;
    try {
      const pessoas = await chat.usuariosAtivos();
      const nomes = new Map(pessoas.map(u => [String(u.id), u.nome]));
      const autor = nomes.get(String(autorId)) || "Alguém";
      const onde = conversa.tipo === "direta" ? "numa conversa" : conversa.tipo === "canal" ? `no canal #${conversa.nome || ""}` : `no grupo ${conversa.nome || ""}`.trim();
      const trecho = textoSimples(mensagem.texto, nomes).slice(0, 240);
      for (const id of ids) {
        await pool.query(
          "INSERT INTO notificacoes (usuario_id, tipo, titulo, mensagem, origem, registro_id, autor_id) VALUES ($1, 'mencao', $2, $3, 'chat', $4, $5)",
          [id, `${autor} mencionou você ${onde}`, trecho, conversa.id, autorId]
        ).catch(err => log.error("[chat] aviso da menção não gravado:", err?.message || err));
      }
    } catch (err) {
      log.error("[chat] menções não avisadas:", err?.message || err);
    }
  }

  // ------------------------------------------------------------ ao vivo

  router.get("/eventos", autenticar, (req, res) => {
    const usuarioId = eu(req);
    res.status(200);
    res.set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx: não segurar a resposta (senão o "ao vivo" chega de uma vez só).
      "X-Accel-Buffering": "no"
    });
    if (typeof res.flushHeaders === "function") res.flushHeaders();
    res.write("retry: 5000\n\n");
    const id = eventos.adicionar(usuarioId, res);
    clearTimeout(saidas.get(String(usuarioId)));
    const primeira = presenca.conectar(usuarioId);
    eventos.escrever(res, "pronto", { usuario_id: usuarioId });
    if (primeira) difundirPresenca(usuarioId);
    // `res`, não `req`: no Node atual o "close" do pedido dispara assim que o
    // corpo dele é lido (um intermediário que leia o corpo derrubaria a pessoa
    // do ao vivo no mesmo instante). O da resposta é a conexão de verdade.
    res.on("close", () => {
      eventos.remover(id);
      if (presenca.desconectar(usuarioId)) {
        saidas.set(String(usuarioId), setTimeout(() => difundirPresenca(usuarioId), GRACA_MS));
      }
    });
  });

  router.post("/presenca", autenticar, rota(async req => {
    if (presenca.marcarAtividade(eu(req), req.body?.ativo !== false)) await difundirPresenca(eu(req));
    return { ok: true };
  }));

  // ------------------------------------------------------------- leitura

  router.get("/resumo", autenticar, rota(async req => {
    const [usuarios, conversas, canais, status, naoLidas] = await Promise.all([
      usuariosComPresenca(), chat.conversasDo(eu(req)), chat.canaisAbertos(eu(req)),
      chat.statusDe([eu(req)]), chat.totalNaoLidas(eu(req))
    ]);
    return {
      eu: { id: eu(req), ...(status.get(String(eu(req))) || { status: "automatico", mensagem: null }) },
      usuarios, conversas, canais, nao_lidas: naoLidas,
      reacoes: REACOES, tipos_de_referencia: TIPOS_DE_REFERENCIA
    };
  }));
  router.get("/usuarios", autenticar, rota(async () => ({ usuarios: await usuariosComPresenca() })));
  router.get("/conversas", autenticar, rota(async req => ({ conversas: await chat.conversasDo(eu(req)), nao_lidas: await chat.totalNaoLidas(eu(req)) })));
  router.get("/canais", autenticar, rota(async req => ({ canais: await chat.canaisAbertos(eu(req)) })));
  router.get("/conversas/:id/membros", autenticar, rota(async req => ({ membros: await chat.membros(eu(req), req.params.id) })));
  router.get("/conversas/:id/mensagens", autenticar, rota(async req => chat.mensagens(eu(req), req.params.id, req.query || {})));

  // ----------------------------------------------------------- conversas

  /** Avisa quem está na conversa que ela mudou (a lista relê). */
  async function avisarConversa(conversaId, extras = []) {
    const ids = [...new Set([...(await chat.participantesAtivos(conversaId)), ...extras].map(String))];
    eventos.enviar(ids, "conversa", { conversa_id: Number(conversaId) });
  }

  router.post("/conversas/direta", autenticar, rota(async req => {
    const r = await chat.abrirDireta(eu(req), req.body?.usuario_id);
    return { id: r.id };
  }));
  router.post("/conversas", autenticar, rota(async (req, res) => {
    const r = await chat.criarConversa(eu(req), req.body || {});
    await avisarConversa(r.id);
    if (req.body?.tipo === "canal") eventos.enviarTodos("canais", {});
    res.status(201);
    return { id: r.id };
  }));
  router.put("/conversas/:id", autenticar, rota(async req => {
    const r = await chat.alterarConversa(eu(req), req.params.id, req.body || {});
    await avisarConversa(r.id);
    return { id: r.id };
  }));
  router.post("/conversas/:id/entrar", autenticar, rota(async req => {
    const r = await chat.entrarNoCanal(eu(req), req.params.id);
    await avisarConversa(r.id);
    return r;
  }));
  router.post("/conversas/:id/sair", autenticar, rota(async req => {
    const r = await chat.sair(eu(req), req.params.id);
    await avisarConversa(r.id, [eu(req)]);
    return r;
  }));
  router.post("/conversas/:id/arquivar", autenticar, rota(async req => {
    const quem = await chat.participantesAtivos(req.params.id).catch(() => []);
    const r = await chat.arquivar(eu(req), req.params.id);
    eventos.enviar([...quem, eu(req)], "conversa", { conversa_id: r.id, arquivada: true });
    eventos.enviarTodos("canais", {});
    return r;
  }));
  router.post("/conversas/:id/membros", autenticar, rota(async req => {
    const r = await chat.adicionarMembros(eu(req), req.params.id, req.body?.membros);
    await avisarConversa(r.id);
    return r;
  }));
  router.put("/conversas/:id/preferencias", autenticar, rota(async req => chat.preferencias(eu(req), req.params.id, req.body || {})));

  // ----------------------------------------------------------- mensagens

  router.post("/conversas/:id/mensagens", autenticar, rota(async (req, res) => {
    const r = await chat.enviar(eu(req), req.params.id, { texto: req.body?.texto, resposta_de: req.body?.resposta_de });
    eventos.enviar(r.participantes, "mensagem", { conversa_id: r.conversa.id, mensagem: r.mensagem });
    await avisarMencoes(eu(req), r.conversa, r.mensagem, r.mensagem.mencoes);
    res.status(201);
    return { mensagem: r.mensagem };
  }));
  router.put("/mensagens/:id", autenticar, rota(async req => {
    const r = await chat.editar(eu(req), req.params.id, { texto: req.body?.texto });
    eventos.enviar(r.participantes, "mensagem_atualizada", { conversa_id: r.mensagem.conversa_id, mensagem: r.mensagem });
    if (r.novasMencoes && r.novasMencoes.length) {
      const conversa = (await chat.conversasDo(eu(req))).find(c => c.id === r.mensagem.conversa_id) || { id: r.mensagem.conversa_id, tipo: "grupo" };
      await avisarMencoes(eu(req), conversa, r.mensagem, r.novasMencoes);
    }
    return { mensagem: r.mensagem };
  }));
  router.delete("/mensagens/:id", autenticar, rota(async req => {
    const r = await chat.apagar(eu(req), req.params.id);
    eventos.enviar(r.participantes, "mensagem_atualizada", { conversa_id: r.mensagem.conversa_id, mensagem: r.mensagem });
    return { mensagem: r.mensagem };
  }));
  router.post("/mensagens/:id/reacoes", autenticar, rota(async req => {
    const r = await chat.reagir(eu(req), req.params.id, req.body?.emoji);
    eventos.enviar(r.participantes, "mensagem_atualizada", { conversa_id: r.mensagem.conversa_id, mensagem: r.mensagem });
    return { mensagem: r.mensagem };
  }));
  router.post("/conversas/:id/lida", autenticar, rota(async req => {
    const r = await chat.marcarLida(eu(req), req.params.id, req.body?.ate);
    eventos.enviar(r.participantes, "lida", { conversa_id: r.id, usuario_id: eu(req), ate: r.ate });
    return { id: r.id, ate: r.ate };
  }));
  router.post("/conversas/:id/digitando", autenticar, rota(async req => {
    const id = Number(req.params.id);
    if (!(await chat.estaNaConversa(eu(req), id))) return { ok: false };
    const outros = (await chat.participantesAtivos(id)).filter(u => String(u) !== String(eu(req)));
    eventos.enviar(outros, "digitando", { conversa_id: id, usuario_id: eu(req) });
    return { ok: true };
  }));

  // -------------------------------------------------------------- status

  router.get("/status", autenticar, rota(async req => (await chat.statusDe([eu(req)])).get(String(eu(req)))));
  router.put("/status", autenticar, rota(async req => {
    const r = await chat.gravarStatus(eu(req), req.body || {});
    await difundirPresenca(eu(req));
    return r;
  }));

  router.chat = chat;
  router.presenca = presenca;
  router.eventos = eventos;
  return router;
}

module.exports = { criarRotasDoChat, GRACA_MS };
