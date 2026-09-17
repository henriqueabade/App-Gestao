/**
 * Cliente da API Cobranças v2 do Banco do Brasil: token OAuth2
 * (client_credentials, renovado sozinho antes de vencer), chamada com a
 * `gw-dev-app-key` e erros traduzidos para a tela.
 *
 * O ambiente de testes (gravado como 'sandbox') é a HOMOLOGAÇÃO do BB
 * (`oauth.hm` / `api.hm`): o "sandbox" do portal só serve ao próprio portal
 * (em 16/09/2026 `oauth.sandbox.bb.com.br` respondia 504 com certificado
 * vencido). Na homologação o BB só aceita a conta de teste da documentação
 * (agência 452, conta 123873); a conta real dá 403 "AppKey inválida". Cada
 * ambiente fala só com os próprios endereços. O .env pode fixar um endereço
 * (BB_URL_OAUTH_SANDBOX, BB_URL_API_SANDBOX, BB_URL_OAUTH_PRODUCAO,
 * BB_URL_API_PRODUCAO). O `fetch` é injetável para os testes; nada aqui
 * guarda segredo — o secret chega por parâmetro e só fica no cache do token.
 */
const HOSTS = {
  sandbox: [
    { nome: 'homologacao', oauth: 'https://oauth.hm.bb.com.br/oauth/token', api: 'https://api.hm.bb.com.br/cobrancas/v2' }
  ],
  producao: [
    { nome: 'producao', oauth: 'https://oauth.bb.com.br/oauth/token', api: 'https://api.bb.com.br/cobrancas/v2' }
  ]
};
/** Compatibilidade: o primeiro par de cada ambiente. */
const URLS = { sandbox: { oauth: HOSTS.sandbox[0].oauth, api: HOSTS.sandbox[0].api }, producao: { oauth: HOSTS.producao[0].oauth, api: HOSTS.producao[0].api } };
const ESCOPOS = ['cobrancas.boletos-info', 'cobrancas.boletos-requisicao'];
const FOLGA_TOKEN_MS = 60 * 1000;
/** Espera antes de repetir uma consulta que o banco recusou por instabilidade (5xx). */
const ESPERA_INSTABILIDADE_MS = 1500;

function erro(mensagem, status = 502, extra = null) {
  const e = new Error(mensagem);
  e.status = status;
  if (extra) e.extra = extra;
  return e;
}

/** A mensagem que o BB mandou, nos formatos que ele usa (erros[], errors[], error_description, página HTML). */
function mensagemDoBB(corpo) {
  if (!corpo || typeof corpo !== 'object') return '';
  const listas = [corpo.erros, corpo.errors].filter(Array.isArray);
  for (const lista of listas) {
    // A API Cobranças usa codigoMensagem / textoMensagem / textoProvidencia.
    const textos = lista.map(e => [e?.codigoMensagem || e?.codigo || e?.code, e?.textoMensagem || e?.mensagem || e?.message, e?.textoProvidencia || e?.ocorrencia]
      .filter(Boolean).join(' — ')).filter(Boolean);
    if (textos.length) return textos.join(' | ');
  }
  if (typeof corpo.bruto === 'string') {
    if (/<html/i.test(corpo.bruto)) {
      const titulo = /<title>([^<]*)<\/title>/i.exec(corpo.bruto)?.[1]?.trim();
      return titulo ? `o banco devolveu uma página (${titulo})` : 'o banco devolveu uma página HTML em vez da resposta (bloqueio ou indisponibilidade)';
    }
    return corpo.bruto.slice(0, 160);
  }
  // Gateway do BB: { detail, userHelp } (ex.: app key inválida, aplicação sem a API habilitada).
  if (corpo.detail || corpo.userHelp) return [corpo.detail, corpo.userHelp].filter(Boolean).join(' — ');
  return corpo.error_description || corpo.message || corpo.mensagem || corpo.error || '';
}

