/**
 * DANFE — Documento Auxiliar da NF-e, em HTML pronto para virar PDF (A4
 * retrato) pelo mesmo caminho dos relatórios (janela oculta + printToPDF).
 *
 * Lê o `nfeProc` (NF-e autorizada + protocolo) que ficou em
 * notas_fiscais.xml_autorizado. Os blocos são os do leiaute oficial: canhoto
 * de recebimento, emitente (com a logo) e chave com código de barras
 * (Code 128 C), destinatário, fatura/duplicatas, cálculo do imposto,
 * transportador e volumes, produtos, dados adicionais. Em homologação e em
 * nota cancelada a marca d'água diz isso na página.
 *
 * Sem biblioteca de XML nem de código de barras: o XML é o nosso (regulares
 * bastam) e o Code 128 C são 22 pares de dígitos desenhados como retângulos
 * num SVG. A logo vai embutida (data URI): o HTML é aberto de um arquivo
 * temporário e não enxergaria os assets do app.
 */
const fs = require('fs');
const path = require('path');
const { campo, bloco } = require('./sefazCliente');

// Larguras de barras/espaços do Code 128 (valores 0-106); 105 = Start C, 106 = Stop.
const CODE128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112'
];

const LOGO_PADRAO = path.join(__dirname, '..', '..', 'src', 'assets', 'Logo Redonda.png');
let logoCache;

/** A logo do app como data URI (lida uma vez); vazio se o arquivo não existir. */
function logoDataUrl(caminho = LOGO_PADRAO) {
  if (logoCache !== undefined && caminho === LOGO_PADRAO) return logoCache;
  let dados = '';
  try {
    dados = `data:image/png;base64,${fs.readFileSync(caminho).toString('base64')}`;
  } catch (_) {
    dados = '';
  }
  if (caminho === LOGO_PADRAO) logoCache = dados;
  return dados;
}

/**
 * Code 128 C de uma sequência de dígitos (quantidade par), como SVG. Com
 * `largura` ('100%') o desenho se ajusta ao espaço que tiver, mantendo as
 * proporções das barras (viewBox).
 */
