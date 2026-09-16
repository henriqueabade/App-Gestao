/**
 * Carta de Correção Eletrônica em HTML (para o PDF): a "segunda via" que o
 * cliente recebe junto com o DANFE. Emitente e destinatário saem do nfeProc
 * da nota; a correção, a sequência e o protocolo saem do evento registrado.
 */
const { lerNfe } = require('./danfe');
const { COND_USO_CCE } = require('./sefazCliente');

function esc(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const cnpjFmt = d => (String(d || '').length === 14 ? String(d).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : String(d || ''));
const cpfFmt = d => (String(d || '').length === 11 ? String(d).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : String(d || ''));
const dataHora = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}:\d{2}))?/.exec(String(iso || '')); return m ? `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}` : ''}` : ''; };
const chaveFmt = c => String(c || '').replace(/(\d{4})(?=\d)/g, '$1 ');

const CSS = `
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 9pt; color: #000; background: #fff; }
  .folha { width: 186mm; margin: 0 auto; position: relative; }
  h1 { font-size: 14pt; text-align: center; margin: 0 0 1mm; }
  .sub { text-align: center; font-size: 8pt; color: #333; margin-bottom: 5mm; }
  .quadro { border: 1px solid #000; padding: 3mm; margin-bottom: 4mm; break-inside: avoid; page-break-inside: avoid; }
  .quadro h2 { font-size: 7pt; text-transform: uppercase; margin: 0 0 2mm; color: #222; }
  .linha { display: grid; grid-template-columns: 38mm 1fr; gap: 1mm 3mm; font-size: 8.5pt; }
  .linha dt { color: #333; } .linha dd { margin: 0; font-weight: bold; }
  .texto { font-size: 10pt; white-space: pre-wrap; line-height: 1.4; }
  .cond { font-size: 7pt; color: #222; line-height: 1.35; }
  .marca { position: absolute; top: 45%; left: 0; right: 0; text-align: center; font-size: 40pt; font-weight: bold; color: rgba(200, 0, 0, 0.16); transform: rotate(-25deg); pointer-events: none; }
`;

/**
 * @param {object} p  { xmlNfeProc, carta: { nSeqEvento, correcao, protocolo, registradaEm }, cancelada }
 */
function montarCartaCorrecaoHtml({ xmlNfeProc, carta = {}, cancelada = false } = {}) {
  const n = lerNfe(xmlNfeProc);
  const e = n.emitente;
  const d = n.destinatario;
  const marca = cancelada ? 'NF-e CANCELADA' : (n.ambiente === 'homologacao' ? 'SEM VALOR FISCAL' : '');
  const seq = Number(carta.nSeqEvento) || 1;
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Carta de Correção ${seq} — NF-e ${esc(n.numero)}</title><style>${CSS}</style></head><body>
<div class="folha">
  ${marca ? `<div class="marca">${esc(marca)}</div>` : ''}
  <h1>CARTA DE CORREÇÃO ELETRÔNICA — CC-e</h1>
  <div class="sub">Evento 110110 · Sequência ${seq} · vinculada à NF-e ${esc(n.serie)}/${String(n.numero).padStart(9, '0')}</div>

  <div class="quadro">
    <h2>Nota fiscal eletrônica</h2>
    <dl class="linha">
      <dt>Chave de acesso</dt><dd>${chaveFmt(n.chave)}</dd>
      <dt>Número / Série</dt><dd>${esc(n.numero)} / ${esc(n.serie)}</dd>
      <dt>Emissão</dt><dd>${dataHora(n.dhEmi)}</dd>
      <dt>Protocolo da NF-e</dt><dd>${esc(n.protocolo.numero)} — ${dataHora(n.protocolo.data)}</dd>
    </dl>
  </div>

  <div class="quadro">
    <h2>Emitente</h2>
    <dl class="linha">
      <dt>Razão social</dt><dd>${esc(e.nome)}</dd>
      <dt>CNPJ / IE</dt><dd>${cnpjFmt(e.cnpj)} / ${esc(e.ie)}</dd>
      <dt>Endereço</dt><dd>${esc(e.logradouro)}, ${esc(e.numero)}${e.complemento ? ` - ${esc(e.complemento)}` : ''} — ${esc(e.bairro)} — ${esc(e.municipio)}/${esc(e.uf)}</dd>
    </dl>
  </div>

  <div class="quadro">
    <h2>Destinatário</h2>
    <dl class="linha">
      <dt>Nome / Razão social</dt><dd>${esc(d.nome)}</dd>
      <dt>CNPJ / CPF</dt><dd>${d.cnpj ? cnpjFmt(d.cnpj) : cpfFmt(d.cpf)}</dd>
      <dt>Endereço</dt><dd>${esc(d.logradouro)}, ${esc(d.numero)} — ${esc(d.bairro)} — ${esc(d.municipio)}/${esc(d.uf)}</dd>
    </dl>
  </div>

  <div class="quadro">
    <h2>Correção</h2>
    <div class="texto">${esc(carta.correcao)}</div>
  </div>

  <div class="quadro">
    <h2>Registro na SEFAZ</h2>
    <dl class="linha">
      <dt>Protocolo do evento</dt><dd>${esc(carta.protocolo || '—')}</dd>
      <dt>Registrada em</dt><dd>${dataHora(carta.registradaEm) || '—'}</dd>
      <dt>Sequência</dt><dd>${seq}${seq > 1 ? ' (substitui as anteriores)' : ''}</dd>
    </dl>
  </div>

  <div class="quadro">
    <h2>Condições de uso</h2>
    <div class="cond">${esc(COND_USO_CCE)}</div>
  </div>
</div>
</body></html>`;
}

module.exports = { montarCartaCorrecaoHtml };
