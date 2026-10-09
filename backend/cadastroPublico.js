// backend/cadastroPublico.js — o "Cadastrar" da tela de login (02/10/2026).
//
// CÓPIA de Santissimo-db-API/cadastro/cadastro.js. Em PROD quem faz isto é a
// API (rotas /cadastro, /cadastro/confirmar, /cadastro/nao-reconheco e
// /cadastro/liberado); aqui ela roda só com BANCO=DEV, contra o banco local
// (backend/cadastroLocal.js faz a ligação). Mudou lá, mude aqui. Ver
// docs/termos-de-uso-e-cadastro.md.
//
// O usuário nasce 'nao_confirmado', com o aceite dos Termos de Uso e da
// Política de Privacidade gravado; confirma o e-mail pelo link (48 horas, uma
// vez só; o banco guarda só o sha256) e passa a 'aguardando_aprovacao'
// (Inativo) até o Sup Admin liberar em Usuários.
// ------------------------------------------------------------------

const crypto = require("crypto");

const VALIDADE_MS = 48 * 60 * 60 * 1000;
const INTERVALO_POR_EMAIL_MS = 60 * 1000;
const JANELA_POR_IP_MS = 10 * 60 * 1000;
const MAXIMO_POR_IP = 5;
const INTERVALO_DO_LIBERADO_MS = 10 * 60 * 1000;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DOCUMENTOS = ["termos_de_uso", "politica_de_privacidade"];
const TABELAS = ["termos_versoes", "usuarios_termos_aceites", "usuarios_confirmacoes"];
const COLUNAS_DO_USUARIO = ["termos_versao", "privacidade_versao", "termos_aceitos_em"];

const SEM_SQL = "O cadastro ainda não está disponível no servidor. Avise o administrador (falta rodar sql/usuarios_termos.sql e reiniciar a API).";
const SEM_VERSAO = "Os Termos de Uso desta versão do programa ainda não foram registrados no servidor. Avise o administrador e tente de novo em instantes.";

function texto(valor, maximo) {
  const t = typeof valor === "string" ? valor.trim().replace(/\s+/g, " ") : "";
  return maximo ? t.slice(0, maximo) : t;
}

function normalizarEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

/**
 * Nome completo (09/10/2026): a tela pede NOME e SOBRENOME e eles vão juntos
 * para a coluna única; o nome não repete, porque dá para entrar por ele. A
 * mesma regra de acesso/nomes.js (API) e src/js/utils/nome-completo.js (app).
 */
function chaveDoNome(nome) {
  return texto(nome).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function mensagemDoNome(nome) {
  if (!nome) return "Informe o nome e o sobrenome.";
  if (nome.split(" ").length < 2 || nome.replace(/[^\p{L}]/gu, "").length < 3) return "Informe o nome e o sobrenome.";
  return "";
}

function sha256(valor) {
  return crypto.createHash("sha256").update(String(valor), "utf8").digest("hex");
}

function gerarTokenPadrao() {
  return crypto.randomBytes(32).toString("hex");
}

/** "Sup Admin", "SUP-ADMIN", "supadmin", "Super Admin"… (a mesma regra do programa). */
function ehSupAdmin(usuario) {
  const perfil = String(usuario?.perfil ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s._-]+/g, "")
    .toLowerCase();
  return perfil === "supadmin" || perfil === "superadmin";
}

function statusAtivo(status) {
  return ["ativo", "ativa", "active"].includes(String(status ?? "").trim().toLowerCase());
}

/**
 * Os aceites que a tela mandou: um por documento, com a versão e o texto
 * exato que foi mostrado. Devolve a lista conferida ou a frase do erro. Pura.
 */
function conferirAceites(aceites) {
  const lista = Array.isArray(aceites) ? aceites : [];
  const conferidos = [];
  for (const documento of DOCUMENTOS) {
    const a = lista.find(x => x && x.documento === documento);
    const versao = texto(a?.versao, 20);
    const corpo = typeof a?.texto === "string" ? a.texto : "";
    if (!a || a.aceito !== true || !versao || corpo.length < 200) {
      return { erro: "Para se cadastrar é preciso ler e aceitar os Termos de Uso e a Política de Privacidade." };
    }
    conferidos.push({ documento, versao, titulo: texto(a.titulo, 160), hash_sha256: sha256(corpo) });
  }
  return { aceites: conferidos };
}