function codigoDeBarrasSvg(digitos, { altura = 44, modulo = 1.2, largura = null } = {}) {
  const d = String(digitos || '').replace(/\D/g, '');
  if (!d || d.length % 2 !== 0) throw new Error('Code 128 C exige quantidade par de dígitos.');
  const valores = [105];
  for (let i = 0; i < d.length; i += 2) valores.push(Number(d.slice(i, i + 2)));
  let soma = 105;
  for (let i = 1; i < valores.length; i++) soma += valores[i] * i;
  valores.push(soma % 103, 106);

  const retangulos = [];
  let x = 0;
  for (const v of valores) {
    const larguras = CODE128[v];
    for (let i = 0; i < larguras.length; i++) {
      const w = Number(larguras[i]) * modulo;
      if (i % 2 === 0) retangulos.push(`<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${altura}"/>`);
      x += w;
    }
  }
  const w = largura || x.toFixed(2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${altura}" viewBox="0 0 ${x.toFixed(2)} ${altura}" preserveAspectRatio="none" shape-rendering="crispEdges" fill="#000">${retangulos.join('')}</svg>`;
}

// ------------------------------------------------------------ utilidades

/** Texto de um elemento, com as entidades do XML desfeitas. */
function texto(xml, tag) {
  const v = campo(xml, tag);
  return v === null ? '' : v.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#xD;/g, '');
}

function esc(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Todos os elementos `<tag ...>...</tag>` (para os itens e os volumes). */
function blocos(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>`, 'g');
  return String(xml || '').match(re) || [];
}

const moeda = v => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const quantidade = v => (v === '' || Number.isNaN(Number(v)) ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 }));
const cnpjFmt = d => (String(d || '').length === 14 ? String(d).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : String(d || ''));
const cpfFmt = d => (String(d || '').length === 11 ? String(d).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : String(d || ''));
const cepFmt = d => (String(d || '').length === 8 ? String(d).replace(/^(\d{5})(\d{3})$/, '$1-$2') : String(d || ''));
const foneFmt = d => {
  const s = String(d || '').replace(/\D/g, '');
  if (s.length === 10) return s.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
  if (s.length === 11) return s.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
  return s;
};
const dataFmt = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
const horaFmt = iso => { const m = /T(\d{2}:\d{2}:\d{2})/.exec(String(iso || '')); return m ? m[1] : ''; };
const dataHoraFmt = iso => `${dataFmt(iso)} ${horaFmt(iso)}`.trim();
const chaveFmt = c => String(c || '').replace(/(\d{4})(?=\d)/g, '$1 ');
const numeroNf = n => String(n || '').padStart(9, '0').replace(/(\d{3})(?=\d)/g, '$1.');

const MOD_FRETE = { 0: '0 - Emitente (CIF)', 1: '1 - Destinatário (FOB)', 2: '2 - Terceiros', 3: '3 - Próprio (remetente)', 4: '4 - Próprio (destinatário)', 9: '9 - Sem frete' };

// -------------------------------------------------------------- leitura

/** O que o DANFE mostra, tirado do nfeProc. */
function lerNfe(xmlNfeProc) {
  const xml = String(xmlNfeProc || '');
  const inf = bloco(xml, 'infNFe');
  if (!inf) throw new Error('XML sem infNFe.');
  const ide = bloco(inf, 'ide') || '';
  const emit = bloco(inf, 'emit') || '';
  const enderEmit = bloco(emit, 'enderEmit') || '';
  const dest = bloco(inf, 'dest') || '';
  const enderDest = bloco(dest, 'enderDest') || '';
  const total = bloco(bloco(inf, 'total') || '', 'ICMSTot') || '';
  const transp = bloco(inf, 'transp') || '';
  const transporta = bloco(transp, 'transporta') || '';
  const cobr = bloco(inf, 'cobr') || '';
  const prot = bloco(xml, 'protNFe') || '';
  const chave = (/Id="NFe(\d{44})"/.exec(inf) || [])[1] || texto(prot, 'chNFe');

  const itens = blocos(inf, 'det').map(det => {
    const prod = bloco(det, 'prod') || '';
    const icms = bloco(det, 'ICMS') || '';
    const ipi = bloco(det, 'IPI') || '';
    return {
      codigo: texto(prod, 'cProd'), descricao: texto(prod, 'xProd'), ncm: texto(prod, 'NCM'), cfop: texto(prod, 'CFOP'),
      unidade: texto(prod, 'uCom'), quantidade: texto(prod, 'qCom'), unitario: texto(prod, 'vUnCom'), total: texto(prod, 'vProd'),
      desconto: texto(prod, 'vDesc'), cst: `${texto(icms, 'orig')}${texto(icms, 'CSOSN') || texto(icms, 'CST')}`,
      bcIcms: texto(icms, 'vBC'), vIcms: texto(icms, 'vICMS'), pIcms: texto(icms, 'pICMS'), vIpi: texto(ipi, 'vIPI'), pIpi: texto(ipi, 'pIPI')
    };
  });

  // Vários <vol>: um por volume detalhado no embarque. Soma o que é soma.
  const volumes = blocos(transp, 'vol').map(v => ({
    quantidade: texto(v, 'qVol'), especie: texto(v, 'esp'), marca: texto(v, 'marca'), numeracao: texto(v, 'nVol'), pesoL: texto(v, 'pesoL'), pesoB: texto(v, 'pesoB')
  }));
  const soma = chave2 => volumes.reduce((s, v) => s + (Number(v[chave2]) || 0), 0);
  const distintos = chave2 => [...new Set(volumes.map(v => v[chave2]).filter(Boolean))].join(', ');

  return {
    chave, ambiente: texto(ide, 'tpAmb') === '1' ? 'producao' : 'homologacao',
    numero: texto(ide, 'nNF'), serie: texto(ide, 'serie'), tpNF: texto(ide, 'tpNF'), natureza: texto(ide, 'natOp'),
    dhEmi: texto(ide, 'dhEmi'), dhSaiEnt: texto(ide, 'dhSaiEnt'),
    emitente: {
      nome: texto(emit, 'xNome'), fantasia: texto(emit, 'xFant'), cnpj: texto(emit, 'CNPJ'), ie: texto(emit, 'IE'), im: texto(emit, 'IM'),
      logradouro: texto(enderEmit, 'xLgr'), numero: texto(enderEmit, 'nro'), complemento: texto(enderEmit, 'xCpl'), bairro: texto(enderEmit, 'xBairro'),
      municipio: texto(enderEmit, 'xMun'), uf: texto(enderEmit, 'UF'), cep: texto(enderEmit, 'CEP'), fone: texto(enderEmit, 'fone')
    },
    destinatario: {
      nome: texto(dest, 'xNome'), cnpj: texto(dest, 'CNPJ'), cpf: texto(dest, 'CPF'), ie: texto(dest, 'IE'), email: texto(dest, 'email'),
      logradouro: texto(enderDest, 'xLgr'), numero: texto(enderDest, 'nro'), complemento: texto(enderDest, 'xCpl'), bairro: texto(enderDest, 'xBairro'),
      municipio: texto(enderDest, 'xMun'), uf: texto(enderDest, 'UF'), cep: texto(enderDest, 'CEP'), fone: texto(enderDest, 'fone')
    },
    totais: {
      vBC: texto(total, 'vBC'), vICMS: texto(total, 'vICMS'), vBCST: texto(total, 'vBCST'), vST: texto(total, 'vST'), vProd: texto(total, 'vProd'),
      vFrete: texto(total, 'vFrete'), vSeg: texto(total, 'vSeg'), vDesc: texto(total, 'vDesc'), vOutro: texto(total, 'vOutro'), vIPI: texto(total, 'vIPI'),
      vNF: texto(total, 'vNF'), vTotTrib: texto(total, 'vTotTrib')
    },
    transporte: {
      modFrete: texto(transp, 'modFrete'), nome: texto(transporta, 'xNome'), cnpj: texto(transporta, 'CNPJ'), ie: texto(transporta, 'IE'),
      endereco: texto(transporta, 'xEnder'), municipio: texto(transporta, 'xMun'), uf: texto(transporta, 'UF'),
      qVol: volumes.length ? String(soma('quantidade')) : '', esp: distintos('especie'), marca: distintos('marca'),
      nVol: volumes.length > 1 ? volumes.map(v => v.numeracao).filter(Boolean).join(', ') : (volumes[0]?.numeracao || ''),
      pesoL: volumes.length ? soma('pesoL').toFixed(3) : '', pesoB: volumes.length ? soma('pesoB').toFixed(3) : ''
    },
    volumes,
    fatura: cobr ? { numero: texto(bloco(cobr, 'fat') || '', 'nFat'), original: texto(bloco(cobr, 'fat') || '', 'vOrig'), liquido: texto(bloco(cobr, 'fat') || '', 'vLiq') } : null,
    duplicatas: blocos(cobr, 'dup').map(d => ({ numero: texto(d, 'nDup'), vencimento: texto(d, 'dVenc'), valor: texto(d, 'vDup') })),
    itens,
    infCpl: texto(bloco(inf, 'infAdic') || '', 'infCpl'),
    protocolo: { numero: texto(prot, 'nProt'), data: texto(prot, 'dhRecbto'), cStat: texto(prot, 'cStat'), xMotivo: texto(prot, 'xMotivo') }
  };
}

// ------------------------------------------------------------- montagem

const CSS = `
  @page { size: A4 portrait; margin: 7mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 8pt; color: #000; background: #fff; }
  .folha { width: 196mm; margin: 0 auto; position: relative; }
  .quadro { border: 1px solid #000; }
  .grade { display: grid; }
  .campo { border: 1px solid #000; padding: 2px 4px; min-height: 8mm; margin: -1px 0 0 -1px; min-width: 0; }
  .campo .r { display: block; font-size: 5.5pt; text-transform: uppercase; color: #222; }
  .campo .v { display: block; font-size: 8pt; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .campo .v.quebra { white-space: normal; }
  .titulo { font-size: 6.5pt; font-weight: bold; text-transform: uppercase; margin: 2.5mm 0 1mm; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #000; padding: 2px 3px; font-size: 7pt; vertical-align: top; }
  th { font-size: 5.5pt; text-transform: uppercase; background: #f2f2f2; }
  .dir { text-align: right; } .cen { text-align: center; }
  .canhoto { display: grid; grid-template-columns: 1fr 34mm; border: 1px solid #000; }
  .canhoto .texto { padding: 2mm 3mm; font-size: 6.5pt; }
  .canhoto .linhas { display: grid; grid-template-columns: 40mm 1fr; border-top: 1px solid #000; }
  .canhoto .linhas div { padding: 1.5mm 3mm; min-height: 9mm; font-size: 5.5pt; text-transform: uppercase; }
  .canhoto .linhas div + div { border-left: 1px solid #000; }
  .canhoto .nf { border-left: 1px solid #000; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; font-weight: bold; }
  .canhoto .nf .n { font-size: 10pt; }
  .corte { border-top: 1px dashed #000; margin: 2mm 0; }
  .cabecalho { display: grid; grid-template-columns: 70mm 42mm 84mm; }
  .emitente { padding: 2.5mm; display: flex; gap: 3mm; align-items: center; }
  .emitente img { width: 17mm; height: 17mm; object-fit: contain; flex-shrink: 0; }
  .emitente .nome { font-size: 10.5pt; font-weight: bold; line-height: 1.15; }
  .emitente .dados { font-size: 7pt; min-width: 0; }
  .danfe { text-align: center; padding: 2mm; border-left: 1px solid #000; border-right: 1px solid #000; }
  .danfe .sigla { font-size: 16pt; font-weight: bold; }
  .danfe .desc { font-size: 6pt; }
  .danfe .tipo { display: inline-block; border: 1px solid #000; padding: 1px 6px; margin: 2px 0; font-size: 7pt; }
  .danfe .num { font-size: 9pt; font-weight: bold; margin-top: 2px; }
  .chave { padding: 2mm; display: flex; flex-direction: column; justify-content: center; }
  .chave svg { display: block; width: 100%; height: 12mm; }
  .chave .r { font-size: 5.5pt; text-transform: uppercase; color: #222; margin-top: 1.5mm; }
  .chave .cod { font-family: 'Courier New', Courier, monospace; font-size: 6.8pt; font-weight: bold; white-space: nowrap; text-align: center; letter-spacing: 0; }
  .chave .consulta { font-size: 5.3pt; text-align: center; margin-top: 1mm; }
  .marca { position: absolute; top: 40%; left: 0; right: 0; text-align: center; font-size: 42pt; font-weight: bold; color: rgba(200, 0, 0, 0.18); transform: rotate(-25deg); pointer-events: none; }
  .adicionais { min-height: 30mm; font-size: 7pt; white-space: pre-wrap; }
`;

function campoHtml(rotulo, valor, { span = 1, quebra = false } = {}) {
  return `<div class="campo" style="grid-column: span ${span}"><span class="r">${esc(rotulo)}</span><span class="v${quebra ? ' quebra' : ''}">${esc(valor) || '&nbsp;'}</span></div>`;
}

/**
 * @param {string} xmlNfeProc  notas_fiscais.xml_autorizado
 * @param {object} [opcoes]    { cancelada: boolean, logo: data URI (padrão: a logo do app) }
 */
function montarDanfeHtml(xmlNfeProc, { cancelada = false, logo } = {}) {
  const n = lerNfe(xmlNfeProc);
  const e = n.emitente;
  const d = n.destinatario;
  const t = n.totais;
  const tr = n.transporte;
  const marca = cancelada ? 'NF-e CANCELADA' : (n.ambiente === 'homologacao' ? 'SEM VALOR FISCAL' : '');
  const documentoDest = d.cnpj ? cnpjFmt(d.cnpj) : cpfFmt(d.cpf);
  const logoUrl = logo === undefined ? logoDataUrl() : (logo || '');

  const linhasItens = n.itens.map(it => `<tr>
      <td>${esc(it.codigo)}</td><td>${esc(it.descricao)}</td><td class="cen">${esc(it.ncm)}</td><td class="cen">${esc(it.cst)}</td><td class="cen">${esc(it.cfop)}</td>
      <td class="cen">${esc(it.unidade)}</td><td class="dir">${quantidade(it.quantidade)}</td><td class="dir">${moeda(it.unitario)}</td><td class="dir">${moeda(it.total)}</td>
      <td class="dir">${moeda(it.desconto || 0)}</td><td class="dir">${moeda(it.bcIcms || 0)}</td><td class="dir">${moeda(it.vIcms || 0)}</td><td class="dir">${moeda(it.vIpi || 0)}</td>
      <td class="dir">${moeda(it.pIcms || 0)}</td><td class="dir">${moeda(it.pIpi || 0)}</td>
    </tr>`).join('');

  // Duplicata: "número da nota / número da parcela", como o dono pediu.
  const duplicatas = n.duplicatas.length
    ? `<table><tr>${n.duplicatas.map(dp => `<td class="cen"><b>${esc(n.numero)}/${esc(dp.numero)}</b><br>${dataFmt(dp.vencimento)}<br>${moeda(dp.valor)}</td>`).join('')}</tr></table>`
    : `<div class="campo"><span class="r">Fatura</span><span class="v">${n.fatura ? `Nº ${esc(n.fatura.numero)} — ${moeda(n.fatura.liquido)} à vista` : 'Sem fatura'}</span></div>`;

  // Vários volumes detalhados: uma linha por volume, além do resumo.
  const volumesDetalhados = n.volumes.length > 1
    ? `<table style="margin-top: -1px"><thead><tr><th>Volume</th><th>Espécie</th><th>Marca</th><th>Numeração</th><th>Peso bruto</th><th>Peso líquido</th></tr></thead><tbody>${
      n.volumes.map((v, i) => `<tr><td class="cen">${esc(v.numeracao || String(i + 1))}</td><td>${esc(v.especie)}</td><td>${esc(v.marca)}</td><td class="cen">${esc(v.numeracao)}</td><td class="dir">${v.pesoB ? quantidade(v.pesoB) : ''}</td><td class="dir">${v.pesoL ? quantidade(v.pesoL) : ''}</td></tr>`).join('')
    }</tbody></table>`
    : '';

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>DANFE NF-e ${esc(n.numero)}</title><style>${CSS}</style></head><body>
<div class="folha">
  ${marca ? `<div class="marca">${esc(marca)}</div>` : ''}

  <div class="canhoto">
    <div>
      <div class="texto">RECEBEMOS DE <b>${esc(e.nome)}</b> OS PRODUTOS/SERVIÇOS CONSTANTES DA NOTA FISCAL ELETRÔNICA INDICADA AO LADO. EMISSÃO: ${dataFmt(n.dhEmi)} — DESTINATÁRIO: ${esc(d.nome)} — VALOR TOTAL: R$ ${moeda(t.vNF)}</div>
      <div class="linhas"><div>Data de recebimento</div><div>Identificação e assinatura do recebedor</div></div>
    </div>
    <div class="nf"><div>NF-e</div><div class="n">Nº ${numeroNf(n.numero)}</div><div>SÉRIE ${esc(n.serie)}</div></div>
  </div>
  <div class="corte"></div>

  <div class="quadro cabecalho">
    <div class="emitente">
      ${logoUrl ? `<img src="${logoUrl}" alt="">` : ''}
      <div class="dados">
        <div class="nome">${esc(e.nome)}</div>
        <div>${esc(e.logradouro)}, ${esc(e.numero)}${e.complemento ? ` - ${esc(e.complemento)}` : ''}</div>
        <div>${esc(e.bairro)} - ${esc(e.municipio)}/${esc(e.uf)} - CEP ${cepFmt(e.cep)}</div>
        <div>${e.fone ? `Fone: ${foneFmt(e.fone)}` : ''}</div>
      </div>
    </div>
    <div class="danfe">
      <div class="sigla">DANFE</div>
      <div class="desc">Documento Auxiliar da Nota Fiscal Eletrônica</div>
      <div class="tipo">${n.tpNF === '0' ? '0 - ENTRADA' : '1 - SAÍDA'}</div>
      <div class="num">Nº ${numeroNf(n.numero)}</div>
      <div>SÉRIE ${esc(n.serie)} &nbsp; FOLHA 1/1</div>
    </div>
    <div class="chave">
      ${codigoDeBarrasSvg(n.chave, { largura: '100%' })}
      <div class="r">Chave de acesso</div>
      <div class="cod">${chaveFmt(n.chave)}</div>
      <div class="consulta">Consulta de autenticidade no portal nacional da NF-e www.nfe.fazenda.gov.br/portal ou no site da SEFAZ autorizadora</div>
    </div>
  </div>
  <div class="grade" style="grid-template-columns: 2fr 1fr">
    ${campoHtml('Natureza da operação', n.natureza)}
    ${campoHtml('Protocolo de autorização de uso', n.protocolo.numero ? `${n.protocolo.numero} - ${dataHoraFmt(n.protocolo.data)}` : '')}
  </div>
  <div class="grade" style="grid-template-columns: 1fr 1fr 1fr">
    ${campoHtml('Inscrição estadual', e.ie)}
    ${campoHtml('Inscrição estadual do subst. tributário', '')}
    ${campoHtml('CNPJ', cnpjFmt(e.cnpj))}
  </div>

  <div class="titulo">Destinatário / Remetente</div>
  <div class="grade" style="grid-template-columns: 3fr 1.3fr 1fr">
    ${campoHtml('Nome / Razão social', d.nome)}
    ${campoHtml('CNPJ / CPF', documentoDest)}
    ${campoHtml('Data da emissão', dataFmt(n.dhEmi))}
  </div>
  <div class="grade" style="grid-template-columns: 3fr 1.3fr 0.8fr 1fr">
    ${campoHtml('Endereço', `${d.logradouro}, ${d.numero}${d.complemento && d.complemento !== '-' ? ` - ${d.complemento}` : ''}`)}
    ${campoHtml('Bairro / Distrito', d.bairro)}
    ${campoHtml('CEP', cepFmt(d.cep))}
    ${campoHtml('Data da saída / entrada', dataFmt(n.dhSaiEnt || n.dhEmi))}
  </div>
  <div class="grade" style="grid-template-columns: 2fr 1.2fr 0.5fr 1.4fr 1fr">
    ${campoHtml('Município', d.municipio)}
    ${campoHtml('Fone / Fax', foneFmt(d.fone))}
    ${campoHtml('UF', d.uf)}
    ${campoHtml('Inscrição estadual', d.ie)}
    ${campoHtml('Hora da saída', horaFmt(n.dhSaiEnt))}
  </div>

  <div class="titulo">Fatura / Duplicatas</div>
  ${duplicatas}

  <div class="titulo">Cálculo do imposto</div>
  <div class="grade" style="grid-template-columns: repeat(6, 1fr)">
    ${campoHtml('Base de cálculo do ICMS', moeda(t.vBC))}
    ${campoHtml('Valor do ICMS', moeda(t.vICMS))}
    ${campoHtml('Base de cálculo do ICMS ST', moeda(t.vBCST))}
    ${campoHtml('Valor do ICMS ST', moeda(t.vST))}
    ${campoHtml('Valor aprox. dos tributos', moeda(t.vTotTrib || 0))}
    ${campoHtml('Valor total dos produtos', moeda(t.vProd))}
  </div>
  <div class="grade" style="grid-template-columns: repeat(6, 1fr)">
    ${campoHtml('Valor do frete', moeda(t.vFrete))}
    ${campoHtml('Valor do seguro', moeda(t.vSeg))}
    ${campoHtml('Desconto', moeda(t.vDesc))}
    ${campoHtml('Outras despesas', moeda(t.vOutro))}
    ${campoHtml('Valor do IPI', moeda(t.vIPI))}
    ${campoHtml('Valor total da nota', moeda(t.vNF))}
  </div>

  <div class="titulo">Transportador / Volumes transportados</div>
  <div class="grade" style="grid-template-columns: 2.6fr 1.5fr 0.9fr 1fr 0.5fr 1.4fr">
    ${campoHtml('Razão social', tr.nome)}
    ${campoHtml('Frete por conta', MOD_FRETE[Number(tr.modFrete)] || tr.modFrete)}
    ${campoHtml('Código ANTT', '')}
    ${campoHtml('Placa do veículo', '')}
    ${campoHtml('UF', tr.uf)}
    ${campoHtml('CNPJ / CPF', cnpjFmt(tr.cnpj))}
  </div>
  <div class="grade" style="grid-template-columns: 3fr 2fr 0.5fr 1.4fr">
    ${campoHtml('Endereço', tr.endereco)}
    ${campoHtml('Município', tr.municipio)}
    ${campoHtml('UF', tr.uf)}
    ${campoHtml('Inscrição estadual', tr.ie)}
  </div>
  <div class="grade" style="grid-template-columns: repeat(6, 1fr)">
    ${campoHtml('Quantidade', tr.qVol)}
    ${campoHtml('Espécie', tr.esp)}
    ${campoHtml('Marca', tr.marca)}
    ${campoHtml('Numeração', tr.nVol)}
    ${campoHtml('Peso bruto', tr.pesoB ? quantidade(tr.pesoB) : '')}
    ${campoHtml('Peso líquido', tr.pesoL ? quantidade(tr.pesoL) : '')}
  </div>
  ${volumesDetalhados}

  <div class="titulo">Dados dos produtos / serviços</div>
  <table>
    <thead><tr>
      <th>Código</th><th>Descrição do produto / serviço</th><th>NCM/SH</th><th>CST/CSOSN</th><th>CFOP</th><th>UN</th><th>Quant.</th><th>Valor unit.</th><th>Valor total</th><th>Desconto</th><th>B. cálc. ICMS</th><th>Valor ICMS</th><th>Valor IPI</th><th>Alíq. ICMS</th><th>Alíq. IPI</th>
    </tr></thead>
    <tbody>${linhasItens}</tbody>
  </table>

  <div class="titulo">Dados adicionais</div>
  <div class="grade" style="grid-template-columns: 2fr 1fr">
    <div class="campo adicionais"><span class="r">Informações complementares</span><span class="v quebra" style="font-weight: normal">${esc(n.infCpl) || '&nbsp;'}</span></div>
    <div class="campo adicionais"><span class="r">Reservado ao fisco</span><span class="v">&nbsp;</span></div>
  </div>
</div>
</body></html>`;
}

module.exports = { CODE128, codigoDeBarrasSvg, lerNfe, montarDanfeHtml, blocos, logoDataUrl, LOGO_PADRAO };
