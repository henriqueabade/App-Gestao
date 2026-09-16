/**
 * Cliente da API Cobranças v2 do Banco do Brasil: token OAuth2
 * (client_credentials, renovado sozinho antes de vencer), chamada com a
 * `gw-dev-app-key` e erros traduzidos para a tela.
 *
 * Sandbox e produção têm endereços próprios; o .env pode sobrepor
 * (BB_URL_OAUTH_SANDBOX, BB_URL_API_SANDBOX, BB_URL_OAUTH_PRODUCAO,
 * BB_URL_API_PRODUCAO) se o banco mudar um host sem aviso. O `fetch` é
 * injetável para os testes; nada aqui guarda segredo — o secret chega por
 * parâmetro a cada chamada e só fica no cache do token.
 */
const URLS = {
  sandbox: { oauth: 'https://oauth.sandbox.bb.com.br/oauth/token', api: 'https://api.sandbox.bb.com.br/cobrancas/v2' },
  producao: { oauth: 'https://oauth.bb.com.br/oauth/token', api: 'https://api.bb.com.br/cobrancas/v2' }
};
const ESCOPOS = ['cobrancas.boletos-info', 'cobrancas.boletos-requisicao'];
const FOLGA_TOKEN_MS = 60 * 1000;

function erro(mensagem, status = 502, extra = null) {
  const e = new Error(mensagem);
  e.status = status;
  if (extra) e.extra = extra;
  return e;
}

/** A mensagem que o BB mandou, nos formatos que ele usa (erros[], errors[], error_description). */
function mensagemDoBB(corpo) {
  if (!corpo || typeof corpo !== 'object') return '';
  const listas = [corpo.erros, corpo.errors].filter(Array.isArray);
  for (const lista of listas) {
    const textos = lista.map(e => [e?.codigo || e?.code, e?.mensagem || e?.message, e?.ocorrencia].filter(Boolean).join(' — ')).filter(Boolean);
    if (textos.length) return textos.join(' | ');
  }
  return corpo.error_description || corpo.message || corpo.mensagem || corpo.error || '';
}

