/**
 * Rotas fiscais: configuração do emitente, certificado e ligação com a SEFAZ.
 *
 * Tudo que fala com a SEFAZ sai daqui, do backend. O renderer só vê resumos:
 * o certificado aparece como titular/CNPJ/validade, nunca como chave ou senha.
 *
 * Permissões:
 *   - ver a configuração e testar a SEFAZ ..... financeiro.config.view
 *   - mudar a configuração e o certificado ..... Sup Admin, sem permissão
 *     concedível de propósito (é o mesmo raciocínio da configuração da IA).
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const { createApiClient } = require('./apiHttpClient');
const { exigirPermissao, exigirSupAdmin, ehSupAdmin } = require('./permissionsController');
const configuracao = require('./fiscal/configuracaoFiscal');
const certificado = require('./fiscal/certificado');
const segredoLocal = require('./fiscal/segredoLocal');
const sefaz = require('./fiscal/sefazCliente');
const municipios = require('./fiscal/municipios');
const prontidao = require('./fiscal/prontidao');
const emissao = require('./fiscal/emissao');
const { version: VERSAO_APP } = require('../package.json');

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
  // `extra` leva o que a tela precisa além da mensagem (pendências, a nota, o cStat).
  res.status(status).json({ error: err?.message || 'Erro interno no módulo fiscal', ...(err?.extra || {}) });
}

/**
 * `segredo`, `transporteFabrica` e `env` são injetáveis para os testes; o app
 * usa o cofre do Electron, o https com o certificado e o process.env.
 */
