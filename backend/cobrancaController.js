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
 * Fase B — boletos por parcela:
 *   GET    /pedidos/:id/boletos   parcelas com o boleto de cada uma e o que impede gerar
 *   POST   /pedidos/:id/boletos   registra no BB (parcelas: [ids] ou todas sem boleto)
 *   GET    /boletos, /boletos/:id
 *
 * Fase C — boleto em PDF (HTML que o app imprime):
 *   GET    /boletos/:id/documento           um boleto
 *   GET    /pedidos/:id/boletos/documento   todos os boletos a pagar do pedido
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
const boletos = require('./cobranca/boletos');
const bbBoleto = require('./cobranca/bbBoleto');
const boletoDocumento = require('./cobranca/boletoDocumento');

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

function erro(mensagem, status = 400, extra = null) {
  const e = new Error(mensagem);
  e.status = status;
  if (extra) e.extra = extra;
  return e;
}

function responder(res, err, contexto) {
  const status = err?.status || 500;
  if (status >= 500) console.error(`Erro em ${contexto}:`, err);
  // `extra` leva o que a tela precisa além da mensagem (pendências, o retorno do BB).
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
      return calculo.nossoNumero(configuracao.dadosDaConta(cfg, ambiente).convenio, configuracao.proximoSequencial(cfg, ambiente)).formatado;
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
      travado_em_sandbox_nesta_maquina: ['sandbox', 'homologacao'].includes(String(env.BB_AMBIENTE || '').toLowerCase()),
      // A conta que cada ambiente usa: na homologação, a de teste do BB.
      contas: cfg ? { sandbox: configuracao.dadosDaConta(cfg, configuracao.SANDBOX), producao: configuracao.dadosDaConta(cfg, configuracao.PRODUCAO) } : null,
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
   * porque sai para fora. Homologação (com a conta de teste) é sempre
   * permitida; produção só quando vale.
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
      const conta = configuracao.dadosDaConta(cfg, ambiente);
      const r = await cliente.testarConexao({ ambiente, clientId: c.clientId, clientSecret: f.secret, appKey: c.appKey, agencia: conta.agencia, conta: conta.conta });
      res.json({ ...r, origem_secret: f.origem, conta: { agencia: conta.agencia, conta: conta.conta, convenio: conta.convenio, teste: conta.teste } });
    } catch (err) {
      responder(res, err, 'POST /api/cobranca/testar');
    }
  });

  // ----------------------------------------------------------- boletos

  /** 'YYYY-MM-DD' de hoje em Brasília (a data de emissão do boleto). */
  function hojeEmBrasilia(agora = new Date()) {
    const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(agora);
    const v = tipo => partes.find(p => p.type === tipo)?.value;
    return `${v('year')}-${v('month')}-${v('day')}`;
  }

  /** O que a tela do pedido precisa: parcelas com o boleto de cada uma, o que impede gerar e o padrão da caixa "Gerar boleto". */
  async function estadoDoPedido(api, pedidoId) {
    const dados = await boletos.lerPedidoCobranca(api, pedidoId);
    const cfg = dados.configuracao;
    const ambiente = configuracao.ambienteEfetivo(cfg, env);
    const f = cfg ? await fonteDoSecret(api, ambiente) : { secret: null };
    const pendencias = configuracao.pendencias(cfg, ambiente, { secret: Boolean(f.secret) });
    const pagador = dados.cliente ? bbBoleto.pagadorDoCliente(dados.cliente) : null;
    const pendenciasPagador = pagador ? bbBoleto.pendenciasDoPagador(pagador) : ['Pedido sem cliente.'];
    if (!dados.parcelas.length) pendenciasPagador.push('O pedido não tem parcelas cadastradas.');
    const linhas = boletos.parcelasComBoletos(dados);
    return {
      pedido: { id: dados.pedido.id, numero: dados.pedido.numero, situacao: dados.pedido.situacao, cliente: dados.cliente ? (dados.cliente.nome_fantasia || dados.cliente.razao_social || dados.cliente.nome || null) : null },
      ambiente,
      nota_fiscal: dados.notaViva ? { id: dados.notaViva.id, serie: dados.notaViva.serie, numero: dados.notaViva.numero } : null,
      parcelas: linhas,
      pendencias: [...pendencias, ...pendenciasPagador],
      pode_gerar: !pendencias.length && !pendenciasPagador.length && linhas.some(l => !l.tem_boleto_vivo) && String(dados.pedido.situacao || '').toLowerCase() !== 'cancelado',
      gerar_ao_emitir_nfe: cfg ? cfg.gerar_ao_emitir_nfe !== false : false,
      resumo: boletos.resumo(dados.boletos)
    };
  }

  router.get('/pedidos/:id/boletos', exigirPermissao('financeiro.boleto.view'), async (req, res) => {
    try {
      res.json(await estadoDoPedido(createApiClient(req), req.params.id));
    } catch (err) {
      responder(res, err, 'GET /api/cobranca/pedidos/:id/boletos');
    }
  });

  /**
   * Registra no BB os boletos das parcelas pedidas (`parcelas: [ids]`; vazio =
   * todas as que ainda não têm boleto vivo). Devolve o resultado parcela a
   * parcela: uma recusa do BB não impede as outras.
   */
  router.post('/pedidos/:id/boletos', exigirPermissao('financeiro.boleto.emit'), async (req, res) => {
    try {
      const api = createApiClient(req);
      const cfg = await configuracao.carregar(api, { forcar: true });
      if (!cfg) throw erro('Configuração de cobrança ainda não cadastrada (rode sql/cobranca_base.sql).', 409);
      const ambiente = configuracao.ambienteEfetivo(cfg, env);
      const c = configuracao.credenciais(cfg, ambiente);
      const f = await fonteDoSecret(api, ambiente);
      const faltas = configuracao.pendencias(cfg, ambiente, { secret: Boolean(f.secret) });
      if (faltas.length) throw erro(`A cobrança não está pronta: ${faltas.join('; ')}.`, 409, { pendencias: faltas });
      const parcelaIds = Array.isArray(req.body?.parcelas) ? req.body.parcelas : [];
      res.json(await boletos.registrar({
        api, pedidoId: req.params.id, parcelaIds, notaFiscalId: req.body?.nota_fiscal_id ?? null,
        bb: cliente, credenciais: { clientId: c.clientId, clientSecret: f.secret }, appKey: c.appKey,
        ambiente, cfg, usuarioId: usuarioDaRequisicao(req), hoje: hojeEmBrasilia()
      }));
    } catch (err) {
      responder(res, err, 'POST /api/cobranca/pedidos/:id/boletos');
    }
  });

  router.get('/boletos', exigirPermissao('financeiro.boleto.view'), async (req, res) => {
    try {
      res.json(await boletos.listar(createApiClient(req), { pedido_id: req.query?.pedido_id }));
    } catch (err) {
      responder(res, err, 'GET /api/cobranca/boletos');
    }
  });

  router.get('/boletos/:id', exigirPermissao('financeiro.boleto.view'), async (req, res) => {
    try {
      res.json(boletos.enxuto(await boletos.ler(createApiClient(req), req.params.id)));
    } catch (err) {
      responder(res, err, 'GET /api/cobranca/boletos/:id');
    }
  });

  // ------------------------------------------------ boleto em PDF (fase C)
  // O HTML volta para o app, que gera o PDF (printToPDF) — a API do BB não
  // devolve o boleto impresso. Nada é enviado ao cliente.

  /** Um boleto (a ficha completa, com recibo e código de barras). */
  router.get('/boletos/:id/documento', exigirPermissao('financeiro.boleto.view'), async (req, res) => {
    try {
      const api = createApiClient(req);
      const [boleto, cfg] = await Promise.all([boletos.ler(api, req.params.id), configuracao.carregar(api)]);
      const { html, dados } = await boletoDocumento.gerarBoletosHtml(boleto, cfg);
      res.json({ nome: dados[0].nomeArquivo, html, boleto: boletos.enxuto(boleto) });
    } catch (err) {
      responder(res, err, 'GET /api/cobranca/boletos/:id/documento');
    }
  });

  /** Todos os boletos a pagar do pedido num PDF só (uma página por parcela). */
  router.get('/pedidos/:id/boletos/documento', exigirPermissao('financeiro.boleto.view'), async (req, res) => {
    try {
      const api = createApiClient(req);
      const dados = await boletos.lerPedidoCobranca(api, req.params.id);
      const aPagar = dados.parcelas
        .map(p => boletos.boletoDaParcela(dados.boletos, p))
        .filter(b => b && boletos.STATUS_A_PAGAR.has(String(b.status)));
      if (!aPagar.length) throw erro('Este pedido não tem boleto registrado a pagar.', 404);
      const { html } = await boletoDocumento.gerarBoletosHtml(aPagar, dados.configuracao);
      const numero = String(dados.pedido.numero || dados.pedido.id).replace(/[^A-Za-z0-9]/g, '');
      res.json({ nome: `Boletos-${numero}`, html, quantidade: aPagar.length });
    } catch (err) {
      responder(res, err, 'GET /api/cobranca/pedidos/:id/boletos/documento');
    }
  });

  return router;
}

const router = criarRouter();
module.exports = router;
module.exports.criarRouter = criarRouter;
module.exports.usuarioDaRequisicao = usuarioDaRequisicao;
