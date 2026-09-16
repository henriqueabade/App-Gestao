/**
 * O que falta para faturar um pedido (emitir a NF-e).
 *
 * Função pura sobre as linhas cruas: pedido, itens, parcelas, cliente, peças,
 * configuração fiscal, certificado (resumo) e as notas já existentes do
 * pedido. Devolve a lista de pendências com ORIGEM (emitente, certificado,
 * cliente, peça, pedido), porque a correção de cada uma fica numa tela
 * diferente — e a tela de emissão lista isso em vez de a SEFAZ rejeitar.
 *
 * `automatico: true` marca o que a emissão consegue resolver sozinha (o código
 * IBGE pelo nome da cidade); o resto bloqueia até alguém corrigir o cadastro.
 */
const { siglaDaUf } = require('./municipios');
const { codigoPagamento } = require('./xmlNfe');

const STATUS_QUE_BLOQUEIAM = new Set(['enviando', 'processando', 'autorizada', 'cancelamento_pendente']);
const TOLERANCIA_PARCELAS = 0.02;

const digitos = v => String(v ?? '').replace(/\D/g, '');
const vazio = v => v === null || v === undefined || String(v).trim() === '';
// Aceita "1.500,00" (digitado no app) e "750.00" (numeric do Postgres chega
// como texto com ponto): só há separador de milhar quando há vírgula.
const numero = v => {
  if (v === null || v === undefined || v === '') return NaN;
  if (typeof v !== 'string') return Number(v);
  const t = v.trim();
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
};

