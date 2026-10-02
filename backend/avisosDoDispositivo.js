// backend/avisosDoDispositivo.js — os avisos do sino no Windows com o
// programa em segundo plano (01/10/2026).
//
// CÓPIA de Santissimo-db-API/avisos/dispositivo.js. Em PROD quem faz isto é a
// API (rotas /avisos/dispositivo, /avisos/meus, /avisos/tarefas e
// /avisos/lembretes); aqui ela roda só com BANCO=DEV, contra o banco local
// (backend/avisosNoWindows.js). Mudou lá, mude aqui. Ver
// docs/avisos-no-windows.md.
//
// O token do aparelho é SÓ dos avisos ("escopo: avisos"): vale 90 dias, é
// renovado faltando 30, só lê os avisos e as tarefas abertas do próprio
// usuário e só grava os lembretes/atrasos das tarefas dele. Usuário inativo
// deixa de receber. Cada computador fica na lista avisos_dispositivos
// (sql/avisos_dispositivos.sql), que o Sup Admin cancela em Usuários.
// ------------------------------------------------------------------

const ESCOPO = "avisos";
const VALIDADE_DIAS = 90;
const RENOVAR_COM_DIAS = 30;
const LIMITE = 30;
const ABERTOS = ["a_fazer", "em_andamento", "aguardando"];
const TIPOS_DE_LEMBRETE = new Set(["tarefa_lembrete", "tarefa_atrasada"]);
const RE_CHAVE = /^(lembrete|atraso):(\d{1,12}):[0-9: -]{0,30}$/;
// A lista de computadores, sem a tabela, é procurada de novo a cada 10 minutos.
const TOQUE_MS = 10 * 60 * 1000;
// O "último uso" do computador é regravado no máximo a cada 1 minuto: é o
// sinal de que o programa está rodando (mesmo só perto do relógio), e
// Usuários mostra a pessoa "Ausente" enquanto ele chega; parou de chegar há
// alguns minutos = programa fechado, "Offline" (decisão do dono, 02/10/2026).
const SINAL_MS = 60 * 1000;

const NEGADO = { status: 401, corpo: { error: "Este aparelho não tem mais os avisos ligados: entre de novo no programa." } };
const INATIVO = { status: 403, corpo: { error: "Usuário inativo: os avisos foram desligados." } };
const CANCELADO = { status: 401, corpo: { error: "Os avisos deste computador foram cancelados pelo administrador: entre de novo no programa para voltar a receber.", cancelado: true } };

/** Texto curto e limpo para a lista (nome do computador, usuário do Windows). */
const curto = v => String(v ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 120) || null;

/**
 * @param {object} deps
 * @param {{query: Function}} deps.pool — pg.Pool (ou algo com a mesma query)
 * @param {(dados: object, segundos: number) => string} deps.assinar — gera o token
 * @param {(token: string) => object} deps.verificar — devolve os dados do token ou lança
 * @param {() => Date} [deps.agora]
 */
