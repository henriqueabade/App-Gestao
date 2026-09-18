/**
 * Id do usuário da requisição, lido do token (JWT da API ou sessão DEV).
 *
 * Sem validar a assinatura: quem valida é a API (e, em DEV, o server.js antes
 * de chegar aqui). Serve para autoria — quem comentou, quem cadastrou.
 * O server.js põe o token guardado no cabeçalho quando o renderer não manda.
 */
function usuarioDaRequisicao(req) {
  try {
    const token = String(req?.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const parte = token.split('.')[1];
    if (!parte) return null;
    const payload = JSON.parse(Buffer.from(parte.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    const id = payload.id ?? payload.userId ?? payload.sub ?? null;
    return id === null || id === undefined ? null : Number(id);
  } catch (_) {
    return null;
  }
}

module.exports = { usuarioDaRequisicao };
