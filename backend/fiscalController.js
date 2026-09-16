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
const eventos = require('./fiscal/eventos');
const danfe = require('./fiscal/danfe');
const email = require('./fiscal/email');
const segredoBanco = require('./fiscal/segredoBanco');
const cartaCorrecaoDoc = require('./fiscal/cartaCorrecaoDoc');
const painel = require('./fiscal/painel');
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
function criarRouter({ segredo = null, transporteFabrica = sefaz.transporteHttps, env = process.env, municipiosRede = undefined, criarTransporteEmail = undefined } = {}) {
  const router = express.Router();
  const cofre = segredo || segredoLocal.criar();
  // Segredos que valem para todas as máquinas: no banco, cifrados com a chave
  // mestra do .env. Sem a chave, vale só o cofre local desta máquina.
  const banco = segredoBanco.criar({ env });

  /**
   * A senha do SMTP, nesta ordem: banco (todas as máquinas) → cofre local →
   * NFE_SMTP_SENHA (DEV). Devolve { senha, origem, guardadaEm, erro }.
   */
  async function fonteDaSenhaDoEmail(api) {
    let avisoBanco = null;
    if (api) {
      const s = await banco.ler(api, 'smtp_senha').catch(() => null);
      if (s?.valor?.senha) return { senha: s.valor.senha, origem: 'banco', guardadaEm: s.atualizadoEm };
      if (s?.erro) avisoBanco = s.erro;
    }
    const guardada = typeof cofre.lerSegredo === 'function' ? cofre.lerSegredo('smtp') : null;
    if (guardada?.valor) return { senha: guardada.valor, origem: 'computador', guardadaEm: guardada.guardadoEm };
    if (env.NFE_SMTP_SENHA) return { senha: env.NFE_SMTP_SENHA, origem: 'env', guardadaEm: null };
    return { senha: null, origem: null, guardadaEm: null, erro: avisoBanco || guardada?.erro || null };
  }

  async function estadoDoEmail(api, cfg) {
    const f = await fonteDaSenhaDoEmail(api);
    return {
      senha_guardada: Boolean(f.senha),
      origem: f.origem,
      guardada_em: f.guardadaEm || null,
      erro: f.erro || null,
      pendencias: email.pendenciasDeEmail(cfg, f.senha)
    };
  }

  // O .pfx é aberto uma vez por arquivo: abrir PKCS#12 custa e a chave não
  // muda entre uma chamada e outra. Trocar o arquivo invalida pelo mtime.
  let certificadoAberto = { chave: null, dados: null };

  /**
   * O certificado, nesta ordem: banco (cifrado, vale para todas as máquinas)
   * → cofre local desta máquina → .env (DEV). Aberto uma vez por versão.
   */
  async function carregarCertificado(api) {
    let avisoBanco = null;
    if (api) {
      const s = await banco.ler(api, 'certificado').catch(() => null);
      if (s?.valor?.pfxBase64) {
        const chave = `banco|${s.atualizadoEm}|${s.valor.pfxBase64.length}`;
        if (certificadoAberto.chave !== chave) {
          const dados = certificado.abrirPfx(Buffer.from(s.valor.pfxBase64, 'base64'), s.valor.senha ?? '');
          certificadoAberto = { chave, dados: { ...dados, origem: 'banco', guardadoEm: s.atualizadoEm || null, nomeArquivo: s.valor.nomeArquivo || null } };
        }
        return certificadoAberto.dados;
      }
      if (s?.erro) avisoBanco = s.erro;
    }
    const fonte = cofre.fonte();
    if (!fonte) throw erro(avisoBanco || 'Nenhum certificado digital configurado (nem no banco, nem neste computador).', 409);
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
  async function resumoDoCertificado(api, cfg) {
    try {
      const dados = await carregarCertificado(api);
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
      certificado: await resumoDoCertificado(api, cfg),
      email: await estadoDoEmail(api, cfg),
      cofre_disponivel: cofre.temCofre,
      banco_chave_mestra: banco.disponivel,
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

  /**
   * Guarda o .pfx escolhido na tela e a senha: no banco (cifrado, para todas
   * as máquinas — o padrão quando há chave mestra) ou só neste computador.
   */
  router.post('/certificado', exigirSupAdmin, async (req, res) => {
    try {
      const caminho = String(req.body?.caminho || '').trim();
      const senha = String(req.body?.senha ?? '');
      const destino = String(req.body?.destino || (banco.disponivel ? 'banco' : 'computador')).toLowerCase();
      if (!caminho) throw erro('Escolha o arquivo do certificado (.pfx).');
      if (!/\.(pfx|p12)$/i.test(caminho)) throw erro('O certificado precisa ser um arquivo .pfx ou .p12.');
      if (!fs.existsSync(caminho)) throw erro('O arquivo do certificado não foi encontrado.');
      if (!['banco', 'computador'].includes(destino)) throw erro('Destino inválido: banco ou computador.');

      const api = createApiClient(req);
      let dados;
      if (destino === 'banco') {
        if (!banco.disponivel) throw erro('Guardar no banco exige a chave mestra (SEGREDOS_CHAVE_MESTRA) no .env desta máquina.', 409);
        const conteudo = fs.readFileSync(path.resolve(caminho));
        dados = certificado.abrirPfx(conteudo, senha);
        await banco.guardar(api, 'certificado', { pfxBase64: conteudo.toString('base64'), senha, nomeArquivo: path.basename(caminho) },
          { descricao: 'Certificado A1 (.pfx) e senha', usuarioId: usuarioDaRequisicao(req) });
      } else {
        dados = cofre.guardar({ caminhoOrigem: path.resolve(caminho), senha, validar: certificado.abrirPfx });
      }
      certificadoAberto = { chave: null, dados: null };

      const cfg = await configuracao.carregar(api, { forcar: true });
      const r = certificado.resumo(dados);
      res.json({
        ...r,
        origem: destino === 'banco' ? 'banco' : 'arquivo',
        guardadoEm: new Date().toISOString(),
        confereComEmitente: !cfg?.cnpj || !r.cnpj ? null : String(cfg.cnpj) === String(r.cnpj)
      });
    } catch (err) {
      responder(res, err, 'POST /api/fiscal/certificado');
    }
  });

  /** Remove do banco, deste computador ou (sem `destino`) dos dois. */
  router.delete('/certificado', exigirSupAdmin, async (req, res) => {
    try {
      const destino = String(req.query?.destino || req.body?.destino || 'ambos').toLowerCase();
      if (destino === 'banco' || destino === 'ambos') await banco.remover(createApiClient(req), 'certificado').catch(() => {});
      if (destino === 'computador' || destino === 'ambos') cofre.remover();
      certificadoAberto = { chave: null, dados: null };
      const api = createApiClient(req);
      const cfg = await configuracao.carregar(api, { forcar: true });
      res.json(await resumoDoCertificado(api, cfg));
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

      const dados = await carregarCertificado(api);
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
        ...prontidao.avaliar({ ...dados, certificado: await resumoDoCertificado(api, dados.configuracao) }),
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
      const dados = await carregarCertificado(api);
      const resultado = await emissao.emitir({
        api,
        pedidoId: req.params.id,
        entrada: req.body || {},
        certificado: dados,
        resumoCertificado: await resumoDoCertificado(api, cfg),
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

  /**
   * O pedido foi (ou vai ser) enviado sem NF-e: fica sinalizado, com quando e
   * por quem. A permissão é a de despachar — é a mesma decisão.
   */
  router.post('/pedidos/:id/dispensar-nfe', exigirPermissao('ped.status.ship'), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) throw erro('Pedido inválido.');
      const api = createApiClient(req);
      const pedido = await api.get('/api/pedidos', { query: { id } }).then(r => (Array.isArray(r) ? r : [r]).find(p => Number(p?.id) === id) || null);
      if (!pedido) throw erro('Pedido não encontrado.', 404);
      const marca = { nfe_dispensada: true, nfe_dispensada_em: new Date().toISOString(), nfe_dispensada_por: usuarioDaRequisicao(req) };
      await api.put(`/api/pedidos/${id}`, marca);
      res.json({ ok: true, pedido_id: id, ...marca });
    } catch (err) {
      responder(res, err, 'POST /api/fiscal/pedidos/:id/dispensar-nfe');
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

  /**
   * Painel fiscal do Financeiro (?competencia=YYYY-MM): pedidos enviados sem
   * NF-e, notas da competência, pendências que exigem ação e atividade recente.
   */
  router.get('/painel', exigirPermissao('financeiro.nfe.view'), async (req, res) => {
    try {
      const api = createApiClient(req);
      const cfg = await configuracao.carregar(api);
      res.json(await painel.carregar({
        api,
        competencia: req.query?.competencia,
        certificado: await resumoDoCertificado(api, cfg),
        pendenciasConfiguracao: configuracao.pendencias(cfg),
        ambiente: configuracao.ambienteEfetivo(cfg, env)
      }));
    } catch (err) {
      responder(res, err, 'GET /api/fiscal/painel');
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

  /** DANFE em HTML (o renderer manda para o PDF pelo Electron). Só nota autorizada ou cancelada. */
  router.get('/notas/:id/danfe', exigirPermissao('financeiro.nfe.view'), async (req, res) => {
    try {
      const nota = await emissao.lerNota(createApiClient(req), req.params.id);
      if (!nota.xml_autorizado) throw erro('Esta nota não foi autorizada: não há DANFE.', 409);
      res.json({
        nome: `DANFE-NFe-${String(nota.serie)}-${String(nota.numero).padStart(9, '0')}`,
        html: danfe.montarDanfeHtml(nota.xml_autorizado, { cancelada: nota.status_fiscal === 'cancelada' }),
        nota: emissao.semXml(nota)
      });
    } catch (err) {
      responder(res, err, 'GET /api/fiscal/notas/:id/danfe');
    }
  });

  /** O XML de distribuição (nfeProc) e, se houver, o do cancelamento. */
  router.get('/notas/:id/xml', exigirPermissao('financeiro.nfe.view'), async (req, res) => {
    try {
      const nota = await emissao.lerNota(createApiClient(req), req.params.id);
      const xml = nota.xml_autorizado || nota.xml_envio;
      if (!xml) throw erro('Esta nota não tem XML guardado.', 409);
      res.json({
        nome: `${nota.chave_acesso || `NFe-${nota.serie}-${nota.numero}`}-procNFe`,
        xml,
        xml_cancelamento: nota.xml_cancelamento || null,
        nome_cancelamento: nota.xml_cancelamento ? `${nota.chave_acesso}-procEventoNFe-cancelamento` : null,
        autorizada: Boolean(nota.xml_autorizado)
      });
    } catch (err) {
      responder(res, err, 'GET /api/fiscal/notas/:id/xml');
    }
  });

  /** Cancela a NF-e na SEFAZ (evento 110111). Exige justificativa de 15 a 255 caracteres. */
  router.post('/notas/:id/cancelar', exigirPermissao('financeiro.nfe.cancel'), async (req, res) => {
    try {
      const api = createApiClient(req);
      const dados = await carregarCertificado(api);
      res.json(await eventos.cancelar({
        api, notaId: req.params.id, justificativa: req.body?.justificativa,
        certificado: dados, transporte: transporteDoCertificado(dados), usuarioId: usuarioDaRequisicao(req)
      }));
    } catch (err) {
      responder(res, err, 'POST /api/fiscal/notas/:id/cancelar');
    }
  });

  // ------------------------------------------------------------ e-mail

  /** Guarda a senha do SMTP: no banco (cifrada, todas as máquinas) ou só neste computador. */
  router.post('/email/senha', exigirSupAdmin, async (req, res) => {
    try {
      const senha = String(req.body?.senha ?? '');
      if (!senha) throw erro('Informe a senha do e-mail.');
      const destino = String(req.body?.destino || (banco.disponivel ? 'banco' : 'computador')).toLowerCase();
      const api = createApiClient(req);
      if (destino === 'banco') {
        await banco.guardar(api, 'smtp_senha', { senha }, { descricao: 'Senha do SMTP do e-mail da NF-e', usuarioId: usuarioDaRequisicao(req) });
      } else if (destino === 'computador') {
        if (typeof cofre.guardarSegredo !== 'function') throw erro('Cofre indisponível.', 500);
        cofre.guardarSegredo('smtp', senha);
      } else {
        throw erro('Destino inválido: banco ou computador.');
      }
      const cfg = await configuracao.carregar(api, { forcar: true });
      res.json(await estadoDoEmail(api, cfg));
    } catch (err) {
      responder(res, err, 'POST /api/fiscal/email/senha');
    }
  });

  router.delete('/email/senha', exigirSupAdmin, async (req, res) => {
    try {
      const destino = String(req.query?.destino || req.body?.destino || 'ambos').toLowerCase();
      const api = createApiClient(req);
      if (destino === 'banco' || destino === 'ambos') await banco.remover(api, 'smtp_senha').catch(() => {});
      if (destino === 'computador' || destino === 'ambos') cofre.removerSegredo?.('smtp');
      const cfg = await configuracao.carregar(api, { forcar: true });
      res.json(await estadoDoEmail(api, cfg));
    } catch (err) {
      responder(res, err, 'DELETE /api/fiscal/email/senha');
    }
  });

  /** Manda um e-mail de teste com a configuração atual. */
  router.post('/email/testar', exigirSupAdmin, async (req, res) => {
    try {
      const api = createApiClient(req);
      const cfg = await configuracao.carregar(api, { forcar: true });
      const r = await email.testar({ cfg, senha: (await fonteDaSenhaDoEmail(api)).senha, para: req.body?.para, ...(criarTransporteEmail ? { criarTransporte: criarTransporteEmail } : {}) });
      res.json({ ok: true, ...r });
    } catch (err) {
      responder(res, err, 'POST /api/fiscal/email/testar');
    }
  });

  /** Envia a NF-e (DANFE em PDF, gerado no app, + XML) para o cliente. */
  router.post('/notas/:id/email', exigirPermissao('financeiro.nfe.emit'), async (req, res) => {
    try {
      const api = createApiClient(req);
      const nota = await emissao.lerNota(api, req.params.id);
      const cfg = await configuracao.carregar(api);
      const r = await email.enviarNota({
        cfg, senha: (await fonteDaSenhaDoEmail(api)).senha, nota, para: req.body?.para, mensagem: req.body?.mensagem, pdfBase64: req.body?.pdf_base64,
        incluirXml: req.body?.incluir_xml !== false, ...(criarTransporteEmail ? { criarTransporte: criarTransporteEmail } : {})
      });
      await api.post('/api/notas_fiscais_eventos', {
        nota_fiscal_id: nota.id, tipo: 'email', status_anterior: nota.status_fiscal, status_novo: nota.status_fiscal,
        mensagem: `E-mail enviado para ${r.para.join(', ')}${r.cc.length ? ` (cópia: ${r.cc.join(', ')})` : ''}`,
        detalhe: { para: r.para, cc: r.cc, anexos: r.anexos, assunto: r.assunto }, usuario_id: usuarioDaRequisicao(req), criado_em: new Date().toISOString()
      }).catch(() => {});
      res.json({ ok: true, ...r });
    } catch (err) {
      responder(res, err, 'POST /api/fiscal/notas/:id/email');
    }
  });

  // --------------------------------------------- carta de correção / inutilização

  router.post('/notas/:id/carta-correcao', exigirPermissao('financeiro.nfe.emit'), async (req, res) => {
    try {
      const api = createApiClient(req);
      const dados = await carregarCertificado(api);
      res.json(await eventos.cartaCorrecao({
        api, notaId: req.params.id, correcao: req.body?.correcao, certificado: dados,
        transporte: transporteDoCertificado(dados), usuarioId: usuarioDaRequisicao(req)
      }));
    } catch (err) {
      responder(res, err, 'POST /api/fiscal/notas/:id/carta-correcao');
    }
  });

  /** As cartas de correção registradas da nota (sem XML). */
  router.get('/notas/:id/cartas-correcao', exigirPermissao('financeiro.nfe.view'), async (req, res) => {
    try {
      res.json(await eventos.listarCartasCorrecao(createApiClient(req), req.params.id));
    } catch (err) {
      responder(res, err, 'GET /api/fiscal/notas/:id/cartas-correcao');
    }
  });

  /** A carta em HTML (segunda via para o PDF) e o XML do evento. */
  router.get('/notas/:id/cartas-correcao/:seq/documento', exigirPermissao('financeiro.nfe.view'), async (req, res) => {
    try {
      const api = createApiClient(req);
      const nota = await emissao.lerNota(api, req.params.id);
      if (!nota.xml_autorizado) throw erro('A nota não tem o XML autorizado.', 409);
      const carta = await eventos.lerCartaCorrecao(api, nota.id, req.params.seq);
      res.json({
        nome: `CCe-${carta.nSeqEvento}-NFe-${nota.serie}-${String(nota.numero).padStart(9, '0')}`,
        html: cartaCorrecaoDoc.montarCartaCorrecaoHtml({ xmlNfeProc: nota.xml_autorizado, carta, cancelada: nota.status_fiscal === 'cancelada' }),
        carta: { ...carta, xml: undefined }
      });
    } catch (err) {
      responder(res, err, 'GET /api/fiscal/notas/:id/cartas-correcao/:seq/documento');
    }
  });

  router.get('/notas/:id/cartas-correcao/:seq/xml', exigirPermissao('financeiro.nfe.view'), async (req, res) => {
    try {
      const api = createApiClient(req);
      const nota = await emissao.lerNota(api, req.params.id);
      const carta = await eventos.lerCartaCorrecao(api, nota.id, req.params.seq);
      if (!carta.xml) throw erro('Esta carta não tem XML guardado.', 409);
      res.json({ nome: `${nota.chave_acesso}-procEventoNFe-cce-${carta.nSeqEvento}`, xml: carta.xml });
    } catch (err) {
      responder(res, err, 'GET /api/fiscal/notas/:id/cartas-correcao/:seq/xml');
    }
  });

  router.get('/inutilizacoes', exigirPermissao('financeiro.nfe.view'), async (req, res) => {
    try {
      res.json(await eventos.listarInutilizacoes(createApiClient(req)));
    } catch (err) {
      responder(res, err, 'GET /api/fiscal/inutilizacoes');
    }
  });

  router.post('/inutilizacoes', exigirPermissao('financeiro.nfe.cancel'), async (req, res) => {
    try {
      const api = createApiClient(req);
      const dados = await carregarCertificado(api);
      res.json(await eventos.inutilizar({
        api, entrada: req.body || {}, certificado: dados, transporte: transporteDoCertificado(dados), env, usuarioId: usuarioDaRequisicao(req)
      }));
    } catch (err) {
      responder(res, err, 'POST /api/fiscal/inutilizacoes');
    }
  });

  /** Pergunta à SEFAZ a situação da nota (recibo ou chave) e atualiza o banco. */
  router.post('/notas/:id/sincronizar', exigirPermissao('financeiro.nfe.view'), async (req, res) => {
    try {
      const api = createApiClient(req);
      const dados = await carregarCertificado(api);
      res.json(await emissao.sincronizar({
        api, notaId: req.params.id, transporte: transporteDoCertificado(dados), usuarioId: usuarioDaRequisicao(req)
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
