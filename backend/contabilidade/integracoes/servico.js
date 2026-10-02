/**
 * O serviço das integrações automáticas da Contabilidade: junta a
 * configuração (configuracao.js), os segredos e o certificado (segredos.js),
 * a rede (rede.js), os clientes de cada serviço (sefazDistribuicao.js,
 * bbExtrato.js, nfseAdn.js) e a caixa de entrada (entrada.js).
 *
 *   estado ........... tudo o que a tela de Configurações mostra (sem segredo);
 *   testar ........... prova a conexão sem gravar nada (fica no registro);
 *   sincronizar ...... a busca de verdade (pelo botão ou pela agenda);
 *   manifestar ....... ciência / confirmação / desconhecimento / não realizada;
 *   baixarXml ........ a NF-e completa pela chave (depois da ciência).
 *
 * SEGURANÇA DOS DADOS: em homologação, o que vem da SEFAZ, do ADN e do BB é
 * de teste. Só se grava no banco com o ambiente de PRODUÇÃO — ou no banco
 * DEV (BANCO=DEV), que é de teste também. Com o banco de produção em
 * homologação, a busca só conta o que acharia.
 *
 * SEFAZ: sem documento novo (cStat 137, ou ultNSU = maxNSU) a próxima
 * consulta só depois de 1 hora (NT 2014.002); consultar antes dá 656
 * (consumo indevido). A espera fica gravada e vale para o botão também.
 */
const fs = require('fs');
const c = require('../../financeiro/comum');
const b = require('../base');
const eventos = require('../eventos');
const extratoMod = require('../extrato/extrato');
const documentos = require('../documentosRecebidos');
const configuracaoFiscal = require('../../fiscal/configuracaoFiscal');
const certificadoMod = require('../../fiscal/certificado');
const assinatura = require('../../fiscal/assinatura');
const sefazCliente = require('../../fiscal/sefazCliente');
const xmlNfe = require('../../fiscal/xmlNfe');
const catalogo = require('./catalogo');
const configuracao = require('./configuracao');
const segredos = require('./segredos');
const rede = require('./rede');
const execucoes = require('./execucoes');
const entrada = require('./entrada');
const sefazDist = require('./sefazDistribuicao');
const bbExtrato = require('./bbExtrato');
const nfseAdn = require('./nfseAdn');

const LIMITE_LOTES = 20;
const LIMITE_MANIFESTACOES = 20;
const LIMITE_REGISTROS = 50;
const HORA_MS = 60 * 60 * 1000;

const vazio = v => v === null || v === undefined || v === '';
const somarDia = (iso, n) => {
  const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const t = new Date(Date.UTC(a, m - 1, d + n));
  return t.toISOString().slice(0, 10);
};
const menor = (x, y) => (x < y ? x : y);

/**
 * `env`, `cofre`, `banco` (segredos), `transporteFabrica(cert, opcoes)` e
 * `agora` são injetáveis para os testes; o app usa o cofre do Electron, o
 * process.env e o https de verdade.
 */
