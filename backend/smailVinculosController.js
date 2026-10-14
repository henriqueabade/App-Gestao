/**
 * /api/integracoes/smail/v1 — a vinculação do Santíssimo Mail pelo programa
 * (14/10/2026). Só o que o PRÓPRIO usuário faz, com o login de sempre:
 *
 *   POST   /vinculos/codigos {escopos?}   gera o código (10 caracteres, 10 min, uso único)
 *   GET    /meus-vinculos                 os vínculos dele (caixa, escopos, datas, situação)
 *   DELETE /meus-vinculos/:id             encerra um vínculo (vale na hora)
 *
 * Tudo vai para a API central (Santissimo-db-API, integracoes/smail/), que
 * decide e guarda. Nada mais passa por aqui: as rotas do serviço do Mail e as
 * de administração (pré-autorização, ainda não implantada) respondem 404.
 *
 * O CÓDIGO: chega na resposta e vai direto para a tela. Não é guardado, não
 * vai para log nem para notificação (contrato da API, docs/integracao-smail.md
 * §2). A resposta sai com Cache-Control: no-store.
 *
 * Com BANCO=DEV não há API central no meio (o login é local): a vinculação
 * responde 503 "indisponivel", dizendo por quê.
 */
const express = require('express');
const { isDev } = require('./dataConfig');

const router = express.Router();

const API_ORIGEM = (process.env.API_BASE_URL || process.env.API_URL || 'https://api.santissimodecor.com.br')
  .trim().replace(/\/+$/, '').replace(/\/api$/, '');
const PREFIXO = '/api/integracoes/smail/v1';
// Os escopos do contrato (integracoes/smail/config.js da API).
const ESCOPOS = ['crm', 'tarefas', 'calendario', 'chat', 'perfil'];
// O id do vínculo (uuid na API): só letras, números e hífen.
const RE_ID = /^[A-Za-z0-9-]{1,64}$/;

const erroJson = (res, status, error, message) => res.status(status).set('Cache-Control', 'no-store').json({ error, message });

/** A mesma trava do apiHttpClient: teste nunca fala com a API de verdade. */
function destinoPermitido(url) {
  const emTeste = Boolean(process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === 'test' || process.argv.includes('--test'));
  if (!emTeste) return true;
  try {
    return ['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname);
  } catch (_) {
    return false;
  }
}

/** Os escopos pedidos: nenhum = todos (o padrão da API); senão, só os conhecidos, sem repetir. */
function escoposDoPedido(lista) {
  if (lista === undefined || lista === null) return { ok: true, escopos: undefined };
  if (!Array.isArray(lista) || !lista.length) return { ok: false };
  const unicos = [...new Set(lista.map(String))];
  if (unicos.some(e => !ESCOPOS.includes(e))) return { ok: false };
  return { ok: true, escopos: ESCOPOS.filter(e => unicos.includes(e)) };
}

/**
 * Leva o pedido à API com o token da sessão e devolve a resposta como veio
 * (o corpo {error, message} da integração, o Retry-After do limite).
 */
async function repassar(req, res, { metodo, caminho, corpo }) {
  if (isDev) {
    return erroJson(res, 503, 'indisponivel', 'Com o banco DEV não há API central: a vinculação com o Santíssimo Mail só existe nela.');
  }
  const destino = `${API_ORIGEM}${PREFIXO}${caminho}`;
  if (!destinoPermitido(destino)) return erroJson(res, 599, 'indisponivel', `[smail] BLOQUEADO em teste: ${destino}`);
  const headers = {
    Authorization: req.headers.authorization || '',
    Accept: 'application/json',
    ...require('./contextoDaRota').cabecalhos(req)
  };
  if (corpo !== undefined) headers['Content-Type'] = 'application/json';
  let resposta;
  try {
    resposta = await fetch(destino, { method: metodo, headers, body: corpo !== undefined ? JSON.stringify(corpo) : undefined });
  } catch (err) {
    // Só a falha de rede (nunca o corpo: pode ter o código).
    console.warn('[smail] sem resposta da API:', err?.message || err);
    return erroJson(res, 502, 'indisponivel', 'Sem conexão com o servidor. Confira a internet e tente de novo.');
  }
  res.set('Cache-Control', 'no-store');
  const espera = resposta.headers.get('retry-after');
  if (espera) res.set('Retry-After', espera);
  if (resposta.status === 204) return res.status(204).end();
  let dados = null;
  try {
    dados = JSON.parse(await resposta.text());
  } catch (_) {
    dados = null;
  }
  if (!dados || typeof dados !== 'object') {
    // Resposta que não é da integração (API antiga, proxy no meio).
    return erroJson(res, resposta.status === 404 ? 404 : 502, resposta.status === 404 ? 'sem_rota' : 'indisponivel',
      resposta.status === 404 ? 'O servidor ainda não tem a vinculação com o Santíssimo Mail.' : 'O servidor respondeu de um jeito inesperado.');
  }
  // 404 de rota que não existe na API (antes da integração) não é "vínculo não encontrado".
  if (resposta.status === 404 && dados.error !== 'nao_encontrado') {
    return erroJson(res, 404, 'sem_rota', 'O servidor ainda não tem a vinculação com o Santíssimo Mail.');
  }
  return res.status(resposta.status).json(dados);
}

router.post('/vinculos/codigos', (req, res) => {
  const { ok, escopos } = escoposDoPedido(req.body?.escopos);
  if (!ok) return erroJson(res, 400, 'invalido', 'Escolha ao menos um escopo da lista.');
  return repassar(req, res, { metodo: 'POST', caminho: '/vinculos/codigos', corpo: escopos ? { escopos } : {} });
});

router.get('/meus-vinculos', (req, res) => repassar(req, res, { metodo: 'GET', caminho: '/meus-vinculos' }));

router.delete('/meus-vinculos/:id', (req, res) => {
  const id = String(req.params.id || '');
  if (!RE_ID.test(id)) return erroJson(res, 404, 'nao_encontrado', 'Vínculo não encontrado.');
  return repassar(req, res, { metodo: 'DELETE', caminho: `/meus-vinculos/${encodeURIComponent(id)}` });
});

// O resto da integração (serviço do Mail, administração) não passa pelo programa.
router.use((req, res) => erroJson(res, 404, 'nao_encontrado', 'Rota não disponível no programa.'));

module.exports = router;
module.exports.ESCOPOS = ESCOPOS;
module.exports.escoposDoPedido = escoposDoPedido;
module.exports.API_ORIGEM = API_ORIGEM;
