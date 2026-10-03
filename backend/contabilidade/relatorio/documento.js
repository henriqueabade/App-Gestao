/**
 * O relatório mensal em HTML para o PDF (etapa 8): a tela manda este HTML
 * para o Electron, que imprime em A4 paisagem (salvar-html-como-pdf, o mesmo
 * caminho do DANFE e dos relatórios do Financeiro). Tudo o que vem do banco
 * é escapado; o CSS vai dentro do arquivo (a janela do PDF não tem o app).
 *
 * Seções: resumo, resultado por conta do plano, o livro-caixa de cada conta
 * (com o total de cada dia e do período, como o "Extrato de Conta" que a
 * contabilidade recebe hoje), a conciliação, as pendências e os documentos.
 * Prévia (competência aberta) sai com a marca "PRÉVIA" em toda folha.
 * Pura.
 */
const c = require('../../financeiro/comum');
const { instanteImpresso } = require('./relatorio');

const esc = t => String(t ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const dinheiro = v => (v === null || v === undefined || v === '' ? '' : esc(c.reais(v)));
const data = iso => (c.dia(iso) ? esc(c.impressa(iso)) : '');
const dm = iso => { const d = c.dia(iso); return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : ''; };
const td = (conteudo, classe = '') => `<td${classe ? ` class="${classe}"` : ''}>${conteudo}</td>`;
const th = (texto, classe = '') => `<th${classe ? ` class="${classe}"` : ''}>${esc(texto)}</th>`;

const CSS = `
@page { size: A4 landscape; margin: 10mm 10mm 12mm; }
* { box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 9px; margin: 0; }
h1 { font-size: 16px; margin: 0 0 2px; }
h2 { font-size: 12px; margin: 14px 0 6px; padding-bottom: 3px; border-bottom: 2px solid #b6a03e; }
h3 { font-size: 10px; margin: 10px 0 4px; }
p { margin: 0 0 6px; }
.topo { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; border-bottom: 2px solid #111; padding-bottom: 6px; margin-bottom: 8px; }
.topo p { color: #444; }
.selo { font-weight: 700; font-size: 11px; padding: 4px 10px; border-radius: 12px; white-space: nowrap; }
.selo--previa { background: #fbe9c6; color: #7a4b00; }
.selo--fechada { background: #d9efd9; color: #1d5a1d; }
.nota { font-size: 10px; color: #333; background: #f5f2e8; border-left: 3px solid #b6a03e; padding: 5px 8px; }
.avisos { margin: 4px 0 8px; padding-left: 16px; color: #8a1f1f; }
table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
th, td { border-bottom: 1px solid #ddd; padding: 3px 5px; text-align: left; vertical-align: top; }
th { background: #f1ede0; font-weight: 700; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
.num { text-align: right; white-space: nowrap; }
.nowrap { white-space: nowrap; }
.neg { color: #a11; }
.dia td { background: #eeeeee; font-weight: 700; }
.total td { background: #d9d9d9; font-weight: 700; border-top: 2px solid #999; }
.resultado td { font-weight: 700; border-top: 2px solid #b6a03e; }
.quebra { break-before: page; page-break-before: always; }
.kv { width: auto; min-width: 45%; }
.kv td:first-child { color: #444; padding-right: 24px; }
.sub { color: #555; font-size: 8px; display: block; }
.vazio { color: #666; font-style: italic; }
.marca { position: fixed; top: 42%; left: 0; right: 0; text-align: center; font-size: 110px; font-weight: 700; color: rgba(180, 120, 0, 0.08); transform: rotate(-18deg); z-index: -1; }
.rodape { margin-top: 14px; padding-top: 4px; border-top: 1px solid #ccc; color: #666; font-size: 8px; }
`;

const classeValor = v => (Number(v) < 0 ? 'num neg' : 'num');

function secaoResumo(rel) {
  const r = rel.resultado;
  const linhasResultado = r ? [
    ['Receitas', r.receitas], ['Deduções da receita', r.deducoes], ['Custos', r.custos], ['Despesas', r.despesas],
    ['Resultado do mês', r.resultado], ['Fora do resultado (transferências, patrimônio)', r.fora_do_resultado], ['Sem classificação', r.sem_classificacao]
  ] : [];
  const kv = linhasResultado.length
    ? `<table class="kv"><tbody>${linhasResultado.map(([rot, v]) => `<tr${rot === 'Resultado do mês' ? ' class="resultado"' : ''}>${td(esc(rot))}${td(dinheiro(v), classeValor(v))}</tr>`).join('')}</tbody></table>`
    : '<p class="vazio">Sem a classificação: o resultado por conta do plano não pôde ser calculado.</p>';
  const contas = rel.resumo.contas.length
    ? `<table><thead><tr>${th('Conta')}${th('Saldo inicial', 'num')}${th('Entradas', 'num')}${th('Saídas', 'num')}${th('Resultado', 'num')}${th('Saldo final', 'num')}${th('Saldo informado pelo banco', 'num')}</tr></thead><tbody>${rel.resumo.contas.map(x => `<tr>${td(esc(x.conta) + (x.completo === false ? '<span class="sub">extrato incompleto</span>' : ''))}${td(x.saldo_inicial === null ? '—' : dinheiro(x.saldo_inicial), 'num')}${td(dinheiro(x.entradas), 'num')}${td(dinheiro(x.saidas), 'num')}${td(dinheiro(x.resultado), classeValor(x.resultado))}${td(x.saldo_final === null ? '—' : dinheiro(x.saldo_final), 'num')}${td(x.saldo_banco ? `${dinheiro(x.saldo_banco.valor)}<span class="sub">em ${data(x.saldo_banco.data)}</span>` : '—', 'num')}</tr>`).join('')}</tbody></table>`
    : '<p class="vazio">Nenhuma conta do banco cadastrada.</p>';
  const partes = [`${c.plural(rel.resumo.lancamentos, 'lançamento', 'lançamentos')} no extrato`];
  if (rel.resumo.sem_classificacao) partes.push(`${rel.resumo.sem_classificacao} sem classificação`);
  const cc = rel.resumo.conciliacao;
  if (cc) partes.push(`conciliação: ${cc.conciliados} conciliados, ${cc.ignorados} ignorados, ${cc.a_conciliar.quantidade} a conciliar${cc.sem_lancamento ? `, ${cc.sem_lancamento} registrados sem lançamento no extrato` : ''}`);
  const p = rel.resumo.pendencias;
  partes.push(`pendências${rel.pendencias.origem === 'fechamento' ? ' no fechamento' : ''}: ${p.critico} críticas, ${p.documental} documentais, ${p.aviso} avisos, ${p.ignoradas} ignoradas`);
  if (rel.resumo.documentos) partes.push(`${c.plural(rel.resumo.documentos.total, 'documento', 'documentos')}${rel.resumo.documentos.falta ? ` (${rel.resumo.documentos.falta} faltando)` : ''}`);
  return `<section><h2>Resumo</h2>${kv}<h3>Contas do banco</h3>${contas}<p>${esc(partes.join(' · '))}.</p></section>`;
}

function secaoResultado(rel) {
  const r = rel.resultado;
  if (!r) return '';
  const linhas = r.por_conta.map(g => `<tr>${td(esc(g.conta))}${td(esc(g.tipo_rotulo || ''))}${td(String(g.quantidade), 'num')}${td(g.entradas ? dinheiro(g.entradas) : '', 'num')}${td(g.saidas ? dinheiro(g.saidas) : '', 'num')}${td(dinheiro(g.resultado), classeValor(g.resultado))}</tr>`).join('');
  return `<section class="quebra"><h2>Resultado por conta do plano</h2><table><thead><tr>${th('Conta do plano')}${th('Tipo')}${th('Lançamentos', 'num')}${th('Entradas', 'num')}${th('Saídas', 'num')}${th('Resultado', 'num')}</tr></thead><tbody>${linhas || `<tr>${td('<span class="vazio">Nenhum lançamento.</span>')}</tr>`}</tbody><tfoot><tr class="resultado">${td('Resultado do mês (receitas − deduções − custos − despesas)')}${td('')}${td('')}${td('')}${td('')}${td(dinheiro(r.resultado), classeValor(r.resultado))}</tr></tfoot></table></section>`;
}

function secaoLivro(livro) {
  const conf = livro.conferencia;
  const saldoTexto = livro.saldo_origem === 'digitado'
    ? `Saldo inicial ${esc(c.reais(livro.saldo_inicial))} (pelo saldo de abertura digitado na conta, de ${data(livro.abertura?.data)}).`
      + (conf ? (Math.abs(conf.diferenca) > 0.009 ? ` Não confere com o banco em ${data(conf.data)}: livro ${esc(c.reais(conf.livro))} × banco ${esc(c.reais(conf.banco))}.` : ` Confere com o saldo do banco em ${data(conf.data)}.`) : '')
    : livro.saldo_conhecido
      ? `Saldo inicial ${esc(c.reais(livro.saldo_inicial))} (calculado do saldo que o banco informou em ${data(livro.saldo_banco.data)}: ${esc(c.reais(livro.saldo_banco.valor))}).`
      : 'Sem o saldo informado pelo banco: a coluna Saldo é o acumulado do mês.';
  const corpo = [];
  const porDia = new Map(livro.dias.map(d => [d.data, d]));
  livro.linhas.forEach((l, i) => {
    corpo.push(`<tr>${td(data(l.data), 'nowrap')}${td(esc(l.numero || ''))}${td(esc(l.descricao || ''))}${td(l.debito ? dinheiro(l.debito) : '', 'num')}${td(l.credito ? dinheiro(l.credito) : '', 'num')}${td(dinheiro(l.saldo), classeValor(l.saldo))}${td(esc(l.conta_plano || 'Sem classificação'))}${td(esc(l.observacao || ''))}${td(data(l.vencimento), 'nowrap')}</tr>`);
    const proxima = livro.linhas[i + 1];
    if (!proxima || proxima.data !== l.data) {
      const d = porDia.get(l.data);
      corpo.push(`<tr class="dia">${td(`Total do dia ${dm(l.data)}`, 'nowrap')}${td('')}${td(esc(c.plural(d.quantidade, 'lançamento', 'lançamentos')))}${td(d.saidas ? dinheiro(-d.saidas) : '', 'num')}${td(d.entradas ? dinheiro(d.entradas) : '', 'num')}${td(dinheiro(d.saldo), classeValor(d.saldo))}${td('')}${td('')}${td('')}</tr>`);
    }
  });
  const t = livro.totais;
  const pe = `<tr class="total">${td('Total do período', 'nowrap')}${td('')}${td(esc(c.plural(t.quantidade, 'lançamento', 'lançamentos')))}${td(t.saidas ? dinheiro(-t.saidas) : '', 'num')}${td(t.entradas ? dinheiro(t.entradas) : '', 'num')}${td(livro.saldo_final === null ? dinheiro(t.resultado) : dinheiro(livro.saldo_final), 'num')}${td('')}${td('')}${td('')}</tr>`;
  return `<section class="quebra"><h2>Livro-caixa — ${esc(livro.conta)}</h2><p>${saldoTexto}${livro.completo === false ? ' <strong>O extrato importado não cobre o mês inteiro.</strong>' : ''}</p><table><thead><tr>${th('Data')}${th('Número')}${th('Descrição')}${th('Débito', 'num')}${th('Crédito', 'num')}${th('Saldo', 'num')}${th('Conta do plano')}${th('Observação')}${th('Venc.')}</tr></thead><tbody>${corpo.join('') || `<tr>${td('<span class="vazio">Nenhum lançamento no mês.</span>')}</tr>`}</tbody><tfoot>${pe}</tfoot></table></section>`;
}

/** Fase C: as aplicações do mês (os PDFs do BB): o saldo, o que entrou e saiu, o rendimento, o IR e o IOF. */
function secaoAplicacoes(rel) {
  const lista = c.lista(rel.aplicacoes);
  if (!lista.length) return '';
  const linhas = lista.map(a => `<tr>${td(esc(a.rotulo))}${td(dinheiro(a.saldo_inicial), 'num')}${td(dinheiro(a.aplicacoes), 'num')}${td(dinheiro(a.resgates), 'num')}${td(dinheiro(a.rendimento), 'num')}${td(dinheiro(a.ir), 'num')}${td(dinheiro(a.iof), 'num')}${td(dinheiro(a.saldo_final), 'num')}${td(a.confere ? 'Confere ao centavo' : `<strong>Não fecha:</strong> ${esc(a.falhas.join('; '))}`)}</tr>`).join('');
  return `<section><h2>Aplicações financeiras (pelos PDFs mensais do BB)</h2><p>O rendimento fica na conta da aplicação (00020), como no balancete; o IR e o IOF são os retidos nos resgates. No CDB, o saldo é o capital em ser.</p><table><thead><tr>${th('Aplicação')}${th('Saldo inicial', 'num')}${th('Aplicado', 'num')}${th('Resgatado (líquido)', 'num')}${th('Rendimento do mês', 'num')}${th('IR', 'num')}${th('IOF', 'num')}${th('Saldo final', 'num')}${th('Conferência')}</tr></thead><tbody>${linhas}</tbody></table></section>`;
}

function secaoConciliacao(rel) {
  if (!rel.conciliacao) return '';
  const blocos = rel.conciliacao.map(x => {
    const t = x.totais;
    const lista = (titulo, itens, texto) => (itens.length
      ? `<h3>${esc(titulo)} (${itens.length})</h3><table><thead><tr>${th('Data')}${th('Valor', 'num')}${th('Descrição')}${th('Observação')}</tr></thead><tbody>${itens.map(i => `<tr>${td(data(i.data), 'nowrap')}${td(dinheiro(i.valor), classeValor(i.valor))}${td(esc(i.descricao || i.rotulo || ''))}${td(esc(texto(i)))}</tr>`).join('')}</tbody></table>`
      : '');
    return `<h3>${esc(x.conta)}</h3><p>${t.total} lançamentos: ${t.conciliados} conciliados, ${t.ignorados} ignorados, ${t.a_conciliar.quantidade} a conciliar (${esc(c.reais(t.a_conciliar.total))})${x.cobertura && x.cobertura.completa === false ? ' · o extrato não cobre o mês inteiro' : ''}.</p>`
      + lista('A conciliar', x.a_conciliar, i => (i.sugestao ? 'tem sugestão' : ''))
      + lista('Ignorados', x.ignorados, i => i.observacao || '')
      + lista('Conciliados com diferença', x.com_diferenca, i => `diferença ${c.reais(i.diferenca)}${i.observacao ? ` — ${i.observacao}` : ''}`)
      + lista('Registrado no app sem lançamento no extrato', x.sem_lancamento, i => [i.tipo, i.nome, i.forma].filter(Boolean).join(' · '));
  }).join('');
  return `<section class="quebra"><h2>Conciliação bancária</h2>${blocos || '<p class="vazio">Nenhuma conta do banco.</p>'}</section>`;
}

function secaoPendencias(rel) {
  const lista = rel.pendencias.lista;
  const origem = rel.pendencias.origem === 'fechamento' ? 'O que sobrou (ou foi ignorado) quando a competência fechou.' : 'As pendências de hoje.';
  const linhas = lista.map(p => `<tr>${td(esc(p.nivel_rotulo), 'nowrap')}${td(`${esc(p.titulo)}${p.descricao ? `<span class="sub">${esc(p.descricao)}</span>` : ''}`)}${td(p.ignorada ? `Ignorada${p.justificativa ? `: ${esc(p.justificativa)}` : ''}` : 'Em aberto')}</tr>`).join('');
  return `<section class="quebra"><h2>Pendências</h2><p>${esc(origem)}</p><table><thead><tr>${th('Nível')}${th('Pendência')}${th('Situação')}</tr></thead><tbody>${linhas || `<tr>${td('<span class="vazio">Nenhuma pendência.</span>')}</tr>`}</tbody></table></section>`;
}

function secaoDocumentos(rel) {
  if (!rel.documentos) return '';
  const linhas = rel.documentos.itens.map(i => `<tr>${td(esc(i.grupo_rotulo || ''))}${td(data(i.data), 'nowrap')}${td(esc(i.titulo || ''))}${td(esc(i.detalhe || ''))}${td(i.valor === null || i.valor === undefined ? '' : dinheiro(i.valor), 'num')}${td(esc(i.falta ? (i.falta_rotulo || 'Falta o arquivo') : [i.categoria, i.origem_rotulo].filter(Boolean).join(' · ')))}</tr>`).join('');
  return `<section class="quebra"><h2>Documentos da competência</h2><table><thead><tr>${th('Grupo')}${th('Data')}${th('Documento')}${th('Detalhe')}${th('Valor', 'num')}${th('Arquivo')}</tr></thead><tbody>${linhas || `<tr>${td('<span class="vazio">Nenhum documento.</span>')}</tr>`}</tbody></table></section>`;
}

/** O HTML completo do relatório (a página do PDF). */
function html(rel) {
  const st = rel.situacao;
  const selo = st.previa
    ? '<div class="selo selo--previa">PRÉVIA</div>'
    : `<div class="selo selo--fechada">Fechada${st.versao ? ` · versão ${st.versao}` : ''}</div>`;
  const avisos = rel.avisos.length ? `<ul class="avisos">${rel.avisos.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : '';
  const empresa = [rel.empresa?.razao_social || rel.empresa?.nome, rel.empresa?.cnpj ? `CNPJ ${rel.empresa.cnpj}` : null].filter(Boolean).join(' · ');
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(`Relatório mensal — ${rel.rotulo}`)}</title><style>${CSS}</style></head><body>`
    + (st.previa ? '<div class="marca">PRÉVIA</div>' : '')
    + `<header class="topo"><div><h1>${esc(`Relatório mensal — ${rel.rotulo}`)}</h1><p>${esc(empresa)}</p></div>${selo}</header>`
    + `<p class="nota">${esc(st.nota)}</p>${avisos}`
    + secaoResumo(rel) + secaoResultado(rel) + rel.livro.map(secaoLivro).join('') + secaoAplicacoes(rel) + secaoConciliacao(rel) + secaoPendencias(rel) + secaoDocumentos(rel)
    + `<p class="rodape">Documento interno gerado pelo App-Gestão em ${esc(instanteImpresso(rel.gerado_em))}. Os documentos oficiais (XML, OFX, comprovantes) vão no pacote da competência.</p>`
    + '</body></html>';
}

/**
 * Fase I (02/10/2026): o extrato do mês de uma conta em PDF, para a pasta
 * 02-Extrato do pacote — a mesma seção do livro-caixa do relatório, numa
 * página própria e marcada como gerada (o OFX original vai ao lado).
 */
function htmlDoLivro(rel, livro) {
  const empresa = [rel.empresa?.razao_social || rel.empresa?.nome, rel.empresa?.cnpj ? `CNPJ ${rel.empresa.cnpj}` : null].filter(Boolean).join(' · ');
  const titulo = `Extrato do mês — ${livro.conta} — ${rel.rotulo}`;
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>${CSS}</style></head><body>`
    + `<header class="topo"><div><h1>${esc(titulo)}</h1><p>${esc(empresa)}</p></div><div class="selo selo--previa">GERADO PELO APP</div></header>`
    + '<p class="nota">Feito pelo App-Gestão a partir dos lançamentos importados do banco (OFX e API do BB). Não é o extrato oficial: o OFX original está nesta mesma pasta.</p>'
    + secaoLivro(livro).replace('<section class="quebra">', '<section>')
    + `<p class="rodape">Documento interno gerado pelo App-Gestão em ${esc(instanteImpresso(rel.gerado_em))}.</p>`
    + '</body></html>';
}

module.exports = { html, htmlDoLivro, esc };
