/**
 * DANFE — Documento Auxiliar da NF-e, em HTML pronto para virar PDF (A4
 * retrato) pelo mesmo caminho dos relatórios (janela oculta + printToPDF).
 *
 * Lê o `nfeProc` (NF-e autorizada + protocolo) que ficou em
 * notas_fiscais.xml_autorizado. Os blocos são os do leiaute oficial: emitente
 * e chave com código de barras (Code 128 C), destinatário, fatura/duplicatas,
 * cálculo do imposto, transportador e volumes, produtos, dados adicionais.
 * Em homologação e em nota cancelada a marca d'água diz isso na página.
 *
 * Sem biblioteca de XML nem de código de barras: o XML é o nosso (regulares
 * bastam) e o Code 128 C são 22 pares de dígitos desenhados como retângulos
 * num SVG.
 */
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

/** Code 128 C de uma sequência de dígitos (quantidade par), como SVG. */
function codigoDeBarrasSvg(digitos, { altura = 44, modulo = 1.2 } = {}) {
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
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${x.toFixed(2)}" height="${altura}" viewBox="0 0 ${x.toFixed(2)} ${altura}" shape-rendering="crispEdges" fill="#000">${retangulos.join('')}</svg>`;
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

/** Todos os elementos `<tag ...>...</tag>` (para os itens). */
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
  const vol = bloco(transp, 'vol') || '';
  const cobr = bloco(inf, 'cobr') || '';
  const prot = bloco(xml, 'protNFe') || '';
  const chave = (/Id="NFe(\d{44})"/.exec(inf) || [])[1] || texto(prot, 'chNFe');

  const itens = blocos(inf, 'det').map(det => {
    const prod = bloco(det, 'prod') || '';
    const icms = bloco(det, 'ICMS') || '';
    return {
      codigo: texto(prod, 'cProd'), descricao: texto(prod, 'xProd'), ncm: texto(prod, 'NCM'), cfop: texto(prod, 'CFOP'),
      unidade: texto(prod, 'uCom'), quantidade: texto(prod, 'qCom'), unitario: texto(prod, 'vUnCom'), total: texto(prod, 'vProd'),
      desconto: texto(prod, 'vDesc'), cst: `${texto(icms, 'orig')}${texto(icms, 'CSOSN') || texto(icms, 'CST')}`,
      bcIcms: texto(icms, 'vBC'), vIcms: texto(icms, 'vICMS'), pIcms: texto(icms, 'pICMS')
    };
  });

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
      vFrete: texto(total, 'vFrete'), vSeg: texto(total, 'vSeg'), vDesc: texto(total, 'vDesc'), vOutro: texto(total, 'vOutro'), vIPI: texto(total, 'vIPI'), vNF: texto(total, 'vNF')
    },
    transporte: {
      modFrete: texto(transp, 'modFrete'), nome: texto(transporta, 'xNome'), cnpj: texto(transporta, 'CNPJ'), ie: texto(transporta, 'IE'),
      endereco: texto(transporta, 'xEnder'), municipio: texto(transporta, 'xMun'), uf: texto(transporta, 'UF'),
      qVol: texto(vol, 'qVol'), esp: texto(vol, 'esp'), marca: texto(vol, 'marca'), nVol: texto(vol, 'nVol'), pesoL: texto(vol, 'pesoL'), pesoB: texto(vol, 'pesoB')
    },
    fatura: cobr ? { numero: texto(bloco(cobr, 'fat') || '', 'nFat'), original: texto(bloco(cobr, 'fat') || '', 'vOrig'), liquido: texto(bloco(cobr, 'fat') || '', 'vLiq') } : null,
    duplicatas: blocos(cobr, 'dup').map(d => ({ numero: texto(d, 'nDup'), vencimento: texto(d, 'dVenc'), valor: texto(d, 'vDup') })),
    itens,
    infCpl: texto(bloco(inf, 'infAdic') || '', 'infCpl'),
    protocolo: { numero: texto(prot, 'nProt'), data: texto(prot, 'dhRecbto'), cStat: texto(prot, 'cStat'), xMotivo: texto(prot, 'xMotivo') }
  };
}

