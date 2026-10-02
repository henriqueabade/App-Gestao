/**
 * O relatório mensal em planilha .xlsx (etapa 8), com `exceljs` (já nas
 * dependências). Uma aba por parte do relatório:
 *
 *   Resumo        situação, resultado do mês e as contas do banco
 *   Livro-caixa   por conta, com total do dia e do período (o "Extrato de
 *                 Conta" que a contabilidade recebe hoje)
 *   Partidas      duas linhas por lançamento (banco × conta do plano)
 *   Lançamentos   uma linha por lançamento, com tudo (para filtrar/importar)
 *   Resultado     por conta do plano
 *   Conciliação   o que não casou, o ignorado e o registrado sem extrato
 *   Pendências    e   Documentos
 *
 * Datas são datas do Excel e valores são números (formato de dinheiro), para
 * a contabilidade somar e filtrar. Nada de fórmula: o que se vê é o que o
 * app calculou.
 */
const ExcelJS = require('exceljs');
const c = require('../../financeiro/comum');
const { instanteImpresso } = require('./relatorio');

const MOEDA = '#,##0.00;[Red]-#,##0.00';
const DATA = 'dd/mm/yyyy';
const COR_CABECALHO = 'FFF1EDE0';
const COR_DIA = 'FFEEEEEE';
const COR_TOTAL = 'FFD9D9D9';

/** 'AAAA-MM-DD' -> Date do Excel (meia-noite UTC: a data não anda com o fuso). */
function dataExcel(iso) {
  const d = c.dia(iso);
  if (!d) return null;
  const [a, m, dd] = d.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, dd));
}

const numero = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : c.centavos(v));

/** Uma aba com cabeçalho em negrito, congelado, e o formato de cada coluna. */
function aba(livro, nome, colunas, { filtro = true } = {}) {
  const planilha = livro.addWorksheet(nome, { views: [{ state: 'frozen', ySplit: 1 }] });
  planilha.columns = colunas.map(col => ({
    header: col.titulo, key: col.chave, width: col.largura || 14,
    style: col.tipo === 'moeda' ? { numFmt: MOEDA } : (col.tipo === 'data' ? { numFmt: DATA } : {})
  }));
  const cabeca = planilha.getRow(1);
  cabeca.font = { bold: true };
  cabeca.eachCell(cel => { cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR_CABECALHO } }; });
  if (filtro) planilha.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colunas.length } };
  return planilha;
}

function pintar(linha, cor, negrito = true) {
  linha.font = { bold: negrito };
  linha.eachCell({ includeEmpty: true }, cel => { cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cor } }; });
}

