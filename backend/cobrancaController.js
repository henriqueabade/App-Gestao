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
 * Fase D — alterações, baixa e consulta no BB:
 *   GET    /boletos/:id/historico           o boleto, o histórico e o que dá para fazer
 *   POST   /boletos/:id/sincronizar         consulta no BB e grava o que vale lá
 *   POST   /boletos/:id/prorrogar           { data_vencimento }
 *   POST   /boletos/:id/abatimento          { valor }
 *   POST   /boletos/:id/baixar              { motivo, observacao, data_recebimento, valor_recebido, forma, novo_vencimento }
 *   POST   /pedidos/:id/boletos/sincronizar consulta todos os boletos a pagar do pedido
 *
 * Fase E — recebimentos e conciliação:
 *   GET    /recebimentos/painel?competencia=         resumo e pendências para o Financeiro
 *   GET    /recebimentos?competencia=&visao=          recebidos | a_receber | em_atraso | abertas
 *   POST   /recebimentos                              recebimento à mão (com baixar_boleto, baixa o boleto em aberto como quitado por fora)
 *   POST   /recebimentos/:id/estornar                 { motivo }
 *   POST   /conciliar                                 fila do webhook + consulta dos boletos a pagar (so_fila: só a fila)
 *
 * Fase F — webhook e conciliação automática:
 *   GET    /webhook/estado    URL a cadastrar (sem o token), avisos recebidos, agenda e execuções
 *
 * Parcela mínima (sql/desenhistas_producao_parcela.sql):
 *   GET    /parcela-minima          o valor (orçamentos, pedidos e financeiro leem)
 *   PUT    /configuracao/parcela    { parcela_minima } — financeiro.parcela.editar
 *   O abatimento que deixaria o boleto abaixo do mínimo é recusado.
 *   (a agenda roda sozinha: backend/cobranca/agendaConciliacao.js, ligada pelo server.js no app)
 *
 * O secret nunca volta numa resposta e nunca chega ao renderer: entra pela
 * tela, é cifrado e só sai daqui para o OAuth do BB. Mesmo padrão do
 * certificado A1 e da senha do SMTP (fiscalController.js).
 */
const express = require('express');
const { createApiClient } = require('./apiHttpClient');
const { exigirPermissao, exigirAlgumaPermissao, exigirSupAdmin, ehSupAdmin } = require('./permissionsController');
const segredoLocal = require('./fiscal/segredoLocal');
const segredoBanco = require('./fiscal/segredoBanco');
const configuracao = require('./cobranca/configuracaoCobranca');
const bbCliente = require('./cobranca/bbCliente');
const calculo = require('./cobranca/boletoCalculo');
const boletos = require('./cobranca/boletos');
const bbBoleto = require('./cobranca/bbBoleto');
const boletoDocumento = require('./cobranca/boletoDocumento');
const operacoes = require('./cobranca/boletoOperacoes');
const recebimentos = require('./cobranca/recebimentos');
const contasReceber = require('./cobranca/contasReceber');
const conciliacao = require('./cobranca/conciliacao');
const execucoes = require('./cobranca/execucoes');
const webhookEstado = require('./cobranca/webhookEstado');
const parcelaMinima = require('./cobranca/parcelaMinima');
const externas = require('./fiscal/externas');

