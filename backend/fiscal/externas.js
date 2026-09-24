/**
 * NF-e e boletos emitidos FORA do sistema, informados pelo usuário.
 *
 *   NF-e ...... pelo XML (lido por devolucoes/xmlDevolucao.lerNota) ou pela
 *               chave de acesso (44 números) + o valor.
 *   Boleto .... pela linha digitável (47 números) de cada parcela: os
 *               dígitos verificadores pegam erro de digitação, e dela saem
 *               banco, valor e vencimento.
 *
 * O XML da nota é GUARDADO desde 24/09/2026 (antes era lido e descartado):
 * sem ele não existem DANFE nem carta de correção, porque os dois documentos
 * são desenhados em cima do `nfeProc`. Quem informou a nota só pela chave
 * pode ANEXAR o XML depois, na mesma tela — e as cartas de correção emitidas
 * de fora entram pelo XML do evento (procEventoNFe) ou à mão. SQL:
 * sql/nfe_externa_xml_cce.sql.
 *
 * Nada disso passa pela SEFAZ nem pelo BB: nota de fora não se emite, não se
 * corrige e não se cancela por aqui — só se registra o que já aconteceu lá
 * fora. As tabelas são próprias (sql/nfe_boletos_externos.sql), separadas de
 * notas_fiscais e boletos, para a emissão e a cobrança continuarem lendo só
 * as delas.
 *
 * As contas são funções puras (testáveis sem rede); as de baixo falam com a API.
 */
const xmlNota = require('../devolucoes/xmlDevolucao');
const boletoCalculo = require('../cobranca/boletoCalculo');
const configuracaoFiscal = require('./configuracaoFiscal');

const SQL_ARQUIVO = 'sql/nfe_boletos_externos.sql';
const SQL_FALTANDO = `Falta rodar ${SQL_ARQUIVO} no banco e reiniciar a API.`;
const TABELAS = ['notas_fiscais_externas', 'boletos_externos'];
const SITUACOES_QUE_SAIRAM = new Set(['enviado', 'entregue']);

// Os bancos mais comuns na carteira; o resto aparece pelo código.
const BANCOS = {
  '001': 'Banco do Brasil', '033': 'Santander', '041': 'Banrisul', '070': 'BRB', '077': 'Inter', '085': 'Ailos',
  '104': 'Caixa', '136': 'Unicred', '208': 'BTG Pactual', '212': 'Original', '237': 'Bradesco', '260': 'Nubank',
  '336': 'C6 Bank', '341': 'Itaú', '389': 'Mercantil', '422': 'Safra', '633': 'Rendimento', '655': 'Votorantim',
  '707': 'Daycoval', '745': 'Citibank', '748': 'Sicredi', '756': 'Sicoob'
};

function erro(mensagem, status = 422, extra = null) {
  const e = new Error(mensagem);
  e.status = status;
  if (extra) e.extra = extra;
  return e;
}

const digitos = v => String(v ?? '').replace(/\D/g, '');
const centavos = v => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
const lista = r => (Array.isArray(r) ? r : (r && typeof r === 'object' && !r.error ? [r] : []));
const ativo = v => !(v === false || v === 'false' || v === 0 || v === 'f');
const dia = v => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? '')); return m ? m[0] : null; };

// ---------------------------------------------------------------- NF-e

