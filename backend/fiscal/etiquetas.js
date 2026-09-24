/**
 * Etiquetas das caixas do pedido enviado (botão bordô "Etiquetas" no
 * Visualizar — pedido do dono, 24/09/2026, pelos três modelos em PDF).
 *
 * Um PDF só, com as duas etiquetas:
 *
 *   1. ETIQUETA DE TRANSPORTE (A4 paisagem), uma por volume: a marca, a
 *      empresa, o cliente (razão social em negrito acima da linha, nome
 *      fantasia abaixo), a NF-e, o volume ("363_01/02"), o peso aproximado
 *      (sempre o PESO BRUTO do volume), a dimensão em mm, a transportadora e
 *      as faixas "FRÁGIL", "ATENÇÃO" e a seta "mantenha esse lado para cima".
 *      Duas por folha; o volume que sobra (número ímpar) fica sozinho,
 *      centralizado na folha;
 *   2. ETIQUETA "ATENÇÃO — MANTENHA ESSE LADO PARA CIMA" (A4 retrato), uma
 *      por volume, duas por folha; a que sobra fica em cima.
 *
 * As duas orientações convivem no mesmo PDF pelas páginas nomeadas do CSS
 * (`page: paisagem` / `page: retrato`), que o Chromium do Electron respeita.
 * A marca vai embutida uma vez só (data URI no CSS): o HTML é aberto de um
 * arquivo temporário, sem JavaScript, e não enxergaria os assets do app.
 *
 * Os volumes vêm, nesta ordem: do que foi informado no envio
 * (`pedidos.volumes_detalhe`, com as dimensões — sql/pedido_volumes_etiquetas.sql),
 * do XML da NF-e (peso bruto de cada volume) e, por fim, do resumo do pedido.
 */
const fs = require('fs');
const path = require('path');
const danfe = require('./danfe');
const externas = require('./externas');

/** A empresa, como está nos modelos de etiqueta do dono. */
const EMPRESA = {
  nome: 'SANTÍSSIMO DECOR LTDA.',
  telefone: '(31) 3357-4894',
  site: 'www.santissimodecor.com.br'
};
const MARCA_PADRAO = path.join(__dirname, '..', '..', 'src', 'assets', 'Marca.png');

const lista = r => (Array.isArray(r) ? r : (r && typeof r === 'object' && !r.error ? [r] : []));
const esc = v => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const numero = v => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

function erro(mensagem, status = 400) {
  const e = new Error(mensagem);
  e.status = status;
  return e;
}

let marcaCache;
/** A marca (Marca.png) como data URI; sem o arquivo, sem imagem. */
function marcaDataUrl(caminho = MARCA_PADRAO) {
  if (marcaCache !== undefined && caminho === MARCA_PADRAO) return marcaCache;
  let dados = '';
  try {
    dados = `data:image/png;base64,${fs.readFileSync(caminho).toString('base64')}`;
  } catch (_) {
    dados = '';
  }
  if (caminho === MARCA_PADRAO) marcaCache = dados;
  return dados;
}

// ------------------------------------------------------------- contas puras