/**
 * @param {object} deps
 * @param {{query: Function, connect?: Function}} deps.pool — pg.Pool (ou algo com a mesma query)
 * @param {{hash: Function}} deps.bcrypt — bcrypt/bcryptjs (custo 12, como o resto)
 * @param {(senha: string) => string} deps.mensagemDaSenha — '' quando a senha atende à regra
 * @param {(tabela: string) => string[]} deps.colunasDe — as colunas que o banco tem (vazio = sem a tabela)
 * @param {object} deps.enviar — os e-mails: confirmacao, aguardando, naoReconhecido e liberado,
 *   cada um ({...}) => Promise<{enviado, motivo}>
 * @param {() => Date} [deps.agora]
 * @param {() => string} [deps.gerarToken]
 */
function criarCadastro({ pool, bcrypt, mensagemDaSenha, colunasDe, enviar, agora = () => new Date(), gerarToken = gerarTokenPadrao }) {
  const ultimoPorEmail = new Map(); // email -> ms do último cadastro aceito
  const porIp = new Map(); // ip -> [ms, ms, …] dentro da janela
  const ultimoLiberado = new Map(); // id do usuário -> ms do último e-mail

  async function colunas(tabela) {
    try {
      const lista = await colunasDe(tabela);
      return Array.isArray(lista) ? lista : [];
    } catch (_) {
      return [];
    }
  }

  async function bancoPronto() {
    for (const tabela of TABELAS) {
      if (!(await colunas(tabela)).length) return false;
    }
    const doUsuario = await colunas("usuarios");
    return COLUNAS_DO_USUARIO.every(c => doUsuario.includes(c));
  }

  async function emTransacao(acao) {
    if (typeof pool.connect !== "function") return acao(pool);
    const cliente = await pool.connect();
    try {
      await cliente.query("BEGIN");
      const resultado = await acao(cliente);
      await cliente.query("COMMIT");
      return resultado;
    } catch (err) {
      try { await cliente.query("ROLLBACK"); } catch (_) { /* a conexão já caiu */ }
      throw err;
    } finally {
      cliente.release();
    }
  }

  async function enviarSemDerrubar(qual, dados) {
    try {
      const envio = await enviar[qual](dados);
      return { enviado: envio?.enviado !== false, motivo: envio?.motivo || null };
    } catch (err) {
      console.error(`[cadastro] e-mail "${qual}" não saiu:`, err?.message || err);
      return { enviado: false, motivo: "falha no envio do e-mail" };
    }
  }

  async function supAdminsAtivos() {
    const { rows } = await pool.query("SELECT id, nome, email, perfil, status FROM usuarios");
    return rows.filter(u => ehSupAdmin(u) && statusAtivo(u.status));
  }

  /** O aviso no sino de cada Sup Admin (falha só vai para o log). */
  async function avisarNoSino(admins, { tipo, titulo, mensagem, usuarioId }) {
    for (const admin of admins) {
      try {
        await pool.query(
          "INSERT INTO notificacoes (usuario_id, tipo, titulo, mensagem, origem, registro_id, autor_id) VALUES ($1, $2, $3, $4, $5, $6, $7)",
          [admin.id, tipo, titulo, mensagem, "usuario", usuarioId, usuarioId]
        );
      } catch (err) {
        console.error("[cadastro] aviso do sino não gravado:", err?.message || err);
      }
    }
  }

  function passouDoLimite(ip, agoraMs) {
    if (!ip) return false;
    const recentes = (porIp.get(ip) || []).filter(ms => agoraMs - ms < JANELA_POR_IP_MS);
    porIp.set(ip, recentes);
    return recentes.length >= MAXIMO_POR_IP;
  }

  /** POST /cadastro { nome, email, senha, aceites: [{documento, versao, titulo, texto, aceito}], computador, versaoApp } */
  async function cadastrar(corpo = {}, { ip = null, urlBase = "" } = {}) {
    // `sobrenome` à parte (a tela nova) ou já junto em `nome` (a tela antiga).
    const nome = texto([corpo.nome, corpo.sobrenome].filter(v => typeof v === "string" && v.trim()).join(" "), 200);
    const email = normalizarEmail(corpo.email);
    const senha = typeof corpo.senha === "string" ? corpo.senha : "";

    const problemaNoNome = mensagemDoNome(nome);
    if (problemaNoNome) return { status: 400, corpo: { error: problemaNoNome, campo: "nome" } };
    if (!RE_EMAIL.test(email)) return { status: 400, corpo: { error: "Informe um e-mail válido." } };
    const fraca = mensagemDaSenha(senha);
    if (fraca) return { status: 400, corpo: { error: fraca } };
    const conferencia = conferirAceites(corpo.aceites);
    if (conferencia.erro) return { status: 400, corpo: { error: conferencia.erro } };

    const agoraMs = agora().getTime();
    const anterior = ultimoPorEmail.get(email);
    if (anterior && agoraMs - anterior < INTERVALO_POR_EMAIL_MS) {
      return { status: 429, corpo: { error: "Aguarde um minuto para tentar de novo." } };
    }
    if (passouDoLimite(ip, agoraMs)) {
      return { status: 429, corpo: { error: "Muitos cadastros seguidos deste computador. Tente de novo mais tarde." } };
    }

    if (!(await bancoPronto())) return { status: 503, corpo: { error: SEM_SQL, code: "TERMOS_SQL" } };

    // O texto aceito tem de ser o que o programa registrou para aquela versão.
    for (const a of conferencia.aceites) {
      const { rows } = await pool.query(
        "SELECT hash_sha256 FROM termos_versoes WHERE documento = $1 AND versao = $2 LIMIT 1",
        [a.documento, a.versao]
      );
      if (!rows[0]) return { status: 409, corpo: { error: SEM_VERSAO, code: "TERMOS_VERSAO" } };
      if (String(rows[0].hash_sha256 || "").trim() !== a.hash_sha256) {
        return { status: 409, corpo: { error: "Os documentos foram atualizados. Atualize o programa para ler a versão nova.", code: "TERMOS_TEXTO" } };
      }
    }

    const existente = await pool.query("SELECT id FROM usuarios WHERE lower(trim(email)) = $1 LIMIT 1", [email]);
    if (existente.rows[0]) {
      return { status: 409, corpo: { error: "Já existe um cadastro com esse e-mail. Se você ainda não confirmou, procure o e-mail de confirmação ou fale com o administrador." } };
    }
    const { rows: todos } = await pool.query("SELECT id, nome, email, perfil, status FROM usuarios");
    if (todos.some(u => chaveDoNome(u.nome) && chaveDoNome(u.nome) === chaveDoNome(nome))) {
      return { status: 409, corpo: { error: `O nome "${nome}" já está cadastrado. Diferencie (por exemplo, com outro sobrenome).`, code: "NOME_JA_CADASTRADO", campo: "nome" } };
    }

    ultimoPorEmail.set(email, agoraMs);
    if (ip) porIp.set(ip, [...(porIp.get(ip) || []), agoraMs]);

    const quando = new Date(agoraMs).toISOString();
    const hashDaSenha = await bcrypt.hash(senha, 12);
    const token = gerarToken();
    const versaoDe = documento => conferencia.aceites.find(a => a.documento === documento).versao;
    const computador = texto(corpo.computador, 160) || null;
    const versaoApp = texto(corpo.versaoApp, 30) || null;

    const usuario = await emTransacao(async banco => {
      const { rows } = await banco.query(
        `INSERT INTO usuarios (nome, email, senha, status, termos_versao, privacidade_versao, termos_aceitos_em)
         VALUES ($1, $2, $3, 'nao_confirmado', $4, $5, $6)
         RETURNING id, nome, email`,
        [nome, email, hashDaSenha, versaoDe("termos_de_uso"), versaoDe("politica_de_privacidade"), quando]
      );
      const criado = rows[0];
      for (const a of conferencia.aceites) {
        await banco.query(
          `INSERT INTO usuarios_termos_aceites
             (usuario_id, usuario_nome, usuario_email, documento, versao, hash_sha256, decisao, origem, ip, computador, versao_app)
           VALUES ($1, $2, $3, $4, $5, $6, 'aceito', 'cadastro', $7, $8, $9)`,
          [criado.id, nome, email, a.documento, a.versao, a.hash_sha256, ip ? String(ip).slice(0, 64) : null, computador, versaoApp]
        );
      }
      await banco.query(
        "INSERT INTO usuarios_confirmacoes (usuario_id, token_hash, criado_em, expira_em) VALUES ($1, $2, $3, $4)",
        [criado.id, sha256(token), quando, new Date(agoraMs + VALIDADE_MS).toISOString()]
      );
      return criado;
    });

    const base = String(urlBase || "").replace(/\/+$/, "");
    const envio = await enviarSemDerrubar("confirmacao", {
      email,
      nome,
      confirmarUrl: `${base}/cadastro/confirmar?token=${token}`,
      naoReconhecoUrl: `${base}/cadastro/nao-reconheco?token=${token}`,
      validadeHoras: VALIDADE_MS / 3600000
    });

    return {
      status: 201,
      corpo: { success: true, id: usuario.id, emailEnviado: envio.enviado, motivo: envio.motivo }
    };
  }

  async function acharPedido(token) {
    const bruto = String(token || "").trim();
    if (!/^[a-f0-9]{64}$/i.test(bruto)) return null;
    const { rows } = await pool.query(
      `SELECT c.id, c.usuario_id, c.expira_em, c.usado_em, c.revogado_em, u.nome, u.email, u.status
         FROM usuarios_confirmacoes c JOIN usuarios u ON u.id = c.usuario_id
        WHERE c.token_hash = $1 LIMIT 1`,
      [sha256(bruto.toLowerCase())]
    );
    return rows[0] || null;
  }

  /** GET /cadastro/confirmar?token= — devolve o que a página mostra. */
  async function confirmar(token) {
    const pedido = await acharPedido(token);
    const agoraMs = agora().getTime();
    if (!pedido || pedido.revogado_em) {
      return { status: 400, titulo: "Link inválido", mensagem: "Este link de confirmação não vale mais. Se você se cadastrou, fale com o administrador." };
    }
    if (pedido.usado_em) {
      return { status: 200, titulo: "E-mail já confirmado", mensagem: "Este e-mail já tinha sido confirmado. Assim que o administrador liberar o seu acesso, você recebe um aviso por e-mail." };
    }
    if (new Date(pedido.expira_em).getTime() <= agoraMs) {
      return { status: 400, titulo: "Link vencido", mensagem: "Este link valia por 48 horas e venceu. Fale com o administrador para liberar o seu cadastro." };
    }

    const quando = new Date(agoraMs).toISOString();
    await pool.query("UPDATE usuarios_confirmacoes SET usado_em = $1 WHERE id = $2", [quando, pedido.id]);
    // Confirmado, o cadastro passa a esperar o administrador (aparece como
    // "Inativo" em Usuários, com a tomada pronta para ativar). Quem já foi
    // ativado ou desativado nesse meio-tempo fica como está.
    await pool.query(
      "UPDATE usuarios SET status = 'aguardando_aprovacao' WHERE id = $1 AND status = 'nao_confirmado'",
      [pedido.usuario_id]
    );
    const doUsuario = await colunas("usuarios");
    if (doUsuario.includes("email_confirmado")) {
      await pool.query("UPDATE usuarios SET email_confirmado = true WHERE id = $1", [pedido.usuario_id]).catch(() => {});
    }
    if (doUsuario.includes("email_confirmado_em")) {
      await pool.query("UPDATE usuarios SET email_confirmado_em = $1 WHERE id = $2", [quando, pedido.usuario_id]).catch(() => {});
    }

    const admins = await supAdminsAtivos().catch(() => []);
    await avisarNoSino(admins, {
      tipo: "cadastro_aguardando",
      titulo: "Novo cadastro aguardando liberação",
      mensagem: `${pedido.nome || pedido.email} confirmou o e-mail e aguarda a liberação do acesso em Usuários.`,
      usuarioId: pedido.usuario_id
    });
    for (const admin of admins.filter(a => RE_EMAIL.test(normalizarEmail(a.email)))) {
      await enviarSemDerrubar("aguardando", {
        email: normalizarEmail(admin.email),
        nome: admin.nome || "",
        usuarioNome: pedido.nome || "",
        usuarioEmail: pedido.email || ""
      });
    }
    return {
      status: 200,
      titulo: "E-mail confirmado",
      mensagem: "Pronto! Agora o administrador precisa liberar o seu acesso. Você recebe um e-mail assim que isso acontecer — só depois dele o programa deixa você entrar."
    };
  }

  /** GET /cadastro/nao-reconheco?token= — "não fui eu que me cadastrei". */
  async function naoReconheco(token) {
    const pedido = await acharPedido(token);
    if (!pedido || pedido.revogado_em) {
      return { status: 200, titulo: "Aviso registrado", mensagem: "Este link não vale mais. Nenhum acesso foi liberado com o seu e-mail." };
    }
    if (pedido.usado_em) {
      return { status: 200, titulo: "E-mail já confirmado", mensagem: "Este cadastro já foi confirmado por este mesmo e-mail. Se não foi você, responda ao e-mail que recebeu ou fale com o administrador." };
    }
    await pool.query("UPDATE usuarios_confirmacoes SET revogado_em = $1 WHERE id = $2", [agora().toISOString(), pedido.id]);
    const admins = await supAdminsAtivos().catch(() => []);
    await avisarNoSino(admins, {
      tipo: "cadastro_nao_reconhecido",
      titulo: "Cadastro não reconhecido",
      mensagem: `O dono do e-mail ${pedido.email} avisou que não fez o cadastro "${pedido.nome || ""}". O cadastro continua bloqueado: confira e exclua em Usuários.`,
      usuarioId: pedido.usuario_id
    });
    for (const admin of admins.filter(a => RE_EMAIL.test(normalizarEmail(a.email)))) {
      await enviarSemDerrubar("naoReconhecido", {
        email: normalizarEmail(admin.email),
        nome: admin.nome || "",
        usuarioNome: pedido.nome || "",
        usuarioEmail: pedido.email || ""
      });
    }
    return {
      status: 200,
      titulo: "Aviso registrado",
      mensagem: "Obrigado por avisar. O cadastro feito com o seu e-mail continua bloqueado e o administrador foi informado."
    };
  }

  /** POST /cadastro/liberado { usuarioId } (com JWT) — o e-mail "seu acesso foi liberado". */
  async function liberado(corpo = {}) {
    const id = Number(corpo.usuarioId);
    if (!Number.isInteger(id) || id <= 0) return { status: 400, corpo: { error: "Informe o usuário." } };
    const { rows } = await pool.query("SELECT id, nome, email, status FROM usuarios WHERE id = $1", [id]);
    const usuario = rows[0];
    if (!usuario) return { status: 404, corpo: { error: "Usuário não encontrado." } };
    if (!statusAtivo(usuario.status)) return { status: 409, corpo: { error: "O acesso deste usuário não está ativo." } };
    const email = normalizarEmail(usuario.email);
    if (!RE_EMAIL.test(email)) return { status: 200, corpo: { success: true, emailEnviado: false, motivo: "usuário sem e-mail válido" } };

    const agoraMs = agora().getTime();
    const anterior = ultimoLiberado.get(id);
    if (anterior && agoraMs - anterior < INTERVALO_DO_LIBERADO_MS) {
      return { status: 200, corpo: { success: true, emailEnviado: false, motivo: "aviso já enviado há pouco" } };
    }
    ultimoLiberado.set(id, agoraMs);
    const envio = await enviarSemDerrubar("liberado", { email, nome: usuario.nome || "" });
    return { status: 200, corpo: { success: true, emailEnviado: envio.enviado, motivo: envio.motivo } };
  }

  return { cadastrar, confirmar, naoReconheco, liberado };
}

