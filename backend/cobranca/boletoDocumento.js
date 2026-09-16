/**
 * Boleto do Banco do Brasil em HTML pronto para virar PDF (A4 retrato), pelo
 * mesmo caminho do DANFE (janela oculta + printToPDF). A API do BB não
 * devolve o PDF: a ficha é nossa, no leiaute do boleto que o cliente já
 * conhece (o do Gerenciador Financeiro, boleto de 15/09/2026):
 *
 *   - "Pague agora com o seu Pix" com o QR Code, quando o BB devolveu o Pix;
 *   - Recibo do Pagador: pagador, beneficiário, vencimento, agência/código,
 *     nosso número, valor, nº do documento, espécie, aceite, processamento;
 *   - linha de corte;
 *   - Ficha de Compensação: local de pagamento, datas, carteira, instruções
 *     (juros por dia, multa, protesto), valores, pagador e o código de barras
 *     Intercalado 2 de 5 (ITF-25) das 44 posições.
 *
 * Nada vai ao cliente por aqui: o PDF é gerado no app, sob pedido. Na
 * homologação a página leva a marca "HOMOLOGAÇÃO — SEM VALOR"; boleto pago ou
 * baixado leva a marca do estado.
 */
const calculo = require('./boletoCalculo');
const configuracao = require('./configuracaoCobranca');

/** ITF-25: largura de cada dígito em 5 elementos (N = estreito, W = largo). */
const ITF_DIGITOS = ['NNWWN', 'WNNNW', 'NWNNW', 'WWNNN', 'NNWNW', 'WNWNN', 'NWWNN', 'NNNWW', 'WNNWN', 'NWNWN'];
const LOCAL_PAGAMENTO = 'Pagar preferencialmente nos canais de autoatendimento do Banco do Brasil';
const STATUS_IMPRIMIVEIS = new Set(['registrado', 'vencido', 'protestado', 'pago', 'baixado']);

const esc = v => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const digitos = v => String(v ?? '').replace(/\D/g, '');
const moeda = v => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cnpjFmt = d => (String(d || '').length === 14 ? String(d).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : String(d || ''));
const cpfFmt = d => (String(d || '').length === 11 ? String(d).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : String(d || ''));
const cepFmt = d => (String(d || '').length === 8 ? String(d).replace(/^(\d{5})(\d{3})$/, '$1-$2') : String(d || ''));
const documentoFmt = d => (digitos(d).length === 11 ? cpfFmt(digitos(d)) : cnpjFmt(digitos(d)));
const rotuloDocumento = d => (digitos(d).length === 11 ? 'CPF' : 'CNPJ');
const json = v => { if (v && typeof v === 'object') return v; try { return JSON.parse(v || 'null'); } catch (_) { return null; } };

/**
 * Código de barras ITF-25 (Intercalado 2 de 5) de uma quantidade PAR de
 * dígitos, como SVG: início "estreito-estreito-estreito-estreito", pares de
 * dígitos entrelaçados (barras do 1º, espaços do 2º) e fim
 * "largo-estreito-estreito". Largo = 3 estreitos (padrão FEBRABAN).
 */
function itf25Svg(numero, { altura = 50, estreito = 1, largo = 3, largura = null } = {}) {
  const d = digitos(numero);
  if (!d || d.length % 2 !== 0) throw new Error('ITF-25 exige quantidade par de dígitos.');
  const elementos = []; // [largura, é barra?]
  const pos = c => (c === 'W' ? largo : estreito);
  for (let i = 0; i < 4; i++) elementos.push([estreito, i % 2 === 0]);
  for (let i = 0; i < d.length; i += 2) {
    const barras = ITF_DIGITOS[Number(d[i])];
    const espacos = ITF_DIGITOS[Number(d[i + 1])];
    for (let k = 0; k < 5; k++) {
      elementos.push([pos(barras[k]), true]);
      elementos.push([pos(espacos[k]), false]);
    }
  }
  elementos.push([largo, true], [estreito, false], [estreito, true]);

  const retangulos = [];
  let x = 0;
  for (const [w, barra] of elementos) {
    if (barra) retangulos.push(`<rect x="${x}" y="0" width="${w}" height="${altura}"/>`);
    x += w;
  }
  const w = largura || x;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${altura}" viewBox="0 0 ${x} ${altura}" preserveAspectRatio="none" shape-rendering="crispEdges" fill="#000">${retangulos.join('')}</svg>`;
}

