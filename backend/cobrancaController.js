/**
 * Rotas da cobrança (boletos BB) — /api/cobranca/*. Fase A: configuração,
 * credenciais e teste de conexão.
 *
 *   GET    /configuracao     quem tem financeiro.config.view vê (sem segredo)
 *   PUT    /configuracao     só o Sup Admin; ligar produção exige "PRODUCAO"
 *   POST   /credenciais      guarda o client_secret de um ambiente: no banco
 *                            (cifrado com a chave mestra) ou só neste computador
 *   DELETE /credenciais      remove (?ambiente=&destino=banco|computador|ambos)
 *   POST   /testar           token + listagem de boletos no ambiente pedido
 *
 * O secret nunca volta numa resposta e nunca chega ao renderer: entra pela
 * tela, é cifrado e só sai daqui para o OAuth do BB. Mesmo padrão do
 * certificado A1 e da senha do SMTP (fiscalController.js).
 */
const express = require('express');
const { createApiClient } = require('./apiHttpClient');
const { exigirPermissao, exigirSupAdmin, ehSupAdmin } = require('./permissionsController');
const segredoLocal = require('./fiscal/segredoLocal');
const segredoBanco = require('./fiscal/segredoBanco');
const configuracao = require('./cobranca/configuracaoCobranca');
const bbCliente = require('./cobranca/bbCliente');
const calculo = require('./cobranca/boletoCalculo');

