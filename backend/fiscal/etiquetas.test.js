/**
 * Etiquetas das caixas (backend/fiscal/etiquetas.js), pelos modelos do dono
 * de 24/09/2026: uma de transporte e uma "ATENÇÃO" por volume, duas por
 * folha; o volume ímpar sozinho no centro; peso = peso bruto; dimensão em mm.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const e = require('./etiquetas');

const conta = (texto, trecho) => texto.split(trecho).length - 1;

test('as contas: peso bruto com três casas, dimensão em mm, número do volume e os pares da folha', () => {
  assert.equal(e.pesoImpresso(11), '11,000');
  assert.equal(e.pesoImpresso('5.2'), '5,200');
  assert.equal(e.pesoImpresso(null), '');
  assert.equal(e.dimensaoImpressa({ comprimento: 440, largura: 665, altura: 270 }), '440 x 665 x 270');
  assert.equal(e.dimensaoImpressa({ comprimento: 440, largura: null, altura: 270 }), '', 'faltando uma, fica em branco');
  assert.equal(e.numeroDoVolume('363', 1, 2), '363_01/02');
  assert.equal(e.numeroDoVolume('359', 1, 1), '359_01/01');
  assert.deepEqual(e.emPares([1, 2, 3]), [[1, 2], [3]]);
  assert.equal(e.transportadoraDe({ transportadora: 'VIPEX' }, 'Outra'), 'VIPEX');
  assert.equal(e.transportadoraDe({ transportadora: 'Não Definida' }, 'TRANSMISSAN'), 'TRANSMISSAN', '"Não definida" não conta');
});

test('de onde vêm os volumes: o que foi informado no envio (com dimensões), o XML da nota, o resumo do pedido', () => {
  const gravados = e.volumesParaEtiquetas({
    pedido: { volumes_detalhe: JSON.stringify([{ peso_bruto: 11, comprimento_mm: 440, largura_mm: 665, altura_mm: 270 }, { peso_bruto: 5.2 }]) },
    volumesDoXml: [{ quantidade: '1', pesoB: '99' }]
  });
  assert.deepEqual(gravados.map(v => [v.peso_bruto, e.dimensaoImpressa(v.dimensoes)]), [[11, '440 x 665 x 270'], [5.2, '']], 'o informado no envio vence o XML');

  const doXml = e.volumesParaEtiquetas({ pedido: {}, volumesDoXml: [{ quantidade: '1', pesoB: '11.000' }, { quantidade: '1', pesoB: '5.200' }] });
  assert.deepEqual(doXml.map(v => v.peso_bruto), [11, 5.2]);
  const juntos = e.volumesParaEtiquetas({ pedido: {}, volumesDoXml: [{ quantidade: '3', pesoB: '30' }] });
  assert.deepEqual(juntos.map(v => v.peso_bruto), [null, null, null], 'um <vol> com 3 caixas: 3 etiquetas, sem inventar o peso de cada uma');

  assert.deepEqual(e.volumesParaEtiquetas({ pedido: { volumes_quantidade: 1, peso_bruto: '24.9' } }).map(v => v.peso_bruto), [24.9]);
  assert.deepEqual(e.volumesParaEtiquetas({ pedido: { volumes_quantidade: 0 } }), []);
  assert.deepEqual(e.volumesDoPedido({ volumes_detalhe: 'não é json' }), []);
});

test('o PDF: transporte em paisagem (duas por folha; a ímpar sozinha no centro) e "ATENÇÃO" em retrato (duas por folha)', () => {
  const tres = e.montarEtiquetasHtml({
    cliente: { razao: 'MAROMBA MÓVEIS LTDA', fantasia: 'Novo Ambiente' }, nf: '363', referencia: '363', transportadora: 'VIPEX',
    volumes: [{ peso_bruto: 11, dimensoes: { comprimento: 440, largura: 665, altura: 270 } }, { peso_bruto: 5.2 }, { peso_bruto: 1 }],
    marca: 'data:image/png;base64,AAA'
  });
  assert.match(tres, /@page paisagem \{ size: A4 landscape;/);
  assert.match(tres, /@page retrato \{ size: A4 portrait;/);
  assert.equal(conta(tres, '<section class="folha-p">'), 2, '3 volumes: 2 folhas de transporte');
  assert.equal(conta(tres, '<div class="sozinha">'), 1, 'a terceira sozinha, no centro');
  assert.equal(conta(tres, '<section class="folha-r">'), 2, '3 "ATENÇÃO": 2 folhas');
  assert.equal(conta(tres, 'class="transporte"'), 3);
  assert.equal(conta(tres, 'class="aviso"'), 3);
  for (const v of ['363_01/03', '363_02/03', '363_03/03']) assert.ok(tres.includes(v), v);
  assert.ok(tres.includes('<span class="razao">MAROMBA MÓVEIS LTDA</span>') && tres.includes('<span class="fantasia">Novo Ambiente</span>'), 'razão social acima da linha, fantasia abaixo');
  assert.ok(tres.includes('.cliente .razao { font-weight: 700;'), 'a razão social em negrito');
  assert.ok(tres.includes('11,000') && tres.includes('440 x 665 x 270') && tres.includes('VIPEX'));
  assert.ok(tres.includes('FRÁGIL') && tres.includes('ATENÇÃO') && tres.includes('mantenha<br>esse lado<br>para cima'));
  assert.equal(conta(tres, 'data:image/png;base64,AAA'), 1, 'a marca entra uma vez só (no CSS)');
  assert.ok(tres.includes(e.EMPRESA.nome) && tres.includes('(31) 3357-4894') && tres.includes('www.santissimodecor.com.br'));

  const duas = e.montarEtiquetasHtml({ nf: '1', volumes: [{}, {}], marca: '' });
  assert.equal(conta(duas, '<section class="folha-p">'), 1, 'par: as duas na mesma folha');
  assert.equal(conta(duas, '<div class="sozinha">'), 0);
  assert.equal(conta(duas, '<section class="folha-r">'), 1);
  assert.ok(e.montarEtiquetasHtml({ cliente: { razao: '<b>x</b>' }, volumes: [{}], marca: '' }).includes('&lt;b&gt;x&lt;/b&gt;'), 'o texto é escapado');
});

test('lê o pedido: cliente, a NF-e daqui (ou o número do pedido, sem nota) e os volumes; sem volumes, 409', async () => {
  const tabelas = {
    pedidos: [{ id: 5, numero: 'PED104', cliente_id: 9, transportadora: 'VIPEX', volumes_detalhe: JSON.stringify([{ peso_bruto: 11, comprimento_mm: 440, largura_mm: 665, altura_mm: 270 }]) }],
    clientes: [{ id: 9, razao_social: 'MAROMBA MÓVEIS LTDA', nome_fantasia: 'Novo Ambiente' }],
    notas_fiscais: [{ id: 1, pedido_id: 5, numero: 363, status_fiscal: 'autorizada', xml_autorizado: '' }]
  };
  const api = { get: async (caminho, { query = {} } = {}) => (tabelas[caminho.replace('/api/', '')] || []).filter(l => Object.entries(query).every(([c, v]) => String(l[c]) === String(v))) };
  const r = await e.etiquetasDoPedido(api, 5);
  assert.equal(r.nome, 'Etiquetas-NF-363');
  assert.equal(r.volumes, 1);
  assert.ok(r.html.includes('363_01/01') && r.html.includes('MAROMBA MÓVEIS LTDA') && r.html.includes('Novo Ambiente') && r.html.includes('11,000'));

  tabelas.notas_fiscais = [];
  const semNota = await e.etiquetasDoPedido(api, 5);
  assert.ok(semNota.html.includes('PED104_01/01'), 'sem nota: o número do pedido no volume');
  assert.equal(semNota.nome, 'Etiquetas-PED104');

  tabelas.pedidos[0].volumes_detalhe = null;
  tabelas.pedidos[0].volumes_quantidade = 0;
  await assert.rejects(() => e.etiquetasDoPedido(api, 5), err => err.status === 409 && /volumes/.test(err.message));
  await assert.rejects(() => e.etiquetasDoPedido(api, 77), err => err.status === 404);
});
