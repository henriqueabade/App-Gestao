/**
 * Fase I (02/10/2026) — o pacote por pagamento: as partes puras.
 *
 * O que fica preso:
 *   - o nome da pasta (número, dia-mês, quem recebeu, valor; sem acento, curto);
 *   - onde está a nota: neste pacote (com o caminho), no pacote em que foi
 *     enviada (achado pelo SHA-256; o enviado vence o só gerado), de outro mês
 *     ainda sem pacote, ou registrada sem o arquivo;
 *   - a pasta de cada pagamento do mês (conta a pagar, comissão/produção,
 *     reembolso): a conta e a parcela, a nota, o boleto do DDA (pela parcela ou
 *     pelo comprovante), o lançamento do extrato, o comprovante do BB e os
 *     anexos — o arquivo de uma nota nunca entra (vai no mês fiscal); o que
 *     falta; estornado e recebimento ficam de fora;
 *   - o dossiê em HTML: as seções, o que falta e o texto escapado.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const pg = require('./pagamentos');
const dossie = require('./dossiePagamento');

test('nome da pasta: número, dia-mês, quem recebeu (3 palavras, sem acento) e valor', () => {
  assert.equal(pg.nomeDaPasta(1, { data: '2026-08-05', nome: 'Imobiliária Centro', valor: 2500 }), '001 05-08 Imobiliaria Centro 2.500,00');
  assert.equal(pg.nomeDaPasta(12, { data: '2026-08-31', nome: 'Companhia Energética de Minas Gerais — CEMIG', valor: 410.55 }), '012 31-08 Companhia Energetica de 410,55');
  assert.equal(pg.nomeDaPasta(3, { data: '2026-08-15', nome: null, rotulo: 'Comissões de julho/2026 — Ana', valor: 900 }), '003 15-08 Comissoes de julho 900,00');
});

test('onde está a nota: neste pacote, no pacote em que foi enviada (pelo SHA-256), de outro mês ou sem o arquivo', () => {
  const xml = { id: 40, sha256: 'f'.repeat(64) };
  assert.deepEqual(pg.ondeEstaANota({ doc: { competencia: '2026-08' }, arquivosDoDoc: [xml], competencia: '2026-08', caminhos: new Map([['40', '05-Recebidos/nfe.xml']]) }),
    { situacao: 'neste', texto: 'Neste pacote: 05-Recebidos/nfe.xml' });
  assert.equal(pg.ondeEstaANota({ doc: { competencia: '2026-08' }, arquivosDoDoc: [], competencia: '2026-08' }).situacao, 'sem_arquivo');
  const pacotes = [
    { competencia: '2026-07', versao: 1, nome_arquivo: 'Contabilidade-2026-07-v1.zip', gerado_em: '2026-08-05T10:00:00Z', enviado_em: '2026-08-06T13:00:00Z', enviado_para: 'contabil@aea.com.br', arquivos: JSON.stringify([{ pasta: '05-Recebidos', nome: 'nfe.xml', sha256: 'f'.repeat(64) }]) },
    // Uma versão mais nova, só gerada: o enviado vale mais.
    { competencia: '2026-07', versao: 2, nome_arquivo: 'Contabilidade-2026-07-v2.zip', gerado_em: '2026-08-20T10:00:00Z', enviado_em: null, arquivos: [{ pasta: '05-Recebidos', nome: 'nfe.xml', sha256: 'f'.repeat(64) }] }
  ];
  const enviada = pg.ondeEstaANota({ doc: { competencia: '2026-07' }, arquivosDoDoc: [xml], competencia: '2026-08', pacotes });
  assert.equal(enviada.situacao, 'enviada');
  assert.equal(enviada.texto, 'Enviada no pacote Contabilidade-2026-07-v1.zip (julho/2026, versão 1), arquivo 05-Recebidos/nfe.xml (SHA-256 ffffffffffffffff…), em 06/08/2026 para contabil@aea.com.br.');
  const gerada = pg.ondeEstaANota({ doc: { competencia: '2026-07' }, arquivosDoDoc: [xml], competencia: '2026-08', pacotes: [pacotes[1]] });
  assert.equal(gerada.situacao, 'gerada');
  assert.match(gerada.texto, /gerado em 20\/08\/2026 \(ainda não marcado como enviado\)\.$/);
  assert.deepEqual(pg.ondeEstaANota({ doc: { competencia: '2026-07' }, arquivosDoDoc: [{ id: 41, sha256: 'a'.repeat(64) }], competencia: '2026-08', pacotes }),
    { situacao: 'outro_mes', texto: 'É de julho/2026: vai no pacote daquele mês (ainda não foi em pacote nenhum).' });
  assert.equal(pg.ondeEstaANota({ doc: { competencia: '2026-09' }, arquivosDoDoc: [], competencia: '2026-08', pacotes }).situacao, 'sem_arquivo');
});

const liq = (tipo, id, extra = {}) => ({
  chave: `${tipo}:${id}`, tipo, tipo_rotulo: { titulo_pagamento: 'Pagamento de conta', financeiro_pagamento: 'Comissão/produção', reembolso: 'Reembolso', recebimento: 'Recebimento' }[tipo],
  id, data: '2026-08-10', valor: tipo === 'recebimento' ? 100 : -100, valor_abs: 100, forma: 'Pix', rotulo: `${tipo} ${id}`, nome: null, documento: null,
  estornado: false, obrigacao: false, no_banco: true, ...extra
});
const arq = (id, categoria, extra = {}) => ({ id, nome: `${categoria}-${id}.pdf`, categoria, categoria_rotulo: categoria, origem: 'fornecido', origem_rotulo: 'Fornecido', sha256: String(id).repeat(64).slice(0, 64), ...extra });

function cenario() {
  const titulo = { id: 1, descricao: 'NF-e 1/4521 — Vidros Norte', fornecedor: 'Vidros Norte', fornecedor_documento: '84.031.759/0001-21', categoria: '00340 · Compras', numero_documento: '4521', competencia: '2026-07', valor_total: 4000, situacao_rotulo: 'Paga', origem: 'nfe', documento_recebido_id: 5 };
  const parcela = { id: 22, numero: 2, de: 2, vencimento: '2026-08-20', valor: 2000, linha_digitavel: null, pagamento: { id: 102, juros: 0, desconto: 0, observacao: null } };
  const boleto = { id: 9, situacao: 'vinculado', parcela_id: 22, beneficiario_nome: 'VIDROS NORTE LTDA', vencimento: '2026-08-20', valor: 2000, linha_digitavel: '2379' + '0'.repeat(43) };
  return {
    competencia: '2026-08',
    liquidacoesLista: [
      liq('titulo_pagamento', 102, { data: '2026-08-20', valor_abs: 2000, forma: 'Boleto', rotulo: 'NF-e 1/4521 — Vidros Norte · parcela 2/2', nome: 'Vidros Norte' }),
      liq('financeiro_pagamento', 70, { data: '2026-08-15', valor_abs: 900, rotulo: 'Comissões de julho/2026 — Ana', nome: 'Ana' }),
      liq('reembolso', 3, { data: '2026-08-25', valor_abs: 300, rotulo: 'Reembolso do pedido 2540', nome: 'Casa Vicenzo', forma: 'Dinheiro', no_banco: false }),
      liq('titulo_pagamento', 103, { estornado: true }), liq('recebimento', 1), liq('titulo_pagamento', 104, { data: '2026-07-31' })
    ],
    pagamentosDeConta: new Map([['102', { titulo, parcela }]]),
    documentosPorId: new Map([['5', { id: 5, tipo: 'nfe', serie: '1', numero: '4521', emitente_nome: 'Vidros Norte', emitente_documento: '84031759000121', data_emissao: '2026-07-20', competencia: '2026-07', valor_total: 4000 }]]),
    documentosDoFechamento: new Map([['70', [{ id: 6, tipo: 'nfse', numero: '17', emitente_nome: 'Ana', data_emissao: '2026-08-14', competencia: '2026-08', valor_total: 900 }]]]),
    reembolsos: new Map([['3', { id: 3, pedido_id: 1 }]]),
    devolucoesDoPedido: new Map([['1', [{ serie: 1, numero: 5, chave_acesso: '3126…', data_emissao: '2026-08-24', valor_total: 300 }]]]),
    arquivosPorAlvo: new Map([
      ['titulo:1', [arq(9, 'boleto'), arq(40, 'xml_nfe')]], ['pagamento:102', [arq(21, 'recibo')]],
      ['documento_recebido:5', [arq(40, 'xml_nfe', { sha256: 'f'.repeat(64) })]], ['documento_recebido:6', [arq(41, 'nfse')]]
    ]),
    arquivosDeDocumento: new Set(['40', '41']),
    vinculosPorChave: new Map([['titulo_pagamento:102', [{ movimento_id: 6, criterio: 'automatico' }]], ['financeiro_pagamento:70', [{ movimento_id: 5, criterio: 'manual' }]]]),
    movimentosPorId: new Map([
      ['6', { id: 6, conta_id: 1, data: '2026-08-20', valor: -2000, descricao: 'PAGAMENTO DE BOLETO', documento: '82001', contrapartida_documento: '84031759000121', estado_conciliacao: 'conciliado' }],
      ['5', { id: 5, conta_id: 1, data: '2026-08-15', valor: -900, descricao: 'PIX ENVIADO - ANA', estado_conciliacao: 'conciliado' }]
    ]),
    contasBanco: new Map([['1', 'BB — conta corrente']]),
    comprovantesDoMovimento: new Map([['6', [{ id: 4, tipo: 'boleto', data: '2026-08-20', valor: 2000, nome_arquivo: '6 - 20082026 - Pagamento - 2.000,00.pdf', confere: true, autenticacao: 'B.9C8', dda_boleto_id: 9 }]]]),
    boletoDaParcela: new Map(), boletosPorId: new Map([['9', boleto]]),
    pacotes: [{ competencia: '2026-07', versao: 1, nome_arquivo: 'Contabilidade-2026-07-v1.zip', gerado_em: '2026-08-05T10:00:00Z', enviado_em: '2026-08-06T13:00:00Z', arquivos: JSON.stringify([{ pasta: '05-Recebidos', nome: 'nfe.xml', sha256: 'f'.repeat(64) }]) }]
  };
}

test('a pasta de cada pagamento do mês: conta, parcela, nota de outro mês já enviada, boleto do DDA pelo comprovante, extrato, comprovante e anexos (nunca o arquivo da nota)', () => {
  const { pagamentos, usados } = pg.planoDosPagamentos(cenario());
  assert.deepEqual(pagamentos.map(p => [p.pasta, p.tipo]), [
    ['001 15-08 Ana 900,00', 'financeiro_pagamento'],
    ['002 20-08 Vidros Norte 2.000,00', 'titulo_pagamento'],
    ['003 25-08 Casa Vicenzo 300,00', 'reembolso']
  ], 'só os pagamentos do mês, em ordem de data; estornado, recebimento e o de julho ficam de fora');
  const [ana, vidros, reembolso] = pagamentos;
  assert.deepEqual([vidros.conta.descricao, vidros.parcela.numero, vidros.parcela.de], ['NF-e 1/4521 — Vidros Norte', 2, 2]);
  assert.deepEqual(vidros.documentos.map(d => [d.rotulo, d.onde.situacao]), [['NF-e 1/4521', 'enviada']]);
  assert.equal(vidros.dda.id, 9, 'o boleto do DDA veio pelo comprovante ligado');
  assert.deepEqual(vidros.movimentos.map(m => [m.id, m.conta, m.criterio, m.contrapartida]), [[6, 'BB — conta corrente', 'automático', '84.031.759/0001-21']]);
  assert.deepEqual(vidros.comprovantes.map(x => x.id), [4]);
  assert.deepEqual(vidros.arquivos.map(a => a.id), [21, 9], 'o recibo do pagamento e o boleto da conta; o XML da nota não');
  assert.deepEqual(vidros.faltas, []);
  assert.deepEqual(ana.documentos.map(d => [d.rotulo, d.onde.situacao]), [['NFS-e 17', 'neste']]);
  assert.deepEqual(ana.faltas, ['Sem o comprovante do banco']);
  assert.deepEqual(reembolso.devolucoes.map(n => n.rotulo), ['NF-e de devolução 1/5']);
  assert.deepEqual(reembolso.faltas, [], 'pago em dinheiro: sem extrato nem comprovante a cobrar');
  assert.deepEqual([[...usados.comprovantes], [...usados.arquivos]], [['4'], ['21', '9']]);
  assert.deepEqual(pg.pastaPublica(vidros).itens, ['Dossiê do pagamento', 'Comprovante', 'Espelho DDA', 'Boleto do fornecedor', '1 outro anexo']);

  // Sem nada: o que falta aparece.
  const vazio = pg.planoDosPagamentos({ competencia: '2026-08', liquidacoesLista: [liq('titulo_pagamento', 1, { forma: 'Boleto' })] }).pagamentos[0];
  assert.deepEqual(vazio.faltas, ['Sem o lançamento do extrato (a conciliar)', 'Sem o comprovante do banco', 'Pago por boleto, sem o boleto', 'Sem nota, recibo ou guia ligados']);
});

test('o dossiê em HTML: as seções da cadeia, o que falta (ou "completa"), onde está a nota e o texto escapado', () => {
  const { pagamentos } = pg.planoDosPagamentos(cenario());
  const vidros = pagamentos[1];
  vidros.conta.descricao = 'NF-e <b>1/4521</b>';
  const html = dossie.montarHtml(vidros, {
    empresa: { razao_social: 'SANTÍSSIMO DECOR LTDA', cnpj: '11.444.777/0001-61' }, competencia: '2026-08', geradoEm: '2026-09-01T10:00:00-03:00',
    espelho: 'Espelho DDA 20-08-2026 VIDROS NORTE LTDA 2000,00.pdf', nomesDosComprovantes: new Map([['4', '6 - 20082026 - Pagamento - 2.000,00.pdf']]),
    arquivosDaPasta: [{ nome: 'boleto-9.pdf', tipo: 'Boleto', origem_rotulo: 'Fornecido', sha256: 'a'.repeat(64) }]
  });
  for (const trecho of ['<h1>Dossiê do pagamento</h1>', 'DOCUMENTO INTERNO', 'A cadeia está completa', 'O pagamento', 'A conta a pagar', 'A nota', 'O boleto', 'No banco (extrato)', 'O comprovante do banco', 'Arquivos desta pasta',
    '2 de 2 · vence em 20/08/2026', 'Enviada no pacote Contabilidade-2026-07-v1.zip', 'Espelho DDA 20-08-2026 VIDROS NORTE LTDA 2000,00.pdf', 'refeito dos dados, idêntico ao original do BB', 'a'.repeat(64),
    'Competência agosto/2026 · SANTÍSSIMO DECOR LTDA · CNPJ 11.444.777/0001-61', 'gerado pelo App-Gestão em 01/09/2026 às 10:00']) {
    assert.ok(html.includes(trecho), trecho);
  }
  assert.ok(html.includes('NF-e &lt;b&gt;1/4521&lt;/b&gt;') && !html.includes('<b>1/4521</b>'), 'o texto vem escapado');
  const ana = dossie.montarHtml(pagamentos[0], { competencia: '2026-08' });
  assert.ok(ana.includes('<li>Sem o comprovante do banco</li>') && ana.includes('O fechamento pago') && ana.includes('Neste pacote'));
  const reembolso = dossie.montarHtml(pagamentos[2], { competencia: '2026-08' });
  assert.ok(reembolso.includes('NF-e de devolução 1/5') && reembolso.includes('Pago fora do banco (Dinheiro)'));
});
