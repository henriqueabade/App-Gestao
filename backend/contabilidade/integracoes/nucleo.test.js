/**
 * O núcleo das integrações (etapas 10 a 13), sem rede:
 *   - catálogo: cada integração com nome, etapa, o que usa e os endereços;
 *   - configuração: parâmetros conferidos por tipo (https, dígitos, opção,
 *     por ambiente), intervalo nos limites, parâmetro desconhecido recusado;
 *     as travas de ambiente da máquina (a mais restritiva vence);
 *   - o que falta (certificado, CNPJ, credenciais do BB, conta, escopo);
 *   - a caixa de entrada nunca piora (XML não some, cancelada não volta,
 *     registrada não volta a nova);
 *   - a agenda: só a ligada e automática, uma vez por faixa, e a trava
 *     entre máquinas.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const catalogo = require('./catalogo');
const configuracao = require('./configuracao');
const entrada = require('./entrada');
const agenda = require('./agenda');
const execucoes = require('./execucoes');

test('catálogo: as quatro integrações, as etapas, o que cada uma usa e os endereços por ambiente', () => {
  assert.deepEqual(catalogo.CHAVES, ['sefaz_nfe', 'bb_extrato', 'nfse_adn', 'bb_investimentos']);
  assert.deepEqual(catalogo.CHAVES.map(k => catalogo.INTEGRACOES[k].etapa), [10, 11, 13, 12]);
  const sefaz = catalogo.definicao('sefaz_nfe');
  assert.equal(catalogo.url(sefaz, 'url_distribuicao', {}, 'producao'), 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx');
  assert.equal(catalogo.url(sefaz, 'url_evento', {}, 'homologacao'), 'https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx');
  assert.equal(catalogo.url(sefaz, 'url_distribuicao', { url_distribuicao_producao: 'https://outro.gov.br/x/' }, 'producao'), 'https://outro.gov.br/x', 'o digitado vence o padrão');
  assert.equal(catalogo.url(catalogo.definicao('nfse_adn'), 'url', {}, 'producao'), 'https://adn.nfse.gov.br/contribuintes');
  assert.equal(catalogo.url(catalogo.definicao('bb_extrato'), 'url_api', {}, 'producao'), 'https://api-extratos.bb.com.br/extratos/v1');
  assert.throws(() => catalogo.definicao('pix'), /desconhecida/);
  assert.equal(catalogo.definicao('bb_investimentos').automatica, false, 'o CDB só testa, até o BB dizer qual API');
});

test('configuração: parâmetros conferidos por tipo; intervalo nos limites; parâmetro desconhecido recusado', () => {
  const def = catalogo.definicao('bb_extrato');
  const ok = configuracao.validar(def, {
    ativa: true, automatica: 'true', intervalo_min: '1440',
    parametros: { usar_credenciais_da_cobranca: 'nao', client_id_producao: ' abc ', conta_id: '7', agencia: '1614-4', conta: '16773', mtls: 'sim', dias_para_tras: '3', url_api_producao: 'https://api-extratos.bb.com.br/extratos/v1/' }
  }, { parametros: { escopo: 'extrato-info' } });
  assert.deepEqual(ok.erros, []);
  assert.deepEqual(ok.valores.parametros, { escopo: 'extrato-info', usar_credenciais_da_cobranca: false, client_id_producao: 'abc', conta_id: 7, agencia: '1614', conta: '16773', mtls: 'sim', dias_para_tras: 3, url_api_producao: 'https://api-extratos.bb.com.br/extratos/v1' });
  assert.deepEqual([ok.valores.ativa, ok.valores.automatica, ok.valores.intervalo_min], [true, true, 1440]);
  const ruim = configuracao.validar(def, { intervalo_min: 5, ambiente: 'teste', parametros: { url_api_producao: 'http://inseguro', mtls: 'talvez', dias_para_tras: 99, inventado: 1 } });
  assert.equal(ruim.erros.length, 6);
  assert.ok(ruim.erros.some(e => /https:\/\//.test(e)) && ruim.erros.some(e => /"inventado"/.test(e)) && ruim.erros.some(e => /Intervalo: de 60 a 1440/.test(e)));
  assert.deepEqual(configuracao.validar(catalogo.definicao('bb_investimentos'), { automatica: true }).erros, ['Aplicações — CDB (BB): ainda não há busca automática']);
});

test('configuração: o ambiente que vale na máquina — o .env só prende em homologação, nunca liga produção', () => {
  const sefaz = catalogo.definicao('sefaz_nfe');
  const bb = catalogo.definicao('bb_extrato');
  const prod = { ambiente: 'producao' };
  assert.equal(configuracao.ambienteEfetivo(sefaz, prod, {}), 'producao');
  assert.equal(configuracao.ambienteEfetivo(sefaz, prod, { NFE_AMBIENTE: 'homologacao' }), 'homologacao');
  assert.equal(configuracao.ambienteEfetivo(bb, prod, { NFE_AMBIENTE: 'homologacao' }), 'producao', 'a trava da NF-e não prende o BB');
  assert.equal(configuracao.ambienteEfetivo(bb, prod, { BB_AMBIENTE: 'sandbox' }), 'homologacao');
  assert.equal(configuracao.ambienteEfetivo(bb, prod, { CONTABILIDADE_INTEGRACOES_AMBIENTE: 'homologacao' }), 'homologacao');
  assert.equal(configuracao.ambienteEfetivo(sefaz, { ambiente: 'homologacao' }, { NFE_AMBIENTE: 'producao' }), 'homologacao');
  assert.equal(configuracao.ambienteEfetivo(sefaz, null, {}), 'homologacao');
});

test('o que falta: certificado, CNPJ e UF; credenciais do BB; conta, escopo e a conta de teste da homologação', () => {
  const sefaz = catalogo.definicao('sefaz_nfe');
  const linha = { chave: 'sefaz_nfe', parametros: {} };
  assert.deepEqual(configuracao.pendencias(sefaz, { linha: null }), ['Falta rodar sql/contabilidade_integracoes.sql e reiniciar a API.']);
  const semNada = configuracao.pendencias(sefaz, { linha, params: {}, ambiente: 'producao', certificado: { configurado: false, erro: 'Nenhum certificado' }, fiscal: {} });
  assert.equal(semNada.length, 3);
  assert.match(semNada[0], /Certificado digital A1 .*Nenhum certificado/);
  const outroCnpj = configuracao.pendencias(sefaz, { linha, params: {}, ambiente: 'producao', certificado: { configurado: true, cnpj: '99999999000199' }, fiscal: { cnpj: '11444777000161', uf: 'MG' } });
  assert.deepEqual(outroCnpj, ['O certificado é de outro CNPJ (99.999.999/0001-99): a busca exige o e-CNPJ da empresa.']);
  assert.deepEqual(configuracao.pendencias(sefaz, { linha, params: {}, ambiente: 'producao', certificado: { configurado: true, cnpj: '11444777000242' }, fiscal: { cnpj: '11444777000161', uf: 'MG' } }), [], 'filial (mesma raiz) vale');
  const bb = catalogo.definicao('bb_extrato');
  const params = configuracao.parametros(bb, { parametros: {} });
  const faltasBB = configuracao.pendencias(bb, { linha: { parametros: {} }, params, ambiente: 'producao', certificado: { configurado: false }, credenciais: { clientId: null, appKey: 'x', secret: null } });
  assert.deepEqual(faltasBB, [
    'Sem client_id de produção (Configuração de cobrança).', 'Sem client_secret de produção guardado (Configuração de cobrança).',
    'A conexão pede o certificado da empresa (mTLS) e ele não foi encontrado.', 'Escolha a conta do Extrato bancário que recebe os lançamentos.',
    'Informe agência e conta corrente (sem o dígito).'
  ]);
  const hom = configuracao.pendencias(bb, { linha: { parametros: {} }, params: { ...params, conta_id: 1 }, ambiente: 'homologacao', certificado: { configurado: false }, credenciais: { clientId: 'a', appKey: 'b', secret: 'c' }, contas: [{ id: 1 }] });
  assert.deepEqual(hom, ['Informe a conta de teste da homologação do BB (ou agência e conta).'], 'na homologação sem mTLS o certificado não faz falta');
});

test('caixa de entrada: gravar nunca piora — XML não some, cancelada não volta, registrada não volta a nova', () => {
  const nova = entrada.mesclar(null, { origem: 'sefaz_nfe', tipo: 'nfe', chave: 'A', nsu: '1', emitente_nome: 'Vidros', valor: 10 });
  assert.equal(nova.inserir, true);
  assert.equal(nova.campos.status, 'nova');
  const completa = entrada.mesclar({ status: 'nova', resumo: true, emitente_nome: 'Vidros' }, { tipo: 'nfe', xml: '<nfeProc/>', nsu: '2', emitente_nome: 'Outro nome' });
  assert.deepEqual([completa.campos.status, completa.campos.resumo, completa.campos.xml, completa.campos.nsu, completa.campos.emitente_nome], ['completa', false, '<nfeProc/>', '2', undefined]);
  const semXml = entrada.mesclar({ status: 'completa', xml: '<nfeProc/>', resumo: false }, { tipo: 'nfe', nsu: '3' });
  assert.equal(semXml.campos.xml, undefined, 'o XML que já veio não some');
  assert.equal(semXml.campos.status, undefined);
  const cancelada = entrada.mesclar({ status: 'registrada', situacao_nota: 'cancelada' }, { tipo: 'nfe', situacao_nota: 'autorizada', xml: '<x/>' });
  assert.equal(cancelada.campos.situacao_nota, undefined, 'cancelada não volta a autorizada');
  assert.equal(cancelada.campos.status, undefined, 'registrada não volta a nova/completa');
  const evento = entrada.mesclar({ status: 'nova', eventos: [{ tpEvento: '210210', dhEvento: 'x', protocolo: '1' }] }, { eventos: [{ tpEvento: '210210', dhEvento: 'x', protocolo: '1' }, { tpEvento: '110111', dhEvento: 'y', protocolo: '2' }], situacao_nota: 'cancelada' });
  assert.equal(JSON.parse(evento.campos.eventos).length, 2, 'o mesmo evento não entra duas vezes');
  assert.equal(evento.campos.situacao_nota, 'cancelada');
  assert.equal(entrada.mesclar(null, { tipo: 'nfse', chave: 'N', xml: '<NFSe/>' }).campos.status, 'completa', 'a NFS-e já chega completa');
  const publica = entrada.linhaPublica({ id: 1, origem: 'sefaz_nfe', tipo: 'nfe', chave: 'A', status: 'nova', resumo: true, situacao_nota: 'autorizada', manifestacao: 'ciencia' });
  assert.deepEqual(publica.pode, { manifestar: true, baixar_xml: true, registrar: false, ignorar: true, restaurar: false });
  const doMes = entrada.pendenciasDoMes([
    { id: 1, tipo: 'nfe', status: 'nova', data_emissao: '2026-08-10', valor: 10 }, { id: 2, tipo: 'nfse', status: 'registrada', data_emissao: '2026-08-11' },
    { id: 3, tipo: 'nfe', status: 'registrada', situacao_nota: 'cancelada', documento_recebido_id: 9, data_emissao: '2026-07-01' }
  ], '2026-08');
  assert.deepEqual([doMes.abertas.map(x => x.id), doMes.canceladas.map(x => x.id)], [[1], [3]]);
  // A caixa de entrada usa a mesma regra do painel: a cancelada que nunca foi registrada não é pendente (30/09/2026, visto no Postgres).
  const naCaixa = [{ status: 'nova' }, { status: 'completa', situacao_nota: 'cancelada' }, { status: 'registrada', situacao_nota: 'cancelada' }, { status: 'ignorada' }];
  assert.deepEqual(Object.fromEntries(Object.entries(entrada.VISOES).map(([v, f]) => [v, naCaixa.filter(f).length])), { pendentes: 1, registradas: 1, ignoradas: 1, todas: 4 });
});

test('agenda: só a ligada e automática, uma vez por faixa do intervalo, e a trava entre máquinas', async () => {
  const chamadas = [];
  const linhas = [
    { id: 1, chave: 'sefaz_nfe', ativa: true, automatica: true, intervalo_min: 60, parametros: {} },
    { id: 2, chave: 'bb_extrato', ativa: true, automatica: false, intervalo_min: 1440, parametros: {} },
    { id: 3, chave: 'nfse_adn', ativa: false, automatica: true, intervalo_min: 180, parametros: {} },
    { id: 4, chave: 'bb_investimentos', ativa: true, automatica: true, intervalo_min: 60, parametros: {} }
  ];
  const api = { get: async caminho => (caminho === '/api/contabil_integracoes' ? linhas : []), post: async () => ({ id: 1 }), put: async () => ({}), delete: async () => ({}) };
  let agora = Date.parse('2026-09-15T12:00:00Z');
  const a = agenda.criar({
    criarApi: () => api, agora: () => agora, log: null,
    sincronizar: async (_api, chave, opcoes) => { chamadas.push([chave, opcoes.chaveExecucao]); return { situacao: 'rodou' }; }
  });
  const r1 = await a.verificar();
  assert.deepEqual(r1.integracoes, { sefaz_nfe: 'rodou', bb_extrato: 'desligada', nfse_adn: 'desligada', bb_investimentos: 'desligada' });
  assert.deepEqual(chamadas, [['sefaz_nfe', `sefaz_nfe:auto:60:${execucoes.faixaDe(agora, 60)}`]]);
  assert.equal((await a.verificar()).integracoes.sefaz_nfe, 'ja_tentada', 'a mesma faixa não roda duas vezes');
  agora += 61 * 60 * 1000;
  assert.equal((await a.verificar()).integracoes.sefaz_nfe, 'rodou');
  const outra = agenda.criar({ criarApi: () => api, agora: () => agora + 61 * 60 * 1000, log: null, sincronizar: async () => ({ situacao: 'outra_maquina' }) });
  assert.equal((await outra.verificar()).integracoes.sefaz_nfe, 'outra_maquina');
  const semSessao = agenda.criar({ criarApi: () => { throw new Error('sem sessão'); }, sincronizar: async () => ({}), log: null });
  assert.deepEqual(await semSessao.verificar(), { situacao: 'sem_sessao' });
});