function criar({ env = process.env, cofre = null, banco = null, transporteFabrica = rede.transporteHttps, agora = () => Date.now() } = {}) {
  const seg = segredos.criar({ env, cofre, banco });

  const ca = () => (env.NFE_CA_PATH ? (() => { try { return fs.readFileSync(env.NFE_CA_PATH); } catch (_) { return null; } })() : null);
  const transporte = (cert, destino) => transporteFabrica(cert, { ca: ca(), destino });
  const podeGravar = ambiente => ambiente === catalogo.PRODUCAO || String(env.BANCO || '').toUpperCase() === 'DEV';
  const usaMtls = (def, params, ambiente) => catalogo.usaMtls(def, params, ambiente);
  const hojeBR = () => c.dia(b.instanteBR(new Date(agora())));

  /** Tudo o que uma operação precisa, e o que falta (com `exigirPronto`, falta = 409). */
  async function contexto(api, chave, { exigirPronto = true } = {}) {
    const def = catalogo.definicao(chave);
    const linhas = await configuracao.carregar(api);
    if (linhas === null) throw c.erro(b.SQL_FALTANDO_INTEGRACOES, 409, { sql_pendente: true, sql_arquivo: b.SQL_ARQUIVO_INTEGRACOES });
    const linha = linhas.get(chave) || null;
    const params = configuracao.parametros(def, linha);
    const ambiente = configuracao.ambienteEfetivo(def, linha, env);
    const fiscal = await configuracaoFiscal.carregar(api).catch(() => null);
    const precisaCert = def.usa.includes('certificado') || (def.usa.includes('credenciais_bb') && usaMtls(def, params, ambiente));
    let cert = null;
    let certResumo = null;
    if (precisaCert || def.usa.includes('certificado_opcional')) {
      try {
        cert = await seg.carregarCertificado(api);
        certResumo = certificadoMod.resumo(cert);
        certResumo.cnpj = cert.cnpj;
      } catch (e) {
        certResumo = { configurado: false, erro: e.message };
      }
    }
    const credenciais = def.usa.includes('credenciais_bb') ? await seg.credenciaisBB(api, def, params, ambiente) : null;
    const contas = chave === 'bb_extrato' ? ((await b.lerOpcional(api, 'contas_financeiras').catch(() => null)) || []) : [];
    const pendencias = configuracao.pendencias(def, {
      linha, params, ambiente, certificado: precisaCert ? certResumo : (certResumo || { configurado: true }), fiscal, credenciais, contas
    });
    if (exigirPronto && pendencias.length) throw c.erro(`Antes: ${pendencias.join(' ')}`, 409, { pendencias });
    return { def, linha, params, ambiente, fiscal, cert: precisaCert ? cert : null, certResumo, credenciais, contas, pendencias };
  }

  /** O registro da execução em volta de uma operação (erro fica registrado e segue para quem chamou). */
  async function registrada(api, { integracao, tipo, chave = null, usuarioId }, fn) {
    const execucao = await execucoes.iniciar(api, { integracao, tipo, chave, usuarioId }).catch(() => null);
    if (execucao?.ocupada) return { situacao: 'outra_maquina', resumo: 'Outra máquina já está fazendo esta busca.' };
    try {
      const r = await fn();
      await execucoes.concluir(api, execucao, { resumo: r?.resumo, resultado: r?.resultado || null });
      return r;
    } catch (e) {
      await execucoes.concluir(api, execucao, { erro: e.message });
      throw e;
    }
  }

  // ------------------------------------------------------------ estado (tela)

  async function estado(api) {
    const linhas = await configuracao.carregar(api);
    const fiscal = await configuracaoFiscal.carregar(api).catch(() => null);
    const certificado = await seg.resumoDoCertificado(api);
    const contas = (await b.lerOpcional(api, 'contas_financeiras').catch(() => null)) || [];
    const exec = linhas === null ? { linhas: [], sem_tabela: true } : await execucoes.recentes(api, { limite: 60 }).catch(() => ({ linhas: [] }));
    const caixa = linhas === null ? null : await entrada.listar(api, { visao: 'pendentes' }).catch(() => null);
    const integracoes = [];
    for (const chave of catalogo.CHAVES) {
      const def = catalogo.definicao(chave);
      const linha = linhas?.get(chave) || null;
      const ambiente = configuracao.ambienteEfetivo(def, linha, env);
      const publica = configuracao.linhaPublica(def, linha, { ambiente, travada: configuracao.travadaEmHomologacao(def, env) });
      let pendencias = ['Falta rodar sql/contabilidade_integracoes.sql e reiniciar a API.'];
      let credenciais = null;
      if (linhas !== null) {
        const ctx = await contexto(api, chave, { exigirPronto: false }).catch(e => ({ pendencias: [e.message] }));
        pendencias = ctx.pendencias || [];
        if (ctx.credenciais) {
          credenciais = {
            origem: ctx.credenciais.origem, client_id: ctx.credenciais.clientId, app_key: ctx.credenciais.appKey,
            secret_guardado: Boolean(ctx.credenciais.secret), secret_origem: ctx.credenciais.secretOrigem || null, secret_erro: ctx.credenciais.secretErro || null
          };
          // As credenciais próprias de cada ambiente (quando não usa as da cobrança).
          if (ctx.credenciais.origem === 'propria') {
            credenciais.ambientes = {};
            for (const amb of catalogo.AMBIENTES) {
              const s = await seg.lerSecret(api, def.segredo || chave, amb);
              credenciais.ambientes[amb] = { secret_guardado: Boolean(s.valor), origem: s.origem, guardado_em: s.guardadoEm || null, erro: s.erro || null };
            }
          }
        }
      }
      integracoes.push({
        ...publica, pendencias, pronta: pendencias.length === 0, credenciais,
        grava_no_banco: podeGravar(ambiente),
        execucoes: (exec.linhas || []).filter(x => x.integracao === chave).slice(0, 8)
      });
    }
    return {
      sql_pendente: linhas === null,
      certificado, fiscal: fiscal ? { cnpj: fiscal.cnpj || null, uf: fiscal.uf || null, razao_social: fiscal.razao_social || null } : null,
      contas: contas.map(extratoMod.contaPublica),
      banco_chave_mestra: seg.bancoDisponivel, cofre_disponivel: seg.cofreDisponivel, banco_dev: String(env.BANCO || '').toUpperCase() === 'DEV',
      caixa_de_entrada: caixa ? caixa.contagem : null,
      integracoes
    };
  }

  // ------------------------------------------------------------ gravação da configuração

  async function salvar(api, chave, entradaTela, { usuarioId = null } = {}) {
    const def = catalogo.definicao(chave);
    const linhas = await configuracao.carregar(api);
    if (linhas === null) throw c.erro(b.SQL_FALTANDO_INTEGRACOES, 409, { sql_pendente: true, sql_arquivo: b.SQL_ARQUIVO_INTEGRACOES });
    const { valores, erros } = configuracao.validar(def, entradaTela, linhas.get(chave));
    if (erros.length) throw c.erro(erros.join(' | '), 400);
    if (!Object.keys(valores).length) throw c.erro('Nada para salvar.');
    const linha = await configuracao.gravar(api, def, valores, usuarioId);
    const partes = [];
    if (valores.ativa !== undefined) partes.push(valores.ativa ? 'ligada' : 'desligada');
    if (valores.ambiente) partes.push(`ambiente ${valores.ambiente === catalogo.PRODUCAO ? 'produção' : 'homologação'}`);
    if (valores.automatica !== undefined) partes.push(`busca automática ${valores.automatica ? `a cada ${linha.intervalo_min} min` : 'desligada'}`);
    if (valores.parametros) partes.push('parâmetros');
    await eventos.registrar(api, { tipo: 'integracao_configurada', usuarioId, descricao: `${def.nome}: ${partes.join(', ') || 'configuração salva'}` });
    return linha;
  }

  // ------------------------------------------------------------ SEFAZ — NF-e de entrada

  /** A nota é de antes do mês anterior ao início e ainda não está na caixa? Então não entra. */
  const antigaDeFora = (indice, origem, chave, dataEmissao, primeira) =>
    entrada.faseDaNota(dataEmissao, primeira) === 'antes' && !indice.has(entrada.chaveDe(origem, chave));

  /**
   * Um documento da distribuição → a caixa de entrada. Devolve o que
   * aconteceu. `primeira` (AAAA-MM): a nota de antes do mês anterior a ela
   * não entra ('antiga').
   */
  async function guardarDocumentoSefaz(api, indice, doc, cnpjEmpresa, primeira = null) {
    const lido = sefazDist.lerDocumento(doc);
    if (lido.tipo === 'resumo_nfe') {
      if (lido.emitente_documento === cnpjEmpresa) return 'propria';
      if (antigaDeFora(indice, 'sefaz_nfe', lido.chave, lido.data_emissao, primeira)) return 'antiga';
      const r = await entrada.gravar(api, indice, {
        origem: 'sefaz_nfe', tipo: 'nfe', chave: lido.chave, nsu: doc.nsu, emitente_documento: lido.emitente_documento, emitente_nome: lido.emitente_nome,
        data_emissao: lido.data_emissao, valor: lido.valor, situacao_nota: lido.situacao_nota
      });
      return r.novo ? 'nova' : 'resumo';
    }
    if (lido.tipo === 'nfe') {
      let nota = null;
      try { nota = documentos.lerNfeEntrada(lido.xml); } catch (_) { nota = null; }
      if (nota?.emitente_documento === cnpjEmpresa) return 'propria';
      if (antigaDeFora(indice, 'sefaz_nfe', lido.chave, nota?.data_emissao, primeira)) return 'antiga';
      await entrada.gravar(api, indice, {
        origem: 'sefaz_nfe', tipo: 'nfe', chave: lido.chave, nsu: doc.nsu, xml: lido.xml,
        numero: nota ? String(nota.numero ?? '') : null, serie: nota ? String(nota.serie ?? '') : null,
        emitente_documento: nota?.emitente_documento || null, emitente_nome: nota?.emitente_nome || null,
        data_emissao: nota?.data_emissao || null, valor: nota?.valor_total ?? null, situacao_nota: 'autorizada'
      });
      return 'completa';
    }
    if (lido.tipo === 'evento') {
      const l = await entrada.aplicarEvento(api, indice, { origem: 'sefaz_nfe', tipo: 'nfe', evento: lido });
      if (lido.cancela && l) return l.status === 'registrada' ? 'cancelada_registrada' : 'cancelada';
      return 'evento';
    }
    return 'outro';
  }

  /** A manifestação de UMA nota (assina, envia ao Ambiente Nacional e grava). */
  async function manifestarLinha(api, ctx, l, { tipo, justificativa = null, usuarioId = null }) {
    const def = sefazDist.MANIFESTACOES[tipo];
    if (!def) throw c.erro('Manifestação inválida.');
    const xml = sefazDist.xmlManifestacao({ ambiente: ctx.ambiente, cnpj: ctx.fiscal.cnpj, chave: l.chave, tipo, justificativa, dhEvento: xmlNfe.formatarDataHora(new Date(agora())) });
    const assinado = assinatura.assinarEvento(xml, { chavePrivadaPem: ctx.cert.chavePrivadaPem, certificadoPem: ctx.cert.certificadoPem });
    let r;
    try {
      r = await sefazDist.enviarManifestacao({ url: catalogo.url(ctx.def, 'url_evento', ctx.params, ctx.ambiente), transporte: transporte(ctx.cert, 'a SEFAZ (Ambiente Nacional)'), xmlEventoAssinado: assinado, idLote: String(agora()).slice(-15) });
    } catch (e) {
      await b.atualizar(api, entrada.TABELA, l.id, { manifestacao_erro: String(e.message).slice(0, 1000), atualizado_em: c.agora() }).catch(() => {});
      throw e;
    }
    if (!r.registrado) {
      await b.atualizar(api, entrada.TABELA, l.id, { manifestacao_erro: r.mensagem.slice(0, 1000), atualizado_em: c.agora() }).catch(() => {});
      throw c.erro(`A SEFAZ não registrou a manifestação: ${r.mensagem}.`, 422);
    }
    const campos = {
      manifestacao: tipo, manifestacao_em: c.agora(), manifestacao_protocolo: r.evento?.nProt || null, manifestacao_erro: null, atualizado_em: c.agora()
    };
    // 22b do dono (02/10/2026): desconhecer ou dizer que não houve operação NÃO tira a nota
    // das pendências — ela fica na caixa até alguém ignorar à mão, com o motivo.
    await b.atualizar(api, entrada.TABELA, l.id, campos);
    await eventos.registrar(api, {
      tipo: 'nfe_manifestada', usuarioId, competencia: String(c.dia(l.data_emissao) || '').slice(0, 7) || null,
      descricao: `${def.rotulo} da NF-e ${l.numero || l.chave.slice(25, 34)} de ${l.emitente_nome || 'emitente'}${r.duplicado ? ' (já estava registrada na SEFAZ)' : ''}`
    });
    return { id: l.id, manifestacao: tipo, protocolo: r.evento?.nProt || null, duplicado: r.duplicado, recusada: entrada.RECUSAS.includes(tipo) };
  }

  async function sincronizarSefaz(api, ctx, { usuarioId }) {
    const { linha, params, ambiente, fiscal, cert } = ctx;
    const agoraMs = agora();
    if (linha.proxima_consulta_apos && new Date(linha.proxima_consulta_apos).getTime() > agoraMs) {
      const quando = b.instanteBR(linha.proxima_consulta_apos);
      return { situacao: 'aguardando', resumo: `A SEFAZ pede 1 hora entre consultas sem nota nova: a próxima a partir de ${quando.slice(11, 16)} (${quando.slice(8, 10)}/${quando.slice(5, 7)}).`, aguardar_ate: quando };
    }
    const gravar = podeGravar(ambiente);
    const url = catalogo.url(ctx.def, 'url_distribuicao', params, ambiente);
    const rede_ = transporte(cert, 'a SEFAZ (Distribuição de DF-e)');
    const cnpj = b.digitos(fiscal.cnpj);
    const recomeco = !vazio(params.nsu_inicial);
    let ult = recomeco ? sefazDist.nsu15(params.nsu_inicial) : sefazDist.nsu15(linha.ultimo_nsu || '0');
    let max = linha.max_nsu || null;
    const linhasEntrada = await entrada.lerTodas(api);
    if (linhasEntrada === null) throw c.erro(b.SQL_FALTANDO_INTEGRACOES, 409, { sql_pendente: true, sql_arquivo: b.SQL_ARQUIVO_INTEGRACOES });
    const indice = entrada.indexar(linhasEntrada);
    const primeira = params.primeira_competencia || null;
    const cont = { lotes: 0, documentos: 0, novas: 0, completas: 0, eventos: 0, canceladas: 0, canceladas_registradas: 0, proprias: 0, antigas: 0, manifestadas: 0, registradas: 0, decidir: 0, erros: [], nao_registradas: [] };
    const datasRegistradas = [];
    let aguardarAte = null;
    for (let i = 0; i < LIMITE_LOTES; i++) {
      const ret = await sefazDist.consultar({ url, transporte: rede_, xmlDados: sefazDist.xmlDistribuicao({ ambiente, uf: fiscal.uf, cnpj, ultNSU: ult }) });
      cont.lotes++;
      if (ret.consumoIndevido) {
        aguardarAte = agoraMs + HORA_MS;
        cont.erros.push(`SEFAZ ${ret.cStat}: ${ret.xMotivo} — a próxima consulta só depois de 1 hora.`);
        break;
      }
      if (ret.ultNSU) ult = ret.ultNSU;
      if (ret.maxNSU) max = ret.maxNSU;
      if (ret.semDocumento) { aguardarAte = agoraMs + HORA_MS; break; }
      if (!ret.comDocumento) throw c.erro(`A SEFAZ respondeu ${ret.cStat} — ${ret.xMotivo}.`, 502);
      for (const doc of ret.documentos) {
        cont.documentos++;
        if (!gravar) continue;
        const o = await guardarDocumentoSefaz(api, indice, doc, cnpj, primeira);
        if (o === 'nova') cont.novas++;
        else if (o === 'completa') cont.completas++;
        else if (o === 'propria') cont.proprias++;
        else if (o === 'antiga') cont.antigas++;
        else if (o === 'cancelada') cont.canceladas++;
        else if (o === 'cancelada_registrada') { cont.canceladas++; cont.canceladas_registradas++; }
        else if (o === 'evento') cont.eventos++;
      }
      // Em homologação num banco de produção nada se grava: o NSU não anda (a próxima busca vê de novo).
      if (gravar) await configuracao.atualizarEstado(api, linha, { ultimo_nsu: ult, max_nsu: max });
      if (!ret.maxNSU || ult >= ret.maxNSU) { aguardarAte = agoraMs + HORA_MS; break; }
    }
    if (gravar) {
      // Ciência automática: a SEFAZ só libera o XML completo depois dela.
      if (params.manifestar_ciencia !== false) {
        const semCiencia = [...indice.values()].filter(l => l.origem === 'sefaz_nfe' && l.status === 'nova' && !l.xml && !l.manifestacao && !l.manifestacao_erro && l.situacao_nota !== 'cancelada').slice(0, LIMITE_MANIFESTACOES);
        for (const l of semCiencia) {
          try {
            await manifestarLinha(api, ctx, l, { tipo: 'ciencia', usuarioId });
            cont.manifestadas++;
          } catch (e) {
            cont.erros.push(`Ciência da NF-e de ${l.emitente_nome || l.chave}: ${e.message}`);
          }
        }
      }
      if (params.registrar_automaticamente !== false) {
        // A nota que não entra (mês fechado, dado faltando) fica na caixa com o
        // motivo: é problema do documento, não da integração (não vira "último erro").
        const r = await registrarPendentes(api, 'sefaz_nfe', { usuarioId, gerarTitulo: params.gerar_conta === true, cnpj, primeira });
        cont.registradas += r.registradas;
        cont.nao_registradas.push(...r.erros);
        datasRegistradas.push(...r.datas);
      }
      cont.decidir = contarDecidir(indice, 'sefaz_nfe', primeira);
    }
    const estado_ = {
      ultima_execucao_em: c.agora(), ultimo_sucesso_em: c.agora(), ultimo_erro: cont.erros.length ? cont.erros.slice(0, 3).join(' | ').slice(0, 2000) : null,
      proxima_consulta_apos: aguardarAte ? new Date(aguardarAte).toISOString() : null
    };
    if (gravar) Object.assign(estado_, { ultimo_nsu: ult, max_nsu: max });
    await configuracao.atualizarEstado(api, linha, estado_);
    if (recomeco && gravar) await configuracao.gravar(api, ctx.def, { parametros: { ...linha.parametros, nsu_inicial: null } }).catch(() => {});
    const partes = [`${c.plural(cont.documentos, 'documento', 'documentos')} da SEFAZ`];
    if (cont.novas) partes.push(c.plural(cont.novas, 'NF-e nova (resumo)', 'NF-e novas (resumo)'));
    if (cont.completas) partes.push(c.plural(cont.completas, 'XML completo', 'XMLs completos'));
    if (cont.manifestadas) partes.push(c.plural(cont.manifestadas, 'ciência dada', 'ciências dadas'));
    if (cont.registradas) partes.push(c.plural(cont.registradas, 'registrada nos documentos', 'registradas nos documentos'));
    if (cont.canceladas) partes.push(c.plural(cont.canceladas, 'cancelamento', 'cancelamentos'));
    partes.push(...partesDaJanela(cont, primeira));
    if (!gravar) partes.push('homologação num banco de produção: nada foi gravado');
    if (cont.nao_registradas.length) partes.push(`${c.plural(cont.nao_registradas.length, 'não registrada', 'não registradas')} (o motivo está na caixa de entrada)`);
    if (cont.erros.length) partes.push(c.plural(cont.erros.length, 'erro', 'erros'));
    return {
      situacao: 'rodou', resumo: partes.join(' · '), resultado: { ...cont, ultimo_nsu: ult, max_nsu: max, gravou: gravar }, ...cont, aguardar_ate: aguardarAte ? b.instanteBR(new Date(aguardarAte)) : null,
      meses_conciliar: mesesDasNotas(datasRegistradas)
    };
  }

  /** As notas registradas: o mês delas e o seguinte (a nota de um mês é paga no outro). */
  const mesesDasNotas = datas => require('../conciliacao/conciliacao').mesesParaConciliar(datas, { comSeguinte: true });

  /**
   * Fase A (02/10/2026): depois de gravar extrato ou notas, a conciliação
   * automática roda sozinha nos meses tocados (só o automático; nada aqui
   * derruba a busca).
   */
  async function conciliarSozinho(api, r, { usuarioId, contaId = null }) {
    if (!r || r.situacao !== 'rodou' || !r.meses_conciliar?.length) return r;
    const conciliacao = require('../conciliacao/conciliacao');
    const feito = await conciliacao.automaticaDosMeses(api, { competencias: r.meses_conciliar, contaId, usuarioId, hoje: hojeBR() });
    const frase = conciliacao.resumoDaAutomatica(feito);
    return { ...r, resumo: frase ? `${r.resumo} · ${frase}` : r.resumo, conciliacao: feito };
  }

  /** Quantas notas do mês anterior ao início ainda esperam a decisão na caixa de entrada. */
  const contarDecidir = (indice, origem, primeira) => [...indice.values()]
    .filter(l => l && l.origem === origem && (l.status === 'nova' || l.status === 'completa') && l.situacao_nota !== 'cancelada'
      && entrada.faseDaNota(l.data_emissao, primeira) === 'anterior').length;

  /** O que o resumo diz das notas de antes do início (as que não entraram e as que esperam a decisão). */
  function partesDaJanela(cont, primeira) {
    if (!primeira) return [];
    const anterior = c.rotuloCompetencia(c.somarMeses(primeira, -1));
    const partes = [];
    if (cont.antigas) partes.push(`${c.plural(cont.antigas, 'nota', 'notas')} de antes de ${anterior} ${cont.antigas === 1 ? 'ficou' : 'ficaram'} de fora`);
    if (cont.decidir) partes.push(`${c.plural(cont.decidir, 'nota', 'notas')} de ${anterior} ${cont.decidir === 1 ? 'espera' : 'esperam'} a sua decisão na caixa de entrada (registrar ou guardar como histórico)`);
    return partes;
  }

  /**
   * Registra o que está completo na caixa de entrada (NF-e com XML, NFS-e) —
   * até 50 por vez. A nota do mês anterior ao início (`primeira`) não: ela
   * espera a decisão (registrar ou guardar como histórico).
   */
  async function registrarPendentes(api, origem, { usuarioId, gerarTitulo, cnpj, primeira = null }) {
    const linhas = (await entrada.lerTodas(api)) || [];
    const abertas = linhas.filter(l => l.origem === origem && (l.status === 'nova' || l.status === 'completa') && l.situacao_nota !== 'cancelada');
    const foraDoInicio = l => ['anterior', 'antes'].includes(entrada.faseDaNota(l.data_emissao, primeira));
    const prontas = abertas.filter(l => l.status === 'completa' && !l.erro && (l.tipo !== 'nfe' || l.xml) && !foraDoInicio(l)).slice(0, LIMITE_REGISTROS);
    const saida = { registradas: 0, erros: [], datas: [] };
    for (const l of prontas) {
      try {
        await entrada.registrar(api, l, { usuarioId, hoje: hojeBR(), podeLancar: gerarTitulo, gerarTitulo, cnpjEmpresa: cnpj });
        saida.registradas++;
        saida.datas.push(l.data_emissao);
      } catch (e) {
        saida.erros.push(`${l.tipo === 'nfe' ? 'NF-e' : 'NFS-e'} ${l.numero || ''} de ${l.emitente_nome || 'emitente'}: ${e.message}`);
      }
    }
    return saida;
  }

  // ------------------------------------------------------------ ADN — NFS-e tomadas

  async function sincronizarAdn(api, ctx, { usuarioId }) {
    const { linha, params, ambiente, fiscal, cert } = ctx;
    const gravar = podeGravar(ambiente);
    const base = catalogo.url(ctx.def, 'url', params, ambiente);
    const rede_ = transporte(cert, 'o ADN da NFS-e');
    const cnpj = b.digitos(fiscal.cnpj);
    const recomeco = !vazio(params.nsu_inicial);
    let ult = recomeco ? nfseAdn.nsuTexto(params.nsu_inicial) : nfseAdn.nsuTexto(linha.ultimo_nsu || '0');
    const linhasEntrada = await entrada.lerTodas(api);
    if (linhasEntrada === null) throw c.erro(b.SQL_FALTANDO_INTEGRACOES, 409, { sql_pendente: true, sql_arquivo: b.SQL_ARQUIVO_INTEGRACOES });
    const indice = entrada.indexar(linhasEntrada);
    const primeira = params.primeira_competencia || null;
    const cont = { lotes: 0, documentos: 0, tomadas: 0, outras: 0, eventos: 0, canceladas: 0, antigas: 0, registradas: 0, decidir: 0, erros: [], nao_registradas: [] };
    // Em lote, pede "a partir do último" e descarta o que já veio (o ADN pode incluir o próprio NSU);
    // um por vez, pede o seguinte.
    const emLote = params.lote !== false;
    const limite = emLote ? LIMITE_LOTES : LIMITE_LOTES * 10;
    for (let i = 0; i < limite; i++) {
      const r = await nfseAdn.consultar({ base, nsu: emLote ? ult : String(Number(ult) + 1), lote: emLote, transporte: rede_ });
      cont.lotes++;
      if (r.semDocumento) break;
      const novos = r.documentos.filter(d => Number(d.nsu) > Number(ult)).sort((x, y) => Number(x.nsu) - Number(y.nsu));
      if (!novos.length) break;
      for (const d of novos) {
        cont.documentos++;
        ult = d.nsu;
        if (!gravar || !d.xml) continue;
        const lido = nfseAdn.lerDocumento(d.xml, { cnpjEmpresa: cnpj });
        if (lido.tipo === 'nfse') {
          if (lido.papel !== 'tomador') { cont.outras++; continue; }
          if (antigaDeFora(indice, 'nfse_adn', lido.chave || d.chave, lido.data_emissao, primeira)) { cont.antigas++; continue; }
          await entrada.gravar(api, indice, {
            origem: 'nfse_adn', tipo: 'nfse', chave: lido.chave || d.chave, nsu: d.nsu, xml: d.xml, numero: lido.numero, municipio: lido.municipio,
            emitente_documento: lido.emitente_documento, emitente_nome: lido.emitente_nome, data_emissao: lido.data_emissao,
            valor: lido.valor_servicos, situacao_nota: 'autorizada'
          });
          cont.tomadas++;
        } else if (lido.tipo === 'evento') {
          const l = await entrada.aplicarEvento(api, indice, { origem: 'nfse_adn', tipo: 'nfse', evento: { ...lido, chave: lido.chave || d.chave, tpEvento: lido.codigo_evento } });
          if (l && lido.cancela) cont.canceladas++;
          else cont.eventos++;
        } else {
          cont.outras++;
        }
      }
      if (gravar) await configuracao.atualizarEstado(api, linha, { ultimo_nsu: ult });
    }
    const datasRegistradas = [];
    if (gravar && params.registrar_automaticamente !== false) {
      const r = await registrarPendentes(api, 'nfse_adn', { usuarioId, gerarTitulo: params.gerar_conta === true, cnpj, primeira });
      cont.registradas += r.registradas;
      cont.nao_registradas.push(...r.erros);
      datasRegistradas.push(...r.datas);
    }
    if (gravar) cont.decidir = contarDecidir(indice, 'nfse_adn', primeira);
    await configuracao.atualizarEstado(api, linha, {
      ultima_execucao_em: c.agora(), ultimo_sucesso_em: c.agora(), ultimo_erro: cont.erros.length ? cont.erros.slice(0, 3).join(' | ').slice(0, 2000) : null,
      ...(gravar ? { ultimo_nsu: ult } : {})
    });
    if (recomeco && gravar) await configuracao.gravar(api, ctx.def, { parametros: { ...linha.parametros, nsu_inicial: null } }).catch(() => {});
    const partes = [`${c.plural(cont.documentos, 'documento', 'documentos')} do ADN`];
    if (cont.tomadas) partes.push(c.plural(cont.tomadas, 'NFS-e tomada', 'NFS-e tomadas'));
    if (cont.registradas) partes.push(c.plural(cont.registradas, 'registrada nos documentos', 'registradas nos documentos'));
    if (cont.canceladas) partes.push(c.plural(cont.canceladas, 'cancelamento', 'cancelamentos'));
    partes.push(...partesDaJanela(cont, primeira));
    if (!gravar) partes.push('homologação num banco de produção: nada foi gravado');
    if (cont.nao_registradas.length) partes.push(`${c.plural(cont.nao_registradas.length, 'não registrada', 'não registradas')} (o motivo está na caixa de entrada)`);
    if (cont.erros.length) partes.push(c.plural(cont.erros.length, 'erro', 'erros'));
    return { situacao: 'rodou', resumo: partes.join(' · '), resultado: { ...cont, ultimo_nsu: ult, gravou: gravar }, ...cont, meses_conciliar: mesesDasNotas(datasRegistradas) };
  }

  // ------------------------------------------------------------ BB — extrato

  /**
   * Agência e conta que valem no ambiente. Na homologação, a conta de teste
   * e o código dela (cabeçalho x-br-com-bb-ipa-mciteste, só lá).
   */
  function contaDoAmbiente(params, ambiente) {
    if (ambiente === catalogo.PRODUCAO) return { agencia: params.agencia, conta: params.conta, mciTeste: null };
    const agencia = params.homologacao_agencia || params.agencia;
    const conta = params.homologacao_conta || params.conta;
    return { agencia, conta, mciTeste: catalogo.mciTesteDoExtrato(params, agencia, conta) };
  }

  /** O período da busca: a competência pedida, ou da última busca pela API (menos a folga) até ontem, sem entrar em mês fechado. */
  async function periodoDoExtrato(api, ctx, { competencia = null } = {}) {
    const hoje = hojeBR();
    const ontem = somarDia(hoje, -1);
    let inicio;
    let fim = ontem;
    if (c.competenciaValida(competencia)) {
      inicio = `${competencia}-01`;
      fim = menor(b.ultimoDia(competencia), ontem);
      return { inicio, fim, manual: true };
    }
    const importacoes = ((await b.lerOpcional(api, 'extrato_importacoes', { conta_id: Number(ctx.params.conta_id) })) || [])
      .filter(i => i.status !== 'desfeita' && i.origem === 'api');
    const ultima = importacoes.map(i => c.dia(i.periodo_fim)).filter(Boolean).sort().at(-1) || null;
    const folga = Number(ctx.params.dias_para_tras) || 0;
    inicio = ultima ? somarDia(ultima, -folga) : `${c.somarMeses(c.competenciaDe(hoje), -1)}-01`;
    // Não entra em competência fechada: começa no primeiro dia depois da última fechada do período.
    const fechadas = ((await b.lerOpcional(api, 'competencia_contabil')) || []).filter(x => x.status === 'fechada').map(x => x.competencia).sort();
    for (const comp of fechadas) if (comp >= inicio.slice(0, 7) && comp <= fim.slice(0, 7)) inicio = `${c.somarMeses(comp, 1)}-01`;
    return { inicio, fim, manual: false };
  }

  async function sincronizarExtrato(api, ctx, { usuarioId, competencia = null }) {
    const { params, ambiente, credenciais, cert, linha } = ctx;
    const gravar = podeGravar(ambiente);
    const conta = await extratoMod.lerConta(api, params.conta_id);
    const { inicio, fim, manual } = await periodoDoExtrato(api, ctx, { competencia });
    if (!inicio || !fim || inicio > fim) {
      await configuracao.atualizarEstado(api, linha, { ultima_execucao_em: c.agora(), ultimo_sucesso_em: c.agora(), ultimo_erro: null });
      return { situacao: 'nada', resumo: 'Nada a buscar: o período já está em dia (ou cai em competência fechada).' };
    }
    const { agencia, conta: numeroConta, mciTeste } = contaDoAmbiente(params, ambiente);
    const busca = await bbExtrato.buscarPeriodo({
      transporte: transporte(usaMtls(ctx.def, params, ambiente) ? cert : null, 'o Banco do Brasil'),
      urlOauth: catalogo.url(ctx.def, 'url_oauth', params, ambiente), urlApi: catalogo.url(ctx.def, 'url_api', params, ambiente),
      credenciais, escopo: params.escopo, ambiente, agencia, conta: numeroConta, mciTeste, inicio, fim
    });
    const p = await extratoMod.analisar(api, { conta, extrato: busca.extrato, confere: true, origem: 'api' });
    let gravado = null;
    if (gravar) {
      gravado = await extratoMod.gravar(api, p, {
        origem: 'api', usuarioId, nomeImportacao: `API de Extratos do BB (${ambiente === catalogo.PRODUCAO ? 'produção' : 'homologação'})`,
        // Só a busca de uma competência inteira guarda a resposta como evidência (a diária encheria o pacote).
        evidencia: manual ? {
          nome: `extrato-bb-api-${inicio}-a-${fim}.json`, tipo: 'application/json', rotulo: 'A resposta da API',
          base64: Buffer.from(JSON.stringify({ consultado_em: new Date(agora()).toISOString(), ambiente, agencia, conta: numeroConta, inicio, fim, paginas: busca.paginas }, null, 1), 'utf8').toString('base64')
        } : null
      });
    }
    await configuracao.atualizarEstado(api, linha, { ultima_execucao_em: c.agora(), ultimo_sucesso_em: c.agora(), ultimo_erro: null });
    const lidos = busca.extrato.lancamentos.length;
    const resumo = gravar
      ? `Extrato de ${c.impressa(inicio)} a ${c.impressa(fim)}: ${c.plural(gravado.novos, 'lançamento novo', 'lançamentos novos')}${gravado.repetidos ? `, ${c.plural(gravado.repetidos, 'já importado', 'já importados')}` : ''}`
      : `Homologação num banco de produção: ${c.plural(lidos, 'lançamento lido', 'lançamentos lidos')} de ${c.impressa(inicio)} a ${c.impressa(fim)}, nada gravado`;
    return {
      situacao: 'rodou', resumo, periodo: { inicio, fim }, lidos, novos: gravado?.novos ?? p.novos.length, repetidos: gravado?.repetidos ?? (p.linhas.length - p.novos.length),
      avisos: p.avisos, gravou: gravar, resultado: { inicio, fim, lidos, novos: gravado?.novos ?? null, repetidos: gravado?.repetidos ?? null, gravou: gravar },
      meses_conciliar: gravado?.meses || [], conta_conciliar: conta.id
    };
  }

  // ------------------------------------------------------------ operações públicas

  /** A busca de verdade (botão ou agenda). `opcoes.competencia` só para o extrato. */
  async function sincronizar(api, chave, { usuarioId = null, tipo = 'manual', chaveExecucao = null, competencia = null } = {}) {
    if (catalogo.definicao(chave).foraDeUso) throw c.erro(catalogo.definicao(chave).foraDeUso, 409);
    const ctx = await contexto(api, chave);
    if (!ctx.linha.ativa && tipo === 'automatica') return { situacao: 'desligada', resumo: 'Integração desligada.' };
    // A busca manual também só roda ligada (na SEFAZ ela dá ciência); o teste de conexão roda sempre.
    if (!ctx.linha.ativa) {
      const falta = `Ligue a integração (marque "Ligada" no cartão de ${ctx.def.nome} e salve).`;
      throw c.erro(`Antes: ${falta}`, 409, { pendencias: [falta] });
    }
    const rodar = async () => {
      try {
        if (chave === 'sefaz_nfe') return await conciliarSozinho(api, await sincronizarSefaz(api, ctx, { usuarioId }), { usuarioId });
        if (chave === 'nfse_adn') return await conciliarSozinho(api, await sincronizarAdn(api, ctx, { usuarioId }), { usuarioId });
        if (chave === 'bb_extrato') {
          const r = await sincronizarExtrato(api, ctx, { usuarioId, competencia });
          return await conciliarSozinho(api, r, { usuarioId, contaId: r.conta_conciliar ?? null });
        }
        throw c.erro(`${ctx.def.nome}: ainda não há busca (só o teste de conexão).`, 409);
      } catch (e) {
        await configuracao.atualizarEstado(api, ctx.linha, { ultima_execucao_em: c.agora(), ultimo_erro: String(e.message).slice(0, 2000) });
        throw e;
      }
    };
    return registrada(api, { integracao: chave, tipo, chave: chaveExecucao, usuarioId }, rodar);
  }

  /** O teste de conexão: fala com o serviço e não grava nada (só o registro e, na SEFAZ, a espera de 1 hora). */
  async function testar(api, chave, { usuarioId = null } = {}) {
    if (catalogo.definicao(chave).foraDeUso) throw c.erro(catalogo.definicao(chave).foraDeUso, 409);
    const ctx = await contexto(api, chave);
    const { params, ambiente, cert, credenciais, linha, fiscal } = ctx;
    return registrada(api, { integracao: chave, tipo: 'teste', usuarioId }, async () => {
      const inicio = agora();
      if (chave === 'sefaz_nfe') {
        const aguardando = linha.proxima_consulta_apos && new Date(linha.proxima_consulta_apos).getTime() > agora();
        if (aguardando) {
          // Na espera da SEFAZ, a prova de certificado + TLS é o Status do Serviço da SEFAZ-MG.
          const st = await sefazCliente.statusServico({ uf: fiscal.uf, ambiente, transporte: sefazTransporte(cert) });
          return { ok: true, resumo: `Certificado e conexão ok (Status do Serviço SEFAZ-${fiscal.uf}: ${st.cStat} — ${st.xMotivo}). A Distribuição de DF-e fica para depois de ${b.instanteBR(linha.proxima_consulta_apos).slice(11, 16)} (regra da SEFAZ).`, tempoMs: agora() - inicio };
        }
        const ret = await sefazDist.consultar({
          url: catalogo.url(ctx.def, 'url_distribuicao', params, ambiente), transporte: transporte(cert, 'a SEFAZ (Distribuição de DF-e)'),
          xmlDados: sefazDist.xmlDistribuicao({ ambiente, uf: fiscal.uf, cnpj: fiscal.cnpj, ultNSU: linha.ultimo_nsu || '0' })
        });
        if (ret.semDocumento || ret.consumoIndevido || (ret.maxNSU && ret.ultNSU && ret.ultNSU >= ret.maxNSU)) {
          await configuracao.atualizarEstado(api, linha, { proxima_consulta_apos: new Date(agora() + HORA_MS).toISOString() });
        }
        if (!ret.semDocumento && !ret.comDocumento) throw c.erro(`A SEFAZ respondeu ${ret.cStat} — ${ret.xMotivo}.`, 502);
        return {
          ok: true, tempoMs: ret.tempoMs,
          resumo: `SEFAZ ${ret.cStat} — ${ret.xMotivo}. ${ret.documentos.length ? `${c.plural(ret.documentos.length, 'documento esperando', 'documentos esperando')} (a busca os traz).` : ''} NSU atual ${ret.ultNSU || '—'} de ${ret.maxNSU || '—'}.`.trim()
        };
      }
      if (chave === 'nfse_adn') {
        const r = await nfseAdn.consultar({ base: catalogo.url(ctx.def, 'url', params, ambiente), nsu: linha.ultimo_nsu || '0', lote: params.lote !== false, transporte: transporte(cert, 'o ADN da NFS-e') });
        const chaves = r.bruto && typeof r.bruto === 'object' ? Object.keys(r.bruto).slice(0, 12) : [];
        return {
          ok: true, tempoMs: r.tempoMs, bruto_chaves: chaves,
          resumo: `ADN respondeu ${r.situacao}${r.documentos.length ? `: ${c.plural(r.documentos.length, 'documento', 'documentos')} no lote` : ''}${r.erros ? ` (${r.erros})` : ''}. Campos da resposta: ${chaves.join(', ') || '—'}.`
        };
      }
      if (chave === 'bb_extrato') {
        // Os últimos 30 dias até ontem (uma consulta só: o BB aceita até 31 dias).
        const ontem = somarDia(hojeBR(), -1);
        const desde = somarDia(ontem, -29);
        const { agencia, conta, mciTeste } = contaDoAmbiente(params, ambiente);
        const comCertificado = usaMtls(ctx.def, params, ambiente);
        const busca = await bbExtrato.buscarPeriodo({
          transporte: transporte(comCertificado ? cert : null, 'o Banco do Brasil'),
          urlOauth: catalogo.url(ctx.def, 'url_oauth', params, ambiente), urlApi: catalogo.url(ctx.def, 'url_api', params, ambiente),
          credenciais, escopo: params.escopo, ambiente, agencia, conta, mciTeste, inicio: desde, fim: ontem
        });
        const ex = busca.extrato;
        const qualConta = ambiente === catalogo.PRODUCAO ? `conta ${agencia} / ${conta}` : `conta de teste do BB ${agencia} / ${conta}`;
        const partes = [
          `Token e extrato ok (escopos: ${busca.escopos.join(' ') || '—'}${comCertificado ? '; com o certificado da empresa' : ''}).`,
          `${qualConta}, de ${c.impressa(desde)} a ${c.impressa(ontem)}: ${busca.semLancamentos ? 'o BB respondeu que não há lançamentos no período' : c.plural(ex.lancamentos.length, 'lançamento', 'lançamentos')}${ex.saldo ? `, saldo ${c.reais(ex.saldo.valor)}` : ''}.`,
          ex.fora.length ? `Fora do extrato (saldos, limites, futuros): ${ex.fora.slice(0, 4).map(x => `${x.descricao || x.tipo} ${c.reais(x.valor)}`).join('; ')}${ex.fora.length > 4 ? '…' : ''}.` : '',
          'Nada foi gravado.'
        ];
        return { ok: true, tempoMs: agora() - inicio, resumo: partes.filter(Boolean).join(' ') };
      }
      if (chave === 'bb_investimentos') {
        const rede_ = transporte(usaMtls(ctx.def, params, ambiente) ? cert : null, 'o Banco do Brasil');
        const token = await bbExtrato.pedirToken({ transporte: rede_, urlOauth: catalogo.url(ctx.def, 'url_oauth', params, ambiente), clientId: credenciais.clientId, clientSecret: credenciais.secret, escopo: params.escopo });
        const caminho = String(params.caminho_consulta || '').replace('{agencia}', b.digitos(params.agencia)).replace('{conta}', b.digitos(params.conta));
        const r = await bbExtrato.chamarApi({ transporte: rede_, url: `${catalogo.url(ctx.def, 'url_api', params, ambiente)}${caminho.startsWith('/') ? '' : '/'}${caminho}`, token, appKey: credenciais.appKey, ambiente });
        const corpo = r.corpo || {};
        return {
          ok: true, tempoMs: agora() - inicio, amostra: JSON.stringify(corpo).slice(0, 3000),
          resumo: `Token ok (escopos: ${token.escopos.join(' ') || '—'}). A consulta ${r.vazio ? 'não achou nada (404)' : `respondeu com os campos: ${Object.keys(corpo).slice(0, 15).join(', ') || '—'}`}. Mande a amostra para o mapeamento.`
        };
      }
      throw c.erro('Integração sem teste.', 409);
    });
  }

  /** O transporte do Status do Serviço (o do fiscal só aceita POST com os cabeçalhos dele). */
  function sefazTransporte(cert) {
    const t = transporte(cert, 'a SEFAZ');
    return async (url, corpo, cabecalhos) => {
      const r = await t(url, { metodo: 'POST', corpo, cabecalhos });
      return { status: r.status, corpo: Buffer.isBuffer(r.corpo) ? r.corpo.toString('utf8') : String(r.corpo ?? '') };
    };
  }

  /** Manifestação escolhida na caixa de entrada. */
  async function manifestar(api, id, { tipo, justificativa = null, usuarioId = null }) {
    const ctx = await contexto(api, 'sefaz_nfe');
    if (!podeGravar(ctx.ambiente)) throw c.erro('A integração está em homologação num banco de produção: a manifestação não vale para notas reais.', 409);
    const l = await entrada.lerLinha(api, id);
    if (l.origem !== 'sefaz_nfe') throw c.erro('Manifestação é só para NF-e.', 409);
    if (l.situacao_nota === 'cancelada') throw c.erro('A nota foi cancelada pelo emitente.', 409);
    return manifestarLinha(api, ctx, l, { tipo, justificativa, usuarioId });
  }

  /** A NF-e completa pela chave (a SEFAZ entrega depois da ciência). */
  async function baixarXml(api, id, { usuarioId = null } = {}) {
    const ctx = await contexto(api, 'sefaz_nfe');
    const l = await entrada.lerLinha(api, id);
    if (l.origem !== 'sefaz_nfe') throw c.erro('Só para NF-e da SEFAZ.', 409);
    if (l.xml) return { id: l.id, ja_tinha: true };
    const ret = await sefazDist.consultar({
      url: catalogo.url(ctx.def, 'url_distribuicao', ctx.params, ctx.ambiente), transporte: transporte(ctx.cert, 'a SEFAZ (Distribuição de DF-e)'),
      xmlDados: sefazDist.xmlDistribuicao({ ambiente: ctx.ambiente, uf: ctx.fiscal.uf, cnpj: ctx.fiscal.cnpj, chave: l.chave })
    });
    if (!ret.comDocumento) throw c.erro(`A SEFAZ respondeu ${ret.cStat} — ${ret.xMotivo}${ret.cStat === '640' || ret.cStat === '217' ? ' (dê ciência antes e tente de novo em alguns minutos)' : ''}.`, 422);
    const indice = entrada.indexar((await entrada.lerTodas(api)) || []);
    let completa = false;
    for (const doc of ret.documentos) {
      const o = await guardarDocumentoSefaz(api, indice, doc, b.digitos(ctx.fiscal.cnpj));
      if (o === 'completa') completa = true;
    }
    if (!completa) throw c.erro('A SEFAZ ainda não liberou o XML completo desta nota (só o resumo): dê ciência e tente mais tarde.', 422);
    let registrado = null;
    // A nota do mês anterior ao início espera a decisão (registrar ou guardar como histórico).
    const esperaDecisao = ['anterior', 'antes'].includes(entrada.faseDaNota(l.data_emissao, ctx.params.primeira_competencia || null));
    if (ctx.params.registrar_automaticamente !== false && podeGravar(ctx.ambiente) && !esperaDecisao) {
      registrado = await entrada.registrar(api, l.id, { usuarioId, hoje: hojeBR(), podeLancar: ctx.params.gerar_conta === true, gerarTitulo: ctx.params.gerar_conta === true, cnpjEmpresa: b.digitos(ctx.fiscal.cnpj) }).catch(e => ({ erro: e.message }));
    }
    if (registrado && !registrado.erro) {
      const feito = await conciliarSozinho(api, { situacao: 'rodou', resumo: '', meses_conciliar: mesesDasNotas([l.data_emissao]) }, { usuarioId });
      registrado.conciliacao_resumo = require('../conciliacao/conciliacao').resumoDaAutomatica(feito.conciliacao);
    }
    return { id: l.id, completa: true, registrado };
  }

  /** Registrar pela caixa de entrada (botão). */
  async function registrarDaEntrada(api, id, { usuarioId = null, gerarTitulo = false, podeLancar = false } = {}) {
    const fiscal = await configuracaoFiscal.carregar(api).catch(() => null);
    const r = await entrada.registrar(api, id, { usuarioId, hoje: hojeBR(), podeLancar, gerarTitulo, cnpjEmpresa: b.digitos(fiscal?.cnpj) });
    // Fase A: a nota registrada pode ser o débito que espera no extrato.
    const l = await entrada.lerLinha(api, id).catch(() => null);
    const feito = await conciliarSozinho(api, { situacao: 'rodou', resumo: '', meses_conciliar: mesesDasNotas([l?.data_emissao]) }, { usuarioId });
    return { ...r, conciliacao: feito.conciliacao || null, conciliacao_resumo: require('../conciliacao/conciliacao').resumoDaAutomatica(feito.conciliacao) };
  }

  async function ignorarDaEntrada(api, id, { motivo, usuarioId = null }) {
    const r = await entrada.ignorar(api, id, { motivo, usuarioId });
    const l = await entrada.lerLinha(api, id).catch(() => null);
    await eventos.registrar(api, {
      tipo: 'entrada_ignorada', usuarioId, competencia: String(c.dia(l?.data_emissao) || '').slice(0, 7) || null,
      descricao: `${l?.tipo === 'nfse' ? 'NFS-e' : 'NF-e'} ${l?.numero || ''} de ${l?.emitente_nome || 'emitente'} ignorada: ${c.texto(motivo, 300)}`
    });
    return r;
  }

  /** O mês em que cada busca começa (AAAA-MM), para a caixa de entrada pedir a decisão das notas do mês anterior. */
  async function primeirasDasBuscas(api) {
    const linhas = await configuracao.carregar(api).catch(() => null);
    const saida = {};
    for (const chave of ['sefaz_nfe', 'nfse_adn']) {
      saida[chave] = configuracao.parametros(catalogo.definicao(chave), linhas?.get(chave) || null).primeira_competencia || null;
    }
    return saida;
  }

  async function listarEntrada(api, filtro = {}) {
    return entrada.listar(api, { ...filtro, primeiras: await primeirasDasBuscas(api) });
  }

  /** Guardar como histórico a nota do mês anterior ao início (botão da caixa de entrada). */
  async function historicoDaEntrada(api, id, { usuarioId = null } = {}) {
    const l = await entrada.lerLinha(api, id);
    const primeira = (await primeirasDasBuscas(api))[l.origem] || null;
    const r = await entrada.guardarComoHistorico(api, id, { usuarioId, primeira });
    await eventos.registrar(api, {
      tipo: 'entrada_ignorada', usuarioId, competencia: String(c.dia(l.data_emissao) || '').slice(0, 7) || null,
      descricao: `${l.tipo === 'nfse' ? 'NFS-e' : 'NF-e'} ${l.numero || ''} de ${l.emitente_nome || 'emitente'} guardada como histórico (antes do início da Contabilidade)`
    });
    return { id: r.id, status: r.status, historico: true };
  }

  /** O XML guardado na caixa de entrada (para abrir/salvar). */
  async function xmlDaEntrada(api, id) {
    const l = await entrada.lerLinha(api, id);
    if (!l.xml) throw c.erro('Ainda não há o XML completo deste documento.', 404);
    return { nome: `${l.tipo === 'nfse' ? 'NFSe' : 'NFe'}-${l.chave}.xml`, tipo: 'application/xml', base64: Buffer.from(String(l.xml), 'utf8').toString('base64') };
  }

  return {
    seg, contexto, estado, salvar, testar, sincronizar, manifestar, baixarXml, registrarDaEntrada, ignorarDaEntrada, historicoDaEntrada, xmlDaEntrada,
    restaurarDaEntrada: (api, id) => entrada.restaurar(api, id),
    listarEntrada, primeirasDasBuscas,
    certificadoPublico: api => seg.certificadoPublico(api),
    podeGravar, periodoDoExtrato
  };
}

module.exports = { criar, LIMITE_LOTES, LIMITE_MANIFESTACOES, LIMITE_REGISTROS, somarDia };