function abaResumo(livro, rel) {
  const p = aba(livro, 'Resumo', [{ titulo: 'Item', chave: 'item', largura: 46 }, { titulo: 'Valor', chave: 'valor', largura: 60 }], { filtro: false });
  const add = (item, valor, fmt = null) => {
    const linha = p.addRow({ item, valor });
    if (fmt) linha.getCell(2).numFmt = fmt;
    return linha;
  };
  add('Empresa', [rel.empresa?.razao_social || rel.empresa?.nome, rel.empresa?.cnpj ? `CNPJ ${rel.empresa.cnpj}` : null].filter(Boolean).join(' · '));
  add('Competência', rel.rotulo);
  add('Situação', rel.situacao.previa ? `Prévia (${rel.situacao.rotulo.toLowerCase()})` : `Fechada${rel.situacao.versao ? ` — versão ${rel.situacao.versao}` : ''}`);
  add('Nota', rel.situacao.nota);
  add('Gerado em', instanteImpresso(rel.gerado_em));
  for (const a of rel.avisos) add('Aviso', a);
  p.addRow({});
  const r = rel.resultado;
  if (r) {
    for (const [rotulo, v] of [['Receitas', r.receitas], ['Deduções da receita', r.deducoes], ['Custos', r.custos], ['Despesas', r.despesas]]) add(rotulo, numero(v), MOEDA);
    add('Resultado do mês', numero(r.resultado), MOEDA).font = { bold: true };
    add('Fora do resultado (transferências, patrimônio)', numero(r.fora_do_resultado), MOEDA);
    add('Sem classificação', numero(r.sem_classificacao), MOEDA);
  } else {
    add('Resultado', 'Sem a classificação: não calculado');
  }
  p.addRow({});
  for (const x of rel.resumo.contas) {
    add(`${x.conta} — saldo inicial`, numero(x.saldo_inicial), MOEDA);
    add(`${x.conta} — entradas`, numero(x.entradas), MOEDA);
    add(`${x.conta} — saídas`, numero(x.saidas), MOEDA);
    add(`${x.conta} — saldo final`, numero(x.saldo_final), MOEDA);
    if (x.saldo_banco) add(`${x.conta} — saldo informado pelo banco em ${c.impressa(x.saldo_banco.data)}`, numero(x.saldo_banco.valor), MOEDA);
    if (x.completo === false) add(`${x.conta} — extrato`, 'não cobre o mês inteiro');
  }
  p.addRow({});
  add('Lançamentos no extrato', rel.resumo.lancamentos);
  if (rel.resumo.sem_classificacao !== null) add('Lançamentos sem classificação', rel.resumo.sem_classificacao);
  const cc = rel.resumo.conciliacao;
  if (cc) {
    add('Conciliados', cc.conciliados);
    add('Ignorados (com justificativa)', cc.ignorados);
    add('A conciliar', cc.a_conciliar.quantidade);
    add('Registrados no app sem lançamento no extrato', cc.sem_lancamento);
  }
  const pend = rel.resumo.pendencias;
  add(`Pendências${rel.pendencias.origem === 'fechamento' ? ' no fechamento' : ''}`, `${pend.critico} críticas · ${pend.documental} documentais · ${pend.aviso} avisos · ${pend.ignoradas} ignoradas`);
  if (rel.resumo.documentos) add('Documentos da competência', `${rel.resumo.documentos.total}${rel.resumo.documentos.falta ? ` (${rel.resumo.documentos.falta} faltando)` : ''}`);
}

const COLUNAS_LIVRO = [
  { titulo: 'Data', chave: 'data', tipo: 'data', largura: 12 }, { titulo: 'Número', chave: 'numero', largura: 14 },
  { titulo: 'Descrição', chave: 'descricao', largura: 40 }, { titulo: 'Débito', chave: 'debito', tipo: 'moeda', largura: 14 },
  { titulo: 'Crédito', chave: 'credito', tipo: 'moeda', largura: 14 }, { titulo: 'Saldo', chave: 'saldo', tipo: 'moeda', largura: 15 },
  { titulo: 'Tipo (conta do plano)', chave: 'conta_plano', largura: 28 }, { titulo: 'Observação', chave: 'observacao', largura: 60 },
  { titulo: 'Venc.', chave: 'vencimento', tipo: 'data', largura: 12 }
];

function abaLivro(livro, rel) {
  const p = aba(livro, 'Livro-caixa', COLUNAS_LIVRO, { filtro: false });
  for (const l of rel.livro) {
    const titulo = p.addRow({ descricao: `Conta: ${l.conta}` });
    titulo.font = { bold: true, size: 12 };
    const origem = l.saldo_origem === 'digitado' ? `Saldo inicial (do saldo de abertura digitado, de ${c.impressa(l.abertura?.data)})`
      : (l.saldo_conhecido ? `Saldo inicial (do saldo do banco em ${c.impressa(l.saldo_banco.data)})` : 'Sem o saldo do banco: a coluna Saldo é o acumulado do mês');
    const inicial = p.addRow({ descricao: origem, saldo: numero(l.saldo_inicial) });
    inicial.font = { italic: true };
    const porDia = new Map(l.dias.map(d => [d.data, d]));
    l.linhas.forEach((x, i) => {
      p.addRow({
        data: dataExcel(x.data), numero: x.numero || '', descricao: x.descricao || '', debito: numero(x.debito), credito: numero(x.credito),
        saldo: numero(x.saldo), conta_plano: x.conta_plano || 'Sem classificação', observacao: x.observacao || '', vencimento: dataExcel(x.vencimento)
      });
      const proxima = l.linhas[i + 1];
      if (!proxima || proxima.data !== x.data) {
        const d = porDia.get(x.data);
        pintar(p.addRow({ data: dataExcel(x.data), descricao: `Total do dia (${c.plural(d.quantidade, 'lançamento', 'lançamentos')})`, debito: d.saidas ? numero(-d.saidas) : null, credito: d.entradas ? numero(d.entradas) : null, saldo: numero(d.saldo) }), COR_DIA);
      }
    });
    pintar(p.addRow({
      descricao: `Total do período (${c.plural(l.totais.quantidade, 'lançamento', 'lançamentos')})`, debito: l.totais.saidas ? numero(-l.totais.saidas) : null,
      credito: l.totais.entradas ? numero(l.totais.entradas) : null, saldo: numero(l.saldo_final ?? l.totais.resultado)
    }), COR_TOTAL);
    p.addRow({});
  }
}

