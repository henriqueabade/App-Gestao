// backend/redefinicaoSenha.js — "Esqueceu a senha?" da tela de login.
//
// CÓPIA de Santissimo-db-API/senha/redefinicao.js. Em PROD quem faz isto é a
// API (rotas /senha/esqueci e /senha/redefinir, sem JWT — quem esqueceu a
// senha não tem token); aqui ela roda só com BANCO=DEV, contra o banco local.
// Mudou lá, mude aqui. Ver docs/redefinicao-de-senha.md.
//
// A segurança está no CÓDIGO de 8 números que só chega ao e-mail cadastrado
// (a resposta nunca devolve o código):
//   - o banco guarda só o sha256 de "<id do usuário>:<código>";
//   - vale 30 minutos e morre com a troca da senha ou com um pedido novo;
//   - 5 códigos errados apagam o pedido (é preciso pedir outro);
//   - um pedido por e-mail a cada 60 segundos (não vira canhão de e-mails).
// Tabela: password_reset_tokens (id, user_id, token_hash, expires_at, created_at).
// ------------------------------------------------------------------

const crypto = require("crypto");

const VALIDADE_MS = 30 * 60 * 1000;
const INTERVALO_ENTRE_PEDIDOS_MS = 60 * 1000;
const MAXIMO_DE_ERROS = 5;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const MSG_CODIGO_INVALIDO = "Código inválido ou vencido. Peça um novo código.";

function normalizarEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

/** Só os números do que foi digitado ("1234 5678" → "12345678"). */
function normalizarCodigo(codigo) {
  return String(codigo ?? "").replace(/\D/g, "");
}

function gerarCodigoPadrao() {
  return String(crypto.randomInt(0, 100000000)).padStart(8, "0");
}

function hashDoCodigo(usuarioId, codigo) {
  return crypto.createHash("sha256").update(`${usuarioId}:${codigo}`).digest("hex");
}