function criar({ fetchImpl = globalThis.fetch, env = process.env, agora = () => Date.now(), timeoutMs = 20000, esperar = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const tokens = new Map();
  // O par de hosts que respondeu por último em cada ambiente: a próxima chamada começa por ele.
  const preferidos = new Map();

  const nomeDoAmbiente = ambiente => (ambiente === 'producao' ? 'producao' : 'sandbox');

  /** Os pares de endereços a tentar, na ordem: o fixado no .env, senão o preferido e depois os demais. */
  function candidatos(ambiente) {
    const amb = nomeDoAmbiente(ambiente);
    const chave = amb.toUpperCase();
    const oauthFixo = env[`BB_URL_OAUTH_${chave}`];
    const apiFixa = env[`BB_URL_API_${chave}`];
    if (oauthFixo || apiFixa) {
      const base = HOSTS[amb][0];
      return [{ nome: 'env', oauth: oauthFixo || base.oauth, api: (apiFixa || base.api).replace(/\/$/, '') }];
    }
    const lista = HOSTS[amb].map(h => ({ ...h }));
    const preferido = preferidos.get(amb);
    if (!preferido) return lista;
    return [...lista.filter(h => h.nome === preferido), ...lista.filter(h => h.nome !== preferido)];
  }

  /** Os endereços que valem agora no ambiente (para a tela). */
  function urls(ambiente) {
    const [primeiro] = candidatos(ambiente);
    return { nome: primeiro.nome, oauth: primeiro.oauth, api: primeiro.api };
  }

  async function buscar(url, opcoes) {
    if (typeof fetchImpl !== 'function') throw erro('Sem cliente HTTP para falar com o BB.', 500);
    const controle = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controle ? setTimeout(() => controle.abort(), timeoutMs) : null;
    try {
      return await fetchImpl(url, { ...opcoes, signal: controle?.signal });
    } catch (e) {
      if (e?.name === 'AbortError') throw erro(`O BB não respondeu em ${Math.round(timeoutMs / 1000)} s.`, 504);
      const causa = e?.cause?.code || e?.code || '';
      const detalhe = causa === 'CERT_HAS_EXPIRED' ? 'certificado TLS do banco vencido' : (causa || e?.message || String(e));
      throw erro(`Não foi possível falar com o BB: ${detalhe}`, 502);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function lerCorpo(resposta) {
    const texto = await resposta.text().catch(() => '');
    try { return texto ? JSON.parse(texto) : null; } catch (_) { return { bruto: texto }; }
  }

  /** Um pedido de token a UM par de hosts. Recusa de credencial (400/401) é definitiva; o resto é "tente o próximo". */
  async function pedirToken(host, { clientId, clientSecret, escopos }) {
    const inicio = agora();
    const resposta = await buscar(host.oauth, {
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
      if (resposta.status === 401 || resposta.status === 400) {
        throw erro(`O BB recusou as credenciais (${resposta.status})${detalhe ? `: ${detalhe}` : ''}. Confira client_id e client_secret do ambiente.`, 401, { definitivo: true });
      }
      throw erro(`${new URL(host.oauth).host}: respondeu ${resposta.status}${detalhe ? ` — ${detalhe}` : ''}`, resposta.status >= 500 ? 502 : 403);
    }
    if (!corpo?.access_token) throw erro(`${new URL(host.oauth).host}: não devolveu o token de acesso.`, 502);
    const validade = Number(corpo.expires_in || 600) * 1000;
    return {
      valor: corpo.access_token,
      tipo: corpo.token_type || 'Bearer',
      escopos: String(corpo.scope || escopos.join(' ')).split(/\s+/).filter(Boolean),
      validoAte: agora() + Math.max(validade - FOLGA_TOKEN_MS, 30 * 1000),
      tempoMs: agora() - inicio,
      hosts: { nome: host.nome, oauth: host.oauth, api: host.api }
    };
  }

  /** Token do ambiente para o par client_id/secret, do cache enquanto vale; tenta os hosts na ordem. */
  async function obterToken({ ambiente, clientId, clientSecret, escopos = ESCOPOS, forcar = false }) {
    if (!clientId || !clientSecret) throw erro('Faltam o client_id ou o client_secret do BB.', 409);
    const amb = nomeDoAmbiente(ambiente);
    const chave = `${amb}|${clientId}`;
    const guardado = tokens.get(chave);
    if (!forcar && guardado && guardado.validoAte > agora()) return guardado;

    const falhas = [];
    for (const host of candidatos(amb)) {
      try {
        const token = await pedirToken(host, { clientId, clientSecret, escopos });
        tokens.set(chave, token);
        preferidos.set(amb, host.nome);
        return token;
      } catch (e) {
        if (e?.extra?.definitivo) throw e;
        falhas.push(e.message.startsWith(new URL(host.oauth).host) ? e.message : `${new URL(host.oauth).host}: ${e.message}`);
      }
    }
    const ondeTentou = falhas.join('; ');
    throw erro(amb === 'sandbox'
      ? `A homologação do BB está fora do ar (${ondeTentou}). Não é a sua configuração: é o servidor de testes do banco; tente de novo mais tarde.`
      : `O BB não respondeu (${ondeTentou}). Tente de novo em alguns minutos.`, 502, { tentativas: falhas });
  }

  /** Uma chamada à API com o token (renova e repete uma vez se o BB disser 401). */
  async function chamar({ ambiente, appKey, credenciais, metodo = 'GET', caminho, query = {}, corpo = undefined, tentativa = 0, repetiuInstavel = false }) {
    if (!appKey) throw erro('Falta a app key do BB (gw-dev-app-key).', 409);
    const token = await obterToken({ ...credenciais, ambiente, forcar: tentativa > 0 });
    // Homologação/sandbox usam `gw-dev-app-key`; produção, `gw-app-key`.
    const nomeDaChave = nomeDoAmbiente(ambiente) === 'producao' ? 'gw-app-key' : 'gw-dev-app-key';
    const params = new URLSearchParams();
    params.set(nomeDaChave, appKey);
    for (const [k, v] of Object.entries(query || {})) {
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
    }
    const base = token.hosts?.api || urls(ambiente).api;
    const url = `${base}${caminho.startsWith('/') ? caminho : `/${caminho}`}?${params.toString()}`;
    const resposta = await buscar(url, {
      method: metodo,
      headers: {
        Authorization: `${token.tipo} ${token.valor}`,
        [nomeDaChave]: appKey,
        Accept: 'application/json',
        ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined
    });
    const dados = await lerCorpo(resposta);
    if (resposta.status === 401 && tentativa === 0) {
      return chamar({ ambiente, appKey, credenciais, metodo, caminho, query, corpo, tentativa: 1, repetiuInstavel });
    }
    // Instabilidade do banco (502/503/504) numa CONSULTA: espera um pouco e
    // tenta de novo uma vez. Registro (POST) não repete sozinho — quem decide
    // é quem chamou, que sabe lidar com nosso número repetido.
    const instavel = [502, 503, 504].includes(resposta.status);
    if (instavel && metodo === 'GET' && !repetiuInstavel) {
      await esperar(ESPERA_INSTABILIDADE_MS);
      return chamar({ ambiente, appKey, credenciais, metodo, caminho, query, corpo, tentativa, repetiuInstavel: true });
    }
    if (!resposta.ok) {
      const detalhe = mensagemDoBB(dados);
      const aviso = instavel ? ' Instabilidade do Banco do Brasil, não da sua configuração: tente de novo em instantes.' : '';
      throw erro(`O BB respondeu ${resposta.status} em ${metodo} ${caminho}${detalhe ? `: ${detalhe}` : ''}.${aviso}`, resposta.status >= 500 ? 502 : 422, { bb: dados, http: resposta.status });
    }
    return dados;
  }

  /**
   * Prova de vida: token + a listagem de boletos em aberto da conta (os três
   * parâmetros são obrigatórios na API). "Nenhum boleto" é resposta boa.
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
      // 404 "não há boletos" é normal. 403 depois de um token válido: as
      // credenciais passaram, quem recusou foi a app key ou a conta/convênio.
      if (e?.extra?.http === 404) { boletos = 0; observacao = 'A conta ainda não tem boletos em aberto neste ambiente.'; } else if (e?.extra?.http === 403) {
        const detalhe = mensagemDoBB(e.extra.bb) || 'sem detalhe';
        throw erro(`Token obtido (client ID e secret certos), mas o BB recusou a consulta de boletos (403): ${detalhe}.`
          + (nomeDoAmbiente(ambiente) === 'sandbox'
            ? ` Consultou a agência ${agencia} / conta ${conta}: na homologação o BB só aceita a conta de teste da documentação (452 / 123873). Se for ela, confira a app key e se a "API de Cobrança" está habilitada na aplicação.`
            : ' Confira a app key de produção e se a aplicação está liberada para a conta.'), 403, { bb: e.extra.bb, http: 403, hosts: token.hosts });
      } else throw e;
    }
    return { ok: true, ambiente: nomeDoAmbiente(ambiente), tempoMs: agora() - inicio, escopos: token.escopos, boletosAbertos: boletos, observacao, hosts: token.hosts };
  }

  return { urls, candidatos, obterToken, chamar, testarConexao, limparTokens: () => { tokens.clear(); preferidos.clear(); } };
}

module.exports = { criar, HOSTS, URLS, ESCOPOS, mensagemDoBB };
