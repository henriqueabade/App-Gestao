/**
 * Fase C (02/10/2026) — as aplicações do BB pelos PDFs mensais: as partes puras.
 *
 * O que fica preso:
 *   - o leitor entende as fontes Type0/Identity-H (o mapa /ToUnicode, bfchar e
 *     bfrange) e lê as linhas na ordem certa com o eixo y invertido (navegador)
 *     ou normal (iText);
 *   - o Rende Fácil: o mês, os saldos, o resumo, o histórico pelas colunas, as
 *     conferências ao centavo e os lançamentos do extrato (a soma do dia);
 *   - o CDB: o período, cada resgate (capital, juros, IR, líquido), as tabelas,
 *     as conferências e os lançamentos (capital e rendimento em duas linhas);
 *   - o PDF que não fecha; a situação do mês e as pendências (falta o PDF, o
 *     PDF não fecha, o extrato não bate); os itens dos Documentos.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const leitor = require('../comprovantes/leitor');
const leitura = require('./leitura');
const apl = require('./aplicacoes');

const { pdfDeTexto, pdfRendeFacil, pdfCdb } = require('./pdfsDeTeste');

test('leitor: o mapa /ToUnicode (bfchar e bfrange) das fontes Type0 e as linhas na ordem certa nos dois eixos', () => {
  const cmap = leitor.lerCmap('begincodespacerange <0000> <FFFF> endcodespacerange\n2 beginbfchar <0003> <0020> <0005> <00E7> endbfchar\n1 beginbfrange <0010> <0012> <0041> endbfrange\n1 beginbfrange <0020> <0021> [<0061> <00E3>] endbfrange');
  assert.equal(cmap.bytes, 2);
  assert.equal(leitor.textoPeloCmap(Buffer.from('0010001100120003000500200021', 'hex'), cmap), 'ABC çaã');
  // Um PDF com fonte Type0 (como o do navegador): o texto sai pelo mapa.
  const conteudo = Buffer.from('BT /F7 10 Tf 1 0 0 1 50 700 Tm <001000110012> Tj ET', 'latin1');
  const cmapTexto = Buffer.from('begincodespacerange <0000> <FFFF> endcodespacerange 1 beginbfrange <0010> <0012> <0052> endbfrange', 'latin1');
  const pdf = Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'
      + '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F7 5 0 R >> >> /Contents 4 0 R >>\nendobj\n'
      + `4 0 obj\n<< /Length ${conteudo.length} >>\nstream\n`, 'latin1'), conteudo,
    Buffer.from(`\nendstream\nendobj\n5 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /AAAAAA+Inter /Encoding /Identity-H /ToUnicode 6 0 R >>\nendobj\n6 0 obj\n<< /Length ${cmapTexto.length} >>\nstream\n`, 'latin1'),
    cmapTexto, Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF', 'latin1')
  ]);
  const lido = leitor.lerPdf(pdf, { todasPaginas: true });
  assert.equal(lido.paginasLidas[0].blocos[0].linhas[0].texto, 'RST');
  // A ordem de leitura: de cima para baixo, com o eixo invertido ou não; as colunas pela posição.
  for (const invertido of [true, false]) {
    const linhas = leitura.linhasDoPdf(pdfDeTexto([{ x: 10, y: 50, texto: 'primeira' }, { x: 300, y: 50, texto: 'coluna' }, { x: 10, y: 70, texto: 'segunda' }, { x: 10, y: 90, texto: 'terceira' }], { invertido }));
    assert.deepEqual(linhas.map(l => l.texto), ['primeira | coluna', 'segunda', 'terceira'], `invertido=${invertido}`);
  }
});

test('Rende Fácil: mês, saldos, resumo, histórico pelas colunas, conferências ao centavo e a soma do dia para o extrato', () => {
  const r = leitura.analisar(pdfRendeFacil());
  assert.deepEqual([r.produto, r.competencia, r.agencia, r.conta, r.periodo_inicio, r.periodo_fim, r.saldo_inicial, r.saldo_final], ['rende_facil', '2026-09', '1614-4', '16773-8', '2026-08-31', '2026-09-30', 1000.5, 701.55]);
  assert.deepEqual(r.movimentos.map(m => [m.tipo, m.liquido]), [['saldo_anterior', 0], ['resgate', 300.25], ['resgate', 199.45], ['aplicacao', 500], ['resgate', 300.45], ['saldo_final', 0]]);
  assert.deepEqual([r.rendimento_mes, r.ir_mes, r.iof_mes], [1.6, 0.3, 0.1]);
  assert.deepEqual(r.conferencias.filter(x => !x.ok), [], JSON.stringify(r.conferencias));
  assert.equal(r.confere, true);
  assert.deepEqual(r.lancamentos.map(l => [l.data, l.sentido, l.parte, l.valor]), [
    ['2026-09-04', 'resgate', 'liquido', 499.7], ['2026-09-10', 'aplicacao', 'liquido', 500], ['2026-09-20', 'resgate', 'liquido', 300.45]
  ]);
  assert.equal(r.lancamentos[0].descricao, 'BB Rende Fácil — 2 resgates do dia');
  // O PDF que não fecha (o saldo final errado): as contas acusam.
  const errado = leitura.analisar(pdfRendeFacil({ saldoFinal: '700,00' }));
  assert.equal(errado.confere, false);
  assert.deepEqual(errado.conferencias.filter(x => !x.ok).map(x => x.chave), ['saldo', 'saldo_historico']);
  assert.throws(() => leitura.analisar(pdfDeTexto([{ x: 10, y: 10, texto: 'Fatura do cartão' }])), /Não é o PDF do BB Rende Fácil nem o do CDB DI/);
});

test('CDB DI: período, aplicação, resgate (capital, juros, IR, líquido), rendimento mensal, tabelas, conferências e as duas linhas do resgate', () => {
  const r = leitura.analisar(pdfCdb());
  assert.deepEqual([r.produto, r.competencia, r.agencia, r.conta, r.periodo_inicio, r.periodo_fim, r.saldo_inicial, r.saldo_final], ['cdb', '2026-09', '1614-4', '16773-8', '2026-09-01', '2026-09-30', 10000, 11500]);
  const resgate = r.movimentos.find(m => m.tipo === 'resgate');
  assert.deepEqual([resgate.data, resgate.deposito, resgate.capital, resgate.juros_anterior, resgate.juros_mes, resgate.ir, resgate.liquido], ['2026-09-21', '1111111111111', 500, 41.08, 3.72, 8.96, 535.84]);
  assert.deepEqual([r.rendimento_mes, r.ir_mes, r.resumo.juros_acumulados_fim, r.depositos.length, r.saldos_meses.length, r.rendimento_por_deposito.length], [318.72, 8.96, 900, 2, 2, 1]);
  assert.deepEqual(r.conferencias.map(x => [x.chave, x.ok]), [['capital', true], ['resgate_1', true], ['saldo_meses', true], ['depositos', true]]);
  assert.deepEqual(r.lancamentos.map(l => [l.data, l.sentido, l.parte, l.valor]), [
    ['2026-09-15', 'aplicacao', 'capital', 2000], ['2026-09-21', 'resgate', 'capital', 500], ['2026-09-21', 'resgate', 'rendimento', 35.84]
  ]);
  assert.equal(leitura.analisar(pdfCdb({ capitalFinal: '11.400,00' })).confere, false);
});

test('a situação do mês e as pendências: falta o PDF, o PDF não fecha, o extrato não bate (crítico com o mês encerrado); os itens dos Documentos', () => {
  const lido = leitura.analisar(pdfRendeFacil());
  const aplicacao = apl.normalizar({ id: 1, produto: 'rende_facil', competencia: '2026-09', ...lido, resumo: lido.resumo, movimentos: lido.movimentos, conferencias: lido.conferencias, confere: true, arquivo_id: 9 });
  const lancamentos = lido.lancamentos.map((l, i) => ({ ...l, id: 10 + i, aplicacao_id: 1 }));
  const mov = (id, data, valor, estado = 'conciliado') => ({ id, data, valor, descricao: 'BB RENDE FÁCIL - RENDE FACIL', estado_conciliacao: estado });
  const movimentos = [mov(1, '2026-09-04', 499.7), mov(2, '2026-09-10', -500), mov(3, '2026-09-20', 300.45), { id: 4, data: '2026-09-21', valor: -10, descricao: 'PIX ENVIADO' }];
  const vinculos = [{ movimento_id: 1, alvo_tipo: 'resgate', alvo_id: 10 }, { movimento_id: 2, alvo_tipo: 'aplicacao', alvo_id: 11 }, { movimento_id: 3, alvo_tipo: 'resgate', alvo_id: 12 }];
  const ok = apl.situacaoDoProduto({ produto: 'rende_facil', aplicacao, lancamentos, vinculos, movimentos, encerrada: true });
  assert.deepEqual([ok.situacao, ok.sobras.length, ok.lancamentos.every(l => l.coberto)], ['ok', 0, true]);
  const dados = { aplicacoes: [aplicacao], lancamentos, vinculos, movimentos };
  assert.deepEqual(apl.pendencias({ competencia: '2026-09', dados, encerrada: true }), []);

  // Um resgate do PDF sem a linha do extrato: o extrato não bate (crítico com o mês encerrado; no mês em curso
  // o extrato ainda está chegando e nada é cobrado).
  const semUm = { ...dados, vinculos: vinculos.slice(0, 2) };
  const p1 = apl.pendencias({ competencia: '2026-09', dados: { ...semUm, movimentos: movimentos.filter(m => m.id !== 3) }, encerrada: true });
  assert.deepEqual(p1.map(p => [p.nivel, p.chave, p.descricao]), [['critico', 'aplicacao_divergente_rende_facil', '1 lançamento do PDF sem a linha do extrato']]);
  assert.deepEqual(apl.pendencias({ competencia: '2026-09', dados: { ...semUm, movimentos: movimentos.filter(m => m.id !== 3) }, encerrada: false }), []);
  // O extrato com o Rende Fácil e nenhum PDF: falta o PDF; o CDB sem nada fica quieto.
  const p2 = apl.pendencias({ competencia: '2026-09', dados: { aplicacoes: [], lancamentos: [], vinculos: [], movimentos }, encerrada: true });
  assert.deepEqual(p2.map(p => [p.nivel, p.chave, p.titulo]), [['critico', 'aplicacao_sem_pdf_rende_facil', 'PDF do BB Rende Fácil de setembro/2026 não importado']]);
  assert.deepEqual(p2[0].filtro, { acao: 'aplicacoes' });
  // O PDF que não fecha.
  const p3 = apl.pendencias({ competencia: '2026-09', dados: { ...dados, aplicacoes: [{ ...aplicacao, confere: false, conferencias: [{ rotulo: 'Saldo final', ok: false }] }] }, encerrada: true });
  assert.deepEqual(p3.map(p => p.chave), ['aplicacao_nao_confere_rende_facil']);

  // Os Documentos: o PDF guardado vai como "Extrato bancário" (pasta 02-Extrato); depois do pacote, a falta.
  const [item] = apl.itensDeEvidencia([aplicacao], '2026-09');
  assert.deepEqual([item.chave, item.grupo, item.categoria, item.origem, item.baixar, item.falta], ['aplicacao:1', 'outros', 'Extrato bancário', 'oficial', { tipo: 'arquivo', id: 9 }, false]);
  const [depois] = apl.itensDeEvidencia([{ ...aplicacao, original_descartado_em: '2026-10-05' }], '2026-09');
  assert.deepEqual([depois.falta, depois.falta_rotulo], [true, 'O original já saiu no pacote: importe de novo']);
  assert.deepEqual(apl.itensDeEvidencia([{ ...aplicacao, substituida_em: '2026-10-01' }], '2026-09'), [], 'o PDF substituído não conta');
});