function hashesIguais(a, b) {
  const x = Buffer.from(String(a || ""), "utf8");
  const y = Buffer.from(String(b || ""), "utf8");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * @param {object} deps
 * @param {{query: Function}} deps.pool — pg.Pool (ou algo com a mesma query)
 * @param {{hash: Function}} deps.bcrypt — bcrypt/bcryptjs (custo 12, como o resto)
 * @param {(senha: string) => string} deps.mensagemDaSenha — '' quando a senha
 *   atende à regra; senão, a frase do que falta
 * @param {(dados: {email, nome, codigo, validadeMin}) => Promise<{enviado, motivo}>} deps.enviarCodigo
 * @param {() => Date} [deps.agora]
 * @param {() => string} [deps.gerarCodigo]
 */
function criarRedefinicaoDeSenha({ pool, bcrypt, mensagemDaSenha, enviarCodigo, agora = () => new Date(), gerarCodigo = gerarCodigoPadrao }) {
  const ultimoPedido = new Map(); // email -> ms do último pedido aceito
  const erros = new Map(); // id do usuário -> códigos errados desde o último pedido

  async function acharUsuario(email) {
    const { rows } = await pool.query(
      "SELECT id, nome, email FROM usuarios WHERE lower(trim(email)) = $1 LIMIT 1",
      [email]
    );
    return rows[0] || null;
  }

  async function apagarPedidos(usuarioId) {
    await pool.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [usuarioId]);
    erros.delete(String(usuarioId));
  }

  /** POST /senha/esqueci { email } */
  async function pedirCodigo(corpo = {}) {
    const email = normalizarEmail(corpo.email);
    if (!RE_EMAIL.test(email)) return { status: 400, corpo: { error: "Informe um e-mail válido." } };

    const agoraMs = agora().getTime();
    const anterior = ultimoPedido.get(email);
    if (anterior && agoraMs - anterior < INTERVALO_ENTRE_PEDIDOS_MS) {
      const segundos = Math.ceil((INTERVALO_ENTRE_PEDIDOS_MS - (agoraMs - anterior)) / 1000);
      return { status: 429, corpo: { error: `Aguarde ${segundos} segundos para pedir outro código.` } };
    }

    const usuario = await acharUsuario(email);
    if (!usuario) return { status: 404, corpo: { error: "E-mail não encontrado." } };
    ultimoPedido.set(email, agoraMs);

    // Um pedido novo invalida os anteriores: só o último código vale.
    await apagarPedidos(usuario.id);
    const codigo = gerarCodigo();
    await pool.query(
      "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at) VALUES ($1, $2, $3, $4)",
      [usuario.id, hashDoCodigo(usuario.id, codigo), new Date(agoraMs + VALIDADE_MS).toISOString(), new Date(agoraMs).toISOString()]
    );

    let envio;
    try {
      envio = await enviarCodigo({
        email: usuario.email || email,
        nome: usuario.nome || "",
        codigo,
        validadeMin: VALIDADE_MS / 60000
      });
    } catch (err) {
      console.error("[senha] e-mail do código não saiu:", err?.message || err);
      envio = { enviado: false, motivo: "falha no envio do e-mail" };
    }
    return {
      status: 200,
      corpo: { success: true, emailEnviado: envio?.enviado !== false, motivo: envio?.motivo || null }
    };
  }

  /** POST /senha/redefinir { email, codigo, novaSenha } */
  async function redefinir(corpo = {}) {
    const email = normalizarEmail(corpo.email);
    const codigo = normalizarCodigo(corpo.codigo);
    const novaSenha = typeof corpo.novaSenha === "string" ? corpo.novaSenha : "";

    if (!RE_EMAIL.test(email)) return { status: 400, corpo: { error: "Informe um e-mail válido." } };
    if (codigo.length !== 8) return { status: 400, corpo: { error: "Informe o código de 8 números que chegou no e-mail." } };
    const fraca = mensagemDaSenha(novaSenha);
    if (fraca) return { status: 400, corpo: { error: fraca } };

    // E-mail que não existe responde igual a código errado: não se descobre
    // quem tem cadastro tentando códigos.
    const usuario = await acharUsuario(email);
    if (!usuario) return { status: 400, corpo: { error: MSG_CODIGO_INVALIDO } };

    const { rows } = await pool.query(
      "SELECT id, token_hash, expires_at FROM password_reset_tokens WHERE user_id = $1",
      [usuario.id]
    );
    const agoraMs = agora().getTime();
    const vivos = rows.filter(r => r.expires_at && new Date(r.expires_at).getTime() > agoraMs);
    const esperado = hashDoCodigo(usuario.id, codigo);
    const certo = vivos.find(r => hashesIguais(r.token_hash, esperado));

    if (!certo) {
      if (!vivos.length) return { status: 400, corpo: { error: MSG_CODIGO_INVALIDO } };
      const chave = String(usuario.id);
      const tentativas = (erros.get(chave) || 0) + 1;
      if (tentativas >= MAXIMO_DE_ERROS) {
        await apagarPedidos(usuario.id);
        return { status: 400, corpo: { error: `Código errado ${MAXIMO_DE_ERROS} vezes. Peça um novo código.` } };
      }
      erros.set(chave, tentativas);
      const restam = MAXIMO_DE_ERROS - tentativas;
      return { status: 400, corpo: { error: `Código errado. Restam ${restam} tentativa(s).` } };
    }

    const hash = await bcrypt.hash(novaSenha, 12);
    await pool.query("UPDATE usuarios SET senha = $1 WHERE id = $2", [hash, usuario.id]);
    await apagarPedidos(usuario.id);
    return { status: 200, corpo: { success: true, email: usuario.email || email } };
  }

  return { pedirCodigo, redefinir };
}

/** As duas rotas do Express, respondendo o que a regra decidiu. */
function rota(acao) {
  return async (req, res) => {
    try {
      const { status, corpo } = await acao(req.body || {});
      res.status(status).json(corpo);
    } catch (err) {
      console.error("[senha] falha na redefinição:", err?.message || err);
      res.status(500).json({ error: "Não foi possível concluir agora. Tente de novo em instantes." });
    }
  };
}

module.exports = {
  criarRedefinicaoDeSenha,
  rota,
  normalizarCodigo,
  hashDoCodigo,
  VALIDADE_MS,
  MAXIMO_DE_ERROS,
  INTERVALO_ENTRE_PEDIDOS_MS
};