function abaPartidas(livro, rel) {
  const p = aba(livro, 'Partidas', [
    { titulo: 'Data', chave: 'data', tipo: 'data', largura: 12 }, { titulo: 'Número', chave: 'numero', largura: 14 },
    { titulo: 'Conta', chave: 'conta', largura: 30 }, { titulo: 'Descrição / observação', chave: 'descricao', largura: 60 },
    { titulo: 'Valor', chave: 'valor', tipo: 'moeda', largura: 15 }, { titulo: 'Venc.', chave: 'vencimento', tipo: 'data', largura: 12 },
    { titulo: 'Lançamento', chave: 'movimento_id', largura: 12 }
  ]);
  for (const x of rel.partidas) {
    const linha = p.addRow({ data: dataExcel(x.data), numero: x.numero || '', conta: x.conta, descricao: x.descricao || '', valor: numero(x.valor), vencimento: dataExcel(x.vencimento), movimento_id: x.movimento_id });
    if (x.lado === 'banco') linha.font = { bold: true };
  }
}

function abaLancamentos(livro, rel) {
  const p = aba(livro, 'Lançamentos', [
    { titulo: 'Conta do banco', chave: 'conta', largura: 26 }, { titulo: 'Data', chave: 'data', tipo: 'data', largura: 12 },
    { titulo: 'Número', chave: 'numero', largura: 14 }, { titulo: 'Descrição', chave: 'descricao', largura: 40 },
    { titulo: 'Valor', chave: 'valor', tipo: 'moeda', largura: 15 }, { titulo: 'Conta do plano', chave: 'conta_plano', largura: 28 },
    { titulo: 'Conciliação', chave: 'estado', largura: 14 }, { titulo: 'Observação', chave: 'observacao', largura: 60 },
    { titulo: 'Venc.', chave: 'vencimento', tipo: 'data', largura: 12 }, { titulo: 'Lançamento', chave: 'id', largura: 12 }
  ]);
  for (const l of rel.livro) {
    for (const x of l.linhas) {
      p.addRow({
        conta: l.conta, data: dataExcel(x.data), numero: x.numero || '', descricao: x.descricao || '', valor: numero(x.valor),
        conta_plano: x.conta_plano || 'Sem classificação', estado: x.estado_rotulo || '', observacao: x.observacao || '', vencimento: dataExcel(x.vencimento), id: x.id
      });
    }
  }
}

function abaResultado(livro, rel) {
  const p = aba(livro, 'Resultado', [
    { titulo: 'Conta do plano', chave: 'conta', largura: 34 }, { titulo: 'Tipo', chave: 'tipo', largura: 30 },
    { titulo: 'Lançamentos', chave: 'quantidade', largura: 13 }, { titulo: 'Entradas', chave: 'entradas', tipo: 'moeda', largura: 15 },
    { titulo: 'Saídas', chave: 'saidas', tipo: 'moeda', largura: 15 }, { titulo: 'Resultado', chave: 'resultado', tipo: 'moeda', largura: 15 }
  ]);
  const r = rel.resultado;
  if (!r) {
    p.addRow({ conta: 'Sem a classificação: não calculado' });
    return;
  }
  for (const g of r.por_conta) p.addRow({ conta: g.conta, tipo: g.tipo_rotulo || '', quantidade: g.quantidade, entradas: numero(g.entradas) || null, saidas: numero(g.saidas) || null, resultado: numero(g.resultado) });
  pintar(p.addRow({ conta: 'Resultado do mês', resultado: numero(r.resultado) }), COR_TOTAL);
}

