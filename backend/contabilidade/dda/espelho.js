/**
 * O "Espelho DDA" (fase H): uma página A4, gerada na hora (nunca guardada),
 * só com o que a API DDA do BB devolveu do boleto — beneficiário e
 * beneficiário final, seu número, código de barras (e as barras ITF-25
 * desenhadas dele, as mesmas do boleto do fornecedor), a linha digitável
 * CALCULADA do código, registro, vencimento, valor, o estado no BB e quando
 * o app capturou. O que o DDA não dá (nosso número, emissão, juros, multa,
 * desconto, instruções) não aparece.
 *
 * O rodapé é o que o BB orientou, palavra por palavra: não é segunda via nem
 * representação gráfica oficial do boleto. A chave interna aparece como "ID
 * interno do App-Gestão" (o BB não dá identificador).
 *
 * O PDF sai pela tela (electronAPI.gerarPdfDeHtml), como o relatório; no
 * pacote (fase I) ele vai na pasta de cada pagamento.
 */
const c = require('../../financeiro/comum');
const b = require('../base');
const { itf25Svg } = require('../../cobranca/boletoDocumento');
const bbDda = require('../integracoes/bbDda');
const dda = require('./dda');

const RODAPE = 'Documento interno gerado pelo App-Gestão a partir de dados obtidos diretamente da API DDA do Banco do Brasil. Não constitui segunda via ou representação gráfica oficial do boleto.';

const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const doc = v => b.documentoFormatado(v) || v || '—';

/** O nome do arquivo do espelho (curto: vai numa pasta do pacote). Pura. */
function nomeDoArquivo(bol) {
  const quem = String(bol.beneficiario_nome || 'beneficiario').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').slice(0, 3).join(' ');
  return `Espelho DDA ${String(bol.vencimento).split('-').reverse().join('-')} ${quem} ${c.centavos(bol.valor).toFixed(2).replace('.', ',')}.pdf`.replace(/\s+/g, ' ');
}

/**
 * O HTML do espelho. `bol` é a linha normalizada (dda.normalizar);
 * `empresa` = { razao_social, cnpj } (o pagador, da Configuração fiscal);
 * `geradoEm` = instante ISO. Pura.
 */