function criarAvisosDoDispositivo({ pool, assinar, verificar, agora = () => new Date() }) {
  async function usuarioAtivo(id) {
    const { rows } = await pool.query("SELECT id, nome, status FROM usuarios WHERE id = $1", [id]);
    const u = rows[0] || null;
    if (!u) return null;
    return u.status && String(u.status) !== "ativo" ? null : u;
  }

  function tokenNovo(id, did = null) {
    return assinar({ id: Number(id), escopo: ESCOPO, ...(did ? { did: Number(did) } : {}) }, VALIDADE_DIAS * 86400);
  }

  // A lista de computadores existe? (sql/avisos_dispositivos.sql). Achada,
  // fica achada; sem ela, pergunta de novo a cada 10 minutos.
  let comLista = null;
  let conferidaEm = 0;
  async function temLista() {
    if (comLista === true) return true;
    if (comLista === false && agora().getTime() - conferidaEm < TOQUE_MS) return false;
    try {
      await pool.query("SELECT 1 FROM avisos_dispositivos LIMIT 1");
      comLista = true;
    } catch (err) {
      if (String(err?.code) !== "42P01") throw err;
      comLista = false;
    }
    conferidaEm = agora().getTime();
    return comLista;
  }

  /** O computador na lista: o mesmo (ainda não cancelado) reaproveita a linha. Devolve o id, ou null sem a lista. */
  async function registrarComputador(usuarioId, aparelho = {}) {
    if (!(await temLista())) return null;
    const nome = curto(aparelho.computador);
    const quem = curto(aparelho.usuario_windows);
    if (nome) {
      const { rows } = await pool.query(
        "SELECT id FROM avisos_dispositivos WHERE usuario_id = $1 AND computador = $2 AND cancelado_em IS NULL ORDER BY id DESC LIMIT 1",
        [usuarioId, nome]
      );
      if (rows[0]) {
        await pool.query("UPDATE avisos_dispositivos SET usuario_windows = $2, ultimo_uso_em = now() WHERE id = $1", [rows[0].id, quem]);
        return rows[0].id;
      }
    }
    const { rows } = await pool.query(
      "INSERT INTO avisos_dispositivos (usuario_id, computador, usuario_windows, ultimo_uso_em) VALUES ($1, $2, $3, now()) RETURNING id",
      [usuarioId, nome, quem]
    );
    return rows[0]?.id ?? null;
  }

  /**
   * POST /avisos/dispositivo — `sessao`: os dados do token da SESSÃO
   * (req.user); `aparelho`: { computador, usuario_windows } (o corpo).
   */
  async function emitir(sessao, aparelho = {}) {
    if (!sessao?.id || sessao.escopo) return { status: 401, corpo: { error: "Entre no programa para ligar os avisos do Windows." } };
    const u = await usuarioAtivo(sessao.id);
    if (!u) return INATIVO;
    const did = await registrarComputador(u.id, aparelho || {});
    return { status: 200, corpo: { token: tokenNovo(u.id, did), usuario: { id: u.id, nome: u.nome }, validade_dias: VALIDADE_DIAS, computador_id: did } };
  }

  /** O computador do token ainda vale? Com a lista, precisa estar nela e não cancelado. */
  async function computadorValido(d, usuarioId) {
    if (!(await temLista())) return true;
    if (!d.did) return false;
    const { rows } = await pool.query(
      "SELECT id, cancelado_em, ultimo_uso_em FROM avisos_dispositivos WHERE id = $1 AND usuario_id = $2",
      [Number(d.did), usuarioId]
    );
    const c = rows[0];
    if (!c || c.cancelado_em) return false;
    if (!c.ultimo_uso_em || agora().getTime() - new Date(c.ultimo_uso_em).getTime() > SINAL_MS) {
      await pool.query("UPDATE avisos_dispositivos SET ultimo_uso_em = now() WHERE id = $1", [c.id]);
    }
    return true;
  }

  /** O dono do token do aparelho, ou null (token de sessão não serve aqui). */
  function dono(token) {
    try {
      const d = verificar(String(token || "").replace(/^Bearer\s+/i, ""));
      return d && d.escopo === ESCOPO && d.id ? d : null;
    } catch (_) {
      return null;
    }
  }

  async function comDono(token, fazer) {
    const d = dono(token);
    if (!d) return NEGADO;
    const u = await usuarioAtivo(d.id);
    if (!u) return INATIVO;
    if (!(await computadorValido(d, u.id))) return CANCELADO;
    const resposta = await fazer(u);
    // Faltando menos de 30 dias, a resposta já leva o token renovado (o mesmo computador).
    const resta = d.exp ? d.exp - Math.floor(agora().getTime() / 1000) : Infinity;
    if (resposta.status === 200 && resta < RENOVAR_COM_DIAS * 86400) resposta.corpo.token_novo = tokenNovo(u.id, d.did);
    return resposta;
  }

  async function idsDasTarefas(usuarioId) {
    const { rows } = await pool.query(
      `SELECT t.id, t.titulo, t.data::text AS data, t.hora::text AS hora, t.lembrete_min, t.status, t.responsavel_id
         FROM tarefas t
        WHERE t.excluida_em IS NULL AND t.status = ANY($2)
          AND (t.responsavel_id = $1 OR EXISTS (
            SELECT 1 FROM tarefa_participantes p WHERE p.tarefa_id = t.id AND p.usuario_id = $1 AND p.status = 'aceito'))`,
      [usuarioId, ABERTOS]
    );
    return rows;
  }

  /** GET /avisos/meus — os últimos avisos (não dispensados), com o nome de quem fez. */
  async function listar(token) {
    return comDono(token, async u => {
      const { rows } = await pool.query(
        `SELECT n.id, n.tipo, n.titulo, n.mensagem, n.origem, n.registro_id, n.item_id, n.comentario_id,
                n.autor_id, a.nome AS autor, n.lida_em, n.criado_em
           FROM notificacoes n LEFT JOIN usuarios a ON a.id = n.autor_id
          WHERE n.usuario_id = $1 AND n.excluida_em IS NULL
          ORDER BY n.criado_em DESC, n.id DESC LIMIT $2`,
        [u.id, LIMITE]
      );
      return { status: 200, corpo: { usuario: { id: u.id, nome: u.nome }, itens: rows } };
    });
  }

  /** GET /avisos/tarefas — as tarefas abertas que são dele (responde ou participa). */
  async function tarefas(token) {
    return comDono(token, async u => ({ status: 200, corpo: { tarefas: await idsDasTarefas(u.id) } }));
  }

  /**
   * POST /avisos/lembretes { avisos: [...] } — grava os lembretes/atrasos que
   * o App-Gestão calculou. Só do próprio usuário, só destes dois tipos, só de
   * tarefa dele, e cada chave uma vez (o índice único de notificacoes).
   */
  async function lembretes(token, corpo = {}) {
    return comDono(token, async u => {
      const minhas = new Set((await idsDasTarefas(u.id)).map(t => String(t.id)));
      const lista = Array.isArray(corpo.avisos) ? corpo.avisos.slice(0, 50) : [];
      let gravados = 0;
      for (const a of lista) {
        const chave = String(a?.chave || "");
        const m = RE_CHAVE.exec(chave);
        if (!m || !TIPOS_DE_LEMBRETE.has(a.tipo) || !minhas.has(String(a.registro_id)) || m[2] !== String(a.registro_id)) continue;
        const { rows } = await pool.query(
          `INSERT INTO notificacoes (usuario_id, tipo, titulo, mensagem, origem, registro_id, chave)
           VALUES ($1, $2, $3, $4, 'tarefa', $5, $6)
           ON CONFLICT (usuario_id, chave) WHERE chave IS NOT NULL DO NOTHING
           RETURNING id`,
          [u.id, a.tipo, String(a.titulo || "Tarefa").slice(0, 120), String(a.mensagem || "").slice(0, 500), Number(a.registro_id), chave]
        );
        gravados += rows.length;
      }
      return { status: 200, corpo: { gravados } };
    });
  }

  return { emitir, dono, listar, tarefas, lembretes };
}

/** Express: chama a ação com o token do cabeçalho e devolve { status, corpo }. */
function rota(acao) {
  return async (req, res) => {
    try {
      const { status, corpo } = await acao(req.headers.authorization || "", req.body || {}, req);
      res.status(status).json(corpo);
    } catch (err) {
      console.error("[avisos] falha:", err?.message || err);
      res.status(500).json({ error: "Não foi possível ler os avisos agora." });
    }
  };
}

module.exports = { criarAvisosDoDispositivo, rota, ESCOPO, VALIDADE_DIAS, RENOVAR_COM_DIAS, LIMITE, SINAL_MS };
