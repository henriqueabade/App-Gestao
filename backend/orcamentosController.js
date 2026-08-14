const express = require('express');
const { createApiClient } = require('./apiHttpClient');
const { exigirPermissao, exigirSupAdmin } = require('./permissionsController');
const { aplicarConversaoNoEstoque } = require('./conversaoAplicar');
const { excluirOrcamentoEmCascata } = require('./exclusaoEmCascata');
const { registrarHistorico, converterProspeccaoEmCliente } = require('./prospeccoesController');

const router = express.Router();

/**
 * Id do usuário que está fazendo a requisição, lido do JWT.
 *
 * `decisao_estoque_by` existia na tabela e nunca era preenchido: a decisão de
 * usar estoque ou produzir do zero ficava sem dono. Numa ação que mexe em
 * estoque, saber QUEM decidiu não é enfeite — é o que permite auditar e
 * estornar depois.
 */
function idDoUsuarioDaRequisicao(req) {
  try {
    const bruto = String(req?.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const parte = bruto.split('.')[1];
    if (!parte) return null;
    const json = Buffer.from(parte.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(json);
    const id = payload.id ?? payload.userId ?? payload.sub ?? null;
    return Number.isFinite(Number(id)) ? Number(id) : null;
  } catch (_) {
    return null;
  }
}

// Orçamento nascido de uma prospecção usa prefixo próprio: quem olha a lista
// precisa distinguir na hora a proposta feita a um cliente da feita a quem
// ainda é só uma oportunidade.
const PREFIXO_CLIENTE = 'ORC';
const PREFIXO_PROSPECCAO = 'OCRP';

function prefixoDe(body = {}) {
  return body.prospeccao_id ? PREFIXO_PROSPECCAO : PREFIXO_CLIENTE;
}

// Descobre a maior sequência numérica já usada em "numero" (ORC1, ORC2, ...).
// Precisa varrer TODOS os registros: usar apenas o último por id.desc gera
// colisões quando os números não são monotônicos com o id (ex.: ORC2 criado
// depois de ORC3), violando a constraint única "orcamentos_numero_key".
//
// O prefixo NÃO é decorativo aqui. Contar só os dígitos, como antes, misturava
// as duas famílias: com OCRP80 no banco, o próximo orçamento de cliente viraria
// ORC81 e a sequência de cliente daria um salto de setenta números — e o mesmo
// no sentido inverso. Cada prefixo tem a sua própria contagem.
//
// A regra é assimétrica de propósito. OCRP é formato novo, então exige o
// formato exato. ORC herda tudo o que já existe no banco, inclusive números
// gravados fora do padrão ("ORC-12", "12") que a versão anterior contava —
// deixar de contá-los faria a sequência voltar para trás e colidir com a
// constraint única. Por isso o lado do cliente é "tudo que não for OCRP".
const EH_PROSPECCAO = /^OCRP\d+$/i;

async function getMaxSequencia(api, prefixo = PREFIXO_CLIENTE) {
  const lista = await api
    .get('/api/orcamentos', { query: { order: 'id.desc', limit: 5000 } })
    .catch(() => []);
  let maxSeq = 0;
  if (Array.isArray(lista)) {
    for (const orc of lista) {
      const numero = String(orc?.numero ?? '').trim();
      const daProspeccao = EH_PROSPECCAO.test(numero);
      if (daProspeccao !== (prefixo === PREFIXO_PROSPECCAO)) continue;
      const n = parseInt(numero.replace(/\D/g, ''), 10);
      if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
    }
  }
  return maxSeq;
}

// Detecta a violação de chave única do campo "numero" vinda da API upstream.
function isDuplicateNumeroError(err) {
  const partes = [
    err?.body?.detalhe,
    err?.body?.detail,
    err?.body?.message,
    err?.body?.error,
    err?.message
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return partes.includes('orcamentos_numero_key') || partes.includes('duplicate key');
}

// Cria o orçamento gerando o próximo "numero" livre. Em caso de colisão
// (concorrência ou lacunas na sequência), incrementa e tenta novamente.
async function criarOrcamentoComNumero(api, body) {
  const prefixo = prefixoDe(body);
  let sequencia = (await getMaxSequencia(api, prefixo)) + 1;
  const maxTentativas = 20;

  for (let tentativa = 0; tentativa < maxTentativas; tentativa++) {
    const numero = `${prefixo}${sequencia}`;
    try {
      const created = await api.post('/api/orcamentos', buildOrcamentoPayload(body, { numero }));
      return { created, numero };
    } catch (err) {
      // Só a colisão de número justifica insistir; qualquer outra falha sobe
      // na hora, com a mensagem original.
      //
      // O `tentativa < maxTentativas - 1` que existia aqui fazia a última
      // tentativa relançar o erro cru do upstream (500, "duplicate key"), o que
      // tornava o 409 abaixo inalcançável e devolvia ao usuário uma mensagem de
      // erro interno no lugar da explicação.
      if (isDuplicateNumeroError(err)) {
        sequencia += 1;
        continue;
      }
      throw err;
    }
  }

  const error = new Error('Não foi possível gerar um número único para o orçamento.');
  error.status = 409;
  throw error;
}

function buildOrcamentoPayload(body = {}, { numero, situacao, dataAprovacao } = {}) {
  // Vazio vindo de um <select> chega como "" — que o Postgres recusaria numa
  // coluna integer. Como agora esses campos podem legitimamente não ter valor,
  // "" precisa virar null em vez de ser repassado adiante.
  const idOuNulo = v => (v === '' || v === undefined || v === null ? null : v);

  return {
    numero,
    cliente_id: idOuNulo(body.cliente_id),
    contato_id: idOuNulo(body.contato_id),
    prospeccao_id: idOuNulo(body.prospeccao_id),
    prospeccao_contato_id: idOuNulo(body.prospeccao_contato_id),
    data_emissao: body.data_emissao || new Date().toISOString(),
    situacao: situacao || body.situacao,
    parcelas: body.parcelas,
    tipo_parcela: body.tipo_parcela,
    forma_pagamento: body.forma_pagamento,
    transportadora: body.transportadora,
    desconto_pagamento: body.desconto_pagamento,
    desconto_especial: body.desconto_especial,
    desconto_total: body.desconto_total,
    valor_final: body.valor_final,
    observacoes: body.observacoes,
    validade: body.validade,
    prazo: body.prazo,
    dono: body.dono,
    data_aprovacao: dataAprovacao
  };
}

/**
 * Próximo número livre da série de CLIENTE, para renumerar um OCRP na conversão.
 *
 * Devolve `null` quando não consegue: renumerar é acabamento, e falhar aqui não
 * pode impedir a conversão. O orçamento fica com o número OCRP, o que é
 * estranho mas não quebra nada — o vínculo com o cliente é o que importa.
 */
async function numeroDeClienteLivre(api) {
  try {
    const usados = new Set();
    const lista = await api
      .get('/api/orcamentos', { query: { order: 'id.desc', limit: 5000 } })
      .catch(() => []);
    for (const o of Array.isArray(lista) ? lista : []) {
      usados.add(String(o?.numero ?? '').trim().toUpperCase());
    }

    let sequencia = (await getMaxSequencia(api, PREFIXO_CLIENTE)) + 1;
    // Percorre até achar um livre: a sequência conta o MAIOR já usado, mas
    // números fora do padrão ("ORC-12") entram na contagem sem ocupar o lugar
    // de "ORC12", e aí o candidato poderia já existir.
    for (let i = 0; i < 50; i++) {
      const candidato = `${PREFIXO_CLIENTE}${sequencia + i}`;
      if (!usados.has(candidato.toUpperCase())) return candidato;
    }
    return null;
  } catch (err) {
    console.error('[orcamentos] não foi possível gerar o número de cliente:', err?.message || err);
    return null;
  }
}

/**
 * Anota na ficha da prospecção algo que aconteceu com um orçamento dela.
 *
 * Silencioso quando o orçamento é de cliente: prospecção nenhuma tem o que
 * registrar. Nunca derruba a operação principal — perder uma linha de histórico
 * é ruim, desfazer um orçamento já gravado por causa disso é pior.
 */
async function anotarNaProspeccao(api, req, orcamento, evento) {
  const prospeccaoId = orcamento?.prospeccao_id;
  if (!prospeccaoId) return;
  try {
    await registrarHistorico(api, prospeccaoId, evento, idDoUsuarioDaRequisicao(req));
  } catch (err) {
    console.error('[orcamentos] falha ao anotar no histórico da prospecção:', err?.message || err);
  }
}

/**
 * Fecha o negócio de um OCRP: a prospecção vira cliente e o orçamento passa a
 * ter os DOIS vínculos — `cliente_id` novo e `prospeccao_id` preservado, para
 * que a origem não se perca.
 *
 * Devolve os campos que o orçamento ganhou, para o chamador aplicar sobre a
 * cópia em memória antes de montar o pedido.
 */
async function promoverProspeccao(api, orcamento, conversao = {}) {
  // A transportadora é cadastro por cliente e não existe durante a prospecção.
  // No orçamento ela é opcional; no pedido, não — é ela que diz como a peça
  // sai da fábrica. Esta é a hora de cobrar.
  const transportadora = String(
    conversao?.transportadora ?? orcamento.transportadora ?? ''
  ).trim();
  if (!transportadora) {
    const error = new Error('Informe a transportadora para converter este orçamento em pedido.');
    error.status = 400;
    error.code = 'TRANSPORTADORA_OBRIGATORIA';
    throw error;
  }

  // `converterProspeccaoEmCliente` é idempotente: prospecção já convertida
  // devolve o cliente existente em vez de recusar. Isso importa aqui — dois
  // OCRP da mesma prospecção podem ser aprovados, e o segundo não pode falhar
  // só porque o primeiro já criou o cliente.
  const resultado = await converterProspeccaoEmCliente(api, orcamento.prospeccao_id, {
    dono_cliente: orcamento.dono,
    origem: `Orçamento ${orcamento.numero}`
  }, conversao?.decisaoBy ?? null);

  // O contato da prospecção foi copiado para `contatos_cliente` com id NOVO.
  // Sem este de-para o pedido nasceria sem contato, ou pior, apontando para o
  // contato de outro cliente que por acaso tivesse o mesmo id.
  let contatoId = null;
  if (orcamento.prospeccao_contato_id) {
    const par = (resultado.contatos || [])
      .find(c => String(c.prospeccaoContatoId) === String(orcamento.prospeccao_contato_id));
    contatoId = par?.clienteContatoId ?? null;

    // Prospecção já convertida antes: os contatos foram copiados naquela hora e
    // não vêm neste resultado. Procura pelo nome, que é o que sobrevive à cópia.
    if (!contatoId && resultado.jaExistia) {
      const [origem, destinos] = await Promise.all([
        api.get(`/api/prospeccao_contatos/${orcamento.prospeccao_contato_id}`).catch(() => null),
        api.get('/api/contatos_cliente', { query: { id_cliente: resultado.clienteId } }).catch(() => [])
      ]);
      const nome = String(origem?.nome || '').trim().toLowerCase();
      const achado = nome && (Array.isArray(destinos) ? destinos : [])
        .find(c => String(c.nome || '').trim().toLowerCase() === nome);
      contatoId = achado?.id ?? null;
    }
  }

  // Transportadora é cadastro POR CLIENTE. Sem registrá-la para o cliente que
  // acabou de nascer, ele começaria a vida com a lista vazia — e o próximo
  // orçamento para ele, onde o campo é obrigatório, não teria o que escolher.
  try {
    const jaTem = await api.get('/api/transportadoras', {
      query: { id_cliente: resultado.clienteId }
    }).catch(() => []);
    const existe = (Array.isArray(jaTem) ? jaTem : []).some(
      t => String(t.transportadora || '').trim().toLowerCase() === transportadora.toLowerCase()
    );
    if (!existe) {
      await api.post('/api/transportadoras', {
        id_cliente: resultado.clienteId,
        transportadora
      });
    }
  } catch (err) {
    // Não derruba a conversão: o pedido guarda o nome da transportadora de
    // qualquer forma, e o cadastro pode ser refeito na tela de Clientes.
    console.error('[orcamentos] não foi possível cadastrar a transportadora do novo cliente:',
      err?.message || err);
  }

  // O OCRP deixa de ser proposta de prospecção e passa a ser orçamento de um
  // cliente de verdade — então recebe a numeração de cliente. O número antigo
  // fica no histórico, para quem receber a proposta com o código OCRP ainda
  // conseguir rastrear.
  const numeroAntigo = orcamento.numero;
  const numeroNovo = await numeroDeClienteLivre(api);

  const patch = {
    cliente_id: resultado.clienteId,
    contato_id: contatoId,
    transportadora,
    ...(numeroNovo ? { numero: numeroNovo } : {})
  };
  await api.put(`/api/orcamentos/${orcamento.id}`, {
    ...orcamento,
    ...patch,
    // Preservado explicitamente: a API grava o payload inteiro, e omitir o
    // vínculo aqui apagaria a origem justamente no momento em que ela passa a
    // ser a parte mais interessante da história.
    prospeccao_id: orcamento.prospeccao_id,
    prospeccao_contato_id: orcamento.prospeccao_contato_id ?? null
  });

  if (numeroNovo) {
    await registrarHistorico(api, orcamento.prospeccao_id, {
      tipo: 'orcamento', acao: 'alterou',
      entidade: `Orçamento ${numeroAntigo}`,
      campo: 'numero',
      valor_anterior: numeroAntigo,
      valor_novo: numeroNovo,
      observacao: 'Renumerado ao virar orçamento de cliente',
      detalhe: { rotulo: 'Número', orcamento_id: orcamento.id }
    }, conversao?.decisaoBy ?? null);
  }

  await registrarHistorico(api, orcamento.prospeccao_id, {
    tipo: 'conversao',
    acao: 'converteu',
    entidade: `Orçamento ${numeroNovo || numeroAntigo}`,
    valor_anterior: 'Orçamento de prospecção',
    valor_novo: `Cliente #${resultado.clienteId}`,
    observacao: resultado.jaExistia
      ? 'Cliente já existia — o orçamento foi vinculado a ele'
      : 'Cliente criado a partir da prospecção na aprovação do orçamento',
    detalhe: {
      orcamento_id: orcamento.id,
      numero: numeroNovo || numeroAntigo,
      numeroAnterior: numeroAntigo,
      clienteId: resultado.clienteId,
      clienteJaExistia: resultado.jaExistia,
      transportadora
    }
  }, conversao?.decisaoBy ?? null);

  return patch;
}

// ---------------------------------------------------------------------------
// Conversão de orçamento em pedido.
//
// A API upstream NÃO possui o endpoint /api/orcamentos/:id/convert (retorna
// 404). A conversão é feita aqui: cria-se um registro em "pedidos" (ligado ao
// orçamento por "orcamento_id") espelhando os dados e copiam-se itens/parcelas.
// ---------------------------------------------------------------------------

// Maior sequência numérica já usada em pedidos (PED1, PED2, ...).
async function getMaxSequenciaPedido(api) {
  const lista = await api
    .get('/api/pedidos', { query: { order: 'id.desc', limit: 5000 } })
    .catch(() => []);
  let maxSeq = 0;
  if (Array.isArray(lista)) {
    for (const ped of lista) {
      const n = parseInt(String(ped?.numero ?? '').replace(/\D/g, ''), 10);
      if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
    }
  }
  return maxSeq;
}

function isDuplicatePedidoNumeroError(err) {
  const partes = [
    err?.body?.detalhe,
    err?.body?.detail,
    err?.body?.message,
    err?.body?.error,
    err?.message
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return partes.includes('pedidos_numero_key') || partes.includes('duplicate key');
}

// Colisão genérica de chave (pkey/unique) para retentar com outro id.
function isDuplicateKeyError(err) {
  const partes = [
    err?.body?.detalhe,
    err?.body?.detail,
    err?.body?.message,
    err?.body?.error,
    err?.message
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return partes.includes('duplicate key') || partes.includes('_pkey') || partes.includes('unique constraint');
}

// Maior id atual de uma tabela (as tabelas de pedido NÃO auto-geram id).
async function getMaxId(api, tabela) {
  const lista = await api
    .get(`/api/${tabela}`, { query: { order: 'id.desc', limit: 1 } })
    .catch(() => []);
  const primeiro = Array.isArray(lista) && lista.length ? lista[0] : null;
  const maxId = Number(primeiro?.id);
  return Number.isFinite(maxId) ? maxId : 0;
}

// Insere uma linha com id explícito, retentando com o próximo id em caso de
// colisão de chave primária. Retorna o id efetivamente usado.
async function inserirLinhaComId(api, tabela, payload, idInicial) {
  let id = idInicial;
  const maxTentativas = 50;
  for (let tentativa = 0; tentativa < maxTentativas; tentativa++) {
    try {
      await api.post(`/api/${tabela}`, { ...payload, id });
      return id;
    } catch (err) {
      if (isDuplicateKeyError(err) && tentativa < maxTentativas - 1) {
        id += 1;
        continue;
      }
      throw err;
    }
  }
  return id;
}

// Monta o payload do pedido espelhando os campos do orçamento. Só são incluídos
// campos que sabidamente existem na tabela "pedidos" (lidos na visualização/PDF
// do pedido), evitando erro de INSERT por coluna inexistente.
function buildPedidoPayload(orc = {}, { numero, conversao } = {}) {
  const agora = new Date().toISOString();
  const hoje = agora.slice(0, 10); // colunas do tipo "date"
  const note = conversao && typeof conversao.decisaoNote === 'string' ? conversao.decisaoNote.trim() : '';
  const decisaoBy = conversao && Number.isFinite(Number(conversao.decisaoBy)) ? Number(conversao.decisaoBy) : null;
  return {
    // pedidos.id NÃO é auto-incrementado (NOT NULL, sem default); o pedido
    // compartilha o mesmo id do orçamento de origem (relação 1:1).
    id: orc.id,
    numero,
    orcamento_id: orc.id,
    cliente_id: orc.cliente_id,
    contato_id: orc.contato_id,
    data_emissao: agora,
    data_aprovacao: hoje,
    situacao: 'Produção',
    parcelas: orc.parcelas,
    tipo_parcela: orc.tipo_parcela,
    forma_pagamento: orc.forma_pagamento,
    transportadora: orc.transportadora,
    desconto_pagamento: orc.desconto_pagamento,
    desconto_especial: orc.desconto_especial,
    desconto_total: orc.desconto_total,
    valor_final: orc.valor_final,
    observacoes: orc.observacoes,
    validade: orc.validade,
    prazo: orc.prazo,
    dono: orc.dono,
    // pode_saldo_negativo é NOT NULL; a justificativa vai na coluna correta
    // (decisao_estoque_note), e não em "observacoes".
    pode_saldo_negativo: !!(conversao && conversao.podeSaldoNegativo),
    decisao_estoque_note: note || null,
    decisao_estoque_by: decisaoBy
  };
}

// Monta o item do pedido apenas com colunas existentes em "pedidos_itens".
// qtd_a_produzir e qtd_usar_pronta são NOT NULL: usam a decisão de estoque
// vinda do modal de conversão (por produto_id) ou um padrão seguro.
function buildPedidoItemPayload(item = {}, pedidoId, decisao = {}) {
  const quantidade = Number(item.quantidade || 0);
  const usarPronta = Number.isFinite(Number(decisao.qtd_usar_pronta)) ? Number(decisao.qtd_usar_pronta) : 0;
  const aProduzir = Number.isFinite(Number(decisao.qtd_a_produzir))
    ? Number(decisao.qtd_a_produzir)
    : Math.max(0, quantidade - usarPronta);
  return {
    pedido_id: pedidoId,
    produto_id: item.produto_id,
    codigo: item.codigo,
    nome: item.nome,
    ncm: item.ncm,
    quantidade: item.quantidade,
    valor_unitario: item.valor_unitario,
    desconto_total: item.desconto_total,
    valor_total: item.valor_total,
    valor_unitario_desc: item.valor_unitario_desc,
    valor_desc: item.valor_desc,
    desconto_pagamento: item.desconto_pagamento,
    desconto_especial: item.desconto_especial,
    desconto_pagamento_prc: item.desconto_pagamento_prc,
    desconto_especial_prc: item.desconto_especial_prc,
    qtd_a_produzir: aProduzir,
    qtd_usar_pronta: usarPronta
  };
}

// Cria o pedido a partir do orçamento. Idempotente: se já houver pedido para
// o orçamento, retorna o existente em vez de duplicar. `conversao` carrega a
// decisão de estoque (nota e quantidades por produto) vinda do modal.
async function converterOrcamentoEmPedido(api, id, conversao = null) {
  const existentes = await api
    .get('/api/pedidos', { query: { orcamento_id: id } })
    .catch(() => []);
  // Confirma explicitamente o vínculo por orcamento_id — caso o filtro upstream
  // seja ignorado, evita tratar erroneamente qualquer pedido como já existente.
  const jaExiste = Array.isArray(existentes)
    ? existentes.find(ped => String(ped?.orcamento_id) === String(id))
    : null;
  if (jaExiste) {
    return { pedido: jaExiste, jaExistia: true };
  }

  const orcamento = await api.get(`/api/orcamentos/${id}`);
  if (!orcamento || orcamento.error === 'Not found') {
    const error = new Error('Orçamento não encontrado para conversão.');
    error.status = 404;
    throw error;
  }

  // Um OCRP ainda não tem cliente. É AQUI que a prospecção vira cliente: o
  // momento em que o negócio fecha de fato. Fazer isso antes obrigaria a
  // cadastrar como cliente quem ainda era só uma oportunidade.
  if (!orcamento.cliente_id) {
    if (!orcamento.prospeccao_id) {
      const error = new Error('Orçamento sem cliente não pode virar pedido.');
      error.status = 400;
      throw error;
    }
    Object.assign(orcamento, await promoverProspeccao(api, orcamento, conversao));
  }

  const [itens, parcelas] = await Promise.all([
    api.get('/api/orcamentos_itens', { query: { orcamento_id: id } }).catch(() => []),
    api.get('/api/orcamento_parcelas', { query: { orcamento_id: id, order: 'numero_parcela' } }).catch(() => [])
  ]);

  // Índice das decisões de estoque por produto_id (vindas do modal).
  const decisaoPorProduto = new Map();
  if (conversao && Array.isArray(conversao.itens)) {
    for (const it of conversao.itens) {
      const pid = Number(it?.produto_id);
      if (Number.isFinite(pid)) decisaoPorProduto.set(pid, it);
    }
  }

  // Cria o pedido com número livre, retentando em caso de colisão de "numero".
  let sequencia = (await getMaxSequenciaPedido(api)) + 1;
  const maxTentativas = 20;
  let created = null;
  let numero = null;
  for (let tentativa = 0; tentativa < maxTentativas; tentativa++) {
    numero = `PED${sequencia}`;
    try {
      created = await api.post('/api/pedidos', buildPedidoPayload(orcamento, { numero, conversao }));
      break;
    } catch (err) {
      if (isDuplicatePedidoNumeroError(err) && tentativa < maxTentativas - 1) {
        sequencia += 1;
        continue;
      }
      throw err;
    }
  }
  const pedidoId = created?.id || created?.data?.id || created?.[0]?.id || orcamento.id;

  // pedidos_itens.id e pedido_parcelas.id também são NOT NULL sem auto-incremento:
  // geramos ids sequenciais a partir do maior id existente, com retentativa.
  let proximoItemId = (await getMaxId(api, 'pedidos_itens')) + 1;
  // Guardamos o id de cada peça criada: sem ele não há como dizer "falta X para
  // a peça Y" nem de qual lote a peça pronta saiu.
  const pecasCriadas = [];
  for (const item of Array.isArray(itens) ? itens : []) {
    const decisao = decisaoPorProduto.get(Number(item?.produto_id)) || {};
    const payloadItem = buildPedidoItemPayload(item, pedidoId, decisao);
    const usado = await inserirLinhaComId(api, 'pedidos_itens', payloadItem, proximoItemId);
    pecasCriadas.push({
      pedido_item_id: usado,
      produto_id: item?.produto_id,
      quantidade: payloadItem.quantidade,
      qtd_usar_pronta: payloadItem.qtd_usar_pronta,
      qtd_a_produzir: payloadItem.qtd_a_produzir,
      // `parciais` NÃO vira coluna de pedidos_itens (a tabela não tem esse
      // campo): ela só atravessa até o abatimento, para o estoque saber quais
      // lotes pela metade foram comprometidos com este pedido.
      parciais: Array.isArray(decisao?.parciais) ? decisao.parciais : [],
      qtd_produzir_parcial: Number(decisao?.qtd_produzir_parcial) || 0,
      // Diferencia "a revisão disse produzir do zero" de "não houve revisão".
      // Sem isso o abatimento não teria como respeitar a escolha do usuário
      // sem, ao mesmo tempo, deixar a conversão sem revisão tratando lote
      // parcial como inexistente.
      decisaoInformada: decisaoPorProduto.has(Number(item?.produto_id)),
      forcarProduzirDoZero: decisao?.forcarProduzirDoZero === true
    });
    proximoItemId = usado + 1;
  }

  const listaParcelas = Array.isArray(parcelas) ? parcelas : [];
  let proximoParcelaId = (await getMaxId(api, 'pedido_parcelas')) + 1;
  for (let i = 0; i < listaParcelas.length; i++) {
    const { id: _pId, orcamento_id: _pOid, ...rest } = listaParcelas[i] || {};
    const usado = await inserirLinhaComId(
      api,
      'pedido_parcelas',
      { ...rest, pedido_id: pedidoId, numero_parcela: rest.numero_parcela || i + 1 },
      proximoParcelaId
    );
    proximoParcelaId = usado + 1;
  }

  // ------------------------------------------------------------------
  // Estoque: registra o que faltava e abate o que foi decidido.
  //
  // Depois das parcelas, e sem poder derrubar a conversão: o pedido já existe
  // neste ponto. Um erro aqui volta como aviso para a interface mostrar, em vez
  // de fazer o usuário achar que a conversão inteira falhou.
  // ------------------------------------------------------------------
  let estoque = null;
  try {
    estoque = await aplicarConversaoNoEstoque(api, {
      pedidoId,
      itens: pecasCriadas,
      usuarioId: conversao && Number.isFinite(Number(conversao.decisaoBy))
        ? Number(conversao.decisaoBy)
        : null,
      podeSaldoNegativo: conversao?.podeSaldoNegativo === true,
      decisaoNote: typeof conversao?.decisaoNote === 'string' && conversao.decisaoNote.trim()
        ? conversao.decisaoNote.trim()
        : null,
      inserirLinhaComId,
      getMaxId
    });
  } catch (err) {
    console.error('Falha ao aplicar a decisão de estoque da conversão:', err);
    estoque = { avisos: [`Falha ao aplicar a decisão de estoque: ${err?.message || err}`] };
  }

  return { pedido: { id: pedidoId, numero }, jaExistia: false, estoque };
}

router.get('/', exigirPermissao('orc.view'), async (req, res) => {
  const { clienteId, prospeccaoId } = req.query;
  try {
    const api = createApiClient(req);
    // Os filtros são exclusivos: um orçamento de prospecção ainda não tem
    // cliente, então combinar os dois devolveria vazio sempre.
    let query = { order: 'id.desc' };
    if (prospeccaoId) query = { prospeccao_id: prospeccaoId, order: 'id.desc' };
    else if (clienteId) query = { cliente_id: clienteId, order: 'id.desc' };

    const orcamentos = await api.get('/api/orcamentos', { query });
    res.json(Array.isArray(orcamentos) ? orcamentos : []);
  } catch (err) {
    console.error('Erro ao listar orçamentos:', err);
    res.status(err.status || 500).json({ error: 'Erro ao listar orçamentos' });
  }
});

router.get('/:id', exigirPermissao('orc.view.details'), async (req, res) => {
  const { id } = req.params;
  try {
    const api = createApiClient(req);
    const orcamento = await api.get(`/api/orcamentos/${id}`);
    if (!orcamento || orcamento.error === 'Not found') {
      return res.status(404).json({ error: 'Orçamento não encontrado' });
    }
    const [itens, parcelas] = await Promise.all([
      api.get('/api/orcamentos_itens', { query: { orcamento_id: id } }).catch(() => []),
      api
        .get('/api/orcamento_parcelas', { query: { orcamento_id: id, order: 'numero_parcela' } })
        .catch(() => [])
    ]);
    res.json({
      ...orcamento,
      itens: Array.isArray(itens) ? itens : [],
      parcelas_detalhes: Array.isArray(parcelas) ? parcelas : []
    });
  } catch (err) {
    console.error('Erro ao buscar orçamento:', err);
    res.status(err.status || 500).json({ error: 'Erro ao buscar orçamento' });
  }
});

router.post('/', exigirPermissao('orc.create'), async (req, res) => {
  const body = req.body || {};
  const itens = Array.isArray(body.itens) ? body.itens : [];
  const parcelasDetalhes = Array.isArray(body.parcelas_detalhes) ? body.parcelas_detalhes : [];

  // Sem dono, o orçamento não apareceria nem na ficha do cliente nem na da
  // prospecção: existiria no banco e em lugar nenhum na tela.
  const temCliente = body.cliente_id !== '' && body.cliente_id != null;
  const temProspeccao = body.prospeccao_id !== '' && body.prospeccao_id != null;
  if (!temCliente && !temProspeccao) {
    return res.status(400).json({ error: 'Informe o cliente ou a prospecção do orçamento' });
  }

  try {
    const api = createApiClient(req);

    // Prospecção precisa existir: FK inválida só estouraria depois de já ter
    // gravado itens e parcelas, deixando lixo pela metade.
    let prospeccao = null;
    if (temProspeccao) {
      prospeccao = await api.get(`/api/prospeccoes/${body.prospeccao_id}`).catch(() => null);
      if (!prospeccao?.id) {
        return res.status(400).json({ error: 'Prospecção não encontrada' });
      }
    }

    const { created, numero } = await criarOrcamentoComNumero(api, body);
    const orcamentoId = created?.id || created?.data?.id || created?.[0]?.id;

    for (const item of itens) {
      await api.post('/api/orcamentos_itens', { ...item, orcamento_id: orcamentoId });
    }

    for (let i = 0; i < parcelasDetalhes.length; i++) {
      const parcela = parcelasDetalhes[i];
      await api.post('/api/orcamento_parcelas', {
        ...parcela,
        orcamento_id: orcamentoId,
        numero_parcela: parcela.numero_parcela || i + 1
      });
    }

    if (temProspeccao) {
      // Depois de itens e parcelas: o histórico anuncia um orçamento pronto,
      // não um esqueleto que ainda pode falhar no meio.
      await registrarHistorico(api, body.prospeccao_id, {
        tipo: 'orcamento',
        acao: 'criou',
        entidade: `Orçamento ${numero}`,
        valor_novo: numero,
        detalhe: {
          orcamento_id: orcamentoId,
          situacao: body.situacao || null,
          valor_final: body.valor_final ?? null,
          itens: itens.length
        }
      }, idDoUsuarioDaRequisicao(req));
    }

    res.json({ success: true, id: orcamentoId, numero });
  } catch (err) {
    console.error('Erro ao salvar orçamento:', err);
    res.status(err.status || 500).json({ error: 'Erro ao salvar orçamento' });
  }
});

// Estas duas rotas fazem MAIS do que o nome sugere: quando a situacao vira
// "Aprovado", elas tambem convertem o orcamento em pedido (e o pedido abate
// estoque). Guardar so com `orc.edit` ou so com `orc.convert` deixava dois
// furos: quem podia editar disparava a conversao sem ter permissao para isso, e
// quem tinha `orc.convert` mudava qualquer status (Rejeitado, Expirado) sem ter
// `orc.status.change`. Agora cada rota pede exatamente o que vai executar.
function permissoesDeStatus(req) {
  const chaves = ['orc.status.change'];
  if (String(req.body?.situacao || '').trim() === 'Aprovado') chaves.push('orc.convert');
  return chaves;
}

function permissoesDeEdicao(req) {
  const chaves = ['orc.edit'];
  if (String(req.body?.situacao || '').trim() === 'Aprovado') chaves.push('orc.convert');
  return chaves;
}

router.put('/:id', exigirPermissao(permissoesDeEdicao), async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  const itens = Array.isArray(body.itens) ? body.itens : [];
  const parcelasDetalhes = Array.isArray(body.parcelas_detalhes) ? body.parcelas_detalhes : [];

  try {
    const api = createApiClient(req);
    const situacoesComData = ['Aprovado', 'Rejeitado', 'Expirado'];
    const dataAprovacaoValor = situacoesComData.includes(body.situacao)
      ? new Date().toISOString()
      : null;

    const atual = await api.get(`/api/orcamentos/${id}`).catch(() => null);

    const payload = buildOrcamentoPayload(body, {
      situacao: body.situacao,
      dataAprovacao: dataAprovacaoValor
    });

    // O modal de edição não conhece o vínculo com a prospecção e não o envia.
    // Sem esta linha, toda edição de um OCRP gravaria prospeccao_id = null: o
    // orçamento sumiria da ficha da prospecção e viraria órfão, sem cliente e
    // sem origem. Só sobrescreve quando o vínculo vem explicitamente no corpo.
    for (const campo of ['prospeccao_id', 'prospeccao_contato_id', 'cliente_id', 'contato_id']) {
      if (!Object.prototype.hasOwnProperty.call(body, campo)) payload[campo] = atual?.[campo] ?? null;
    }

    await api.put(`/api/orcamentos/${id}`, payload);

    const itensExistentes = await api.get('/api/orcamentos_itens', { query: { orcamento_id: id } }).catch(() => []);
    if (Array.isArray(itensExistentes)) {
      for (const item of itensExistentes) {
        if (item?.id) {
          await api.delete(`/api/orcamentos_itens/${item.id}`);
        }
      }
    }
    for (const item of itens) {
      await api.post('/api/orcamentos_itens', { ...item, orcamento_id: id });
    }

    const parcelasExistentes = await api
      .get('/api/orcamento_parcelas', { query: { orcamento_id: id } })
      .catch(() => []);
    if (Array.isArray(parcelasExistentes)) {
      for (const parcela of parcelasExistentes) {
        if (parcela?.id) {
          await api.delete(`/api/orcamento_parcelas/${parcela.id}`);
        }
      }
    }

    for (let i = 0; i < parcelasDetalhes.length; i++) {
      const parcela = parcelasDetalhes[i];
      await api.post('/api/orcamento_parcelas', {
        ...parcela,
        orcamento_id: id,
        numero_parcela: parcela.numero_parcela || i + 1
      });
    }

    await anotarNaProspeccao(api, req, { prospeccao_id: payload.prospeccao_id }, {
      tipo: 'orcamento',
      acao: 'editou',
      entidade: `Orçamento ${atual?.numero || id}`,
      campo: 'situacao',
      valor_anterior: atual?.situacao ?? null,
      valor_novo: body.situacao ?? atual?.situacao ?? null,
      detalhe: {
        orcamento_id: Number(id),
        valor_final_anterior: atual?.valor_final ?? null,
        valor_final: body.valor_final ?? null,
        itens: itens.length
      }
    });

    let convertido = false;
    let convertErro = null;
    let pedido = null;
    let estoqueResumo = null;
    if (body.situacao === 'Aprovado') {
      try {
        const resultado = await converterOrcamentoEmPedido(api, id, {
          ...(body.conversao || {}),
          decisaoBy: idDoUsuarioDaRequisicao(req)
        });
        pedido = resultado.pedido;
        estoqueResumo = resultado.estoque || null;
        convertido = true;
      } catch (convErr) {
        convertErro = convErr?.body?.detalhe || convErr?.body?.error || convErr?.message || 'Falha ao converter em pedido';
        console.error('Erro ao converter orçamento em pedido:', convErr);
      }
    }

    // `numero` volta porque a conversão de um OCRP RENUMERA o orçamento: sem
    // isto o aviso de sucesso citaria o código antigo, que já não existe.
    const depois = await api.get(`/api/orcamentos/${id}`).catch(() => null);
    res.json({
      success: true, convertido, convertErro, pedido, estoque: estoqueResumo,
      numero: depois?.numero ?? null
    });
  } catch (err) {
    console.error('Erro ao atualizar orçamento:', err);
    res.status(err.status || 500).json({ error: 'Erro ao atualizar orçamento' });
  }
});

router.patch('/:id/status', exigirPermissao(permissoesDeStatus), async (req, res) => {
  const { id } = req.params;
  const { situacao } = req.body;
  try {
    const api = createApiClient(req);
    const situacoesComData = ['Aprovado', 'Rejeitado', 'Expirado'];
    const payload = {
      situacao,
      data_aprovacao: situacoesComData.includes(situacao) ? new Date().toISOString() : null
    };
    const antes = await api.get(`/api/orcamentos/${id}`).catch(() => null);
    await api.put(`/api/orcamentos/${id}`, payload);

    await anotarNaProspeccao(api, req, antes, {
      tipo: 'orcamento',
      acao: 'editou',
      entidade: `Orçamento ${antes?.numero || id}`,
      campo: 'situacao',
      valor_anterior: antes?.situacao ?? null,
      valor_novo: situacao ?? null,
      detalhe: { orcamento_id: Number(id) }
    });

    let convertido = false;
    let convertErro = null;
    let pedido = null;
    let estoqueResumo = null;
    if (situacao === 'Aprovado') {
      try {
        // A conversão em lote (botão "Converter Orçamento", em Pedidos) chega
        // por aqui. Ela não passa pela revisão peça a peça, então a decisão de
        // estoque vem no corpo quando existir; o dono da decisão é sempre
        // registrado, para que o pedido saiba QUEM converteu.
        const resultado = await converterOrcamentoEmPedido(api, id, {
          ...(req.body?.conversao || {}),
          decisaoBy: idDoUsuarioDaRequisicao(req)
        });
        pedido = resultado.pedido;
        estoqueResumo = resultado.estoque || null;
        convertido = true;
      } catch (convErr) {
        convertErro = convErr?.body?.detalhe || convErr?.body?.error || convErr?.message || 'Falha ao converter em pedido';
        console.error('Erro ao converter orçamento em pedido:', convErr);
      }
    }
    // `numero` volta porque a conversão de um OCRP RENUMERA o orçamento: sem
    // isto o aviso de sucesso citaria o código antigo, que já não existe.
    const depois = await api.get(`/api/orcamentos/${id}`).catch(() => null);
    res.json({
      success: true, convertido, convertErro, pedido, estoque: estoqueResumo,
      numero: depois?.numero ?? null
    });
  } catch (err) {
    console.error('Erro ao atualizar status do orçamento:', err);
    res.status(err.status || 500).json({ error: 'Erro ao atualizar status do orçamento' });
  }
});

router.post('/:id/clone', exigirPermissao(['orc.clone', 'orc.create']), async (req, res) => {
  const { id } = req.params;
  try {
    const api = createApiClient(req);
    const orcamento = await api.get(`/api/orcamentos/${id}`);
    if (!orcamento || orcamento.error === 'Not found') {
      return res.status(404).json({ error: 'Orçamento não encontrado' });
    }
    const [itens, parcelas] = await Promise.all([
      api.get('/api/orcamentos_itens', { query: { orcamento_id: id } }).catch(() => []),
      api.get('/api/orcamento_parcelas', { query: { orcamento_id: id } }).catch(() => [])
    ]);

    const { created, numero } = await criarOrcamentoComNumero(api, {
      ...orcamento,
      situacao: 'Rascunho',
      data_aprovacao: null
    });
    const novoId = created?.id || created?.data?.id || created?.[0]?.id;

    for (const item of Array.isArray(itens) ? itens : []) {
      await api.post('/api/orcamentos_itens', { ...item, orcamento_id: novoId, id: undefined });
    }
    for (let i = 0; i < (Array.isArray(parcelas) ? parcelas.length : 0); i++) {
      const parcela = parcelas[i];
      await api.post('/api/orcamento_parcelas', {
        ...parcela,
        orcamento_id: novoId,
        id: undefined,
        numero_parcela: parcela.numero_parcela || i + 1
      });
    }

    await anotarNaProspeccao(api, req, orcamento, {
      tipo: 'orcamento',
      acao: 'criou',
      entidade: `Orçamento ${numero}`,
      valor_anterior: orcamento.numero || null,
      valor_novo: numero,
      observacao: `Cópia do orçamento ${orcamento.numero || id}`,
      detalhe: { orcamento_id: novoId, copia_de: Number(id), situacao: 'Rascunho' }
    });

    res.json({ success: true, id: novoId, numero });
  } catch (err) {
    console.error('Erro ao clonar orçamento:', err);
    res.status(err.status || 500).json({ error: 'Erro ao clonar orçamento' });
  }
});

/**
 * DELETE /orcamentos/:id  — exclusão restrita (ação visível só ao Sup Admin).
 * Remove itens e parcelas antes do orçamento, para não deixar órfãos.
 */
/**
 * DELETE /orcamentos/:id — exclusão restrita ao Sup Admin.
 *
 * Mesma cascata do pedido, com a mesma lista branca. Duas travas: a permissão
 * `orc.delete` e a checagem do perfil.
 */
router.delete('/:id', exigirPermissao('orc.delete'), exigirSupAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const api = createApiClient(req);

    // Lido ANTES da cascata: depois de excluído não há de onde tirar número,
    // valor nem o vínculo com a prospecção. O orçamento some da lista, mas o
    // histórico continua sabendo o que ele era.
    const antes = await api.get(`/api/orcamentos/${id}`).catch(() => null);

    const { removidos, avisos } = await excluirOrcamentoEmCascata(api, id);

    await anotarNaProspeccao(api, req, antes, {
      tipo: 'orcamento',
      acao: 'excluiu',
      entidade: `Orçamento ${antes?.numero || id}`,
      valor_anterior: antes?.numero || null,
      detalhe: {
        orcamento_id: Number(id),
        situacao: antes?.situacao ?? null,
        valor_final: antes?.valor_final ?? null,
        data_emissao: antes?.data_emissao ?? null
      }
    });

    res.json({ success: true, removidos, avisos });
  } catch (err) {
    console.error('Erro ao excluir orçamento:', err);
    res.status(err.status || 500).json({
      error: 'Erro ao excluir orçamento',
      detalhe: err?.body?.detalhe || err?.message || null
    });
  }
});

module.exports = router;