function montarHtml(bol, { empresa = null, geradoEm = null } = {}) {
  const linha = dda.linhaImpressa(bol.linha_digitavel);
  let barras = '';
  try { barras = itf25Svg(bol.codigo_barras, { altura: 50, largura: 410 }); } catch (_) { barras = ''; }
  const finalDiferente = bol.beneficiario_final_documento && bol.beneficiario_final_documento !== bol.beneficiario_documento;
  const quando = iso => {
    const t = b.instanteBR(iso);
    return t ? `${t.slice(8, 10)}/${t.slice(5, 7)}/${t.slice(0, 4)} ${t.slice(11, 16)}` : '—';
  };
  const estados = Array.isArray(bol.estados) ? bol.estados : (c.jsonDe(bol.estados, []) || []);
  const historico = estados.map(e => `${bbDda.ROTULOS_ESTADO[e.estado] || '—'} em ${quando(e.visto_em)}`);
  const campo = (rotulo, valor, classe = '') => `<div class="campo ${classe}"><span class="rotulo">${esc(rotulo)}</span><span class="valor">${valor}</span></div>`;
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(nomeDoArquivo(bol))}</title>
<style>
  @page { size: A4 portrait; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 11pt; margin: 0; }
  .topo { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111; padding-bottom: 6px; }
  .topo h1 { font-size: 15pt; margin: 0; }
  .topo .sub { font-size: 9pt; color: #444; }
  .marca { display: inline-block; border: 1px solid #b45309; color: #b45309; padding: 2px 8px; font-size: 8.5pt; font-weight: bold; border-radius: 3px; letter-spacing: .3px; }
  .grade { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin-top: 10px; border: 1px solid #999; }
  .campo { padding: 6px 8px; border-bottom: 1px solid #ccc; border-right: 1px solid #ccc; min-height: 40px; }
  .campo.largo { grid-column: span 2; }
  .rotulo { display: block; font-size: 7.5pt; text-transform: uppercase; color: #555; letter-spacing: .3px; }
  .valor { display: block; font-size: 10.5pt; margin-top: 2px; word-break: break-word; }
  .campo.forte .valor { font-weight: bold; font-size: 12pt; }
  .linha { font-family: 'Courier New', monospace; font-size: 12pt; letter-spacing: .5px; }
  .barras { margin-top: 14px; }
  .barras .nota { font-size: 8pt; color: #555; margin-top: 4px; }
  .rodape { margin-top: 18px; border-top: 1px solid #111; padding-top: 8px; font-size: 9pt; font-weight: bold; }
  .rodape .id { font-weight: normal; color: #444; margin-top: 6px; font-size: 8pt; }
</style></head>
<body>
  <div class="topo">
    <div><h1>Espelho DDA</h1><div class="sub">Boleto registrado contra a empresa no DDA do Banco do Brasil</div></div>
    <span class="marca">DOCUMENTO INTERNO — NÃO É BOLETO</span>
  </div>
  <div class="grade">
    ${campo('Beneficiário', `${esc(bol.beneficiario_nome || '—')}<br>${esc(doc(bol.beneficiario_documento))}`, 'largo')}
    ${finalDiferente ? campo('Beneficiário final', `${esc(bol.beneficiario_final_nome || '—')}<br>${esc(doc(bol.beneficiario_final_documento))}`, 'largo') : ''}
    ${campo('Pagador', `${esc(empresa?.razao_social || '—')}<br>${esc(doc(empresa?.cnpj || bol.pagador_documento))}`, 'largo')}
    ${campo('Vencimento', esc(c.impressa(bol.vencimento)), 'forte')}
    ${campo('Valor (de vencimento)', esc(c.reais(bol.valor)))}
    ${campo('Seu número', esc(bol.seu_numero || 'não informado pelo beneficiário'))}
    ${campo('Data de registro', esc(bol.data_registro ? c.impressa(bol.data_registro) : '—'))}
    ${campo('Estado no DDA', `${esc(bbDda.ROTULOS_ESTADO[bol.estado_bb] || '—')}${historico.length > 1 ? `<br><small>${historico.map(esc).join(' · ')}</small>` : ''}`)}
    ${campo('Capturado pelo app', `${esc(quando(bol.capturado_em))}${bol.ambiente && bol.ambiente !== 'producao' ? ' (homologação)' : ''}`)}
    ${campo('Código de barras (44 posições, como o BB informou)', `<span class="linha">${esc(bol.codigo_barras)}</span>`, 'largo')}
    ${campo('Linha digitável — CALCULADA pelo app a partir do código de barras', `<span class="linha">${esc(linha || 'não foi possível calcular')}</span>`, 'largo')}
  </div>
  ${barras ? `<div class="barras">${barras}<div class="nota">Barras desenhadas a partir do código de barras informado pelo BB.</div></div>` : ''}
  <div class="rodape">${esc(RODAPE)}
    <div class="id">ID interno do App-Gestão (não é identificador do BB): ${esc(bol.chave_interna)} · gerado em ${esc(quando(geradoEm || new Date().toISOString()))}</div>
  </div>
</body></html>`;
}

/** O espelho de um boleto, para a tela imprimir em PDF. */
async function gerar(api, id, { agora = new Date() } = {}) {
  const bol = dda.normalizar(await dda.lerBoleto(api, id));
  const fiscal = await require('../../fiscal/configuracaoFiscal').carregar(api).catch(() => null);
  return { nome: nomeDoArquivo(bol), html: montarHtml(bol, { empresa: fiscal ? { razao_social: fiscal.razao_social, cnpj: fiscal.cnpj } : null, geradoEm: agora.toISOString() }) };
}

module.exports = { RODAPE, nomeDoArquivo, montarHtml, gerar };