/** Dígito verificador da chave de acesso (módulo 11, pesos 2 a 9 da direita; 0 ou 1 de resto → 0). */
function dvDaChave(chave43) {
  let soma = 0;
  let peso = 2;
  for (let i = chave43.length - 1; i >= 0; i -= 1) {
    soma += Number(chave43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/**
 * O que a chave de acesso diz sozinha: UF, mês de emissão, CNPJ do emitente,
 * modelo, série e número. Recusa chave com tamanho errado ou dígito que não
 * confere (erro de digitação). Pura.
 */
function lerChave(texto) {
  const chave = digitos(texto);
  if (chave.length !== 44) throw erro('A chave de acesso tem 44 números. Confira se copiou inteira.');
  if (dvDaChave(chave.slice(0, 43)) !== Number(chave[43])) throw erro('A chave de acesso não confere (dígito verificador). Confira a digitação.');
  const ano = 2000 + Number(chave.slice(2, 4));
  const mes = chave.slice(4, 6);
  return {
    chave_acesso: chave,
    uf: chave.slice(0, 2),
    mes_emissao: `${ano}-${mes}`,
    emitente_documento: chave.slice(6, 20),
    modelo: chave.slice(20, 22),
    serie: Number(chave.slice(22, 25)),
    numero: Number(chave.slice(25, 34))
  };
}

/** Valor digitado ("1.234,56", "1234.56" ou número) em reais; null quando não há. Pura. */
function lerValor(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? centavos(v) : null;
  const t = String(v ?? '').replace(/[R$\s]/g, '');
  if (!t) return null;
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  const n = Number(normal);
  return Number.isFinite(n) ? centavos(n) : null;
}

/**
 * A nota de fora a partir do que veio da tela: `{ xml }` ou `{ chave, valor }`.
 * Devolve os campos que se gravam (sem o XML, que é descartado). Pura.
 */
function notaDaEntrada(entrada) {
  if (entrada?.xml) {
    const lida = xmlNota.lerNota(entrada.xml);
    return {
      origem: 'xml',
      chave_acesso: lida.chave_acesso, modelo: lida.modelo || lerChave(lida.chave_acesso).modelo,
      serie: lida.serie, numero: lida.numero,
      data_emissao: dia(lida.data_emissao), mes_emissao: dia(lida.data_emissao)?.slice(0, 7) || lerChave(lida.chave_acesso).mes_emissao,
      valor_total: lida.valor_total, emitente_documento: lida.emitente_documento, emitente_nome: lida.emitente_nome || null,
      destinatario_documento: lida.destinatario_documento || null,
      protocolo: lida.protocolo, codigo_status: lida.codigo_status
    };
  }
  if (!digitos(entrada?.chave)) throw erro('Envie o XML da nota ou informe a chave de acesso.');
  const daChave = lerChave(entrada.chave);
  const valor = lerValor(entrada?.valor);
  if (!(valor > 0)) throw erro('Informe o valor total da nota.');
  return {
    origem: 'chave', ...daChave, data_emissao: dia(entrada?.data_emissao), valor_total: valor,
    emitente_nome: null, destinatario_documento: null, protocolo: null, codigo_status: null
  };
}

/**
 * O que a nota tem de errado (`bloqueios`, não grava) ou de estranho
 * (`avisos`, o usuário decide) para ESTE pedido. Pura.
 */
function conferirNota(nota, { documentoDaEmpresa = null, documentoDoCliente = null, valorDoPedido = null, chavesProprias = [] } = {}) {
  const bloqueios = [];
  const avisos = [];
  const empresa = digitos(documentoDaEmpresa);
  const cliente = digitos(documentoDoCliente);
  if (nota.modelo && nota.modelo !== '55') bloqueios.push(`Esta nota é modelo ${nota.modelo}; aqui entra NF-e (modelo 55).`);
  if (empresa && nota.emitente_documento && nota.emitente_documento !== empresa) {
    bloqueios.push('Esta nota não foi emitida pela empresa (o CNPJ do emitente é outro).');
  }
  if (chavesProprias.map(digitos).includes(nota.chave_acesso)) bloqueios.push('Esta nota foi emitida por aqui: ela já está no pedido.');
  if (nota.origem === 'xml') {
    if (cliente && nota.destinatario_documento && nota.destinatario_documento !== cliente) avisos.push('O destinatário da nota não é o cliente deste pedido.');
    if (!nota.protocolo || String(nota.codigo_status) !== '100') avisos.push('O XML não traz o protocolo de autorização da SEFAZ (use o XML autorizado, o "procNFe").');
  } else {
    avisos.push('Pela chave não dá para conferir o destinatário nem se a nota foi autorizada. Se tiver o XML, prefira ele.');
  }
  const valor = Number(valorDoPedido);
  if (valor > 0 && nota.valor_total > 0 && Math.abs(valor - nota.valor_total) > 0.01) {
    avisos.push(`O valor da nota (${moeda(nota.valor_total)}) é diferente do valor do pedido (${moeda(valor)}).`);
  }
  return { bloqueios, avisos };
}

const moeda = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ------------------------------------------------------------- boletos

/**
 * O vencimento pelo fator (4 números): de 07/10/1997 até chegar a 9999; a
 * partir de 22/02/2025 recomeça em 1000. O mesmo fator vale nos dois ciclos,
 * então vence a data mais perto de hoje. 0000 = sem vencimento. Pura.
 */
function vencimentoDoFator(fator, hoje) {
  const f = Number(fator);
  if (!f) return null;
  const um = 86400000;
  const candidatos = [Date.UTC(1997, 9, 7) + f * um];
  if (f >= 1000) candidatos.push(Date.UTC(2025, 1, 22) + (f - 1000) * um);
  const [a, m, d] = (dia(hoje) || new Date().toISOString().slice(0, 10)).split('-').map(Number);
  const ref = Date.UTC(a, m - 1, d);
  candidatos.sort((x, y) => Math.abs(x - ref) - Math.abs(y - ref));
  return new Date(candidatos[0]).toISOString().slice(0, 10);
}

/** A linha como sai impressa: 00190.00009 03453.481008 00000.393173 1 12340000200000. Pura. */
function linhaImpressa(d) {
  const l = digitos(d);
  if (l.length !== 47) return l;
  return `${l.slice(0, 5)}.${l.slice(5, 10)} ${l.slice(10, 15)}.${l.slice(15, 21)} ${l.slice(21, 26)}.${l.slice(26, 32)} ${l[32]} ${l.slice(33)}`;
}

/**
 * Lê a linha digitável de um boleto bancário (47 números): confere o dígito
 * de cada campo e o geral, e tira banco, valor, vencimento e o código de
 * barras. Recusa conta de concessionária (48 números) e digitação errada. Pura.
 */
function lerLinhaDigitavel(texto, hoje) {
  const l = digitos(texto);
  if (l.length === 48) throw erro('Isto é código de conta de consumo (luz, água, tributo), não de boleto bancário.');
  if (l.length === 44) throw erro('Isto parece o código de barras (44 números). Cole a linha digitável, com 47 números.');
  if (l.length !== 47) throw erro('A linha digitável do boleto tem 47 números. Confira se copiou inteira.');
  const campos = [[0, 9], [10, 20], [21, 31]];
  for (const [i, [ini, fim]] of campos.entries()) {
    if (boletoCalculo.dvModulo10(l.slice(ini, fim)) !== l[fim]) throw erro(`A linha digitável não confere (campo ${i + 1}). Confira a digitação.`);
  }
  const banco = l.slice(0, 3);
  const livre = `${l.slice(4, 9)}${l.slice(10, 20)}${l.slice(21, 31)}`;
  const fatorValor = l.slice(33, 47);
  const semDv = `${banco}${l[3]}${fatorValor}${livre}`;
  if (boletoCalculo.dvCodigoBarras(semDv) !== l[32]) throw erro('A linha digitável não confere (dígito geral). Confira a digitação.');
  const valor = centavos(Number(fatorValor.slice(4)) / 100);
  return {
    linha_digitavel: l,
    codigo_barras: `${banco}${l[3]}${l[32]}${fatorValor}${livre}`,
    banco,
    banco_nome: BANCOS[banco] || `Banco ${banco}`,
    // O campo livre (25 posições) é de onde sai o nosso número quando o
    // boleto é do nosso convênio no BB — aí ele não é "de fora": é importado
    // de verdade (backend/cobranca/importacao.js).
    campo_livre: livre,
    valor: valor > 0 ? valor : null,
    vencimento: vencimentoDoFator(fatorValor.slice(0, 4), hoje)
  };
}

/** O que o boleto tem de diferente da parcela: só avisa. Pura. */
function conferirBoleto(boleto, parcela) {
  const avisos = [];
  const valorParcela = Number(parcela?.valor);
  if (boleto.valor && valorParcela > 0 && Math.abs(boleto.valor - valorParcela) > 0.01) {
    avisos.push(`O boleto cobra ${moeda(boleto.valor)} e a parcela vale ${moeda(valorParcela)}.`);
  }
  const venc = dia(parcela?.data_vencimento);
  if (boleto.vencimento && venc && boleto.vencimento !== venc) {
    const [a, m, d] = boleto.vencimento.split('-');
    avisos.push(`O boleto vence em ${d}/${m}/${a}, diferente da parcela.`);
  }
  return avisos;
}

/** O pedido já saiu (enviado ou entregue) e não está cancelado? Pura. */
function pedidoSaiu(pedido) {
  return SITUACOES_QUE_SAIRAM.has(String(pedido?.situacao || '').trim().toLowerCase());
}

/** Pedido que não se cobra mais: cancelado ou devolvido por inteiro. Pura. */
function pedidoCancelado(pedido) {
  return String(pedido?.situacao || '').trim().toLowerCase() === 'cancelado' || pedido?.devolucao === 'total';
}

// ------------------------------------------------------------------ API

/** Tabela desta fase ausente: API remota (404 "Tabela 'x' não encontrada") ou Postgres local (42P01). */
function tabelaAusente(err) {
  const bruto = `${err?.message || ''} ${err?.body?.error || ''} ${err?.body?.detalhe || ''} ${err?.code || ''}`;
  if (/42P01/.test(bruto)) return true;
  const citaTabela = TABELAS.some(t => bruto.includes(t));
  return citaTabela && (/does not exist|não encontrada|não existe/i.test(bruto) || (err?.status === 404 && /tabela/i.test(bruto)));
}

const sqlPendente = () => erro(SQL_FALTANDO, 409, { sql_pendente: true });

/** Lê conferindo o filtro aqui também (a API ignora coluna que não conhece e devolveria tudo). */
async function ler(api, tabela, query = {}) {
  try {
    const linhas = lista(await api.get(`/api/${tabela}`, { query }));
    return linhas.filter(l => l && Object.entries(query).every(([c, v]) => String(l[c]) === String(v)));
  } catch (e) {
    if (tabelaAusente(e)) throw sqlPendente();
    throw e;
  }
}

/** Como `ler`, mas sem o SQL devolve lista vazia: para quem só enfeita outra tela. */
async function lerSePuder(api, tabela, query = {}) {
  try {
    return await ler(api, tabela, query);
  } catch (e) {
    if (e?.extra?.sql_pendente) return [];
    throw e;
  }
}

async function gravar(api, metodo, caminho, corpo) {
  try {
    return await api[metodo](caminho, corpo);
  } catch (e) {
    if (tabelaAusente(e)) throw sqlPendente();
    throw e;
  }
}

async function lerPedido(api, pedidoId) {
  const id = Number(pedidoId);
  if (!Number.isInteger(id) || id <= 0) throw erro('Pedido inválido.', 400);
  const pedido = lista(await api.get('/api/pedidos', { query: { id } })).find(p => Number(p?.id) === id) || null;
  if (!pedido) throw erro('Pedido não encontrado.', 404);
  return pedido;
}

/** Quantas cartas de correção cada nota de fora tem, e a última sequência. Pura. */
function cartasPorNotaDeFora(eventos) {
  const porNota = {};
  for (const e of Array.isArray(eventos) ? eventos : []) {
    if (!e || !ativo(e.ativo) || String(e.tipo || 'cce') !== 'cce') continue;
    const seq = Number(e.sequencia) || 1;
    const chave = String(e.nota_externa_id);
    const atual = porNota[chave] || { cartas_correcao: 0, ultima_carta_seq: 0 };
    porNota[chave] = { cartas_correcao: atual.cartas_correcao + 1, ultima_carta_seq: Math.max(atual.ultima_carta_seq, seq) };
  }
  return porNota;
}

/**
 * As notas de fora vivas (todas, ou só as de um pedido), sem o XML e com a
 * contagem de cartas de correção — os mesmos campos que a lista de pedidos já
 * usa nas notas daqui (`emissao.listarNotas`), para a tag sair igual.
 */
async function listarNotas(api, { pedidoId = null } = {}) {
  const query = pedidoId ? { pedido_id: Number(pedidoId) } : {};
  const [notas, eventos] = await Promise.all([
    lerSePuder(api, 'notas_fiscais_externas', query),
    lerSePuder(api, 'notas_fiscais_externas_eventos', {})
  ]);
  const cartas = cartasPorNotaDeFora(eventos);
  return notas.filter(n => ativo(n.ativo))
    .map(notaParaTela)
    .map(n => ({ ...n, ...(cartas[String(n.id)] || { cartas_correcao: 0, ultima_carta_seq: null }) }));
}

/**
 * O estado da NF-e de fora de um pedido: a nota viva (se houver), se o pedido
 * já tem nota emitida aqui e se dá para informar uma agora.
 */
async function estadoDaNota(api, pedidoId) {
  const pedido = await lerPedido(api, pedidoId);
  const [notas, externas] = await Promise.all([
    api.get('/api/notas_fiscais', { query: { pedido_id: pedido.id } }).then(lista).catch(() => []),
    ler(api, 'notas_fiscais_externas', { pedido_id: pedido.id })
  ]);
  const propria = notas.filter(n => Number(n?.pedido_id) === Number(pedido.id) && String(n.status_fiscal) === 'autorizada')
    .sort((a, b) => Number(b.id) - Number(a.id))[0] || null;
  const externa = externas.filter(n => ativo(n.ativo)).sort((a, b) => Number(b.id) - Number(a.id))[0] || null;
  let motivo = null;
  if (!pedidoSaiu(pedido)) motivo = 'Só pedido enviado ou entregue recebe nota de fora.';
  else if (propria) motivo = `O pedido já tem a NF-e ${propria.serie}/${propria.numero} emitida por aqui.`;
  else if (externa) motivo = 'O pedido já tem uma NF-e de fora. Remova a que está para informar outra.';
  return {
    pedido: {
      id: pedido.id, numero: pedido.numero, situacao: pedido.situacao, devolucao: pedido.devolucao || null,
      valor: Number(pedido.valor_final) || null, forma_pagamento: pedido.forma_pagamento || null
    },
    nota_propria: propria ? { id: propria.id, serie: propria.serie, numero: propria.numero } : null,
    nota_externa: notaParaTela(externa),
    pode_informar: !motivo,
    motivo
  };
}

/**
 * A nota de fora como a TELA vê: sem o XML (que é o arquivo inteiro e não
 * tem por que trafegar a cada leitura) e com as duas marcas que a tela usa
 * para decidir o que mostrar. Pura.
 *
 *   `tem_xml`   — dá para gerar DANFE e carta de correção;
 *   `guarda_xml`— a coluna existe (o SQL da fase rodou).
 */
function notaParaTela(nota) {
  if (!nota) return null;
  const { xml, ...resto } = nota;
  return { ...resto, tem_xml: Boolean(xml), guarda_xml: Object.prototype.hasOwnProperty.call(nota, 'xml') };
}

/**
 * Confere (e, sem `apenasPrevia`, grava) a NF-e de fora do pedido. A
 * entrada é `{ xml }` ou `{ chave, valor, data_emissao? }`; o XML é lido e
 * descartado. Bloqueio vira 422 com a lista na resposta.
 */
async function informarNota({ api, pedidoId, entrada, usuarioId = null, apenasPrevia = false }) {
  const estado = await estadoDaNota(api, pedidoId);
  if (!estado.pode_informar) throw erro(estado.motivo, 409);
  const nota = notaDaEntrada(entrada);
  const pedido = await lerPedido(api, pedidoId);
  const [cfg, cliente, proprias] = await Promise.all([
    configuracaoFiscal.carregar(api).catch(() => null),
    pedido.cliente_id ? api.get('/api/clientes', { query: { id: pedido.cliente_id } }).then(r => lista(r)[0] || null).catch(() => null) : null,
    api.get('/api/notas_fiscais', { query: { pedido_id: pedido.id } }).then(lista).catch(() => [])
  ]);
  const conferencia = conferirNota(nota, {
    documentoDaEmpresa: cfg?.cnpj || null,
    documentoDoCliente: cliente?.cnpj || cliente?.cpf || null,
    valorDoPedido: Number(pedido.valor_final) || null,
    chavesProprias: proprias.map(n => n?.chave_acesso).filter(Boolean)
  });
  if (conferencia.bloqueios.length) throw erro(conferencia.bloqueios[0], 422, { nota, ...conferencia });
  if (apenasPrevia) return { nota, ...conferencia };

  // A mesma chave em outro pedido é engano de pedido, não nota nova.
  const mesmaChave = (await ler(api, 'notas_fiscais_externas', { chave_acesso: nota.chave_acesso })).filter(n => ativo(n.ativo));
  if (mesmaChave.length) throw erro('Esta chave já foi informada em outro pedido.', 409);

  const { codigo_status: _status, ...campos } = nota;
  const quando = new Date().toISOString();
  // O XML entra junto quando veio dele: é o que permite DANFE e carta de
  // correção depois. Sem a coluna (SQL da fase não rodado) a API ignora o
  // campo em silêncio e a nota entra igual — só sem os documentos.
  const doXml = entrada?.xml ? { xml: String(entrada.xml), xml_em: quando, xml_por: usuarioId } : {};
  const criada = await gravar(api, 'post', '/api/notas_fiscais_externas', {
    pedido_id: pedido.id, ...campos, ...doXml, observacao: String(entrada?.observacao || '').trim().slice(0, 300) || null,
    ativo: true, criado_por: usuarioId, criado_em: quando
  });
  return { nota: criada, ...conferencia };
}

/** Tira a NF-e de fora do pedido (só desliga: fica o rastro). */
async function removerNota({ api, pedidoId, usuarioId = null }) {
  const estado = await estadoDaNota(api, pedidoId);
  if (!estado.nota_externa) throw erro('O pedido não tem NF-e de fora.', 404);
  await gravar(api, 'put', `/api/notas_fiscais_externas/${estado.nota_externa.id}`, { ativo: false, removido_por: usuarioId, removido_em: new Date().toISOString() });
  return { ok: true };
}

// ------------------------------------------------- XML e cartas de correção

const SQL_DOCUMENTOS = 'sql/nfe_externa_xml_cce.sql';
const SQL_DOCUMENTOS_FALTANDO = `Falta rodar ${SQL_DOCUMENTOS} no banco e reiniciar a API.`;
/** A SEFAZ aceita de 1 a 20 cartas de correção por nota. */
const MAXIMO_DE_CARTAS = 20;
const TP_EVENTO_CCE = '110110';

function sqlDocumentosPendente() {
  return erro(SQL_DOCUMENTOS_FALTANDO, 409, { sql_pendente: true, arquivo: SQL_DOCUMENTOS });
}

/** A coluna/tabela desta fase já existe? (sem ela a tela avisa e não quebra) */
const guardaXml = nota => Boolean(nota) && Object.prototype.hasOwnProperty.call(nota, 'xml');

/**
 * O que o procEventoNFe de uma carta de correção diz. Só leitura, sem rede:
 * as mesmas regras do XML da nota (nada de DOCTYPE/ENTITY, tamanho travado).
 * Pura.
 */
function lerCartaCorrecaoXml(xmlBruto) {
  const xml = String(xmlBruto ?? '').replace(/^﻿/, '');
  if (!xml.trim()) throw erro('O arquivo está vazio.');
  if (xml.length > xmlNota.TAMANHO_MAXIMO) throw erro('O arquivo é grande demais para ser o XML de uma carta de correção.');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw erro('Este arquivo não é o XML de uma carta de correção.');

  const infEvento = xmlNota.bloco(xml, 'infEvento');
  const tpEvento = digitos(xmlNota.campo(xml, 'tpEvento'));
  if (!infEvento || !tpEvento) throw erro('Este arquivo não é o XML de um evento da NF-e.');
  if (tpEvento !== TP_EVENTO_CCE) {
    throw erro(`Este evento é do tipo ${tpEvento}; aqui entra carta de correção (110110).`);
  }
  const chave = digitos(xmlNota.campo(xml, 'chNFe'));
  if (chave.length !== 44) throw erro('O XML do evento não traz a chave da nota.');
  const correcao = xmlNota.campo(xml, 'xCorrecao');
  if (!correcao) throw erro('O XML do evento não traz o texto da correção (xCorrecao).');

  // O retorno da SEFAZ (retEvento) é o que prova o registro. Sem ele o
  // arquivo é só o pedido de evento — entra, mas sem protocolo.
  const retorno = xmlNota.bloco(xml, 'retEvento');
  const status = digitos(xmlNota.campo(retorno, 'cStat')) || null;
  if (retorno && status && !['135', '136'].includes(status)) {
    throw erro(`A SEFAZ não registrou esta carta (cStat ${status}: ${xmlNota.campo(retorno, 'xMotivo') || 'sem motivo'}).`);
  }
  return {
    chave_acesso: chave,
    sequencia: Number(xmlNota.campo(xml, 'nSeqEvento')) || 1,
    correcao,
    protocolo: xmlNota.campo(retorno, 'nProt') || null,
    data_evento: xmlNota.campo(retorno, 'dhRegEvento') || xmlNota.campo(xml, 'dhEvento') || null,
    codigo_status: status
  };
}

/** O que a tela mostra de uma carta (sem o XML, que é pesado). Pura. */
function cartaParaTela(linha) {
  if (!linha) return null;
  return {
    id: linha.id,
    sequencia: Number(linha.sequencia) || 1,
    correcao: linha.correcao || '',
    protocolo: linha.protocolo || null,
    data_evento: linha.data_evento || null,
    origem: linha.origem || 'manual',
    tem_xml: Boolean(linha.xml),
    criado_em: linha.criado_em || null
  };
}

/**
 * A nota de fora viva do pedido, CRUA (com o XML) — `estadoDaNota` entrega a
 * versão da tela, sem o arquivo. Erra quando não há nota ou quando o SQL da
 * fase não rodou.
 */
async function notaViva(api, pedidoId) {
  const pedido = await lerPedido(api, pedidoId);
  const nota = (await ler(api, 'notas_fiscais_externas', { pedido_id: pedido.id }))
    .filter(n => ativo(n.ativo))
    .sort((a, b) => Number(b.id) - Number(a.id))[0] || null;
  if (!nota) throw erro('O pedido não tem NF-e de fora.', 404);
  if (!guardaXml(nota)) throw sqlDocumentosPendente();
  return nota;
}

/**
 * Anexa (ou troca) o XML da nota de fora já gravada.
 *
 * É o caminho de quem informou a nota só pela chave + valor: sem o XML não há
 * DANFE nem carta de correção, porque os dois documentos são desenhados em
 * cima do `nfeProc`. A chave do arquivo tem de ser a MESMA da nota gravada —
 * senão é outra nota, e trocar o conteúdo por baixo seria pior que recusar.
 *
 * O que estava em branco no cadastro (protocolo, nome do emitente, documento
 * do destinatário, data de emissão) é preenchido a partir do XML; o que já
 * estava e diverge vira AVISO, nunca sobrescrita silenciosa.
 */
async function anexarXmlDaNota({ api, pedidoId, xml, usuarioId = null }) {
  const nota = await notaViva(api, pedidoId);
  const lida = xmlNota.lerNota(xml);
  if (digitos(lida.chave_acesso) !== digitos(nota.chave_acesso)) {
    throw erro('Este XML é de outra nota: a chave de acesso não bate com a que está informada neste pedido.');
  }
  if (lida.modelo && String(lida.modelo) !== '55') throw erro(`Esta nota é modelo ${lida.modelo}; aqui entra NF-e (modelo 55).`);

  const avisos = [];
  const valorDoXml = centavos(lida.valor_total);
  const valorGravado = nota.valor_total === null || nota.valor_total === undefined ? null : centavos(nota.valor_total);
  if (valorGravado !== null && valorDoXml && Math.abs(valorGravado - valorDoXml) >= 0.01) {
    avisos.push(`O valor do XML (${valorDoXml.toFixed(2)}) é diferente do que estava informado (${valorGravado.toFixed(2)}).`);
  }
  const quando = new Date().toISOString();
  const campos = { xml: String(xml), xml_em: quando, xml_por: usuarioId, origem: 'xml' };
  // Só completa o que faltava — o que o usuário informou continua valendo.
  if (!nota.protocolo && lida.protocolo) campos.protocolo = lida.protocolo;
  if (!nota.emitente_nome && lida.emitente_nome) campos.emitente_nome = lida.emitente_nome;
  if (!nota.destinatario_documento && lida.destinatario_documento) campos.destinatario_documento = lida.destinatario_documento;
  if (!nota.data_emissao && dia(lida.data_emissao)) campos.data_emissao = dia(lida.data_emissao);
  if (!lida.protocolo) avisos.push('O XML não tem o protocolo de autorização: é o arquivo de envio, não o de distribuição (nfeProc).');

  const atualizada = await gravar(api, 'put', `/api/notas_fiscais_externas/${nota.id}`, campos);
  return { nota: { ...nota, ...campos, ...(atualizada && typeof atualizada === 'object' ? atualizada : {}) }, avisos };
}

/** O XML guardado da nota de fora (erra com explicação quando não há). */
async function xmlDaNota(api, pedidoId) {
  const nota = await notaViva(api, pedidoId);
  if (!nota.xml) {
    throw erro('Esta nota de fora não tem o XML guardado. Anexe o XML na tela "NF-e e boletos de fora" para gerar a DANFE.', 409, { falta_xml: true });
  }
  return nota;
}

/** As cartas de correção vivas da nota de fora do pedido. Nunca quebra a tela. */
async function listarCartas(api, pedidoId) {
  let nota;
  try {
    nota = await notaViva(api, pedidoId);
  } catch (e) {
    if (e?.extra?.sql_pendente) return { nota: null, cartas: [], sql_pendente: true, arquivo: SQL_DOCUMENTOS };
    if (e?.status === 404) return { nota: null, cartas: [], sql_pendente: false };
    throw e;
  }
  const linhas = (await lerSePuder(api, 'notas_fiscais_externas_eventos', { nota_externa_id: Number(nota.id) }))
    .filter(c => ativo(c.ativo) && String(c.tipo || 'cce') === 'cce');
  return {
    nota: { id: nota.id, serie: nota.serie, numero: nota.numero, tem_xml: Boolean(nota.xml) },
    cartas: linhas.map(cartaParaTela).sort((a, b) => a.sequencia - b.sequencia),
    sql_pendente: false
  };
}

/**
 * Registra uma carta de correção emitida de fora.
 *
 * Duas portas, como a nota: o XML do evento (procEventoNFe, que preenche
 * tudo) ou os dados à mão (sequência, texto, protocolo e data). A opção de
 * subir XML vale SEMPRE — tendo a nota já cartas registradas ou nenhuma
 * (decisão do dono, 24/09/2026).
 */
async function informarCarta({ api, pedidoId, entrada = {}, usuarioId = null }) {
  const nota = await notaViva(api, pedidoId);
  const doXml = entrada?.xml ? lerCartaCorrecaoXml(entrada.xml) : null;
  if (doXml && digitos(doXml.chave_acesso) !== digitos(nota.chave_acesso)) {
    throw erro('Esta carta de correção é de outra nota: a chave do evento não bate com a da nota deste pedido.');
  }
  const correcao = String(doXml ? doXml.correcao : (entrada?.correcao || '')).trim();
  if (correcao.length < 15) throw erro('A correção precisa de pelo menos 15 caracteres, como a SEFAZ exige.');
  if (correcao.length > 1000) throw erro('A correção passa de 1000 caracteres.');
  const sequencia = Number(doXml ? doXml.sequencia : entrada?.sequencia) || 1;
  if (!Number.isInteger(sequencia) || sequencia < 1 || sequencia > MAXIMO_DE_CARTAS) {
    throw erro(`A sequência vai de 1 a ${MAXIMO_DE_CARTAS}.`);
  }

  const existentes = (await lerSePuder(api, 'notas_fiscais_externas_eventos', { nota_externa_id: Number(nota.id) }))
    .filter(c => ativo(c.ativo) && String(c.tipo || 'cce') === 'cce');
  if (existentes.some(c => (Number(c.sequencia) || 1) === sequencia)) {
    throw erro(`A carta de correção ${sequencia} já está registrada nesta nota. Remova-a antes de informar outra com a mesma sequência.`, 409);
  }

  const criada = await gravar(api, 'post', '/api/notas_fiscais_externas_eventos', {
    nota_externa_id: nota.id, tipo: 'cce', sequencia, correcao,
    protocolo: (doXml ? doXml.protocolo : String(entrada?.protocolo || '').trim()) || null,
    data_evento: (doXml ? doXml.data_evento : entrada?.data_evento) || null,
    origem: doXml ? 'xml' : 'manual',
    xml: doXml ? String(entrada.xml) : null,
    ativo: true, criado_por: usuarioId, criado_em: new Date().toISOString()
  });
  return { carta: cartaParaTela(criada && typeof criada === 'object' ? criada : { id: null, sequencia, correcao, origem: doXml ? 'xml' : 'manual', xml: doXml ? '1' : null }) };
}

/** Uma carta pela sequência, crua (com o XML). */
async function lerCarta(api, pedidoId, sequencia) {
  const nota = await notaViva(api, pedidoId);
  const seq = Number(sequencia);
  const achada = (await lerSePuder(api, 'notas_fiscais_externas_eventos', { nota_externa_id: Number(nota.id) }))
    .filter(c => ativo(c.ativo) && String(c.tipo || 'cce') === 'cce')
    .find(c => (Number(c.sequencia) || 1) === seq);
  if (!achada) throw erro(`Carta de correção ${seq} não encontrada nesta nota.`, 404);
  return { nota, carta: achada };
}

/** Tira uma carta de correção de fora (só desliga: fica o rastro). */
async function removerCarta({ api, pedidoId, sequencia, usuarioId = null }) {
  const { carta } = await lerCarta(api, pedidoId, sequencia);
  await gravar(api, 'put', `/api/notas_fiscais_externas_eventos/${carta.id}`, {
    ativo: false, removido_por: usuarioId, removido_em: new Date().toISOString()
  });
  return { ok: true };
}

/** Os boletos de fora vivos de um pedido. */
async function listarBoletos(api, pedidoId) {
  return (await lerSePuder(api, 'boletos_externos', { pedido_id: Number(pedidoId) })).filter(b => ativo(b.ativo));
}

/** O boleto de fora vivo de uma parcela (pelo id; nos antigos, pelo número). Pura. */
function boletoExternoDaParcela(externos, parcela) {
  return (externos || []).filter(b => b && ativo(b.ativo) && (Number(b.parcela_id) === Number(parcela?.id)
    || ((b.parcela_id === null || b.parcela_id === undefined) && Number(b.numero_parcela) === Number(parcela?.numero_parcela))))
    .sort((a, b) => Number(b.id) - Number(a.id))[0] || null;
}

/** Como o boleto de fora aparece na tela: sem o que não interessa. Pura. */
function boletoParaTela(b) {
  if (!b) return null;
  return {
    id: b.id, parcela_id: b.parcela_id ?? null, numero_parcela: b.numero_parcela ?? null,
    banco: b.banco, banco_nome: BANCOS[b.banco] || (b.banco ? `Banco ${b.banco}` : null),
    valor: b.valor === null || b.valor === undefined ? null : Number(b.valor), vencimento: dia(b.vencimento),
    linha_digitavel: b.linha_digitavel, linha_impressa: linhaImpressa(b.linha_digitavel)
  };
}

/**
 * Confere (e, sem `apenasPrevia`, grava) os boletos de fora: `linhas` é
 * `[{ parcela_id, linha }]`. Cada parcela responde por si — uma linha errada
 * não impede as outras. Parcela com boleto vivo do BB não recebe boleto de
 * fora (seria cobrar duas vezes). Informar de novo a mesma parcela troca o
 * boleto (o anterior é desligado).
 */
async function informarBoletos({ api, pedidoId, linhas = [], usuarioId = null, apenasPrevia = false, hoje, ocupadaPeloBB = () => false }) {
  const pedido = await lerPedido(api, pedidoId);
  // O boleto NÃO espera o embarque (a nota, sim): há cliente que paga
  // adiantado e recebe o boleto antes da mercadoria sair (decisão do dono,
  // 23/09/2026). Só o pedido cancelado fica de fora.
  if (pedidoCancelado(pedido)) throw erro('Pedido cancelado ou devolvido por inteiro não recebe boleto de fora.', 409);
  const [parcelas, externos] = await Promise.all([
    api.get('/api/pedido_parcelas', { query: { pedido_id: pedido.id } }).then(lista).catch(() => []),
    ler(api, 'boletos_externos', { pedido_id: pedido.id })
  ]);
  const doPedido = parcelas.filter(p => Number(p?.pedido_id) === Number(pedido.id));
  const resultados = [];
  for (const entrada of Array.isArray(linhas) ? linhas : []) {
    const parcela = doPedido.find(p => Number(p.id) === Number(entrada?.parcela_id)) || null;
    const base = { parcela_id: entrada?.parcela_id ?? null, numero_parcela: parcela?.numero_parcela ?? null };
    if (!parcela) { resultados.push({ ...base, ok: false, erro: 'Parcela não encontrada neste pedido.' }); continue; }
    if (!digitos(entrada?.linha)) continue;
    // Texto = o motivo (parcela já paga); verdadeiro = boleto do BB vivo.
    const ocupada = await ocupadaPeloBB(parcela);
    if (ocupada) { resultados.push({ ...base, ok: false, erro: typeof ocupada === 'string' ? ocupada : 'Esta parcela já tem boleto do Banco do Brasil.' }); continue; }
    let boleto;
    try {
      boleto = lerLinhaDigitavel(entrada.linha, hoje);
    } catch (e) {
      resultados.push({ ...base, ok: false, erro: e.message });
      continue;
    }
    const avisos = conferirBoleto(boleto, parcela);
    if (apenasPrevia) { resultados.push({ ...base, ok: true, boleto, avisos }); continue; }
    const anterior = boletoExternoDaParcela(externos, parcela);
    if (anterior && anterior.linha_digitavel === boleto.linha_digitavel) {
      resultados.push({ ...base, ok: true, boleto: boletoParaTela(anterior), avisos, ja_existia: true });
      continue;
    }
    const quando = new Date().toISOString();
    if (anterior) await gravar(api, 'put', `/api/boletos_externos/${anterior.id}`, { ativo: false, removido_por: usuarioId, removido_em: quando });
    const { banco_nome: _nome, ...campos } = boleto;
    const criado = await gravar(api, 'post', '/api/boletos_externos', {
      pedido_id: pedido.id, parcela_id: parcela.id, numero_parcela: parcela.numero_parcela ?? null, ...campos,
      ativo: true, criado_por: usuarioId, criado_em: quando
    });
    resultados.push({ ...base, ok: true, boleto: boletoParaTela(criado), avisos });
  }
  return { resultados };
}

/** Tira um boleto de fora (só desliga). */
async function removerBoleto({ api, id, usuarioId = null }) {
  const alvo = (await ler(api, 'boletos_externos', { id: Number(id) })).find(b => ativo(b.ativo)) || null;
  if (!alvo) throw erro('Boleto de fora não encontrado.', 404);
  await gravar(api, 'put', `/api/boletos_externos/${alvo.id}`, { ativo: false, removido_por: usuarioId, removido_em: new Date().toISOString() });
  return { ok: true, pedido_id: alvo.pedido_id };
}

module.exports = {
  SQL_ARQUIVO, SQL_DOCUMENTOS, BANCOS, MAXIMO_DE_CARTAS, TP_EVENTO_CCE,
  dvDaChave, lerChave, lerValor, notaDaEntrada, conferirNota,
  vencimentoDoFator, linhaImpressa, lerLinhaDigitavel, conferirBoleto, pedidoSaiu, pedidoCancelado,
  boletoExternoDaParcela, boletoParaTela, tabelaAusente,
  listarNotas, estadoDaNota, informarNota, removerNota, listarBoletos, informarBoletos, removerBoleto,
  lerCartaCorrecaoXml, cartaParaTela, notaParaTela, cartasPorNotaDeFora, anexarXmlDaNota, xmlDaNota, listarCartas, informarCarta, lerCarta, removerCarta
};