// ------------------------------------------------------------- montagem

const CSS = `
  @page { size: A4 portrait; margin: 8mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 8pt; color: #000; background: #fff; }
  .folha { width: 194mm; margin: 0 auto; position: relative; }
  .quadro { border: 1px solid #000; }
  .grade { display: grid; }
  .campo { border: 1px solid #000; padding: 2px 4px; min-height: 8mm; margin: -1px 0 0 -1px; }
  .campo .r { display: block; font-size: 5.5pt; text-transform: uppercase; color: #222; }
  .campo .v { display: block; font-size: 8pt; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .campo .v.quebra { white-space: normal; }
  .titulo { font-size: 6.5pt; font-weight: bold; text-transform: uppercase; margin: 3mm 0 1mm; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #000; padding: 2px 3px; font-size: 7pt; vertical-align: top; }
  th { font-size: 5.5pt; text-transform: uppercase; background: #f2f2f2; }
  .dir { text-align: right; } .cen { text-align: center; }
  .cabecalho { display: grid; grid-template-columns: 82mm 46mm 66mm; }
  .emitente { padding: 3mm; }
  .emitente .nome { font-size: 11pt; font-weight: bold; }
  .danfe { text-align: center; padding: 2mm; border-left: 1px solid #000; border-right: 1px solid #000; }
  .danfe .sigla { font-size: 16pt; font-weight: bold; }
  .danfe .desc { font-size: 6pt; }
  .danfe .tipo { display: inline-block; border: 1px solid #000; padding: 1px 6px; margin: 2px 0; font-size: 7pt; }
  .danfe .num { font-size: 9pt; font-weight: bold; margin-top: 2px; }
  .chave { padding: 2mm; }
  .chave svg { display: block; margin: 0 auto; }
  .chave .cod { font-family: 'Courier New', monospace; font-size: 7.5pt; text-align: center; letter-spacing: 0.3px; margin-top: 1mm; font-weight: bold; }
  .chave .consulta { font-size: 5.5pt; text-align: center; margin-top: 1mm; }
  .marca { position: absolute; top: 40%; left: 0; right: 0; text-align: center; font-size: 42pt; font-weight: bold; color: rgba(200, 0, 0, 0.18); transform: rotate(-25deg); pointer-events: none; }
  .adicionais { min-height: 30mm; font-size: 7pt; white-space: pre-wrap; }
`;

function campoHtml(rotulo, valor, { span = 1, quebra = false } = {}) {
  return `<div class="campo" style="grid-column: span ${span}"><span class="r">${esc(rotulo)}</span><span class="v${quebra ? ' quebra' : ''}">${esc(valor) || '&nbsp;'}</span></div>`;
}

/**
 * @param {string} xmlNfeProc  notas_fiscais.xml_autorizado
 * @param {object} [opcoes]    { cancelada: boolean, marca: texto da marca d'água }
 */