/** Quem lê a parcela mínima: quem monta orçamento, mexe em pedido ou está no financeiro. */
const LEEM_A_PARCELA_MINIMA = ['orc.view', 'orc.create', 'orc.edit', 'ped.view', 'ped.payment.edit', 'financeiro.view', 'financeiro.config.view'];
const SQL_PARCELA = 'Falta rodar sql/desenhistas_producao_parcela.sql no banco e reiniciar a API.';
const os = require('os');

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

  router.get('/parcela-minima', exigirAlgumaPermissao(LEEM_A_PARCELA_MINIMA), async (req, res) => {
    try {
      const cfg = await configuracao.carregar(createApiClient(req));
      res.json({
        parcela_minima: parcelaMinima.minimoDe(cfg),
        sql_pronto: Boolean(cfg && Object.prototype.hasOwnProperty.call(cfg, 'parcela_minima'))
      });
    } catch (err) {
      responder(res, err, 'GET /api/cobranca/parcela-minima');
    }
  });

  router.put('/configuracao/parcela', exigirPermissao('financeiro.parcela.editar'), async (req, res) => {
    try {
      const api = createApiClient(req);
      const bruto = String(req.body?.parcela_minima ?? '').trim().replace(/\s|R\$/g, '');
      const numero = Number(bruto.includes(',') ? bruto.replace(/\./g, '').replace(',', '.') : bruto);
      if (!bruto || !Number.isFinite(numero) || numero < 0 || numero > 1000000) throw erro('Informe a parcela mínima em reais (de 0 a 1.000.000).');
      const atual = await configuracao.carregar(api, { forcar: true });
      if (!atual) throw erro('Configuração de cobrança ainda não cadastrada (rode sql/cobranca_base.sql).', 409);
      if (!Object.prototype.hasOwnProperty.call(atual, 'parcela_minima')) throw erro(SQL_PARCELA, 409, { sql_pendente: true });
      const valor = Math.round(numero * 100) / 100;
      await configuracao.gravar(api, { parcela_minima: valor }, usuarioDaRequisicao(req));
      res.json({ parcela_minima: valor });
    } catch (err) {
      responder(res, err, 'PUT /api/cobranca/configuracao/parcela');
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
      pode_gerar: !pendencias.length && !pendenciasPagador.length && linhas.some(l => !l.tem_boleto_vivo && !l.boleto_externo) && String(dados.pedido.situacao || '').toLowerCase() !== 'cancelado',
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

  // --------------------------------------- boletos emitidos FORA do sistema
  // Só os dados (fiscal/externas.js), pela linha digitável de cada parcela.
  // Não passam pelo BB. Quem pode gerar boletos informa.

  /** A parcela já tem boleto do BB que vale? Então não recebe um de fora. */
  async function ocupadaPeloBB(api, pedidoId) {
    const dados = await boletos.lerPedidoCobranca(api, pedidoId);
    return parcela => boletos.ocupaParcela(boletos.boletoDaParcela(dados.boletos, parcela));
  }

  /** Confere sem gravar: `linhas: [{ parcela_id, linha }]`, cada parcela com o seu resultado. */
  router.post('/pedidos/:id/boletos-externos/previa', exigirPermissao('financeiro.boleto.emit'), async (req, res) => {
    try {
      const api = createApiClient(req);
      res.json(await externas.informarBoletos({
        api, pedidoId: req.params.id, linhas: req.body?.linhas, apenasPrevia: true, hoje: hojeEmBrasilia(), ocupadaPeloBB: await ocupadaPeloBB(api, req.params.id)
      }));
    } catch (err) {
      responder(res, err, 'POST /api/cobranca/pedidos/:id/boletos-externos/previa');
    }
  });

  router.post('/pedidos/:id/boletos-externos', exigirPermissao('financeiro.boleto.emit'), async (req, res) => {
    try {
      const api = createApiClient(req);
      res.json(await externas.informarBoletos({
        api, pedidoId: req.params.id, linhas: req.body?.linhas, usuarioId: usuarioDaRequisicao(req), hoje: hojeEmBrasilia(), ocupadaPeloBB: await ocupadaPeloBB(api, req.params.id)
      }));
    } catch (err) {
      responder(res, err, 'POST /api/cobranca/pedidos/:id/boletos-externos');
    }
  });

  /** Tira um boleto de fora (só desliga; fica o rastro de quem tirou). */
  router.delete('/boletos-externos/:id', exigirPermissao('financeiro.boleto.emit'), async (req, res) => {
    try {
      res.json(await externas.removerBoleto({ api: createApiClient(req), id: req.params.id, usuarioId: usuarioDaRequisicao(req) }));
    } catch (err) {
      responder(res, err, 'DELETE /api/cobranca/boletos-externos/:id');
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

  // ------------------------------------- alterações e baixa (fase D)
  // Cada boleto fala com o ambiente em que foi registrado; um de produção
  // só é mexido quando a produção vale (configuração e máquina).

  async function conexaoDoAmbiente(api, cfg, ambienteDoBoleto) {
    if (!cfg) throw erro('Configuração de cobrança ainda não cadastrada (rode sql/cobranca_base.sql).', 409);
    const ambiente = ambienteDoBoleto === configuracao.PRODUCAO ? configuracao.PRODUCAO : configuracao.SANDBOX;
    if (ambiente === configuracao.PRODUCAO && configuracao.ambienteEfetivo(cfg, env) !== configuracao.PRODUCAO) {
      throw erro('Este boleto é de produção, mas a cobrança está em homologação (na configuração ou nesta máquina).', 409);
    }
    const c = configuracao.credenciais(cfg, ambiente);
    const f = await fonteDoSecret(api, ambiente);
    const faltas = configuracao.pendencias(cfg, ambiente, { secret: Boolean(f.secret) });
    if (faltas.length) throw erro(`A cobrança não está pronta: ${faltas.join('; ')}.`, 409, { pendencias: faltas });
    return { ambiente, appKey: c.appKey, credenciais: { clientId: c.clientId, clientSecret: f.secret } };
  }

  /**
   * O abatimento não pode deixar o boleto abaixo da parcela mínima — salvo a
   * parcela única ou a primeira à vista (prazo 0).
   */
  async function conferirParcelaMinimaDoAbatimento({ api, boleto, cfg }, valor) {
    const minimo = parcelaMinima.minimoDe(cfg);
    if (!(minimo > 0)) return;
    const dados = await boletos.lerPedidoCobranca(api, boleto.pedido_id);
    const vivas = dados.parcelas.filter(p => Number(p.valor) > 0);
    const recusa = parcelaMinima.recusaDoAbatimento({
      valorBoleto: boleto.valor, abatimento: valor, numeroParcela: boleto.numero_parcela,
      totalParcelas: vivas.length, prazoDaPrimeira: parcelaMinima.prazosDoTexto(dados.pedido.prazo)[0] ?? null, minimo
    });
    if (recusa) throw erro(recusa, 409);
  }

  /**
   * O boleto novo de uma reemissão: no ambiente que vale agora, para a mesma
   * parcela, com o vencimento escolhido (e o valor que a parcela tem hoje).
   */
  function registrarNovoCom({ api, cfg, usuarioId, hoje }) {
    return async ({ vencimento, substitui }) => {
      const dados = await boletos.lerPedidoCobranca(api, substitui.pedido_id);
      const parcela = dados.parcelas.find(p => Number(p.id) === Number(substitui.parcela_id))
        || dados.parcelas.find(p => Number(p.numero_parcela) === Number(substitui.numero_parcela));
      if (!parcela) throw erro('a parcela deste boleto não existe mais no pedido', 409);
      const nova = await conexaoDoAmbiente(api, cfg, configuracao.ambienteEfetivo(cfg, env));
      return boletos.registrar({
        api, pedidoId: substitui.pedido_id, parcelaIds: [parcela.id], notaFiscalId: substitui.nota_fiscal_id ?? null,
        vencimentos: { [parcela.id]: vencimento }, substituiBoletoId: substitui.id,
        bb: cliente, credenciais: nova.credenciais, appKey: nova.appKey, ambiente: nova.ambiente, cfg, usuarioId, hoje
      });
    };
  }

  /** Lê o boleto e a configuração, confere o SQL da fase e o ambiente, roda `fn` e devolve o boleto enxuto com as ações. */
  async function operar(req, res, contexto, fn) {
    try {
      const api = createApiClient(req);
      const [boleto, cfg] = await Promise.all([boletos.ler(api, req.params.id), configuracao.carregar(api, { forcar: true })]);
      operacoes.exigirSql(boleto);
      const conexao = await conexaoDoAmbiente(api, cfg, boleto.ambiente);
      const r = await fn({ api, bb: cliente, boleto, cfg, conexao, hoje: hojeEmBrasilia(), usuarioId: usuarioDaRequisicao(req) });
      const { lido, ...resto } = r;
      res.json({ ...resto, boleto: boletos.enxuto(r.boleto), acoes: operacoes.acoesDoBoleto(r.boleto), avisos: r.avisos || [] });
    } catch (err) {
      responder(res, err, contexto);
    }
  }

  router.get('/boletos/:id/historico', exigirPermissao('financeiro.boleto.view'), async (req, res) => {
    try {
      const api = createApiClient(req);
      const boleto = await boletos.ler(api, req.params.id);
      res.json({
        boleto: boletos.enxuto(boleto),
        eventos: await operacoes.historico(api, boleto),
        acoes: operacoes.acoesDoBoleto(boleto),
        sql_pronto: operacoes.sqlPronto(boleto),
        motivos: operacoes.MOTIVOS_BAIXA,
        formas_recebimento: operacoes.FORMAS_RECEBIMENTO,
        hoje: hojeEmBrasilia()
      });
    } catch (err) {
      responder(res, err, 'GET /api/cobranca/boletos/:id/historico');
    }
  });

  router.post('/boletos/:id/sincronizar', exigirPermissao('financeiro.boleto.view'), (req, res) => operar(req, res, 'POST /api/cobranca/boletos/:id/sincronizar',
    ctx => operacoes.sincronizar(ctx)));

  router.post('/boletos/:id/prorrogar', exigirPermissao('financeiro.boleto.baixa'), (req, res) => operar(req, res, 'POST /api/cobranca/boletos/:id/prorrogar',
    ctx => operacoes.prorrogar({ ...ctx, novaData: String(req.body?.data_vencimento || '').slice(0, 10) })));

  router.post('/boletos/:id/abatimento', exigirPermissao('financeiro.boleto.baixa'), (req, res) => operar(req, res, 'POST /api/cobranca/boletos/:id/abatimento',
    async ctx => {
      await conferirParcelaMinimaDoAbatimento(ctx, req.body?.valor);
      return operacoes.concederAbatimento({ ...ctx, valor: req.body?.valor });
    }));

  /** Baixa; a reemissão também registra um boleto novo, então pede as duas permissões. */
  const permissaoDaBaixa = req => (req.body?.motivo === 'reemissao' ? ['financeiro.boleto.baixa', 'financeiro.boleto.emit'] : 'financeiro.boleto.baixa');
  router.post('/boletos/:id/baixar', exigirPermissao(permissaoDaBaixa), (req, res) => operar(req, res, 'POST /api/cobranca/boletos/:id/baixar',
    ctx => operacoes.baixar({
      ...ctx,
      entrada: req.body || {},
      // O boleto novo sai no ambiente que vale agora, para a mesma parcela, com o vencimento escolhido.
      registrarNovo: registrarNovoCom(ctx)
    })));

  router.post('/pedidos/:id/boletos/sincronizar', exigirPermissao('financeiro.boleto.view'), async (req, res) => {
    try {
      const api = createApiClient(req);
      const cfg = await configuracao.carregar(api, { forcar: true });
      // Uma conexão por ambiente na mesma consulta (a recusa vale para todos os boletos dele).
      const conexoes = new Map();
      const conexao = ambiente => {
        if (!conexoes.has(ambiente)) conexoes.set(ambiente, conexaoDoAmbiente(api, cfg, ambiente));
        return conexoes.get(ambiente);
      };
      res.json(await operacoes.sincronizarPedido({ api, bb: cliente, conexao, pedidoId: req.params.id, cfg, hoje: hojeEmBrasilia(), usuarioId: usuarioDaRequisicao(req) }));
    } catch (err) {
      responder(res, err, 'POST /api/cobranca/pedidos/:id/boletos/sincronizar');
    }
  });

  // ----------------------------------- recebimentos e conciliação (fase E)

  /** Conexões por ambiente numa mesma operação (a recusa vale para todos os boletos dele). */
  function conexoesDe(api, cfg) {
    const cache = new Map();
    return ambiente => {
      if (!cache.has(ambiente)) cache.set(ambiente, conexaoDoAmbiente(api, cfg, ambiente));
      return cache.get(ambiente);
    };
  }

  router.get('/recebimentos/painel', exigirPermissao('financeiro.recebimento.view'), async (req, res) => {
    try {
      const api = createApiClient(req);
      const cfg = await configuracao.carregar(api);
      res.json(await contasReceber.carregarPainel({ api, competencia: req.query?.competencia, hoje: hojeEmBrasilia(), desde: cfg?.recebimentos_desde || null }));
    } catch (err) {
      responder(res, err, 'GET /api/cobranca/recebimentos/painel');
    }
  });

  router.get('/recebimentos', exigirPermissao('financeiro.recebimento.view'), async (req, res) => {
    try {
      const api = createApiClient(req);
      const cfg = await configuracao.carregar(api);
      res.json(await contasReceber.carregarVisao({
        api, competencia: req.query?.competencia, visao: String(req.query?.visao || 'recebidos'), hoje: hojeEmBrasilia(), desde: cfg?.recebimentos_desde || null
      }));
    } catch (err) {
      responder(res, err, 'GET /api/cobranca/recebimentos');
    }
  });

  /**
   * Recebimento à mão. Parcela com boleto em aberto: sem `baixar_boleto` a
   * resposta é 409 com `boleto_em_aberto` (a tela pergunta); com ele, o
   * boleto é baixado no BB como quitado por fora, o que lança o recebimento.
   */
  const permissaoDoRecebimento = req => (req.body?.baixar_boleto === true
    ? ['financeiro.recebimento.registrar', 'financeiro.boleto.baixa']
    : 'financeiro.recebimento.registrar');
  router.post('/recebimentos', exigirPermissao(permissaoDoRecebimento), async (req, res) => {
    try {
      const api = createApiClient(req);
      const hoje = hojeEmBrasilia();
      const usuarioId = usuarioDaRequisicao(req);
      const entrada = req.body || {};
      try {
        const recebimento = await recebimentos.registrarManual({ api, entrada, usuarioId, hoje });
        res.json({ recebimento, boleto: null, avisos: [] });
        return;
      } catch (e) {
        const aberto = e?.extra?.boleto_em_aberto;
        if (!aberto || entrada.baixar_boleto !== true) throw e;
        const v = recebimentos.validarManual(entrada, hoje);
        const [boleto, cfg] = await Promise.all([boletos.ler(api, aberto.id), configuracao.carregar(api, { forcar: true })]);
        operacoes.exigirSql(boleto);
        const conexao = await conexaoDoAmbiente(api, cfg, boleto.ambiente);
        const r = await operacoes.baixar({
          api, bb: cliente, conexao, boleto, hoje, usuarioId,
          entrada: { motivo: 'quitado_por_fora', data_recebimento: v.data, valor_recebido: v.valor, forma: v.forma, observacao: v.observacao || 'Registrado pelo Financeiro.' }
        });
        res.json({ recebimento: r.recebimento?.recebimento || null, boleto: boletos.enxuto(r.boleto), avisos: r.avisos || [] });
      }
    } catch (err) {
      responder(res, err, 'POST /api/cobranca/recebimentos');
    }
  });

  router.post('/recebimentos/:id/estornar', exigirPermissao('financeiro.recebimento.estornar'), async (req, res) => {
    try {
      const api = createApiClient(req);
      res.json({ recebimento: await recebimentos.estornar({ api, id: req.params.id, motivo: req.body?.motivo, usuarioId: usuarioDaRequisicao(req) }) });
    } catch (err) {
      responder(res, err, 'POST /api/cobranca/recebimentos/:id/estornar');
    }
  });

  /** A conciliação inteira com as peças deste router (a agenda automática usa a mesma). */
  function conciliarCom({ api, cfg, usuarioId = null, soFila = false }) {
    return conciliacao.conciliar({ api, bb: cliente, conexao: conexoesDe(api, cfg), cfg, hoje: hojeEmBrasilia(), usuarioId, soFila });
  }
  router.conciliarEmSegundoPlano = conciliarCom;

  /**
   * Para a devolução de pedidos (backend/devolucoes): o que uma operação de UM boleto precisa — o
   * cliente do BB, a configuração e a conexão do ambiente dele —, com o cofre e o banco deste módulo.
   */
  router.contextoDoBoleto = async (api, boleto, { usuarioId = null, hoje = hojeEmBrasilia() } = {}) => {
    operacoes.exigirSql(boleto);
    const cfg = await configuracao.carregar(api, { forcar: true });
    const conexao = await conexaoDoAmbiente(api, cfg, boleto.ambiente);
    // A reemissão da devolução (parcela que cresceu) registra o boleto novo por aqui.
    return { bb: cliente, cfg, conexao, registrarNovo: registrarNovoCom({ api, cfg, usuarioId, hoje }) };
  };

  router.post('/conciliar', exigirPermissao('financeiro.recebimento.view'), async (req, res) => {
    try {
      const api = createApiClient(req);
      const cfg = await configuracao.carregar(api, { forcar: true });
      const usuarioId = usuarioDaRequisicao(req);
      const soFila = req.body?.so_fila === true;
      // A conciliação pelo botão também fica no registro (sem a tabela da fase F, segue sem registrar).
      const execucao = soFila ? null : await execucoes.iniciar(api, {
        tipo: 'conciliacao_manual', chave: `manual:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, maquina: os.hostname(), usuarioId
      }).catch(() => null);
      try {
        const resultado = await conciliarCom({ api, cfg, usuarioId, soFila });
        if (execucao?.id) await execucoes.concluir(api, execucao, { resultado }).catch(() => {});
        res.json(resultado);
      } catch (e) {
        if (execucao?.id) await execucoes.concluir(api, execucao, { erro: e.message }).catch(() => {});
        throw e;
      }
    } catch (err) {
      responder(res, err, 'POST /api/cobranca/conciliar');
    }
  });

  /** O webhook e a agenda para a Configuração de cobrança (nunca traz o token: ele só existe no .env da API). */
  router.get('/webhook/estado', exigirPermissao('financeiro.config.view'), async (req, res) => {
    try {
      const api = createApiClient(req);
      const [cfg, eventos, execs] = await Promise.all([
        configuracao.carregar(api, { forcar: true }),
        api.get('/api/boletos_eventos', { query: { origem: 'webhook' } }).catch(() => []),
        execucoes.recentes(api, 10)
      ]);
      res.json(webhookEstado.montar({ cfg, eventos: Array.isArray(eventos) ? eventos : [], execucoes: execs, env }));
    } catch (err) {
      responder(res, err, 'GET /api/cobranca/webhook/estado');
    }
  });

  return router;
}

const router = criarRouter();
module.exports = router;
module.exports.criarRouter = criarRouter;
module.exports.usuarioDaRequisicao = usuarioDaRequisicao;

/**
 * `module.exports` É o router: o que `criarRouter` pendurou nele já sai daqui —
 *   `conciliarEmSegundoPlano` (a agenda automática da fase F) e
 *   `contextoDoBoleto`      (o BB da devolução: abatimento, baixa, reemissão).
 *
 * NÃO reatribuir essas chaves com um repasse (`module.exports.x = (...) => router.x(...)`):
 * como os dois objetos são o MESMO, a atribuição troca a função original por uma
 * que chama a si mesma, e a primeira chamada estoura a pilha ("Maximum call stack
 * size exceeded" — era o que aparecia na pendência da devolução).
 */
