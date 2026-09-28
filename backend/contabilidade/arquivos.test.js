/**
 * Arquivos da Contabilidade (backend/contabilidade/arquivos.js): as funções
 * puras e a evidência da competência (backend/contabilidade/evidencias.js).
 * O que fica preso: o conteúdo em partes de 512 KB que remontam o arquivo, o
 * sha256, o nome limpo, o vínculo conferido, o mapa por alvo (só arquivo
 * vivo) e a lista do que prova o mês — com o que FALTA marcado.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const a = require('./arquivos');
const evidencias = require('./evidencias');

test('partes de 512 KB em base64 que remontam o arquivo; sha256 do conteúdo', () => {
  const buffer = Buffer.alloc(a.TAMANHO_PARTE * 2 + 10, 7);
  const partes = a.partesDoArquivo(buffer);
  assert.equal(partes.length, 3);
  assert.deepEqual(Buffer.concat(partes.map(p => Buffer.from(p, 'base64'))), buffer);
  assert.equal(a.sha256(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('nome limpo (sem caminho nem caractere proibido) e vínculo conferido', () => {
  assert.equal(a.nomeDeArquivo('C:\\pasta\\comprovante: pix?.pdf'), 'comprovante pix.pdf');
  assert.equal(a.nomeDeArquivo(''), 'arquivo');
  assert.deepEqual(a.vinculoValido({ alvo_tipo: 'competencia', alvo_id: '2026-08' }), { alvo_tipo: 'competencia', alvo_id: '2026-08' });
  assert.deepEqual(a.vinculoValido({ alvo_tipo: 'titulo', alvo_id: 12 }), { alvo_tipo: 'titulo', alvo_id: '12' });
  assert.throws(() => a.vinculoValido({ alvo_tipo: 'pedido', alvo_id: 1 }), /a que o arquivo pertence/);
  assert.throws(() => a.vinculoValido({ alvo_tipo: 'competencia', alvo_id: '2026-13' }), /incompleto/);
  assert.throws(() => a.vinculoValido({ alvo_tipo: 'titulo', alvo_id: 'abc' }), /incompleto/);
});

test('porAlvo: só arquivo vivo e completo entra; um alvo pode ter vários', () => {
  const lista = [
    { id: 1, categoria: 'comprovante', origem: 'fornecido', nome_arquivo: 'pix.pdf', completo: true },
    { id: 2, categoria: 'nota', origem: 'fornecido', nome_arquivo: 'nf.pdf', completo: true, excluido_em: '2026-09-01' },
    { id: 3, categoria: 'recibo', origem: 'fornecido', nome_arquivo: 'r.jpg', completo: false },
    { id: 4, categoria: 'nota', origem: 'fornecido', nome_arquivo: 'nf2.pdf', completo: true }
  ];
  const vinculos = [
    { arquivo_id: 1, alvo_tipo: 'pagamento', alvo_id: '100' }, { arquivo_id: 1, alvo_tipo: 'titulo', alvo_id: '5' },
    { arquivo_id: 2, alvo_tipo: 'titulo', alvo_id: '5' }, { arquivo_id: 3, alvo_tipo: 'titulo', alvo_id: '5' }, { arquivo_id: 4, alvo_tipo: 'titulo', alvo_id: '5' }
  ];
  const mapa = a.porAlvo(lista, vinculos);
  assert.deepEqual(mapa.get('titulo:5').map(x => x.id), [1, 4]);
  assert.deepEqual(mapa.get('pagamento:100').map(x => x.categoria), ['comprovante']);
  assert.equal(a.CATEGORIAS_DE_DOCUMENTO.has('comprovante'), false, 'comprovante não é documento fiscal');
});

test('evidências: notas de saída, de fora e devolução do mês; documento sem arquivo vira FALTA; comprovantes e outros', () => {
  const r = evidencias.montar({
    competencia: '2026-08',
    pedidos: new Map([['1', '2540'], ['2', '2541']]),
    notas: [
      { id: 10, pedido_id: 1, serie: 2, numero: 10, status_fiscal: 'autorizada', valor_total: '1500.00', data_emissao: '2026-08-05T10:00:00-03:00', xml_autorizado: '<x/>', destinatario: '{"nome":"Casa Vicenzo"}' },
      { id: 11, pedido_id: 2, serie: 2, numero: 11, status_fiscal: 'rejeitada', valor_total: 10, data_emissao: '2026-08-06', xml_envio: '<x/>' },
      { id: 12, pedido_id: 2, serie: 2, numero: 12, status_fiscal: 'autorizada', valor_total: 10, data_emissao: '2026-09-06', xml_autorizado: '<x/>' }
    ],
    externasLista: [{ id: 3, pedido_id: 2, serie: 1, numero: 77, data_emissao: '2026-08-20', valor_total: 99, tem_xml: false }],
    devolucoes: [{ id: 4, pedido_id: 1, serie: 1, numero: 5, data_emissao: '2026-08-25', valor_total: 300, emitente_nome: 'Casa Vicenzo', protocolo: '1', xml: '<x/>' }],
    docs: [
      { id: 20, tipo: 'nfe', serie: '1', numero: '1234', emitente_nome: 'Vidros Norte', data_emissao: '2026-08-10', competencia: '2026-08', valor_total: 1200 },
      { id: 21, tipo: 'nfse', numero: '45', emitente_nome: 'Ana', data_emissao: '2026-08-15', competencia: '2026-08', valor_total: 1000 },
      { id: 22, tipo: 'outro', especie: 'recibo', emitente_nome: 'Frete', data_emissao: '2026-08-16', competencia: '2026-08', valor_total: 80, excluido_em: '2026-08-17' }
    ],
    arquivosLista: [
      { id: 30, nome: 'nf1234.pdf', categoria: 'nota', categoria_rotulo: 'Nota fiscal (PDF)', origem: 'fornecido', competencia: '2026-08', vinculos: [{ alvo_tipo: 'documento_recebido', alvo_id: '20', rotulo: 'Documento recebido' }] },
      { id: 31, nome: 'pix.pdf', descricao: 'Pix da parcela 1', categoria: 'comprovante', categoria_rotulo: 'Comprovante de pagamento', origem: 'fornecido', competencia: '2026-08', criado_em: '2026-08-11T10:00:00-03:00', vinculos: [{ alvo_tipo: 'pagamento', alvo_id: '100', rotulo: 'Pagamento de conta' }] },
      { id: 32, nome: 'contrato.pdf', categoria: 'contrato', categoria_rotulo: 'Contrato', origem: 'fornecido', competencia: '2026-08', criado_em: '2026-08-02T10:00:00-03:00', vinculos: [] }
    ]
  });
  assert.deepEqual(r.itens.map(i => [i.grupo, i.titulo, i.falta]), [
    ['saida', 'NF-e 2/10', false],
    ['saida', 'NF-e de fora 1/77', true],
    ['devolucao', 'NF-e de devolução 1/5', false],
    ['recebidos', 'NF-e 1/1234', false],
    ['recebidos', 'NF-e 1/1234', true],
    ['recebidos', 'NFS-e 45', true],
    ['pagamentos', 'Pix da parcela 1', false],
    ['outros', 'contrato.pdf', false]
  ]);
  assert.equal(r.itens[0].detalhe, 'Pedido 2540 · Casa Vicenzo');
  assert.deepEqual(r.itens[0].baixar, { tipo: 'saida', id: 10 });
  assert.equal(r.itens[4].falta_rotulo, 'Sem o XML', 'a NF-e só com o PDF ainda pede o XML');
  assert.deepEqual(r.totais, { total: 8, oficial: 3, interno: 0, fornecido: 3, falta: 3, por_grupo: { saida: 2, devolucao: 1, recebidos: 3, pagamentos: 1, outros: 1 } });
  assert.equal(r.itens[6].origem_rotulo, 'Fornecido');
});
