/**
 * Leitura do XML da NF-e de DEVOLUÇÃO que o cliente emitiu, e o casamento dos
 * itens dela com as peças do pedido — puro, sem rede.
 *
 * O XML é lido por expressão regular, como as respostas da SEFAZ em
 * fiscal/sefazCliente.js: o layout da NF-e é fixo, e o app não carrega
 * biblioteca de XML. Nada aqui interpreta DTD nem entidade externa — um
 * arquivo com DOCTYPE/ENTITY é recusado de cara.
 *
 * O casamento é uma SUGESTÃO: a tela preenche as quantidades e o usuário
 * confere antes de confirmar. O cliente emite com o cadastro dele, então o
 * código do produto raramente é o nosso; por isso a ordem: código, nome,
 * nome parecido e, por último, NCM + preço quando só uma peça serve.
 */

const TAMANHO_MAXIMO = 2 * 1024 * 1024;
const FINALIDADE_DEVOLUCAO = 4;

function erro(mensagem, status = 422) {
  const e = new Error(mensagem);
  e.status = status;
  return e;
}

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodificar(texto) {
  return String(texto ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, n) => ENTIDADES[n])
    .trim();
}

const abre = tag => `<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>`;
const fecha = tag => `</(?:[\\w-]+:)?${tag}>`;

/** O texto da primeira <tag> (com ou sem prefixo de namespace), ou ''. */
function campo(xml, tag) {
  const m = new RegExp(`${abre(tag)}([^<]*)${fecha(tag)}`).exec(String(xml || ''));
  return m ? decodificar(m[1]) : '';
}

/** O primeiro bloco <tag>…</tag> inteiro, ou ''. */
function bloco(xml, tag) {
  const m = new RegExp(`${abre(tag)}[\\s\\S]*?${fecha(tag)}`).exec(String(xml || ''));
  return m ? m[0] : '';
}

function blocos(xml, tag) {
  return String(xml || '').match(new RegExp(`${abre(tag)}[\\s\\S]*?${fecha(tag)}`, 'g')) || [];
}

const numero = v => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const digitos = v => String(v ?? '').replace(/\D/g, '');
const centavos = v => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;

/** Lê a nota. Recusa o que não é XML de NF-e. */
function lerNota(xmlBruto) {
  const xml = String(xmlBruto ?? '').replace(/^\uFEFF/, '');
  if (!xml.trim()) throw erro('O arquivo está vazio.');
  if (xml.length > TAMANHO_MAXIMO) throw erro('O arquivo é grande demais para ser o XML de uma NF-e.');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw erro('Este arquivo não é o XML de uma NF-e.');
  const inf = bloco(xml, 'infNFe');
  const chave = digitos((/<(?:[\w-]+:)?infNFe[^>]*\bId="NFe(\d{44})"/.exec(xml) || [])[1] || campo(bloco(xml, 'infProt'), 'chNFe'));
  if (!inf || chave.length !== 44) throw erro('Este arquivo não é o XML de uma NF-e (não achei a chave de acesso).');

  const ide = bloco(inf, 'ide');
  const emit = bloco(inf, 'emit');
  const dest = bloco(inf, 'dest');
  const totais = bloco(bloco(inf, 'total'), 'ICMSTot');
  const prot = bloco(xml, 'infProt');
  const itens = blocos(inf, 'det').map((det, i) => {
    const prod = bloco(det, 'prod');
    return {
      n_item: Number((/\bnItem="(\d+)"/.exec(det) || [])[1]) || i + 1,
      codigo: campo(prod, 'cProd'),
      descricao: campo(prod, 'xProd'),
      ncm: digitos(campo(prod, 'NCM')),
      cfop: digitos(campo(prod, 'CFOP')),
      unidade: campo(prod, 'uCom'),
      quantidade: numero(campo(prod, 'qCom')),
      valor_unitario: numero(campo(prod, 'vUnCom')),
      valor_total: centavos(numero(campo(prod, 'vProd')) - numero(campo(prod, 'vDesc')))
    };
  });

  return {
    chave_acesso: chave,
    modelo: campo(ide, 'mod'),
    serie: Number(campo(ide, 'serie')) || 0,
    numero: Number(campo(ide, 'nNF')) || 0,
    data_emissao: campo(ide, 'dhEmi') || campo(ide, 'dEmi') || null,
    finalidade: Number(campo(ide, 'finNFe')) || null,
    natureza_operacao: campo(ide, 'natOp'),
    emitente_documento: digitos(campo(emit, 'CNPJ') || campo(emit, 'CPF')),
    emitente_nome: campo(emit, 'xNome'),
    destinatario_documento: digitos(campo(dest, 'CNPJ') || campo(dest, 'CPF')),
    chaves_referenciadas: blocos(ide, 'NFref').map(r => digitos(campo(r, 'refNFe'))).filter(c => c.length === 44),
    protocolo: campo(prot, 'nProt') || null,
    codigo_status: campo(prot, 'cStat') || null,
    valor_produtos: centavos(numero(campo(totais, 'vProd'))),
    valor_total: centavos(numero(campo(totais, 'vNF'))),
    itens
  };
}

/**
 * O que a nota tem de estranho para ESTE pedido. `bloqueios` impedem o uso;
 * `avisos` só aparecem — quem decide é o usuário.
 */