/** Id do usuário autenticado, lido do JWT sem validar (só para auditoria). */
function usuarioDaRequisicao(req) {
  try {
    const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const parte = token.split('.')[1];
    if (!parte) return null;
    const payload = JSON.parse(Buffer.from(parte.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return payload.id ?? payload.userId ?? payload.sub ?? null;
  } catch (_) {
    return null;
  }
}

function erro(mensagem, status = 400) {
  const e = new Error(mensagem);
  e.status = status;
  return e;
}

function responder(res, err, contexto) {
  const status = err?.status || 500;
  if (status >= 500) console.error(`Erro em ${contexto}:`, err);
  res.status(status).json({ error: err?.message || 'Erro interno no módulo de cobrança', ...(err?.extra || {}) });
}

const NOME_NO_BANCO = ambiente => `bb_client_secret_${ambiente}`;
const NOME_NO_COFRE = ambiente => `bb-${ambiente}`;
const VARIAVEL_ENV = ambiente => `BB_CLIENT_SECRET_${ambiente.toUpperCase()}`;

/**
 * `segredo` (cofre local), `env`, `bb` (cliente do BB) e `fetchImpl` são
 * injetáveis para os testes; o app usa o cofre do Electron, o process.env e
 * o fetch do Node.
 */
function criarRouter({ segredo = null, env = process.env, bb = null, fetchImpl = undefined } = {}) {
  const router = express.Router();
  const cofre = segredo || segredoLocal.criar();
  const banco = segredoBanco.criar({ env });
  const cliente = bb || bbCliente.criar({ fetchImpl, env });

  const ambienteValido = v => (String(v || '').toLowerCase() === configuracao.PRODUCAO ? configuracao.PRODUCAO : configuracao.SANDBOX);

  /**
   * O client_secret do ambiente, nesta ordem: banco (todas as máquinas) →
   * cofre local → .env (DEV). Devolve { secret, origem, guardadoEm, erro }.
   */
  async function fonteDoSecret(api, ambiente) {
    let avisoBanco = null;
    if (api) {
      const s = await banco.ler(api, NOME_NO_BANCO(ambiente)).catch(() => null);
      if (s?.valor?.secret) return { secret: s.valor.secret, origem: 'banco', guardadoEm: s.atualizadoEm || null };
      if (s?.erro) avisoBanco = s.erro;
    }
    const guardado = typeof cofre.lerSegredo === 'function' ? cofre.lerSegredo(NOME_NO_COFRE(ambiente)) : null;
    if (guardado?.valor) return { secret: guardado.valor, origem: 'computador', guardadoEm: guardado.guardadoEm || null };
    if (env[VARIAVEL_ENV(ambiente)]) return { secret: env[VARIAVEL_ENV(ambiente)], origem: 'env', guardadoEm: null };
    return { secret: null, origem: null, guardadoEm: null, erro: avisoBanco || guardado?.erro || null };
  }

  /** Para a tela: o que há de cada ambiente, sem o secret. */
  async function estadoDasCredenciais(api, cfg) {
    const saida = {};
    for (const ambiente of configuracao.AMBIENTES) {
      const c = configuracao.credenciais(cfg, ambiente);
      const f = await fonteDoSecret(api, ambiente);
      saida[ambiente] = {
        client_id: c.clientId, app_key: c.appKey,
        secret_guardado: Boolean(f.secret), origem: f.origem, guardado_em: f.guardadoEm, erro: f.erro || null,
        pendencias: configuracao.pendencias(cfg, ambiente, { secret: Boolean(f.secret) })
      };
    }
    return saida;
  }

  function previaDoNossoNumero(cfg, ambiente) {
    try {
      return calculo.nossoNumero(cfg?.convenio, configuracao.proximoSequencial(cfg, ambiente)).formatado;
    } catch (_) {
      return null;
    }
  }

  async function montarEstado(req, api) {
    const cfg = await configuracao.carregar(api, { forcar: true });
    const ambiente = configuracao.ambienteEfetivo(cfg, env);
    return {
      configuracao: cfg,
      ambiente,
      ambiente_no_banco: cfg?.ambiente || configuracao.SANDBOX,
      travado_em_sandbox_nesta_maquina: String(env.BB_AMBIENTE || '').toLowerCase() === configuracao.SANDBOX,
      credenciais: await estadoDasCredenciais(api, cfg),
      nosso_numero: {
        sandbox: previaDoNossoNumero(cfg, configuracao.SANDBOX),
        producao: previaDoNossoNumero(cfg, configuracao.PRODUCAO)
      },
      urls: { sandbox: cliente.urls(configuracao.SANDBOX), producao: cliente.urls(configuracao.PRODUCAO) },
      cofre_disponivel: cofre.temCofre,
      banco_chave_mestra: banco.disponivel,
      pode_editar: await ehSupAdmin(req)
    };
  }

  router.get('/configuracao', exigirPermissao('financeiro.config.view'), async (req, res) => {
    try {
      res.json(await montarEstado(req, createApiClient(req)));
    } catch (err) {
      responder(res, err, 'GET /api/cobranca/configuracao');
    }
  });

  router.put('/configuracao', exigirSupAdmin, async (req, res) => {
    try {
      const api = createApiClient(req);
      const { confirmacao, ...entrada } = req.body || {};
      const { valores, erros } = configuracao.validar(entrada);
      if (erros.length) throw erro(erros.join(' | '));
      if (!Object.keys(valores).length) throw erro('Nada para salvar.');

      // Ligar a produção passa a registrar boletos reais na conta. A tela
      // pede a palavra; aqui ela é exigida de novo, porque a trava que vale
      // é a do servidor.
      const atual = await configuracao.carregar(api, { forcar: true });
      if (valores.ambiente === configuracao.PRODUCAO && atual?.ambiente !== configuracao.PRODUCAO
        && String(confirmacao || '').trim().toUpperCase() !== 'PRODUCAO') {
        throw erro('Para ligar a produção, confirme digitando PRODUCAO.');
      }

      await configuracao.gravar(api, valores, usuarioDaRequisicao(req));
      cliente.limparTokens();
      res.json(await montarEstado(req, api));
    } catch (err) {
      responder(res, err, 'PUT /api/cobranca/configuracao');
    }
  });

  /** Guarda o client_secret de um ambiente: no banco (cifrado) ou só neste computador. */
  router.post('/credenciais', exigirSupAdmin, async (req, res) => {
    try {
      const ambiente = ambienteValido(req.body?.ambiente);
      const secret = String(req.body?.client_secret ?? '').trim();
      if (!secret) throw erro('Informe o client_secret.');
      const destino = String(req.body?.destino || (banco.disponivel ? 'banco' : 'computador')).toLowerCase();
      const api = createApiClient(req);
      if (destino === 'banco') {
        await banco.guardar(api, NOME_NO_BANCO(ambiente), { secret }, { descricao: `Client secret do BB (${ambiente})`, usuarioId: usuarioDaRequisicao(req) });
      } else if (destino === 'computador') {
        if (typeof cofre.guardarSegredo !== 'function') throw erro('Cofre indisponível.', 500);
        cofre.guardarSegredo(NOME_NO_COFRE(ambiente), secret);
      } else {
        throw erro('Destino inválido: banco ou computador.');
      }
      cliente.limparTokens();
      const cfg = await configuracao.carregar(api, { forcar: true });
      res.json((await estadoDasCredenciais(api, cfg))[ambiente]);
    } catch (err) {
      responder(res, err, 'POST /api/cobranca/credenciais');
    }
  });

  router.delete('/credenciais', exigirSupAdmin, async (req, res) => {
    try {
      const ambiente = ambienteValido(req.query?.ambiente || req.body?.ambiente);
      const destino = String(req.query?.destino || req.body?.destino || 'ambos').toLowerCase();
      const api = createApiClient(req);
      if (destino === 'banco' || destino === 'ambos') await banco.remover(api, NOME_NO_BANCO(ambiente)).catch(() => {});
      if (destino === 'computador' || destino === 'ambos') cofre.removerSegredo?.(NOME_NO_COFRE(ambiente));
      cliente.limparTokens();
      const cfg = await configuracao.carregar(api, { forcar: true });
      res.json((await estadoDasCredenciais(api, cfg))[ambiente]);
    } catch (err) {
      responder(res, err, 'DELETE /api/cobranca/credenciais');
    }
  });

  /**
   * Token + listagem de boletos: prova credenciais, app key e conta. POST
   * porque sai para fora. Sandbox é sempre permitido; produção só quando vale.
   */
  router.post('/testar', exigirPermissao('financeiro.config.view'), async (req, res) => {
    try {
      const api = createApiClient(req);
      const cfg = await configuracao.carregar(api, { forcar: true });
      if (!cfg) throw erro('Configuração de cobrança ainda não cadastrada (rode sql/cobranca_base.sql).', 409);
      const efetivo = configuracao.ambienteEfetivo(cfg, env);
      const pedido = ambienteValido(req.body?.ambiente || efetivo);
      const ambiente = pedido === configuracao.PRODUCAO && efetivo === configuracao.PRODUCAO ? configuracao.PRODUCAO : configuracao.SANDBOX;
      const c = configuracao.credenciais(cfg, ambiente);
      const f = await fonteDoSecret(api, ambiente);
      const faltas = configuracao.pendencias(cfg, ambiente, { secret: Boolean(f.secret) });
      if (faltas.length) throw erro(`Antes de testar: ${faltas.join('; ')}.`, 409);
      const r = await cliente.testarConexao({ ambiente, clientId: c.clientId, clientSecret: f.secret, appKey: c.appKey, agencia: cfg.agencia, conta: cfg.conta });
      res.json({ ...r, origem_secret: f.origem });
    } catch (err) {
      responder(res, err, 'POST /api/cobranca/testar');
    }
  });

  return router;
}

const router = criarRouter();
module.exports = router;
module.exports.criarRouter = criarRouter;
module.exports.usuarioDaRequisicao = usuarioDaRequisicao;