/** A sequência de larguras do ITF-25 (para o teste conferir o desenho). */
function itf25Padrao(numero) {
  const d = digitos(numero);
  let s = 'nnnn';
  for (let i = 0; i < d.length; i += 2) {
    const b = ITF_DIGITOS[Number(d[i])];
    const e = ITF_DIGITOS[Number(d[i + 1])];
    for (let k = 0; k < 5; k++) s += b[k] + e[k].toLowerCase();
  }
  return `${s}Wnn`;
}

/** O QR Code do Pix como SVG (a biblioteca `qrcode`); '' quando não há Pix ou a biblioteca faltar. */
async function qrPixSvg(emv) {
  if (!emv) return '';
  try {
    const qrcode = require('qrcode');
    return await qrcode.toString(String(emv), { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
  } catch (_) {
    return '';
  }
}

/**
 * Os dados de UM boleto já no formato da página. Sem linha digitável ou
 * código de barras do BB, as contas vêm de boletoCalculo (mesmo convênio,
 * sequencial, carteira, vencimento e valor).
 */
function dadosDoBoleto(boleto, cfg) {
  if (!boleto) throw Object.assign(new Error('Boleto não encontrado.'), { status: 404 });
  if (!STATUS_IMPRIMIVEIS.has(String(boleto.status))) {
    throw Object.assign(new Error(`O boleto da parcela ${boleto.numero_parcela ?? '?'} ainda não foi registrado no BB (situação "${boleto.status}"): não há o que imprimir.`), { status: 409 });
  }
  const ambiente = boleto.ambiente === configuracao.PRODUCAO ? configuracao.PRODUCAO : configuracao.SANDBOX;
  const conta = configuracao.dadosDaConta(cfg || {}, ambiente);
  const vencimento = String(boleto.data_vencimento || '').slice(0, 10);
  const valor = Number(boleto.valor || 0);
  let barras = digitos(boleto.codigo_barras);
  if (barras.length !== 44) {
    const livre = calculo.campoLivre({ convenio: boleto.convenio || conta.convenio, sequencial: boleto.sequencial, carteira: boleto.carteira || conta.carteira });
    barras = calculo.codigoBarras({ vencimento, valor, campoLivre: livre });
  }
  const linha = boleto.linha_digitavel || calculo.linhaDigitavel(barras).texto;
  const nossoNumero = `${boleto.nosso_numero || ''}${boleto.nosso_numero_dv ? `-${boleto.nosso_numero_dv}` : (boleto.nosso_numero ? `-${calculo.dvNossoNumero(boleto.nosso_numero)}` : '')}`;

  const ag = conta.teste ? conta.agencia : `${conta.agencia}${cfg?.agencia_dv ? `-${cfg.agencia_dv}` : ''}`;
  const cc = conta.teste ? conta.conta : `${conta.conta}${cfg?.conta_dv ? `-${cfg.conta_dv}` : ''}`;

  const pagador = json(boleto.pagador) || {};
  const instrucoes = [];
  const lista = json(boleto.instrucoes);
  if (Array.isArray(lista)) instrucoes.push(...lista.filter(Boolean));
  else if (typeof boleto.instrucoes === 'string' && boleto.instrucoes.trim() && !lista) instrucoes.push(boleto.instrucoes.trim());
  // "Receber até N dias" é regra do registro; no papel o BB mostra só juros, multa e protesto.
  const impressas = instrucoes.filter(t => !/^Receber até/i.test(t));
  if (cfg?.mensagem_boleto) impressas.push(String(cfg.mensagem_boleto));

  const marca = conta.teste ? 'HOMOLOGAÇÃO — SEM VALOR'
    : (boleto.status === 'pago' ? 'PAGO' : (boleto.status === 'baixado' ? 'BAIXADO' : ''));

  return {
    id: boleto.id,
    parcela: boleto.numero_parcela,
    ambiente,
    marca,
    linha,
    barras,
    nossoNumero,
    numeroDocumento: boleto.numero_documento || '',
    vencimento: calculo.dataImpressa(vencimento),
    emissao: calculo.dataImpressa(String(boleto.data_emissao || '').slice(0, 10)),
    valor: moeda(valor),
    carteira: String(boleto.carteira || conta.carteira || ''),
    especieDoc: String(cfg?.especie || 'DM'),
    aceite: cfg?.aceite === true ? 'A' : 'N',
    agenciaCodigo: `${ag}/${cc}`,
    beneficiario: {
      nome: cfg?.beneficiario_nome || '',
      documento: cnpjFmt(digitos(cfg?.beneficiario_cnpj)),
      endereco: cfg?.beneficiario_endereco || '',
      cidade: [cfg?.beneficiario_cep ? `CEP: ${cepFmt(digitos(cfg.beneficiario_cep))}` : '', [cfg?.beneficiario_cidade, cfg?.beneficiario_uf].filter(Boolean).join(' - ')].filter(Boolean).join(', ')
    },
    pagador: {
      nome: pagador.nome || '',
      rotulo: rotuloDocumento(pagador.documento),
      documento: documentoFmt(pagador.documento),
      endereco: [pagador.endereco, pagador.bairro].filter(Boolean).join(' - '),
      cidade: [pagador.cep ? `CEP: ${cepFmt(digitos(pagador.cep))}` : '', [pagador.cidade, pagador.uf].filter(Boolean).join(' - ')].filter(Boolean).join(', ')
    },
    instrucoes: impressas,
    pixEmv: boleto.pix_emv || '',
    nomeArquivo: `Boleto-${String(boleto.numero_documento || boleto.id).replace(/[^A-Za-z0-9]/g, '')}-${boleto.nosso_numero || boleto.id}`
  };
}

const CSS = `
  @page { size: A4 portrait; margin: 8mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; }
  .pagina { width: 194mm; margin: 0 auto; position: relative; }
  .pagina + .pagina { break-before: page; page-break-before: always; }
  .pix { display: flex; align-items: center; gap: 8mm; margin: 4mm 0 6mm 2mm; min-height: 32mm; }
  .pix .qr { width: 30mm; height: 30mm; flex-shrink: 0; }
  .pix .qr svg { width: 30mm; height: 30mm; display: block; }
  .pix h2 { margin: 0 0 1.5mm; font-size: 17pt; color: #3a53d6; }
  .pix p { margin: 0; font-size: 7.5pt; line-height: 1.35; max-width: 95mm; }
  .recibo-rotulo { text-align: right; font-size: 8pt; font-weight: bold; margin: 0 0 1mm; }
  .topo { display: flex; align-items: flex-end; border-bottom: 2px solid #000; }
  .banco { background: #fcfc30; padding: 1mm 2.5mm; display: flex; align-items: center; gap: 1.5mm; height: 10mm; flex-shrink: 0; }
  .banco .simbolo { width: 7mm; height: 7mm; display: block; }
  .banco .nome { font-family: 'Arial Black', Arial, sans-serif; font-weight: 900; font-size: 14pt; color: #2a3a8f; letter-spacing: -0.3pt; white-space: nowrap; }
  .codigo-banco { font-size: 14pt; font-weight: bold; padding: 0 2.5mm 0.8mm; border-right: 1px solid #000; white-space: nowrap; flex-shrink: 0; }
  .linha-digitavel { flex: 1; min-width: 0; font-size: 10.6pt; padding: 0 0 0.8mm 2.5mm; white-space: nowrap; text-align: right; }
  .grade { display: grid; grid-template-columns: 1fr 55mm; }
  .c { border-bottom: 1px solid #000; padding: 0.6mm 2mm 0.8mm; min-height: 9mm; position: relative; }
  .c.lat { border-left: 1px solid #000; background: #fff; }
  .c.cinza { background: #e6e6e6; }
  .c .r { display: block; font-size: 6pt; color: #111; }
  .c .v { display: block; font-size: 8.5pt; font-weight: bold; padding-left: 2mm; }
  .c .v.dir { text-align: right; padding-left: 0; }
  .c .v.gr { font-size: 9pt; }
  .c .doc { position: absolute; right: 2mm; top: 0.6mm; text-align: right; }
  .c .doc .r { text-align: right; }
  .barra-amarela { border-left: 1.5mm solid #fcfc30; }
  .sub { display: grid; }
  .sub > div { border-left: 1px solid #000; padding: 0.6mm 2mm; min-height: 9mm; }
  .sub > div:first-child { border-left: 0; padding-left: 0; }
  .autentica { text-align: right; font-size: 6.5pt; padding: 1mm 2mm 0; min-height: 10mm; position: relative; }
  .autentica::before, .autentica::after { content: ''; position: absolute; top: 3.2mm; height: 5mm; border-top: 1px solid #000; }
  .autentica::before { left: 94mm; width: 36mm; border-left: 1px solid #000; }
  .autentica::after { right: 0; width: 18mm; border-right: 1px solid #000; }
  .corte { display: flex; align-items: center; gap: 2mm; margin: 6mm 0 7mm; font-size: 11pt; }
  .corte span { flex: 1; border-top: 1px dashed #000; }
  .instr { min-height: 30mm; font-size: 8pt; }
  .instr .l { padding-left: 4mm; line-height: 1.3; white-space: pre-wrap; }
  .pagador { border-top: 1px solid #000; margin-top: 8mm; padding: 0.6mm 2mm 1mm; position: relative; min-height: 18mm; }
  .pagador .v { display: block; font-size: 8.5pt; font-weight: bold; padding-left: 2mm; line-height: 1.25; }
  .final { display: flex; justify-content: space-between; font-size: 6.5pt; padding: 1mm 2mm; border-bottom: 1px solid #000; }
  .rodape-ficha { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 1mm; }
  .rodape-ficha .barras svg { display: block; width: 103mm; height: 13mm; }
  .rodape-ficha .aut { font-size: 6.5pt; padding-top: 0.5mm; }
  .marca { position: absolute; top: 45%; left: 0; right: 0; z-index: 5; text-align: center; font-size: 34pt; font-weight: bold; color: rgba(200, 0, 0, 0.16); transform: rotate(-22deg); pointer-events: none; white-space: nowrap; }
`;

/** O símbolo do banco desenhado (quatro losangos), sem copiar imagem. */
const SIMBOLO = '<svg class="simbolo" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><g fill="#2a3a8f"><path d="M10 1 L14 5 L10 9 L6 5 Z"/><path d="M15 6 L19 10 L15 14 L11 10 Z"/><path d="M10 11 L14 15 L10 19 L6 15 Z"/><path d="M5 6 L9 10 L5 14 L1 10 Z"/></g></svg>';

const campo = (rotulo, valor, { classe = '', valorClasse = '', doc = null } = {}) => `<div class="c ${classe}"><span class="r">${esc(rotulo)}</span>`
  + (doc ? `<span class="doc"><span class="r">${esc(doc.rotulo)}</span><span class="v">${esc(doc.valor)}</span></span>` : '')
  + `<span class="v ${valorClasse}">${valor === '' || valor === null || valor === undefined ? '&nbsp;' : valor}</span></div>`;

const linhasHtml = linhas => linhas.filter(Boolean).map(esc).join('<br>');

function topo(d) {
  return `<div class="topo"><div class="banco">${SIMBOLO}<span class="nome">BANCO DO BRASIL</span></div><div class="codigo-banco">001-9</div><div class="linha-digitavel">${esc(d.linha)}</div></div>`;
}

function paginaHtml(d, qrSvg) {
  const pix = d.pixEmv && qrSvg
    ? `<div class="pix"><div class="qr">${qrSvg}</div><div><h2>Pague agora com o seu Pix</h2><p>Para efetuar o pagamento via Pix, utilize a opção Pix de seu aplicativo e aponte a câmera do seu aparelho para o QR code ao lado.</p></div></div>`
    : '';
  const sub = (colunas, celulas) => `<div class="c sub" style="grid-template-columns:${colunas}">${celulas.map(([r, v]) => `<div><span class="r">${esc(r)}</span><span class="v">${v === '' ? '&nbsp;' : esc(v)}</span></div>`).join('')}</div>`;

  const recibo = `
    <p class="recibo-rotulo">Recibo do Pagador</p>
    ${topo(d)}
    <div class="grade">
      <div class="c barra-amarela" style="grid-row: span 2"><span class="r">Nome do Pagador / Endereço</span>
        <span class="doc"><span class="r">${esc(d.pagador.rotulo)}</span><span class="v">${esc(d.pagador.documento)}</span></span>
        <span class="v">${linhasHtml([d.pagador.nome, d.pagador.endereco, d.pagador.cidade])}</span></div>
      ${campo('Data de Vencimento', esc(d.vencimento), { classe: 'lat cinza barra-amarela', valorClasse: 'dir' })}
      ${campo('Agência / Código do Beneficiário', esc(d.agenciaCodigo), { classe: 'lat barra-amarela', valorClasse: 'dir' })}
      <div class="c barra-amarela" style="grid-row: span 2"><span class="r">Nome do Beneficiário / Endereço</span>
        <span class="doc"><span class="r">CNPJ</span><span class="v">${esc(d.beneficiario.documento)}</span></span>
        <span class="v">${linhasHtml([d.beneficiario.nome, d.beneficiario.endereco, d.beneficiario.cidade])}</span></div>
      ${campo('Nosso Número', esc(d.nossoNumero), { classe: 'lat barra-amarela', valorClasse: 'dir' })}
      ${campo('(=) Valor do Documento', esc(d.valor), { classe: 'lat cinza barra-amarela', valorClasse: 'dir gr' })}
      ${sub('38mm 1fr 22mm 12mm 30mm', [['Uso do Banco', ''], ['Nr. do Documento', d.numeroDocumento], ['Espécie Doc.', d.especieDoc], ['Aceite', d.aceite], ['Data Processamento', d.emissao]])}
      ${campo('(=) Valor Pago', '', { classe: 'lat barra-amarela' })}
    </div>
    <div class="autentica">Autenticação Mecânica</div>`;

  const ficha = `
    ${topo(d)}
    <div class="grade">
      ${campo('Local do Pagamento', esc(LOCAL_PAGAMENTO), { classe: 'barra-amarela' })}
      ${campo('Data de Vencimento', esc(d.vencimento), { classe: 'lat cinza barra-amarela', valorClasse: 'dir' })}
      ${campo('Nome do Beneficiário', esc(d.beneficiario.nome), { classe: 'barra-amarela', doc: { rotulo: 'CNPJ', valor: d.beneficiario.documento } })}
      ${campo('Agência / Código do Beneficiário', esc(d.agenciaCodigo), { classe: 'lat barra-amarela', valorClasse: 'dir' })}
      ${sub('38mm 1fr 22mm 12mm 30mm', [['Data Documento', d.emissao], ['Nr. do Documento', d.numeroDocumento], ['Espécie Doc.', d.especieDoc], ['Aceite', d.aceite], ['Data Processamento', d.emissao]])}
      ${campo('Nosso Número', esc(d.nossoNumero), { classe: 'lat barra-amarela', valorClasse: 'dir' })}
      ${sub('38mm 22mm 1fr 34mm 30mm', [['Uso do Banco', ''], ['Carteira', d.carteira], ['Espécie', 'R$'], ['Quantidade', ''], ['(x) Valor', '']])}
      ${campo('(=) Valor do Documento', esc(d.valor), { classe: 'lat cinza barra-amarela', valorClasse: 'dir gr' })}
      <div class="c instr" style="grid-row: span 3"><span class="r">Informações de responsabilidade do Beneficiário</span><div class="l">${d.instrucoes.map(esc).join('<br>') || '&nbsp;'}</div></div>
      ${campo('(-) Abatimento', '', { classe: 'lat barra-amarela', valorClasse: 'dir' })}
      ${campo('(+) Juros / Multa', '', { classe: 'lat barra-amarela', valorClasse: 'dir' })}
      ${campo('(=) Valor Cobrado', '', { classe: 'lat cinza barra-amarela', valorClasse: 'dir' })}
    </div>
    <div class="pagador"><span class="r" style="font-size:6pt">Nome do Pagador / Endereço</span>
      <span class="doc" style="position:absolute; right:2mm; top:0.6mm; text-align:right"><span class="r" style="display:block; font-size:6pt">${esc(d.pagador.rotulo)}</span><span class="v" style="padding:0">${esc(d.pagador.documento)}</span></span>
      <span class="v">${linhasHtml([d.pagador.nome, d.pagador.endereco, d.pagador.cidade])}</span></div>
    <div class="final"><span>Beneficiário Final</span><span>CPF / CNPJ</span></div>
    <div class="rodape-ficha"><div class="barras">${itf25Svg(d.barras)}</div><div class="aut">Autenticação Mecânica - Ficha de Compensação</div></div>`;

  return `<section class="pagina">${d.marca ? `<div class="marca">${esc(d.marca)}</div>` : ''}${pix}${recibo}<div class="corte">✂<span></span></div>${ficha}</section>`;
}

/**
 * HTML de um ou mais boletos (uma página cada). `qr` é um mapa id → SVG do
 * QR Code (gerado antes, porque a biblioteca é assíncrona).
 */
function montarBoletosHtml(boletos, cfg, { qr = {} } = {}) {
  const dados = (Array.isArray(boletos) ? boletos : [boletos]).map(b => dadosDoBoleto(b, cfg));
  if (!dados.length) throw Object.assign(new Error('Nenhum boleto registrado para imprimir.'), { status: 404 });
  const titulo = dados.length === 1 ? `Boleto ${dados[0].numeroDocumento}` : `Boletos ${dados.map(d => d.numeroDocumento).join(', ')}`;
  const corpo = dados.map(d => paginaHtml(d, qr[d.id] || '')).join('');
  return { html: `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>${CSS}</style></head><body>${corpo}</body></html>`, dados };
}

/** Monta com os QR Codes do Pix já gerados. */
async function gerarBoletosHtml(boletos, cfg) {
  const lista = Array.isArray(boletos) ? boletos : [boletos];
  const qr = {};
  for (const b of lista) {
    if (b?.pix_emv) qr[b.id] = await qrPixSvg(b.pix_emv);
  }
  return montarBoletosHtml(lista, cfg, { qr });
}

module.exports = { ITF_DIGITOS, LOCAL_PAGAMENTO, STATUS_IMPRIMIVEIS, itf25Svg, itf25Padrao, qrPixSvg, dadosDoBoleto, montarBoletosHtml, gerarBoletosHtml };