function criar({ fetchImpl = globalThis.fetch, env = process.env, agora = () => Date.now(), timeoutMs = 20000 } = {}) {
  const tokens = new Map();

  function urls(ambiente) {
    const amb = ambiente === 'producao' ? 'producao' : 'sandbox';
    const chave = amb.toUpperCase();
    return {
      oauth: env[`BB_URL_OAUTH_${chave}`] || URLS[amb].oauth,
      api: (env[`BB_URL_API_${chave}`] || URLS[amb].api).replace(/\/$/, '')
    };
  }

  async function buscar(url, opcoes) {
    if (typeof fetchImpl !== 'function') throw erro('Sem cliente HTTP para falar com o BB.', 500);
    const controle = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controle ? setTimeout(() => controle.abort(), timeoutMs) : null;
    try {
      return await fetchImpl(url, { ...opcoes, signal: controle?.signal });
    } catch (e) {
      if (e?.name === 'AbortError') throw erro(`O BB não respondeu em ${Math.round(timeoutMs / 1000)} s.`, 504);
      throw erro(`Não foi possível falar com o BB: ${e?.message || e}`, 502);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function lerCorpo(resposta) {
    const texto = await resposta.text().catch(() => '');
    try { return texto ? JSON.parse(texto) : null; } catch (_) { return { bruto: texto }; }
  }

  /** Token do ambiente para o par client_id/secret, do cache enquanto vale. */
  async function obterToken({ ambiente, clientId, clientSecret, escopos = ESCOPOS, forcar = false }) {
    if (!clientId || !clientSecret) throw erro('Faltam o client_id ou o client_secret do BB.', 409);
    const chave = `${ambiente}|${clientId}`;
    const guardado = tokens.get(chave);
    if (!forcar && guardado && guardado.validoAte > agora()) return guardado;

    const inicio = agora();
    const resposta = await buscar(urls(ambiente).oauth, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body: `grant_type=client_credentials&scope=${encodeURIComponent(escopos.join(' '))}`
    });
    const corpo = await lerCorpo(resposta);
    if (!resposta.ok) {
      const detalhe = mensagemDoBB(corpo);
      if (resposta.status === 401 || resposta.status === 400) throw erro(`O BB recusou as credenciais (${resposta.status})${detalhe ? `: ${detalhe}` : ''}. Confira client_id e client_secret do ambiente.`, 401);
      throw erro(`O BB respondeu ${resposta.status} ao pedir o token${detalhe ? `: ${detalhe}` : ''}.`, 502);
    }
    if (!corpo?.access_token) throw erro('O BB não devolveu o token de acesso.', 502);
    const validade = Number(corpo.expires_in || 600) * 1000;
    const token = {
      valor: corpo.access_token,
      tipo: corpo.token_type || 'Bearer',
      escopos: String(corpo.scope || escopos.join(' ')).split(/\s+/).filter(Boolean),
      validoAte: agora() + Math.max(validade - FOLGA_TOKEN_MS, 30 * 1000),
      tempoMs: agora() - inicio
    };
    tokens.set(chave, token);
    return token;
  }

  /** Uma chamada à API com o token (renova e repete uma vez se o BB disser 401). */
  async function chamar({ ambiente, appKey, credenciais, metodo = 'GET', caminho, query = {}, corpo = undefined, tentativa = 0 }) {
    if (!appKey) throw erro('Falta a app key do BB (gw-dev-app-key).', 409);
    const token = await obterToken({ ...credenciais, ambiente, forcar: tentativa > 0 });
    const params = new URLSearchParams();
    params.set('gw-dev-app-key', appKey);
    for (const [k, v] of Object.entries(query || {})) {
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
    }
    const url = `${urls(ambiente).api}${caminho.startsWith('/') ? caminho : `/${caminho}`}?${params.toString()}`;
    const resposta = await buscar(url, {
      method: metodo,
      headers: {
        Authorization: `${token.tipo} ${token.valor}`,
        'gw-dev-app-key': appKey,
        Accept: 'application/json',
        ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined
    });
    const dados = await lerCorpo(resposta);
    if (resposta.status === 401 && tentativa === 0) {
      return chamar({ ambiente, appKey, credenciais, metodo, caminho, query, corpo, tentativa: 1 });
    }
    if (!resposta.ok) {
      const detalhe = mensagemDoBB(dados);
      throw erro(`O BB respondeu ${resposta.status} em ${metodo} ${caminho}${detalhe ? `: ${detalhe}` : ''}.`, resposta.status >= 500 ? 502 : 422, { bb: dados, http: resposta.status });
    }
    return dados;
  }

  /**
   * Prova de vida: token + a listagem de boletos em aberto da conta (os três
   * parâmetros são obrigatórios na API). Em sandbox "nenhum boleto" é
   * resposta boa — ninguém emitiu nada lá ainda.
   */
  async function testarConexao({ ambiente, clientId, clientSecret, appKey, agencia, conta }) {
    const inicio = agora();
    const token = await obterToken({ ambiente, clientId, clientSecret, forcar: true });
    let boletos = null;
    let observacao = null;
    try {
      const r = await chamar({
        ambiente, appKey, credenciais: { clientId, clientSecret }, caminho: '/boletos',
        query: { indicadorSituacao: 'A', agenciaBeneficiario: String(agencia || '').replace(/\D/g, ''), contaBeneficiario: String(conta || '').replace(/\D/g, '') }
      });
      boletos = Array.isArray(r?.boletos) ? r.boletos.length : (Array.isArray(r) ? r.length : 0);
    } catch (e) {
      // 404 "não há boletos" é normal; qualquer outra coisa é o que a tela precisa ver.
      if (e?.extra?.http === 404) { boletos = 0; observacao = 'A conta ainda não tem boletos em aberto neste ambiente.'; } else throw e;
    }
    return { ok: true, ambiente, tempoMs: agora() - inicio, escopos: token.escopos, boletosAbertos: boletos, observacao };
  }

  return { urls, obterToken, chamar, testarConexao, limparTokens: () => tokens.clear() };
}

module.exports = { criar, URLS, ESCOPOS, mensagemDoBB };
