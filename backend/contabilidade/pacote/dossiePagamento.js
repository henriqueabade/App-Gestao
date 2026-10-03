/**
 * O dossiê de um pagamento (fase I, 02/10/2026): uma página A4 (ou mais),
 * gerada na hora do pacote e nunca guardada, que junta a cadeia da prova —
 * o pagamento, a conta e a parcela, a nota (e onde ela está), o boleto, o
 * lançamento do extrato e o comprovante do banco — e lista os arquivos que
 * acompanham a pasta, com o SHA-256 de cada um.
 *
 * É documento interno: não substitui os originais. O PDF sai pela impressora
 * do backend (o Electron); sem ela, o pacote leva este HTML. Pura.
 */
const c = require('../../financeiro/comum');
const b = require('../base');
const camposComprovante = require('../comprovantes/campos');

const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const data = iso => (c.dia(iso) ? c.impressa(iso) : '—');
const reais = v => (v === null || v === undefined || v === '' ? '—' : c.reais(v));
const linhaImpressa = d => {
  const s = b.digitos(d);
  return s.length === 47 ? `${s.slice(0, 5)}.${s.slice(5, 10)} ${s.slice(10, 15)}.${s.slice(15, 21)} ${s.slice(21, 26)}.${s.slice(26, 32)} ${s[32]} ${s.slice(33)}` : (s || null);
};

const NOME_DO_ARQUIVO = 'Dossie do pagamento';

const CSS = `
  @page { size: A4 portrait; margin: 14mm 13mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 9.5pt; margin: 0; }
  .topo { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; border-bottom: 2px solid #111; padding-bottom: 6px; }
  .topo h1 { font-size: 15pt; margin: 0; }
  .topo .sub { font-size: 9pt; color: #444; margin-top: 2px; }
  .marca { display: inline-block; border: 1px solid #b45309; color: #b45309; padding: 2px 8px; font-size: 8pt; font-weight: bold; border-radius: 3px; white-space: nowrap; }
  h2 { font-size: 10.5pt; margin: 12px 0 4px; padding-bottom: 2px; border-bottom: 1.5px solid #b6a03e; }
  table { width: 100%; border-collapse: collapse; }
  .kv td { padding: 2.5px 4px; border-bottom: 1px solid #e3e3e3; vertical-align: top; }
  .kv td:first-child { width: 34%; color: #555; }
  .lista th, .lista td { padding: 3px 4px; border-bottom: 1px solid #ddd; text-align: left; vertical-align: top; }
  .lista th { background: #f1ede0; font-size: 8.5pt; }
  .num { text-align: right; white-space: nowrap; }
  .mono { font-family: 'Courier New', monospace; font-size: 8.5pt; word-break: break-all; }
  .vazio { color: #666; font-style: italic; }
  .faltas { margin: 4px 0 0; padding: 6px 10px; border: 1px solid #b91c1c; color: #7f1d1d; background: #fef2f2; }
  .faltas li { margin: 1px 0; }
  .ok { margin: 4px 0 0; padding: 5px 10px; border: 1px solid #15803d; color: #14532d; background: #f0fdf4; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  .rodape { margin-top: 14px; border-top: 1px solid #111; padding-top: 6px; font-size: 8pt; color: #333; }
`;

const kv = linhas => {
  const vivas = linhas.filter(([, v]) => v !== null && v !== undefined && v !== '');
  return vivas.length ? `<table class="kv">${vivas.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join('')}</table>` : '';
};
const secao = (titulo, corpo, vazio = 'Nada registrado.') => `<h2>${esc(titulo)}</h2>${corpo || `<p class="vazio">${esc(vazio)}</p>`}`;

function secaoPagamento(pag) {
  const pg = pag.pagamento || {};
  return secao('O pagamento', kv([
    ['Tipo', esc(pag.tipo_rotulo)], ['Data', esc(data(pag.data))], ['Valor pago', `<strong>${esc(reais(pag.valor))}</strong>`],
    ['Juros ou multa', pg.juros ? esc(reais(pg.juros)) : null], ['Desconto', pg.desconto ? esc(reais(pg.desconto)) : null],
    ['Forma', esc(pag.forma || '—')], ['Para quem', esc([pag.nome, pag.documento].filter(Boolean).join(' · ') || '—')],
    ['Observação', pg.observacao ? esc(pg.observacao) : null]
  ]));
}

