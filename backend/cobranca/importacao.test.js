/**
 * Importar boletos que já existem no BB (backend/cobranca/importacao.js), com
 * API e BB de mentira. O que se defende aqui:
 *
 *   - o nosso número tirado do campo livre da linha digitável (e a recusa do
 *     convênio que não é o nosso);
 *   - a parcela sugerida: primeiro pelo "seu número" (PED120P1), depois por
 *     documento do pagador + valor + vencimento — e nada quando há empate;
 *   - a lista do BB: páginas, "nenhum boleto" (404) e a faixa quebrada em
 *     pedaços quando o banco recusa a janela inteira;
 *   - a importação: linha com `origem = 'importado'`, evento, sincronização
 *     em seguida, sequencial empurrado e o mesmo nosso número nunca duas vezes;
 *   - a linha digitável do NOSSO convênio virando boleto de verdade, e a de
 *     outro banco seguindo como boleto de fora;
 *   - boleto importado sem parcela: pago no BB não vira recebimento solto.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const calculo = require('./boletoCalculo');
const configuracao = require('./configuracaoCobranca');
const operacoes = require('./boletoOperacoes');
const importacao = require('./importacao');

const HOJE = '2026-09-23';
const CONVENIO = '3453481';
const CONEXAO = { ambiente: 'producao', appKey: 'k', credenciais: { clientId: 'c', clientSecret: 's' } };

function cfgBase(extra = {}) {
  return {
    id: 1, ambiente: 'producao', agencia: '1614', conta: '16773', convenio: CONVENIO, carteira: 17, variacao: 19,
    especie: 'DM', aceite: false, juros_tipo: 'valor_dia', juros_percentual_mes: 9, multa_percentual: 2, multa_dias: 1,
    protesto_dias: 7, dias_limite_recebimento: 15, desconto_percentual: 0, desconto_dias: 0, indicador_pix: true,
    proximo_sequencial_producao: 394, proximo_sequencial_sandbox: 10,
    ...extra
  };
}

/** Um boleto como o BB devolve na lista (GET /boletos). */
function doBB(extra = {}) {
  return {
    numeroBoletoBB: '00034534810000000393',
    numeroTituloBeneficiario: 'PED120P1',
    dataVencimentoTituloCobranca: '15.10.2026',
    dataRegistroTituloCobranca: '15.09.2026',
    valorOriginalTituloCobranca: 1500,
    valorAtualTituloCobranca: 1500,
    codigoEstadoTituloCobranca: 1,
    estadoTituloCobranca: 'NORMAL',
    nomeSacado: 'MAG CONFECCOES LTDA',
    numeroInscricaoSacado: '98765432000110',
    numeroCarteiraCobranca: 17,
    numeroVariacaoCarteiraCobranca: 19,
    ...extra
  };
}