function abaConciliacao(livro, rel) {
  const p = aba(livro, 'Conciliação', [
    { titulo: 'Conta do banco', chave: 'conta', largura: 26 }, { titulo: 'Situação', chave: 'situacao', largura: 32 },
    { titulo: 'Data', chave: 'data', tipo: 'data', largura: 12 }, { titulo: 'Valor', chave: 'valor', tipo: 'moeda', largura: 15 },
    { titulo: 'Descrição', chave: 'descricao', largura: 44 }, { titulo: 'Observação / justificativa', chave: 'observacao', largura: 56 }
  ]);
  if (!rel.conciliacao) {
    p.addRow({ situacao: 'Sem a conciliação (falta o SQL da etapa 5)' });
    return;
  }
  for (const x of rel.conciliacao) {
    for (const i of x.a_conciliar) p.addRow({ conta: x.conta, situacao: 'A conciliar', data: dataExcel(i.data), valor: numero(i.valor), descricao: i.descricao || '', observacao: i.sugestao ? 'tem sugestão' : '' });
    for (const i of x.ignorados) p.addRow({ conta: x.conta, situacao: 'Ignorado', data: dataExcel(i.data), valor: numero(i.valor), descricao: i.descricao || '', observacao: i.observacao || '' });
    for (const i of x.com_diferenca) p.addRow({ conta: x.conta, situacao: 'Conciliado com diferença', data: dataExcel(i.data), valor: numero(i.valor), descricao: i.descricao || '', observacao: `diferença ${c.reais(i.diferenca)}${i.observacao ? ` — ${i.observacao}` : ''}` });
    for (const i of x.sem_lancamento) p.addRow({ conta: x.conta, situacao: 'Registrado no app sem lançamento no extrato', data: dataExcel(i.data), valor: numero(i.valor), descricao: i.rotulo || '', observacao: [i.tipo, i.nome, i.forma].filter(Boolean).join(' · ') });
  }
  if (p.rowCount === 1) p.addRow({ situacao: 'Tudo conciliado' });
}

function abaPendencias(livro, rel) {
  const p = aba(livro, 'Pendências', [
    { titulo: 'Nível', chave: 'nivel', largura: 22 }, { titulo: 'Pendência', chave: 'titulo', largura: 60 },
    { titulo: 'Descrição', chave: 'descricao', largura: 60 }, { titulo: 'Situação', chave: 'situacao', largura: 14 }, { titulo: 'Justificativa', chave: 'justificativa', largura: 50 }
  ]);
  for (const x of rel.pendencias.lista) p.addRow({ nivel: x.nivel_rotulo, titulo: x.titulo, descricao: x.descricao || '', situacao: x.ignorada ? 'Ignorada' : 'Em aberto', justificativa: x.justificativa || '' });
}

function abaDocumentos(livro, rel) {
  const p = aba(livro, 'Documentos', [
    { titulo: 'Grupo', chave: 'grupo', largura: 16 }, { titulo: 'Data', chave: 'data', tipo: 'data', largura: 12 },
    { titulo: 'Documento', chave: 'titulo', largura: 36 }, { titulo: 'Detalhe', chave: 'detalhe', largura: 44 },
    { titulo: 'Valor', chave: 'valor', tipo: 'moeda', largura: 15 }, { titulo: 'Arquivo', chave: 'arquivo', largura: 30 }, { titulo: 'Origem', chave: 'origem', largura: 12 }
  ]);
  for (const i of rel.documentos?.itens || []) {
    p.addRow({
      grupo: i.grupo_rotulo || '', data: dataExcel(i.data), titulo: i.titulo || '', detalhe: i.detalhe || '', valor: numero(i.valor),
      arquivo: i.falta ? (i.falta_rotulo || 'Falta o arquivo') : (i.categoria || ''), origem: i.origem_rotulo || ''
    });
  }
}

/** A planilha em bytes. */
async function gerar(rel) {
  const livro = new ExcelJS.Workbook();
  livro.creator = 'App-Gestão';
  livro.title = `Relatório mensal — ${rel.rotulo}`;
  abaResumo(livro, rel);
  abaLivro(livro, rel);
  abaPartidas(livro, rel);
  abaLancamentos(livro, rel);
  abaResultado(livro, rel);
  abaConciliacao(livro, rel);
  abaPendencias(livro, rel);
  abaDocumentos(livro, rel);
  return Buffer.from(await livro.xlsx.writeBuffer());
}

module.exports = { MOEDA, dataExcel, gerar };
