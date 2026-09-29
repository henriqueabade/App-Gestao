/**
 * Contabilidade — etapa 9: o ZIP próprio (sem biblioteca de fora) e as partes
 * puras do pacote (as pastas, o que falta, nomes, índice, LEIA-ME, envio).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const zip = require('./zip');
const p = require('./pacote');

test('ZIP: o CRC-32 padrão, a data do MS-DOS e o que entra sai igual (texto comprimido, binário cru, nome com acento)', () => {
  assert.equal(zip.crc32(Buffer.from('123456789')), 0xCBF43926, 'valor de conferência do CRC-32');
  assert.deepEqual(zip.dataDos('2026-09-29T11:30:10-03:00'), { data: ((2026 - 1980) << 9) | (9 << 5) | 29, hora: (11 << 11) | (30 << 5) | 5 });
  const texto = 'Pacote da contabilidade — agosto/2026\r\n'.repeat(200);
  const binario = crypto.randomBytes(3000);
  const bytes = zip.zipar([
    { nome: 'Contabilidade-2026-08-v1/LEIA-ME.txt', dados: texto },
    { nome: 'Contabilidade-2026-08-v1/05-Documentos-recebidos/NFS-e São João — ação.pdf', dados: binario },
    { nome: 'Contabilidade-2026-08-v1/vazio.txt', dados: '' }
  ], { quando: '2026-09-29T11:30:10-03:00' });
  assert.equal(bytes.readUInt32LE(0), 0x04034b50);
  assert.equal(bytes.readUInt16LE(6), 0x0800, 'nomes em UTF-8');
  const lidos = zip.ler(bytes);
  assert.deepEqual(lidos.map(x => [x.nome, x.metodo]), [
    ['Contabilidade-2026-08-v1/LEIA-ME.txt', 8],
    ['Contabilidade-2026-08-v1/05-Documentos-recebidos/NFS-e São João — ação.pdf', 0],
    ['Contabilidade-2026-08-v1/vazio.txt', 0]
  ]);
  assert.equal(lidos[0].dados.toString('utf8'), texto);
  assert.ok(lidos[1].dados.equals(binario));
  assert.equal(lidos[2].dados.length, 0);
  assert.ok(bytes.length < texto.length, 'o texto repetido foi comprimido');
  assert.throws(() => zip.zipar([{ nome: 'a.txt', dados: 'x' }, { nome: 'a.txt', dados: 'y' }]), /repetido/);
  const estragado = Buffer.from(bytes);
  // Um byte dos dados comprimidos do LEIA-ME (depois do cabeçalho de 30 bytes e do nome).
  estragado[30 + Buffer.byteLength('Contabilidade-2026-08-v1/LEIA-ME.txt') + 10] ^= 0xFF;
  assert.throws(() => zip.ler(estragado));
});

const item = (grupo, extra = {}) => ({ chave: `${grupo}:${extra.id || 1}`, grupo, titulo: 'Doc', detalhe: null, valor: 10, data: '2026-08-05', baixar: { tipo: 'arquivo', id: 1 }, falta: false, ...extra });

test('pastas: cada item dos Documentos da competência na sua pasta; o OFX vai para o extrato; o que falta fica listado', () => {
  const itens = [
    item('saida', { baixar: { tipo: 'saida', id: 5 }, titulo: 'NF-e 2/10' }),
    item('devolucao', { baixar: { tipo: 'devolucao', id: 3 } }),
    item('recebidos', { titulo: 'NF-e 1/99', detalhe: 'Madeiras Silva', falta: true, falta_rotulo: 'Sem o XML', baixar: null }),
    item('recebidos', { titulo: 'NFS-e 77' }),
    item('pagamentos', { titulo: 'Pix da parcela 1' }),
    item('outros', { titulo: 'Extrato BB — conta corrente', categoria: 'Extrato bancário' }),
    item('outros', { titulo: 'SIMULADO-extrato.ofx', categoria: 'Outro' }),
    item('outros', { titulo: 'Contrato de locação', categoria: 'Contrato' }),
    item('saida', { titulo: 'NF-e de fora 1/5', falta: true, falta_rotulo: 'Sem o XML (informada só pela chave)', baixar: null })
  ];
  const plano = p.planoDoPacote(itens);
  assert.deepEqual(plano.aLer.map(x => [x.chave, x.item.titulo]), [
    ['saida', 'NF-e 2/10'], ['devolucao', 'Doc'], ['recebidos', 'NFS-e 77'], ['pagamentos', 'Pix da parcela 1'],
    ['extrato', 'Extrato BB — conta corrente'], ['extrato', 'SIMULADO-extrato.ofx'], ['outros', 'Contrato de locação']
  ]);
  assert.deepEqual(plano.faltando, [
    { titulo: 'NF-e 1/99', detalhe: 'Madeiras Silva', motivo: 'Sem o XML' },
    { titulo: 'NF-e de fora 1/5', detalhe: null, motivo: 'Sem o XML (informada só pela chave)' }
  ]);
  assert.deepEqual(Object.values(p.PASTAS).map(x => x.pasta), ['01-Relatorio', '02-Extrato', '03-NF-e-de-saida', '04-Devolucoes', '05-Recebidos', '06-Comprovantes', '07-Outros']);
});

test('nomes: seguros para o Windows e sem repetir na mesma pasta; o índice em CSV com o SHA-256; o LEIA-ME', () => {
  assert.equal(p.nomeSeguro('C:\\pasta\\nota: "fiscal"?.pdf'), 'nota fiscal.pdf');
  assert.equal(p.nomeSeguro('   '), 'arquivo');
  const usados = new Set();
  assert.deepEqual(['nota.pdf', 'Nota.pdf', 'nota.pdf', 'sem-extensao', 'sem-extensao'].map(n => p.nomeUnico(n, usados)), ['nota.pdf', 'Nota (2).pdf', 'nota (3).pdf', 'sem-extensao', 'sem-extensao (2)']);
  const csv = p.indiceCsv([{ pasta: '07-Outros', nome: 'a;b.pdf', tipo: 'Contrato', origem_rotulo: 'Fornecido', documento: 'Contrato "novo"', data: '2026-08-05', valor: 1234.5, tamanho: 10, sha256: 'ab' }]);
  assert.ok(csv.startsWith('\uFEFFPasta;Arquivo;O que é;Origem;Documento;Data;Valor;Tamanho (bytes);SHA-256\r\n'));
  assert.ok(csv.includes('07-Outros;"a;b.pdf";Contrato;Fornecido;"Contrato ""novo""";05/08/2026;1234,5;10;ab'));
  const leia = p.leiaMe({
    empresa: { razao_social: 'Santíssimo Decor Ltda', cnpj: '11.444.777/0001-61' }, rotulo: 'agosto/2026', versao: 2, fechadaEm: '2026-09-05T10:20:00-03:00', fechadaPor: 'Henrique',
    geradoEm: '2026-09-29T11:30:00-03:00', geradoPor: 'Henrique', pastas: [{ pasta: '01-Relatorio', rotulo: 'Relatório mensal (PDF e planilha)', quantidade: 1 }],
    faltando: [{ titulo: 'NF-e 1/99', detalhe: 'Madeiras Silva', motivo: 'Sem o XML' }], ignoradas: [{ titulo: 'Tarifa', justificativa: 'lançada pelo extrato' }],
    resultado: { resultado: 1200, receitas: 3700, custos: 0, despesas: -2500 }, semPdf: true
  }).replace(/\u00a0/g, ' ');
  for (const trecho of ['Pacote da contabilidade — Santíssimo Decor Ltda · CNPJ 11.444.777/0001-61', 'Fechamento: versão 2, fechada em 05/09/2026 às 10:20 por Henrique',
    'Resultado do mês: R$ 1.200,00', '  01-Relatorio/  Relatório mensal (PDF e planilha) — 1 arquivo', '(o relatório em PDF não veio: só a planilha)',
    'Faltando (1):', '  - NF-e 1/99 — Madeiras Silva: Sem o XML', '  - Tarifa: lançada pelo extrato']) {
    assert.ok(leia.includes(trecho), trecho);
  }
  assert.equal(p.nomeDoPacote('2026-08', 2), 'Contabilidade-2026-08-v2');
  assert.equal(p.nomeDoPacote('2026-07', null), 'Contabilidade-2026-07');
});

test('envio: para quem e como são obrigatórios; o pacote que a tela vê', () => {
  assert.throws(() => p.validarEnvio({ para: 'x', meio: 'E-mail' }), /para quem/);
  assert.throws(() => p.validarEnvio({ para: 'contabil@exemplo.com', meio: 'Fax' }), /como foi enviado/);
  assert.deepEqual(p.validarEnvio({ para: ' contabil@exemplo.com ', meio: 'E-mail', observacao: '' }), { para: 'contabil@exemplo.com', meio: 'E-mail', observacao: null });
  const pub = p.pacotePublico({
    id: 4, competencia: '2026-08', versao: 2, nome_arquivo: 'Contabilidade-2026-08-v2.zip', hash: `${'a'.repeat(64)}`, tamanho_bytes: 2621440,
    arquivos: JSON.stringify([{ pasta: '01-Relatorio', nome: 'x.pdf' }, { pasta: '02-Extrato', nome: 'y.ofx' }]), faltando: '[]',
    gerado_em: '2026-09-29T14:30:00.000Z', gerado_por: 3, enviado_em: null
  }, new Map([['3', 'Henrique']]));
  assert.deepEqual([pub.versao, pub.arquivos, pub.faltando, pub.tamanho_rotulo, pub.gerado_em, pub.gerado_por, pub.enviado_em], [2, 2, 0, '2,5 MB', '2026-09-29T11:30:00-03:00', 'Henrique', null]);
});