function criarRouter({ segredo = null, transporteFabrica = sefaz.transporteHttps, env = process.env, municipiosRede = undefined } = {}) {
  const router = express.Router();
  const cofre = segredo || segredoLocal.criar();

  // O .pfx é aberto uma vez por arquivo: abrir PKCS#12 custa e a chave não
  // muda entre uma chamada e outra. Trocar o arquivo invalida pelo mtime.
  let certificadoAberto = { chave: null, dados: null };

  function carregarCertificado() {
    const fonte = cofre.fonte();
    if (!fonte) throw erro('Nenhum certificado digital configurado neste computador.', 409);
    if (fonte.erro) throw erro(fonte.erro, 409);
    let stat;
    try {
      stat = fs.statSync(fonte.caminho);
    } catch (_) {
      throw erro('O arquivo do certificado não foi encontrado neste computador.', 409);
    }
    const chave = `${fonte.caminho}|${stat.mtimeMs}|${stat.size}`;
    if (certificadoAberto.chave !== chave) {
      const dados = certificado.abrirPfx(fs.readFileSync(fonte.caminho), fonte.senha);
      certificadoAberto = { chave, dados: { ...dados, origem: fonte.origem, guardadoEm: fonte.guardadoEm || null } };
    }
    return certificadoAberto.dados;
  }

  /** Resumo para a tela: nunca lança; o erro vira texto. */
  function resumoDoCertificado(cfg) {
    try {
      const dados = carregarCertificado();
      const r = certificado.resumo(dados);
      return {
        ...r,
        origem: dados.origem,
        guardadoEm: dados.guardadoEm,
        // O certificado tem de ser do emitente: um e-CNPJ de outra empresa
        // assina, a SEFAZ aceita a conexão e rejeita a nota (cStat 203/280).
        confereComEmitente: !cfg?.cnpj || !r.cnpj ? null : String(cfg.cnpj) === String(r.cnpj)
      };
    } catch (e) {
      return { configurado: false, erro: e.message };
    }
  }

  /** Rede com o certificado deste computador (e a cadeia ICP-Brasil do .env, se houver). */
  function transporteDoCertificado(dados) {
    return transporteFabrica({
      chavePrivadaPem: dados.chavePrivadaPem,
      certificadoPem: dados.certificadoPem,
      cadeiaPem: dados.cadeiaPem,
      ...(env.NFE_CA_PATH ? { ca: fs.readFileSync(env.NFE_CA_PATH) } : {})
    });
  }

  async function montarEstado(req, api) {
    const cfg = await configuracao.carregar(api, { forcar: true });
    const ambiente = configuracao.ambienteEfetivo(cfg, env);
    return {
      configuracao: cfg,
      ambiente,
      ambiente_no_banco: cfg?.ambiente || configuracao.HOMOLOGACAO,
      travado_em_homologacao_nesta_maquina: String(env.NFE_AMBIENTE || '').toLowerCase() === configuracao.HOMOLOGACAO,
      numeracao: configuracao.numeracao(cfg, ambiente),
      pendencias: configuracao.pendencias(cfg),
      certificado: resumoDoCertificado(cfg),
      cofre_disponivel: cofre.temCofre,
      pode_editar: await ehSupAdmin(req)
    };
  }

  router.get('/configuracao', exigirPermissao('financeiro.config.view'), async (req, res) => {
    try {
      res.json(await montarEstado(req, createApiClient(req)));
    } catch (err) {
      responder(res, err, 'GET /api/fiscal/configuracao');
    }
  });

  router.put('/configuracao', exigirSupAdmin, async (req, res) => {
    try {
      const api = createApiClient(req);
      const { confirmacao, ...entrada } = req.body || {};
      const { valores, erros } = configuracao.validar(entrada);
      if (erros.length) throw erro(erros.join(' | '));
      if (!Object.keys(valores).length) throw erro('Nada para salvar.');

      // Ligar a produção é o passo que passa a emitir nota com valor fiscal.
      // A tela pede a palavra de confirmação; aqui ela é exigida de novo,
      // porque a trava que vale é a do servidor.
      const atual = await configuracao.carregar(api, { forcar: true });
      if (valores.ambiente === configuracao.PRODUCAO && atual?.ambiente !== configuracao.PRODUCAO
        && String(confirmacao || '').trim().toUpperCase() !== 'PRODUCAO') {
        throw erro('Para ligar a produção, confirme digitando PRODUCAO.');
      }

      await configuracao.gravar(api, valores, usuarioDaRequisicao(req));
      res.json(await montarEstado(req, api));
    } catch (err) {
      responder(res, err, 'PUT /api/fiscal/configuracao');
    }
  });

  /** Guarda o .pfx escolhido na tela e a senha (cifrada) neste computador. */
  router.post('/certificado', exigirSupAdmin, async (req, res) => {
    try {
      const caminho = String(req.body?.caminho || '').trim();
      const senha = String(req.body?.senha ?? '');
      if (!caminho) throw erro('Escolha o arquivo do certificado (.pfx).');
      if (!/\.(pfx|p12)$/i.test(caminho)) throw erro('O certificado precisa ser um arquivo .pfx ou .p12.');
      if (!fs.existsSync(caminho)) throw erro('O arquivo do certificado não foi encontrado.');

      const dados = cofre.guardar({ caminhoOrigem: path.resolve(caminho), senha, validar: certificado.abrirPfx });
      certificadoAberto = { chave: null, dados: null };

      const api = createApiClient(req);
      const cfg = await configuracao.carregar(api, { forcar: true });
      const r = certificado.resumo(dados);
      res.json({
        ...r,
        origem: 'arquivo',
        confereComEmitente: !cfg?.cnpj || !r.cnpj ? null : String(cfg.cnpj) === String(r.cnpj)
      });
    } catch (err) {
      responder(res, err, 'POST /api/fiscal/certificado');
    }
  });

  router.delete('/certificado', exigirSupAdmin, async (req, res) => {
    try {
      cofre.remover();
      certificadoAberto = { chave: null, dados: null };
      res.json({ configurado: false });
    } catch (err) {
      responder(res, err, 'DELETE /api/fiscal/certificado');
    }
  });

  /**
   * Status do Serviço da SEFAZ: prova certificado, TLS e endereço. POST porque
   * sai para fora — um GET seria pré-buscável pelo navegador.
   */
  router.post('/sefaz/status', exigirPermissao('financeiro.config.view'), async (req, res) => {
    try {
      const api = createApiClient(req);
      const cfg = await configuracao.carregar(api);
      const efetivo = configuracao.ambienteEfetivo(cfg, env);
      // Testar homologação é sempre permitido; produção só quando ela vale.
      const pedido = String(req.body?.ambiente || efetivo).toLowerCase();
      const ambiente = pedido === configuracao.PRODUCAO && efetivo === configuracao.PRODUCAO
        ? configuracao.PRODUCAO
        : configuracao.HOMOLOGACAO;

      const dados = carregarCertificado();
      const transporte = transporteDoCertificado(dados);
      const resultado = await sefaz.statusServico({ uf: cfg?.uf || 'MG', ambiente, transporte });
      res.json({ ...resultado, certificado: certificado.resumo(dados) });
    } catch (err) {
      responder(res, err, 'POST /api/fiscal/sefaz/status');
    }
  });

  /**
   * Código IBGE pelo nome da cidade e do estado (nome ou sigla). Usado pelo
   * cadastro de clientes; a permissão é a de ver clientes.
   */
  router.get('/municipios', exigirPermissao('cli.view'), async (req, res) => {
    try {
      const uf = municipios.siglaDaUf(req.query?.uf);
      if (!uf) throw erro('Informe o estado (sigla ou nome).');
      const nome = String(req.query?.nome || '').trim();
      const opcoes = municipiosRede ? { buscarNaRede: municipiosRede } : undefined;
      const r = await municipios.buscar(uf, nome, opcoes);
      res.json({ uf, ...r });
    } catch (err) {
      responder(res, err, 'GET /api/fiscal/municipios');
    }
  });

  /** O que falta para faturar o pedido — lê tudo e avalia com prontidao.js. */
  router.get('/pedidos/:id/prontidao', exigirPermissao('financeiro.nfe.view'), async (req, res) => {
    try {
      const api = createApiClient(req);
      const dados = await emissao.lerPedidoFiscal(api, req.params.id);
      res.json({
        ...prontidao.avaliar({ ...dados, certificado: resumoDoCertificado(dados.configuracao) }),
        // A tela de embarque precisa saber em que ambiente a nota sairá e o que já existe.
        ambiente: configuracao.ambienteEfetivo(dados.configuracao, env),
        notas: dados.notas.map(emissao.semXml)
      });
    } catch (err) {
      responder(res, err, 'GET /api/fiscal/pedidos/:id/prontidao');
    }
  });

  /**
   * Emite a NF-e do pedido (monta, assina, envia e grava). Produção só quando
   * ela é o ambiente efetivo; pedir "homologacao" é sempre permitido (teste).
   * Rejeição da SEFAZ volta como 422 com o cStat e o motivo.
   */
  router.post('/pedidos/:id/emitir', exigirPermissao('financeiro.nfe.emit'), async (req, res) => {
    try {
      const api = createApiClient(req);
      const cfg = await configuracao.carregar(api, { forcar: true });
      const dados = carregarCertificado();
      const resultado = await emissao.emitir({
        api,
        pedidoId: req.params.id,
        entrada: req.body || {},
        certificado: dados,
        resumoCertificado: resumoDoCertificado(cfg),
        transporte: transporteDoCertificado(dados),
        env,
        usuarioId: usuarioDaRequisicao(req),
        opcoesMunicipios: municipiosRede ? { buscarNaRede: municipiosRede } : undefined,
        // verProc tem 20 caracteres no leiaute.
        verProc: `Santissimo ${VERSAO_APP}`
      });
      res.json(resultado);
    } catch (err) {
      responder(res, err, 'POST /api/fiscal/pedidos/:id/emitir');
    }
  });

  /** Notas de um pedido (ou todas), sem os XMLs. */
  router.get('/notas', exigirPermissao('financeiro.nfe.view'), async (req, res) => {
    try {
      res.json(await emissao.listarNotas(createApiClient(req), { pedido_id: req.query?.pedido_id }));
    } catch (err) {
      responder(res, err, 'GET /api/fiscal/notas');
    }
  });

  /** Uma nota completa, com os XMLs (para DANFE, download e conferência). */
  router.get('/notas/:id', exigirPermissao('financeiro.nfe.view'), async (req, res) => {
    try {
      res.json(await emissao.lerNota(createApiClient(req), req.params.id));
    } catch (err) {
      responder(res, err, 'GET /api/fiscal/notas/:id');
    }
  });

  /** Pergunta à SEFAZ a situação da nota (recibo ou chave) e atualiza o banco. */
  router.post('/notas/:id/sincronizar', exigirPermissao('financeiro.nfe.view'), async (req, res) => {
    try {
      const dados = carregarCertificado();
      res.json(await emissao.sincronizar({
        api: createApiClient(req), notaId: req.params.id, transporte: transporteDoCertificado(dados), usuarioId: usuarioDaRequisicao(req)
      }));
    } catch (err) {
      responder(res, err, 'POST /api/fiscal/notas/:id/sincronizar');
    }
  });

  return router;
}

const router = criarRouter();
module.exports = router;
module.exports.criarRouter = criarRouter;
module.exports.usuarioDaRequisicao = usuarioDaRequisicao;