/** 11 → "11,000" (o peso da etiqueta, em kg, com três casas). */
function pesoImpresso(kg) {
  const n = numero(kg);
  if (n === null || n <= 0) return '';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

/** { comprimento, largura, altura } em mm → "440 x 665 x 270" (vazio se faltar alguma). */
function dimensaoImpressa(d) {
  const partes = [d?.comprimento, d?.largura, d?.altura].map(numero);
  if (partes.some(p => p === null || p <= 0)) return '';
  return partes.map(p => String(Math.round(p))).join(' x ');
}

/** "363_01/02": a nota (ou o pedido, sem nota), o volume e o total com dois dígitos. */
function numeroDoVolume(referencia, indice, total) {
  const dois = n => String(n).padStart(2, '0');
  return `${referencia}_${dois(indice)}/${dois(total)}`;
}

/** O que foi gravado no pedido no envio (texto JSON ou lista). Pura. */
function volumesDoPedido(pedido) {
  let bruto = pedido?.volumes_detalhe;
  if (typeof bruto === 'string') {
    try { bruto = JSON.parse(bruto); } catch (_) { bruto = null; }
  }
  return Array.isArray(bruto) ? bruto.filter(v => v && typeof v === 'object') : [];
}

/**
 * Os volumes da etiqueta: `[{ peso_bruto, dimensoes }]`, um por caixa.
 *   1. o que foi informado no envio (tem as dimensões);
 *   2. o XML da NF-e (peso bruto de cada volume; um <vol> com qVol > 1 vira
 *      qVol caixas, sem peso por caixa);
 *   3. o resumo do pedido (a quantidade; o peso só quando é uma caixa).
 * Pura.
 */
function volumesParaEtiquetas({ pedido, volumesDoXml = [] }) {
  const gravados = volumesDoPedido(pedido);
  if (gravados.length) {
    return gravados.map(v => ({
      peso_bruto: numero(v.peso_bruto),
      dimensoes: { comprimento: numero(v.comprimento_mm), largura: numero(v.largura_mm), altura: numero(v.altura_mm) }
    }));
  }
  const doXml = (volumesDoXml || []).filter(Boolean);
  if (doXml.length) {
    const saida = [];
    for (const v of doXml) {
      const qtd = Math.max(1, Math.round(numero(v.quantidade) || 1));
      for (let i = 0; i < qtd; i += 1) saida.push({ peso_bruto: qtd === 1 ? numero(v.pesoB) : null, dimensoes: null });
    }
    return saida;
  }
  const qtd = Math.max(0, Math.round(numero(pedido?.volumes_quantidade) || 0));
  if (!qtd) return [];
  return Array.from({ length: qtd }, () => ({ peso_bruto: qtd === 1 ? numero(pedido?.peso_bruto) : null, dimensoes: null }));
}

/** Em grupos de dois (a folha); o último pode ficar sozinho. Pura. */
function emPares(itens) {
  const pares = [];
  for (let i = 0; i < itens.length; i += 2) pares.push(itens.slice(i, i + 2));
  return pares;
}

/** A transportadora que vale: a do pedido; "Não definida" não conta. Pura. */
function transportadoraDe(pedido, doXml) {
  const doPedido = String(pedido?.transportadora ?? '').trim();
  if (doPedido && !/^n[aã]o\s+definid/i.test(doPedido) && !/^\d+$/.test(doPedido)) return doPedido;
  return String(doXml || '').trim();
}

// ------------------------------------------------------------- montagem

const CSS = `
  @page paisagem { size: A4 landscape; margin: 0; }
  @page retrato { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { font-family: Calibri, Carlito, 'Segoe UI', Arial, sans-serif; }
  .folha-p { page: paisagem; width: 297mm; height: 210mm; display: flex; flex-direction: column; overflow: hidden; }
  .folha-r { page: retrato; width: 210mm; height: 297mm; display: flex; flex-direction: column; overflow: hidden; }
  .folha-p, .folha-r { break-after: page; page-break-after: always; }
  .folha-p:last-child, .folha-r:last-child { break-after: auto; page-break-after: auto; }
  .metade { flex: 1 1 0; display: flex; align-items: center; justify-content: center; }
  .sozinha { flex: 1 1 0; display: flex; align-items: center; justify-content: center; }
  .marca { background-image: var(--marca); background-repeat: no-repeat; background-position: center; background-size: contain; }

  /* ------------------------------------------ etiqueta de transporte */
  .transporte { display: flex; align-items: stretch; height: 87mm; }
  .caixa { display: flex; border: 0.4mm solid #000; }
  .info { width: 96mm; display: flex; flex-direction: column; gap: 1mm; padding: 1mm; border-right: 0.4mm solid #000; }
  .topo { display: flex; align-items: center; gap: 2mm; height: 24mm; }
  .topo .marca { width: 27mm; height: 21mm; flex-shrink: 0; }
  .topo .empresa { flex: 1; text-align: center; font-size: 11.5pt; line-height: 1.3; }
  .quadro { border: 0.3mm solid #000; }
  .cliente { padding: 1mm 1.5mm; display: grid; grid-template-columns: auto 1fr; column-gap: 1.5mm; align-items: end; font-size: 11pt; }
  .cliente .razao { font-weight: 700; text-align: right; border-bottom: 0.3mm solid #000; padding-bottom: 0.3mm; min-height: 5.5mm; }
  .cliente .fantasia { grid-column: 2; text-align: right; padding-top: 0.5mm; min-height: 5mm; }
  .grade { display: grid; grid-template-columns: 40mm 1fr; gap: 1mm; }
  .grade .quadro { text-align: center; padding: 1mm; font-size: 11pt; min-height: 14mm; }
  .grade .valor { display: block; font-weight: 700; margin-top: 1mm; font-size: 12pt; }
  .transp { padding: 1mm 1.5mm 3mm; display: grid; grid-template-columns: auto 1fr; column-gap: 1.5mm; align-items: end; align-content: start; font-size: 11pt; flex: 1; }
  .transp .nome { font-weight: 700; text-align: center; border-bottom: 0.3mm solid #000; min-height: 5.5mm; }
  .faixa { display: flex; align-items: center; justify-content: center; }
  .faixa + .faixa { border-left: 0.4mm solid #000; }
  .fragil { width: 39mm; }
  .atencao { width: 54mm; }
  .vertical { writing-mode: vertical-rl; transform: rotate(180deg); white-space: nowrap; line-height: 1; }
  .fragil .vertical { font-size: 44pt; letter-spacing: 1pt; }
  .atencao .vertical { font-family: 'Century Gothic', Futura, 'Arial Black', Arial, sans-serif; font-weight: 800; font-size: 46pt; }
  .seta { width: 20mm; margin-left: 4mm; display: flex; }
  .seta svg { width: 100%; height: 100%; }
  .lado { display: flex; align-items: center; margin-left: 1mm; }
  .lado .vertical { font-size: 44pt; line-height: 1.05; white-space: normal; }

  /* ----------------------------------------- etiqueta "ATENÇÃO" (retrato) */
  .aviso { width: 182mm; height: 109mm; border: 0.4mm solid #000; position: relative; display: flex; flex-direction: column; align-items: center; padding: 20mm 6mm 6mm; }
  .aviso .marca { position: absolute; left: 2mm; top: 1.5mm; width: 29mm; height: 20mm; }
  .aviso .empresa { position: absolute; left: 0; right: 0; top: 11mm; text-align: center; font-size: 10pt; }
  .aviso .grande { font-family: 'Century Gothic', Futura, 'Arial Black', Arial, sans-serif; font-weight: 800; font-size: 60pt; line-height: 1.1; margin-top: 4mm; }
  .aviso .frase { font-size: 30pt; text-align: center; line-height: 1.25; margin-top: 2mm; }
`;

const SETA = '<svg viewBox="0 0 20 100" preserveAspectRatio="none" aria-hidden="true"><polygon points="0,20 10,0 20,20" fill="#000"/><rect x="5.5" y="19" width="9" height="81" fill="#000"/></svg>';

/** Uma etiqueta de transporte (um volume). */
function etiquetaDeTransporte({ cliente, nf, volume, peso, dimensao, transportadora }) {
  return `<div class="transporte">
  <div class="caixa">
    <div class="info">
      <div class="topo"><div class="marca"></div><div class="empresa">${esc(EMPRESA.nome)}<br>${esc(EMPRESA.telefone)}<br>${esc(EMPRESA.site)}</div></div>
      <div class="quadro cliente"><span>Cliente:</span><span class="razao">${esc(cliente.razao)}</span><span class="fantasia">${esc(cliente.fantasia)}</span></div>
      <div class="grade">
        <div class="quadro">NFe nº:<span class="valor">${esc(nf) || '&nbsp;'}</span></div>
        <div class="quadro">Volume nº:<span class="valor">${esc(volume)}</span></div>
        <div class="quadro">Peso aprox. (kg):<span class="valor">${esc(peso) || '&nbsp;'}</span></div>
        <div class="quadro">Dimensão (mm):<span class="valor">${esc(dimensao) || '&nbsp;'}</span></div>
      </div>
      <div class="quadro transp"><span>Transportadora:</span><span class="nome">${esc(transportadora)}</span></div>
    </div>
    <div class="faixa fragil"><span class="vertical">FRÁGIL</span></div>
    <div class="faixa atencao"><span class="vertical">ATENÇÃO</span></div>
  </div>
  <div class="seta">${SETA}</div>
  <div class="lado"><span class="vertical">mantenha<br>esse lado<br>para cima</span></div>
</div>`;
}

/** Uma etiqueta "ATENÇÃO — mantenha esse lado para cima". */
function etiquetaDeAtencao() {
  return `<div class="aviso"><div class="marca"></div><div class="empresa">${esc(EMPRESA.nome)}</div><div class="grande">ATENÇÃO</div><div class="frase">MANTENHA ESSE LADO PARA CIMA</div></div>`;
}

/**
 * O HTML das etiquetas.
 * @param {object} p { cliente: { razao, fantasia }, nf, referencia, transportadora, volumes: [{ peso_bruto, dimensoes }], marca }
 */
function montarEtiquetasHtml({ cliente = {}, nf = '', referencia = '', transportadora = '', volumes = [], marca } = {}) {
  const total = volumes.length;
  const marcaUrl = marca === undefined ? marcaDataUrl() : (marca || '');
  const transporte = volumes.map((v, i) => etiquetaDeTransporte({
    cliente: { razao: cliente.razao || '', fantasia: cliente.fantasia || '' },
    nf, volume: numeroDoVolume(referencia || nf || '—', i + 1, total),
    peso: pesoImpresso(v.peso_bruto), dimensao: dimensaoImpressa(v.dimensoes), transportadora
  }));
  // Duas por folha; a última sozinha (número ímpar) fica centralizada.
  const folhasTransporte = emPares(transporte).map(par => (par.length === 2
    ? `<section class="folha-p"><div class="metade">${par[0]}</div><div class="metade">${par[1]}</div></section>`
    : `<section class="folha-p"><div class="sozinha">${par[0]}</div></section>`));
  // "ATENÇÃO": uma por volume, duas por folha; a que sobra fica em cima.
  const folhasAtencao = emPares(volumes.map(() => etiquetaDeAtencao())).map(par => (par.length === 2
    ? `<section class="folha-r"><div class="metade">${par[0]}</div><div class="metade">${par[1]}</div></section>`
    : `<section class="folha-r"><div class="metade">${par[0]}</div><div class="metade"></div></section>`));
  const estiloMarca = marcaUrl ? `:root { --marca: url("${marcaUrl}"); }` : ':root { --marca: none; }';
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Etiquetas ${esc(nf || referencia)}</title><style>${estiloMarca}${CSS}</style></head><body>${[...folhasTransporte, ...folhasAtencao].join('\n')}</body></html>`;
}

// ------------------------------------------------------------- leitura

/**
 * Lê o pedido, o cliente e a nota (a daqui autorizada ou a de fora) e monta
 * as etiquetas. Pedido sem volumes informados não tem o que imprimir.
 */
async function etiquetasDoPedido(api, pedidoId) {
  const id = Number(pedidoId);
  if (!Number.isInteger(id) || id <= 0) throw erro('Pedido inválido.');
  const pedido = lista(await api.get('/api/pedidos', { query: { id } })).find(p => Number(p?.id) === id) || null;
  if (!pedido) throw erro('Pedido não encontrado.', 404);
  const [cliente, notas, deFora] = await Promise.all([
    pedido.cliente_id ? api.get('/api/clientes', { query: { id: pedido.cliente_id } }).then(r => lista(r).find(c => Number(c?.id) === Number(pedido.cliente_id)) || null).catch(() => null) : null,
    api.get('/api/notas_fiscais', { query: { pedido_id: id } }).then(lista).catch(() => []),
    externas.xmlDaNota(api, id).catch(() => null)
  ]);
  const daqui = notas.filter(n => Number(n?.pedido_id) === id && n.status_fiscal === 'autorizada').sort((a, b) => Number(b.id) - Number(a.id))[0] || null;
  const xml = daqui?.xml_autorizado || deFora?.xml || '';
  let lido = null;
  if (xml) {
    try { lido = danfe.lerNfe(xml); } catch (_) { lido = null; }
  }
  const nf = daqui ? String(daqui.numero) : (deFora?.numero ? String(deFora.numero) : '');
  const volumes = volumesParaEtiquetas({ pedido, volumesDoXml: lido?.volumes || [] });
  if (!volumes.length) throw erro('O pedido não tem volumes informados: informe a quantidade de volumes (e as dimensões) no envio.', 409);
  const numeroPedido = String(pedido.numero || id);
  const html = montarEtiquetasHtml({
    cliente: {
      razao: cliente?.razao_social || lido?.destinatario?.nome || cliente?.nome_fantasia || '',
      fantasia: cliente?.nome_fantasia && cliente.nome_fantasia !== cliente.razao_social ? cliente.nome_fantasia : ''
    },
    nf, referencia: nf || numeroPedido,
    transportadora: transportadoraDe(pedido, lido?.transporte?.nome),
    volumes
  });
  return { nome: `Etiquetas-${nf ? `NF-${nf}` : numeroPedido}`, html, volumes: volumes.length };
}

module.exports = {
  EMPRESA, MARCA_PADRAO, marcaDataUrl,
  pesoImpresso, dimensaoImpressa, numeroDoVolume, volumesDoPedido, volumesParaEtiquetas, emPares, transportadoraDe,
  montarEtiquetasHtml, etiquetasDoPedido
};