function avaliar({
  pedido, itens = [], parcelas = [], cliente = null, produtos = [], configuracao = null,
  certificado = null, notas = []
} = {}) {
  const pendencias = [];
  const add = (origem, chave, mensagem, extra = {}) => pendencias.push({ origem, chave, mensagem, ...extra });

  // ------------------------------------------------------------- emitente
  if (!configuracao) {
    add('emitente', 'configuracao', 'Configuração fiscal não cadastrada (rode sql/notas_fiscais_base.sql).');
  } else {
    for (const campo of ['cnpj', 'razao_social', 'inscricao_estadual', 'logradouro', 'numero', 'bairro', 'codigo_municipio', 'municipio', 'uf', 'cep', 'natureza_operacao', 'cfop_dentro_uf', 'cfop_fora_uf', 'csosn', 'unidade_padrao']) {
      if (vazio(configuracao[campo])) add('emitente', campo, `Configuração fiscal sem ${campo.replace(/_/g, ' ')}.`);
    }
  }
  const ufEmitente = siglaDaUf(configuracao?.uf) || null;

  // ---------------------------------------------------------- certificado
  if (!certificado || !certificado.configurado) {
    add('certificado', 'ausente', certificado?.erro || 'Certificado digital não configurado neste computador.');
  } else {
    if (certificado.vencido) add('certificado', 'vencido', 'O certificado digital está vencido.');
    if (certificado.confereComEmitente === false) add('certificado', 'cnpj', 'O certificado é de outro CNPJ, não do emitente.');
  }

  // --------------------------------------------------------------- pedido
  if (!pedido) {
    add('pedido', 'inexistente', 'Pedido não encontrado.');
    return fechar(pendencias, null);
  }
  const situacao = String(pedido.situacao || '').trim().toLowerCase();
  if (situacao === 'cancelado') add('pedido', 'situacao', 'Pedido cancelado não pode ser faturado.');

  const valorFinal = numero(pedido.valor_final);
  if (!(valorFinal > 0)) add('pedido', 'valor_final', 'O pedido está sem valor final.');

  const notaViva = (notas || []).find(n => STATUS_QUE_BLOQUEIAM.has(String(n?.status_fiscal || '').toLowerCase()));
  if (notaViva) {
    add('pedido', 'nota_existente', `Já existe a NF-e ${notaViva.numero ? `nº ${notaViva.numero} ` : ''}(${notaViva.status_fiscal}) para este pedido.`, { nota: notaViva.id });
  }

  if (!itens.length) add('pedido', 'itens', 'O pedido não tem itens.');

  const somaParcelas = (parcelas || []).reduce((s, p) => s + (numero(p?.valor) || 0), 0);
  if (!parcelas.length) {
    add('pedido', 'parcelas', 'O pedido não tem parcelas (duplicatas da NF-e).');
  } else if (valorFinal > 0 && Math.abs(somaParcelas - valorFinal) > TOLERANCIA_PARCELAS) {
    add('pedido', 'parcelas', `As parcelas somam ${somaParcelas.toFixed(2)} e o pedido vale ${valorFinal.toFixed(2)}.`);
  }
  for (const p of parcelas || []) {
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(p?.data_vencimento || ''))) add('pedido', 'parcelas', `Parcela ${p?.numero_parcela ?? '?'} sem data de vencimento.`);
  }

  // -------------------------------------------------------------- cliente
  let ufDestino = null;
  let nomeCliente = null;
  if (!cliente) {
    add('cliente', 'inexistente', 'Pedido sem cliente cadastrado.');
  } else {
    nomeCliente = cliente.razao_social || cliente.nome_fantasia || null;
    const pf = String(cliente.tipo_pessoa || 'PJ').toUpperCase() === 'PF';
    if (vazio(cliente.razao_social) && vazio(cliente.nome_fantasia)) add('cliente', 'nome', 'Cliente sem razão social.');
    if (pf) {
      if (digitos(cliente.cpf).length !== 11) add('cliente', 'cpf', 'Cliente pessoa física sem CPF válido (11 dígitos).');
    } else if (digitos(cliente.cnpj).length !== 14) {
      add('cliente', 'cnpj', 'Cliente sem CNPJ válido (14 dígitos).');
    }
    const indicador = Number(cliente.indicador_ie ?? 9);
    const ie = digitos(cliente.inscricao_estadual);
    if (indicador === 1 && (ie.length < 2 || ie.length > 14)) add('cliente', 'inscricao_estadual', 'Cliente marcado como contribuinte, mas sem inscrição estadual válida.');
    if (indicador !== 1 && ie.length >= 2 && !pf) add('cliente', 'indicador_ie', 'Cliente tem inscrição estadual, mas não está marcado como contribuinte (indicador de IE).');

    for (const [campo, rotulo] of [['reg_logradouro', 'rua'], ['reg_numero', 'número'], ['reg_bairro', 'bairro'], ['reg_cidade', 'cidade'], ['reg_uf', 'estado']]) {
      if (vazio(cliente[campo])) add('cliente', campo, `Endereço de registro do cliente sem ${rotulo}.`);
    }
    if (digitos(cliente.reg_cep).length !== 8) add('cliente', 'reg_cep', 'Endereço de registro do cliente sem CEP válido (8 dígitos).');
    ufDestino = siglaDaUf(cliente.reg_uf);
    if (!vazio(cliente.reg_uf) && !ufDestino) add('cliente', 'reg_uf', `Estado do cliente não reconhecido: ${cliente.reg_uf}.`);
    if (digitos(cliente.reg_codigo_municipio).length !== 7) {
      add('cliente', 'reg_codigo_municipio',
        `Código IBGE de ${cliente.reg_cidade || 'cidade'}/${ufDestino || '??'} não informado — a emissão tenta buscar pelo nome.`,
        { automatico: true });
    }
  }

  // ---------------------------------------------------------------- peças
  const porId = new Map((produtos || []).filter(Boolean).map(p => [String(p.id), p]));
  const dentroDoEstado = ufEmitente && ufDestino ? ufEmitente === ufDestino : null;
  const itensAvaliados = [];
  for (const item of itens) {
    const produto = porId.get(String(item?.produto_id)) || null;
    const rotulo = item?.codigo || produto?.codigo || `item ${item?.id ?? '?'}`;
    const ncm = digitos(item?.ncm || produto?.ncm);
    if (ncm.length !== 8) add('peca', 'ncm', `Peça ${rotulo} sem NCM de 8 dígitos.`, { produto_id: item?.produto_id });
    const quantidade = numero(item?.quantidade);
    if (!(quantidade > 0)) add('pedido', 'quantidade', `Item ${rotulo} com quantidade zero.`);
    const valorTotal = numero(item?.valor_total);
    if (!(valorTotal >= 0)) add('pedido', 'valor_total', `Item ${rotulo} sem valor total.`);
    const unidade = produto?.unidade_comercial || configuracao?.unidade_padrao || null;
    if (vazio(unidade)) add('peca', 'unidade', `Peça ${rotulo} sem unidade comercial (e a configuração está sem unidade padrão).`, { produto_id: item?.produto_id });
    const origem = Number(produto?.origem_mercadoria ?? 0);
    if (!(Number.isInteger(origem) && origem >= 0 && origem <= 8)) add('peca', 'origem', `Peça ${rotulo} com origem da mercadoria inválida.`, { produto_id: item?.produto_id });

    const cfop = dentroDoEstado === false
      ? (produto?.cfop_fora_uf || configuracao?.cfop_fora_uf)
      : (produto?.cfop_dentro_uf || configuracao?.cfop_dentro_uf);
    if (digitos(cfop).length !== 4) add('peca', 'cfop', `Peça ${rotulo} sem CFOP válido para esta operação.`, { produto_id: item?.produto_id });
    const csosn = produto?.csosn || configuracao?.csosn;
    if (digitos(csosn).length !== 3) add('peca', 'csosn', `Peça ${rotulo} sem CSOSN válido.`, { produto_id: item?.produto_id });
    if (produto?.cest && digitos(produto.cest).length !== 7) add('peca', 'cest', `Peça ${rotulo} com CEST inválido (7 dígitos).`, { produto_id: item?.produto_id });

    itensAvaliados.push({
      produto_id: item?.produto_id, codigo: rotulo, descricao: item?.nome || produto?.nome || null,
      ncm: ncm || null, cfop: digitos(cfop) || null, csosn: digitos(csosn) || null, unidade, origem,
      quantidade: Number.isFinite(quantidade) ? quantidade : null, valor_total: Number.isFinite(valorTotal) ? valorTotal : null
    });
  }

  return fechar(pendencias, {
    pedido: pedido.numero || pedido.id,
    pedidoId: pedido.id,
    situacao: pedido.situacao || null,
    cliente: nomeCliente,
    documentoCliente: cliente ? (String(cliente.tipo_pessoa || 'PJ').toUpperCase() === 'PF' ? digitos(cliente.cpf) : digitos(cliente.cnpj)) || null : null,
    cidadeCliente: cliente?.reg_cidade || null,
    ufEmitente,
    ufDestino,
    dentroDoEstado,
    valorFinal: Number.isFinite(valorFinal) ? valorFinal : null,
    somaParcelas: Math.round(somaParcelas * 100) / 100,
    parcelas: parcelas.length,
    itens: itensAvaliados,
    // O que a tela de embarque preenche: começa com o que o pedido já tem.
    formaPagamento: pedido.forma_pagamento || null,
    tPagSugerido: codigoPagamento(pedido.forma_pagamento),
    frete: {
      modalidade: pedido.modalidade_frete ?? configuracao?.modalidade_frete_padrao ?? 9,
      transportadora: pedido.transportadora || null,
      volumes_quantidade: pedido.volumes_quantidade ?? null,
      volumes_especie: pedido.volumes_especie ?? null,
      peso_bruto: pedido.peso_bruto ?? null,
      peso_liquido: pedido.peso_liquido ?? null
    }
  });
}

function fechar(pendencias, resumo) {
  const bloqueiam = pendencias.filter(p => !p.automatico);
  return {
    pronto: bloqueiam.length === 0,
    pendencias,
    bloqueiam: bloqueiam.length,
    automaticas: pendencias.length - bloqueiam.length,
    resumo
  };
}

module.exports = { avaliar, STATUS_QUE_BLOQUEIAM, TOLERANCIA_PARCELAS };