function secaoOrigem(pag) {
  if (pag.conta) {
    const t = pag.conta;
    const p = pag.parcela;
    return secao('A conta a pagar', kv([
      ['Descrição', esc(t.descricao)], ['Fornecedor', esc([t.fornecedor, t.fornecedor_documento].filter(Boolean).join(' · ') || '—')],
      ['Conta do plano', esc(t.categoria || 'Sem categoria')], ['Nº do documento', t.numero_documento ? esc(t.numero_documento) : null],
      ['Competência da conta', esc(c.rotuloCompetencia(t.competencia))], ['Valor total da conta', esc(reais(t.valor_total))],
      ['Parcela', p ? esc(`${p.numero} de ${p.de} · vence em ${data(p.vencimento)} · ${reais(p.valor)}`) : null],
      ['Linha digitável da parcela', p?.linha_digitavel ? `<span class="mono">${esc(linhaImpressa(p.linha_digitavel))}</span>` : null]
    ]));
  }
  if (pag.fechamento) return secao('O fechamento pago', kv([['Fechamento', esc(pag.fechamento.rotulo)], ['Detalhe', pag.fechamento.detalhe ? esc(pag.fechamento.detalhe) : null]]));
  if (pag.reembolso) {
    const notas = c.lista(pag.devolucoes).map(n => `${esc(n.rotulo)} · ${esc(data(n.data_emissao))} · ${esc(reais(n.valor_total))}${n.chave_acesso ? `<br><span class="mono">${esc(n.chave_acesso)}</span>` : ''}`);
    return secao('O reembolso', kv([['Reembolso', esc(pag.reembolso.rotulo)], ['NF-e de devolução do cliente', notas.length ? `${notas.join('<br>')}<br><small>Vai na pasta 04-Devolucoes do pacote do mês dela.</small>` : null]]));
  }
  return secao('A origem', '', 'Pagamento sem conta a pagar ligada.');
}

function secaoNotas(pag) {
  if (!pag.documentos.length) {
    const anexos = pag.arquivos.filter(a => ['nota', 'recibo', 'guia', 'nfse', 'xml_nfe', 'contrato'].includes(a.categoria));
    return secao('A nota (ou recibo, guia)', anexos.length ? kv(anexos.map(a => [a.categoria_rotulo, `${esc(a.nome)} <small>(nesta pasta)</small>`])) : '',
      'Nenhuma nota, recibo ou guia ligados a este pagamento.');
  }
  return secao(pag.documentos.length > 1 ? 'As notas' : 'A nota', pag.documentos.map(d => kv([
    ['Documento', `<strong>${esc(d.rotulo)}</strong> (${esc(d.tipo_rotulo)})`], ['Chave de acesso', d.chave_acesso ? `<span class="mono">${esc(d.chave_acesso)}</span>` : null],
    ['Emitente', esc([d.emitente, d.emitente_documento].filter(Boolean).join(' · ') || '—')], ['Emissão', esc(data(d.data_emissao))],
    ['Valor', esc(reais(d.valor_total))], ['Competência fiscal', esc(c.rotuloCompetencia(d.competencia))], ['Onde está', esc(d.onde.texto)]
  ])).join(''));
}

function secaoBoleto(pag, { espelho = null } = {}) {
  const linhas = [];
  if (pag.dda) {
    const bol = pag.dda;
    linhas.push(
      ['Boleto no DDA do BB', esc(`${bol.beneficiario_nome || '—'}${bol.beneficiario_documento ? ` · ${b.documentoFormatado(bol.beneficiario_documento)}` : ''}`)],
      ['Vencimento e valor', esc(`${data(bol.vencimento)} · ${reais(bol.valor)}`)],
      ['Linha digitável (calculada do código de barras)', `<span class="mono">${esc(linhaImpressa(bol.linha_digitavel) || '—')}</span>`],
      ['Espelho DDA', espelho ? `${esc(espelho)} <small>(nesta pasta; documento interno, não é 2ª via)</small>` : null]
    );
  }
  for (const a of pag.arquivos.filter(x => x.categoria === 'boleto')) linhas.push(['Boleto do fornecedor', `${esc(a.nome)} <small>(nesta pasta)</small>`]);
  return secao('O boleto', kv(linhas), pag.forma === 'Boleto' ? 'Pago por boleto, mas o boleto não está no app (nem no DDA nem anexado).' : 'Sem boleto (o pagamento não foi por boleto).');
}

function secaoBanco(pag) {
  if (!pag.movimentos.length) return secao('No banco (extrato)', '', pag.no_banco ? 'Nenhum lançamento do extrato conciliado com este pagamento.' : `Pago fora do banco (${pag.forma || 'sem forma'}).`);
  const linhas = pag.movimentos.map(m => `<tr><td>${esc(data(m.data))}</td><td>${esc(m.conta || '—')}</td><td>${esc(m.descricao || '—')}${m.documento ? `<br><small>documento ${esc(m.documento)}</small>` : ''}${m.contrapartida ? `<br><small>CPF/CNPJ ${esc(m.contrapartida)}</small>` : ''}</td><td class="num">${esc(reais(m.valor))}</td><td>${esc(m.criterio || '—')}</td></tr>`);
  return secao('No banco (extrato)', `<table class="lista"><thead><tr><th>Data</th><th>Conta</th><th>Lançamento</th><th class="num">Valor</th><th>Conciliação</th></tr></thead><tbody>${linhas.join('')}</tbody></table>`);
}