function apiFalsa(tabelas) {
  const dados = JSON.parse(JSON.stringify(tabelas));
  let proximoId = 900;
  const nomeDe = caminho => caminho.replace(/^\/api\//, '').split('?')[0].split('/');
  const exigir = tabela => {
    if (dados[tabela]) return dados[tabela];
    const e = new Error(`API respondeu 404 — Tabela '${tabela}' não encontrada.`);
    e.status = 404;
    throw e;
  };
  return {
    dados,
    async get(caminho, { query = {} } = {}) {
      const [tabela] = nomeDe(caminho);
      return exigir(tabela).filter(l => Object.entries(query).every(([c, v]) => String(l[c]) === String(v)));
    },
    async post(caminho, corpo) {
      const [tabela] = nomeDe(caminho);
      exigir(tabela);
      // O UNIQUE (ambiente, nosso_numero) do banco de verdade.
      if (tabela === 'boletos' && dados.boletos.some(b => b.ambiente === corpo.ambiente && b.nosso_numero === corpo.nosso_numero)) {
        const e = new Error('duplicate key value violates unique constraint "boletos_ambiente_nosso_numero_key"');
        e.status = 409;
        throw e;
      }
      const linha = { id: proximoId++, ...corpo };
      dados[tabela].push(linha);
      return linha;
    },
    async put(caminho, corpo) {
      const [tabela, id] = nomeDe(caminho);
      const linha = exigir(tabela).find(l => String(l.id) === String(id));
      if (linha) Object.assign(linha, corpo);
      return linha;
    }
  };
}

/** BB de mentira: lista por faixa (com páginas) e detalhe por nosso número. */
function bbFalso({ paginas = null, detalhe = null, recusarFaixaLarga = false, erroNoDetalhe = null } = {}) {
  const chamadas = [];
  return {
    chamadas,
    async chamar({ metodo, caminho, query }) {
      chamadas.push({ metodo, caminho, query });
      if (caminho === '/boletos') {
        const dias = (a, b) => (Date.parse(`${b.slice(6)}-${b.slice(3, 5)}-${b.slice(0, 2)}`) - Date.parse(`${a.slice(6)}-${a.slice(3, 5)}-${a.slice(0, 2)}`)) / 86400000;
        if (recusarFaixaLarga && dias(query.dataInicioVencimento, query.dataFimVencimento) > 100) {
          const e = new Error('O BB respondeu 400 em GET /boletos: período inválido.');
          e.status = 422;
          e.extra = { http: 400 };
          throw e;
        }
        const lista = paginas || [{ boletos: [doBB()] }];
        const indice = Number(query.proximoIndice || 0);
        const pagina = lista[indice] || { boletos: [] };
        if (!pagina.boletos.length && !indice) {
          const e = new Error('O BB respondeu 404 em GET /boletos: nenhum boleto.');
          e.status = 422;
          e.extra = { http: 404 };
          throw e;
        }
        return pagina;
      }
      if (metodo === 'GET' && caminho.startsWith('/boletos/')) {
        if (erroNoDetalhe) throw erroNoDetalhe;
        if (!detalhe) {
          const e = new Error('O BB respondeu 404: boleto não encontrado.');
          e.status = 422;
          e.extra = { http: 404 };
          throw e;
        }
        return detalhe;
      }
      throw new Error(`chamada inesperada ${metodo} ${caminho}`);
    }
  };
}

// ------------------------------------------------------------ puras

test('nosso número pelo campo livre: só o do nosso convênio; outro convênio ou lixo não entra', () => {
  const livre = calculo.campoLivre({ convenio: CONVENIO, sequencial: 393, carteira: 17 });
  const achado = importacao.nossoNumeroDoCampoLivre(livre, CONVENIO);
  assert.equal(achado.nosso_numero, calculo.nossoNumero(CONVENIO, 393).numeroTituloCliente);
  assert.equal(achado.sequencial, 393);
  assert.equal(achado.carteira, 17);

  assert.equal(importacao.nossoNumeroDoCampoLivre(calculo.campoLivre({ convenio: '3128557', sequencial: 9 }), CONVENIO), null, 'convênio de outra conta');
  assert.equal(importacao.nossoNumeroDoCampoLivre('123', CONVENIO), null);
  assert.equal(importacao.nossoNumeroDoCampoLivre(livre, '123'), null);
  assert.equal(importacao.sequencialDoNossoNumero('00034534810000000393'), 393);
  assert.equal(importacao.sequencialDoNossoNumero('393'), null);
});

test('parcela sugerida: pelo seu número (PED120P1), depois por documento + valor + vencimento; empate não sugere', () => {
  const pedidos = [
    { id: 12, numero: 'PED120', cliente_id: 3 },
    { id: 13, numero: 'PED121', cliente_id: 3 }
  ];
  const parcelas = [
    { id: 71, pedido_id: 12, numero_parcela: 1, valor: 1500, data_vencimento: '2026-10-15' },
    { id: 72, pedido_id: 12, numero_parcela: 2, valor: 1500, data_vencimento: '2026-11-15' },
    { id: 81, pedido_id: 13, numero_parcela: 1, valor: 1500, data_vencimento: '2026-10-15' }
  ];
  const clientes = [{ id: 3, cnpj: '98765432000110', nome_fantasia: 'MAG Confecções' }];

  const linha = importacao.normalizarDoBB(doBB());
  const pelaEtiqueta = importacao.sugerirParcela(linha, { parcelas, pedidos, clientes });
  assert.equal(pelaEtiqueta.parcela.id, 71);
  assert.equal(pelaEtiqueta.confianca, 'alta');
  assert.match(pelaEtiqueta.motivo, /PED120P1/);

  // Sem o seu número do app: documento + valor + vencimento, e só quando é uma só.
  const semEtiqueta = importacao.normalizarDoBB(doBB({ numeroTituloBeneficiario: '' }));
  assert.equal(importacao.sugerirParcela(semEtiqueta, { parcelas, pedidos, clientes }), null, 'duas parcelas combinam: não escolhe por conta própria');
  const soUma = importacao.sugerirParcela(semEtiqueta, { parcelas: parcelas.slice(0, 1), pedidos, clientes });
  assert.equal(soUma.parcela.id, 71);
  assert.equal(soUma.confianca, 'media');

  assert.deepEqual(importacao.lerSeuNumero('PED120P1'), { pedido: 'PED120', parcela: 1 });
  assert.equal(importacao.lerSeuNumero('NF 123'), null);
  assert.equal(importacao.lerSeuNumero('P1'), null);
});

test('faixa padrão de 12 meses para trás e para frente, quebrada em pedaços de 90 dias', () => {
  assert.deepEqual(importacao.faixaPadrao('2026-09-23'), { de: '2025-09-23', ate: '2027-09-23' });
  assert.equal(importacao.somarMeses('2026-03-31', -1), '2026-02-28', 'mês curto não vira o mês seguinte');
  assert.equal(importacao.diaParaBB('2026-10-15'), '15.10.2026');

  const pedacos = importacao.pedacosDaFaixa('2026-01-01', '2026-06-30');
  assert.equal(pedacos[0].de, '2026-01-01');
  assert.equal(pedacos[pedacos.length - 1].ate, '2026-06-30');
  for (const p of pedacos) assert.ok(p.de <= p.ate);
  assert.deepEqual(importacao.pedacosDaFaixa('2026-06-30', '2026-01-01'), [], 'faixa invertida não vira pedaço');
});

test('o boleto do BB no formato da tela e a linha que vai para o banco', () => {
  const linha = importacao.normalizarDoBB(doBB());
  assert.equal(linha.nosso_numero, '00034534810000000393');
  assert.equal(linha.seu_numero, 'PED120P1');
  assert.equal(linha.vencimento, '2026-10-15');
  assert.equal(linha.emissao, '2026-09-15');
  assert.equal(linha.valor, 1500);
  assert.equal(linha.pagador_documento, '98765432000110');
  assert.equal(importacao.situacaoLegivel(linha), 'NORMAL');
  assert.equal(importacao.situacaoLegivel({ codigo_estado: 7 }), operacoes.ESTADOS_BB[7]);

  const cfg = cfgBase();
  const gravada = importacao.linhaDoBoleto({
    doBB: linha, ambiente: 'producao', cfg, conta: configuracao.dadosDaConta(cfg, 'producao'),
    vinculo: { pedido_id: 12, parcela_id: 71, numero_parcela: 1 }, usuarioId: 5, agora: '2026-09-23T12:00:00.000Z'
  });
  assert.equal(gravada.origem, 'importado');
  assert.equal(gravada.status, 'registrado');
  assert.equal(gravada.sequencial, 393);
  assert.equal(gravada.nosso_numero_dv, calculo.nossoNumero(CONVENIO, 393).dv);
  assert.equal(gravada.chave_idempotencia, 'producao:00034534810000000393');
  assert.equal(gravada.pedido_id, 12);
  assert.equal(gravada.criado_por, 5);

  // Sem parcela: entra do mesmo jeito, só sem vínculo.
  const solta = importacao.linhaDoBoleto({ doBB: linha, ambiente: 'producao', cfg, conta: configuracao.dadosDaConta(cfg, 'producao') });
  assert.equal(solta.pedido_id, null);
  assert.equal(solta.parcela_id, null);
  assert.equal(solta.numero_parcela, null);
});

test('sequencial depois da importação: pula para o maior + 1, e não anda para trás', () => {
  const cfg = cfgBase({ proximo_sequencial_producao: 394 });
  assert.equal(importacao.sequencialDepoisDaImportacao(cfg, 'producao', [393, 500]), 501);
  assert.equal(importacao.sequencialDepoisDaImportacao(cfg, 'producao', [10, 20]), null, 'importado antigo não move o sequencial');
  assert.equal(importacao.sequencialDepoisDaImportacao(cfg, 'producao', []), null);
});

test('boleto pago cuja parcela já tinha recebimento à mão: mantém o lançamento e avisa as diferenças', () => {
  const boleto = { valor_pago: 1500, data_pagamento: '2026-10-16' };
  const iguais = importacao.avisosDoRecebimentoQueJaExistia(boleto, {
    ja_existia: true, recebimento: { origem: 'manual', valor_recebido: 1500, data_recebimento: '2026-10-16' }
  });
  assert.equal(iguais.length, 1);
  assert.match(iguais[0], /continua valendo/);

  const diferentes = importacao.avisosDoRecebimentoQueJaExistia(boleto, {
    ja_existia: true, recebimento: { origem: 'manual', valor_recebido: 1200, data_recebimento: '2026-10-20' }
  });
  assert.equal(diferentes.length, 3);
  assert.match(diferentes[1], /Confira o valor/);
  assert.match(diferentes[2], /Confira a data/);

  assert.deepEqual(importacao.avisosDoRecebimentoQueJaExistia(boleto, { ja_existia: false, recebimento: { origem: 'manual' } }), []);
  assert.deepEqual(importacao.avisosDoRecebimentoQueJaExistia(boleto, { ja_existia: true, recebimento: { origem: 'boleto' } }), [], 'lançado pelo próprio boleto não é conflito');
});

// ------------------------------------------------------------ lista

test('lista do BB: junta as páginas, "nenhum boleto" é lista vazia e a faixa larga é quebrada em pedaços', async () => {
  const conta = { agencia: '1614', conta: '16773', convenio: CONVENIO };
  const comPaginas = bbFalso({
    paginas: [
      { boletos: [doBB()], indicadorContinuidade: 'S', proximoIndice: 1 },
      { boletos: [doBB({ numeroBoletoBB: '00034534810000000394', numeroTituloBeneficiario: 'PED121P1' })], indicadorContinuidade: 'N' }
    ]
  });
  const r = await importacao.listarNoBB({ bb: comPaginas, conexao: CONEXAO, conta, de: '2026-09-01', ate: '2026-10-31' });
  assert.equal(r.boletos.length, 2);
  assert.equal(comPaginas.chamadas.length, 2, 'seguiu a continuidade');
  assert.equal(comPaginas.chamadas[0].query.indicadorSituacao, 'A');
  assert.equal(comPaginas.chamadas[0].query.dataInicioVencimento, '01.09.2026');

  const vazio = await importacao.listarNoBB({ bb: bbFalso({ paginas: [{ boletos: [] }] }), conexao: CONEXAO, conta, de: '2026-09-01', ate: '2026-10-31' });
  assert.deepEqual(vazio.boletos, []);

  const largo = bbFalso({ recusarFaixaLarga: true });
  const quebrado = await importacao.listarNoBB({ bb: largo, conexao: CONEXAO, conta, de: '2025-09-23', ate: '2027-09-23' });
  assert.ok(quebrado.pedacos > 1, 'quebrou em pedaços');
  assert.match(quebrado.aviso, /pedaços/);
  assert.equal(quebrado.boletos.length, 1, 'o mesmo boleto em dois pedaços não duplica');

  await assert.rejects(() => importacao.listarNoBB({ bb: largo, conexao: CONEXAO, conta, de: '2026-10-31', ate: '2026-09-01' }), /invertida/);
});

test('a lista da tela: sugestão por linha, marca de "já importado" e resumo', async () => {
  const api = apiFalsa({
    boletos: [{ id: 1, ambiente: 'producao', nosso_numero: '00034534810000000394', status: 'registrado', origem: 'app' }],
    pedidos: [{ id: 12, numero: 'PED120', cliente_id: 3, situacao: 'Enviado' }],
    pedido_parcelas: [{ id: 71, pedido_id: 12, numero_parcela: 1, valor: 1500, data_vencimento: '2026-10-15' }],
    clientes: [{ id: 3, cnpj: '98765432000110', nome_fantasia: 'MAG Confecções' }]
  });
  const bb = bbFalso({
    paginas: [{ boletos: [doBB(), doBB({ numeroBoletoBB: '00034534810000000394', numeroTituloBeneficiario: 'PED121P9' })], indicadorContinuidade: 'N' }]
  });
  const r = await importacao.listarParaImportar({
    api, bb, conexao: CONEXAO, cfg: cfgBase(), ambiente: 'producao', situacao: 'A', de: '2026-09-01', ate: '2026-12-31'
  });
  assert.equal(r.resumo.total, 2);
  assert.equal(r.resumo.ja_importados, 1);
  assert.equal(r.resumo.com_sugestao, 1);
  const novo = r.boletos.find(b => b.nosso_numero === '00034534810000000393');
  assert.equal(novo.ja_importado, false);
  assert.equal(novo.sugestao.parcela_id, 71);
  assert.equal(novo.sequencial, 393);
  const velho = r.boletos.find(b => b.nosso_numero === '00034534810000000394');
  assert.equal(velho.ja_importado, true);
  assert.equal(velho.sugestao, null, 'quem já está no app não pede sugestão');
});

// ------------------------------------------------------------ importar

function apiParaImportar(extra = {}) {
  return apiFalsa({
    configuracao_cobranca: [cfgBase()],
    boletos: [],
    boletos_eventos: [],
    pedidos: [{ id: 12, numero: 'PED120', cliente_id: 3, situacao: 'Enviado' }],
    pedido_parcelas: [{ id: 71, pedido_id: 12, numero_parcela: 1, valor: 1500, data_vencimento: '2026-10-15' }],
    recebimentos: [],
    ...extra
  });
}

const DETALHE_REGISTRADO = {
  codigoEstadoTituloCobranca: 1, dataVencimentoTituloCobranca: '15.10.2026', valorOriginalTituloCobranca: 1500,
  valorAtualTituloCobranca: 1500, valorAbatimentoTituloCobranca: 0, valorPagoSacado: 0, codigoCanalPagamento: 0,
  codigoTipoBaixaTitulo: 0, codigoLinhaDigitavel: '00190000090345348100000000039315950000150000',
  textoCodigoBarrasTituloCobranca: '00191959500001500000000003453481000000039317'
};

test('importar: grava com origem "importado", deixa evento, sincroniza e empurra o sequencial; o mesmo nunca entra duas vezes', async () => {
  // A configuração ainda está no 100: importar o 393 tem de empurrá-la.
  const cfg = cfgBase({ proximo_sequencial_producao: 100 });
  const api = apiParaImportar({ configuracao_cobranca: [cfg] });
  const bb = bbFalso({ detalhe: DETALHE_REGISTRADO });
  const linha = importacao.normalizarDoBB(doBB());
  const mapa = new Map([[linha.nosso_numero, linha]]);

  const r = await importacao.importar({
    api, bb, conexao: CONEXAO, cfg, ambiente: 'producao', hoje: HOJE, usuarioId: 5,
    escolhidos: [{ nosso_numero: linha.nosso_numero, pedido_id: 12, parcela_id: 71, numero_parcela: 1, pedido_numero: 'PED120' }],
    doBB: mapa
  });
  assert.equal(r.importados, 1);
  assert.equal(r.erros, 0);

  const gravado = api.dados.boletos[0];
  assert.equal(gravado.origem, 'importado');
  assert.equal(gravado.pedido_id, 12);
  assert.equal(gravado.parcela_id, 71);
  assert.equal(gravado.ambiente, 'producao');
  assert.ok(api.dados.boletos_eventos.some(e => e.tipo === 'importado' && e.usuario_id === 5), 'fica o rastro de quem importou');
  assert.ok(bb.chamadas.some(c => c.caminho === `/boletos/${linha.nosso_numero}`), 'sincronizou logo em seguida');
  // 393 importado: o próximo boleto gerado sai no 394.
  assert.equal(r.proximo_sequencial, 394);
  assert.equal(api.dados.configuracao_cobranca[0].proximo_sequencial_producao, 394);

  // De novo: a linha já está lá e nada é duplicado.
  const repetido = await importacao.importar({
    api, bb, conexao: CONEXAO, cfg, ambiente: 'producao', hoje: HOJE, usuarioId: 5,
    escolhidos: [{ nosso_numero: linha.nosso_numero }], doBB: mapa
  });
  assert.equal(repetido.importados, 0);
  assert.equal(repetido.ja_existiam, 1);
  assert.equal(api.dados.boletos.length, 1);
});

test('importar sem parcela: entra solto, e o pago no BB não vira recebimento — fica o alerta', async () => {
  const api = apiParaImportar();
  const bb = bbFalso({
    detalhe: { ...DETALHE_REGISTRADO, codigoEstadoTituloCobranca: 6, valorPagoSacado: 1500, dataRecebimentoTitulo: '16.10.2026', codigoCanalPagamento: 3 }
  });
  const linha = importacao.normalizarDoBB(doBB());
  const r = await importacao.importar({
    api, bb, conexao: CONEXAO, cfg: cfgBase(), ambiente: 'producao', hoje: HOJE, usuarioId: 5,
    escolhidos: [{ nosso_numero: linha.nosso_numero }], doBB: new Map([[linha.nosso_numero, linha]])
  });
  assert.equal(r.importados, 1);
  const gravado = api.dados.boletos[0];
  assert.equal(gravado.pedido_id, null);
  assert.equal(gravado.status, 'pago');
  assert.equal(api.dados.recebimentos.length, 0, 'recebimento sem parcela não existe');
  assert.ok(r.resultados[0].avisos.some(a => /não tem parcela vinculada/.test(a)));
  assert.ok(api.dados.boletos_eventos.some(e => e.tipo === 'alerta'), 'o alerta fica no histórico do boleto');
});

test('importar: boleto que sumiu da lista do BB vira erro só dele', async () => {
  const api = apiParaImportar();
  const r = await importacao.importar({
    api, bb: bbFalso(), conexao: CONEXAO, cfg: cfgBase(), ambiente: 'producao', hoje: HOJE,
    escolhidos: [{ nosso_numero: '00034534810000000999' }], doBB: new Map()
  });
  assert.equal(r.erros, 1);
  assert.match(r.resultados[0].erro, /não está mais na lista/);
  assert.equal(api.dados.boletos.length, 0);
});

// --------------------------------------------------- linha digitável

/** A linha digitável de um boleto do BB com o nosso convênio. */
function linhaDoNossoConvenio(sequencial = 393, { vencimento = '2026-10-15', valor = 1500 } = {}) {
  const livre = calculo.campoLivre({ convenio: CONVENIO, sequencial, carteira: 17 });
  const barras = calculo.codigoBarras({ vencimento, valor, campoLivre: livre });
  return calculo.linhaDigitavel(barras).digitos;
}

test('linha digitável do nosso convênio vira boleto DE VERDADE; de outro banco segue como boleto de fora', async () => {
  const api = apiParaImportar();
  const bb = bbFalso({ detalhe: DETALHE_REGISTRADO });
  const deFora = [];
  const nossa = linhaDoNossoConvenio(393);
  const outra = '34191090080123456789012345678901234567890123456';

  const previa = await importacao.informarPelaLinha({
    api, bb, conexao: CONEXAO, cfg: cfgBase(), ambiente: 'producao', pedidoId: 12, apenasPrevia: true, hoje: HOJE,
    linhas: [{ parcela_id: 71, linha: nossa }],
    informarDeFora: async ({ linhas }) => { deFora.push(...linhas); return { resultados: [] }; }
  });
  assert.equal(previa.resultados[0].no_bb, true);
  assert.match(previa.resultados[0].avisos[0], /Reconhecido no Banco do Brasil/);
  assert.equal(api.dados.boletos.length, 0, 'a prévia não grava');
  assert.equal(deFora.length, 0);

  const gravado = await importacao.informarPelaLinha({
    api, bb, conexao: CONEXAO, cfg: cfgBase(), ambiente: 'producao', pedidoId: 12, hoje: HOJE, usuarioId: 5,
    linhas: [{ parcela_id: 71, linha: nossa }],
    informarDeFora: async ({ linhas }) => { deFora.push(...linhas); return { resultados: [] }; }
  });
  assert.equal(gravado.importados, 1);
  assert.equal(api.dados.boletos[0].origem, 'importado');
  assert.equal(api.dados.boletos[0].parcela_id, 71);

  // Outro banco: nem consulta o BB, vai para o caminho de fora.
  const fora = await importacao.informarPelaLinha({
    api, bb, conexao: CONEXAO, cfg: cfgBase(), ambiente: 'producao', pedidoId: 12, hoje: HOJE,
    linhas: [{ parcela_id: 71, linha: outra }],
    informarDeFora: async ({ linhas }) => { deFora.push(...linhas); return { resultados: [{ parcela_id: 71, ok: true }] }; }
  });
  assert.equal(fora.reconhecidos_no_bb, 0);
  assert.equal(deFora.length, 1);
  assert.equal(deFora[0].linha, outra);
});

test('linha do nosso convênio que o BB não conhece segue como boleto de fora; consulta que falha vira erro da linha', async () => {
  const api = apiParaImportar();
  const nossa = linhaDoNossoConvenio(393);
  const deFora = [];

  // 404 no detalhe: o boleto não é do BB (ou não existe mais lá).
  const semBoleto = await importacao.informarPelaLinha({
    api, bb: bbFalso({ detalhe: null }), conexao: CONEXAO, cfg: cfgBase(), ambiente: 'producao', pedidoId: 12, hoje: HOJE,
    linhas: [{ parcela_id: 71, linha: nossa }],
    informarDeFora: async ({ linhas }) => { deFora.push(...linhas); return { resultados: [{ parcela_id: 71, ok: true }] }; }
  });
  assert.equal(semBoleto.reconhecidos_no_bb, 0);
  assert.equal(deFora.length, 1);

  const caiu = new Error('o BB não respondeu');
  caiu.status = 502;
  const comErro = await importacao.informarPelaLinha({
    api, bb: bbFalso({ erroNoDetalhe: caiu }), conexao: CONEXAO, cfg: cfgBase(), ambiente: 'producao', pedidoId: 12, hoje: HOJE,
    linhas: [{ parcela_id: 71, linha: nossa }],
    informarDeFora: async () => ({ resultados: [] })
  });
  assert.equal(comErro.resultados[0].ok, false);
  assert.match(comErro.resultados[0].erro, /consulta ao banco falhou/);
  assert.equal(api.dados.boletos.length, 0, 'na dúvida, não grava nada');
});

// ------------------------------------------------------------ vincular

test('vincular depois: liga o importado à parcela, recusa parcela ocupada e desliga quando pedem', async () => {
  const api = apiParaImportar({
    boletos: [
      { id: 901, ambiente: 'producao', nosso_numero: '00034534810000000393', origem: 'importado', status: 'registrado', pedido_id: null, parcela_id: null, numero_parcela: null },
      { id: 902, ambiente: 'producao', nosso_numero: '00034534810000000400', origem: 'app', status: 'registrado', pedido_id: 12, parcela_id: 71, numero_parcela: 1 }
    ]
  });
  const boleto = api.dados.boletos[0];

  await assert.rejects(
    () => importacao.vincular({ api, boleto, pedidoId: 12, parcelaId: 71, usuarioId: 5 }),
    /já tem o boleto/,
    'parcela com boleto vivo não recebe outro'
  );

  api.dados.boletos[1].status = 'baixado';
  api.dados.boletos[1].motivo_baixa = 'reemissao';
  const ligado = await importacao.vincular({ api, boleto, pedidoId: 12, parcelaId: 71, usuarioId: 5 });
  assert.equal(ligado.boleto.parcela_id, 71);
  assert.equal(ligado.boleto.numero_parcela, 1);
  assert.ok(api.dados.boletos_eventos.some(e => e.tipo === 'vinculado'));

  const solto = await importacao.vincular({ api, boleto: api.dados.boletos[0], usuarioId: 5 });
  assert.equal(solto.boleto.parcela_id, null);
  assert.ok(api.dados.boletos_eventos.some(e => e.tipo === 'desvinculado'));

  // Boleto que o app gerou não troca de parcela por aqui.
  await assert.rejects(
    () => importacao.vincular({ api, boleto: { ...api.dados.boletos[1], origem: 'app' }, pedidoId: 12, parcelaId: 71 }),
    /Só boleto importado/
  );
});

test('sem o SQL da fase, a tela avisa e a importação nem começa', async () => {
  assert.equal(importacao.sqlPronto({ id: 1, origem: 'app' }), true);
  assert.equal(importacao.sqlPronto({ id: 1 }), false);
  assert.throws(() => importacao.exigirSql({ id: 1 }), e => e.status === 409 && e.extra?.sql_pendente === true && /boletos_importados\.sql/.test(e.message));

  // Linha antiga sem a coluna `origem`: a lista avisa e o importar recusa.
  const api = apiParaImportar({ boletos: [{ id: 1, ambiente: 'producao', nosso_numero: '00034534810000000391', status: 'registrado' }] });
  const lista = await importacao.listarParaImportar({
    api, bb: bbFalso(), conexao: CONEXAO, cfg: cfgBase(), ambiente: 'producao', situacao: 'A', de: '2026-09-01', ate: '2026-12-31'
  });
  assert.equal(lista.sql_pendente, true);
  assert.equal(lista.sql_arquivo, 'sql/boletos_importados.sql');

  await assert.rejects(
    () => importacao.importar({ api, bb: bbFalso(), conexao: CONEXAO, cfg: cfgBase(), ambiente: 'producao', hoje: HOJE, escolhidos: [{ nosso_numero: '00034534810000000393' }], doBB: new Map() }),
    e => e.status === 409 && e.extra?.sql_pendente === true
  );

  // Com a coluna, segue normalmente.
  const pronta = apiParaImportar({ boletos: [{ id: 1, ambiente: 'producao', nosso_numero: '00034534810000000391', status: 'registrado', origem: 'app' }] });
  const ok = await importacao.listarParaImportar({
    api: pronta, bb: bbFalso(), conexao: CONEXAO, cfg: cfgBase(), ambiente: 'producao', situacao: 'A', de: '2026-09-01', ate: '2026-12-31'
  });
  assert.equal(ok.sql_pendente, false);
});
