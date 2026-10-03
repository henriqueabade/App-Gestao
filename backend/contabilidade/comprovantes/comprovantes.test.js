/**
 * Fase D (02/10/2026) — os comprovantes do BB, as partes puras: o leitor (ZIP
 * e PDF), os campos de cada modelo, o comprovante refeito idêntico, o
 * casamento com o extrato, o painel e os documentos da competência.
 *
 * Os PDFs daqui imitam o que o site do BB gera (jsPDF 1.5.2: Courier 8,
 * entrelinha 9,2, primeira linha em 28,35 × 813,54, "T* (…) Tj", sem
 * compressão) — com dados de mentira. O ZIP de setembro de verdade foi
 * conferido à parte: os 35 comprovantes refeitos idênticos.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const zip = require('../pacote/zip');
const leitor = require('./leitor');
const campos = require('./campos');
const pdf = require('./pdf');
const cps = require('./comprovantes');
const checklist = require('../checklist');

/** Um PDF no molde do jsPDF 1.5.2 do site do BB (o texto em latin1/WinAnsi). */
function pdfDoBB(linhas, { comprimido = false, extra = '' } = {}) {
  const esc = s => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  let conteudo = `0.57 w\n0 G\nBT\n/F5 8 Tf\n9.20 TL\n0 g\n28.35 813.54 Td\n(${esc(linhas[0] || '')}) Tj\n${linhas.slice(1).map(l => `T* (${esc(l)}) Tj`).join('\n')}\nET${extra}\n`;
  let stream = Buffer.from(conteudo, 'latin1');
  if (comprimido) stream = zlib.deflateSync(stream);
  const objs = [
    '<< /Type /Pages\n/Kids [3 0 R ]\n/Count 1\n>>',
    '<<\n/ProcSet [/PDF /Text /ImageB /ImageC /ImageI]\n/Font <<\n/F1 5 0 R\n/F5 9 0 R\n>>\n/XObject <<\n>>\n>>',
    '<</Type /Page\n/Parent 1 0 R\n/Resources 2 0 R\n/MediaBox [0 0 595.28 841.89]\n/Contents 4 0 R\n>>',
    null,
    '<<\n/BaseFont /Helvetica\n/Type /Font\n/Encoding /WinAnsiEncoding\n/Subtype /Type1\n>>',
    '<<\n/BaseFont /Helvetica-Bold\n/Type /Font\n/Encoding /WinAnsiEncoding\n/Subtype /Type1\n>>',
    '<<\n/BaseFont /Helvetica-Oblique\n/Type /Font\n/Encoding /WinAnsiEncoding\n/Subtype /Type1\n>>',
    '<<\n/BaseFont /Helvetica-BoldOblique\n/Type /Font\n/Encoding /WinAnsiEncoding\n/Subtype /Type1\n>>',
    '<<\n/BaseFont /Courier\n/Type /Font\n/Encoding /WinAnsiEncoding\n/Subtype /Type1\n>>',
    '<<\n/Producer (jsPDF 1.5.2)\n/CreationDate (D:20260930101500-03\'00\')\n>>',
    '<<\n/Type /Catalog\n/Pages 1 0 R\n>>'
  ];
  const partes = [Buffer.from('%PDF-1.3\n%\xBA\xDF\xAC\xE0\n', 'latin1')];
  objs.forEach((o, i) => {
    if (o === null) {
      partes.push(Buffer.from(`${i + 1} 0 obj\n<</Length ${stream.length}${comprimido ? '\n/Filter /FlateDecode' : ''}>>\nstream\n`, 'latin1'), stream, Buffer.from('\nendstream\nendobj\n'));
    } else {
      partes.push(Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1'));
    }
  });
  partes.push(Buffer.from('xref\n0 12\n0000000000 65535 f \ntrailer\n<<\n/Size 12\n/Root 11 0 R\n/Info 10 0 R\n>>\nstartxref\n0\n%%EOF', 'latin1'));
  return Buffer.concat(partes);
}

const SEP = '================================================';
const LIN = '------------------------------------------------';
const PIX = [
  '', 'SISBB  -  SISTEMA DE INFORMACOES BANCO DO BRASIL', '30/09/2026 -     AUTOATENDIMENTO      - 10.15.00', '1234567890                                  1614', '',
  '                Comprovante Pix', '', 'CLIENTE: EMPRESA TESTE LTDA', 'AGENCIA: 1614-4 CONTA:        16.773-8', SEP, 'SOBRE A TRANSACAO', LIN,
  'ID:             E00000000202609301015abcdefghijk', 'CNPJ DO PAGADOR:              11.444.777/0001-61', 'VALOR:                                R$1.234,56',
  'TARIFA:                                   R$0,00', 'DATA:                      30/09/2026 - 10:15:00', LIN, 'PAGO PARA:  Fulano de Tal', 'CPF:  ***.456.789-**',
  'CHAVE PIX: 12345678909', 'INSTITUICAO: 00000000 BCO DO BRASIL S.A.', 'AGENCIA: 0001 - CONTA: 12345', LIN,
  ' Esta transação pode ser tarifada em até 0,99%,', LIN, SEP, 'DOCUMENTO: 093015', 'AUTENTICACAO SISBB:        A.1B2.C3D.4E5.F67.890', SEP
];
const BOLETO = [
  '', '15/09/2026    -  BANCO  DO  BRASIL  -   09:00:00', '987654321                                   1614', '', '     COMPROVANTE DE PAGAMENTO DE TITULOS', '',
  'CLIENTE: EMPRESA TESTE LTDA', 'AGENCIA: 1614-4          CONTA:         16.773-8', SEP, 'BCO BRADESCO S.A.', LIN,
  '23790000090000000000000000000919915770000123456', 'BENEFICIARIO:', 'VIDROS NORTE LTDA', 'NOME FANTASIA:', 'VIDROS NORTE', 'CNPJ:  57.248.237/0001-03',
  'BENEFICIARIO FINAL:', 'VIDROS NORTE LTDA', 'CNPJ:  57.248.237/0001-03', 'PAGADOR:', 'ARTDECO MOVEIS LTDA', 'CNPJ:  12.345.678/0001-95', LIN,
  'NR. DOCUMENTO                             12.345', 'DATA DE VENCIMENTO                    15/09/2026', 'DATA DO PAGAMENTO                     15/09/2026',
  'VALOR DO DOCUMENTO                       2.500,00', 'VALOR COBRADO                            2.500,00', SEP, 'NR.AUTENTICACAO            F.123.DC4.5C6.78E.901', SEP,
  'Central de Atendimento BB (Ouvidoria)'
];
const CONVENIO = [
  '', 'SISBB  -  SISTEMA DE INFORMACOES BANCO DO BRASIL', '20/09/2026 -     AUTOATENDIMENTO      - 08.30.00', '5555555555         SEGUNDA VIA              1614',
  '            COMPROVANTE DE PAGAMENTO', '', 'CLIENTE: EMPRESA TESTE LTDA', 'AGENCIA: 1614-4 CONTA:        16.773-8', SEP, 'Convenio  RFB-DAS SIMPLES NACIONAL',
  'O Código de Barras abaixo identifica a guia', 'Codigo de Barras   85810000001-2   34560328201-3', '                   60920000000-1   00000000000-0',
  'Data do pagamento                     20/09/2026', 'Valor Total                               345,60', LIN, 'DOCUMENTO:  092001', 'AUTENTICACAO SISBB:        1.2F3.4B5.6C7.8D9.0EE'
];
const CREDITO = [
  '', 'SISBB  -  SISTEMA DE INFORMACOES BANCO DO BRASIL', '05/09/2026  -   AUTO-ATENDIMENTO     -  09:00:00', '4444444444', '',
  '       COMPROVANTE DE PAGAMENTO ELETRONICO', '', 'PAGADOR: EMPRESA TESTE LTDA', 'CNPJ: 11.444.777/0001-61', LIN, 'FAVORECIDO: CICLANA DA SILVA',
  'CPF: 123.456.789-09', 'AGENCIA: 0001-9 - CENTRO              MG', 'CONTA:                                  12.345-6', 'DATA DE PAGAMENTO:                    05/09/2026',
  'VALOR CREDITADO (R$):                   1.800,00', LIN, 'EVENTO: SALARIO ORD EMPREGADOR', LIN, 'AUTENTICACAO SISBB: E.12C.3FC.45B.6EF.789'
];

test('leitor: o ZIP do BB (nomes com acento, deflate) e o PDF de texto — cada linha com a posição, os acentos e os parênteses', () => {
  const bytes = zip.zipar([
    { nome: '1 - 30092026 - Transferência - 1.234,56.pdf', dados: pdfDoBB(PIX) },
    { nome: 'pasta/leia.txt', dados: Buffer.from('não é PDF') }
  ]);
  const arquivos = leitor.lerZip(bytes);
  assert.deepEqual(arquivos.map(a => a.nome), ['1 - 30092026 - Transferência - 1.234,56.pdf', 'leia.txt']);
  assert.throws(() => leitor.lerZip(Buffer.from('PK nada')), /não é um ZIP|incompleto/);
  const lido = leitor.lerPdf(arquivos[0].dados);
  assert.deepEqual([lido.paginas, lido.pagina, lido.producer, lido.blocos.length], [1, [595.28, 841.89], 'jsPDF 1.5.2', 1]);
  const ls = lido.blocos[0].linhas;
  assert.deepEqual([ls[0].x, ls[0].y, ls[1].y, ls[0].fonte, ls[0].tamanho], [28.35, 813.54, 804.34, 'Courier', 8]);
  assert.equal(ls.find(l => l.texto.includes('tarifada')).texto, ' Esta transação pode ser tarifada em até 0,99%,', 'WinAnsi: ç, ã, é');
  const f = leitor.formatoSimples(lido);
  assert.deepEqual([f.ok, f.layout.fonte, f.layout.tamanho, f.layout.entrelinha, f.layout.x, f.layout.y, f.layout.linha_espessura], [true, 'Courier', 8, 9.2, 28.35, 813.54, 0.57]);
  assert.deepEqual(f.linhas, PIX);
  // Comprimido (FlateDecode) também lê; outro formato (desenho, dois blocos) não é "simples".
  assert.deepEqual(leitor.formatoSimples(leitor.lerPdf(pdfDoBB(BOLETO, { comprimido: true }))).linhas, BOLETO);
  const outro = leitor.formatoSimples(leitor.lerPdf(pdfDoBB(PIX, { extra: '\n10 10 100 100 re\nS\nBT\n/F5 8 Tf\n50 50 Td\n(rodape) Tj\nET' })));
  assert.equal(outro.ok, false);
  assert.match(outro.motivo, /2 blocos de texto|re, S|usa/);
  assert.throws(() => leitor.lerPdf(Buffer.from('não é pdf')), /não é um PDF/);
});

test('refazer: o PDF refeito dos dados tem as mesmas linhas nas mesmas posições (o arquivo pode sair); com o pé "Reproduzido pelo App-Gestão…"', () => {
  const f = leitor.formatoSimples(leitor.lerPdf(pdfDoBB(BOLETO)));
  const refeito = pdf.gerarPdf({ layout: f.layout, linhas: f.linhas });
  const deNovo = leitor.formatoSimples(leitor.lerPdf(refeito));
  assert.deepEqual([deNovo.ok, deNovo.linhas, deNovo.layout], [true, f.linhas, f.layout]);
  assert.ok(pdf.gerarPdf({ layout: f.layout, linhas: f.linhas }).equals(refeito), 'os mesmos dados dão os mesmos bytes');
  const rodape = pdf.rodapeDaReproducao({ nomeArquivo: '2 - 15092026 - Pagamento - 2.500,00.pdf', sha256: 'f'.repeat(64), autenticacao: 'F.123.DC4.5C6.78E.901' });
  const comPe = leitor.lerPdf(pdf.gerarPdf({ layout: f.layout, linhas: f.linhas, rodape }));
  assert.equal(comPe.blocos.length, 2);
  assert.deepEqual(comPe.blocos[0].linhas.map(l => l.texto), BOLETO, 'o corpo continua o do original');
  const pe = comPe.blocos[1].linhas.map(l => l.texto).join(' ');
  assert.match(pe, /^Reproduzido pelo App-Gestão a partir do comprovante original do BB \(arquivo "2 - 15092026 - Pagamento - 2\.500,00\.pdf", SHA-256 f{64}\)\. Não é o arquivo emitido pelo banco; a autenticação F\.123\.DC4\.5C6\.78E\.901 pode ser conferida no BB\.$/);
  // A análise: confere = refeito idêntico; o formato diferente não confere (o original fica até o pacote).
  const a = cps.analisar('x.pdf', pdfDoBB(BOLETO));
  assert.deepEqual([a.formato, a.confere, a.diferenca, a.sha256.length], ['bb_texto', true, null, 64]);
  const b = cps.analisar('y.pdf', pdfDoBB(PIX, { extra: '\nBT\n/F5 8 Tf\n50 50 Td\n(outro) Tj\nET' }));
  assert.deepEqual([b.formato, b.confere], ['desconhecido', false]);
  assert.match(b.diferenca, /formato que o app não refaz/);
  assert.equal(cps.analisar('z.pdf', Buffer.from('%PDF-1.4 quebrado')).confere, false);
});

test('campos: Pix, boleto (título), convênio (DAS com "Código de Barras" no texto) e crédito em conta', () => {
  const pix = campos.lerCampos(PIX);
  assert.deepEqual(
    [pix.tipo, pix.data, pix.valor, pix.tarifa, pix.documento, pix.controle, pix.e2e, pix.favorecido_nome, pix.favorecido_documento, pix.pagador_documento, pix.agencia, pix.conta, pix.autenticacao],
    ['pix', '2026-09-30', 1234.56, 0, '93015', '1234567890', 'E00000000202609301015abcdefghijk', 'Fulano de Tal', '***.456.789-**', '11444777000161', '1614', '16773', 'A.1B2.C3D.4E5.F67.890']
  );
  const bol = campos.lerCampos(BOLETO);
  assert.deepEqual(
    [bol.tipo, bol.data, bol.vencimento, bol.valor, bol.documento, bol.codigo.length, bol.favorecido_nome, bol.favorecido_documento, bol.pagador_nome, bol.pagador_documento, bol.banco, bol.autenticacao],
    ['boleto', '2026-09-15', '2026-09-15', 2500, '12.345', 47, 'VIDROS NORTE LTDA', '57248237000103', 'ARTDECO MOVEIS LTDA', '12345678000195', 'BCO BRADESCO S.A.', 'F.123.DC4.5C6.78E.901']
  );
  const conv = campos.lerCampos(CONVENIO);
  assert.deepEqual([conv.tipo, conv.data, conv.valor, conv.documento, conv.codigo, conv.favorecido_nome, conv.segunda_via],
    ['convenio', '2026-09-20', 345.6, '92001', '858100000012345603282013609200000001000000000000', 'RFB-DAS SIMPLES NACIONAL', true]);
  const cred = campos.lerCampos(CREDITO);
  assert.deepEqual([cred.tipo, cred.data, cred.valor, cred.favorecido_nome, cred.favorecido_documento, cred.pagador_documento, cred.agencia],
    ['credito_conta', '2026-09-05', 1800, 'CICLANA DA SILVA', '12345678909', '11444777000161', null], 'a agência/conta depois do separador é do favorecido');
  // O que faltar vem do nome do arquivo.
  const pouco = campos.lerCampos(['COMPROVANTE DE ALGO NOVO'], { nomeArquivo: '7 - 03092026 - Pagamento - 99,90.pdf' });
  assert.deepEqual([pouco.tipo, pouco.data, pouco.valor], ['outro', '2026-09-03', 99.9]);
  assert.equal(campos.documentoDe('999.999/9999-99'), '00999999999999', 'o CNPJ com os zeros cortados');
  assert.equal(campos.dinheiro('R$99.999,99'), 99999.99);
});

const comp = (id, extra = {}) => cps.normalizar({ id, situacao: 'novo', data: '2026-09-30', valor: 1234.56, linhas: '[]', ...extra });
const mov = (id, extra = {}) => ({ id, conta_id: 1, data: '2026-09-30', valor: -1234.56, descricao: 'PIX ENVIADO', documento: null, competencia: '2026-09', ...extra });

test('casar: o DOCUMENTO do extrato, o ID do Pix e o CNPJ ligam sozinhos; o mesmo valor no mesmo dia, só se for o único; o lançamento ocupado e outra conta ficam de fora', () => {
  const r1 = cps.casar({ comprovantes: [comp(1, { documento: '93015' })], movimentos: [mov(10, { documento: '093015', data: '2026-10-01' }), mov(11)] });
  assert.deepEqual([r1.get(1).automatico.movimento_id, r1.get(1).automatico.criterio], [10, 'documento'], 'a chave decide entre dois do mesmo valor');
  const r2 = cps.casar({ comprovantes: [comp(1, { e2e: 'E0001ABC' })], movimentos: [mov(10, { identificador: 'e0001abc', data: '2026-10-02' })] });
  assert.equal(r2.get(1).automatico.criterio, 'e2e');
  const r3 = cps.casar({ comprovantes: [comp(1, { favorecido_documento: '57248237000103' })], movimentos: [mov(10, { contrapartida_documento: '57248237000103', data: '2026-10-03' })] });
  assert.equal(r3.get(1).automatico.criterio, 'cnpj');
  const r4 = cps.casar({ comprovantes: [comp(1)], movimentos: [mov(10)] });
  assert.equal(r4.get(1).automatico.criterio, 'mesmo_dia');
  const r5 = cps.casar({ comprovantes: [comp(1)], movimentos: [mov(10), mov(11)] });
  assert.equal(r5.get(1).automatico, null, 'dois do mesmo valor no mesmo dia, sem chave: escolha à mão');
  assert.equal(r5.get(1).candidatos.length, 2);
  const r6 = cps.casar({ comprovantes: [comp(1), comp(2)], movimentos: [mov(10)] });
  assert.deepEqual([r6.get(1).automatico, r6.get(2).automatico], [null, null], 'dois comprovantes para o mesmo lançamento');
  const r7 = cps.casar({ comprovantes: [comp(1, { conta_id: 2 }), comp(3, { situacao: 'ligado', movimento_id: 11 })], movimentos: [mov(10), mov(11)] });
  assert.deepEqual(r7.get(1).candidatos, [], 'outra conta e o lançamento ocupado');
  const r8 = cps.casar({ comprovantes: [comp(1)], movimentos: [mov(10, { data: '2026-10-08' }), mov(11, { valor: -1234.55 }), mov(12, { valor: 1234.56 })] });
  assert.deepEqual(r8.get(1).candidatos, [], 'fora dos 5 dias, outro valor, crédito');
  // A conta do comprovante pela agência e conta (sem os dígitos).
  assert.equal(cps.contaDoComprovante({ agencia: '1614', conta: '16773' }, [{ id: 1, agencia: '1614', conta: '167738' }]).id, 1);
  assert.equal(cps.contaDoComprovante({ agencia: '1614', conta: '16773' }, [{ id: 1, agencia: '1614', conta: '16773' }]).id, 1);
  assert.equal(cps.contaDoComprovante({ agencia: '1615', conta: '16773' }, [{ id: 1, agencia: '1614', conta: '16773' }]), null);
  // O pagamento tem comprovante pelo lançamento que o paga (conciliação valendo).
  const comprovados = cps.pagamentosComComprovante({
    comprovantes: [comp(1, { situacao: 'ligado', movimento_id: 10 })],
    vinculos: [{ movimento_id: 10, alvo_tipo: 'titulo_pagamento', alvo_id: 101 }, { movimento_id: 10, alvo_tipo: 'financeiro_pagamento', alvo_id: 7, desfeito_em: '2026-10-01' }, { movimento_id: 11, alvo_tipo: 'titulo_pagamento', alvo_id: 102 }]
  });
  assert.deepEqual([...comprovados], ['titulo_pagamento:101']);
});

test('painel e documentos: o comprovante ligado vale para o pagamento (C3); o sem lançamento é aviso; o refeito vai como "reproduzido", o guardado como oficial', () => {
  const t = { id: 1, contato_id: 5, descricao: 'Vidros', fornecedor: 'Vidros', documento_recebido_id: 4, categoria: null, status: 'aberto', competencia: '2026-09',
    parcelas: [{ id: 11, numero: 1, de: 1, vencimento: '2026-09-15', valor: 2500, situacao: 'paga', pagamento: { id: 101, data: '2026-09-15', valor_pago: 2500, forma: 'Boleto' } }] };
  const base = { titulos: [t], documentos: [{ id: 4 }], arquivosMapa: new Map() };
  const sem = checklist.fonteContasPagar({ pagar: base, competencia: '2026-09', hoje: '2026-10-02' });
  const c3 = sem.pendencias.find(p => p.chave === 'pagar_sem_comprovante');
  assert.deepEqual([c3.nivel, c3.filtro], ['critico', { acao: 'comprovantes' }]);
  assert.match(c3.descricao, /anexe o ZIP dos comprovantes do BB/);
  const com = checklist.fonteContasPagar({
    pagar: { ...base, comprovados: new Set(['titulo_pagamento:101']), comprovantes: [{ id: 9, situacao: 'novo', data: '2026-09-20', valor: '345.60' }, { id: 8, situacao: 'novo', data: '2026-10-01', valor: '1.00' }] },
    competencia: '2026-09', hoje: '2026-10-02'
  });
  assert.equal(com.pendencias.some(p => p.chave === 'pagar_sem_comprovante'), false);
  const aviso = com.pendencias.find(p => p.chave === 'comprovantes_sem_lancamento');
  assert.deepEqual([aviso.nivel, aviso.titulo, aviso.filtro], ['aviso', '1 comprovante do BB sem lançamento do extrato', { acao: 'comprovantes', visao: 'sem_par' }]);
  // Os documentos da competência.
  const itens = cps.itensDeEvidencia([
    comp(1, { competencia: '2026-09', confere: true, tipo: 'pix', favorecido_nome: 'Fulano', autenticacao: 'A.1', situacao: 'ligado', nome_arquivo: 'p.pdf' }),
    comp(2, { competencia: '2026-09', confere: false, arquivo_id: 22, tipo: 'boleto', favorecido_nome: 'Vidros' }),
    comp(3, { competencia: '2026-09', confere: false, arquivo_id: 23, original_descartado_em: '2026-10-02T10:00:00Z' }),
    comp(4, { competencia: '2026-09', situacao: 'ignorado', confere: true }),
    comp(5, { competencia: '2026-08', confere: true })
  ], '2026-09');
  assert.deepEqual(itens.map(i => [i.chave, i.origem, i.baixar, i.falta]), [
    ['comprovante:1', 'reproduzido', { tipo: 'comprovante', id: 1 }, false],
    ['comprovante:2', 'oficial', { tipo: 'arquivo', id: 22 }, false],
    ['comprovante:3', null, null, true]
  ]);
  assert.equal(itens[0].titulo, 'Comprovante Pix — Fulano');
  assert.match(itens[0].detalhe, /^autenticação A\.1 · ligado ao extrato · p\.pdf$/);
});