function escapar(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A página que o link do e-mail abre no navegador. Pura. */
function paginaHtml({ titulo, mensagem }) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>${escapar(titulo)} · Santíssimo Decor</title>
</head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
  background:linear-gradient(135deg,#310017 0%,#1a0009 100%);font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:#f7f2d2;">
  <div style="width:100%;max-width:520px;background:#310017;border-radius:20px;overflow:hidden;
    box-shadow:0 22px 60px rgba(0,0,0,0.38);border:1px solid rgba(182,160,62,0.28);">
    <div style="padding:28px;text-align:center;background:linear-gradient(135deg,rgba(106,21,44,0.92) 0%,rgba(49,0,23,0.95) 100%);
      border-bottom:1px solid rgba(212,193,105,0.4);">
      <h1 style="margin:0;font-size:24px;font-weight:600;color:#d4c169;">${escapar(titulo)}</h1>
    </div>
    <div style="padding:28px;font-size:15px;line-height:1.6;">
      <p style="margin:0;">${escapar(mensagem)}</p>
    </div>
  </div>
</body>
</html>`;
}

/** A rota pública em JSON (o cadastro e o aviso de liberação). */
function rota(acao, contexto = () => ({})) {
  return async (req, res) => {
    try {
      const { status, corpo } = await acao(req.body || {}, contexto(req));
      res.status(status).json(corpo);
    } catch (err) {
      console.error("[cadastro] falha:", err?.message || err);
      res.status(500).json({ error: "Não foi possível concluir agora. Tente de novo em instantes." });
    }
  };
}

/** A rota do link do e-mail: responde uma página, não JSON. */
function pagina(acao) {
  return async (req, res) => {
    let resposta;
    try {
      resposta = await acao(req.query?.token);
    } catch (err) {
      console.error("[cadastro] falha no link do e-mail:", err?.message || err);
      resposta = { status: 500, titulo: "Não deu certo agora", mensagem: "Tente abrir o link de novo em alguns instantes." };
    }
    res.status(resposta.status).type("html").send(paginaHtml(resposta));
  };
}

module.exports = {
  criarCadastro,
  rota,
  pagina,
  paginaHtml,
  conferirAceites,
  ehSupAdmin,
  sha256,
  VALIDADE_MS,
  MAXIMO_POR_IP,
  SEM_SQL,
  SEM_VERSAO
};