function conferirNota(nota, { chaveDaNotaDoPedido = null, documentoDaEmpresa = null, documentoDoCliente = null } = {}) {
  const bloqueios = [];
  const avisos = [];
  const empresa = digitos(documentoDaEmpresa);
  const cliente = digitos(documentoDoCliente);
  if (nota.modelo && nota.modelo !== '55') bloqueios.push(`Esta nota é modelo ${nota.modelo}; a devolução vem em NF-e (modelo 55).`);
  if (empresa && nota.destinatario_documento && nota.destinatario_documento !== empresa) {
    bloqueios.push('Esta nota não foi emitida para a empresa (o destinatário é outro CNPJ).');
  }
  if (nota.finalidade !== FINALIDADE_DEVOLUCAO) avisos.push('A nota não está marcada como devolução (finalidade diferente de 4).');
  if (cliente && nota.emitente_documento && nota.emitente_documento !== cliente) {
    avisos.push(`O emitente (${nota.emitente_nome || nota.emitente_documento}) não é o cliente deste pedido.`);
  }
  if (chaveDaNotaDoPedido && !nota.chaves_referenciadas.includes(digitos(chaveDaNotaDoPedido))) {
    avisos.push(nota.chaves_referenciadas.length
      ? 'A nota referencia outra NF-e, não a deste pedido.'
      : 'A nota não referencia a NF-e deste pedido.');
  }
  if (!nota.protocolo || nota.codigo_status !== '100') avisos.push('O XML não traz o protocolo de autorização da SEFAZ (peça ao cliente o XML autorizado).');
  if (!nota.itens.length) bloqueios.push('A nota não tem itens.');
  return { bloqueios, avisos };
}

// O "\u00d7" das medidas ("15 \u00d7 30") chega na nota do cliente como "X".
const normalizar = s => String(s ?? '').replace(/\u00d7/g, 'x').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const perto = (a, b) => a > 0 && b > 0 && Math.abs(a - b) <= Math.max(0.01, b * 0.01);

/**
 * Casa cada item da nota com uma peça do pedido (as de `calculo.itensParaDevolver`).
 * Devolve as quantidades sugeridas, de onde cada uma saiu e o que não foi reconhecido.
 */
function casarItens(itensDaNota = [], pecas = []) {
  const restante = new Map(pecas.map(p => [String(p.pedido_item_id), Number(p.disponivel) || 0]));
  const livres = () => pecas.filter(p => restante.get(String(p.pedido_item_id)) > 0);
  const escolhas = new Map();
  const casados = [];
  const naoReconhecidos = [];
  const avisos = [];

  for (const item of itensDaNota) {
    const codigo = normalizar(item.codigo);
    const nome = normalizar(item.descricao);
    const candidatos = livres();
    const unico = lista => (lista.length === 1 ? lista[0] : null);
    let peca = null;
    let criterio = null;
    const tentar = (achado, como) => { if (!peca && achado) { peca = achado; criterio = como; } };
    tentar(codigo ? candidatos.find(p => normalizar(p.codigo) === codigo) : null, 'código');
    tentar(nome ? candidatos.find(p => normalizar(p.nome) === nome) : null, 'nome');
    tentar(nome.length >= 6 ? unico(candidatos.filter(p => { const n = normalizar(p.nome); return n.length >= 6 && (n.includes(nome) || nome.includes(n)); })) : null, 'nome parecido');
    tentar(item.ncm ? unico(candidatos.filter(p => String(p.ncm || '').replace(/\D/g, '') === item.ncm
      && (perto(item.valor_unitario, p.valor_unitario) || perto(item.valor_unitario, p.valor_cheio)))) : null, 'NCM e preço');

    if (!peca) {
      naoReconhecidos.push({ n_item: item.n_item, codigo: item.codigo, descricao: item.descricao, quantidade: item.quantidade, valor_total: item.valor_total });
      continue;
    }
    const chave = String(peca.pedido_item_id);
    let quantidade = Math.floor(item.quantidade);
    if (quantidade !== item.quantidade) avisos.push(`"${item.descricao}": a nota traz ${item.quantidade} (quantidade quebrada); considerei ${quantidade}.`);
    const cabe = restante.get(chave);
    if (quantidade > cabe) {
      avisos.push(`"${item.descricao}": a nota devolve ${quantidade}, mas o pedido só tem ${cabe} para devolver.`);
      quantidade = cabe;
    }
    if (!(quantidade > 0)) continue;
    restante.set(chave, cabe - quantidade);
    escolhas.set(chave, (escolhas.get(chave) || 0) + quantidade);
    casados.push({ n_item: item.n_item, descricao: item.descricao, quantidade, pedido_item_id: peca.pedido_item_id, nome: peca.nome, criterio });
  }

  return {
    escolhas: [...escolhas].map(([id, quantidade]) => ({ pedido_item_id: Number(id), quantidade })),
    casados, nao_reconhecidos: naoReconhecidos, avisos
  };
}

/** A nota sem o que pesa, para a tela. */
function resumoDaNota(nota) {
  const { itens, ...resto } = nota;
  return { ...resto, quantidade_de_itens: itens.length };
}

module.exports = { TAMANHO_MAXIMO, FINALIDADE_DEVOLUCAO, lerNota, conferirNota, casarItens, resumoDaNota, normalizar };