function montarDanfeHtml(xmlNfeProc, { cancelada = false } = {}) {
  const n = lerNfe(xmlNfeProc);
  const e = n.emitente;
  const d = n.destinatario;
  const t = n.totais;
  const tr = n.transporte;
  const marca = cancelada ? 'NF-e CANCELADA' : (n.ambiente === 'homologacao' ? 'SEM VALOR FISCAL' : '');
  const documentoDest = d.cnpj ? cnpjFmt(d.cnpj) : cpfFmt(d.cpf);

  const linhasItens = n.itens.map(it => `<tr>
      <td>${esc(it.codigo)}</td><td>${esc(it.descricao)}</td><td class="cen">${esc(it.ncm)}</td><td class="cen">${esc(it.cst)}</td><td class="cen">${esc(it.cfop)}</td>
      <td class="cen">${esc(it.unidade)}</td><td class="dir">${quantidade(it.quantidade)}</td><td class="dir">${moeda(it.unitario)}</td><td class="dir">${moeda(it.total)}</td>
      <td class="dir">${moeda(it.desconto || 0)}</td><td class="dir">${moeda(it.bcIcms || 0)}</td><td class="dir">${moeda(it.vIcms || 0)}</td><td class="dir">${it.pIcms ? moeda(it.pIcms) : '0,00'}</td>
    </tr>`).join('');

  const duplicatas = n.duplicatas.length
    ? `<table><tr>${n.duplicatas.map(dp => `<td class="cen"><b>${esc(dp.numero)}</b><br>${dataFmt(dp.vencimento)}<br>${moeda(dp.valor)}</td>`).join('')}</tr></table>`
    : `<div class="campo"><span class="r">Fatura</span><span class="v">${n.fatura ? `Nº ${esc(n.fatura.numero)} — ${moeda(n.fatura.liquido)} à vista` : 'Sem fatura'}</span></div>`;

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>DANFE NF-e ${esc(n.numero)}</title><style>${CSS}</style></head><body>
<div class="folha">
  ${marca ? `<div class="marca">${esc(marca)}</div>` : ''}
  <div class="quadro cabecalho">
    <div class="emitente">
      <div class="nome">${esc(e.nome)}</div>
      <div>${esc(e.logradouro)}, ${esc(e.numero)}${e.complemento ? ` - ${esc(e.complemento)}` : ''}</div>
      <div>${esc(e.bairro)} - ${esc(e.municipio)}/${esc(e.uf)} - CEP ${cepFmt(e.cep)}</div>
      <div>${e.fone ? `Fone: ${foneFmt(e.fone)}` : ''}</div>
    </div>
    <div class="danfe">
      <div class="sigla">DANFE</div>
      <div class="desc">Documento Auxiliar da Nota Fiscal Eletrônica</div>
      <div class="tipo">${n.tpNF === '0' ? '0 - ENTRADA' : '1 - SAÍDA'}</div>
      <div class="num">Nº ${String(n.numero).padStart(9, '0').replace(/(\d{3})(?=\d)/g, '$1.')}</div>
      <div>SÉRIE ${esc(n.serie)} &nbsp; FOLHA 1/1</div>
    </div>
    <div class="chave">
      ${codigoDeBarrasSvg(n.chave)}
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
    ${campoHtml('Endereço', `${d.logradouro}, ${d.numero}${d.complemento ? ` - ${d.complemento}` : ''}`)}
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
  <div class="grade" style="grid-template-columns: repeat(5, 1fr)">
    ${campoHtml('Base de cálculo do ICMS', moeda(t.vBC))}
    ${campoHtml('Valor do ICMS', moeda(t.vICMS))}
    ${campoHtml('Base de cálculo do ICMS ST', moeda(t.vBCST))}
    ${campoHtml('Valor do ICMS ST', moeda(t.vST))}
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
  <div class="grade" style="grid-template-columns: 3fr 1.6fr 1fr 0.5fr 1.4fr">
    ${campoHtml('Razão social', tr.nome)}
    ${campoHtml('Frete por conta', MOD_FRETE[Number(tr.modFrete)] || tr.modFrete)}
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

  <div class="titulo">Dados dos produtos / serviços</div>
  <table>
    <thead><tr>
      <th>Código</th><th>Descrição do produto / serviço</th><th>NCM/SH</th><th>CST/CSOSN</th><th>CFOP</th><th>UN</th><th>Quant.</th><th>Valor unit.</th><th>Valor total</th><th>Desconto</th><th>B. cálc. ICMS</th><th>Valor ICMS</th><th>Alíq. ICMS</th>
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

module.exports = { CODE128, codigoDeBarrasSvg, lerNfe, montarDanfeHtml, blocos };