function secaoComprovante(pag, { nomesDosComprovantes = new Map() } = {}) {
  const blocos = pag.comprovantes.map(cp => kv([
    ['Tipo', esc(camposComprovante.TIPOS[cp.tipo] || cp.tipo || '—')], ['Data e valor', esc(`${data(cp.data)} · ${reais(cp.valor)}`)],
    ['Favorecido', esc([cp.favorecido_nome, b.documentoFormatado(cp.favorecido_documento) || cp.favorecido_documento].filter(Boolean).join(' · ') || '—')],
    ['Autenticação', cp.autenticacao ? `<span class="mono">${esc(cp.autenticacao)}</span>` : null], ['Documento', cp.documento ? esc(cp.documento) : null],
    ['ID do Pix', cp.e2e ? `<span class="mono">${esc(cp.e2e)}</span>` : null],
    ['Arquivo', `${esc(nomesDosComprovantes.get(String(cp.id)) || cp.nome_arquivo || '—')} <small>(nesta pasta; ${cp.confere ? 'refeito dos dados, idêntico ao original do BB' : 'o original do BB'})</small>`]
  ]));
  for (const a of pag.arquivos.filter(x => x.categoria === 'comprovante')) blocos.push(kv([['Comprovante anexado', `${esc(a.nome)} <small>(nesta pasta)</small>`]]));
  return secao('O comprovante do banco', blocos.join(''), 'Nenhum comprovante ligado (anexe o ZIP dos comprovantes do BB).');
}

function secaoArquivos(arquivosDaPasta) {
  if (!arquivosDaPasta.length) return secao('Arquivos desta pasta', '', 'Só este dossiê.');
  const linhas = arquivosDaPasta.map(a => `<tr><td>${esc(a.nome)}</td><td>${esc(a.tipo || '—')}</td><td>${esc(a.origem_rotulo || '—')}</td><td class="mono">${esc(a.sha256)}</td></tr>`);
  return secao('Arquivos desta pasta', `<table class="lista"><thead><tr><th>Arquivo</th><th>O que é</th><th>Origem</th><th>SHA-256</th></tr></thead><tbody>${linhas.join('')}</tbody></table>`);
}

/**
 * O HTML do dossiê. `pag` = uma pasta de pagamentos.planoDosPagamentos (com
 * `documentos[].onde` já com o caminho neste pacote); `arquivosDaPasta` =
 * [{ nome, tipo, origem_rotulo, sha256 }] (o que foi junto, menos este
 * dossiê); `espelho` = o nome do Espelho DDA na pasta. Pura.
 */
function montarHtml(pag, { empresa = null, competencia, geradoEm = null, arquivosDaPasta = [], espelho = null, nomesDosComprovantes = new Map() } = {}) {
  const titulo = `Dossiê do pagamento — ${pag.pasta}`;
  const quem = [empresa?.razao_social || empresa?.nome, empresa?.cnpj ? `CNPJ ${b.documentoFormatado(empresa.cnpj) || empresa.cnpj}` : null].filter(Boolean).join(' · ');
  const quando = b.instanteBR(geradoEm || new Date().toISOString());
  const faltas = pag.faltas.length
    ? `<ul class="faltas">${pag.faltas.map(f => `<li>${esc(f)}</li>`).join('')}</ul>`
    : '<p class="ok">A cadeia está completa: o pagamento, o extrato, o comprovante e o documento.</p>';
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>${CSS}</style></head>
<body>
  <div class="topo">
    <div><h1>Dossiê do pagamento</h1><div class="sub">${esc(`${pag.rotulo || pag.tipo_rotulo} · ${reais(pag.valor)} em ${data(pag.data)}`)}</div><div class="sub">${esc(`Competência ${c.rotuloCompetencia(competencia)}${quem ? ` · ${quem}` : ''} · pasta ${pag.pasta}`)}</div></div>
    <span class="marca">DOCUMENTO INTERNO</span>
  </div>
  ${faltas}
  ${secaoPagamento(pag)}
  ${secaoOrigem(pag)}
  ${secaoNotas(pag)}
  ${secaoBoleto(pag, { espelho })}
  ${secaoBanco(pag)}
  ${secaoComprovante(pag, { nomesDosComprovantes })}
  ${secaoArquivos(arquivosDaPasta)}
  <div class="rodape">Documento interno gerado pelo App-Gestão em ${esc(quando ? `${c.impressa(quando.slice(0, 10))} às ${quando.slice(11, 16)}` : '—')} a partir dos dados registrados no aplicativo. Não substitui os documentos originais: eles acompanham esta pasta ou estão no pacote indicado. O SHA-256 de cada arquivo está acima e no indice.csv do pacote.</div>
</body></html>`;
}

module.exports = { NOME_DO_ARQUIVO, montarHtml, linhaImpressa };
