const express = require('express');
const db = require('./db');
const { obterMovimentacoesRecentes } = require('./materiaPrima');

const router = express.Router();

// Thresholds below centralise business rules so alerts stay consistent between
// the application and its unit tests.
const CRITICAL_STOCK_THRESHOLD = 10; // estoque crítico quando menor que este valor
const MOVEMENT_ALERT_WINDOW_DAYS = 2; // entradas/saídas manuais relevantes nos últimos X dias
const PRICE_CHANGE_ALERT_WINDOW_DAYS = 7; // alterações de preço recentes
const PRODUCTION_STUCK_DAYS = 5; // pedido em produção por mais de X dias
const SHIPPING_STUCK_DAYS = 3; // pedido enviado há mais de X dias sem entrega
const BUDGET_EXPIRY_WARNING_DAYS = 5; // orçamentos que expiram em até X dias
const APPROVED_WITHOUT_ORDER_DAYS = 2; // aprovado há X dias sem virar pedido
const INACTIVE_USER_DAYS = 30; // usuários sem atividade recente
const OPEN_SESSION_MAX_HOURS = 8; // sessões abertas há mais de X horas

// Status de CRM considerados "ativos" para cobrança de dono/contato
const CRM_ACTIVE_STATUSES = ['ativo', 'negociação', 'prospect', 'cliente', 'lead'];
// Status de produto que representam item fora de linha
const PRODUCT_OFFLINE_STATUSES = ['inativo', 'descontinuado', 'offline'];

const CATEGORY = {
  system: 'system',
  tasks: 'tasks',
  sales: 'sales',
  finance: 'finance'
};

function daysAgo(days) {
  const now = new Date();
  now.setDate(now.getDate() - days);
  return now;
}

function daysFromNow(days) {
  const now = new Date();
  now.setDate(now.getDate() + days);
  return now;
}

function hoursAgo(hours) {
  const now = new Date();
  now.setHours(now.getHours() - hours);
  return now;
}

async function safeQuery(sql, params = []) {
  try {
    return await db.query(sql, params);
  } catch (err) {
    if (err && err.code === '42P01') {
      // tabela ausente -> sem notificações
      return { rows: [] };
    }
    console.error('Falha ao executar consulta para notificações:', err);
    return { rows: [] };
  }
}

const columnExistenceCache = new Map();

async function hasColumn(tableName, columnName) {
  const key = `${tableName}.${columnName}`;
  if (columnExistenceCache.has(key)) {
    return columnExistenceCache.get(key);
  }

  const { rows } = await safeQuery(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = $1
        AND column_name = $2
      LIMIT 1`,
    [tableName, columnName]
  );

  const exists = rows.length > 0;
  columnExistenceCache.set(key, exists);
  return exists;
}

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function diffInDays(from, to = new Date()) {
  if (!from) return null;
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function formatCurrency(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return null;
  }
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value));
}

async function getStockNotifications() {
  const { rows } = await safeQuery(
    `SELECT id, nome, quantidade, unidade, data_estoque
       FROM materia_prima`
  );
  const items = [];
  for (const row of rows) {
    const quantidade = Number(row.quantidade) || 0;
    const baseDate = toDate(row.data_estoque) || new Date();
    if (quantidade <= 0) {
      items.push({
        id: `stock-zero-${row.id}`,
        category: CATEGORY.system,
        message: `Insumo ${row.nome} está sem estoque`,
        date: baseDate.toISOString(),
        metadata: {
          insumoId: row.id,
          quantidade,
          unidade: row.unidade || null,
          tipo: 'zero'
        }
      });
      continue;
    }
    if (quantidade < CRITICAL_STOCK_THRESHOLD) {
      items.push({
        id: `stock-critical-${row.id}`,
        category: CATEGORY.system,
        message: `Insumo ${row.nome} está com estoque crítico (${quantidade})`,
        date: baseDate.toISOString(),
        metadata: {
          insumoId: row.id,
          quantidade,
          unidade: row.unidade || null,
          tipo: 'critical',
          limite: CRITICAL_STOCK_THRESHOLD
        }
      });
    }
  }
  // garante ordenação consistente mesmo sem data
  return items.length ? items : [];
}

async function getManualMovementNotifications() {
  const since = daysAgo(MOVEMENT_ALERT_WINDOW_DAYS);
  const movimentos = await obterMovimentacoesRecentes({ tipos: ['entrada', 'saida'], desde: since });
  if (!movimentos.length) return [];

  const insumoIds = [...new Set(movimentos.map(m => m.insumo_id).filter(Boolean))];
  const { rows: insumos } = insumoIds.length
    ? await safeQuery(
        'SELECT id, nome, unidade FROM materia_prima WHERE id = ANY($1::int[])',
        [insumoIds]
      )
    : { rows: [] };
  const mapaInsumos = new Map(insumos.map(row => [row.id, row]));

  return movimentos.map(mov => {
    const insumo = mapaInsumos.get(mov.insumo_id) || {};
    const quantidade = mov.quantidade !== null ? Number(mov.quantidade) : null;
    const movimento = mov.tipo === 'saida' ? 'Saída' : 'Entrada';
    return {
      id: `movement-${mov.id}`,
      category: CATEGORY.tasks,
      message: `${movimento} manual registrada para ${insumo.nome || 'insumo'} (${quantidade ?? 'n/d'})`,
      date: toDate(mov.criado_em)?.toISOString() || new Date().toISOString(),
      metadata: {
        insumoId: mov.insumo_id,
        quantidade,
        quantidadeAnterior: mov.quantidade_anterior !== null ? Number(mov.quantidade_anterior) : null,
        quantidadeAtual: mov.quantidade_atual !== null ? Number(mov.quantidade_atual) : null,
        usuarioId: mov.usuario_id,
        unidade: insumo.unidade || null,
        janelaDias: MOVEMENT_ALERT_WINDOW_DAYS
      }
    };
  });
}

async function getPriceChangeNotifications() {
  const since = daysAgo(PRICE_CHANGE_ALERT_WINDOW_DAYS);
  const movimentos = await obterMovimentacoesRecentes({ tipos: ['preco'], desde: since });
  if (!movimentos.length) return [];

  const insumoIds = [...new Set(movimentos.map(m => m.insumo_id).filter(Boolean))];
  const { rows: insumos } = insumoIds.length
    ? await safeQuery(
        'SELECT id, nome FROM materia_prima WHERE id = ANY($1::int[])',
        [insumoIds]
      )
    : { rows: [] };
  const mapaInsumos = new Map(insumos.map(row => [row.id, row]));

  return movimentos.map(mov => {
    const insumo = mapaInsumos.get(mov.insumo_id) || {};
    const anterior = mov.preco_anterior !== null ? Number(mov.preco_anterior) : null;
    const atual = mov.preco_atual !== null ? Number(mov.preco_atual) : null;
    return {
      id: `price-${mov.id}`,
      category: CATEGORY.finance,
      message: `Preço de ${insumo.nome || 'insumo'} alterado de ${formatCurrency(anterior) ?? 'n/d'} para ${formatCurrency(atual) ?? 'n/d'}`,
      date: toDate(mov.criado_em)?.toISOString() || new Date().toISOString(),
      metadata: {
        insumoId: mov.insumo_id,
        precoAnterior: anterior,
        precoAtual: atual,
        usuarioId: mov.usuario_id,
        janelaDias: PRICE_CHANGE_ALERT_WINDOW_DAYS
      }
    };
  });
}

async function getProductAvailabilityNotifications() {
  const { rows } = await safeQuery(
    `SELECT p.id, p.nome, p.status, COALESCE(SUM(pe.quantidade), 0) AS quantidade_total,
            MAX(pe.data_hora_completa) AS ultima_movimentacao
       FROM produtos p
       LEFT JOIN produtos_em_cada_ponto pe ON pe.produto_id = p.id
      GROUP BY p.id, p.nome, p.status`
  );
  const items = [];
  for (const row of rows) {
    const quantidade = Number(row.quantidade_total) || 0;
    const status = (row.status || '').toString().trim().toLowerCase();
    const baseDate = toDate(row.ultima_movimentacao) || new Date();
    if (quantidade <= 0) {
      items.push({
        id: `product-nostock-${row.id}`,
        category: CATEGORY.system,
        message: `Produto ${row.nome} está sem estoque disponível`,
        date: baseDate.toISOString(),
        metadata: {
          produtoId: row.id,
          quantidade,
          status: row.status || null
        }
      });
    }
    if (status && PRODUCT_OFFLINE_STATUSES.includes(status)) {
      items.push({
        id: `product-offline-${row.id}`,
        category: CATEGORY.system,
        message: `Produto ${row.nome} está marcado como ${row.status}`,
        date: baseDate.toISOString(),
        metadata: {
          produtoId: row.id,
          status: row.status
        }
      });
    }
  }
  return items;
}

async function getOrderNotifications() {
  const stuckSince = daysAgo(PRODUCTION_STUCK_DAYS);
  const { rows: producao } = await safeQuery(
    `SELECT id, numero, situacao, COALESCE(data_aprovacao, data_emissao) AS referencia
       FROM pedidos
      WHERE situacao::text ILIKE '%produ%'
        AND COALESCE(data_aprovacao, data_emissao) <= $1`,
    [stuckSince]
  );
  const envioSince = daysAgo(SHIPPING_STUCK_DAYS);
  const { rows: envio } = await safeQuery(
    `SELECT id, numero, situacao, data_envio
       FROM pedidos
      WHERE situacao::text ILIKE 'enviado%'
        AND data_envio IS NOT NULL
        AND data_entrega IS NULL
        AND data_envio <= $1`,
    [envioSince]
  );

  const items = [];
  for (const row of producao) {
    const referencia = toDate(row.referencia);
    const dias = diffInDays(referencia) ?? PRODUCTION_STUCK_DAYS;
    items.push({
      id: `order-production-${row.id}`,
      category: CATEGORY.tasks,
      message: `Pedido ${row.numero || row.id} está em produção há ${dias} dia(s)`,
      date: (referencia || new Date()).toISOString(),
      metadata: {
        pedidoId: row.id,
        situacao: row.situacao,
        diasParado: dias,
        limiteDias: PRODUCTION_STUCK_DAYS
      }
    });
  }
  for (const row of envio) {
    const envioData = toDate(row.data_envio);
    const dias = diffInDays(envioData) ?? SHIPPING_STUCK_DAYS;
    items.push({
      id: `order-shipping-${row.id}`,
      category: CATEGORY.tasks,
      message: `Pedido ${row.numero || row.id} está em envio há ${dias} dia(s) sem entrega`,
      date: (envioData || new Date()).toISOString(),
      metadata: {
        pedidoId: row.id,
        situacao: row.situacao,
        diasParado: dias,
        limiteDias: SHIPPING_STUCK_DAYS
      }
    });
  }
  return items;
}

async function getBudgetNotifications() {
  const expiracaoLimite = daysFromNow(BUDGET_EXPIRY_WARNING_DAYS);
  const agora = new Date();
  const { rows: expirando } = await safeQuery(
    `SELECT id, numero, situacao, validade
       FROM orcamentos
      WHERE validade IS NOT NULL
        AND validade <= $1
        AND validade >= $2
        AND (situacao IS NULL OR situacao NOT IN ('Aprovado','Rejeitado','Cancelado','Expirado'))`,
    [expiracaoLimite, agora]
  );
  const aprovadoLimite = daysAgo(APPROVED_WITHOUT_ORDER_DAYS);
  const { rows: aprovadosBase } = await safeQuery(
    `SELECT o.id, o.numero, o.data_aprovacao
       FROM orcamentos o
       LEFT JOIN pedidos p ON p.id = o.id
      WHERE o.situacao::text ILIKE 'aprovado%'
        AND o.data_aprovacao IS NOT NULL
        AND o.data_aprovacao <= $1
        AND p.id IS NULL`,
    [aprovadoLimite]
  );

  let aprovados = aprovadosBase;
  if (aprovados.length && (await hasColumn('pedidos', 'orcamento_id'))) {
    const aprovadosIds = aprovados.map(row => Number(row.id)).filter(Number.isFinite);
    if (aprovadosIds.length) {
      const { rows: relacionados } = await safeQuery(
        `SELECT DISTINCT orcamento_id
           FROM pedidos
          WHERE orcamento_id = ANY($1::int[])`,
        [aprovadosIds]
      );
      if (relacionados.length) {
        const relacionadosIds = new Set(
          relacionados
            .map(row => Number(row.orcamento_id))
            .filter(Number.isFinite)
        );
        aprovados = aprovados.filter(row => !relacionadosIds.has(Number(row.id)));
      }
    }
  }

  const items = [];
  for (const row of expirando) {
    const validade = toDate(row.validade);
    const dias = diffInDays(validade, agora);
    items.push({
      id: `budget-expiry-${row.id}`,
      category: CATEGORY.finance,
      message: `Orçamento ${row.numero || row.id} expira em ${dias} dia(s)`,
      date: (validade || agora).toISOString(),
      metadata: {
        orcamentoId: row.id,
        situacao: row.situacao,
        validade,
        limiteDias: BUDGET_EXPIRY_WARNING_DAYS
      }
    });
  }
  for (const row of aprovados) {
    const data = toDate(row.data_aprovacao) || new Date();
    const dias = diffInDays(data) ?? APPROVED_WITHOUT_ORDER_DAYS;
    items.push({
      id: `budget-approved-${row.id}`,
      category: CATEGORY.finance,
      message: `Orçamento ${row.numero || row.id} aprovado sem pedido há ${dias} dia(s)`,
      date: data.toISOString(),
      metadata: {
        orcamentoId: row.id,
        limiteDias: APPROVED_WITHOUT_ORDER_DAYS
      }
    });
  }
  return items;
}

async function getCrmNotifications() {
  const { rows: semDono } = await safeQuery(
    `SELECT id, nome_fantasia, status_cliente
       FROM clientes
      WHERE dono_cliente IS NULL OR dono_cliente = ''`
  );
  const { rows: semContato } = await safeQuery(
    `SELECT c.id, c.nome_fantasia
       FROM clientes c
       LEFT JOIN contatos_cliente cc ON cc.id_cliente = c.id
      WHERE cc.id IS NULL`
  );

  const ativos = new Set(CRM_ACTIVE_STATUSES);
  const items = [];
  for (const row of semDono) {
    const status = (row.status_cliente || '').toString().trim().toLowerCase();
    if (status && !ativos.has(status)) continue;
    items.push({
      id: `crm-owner-${row.id}`,
      category: CATEGORY.sales,
      message: `Cliente ${row.nome_fantasia} está sem dono definido`,
      date: new Date().toISOString(),
      metadata: {
        clienteId: row.id,
        status: row.status_cliente || null
      }
    });
  }
  for (const row of semContato) {
    items.push({
      id: `crm-contact-${row.id}`,
      category: CATEGORY.sales,
      message: `Cliente ${row.nome_fantasia} está sem contatos cadastrados`,
      date: new Date().toISOString(),
      metadata: {
        clienteId: row.id
      }
    });
  }
  return items;
}

async function getUserNotifications() {
  const { rows } = await safeQuery('SELECT * FROM usuarios');
  const inactiveCutoff = daysAgo(INACTIVE_USER_DAYS);
  const sessionCutoff = hoursAgo(OPEN_SESSION_MAX_HOURS);

  const items = [];
  for (const row of rows) {
    const ultimaAtividade =
      toDate(row.ultima_atividade_em) ||
      toDate(row.ultima_atividade) ||
      toDate(row.ultimo_login_em) ||
      toDate(row.ultimo_login) ||
      null;
    const ultimaEntrada = toDate(row.ultima_entrada) || toDate(row.ultima_entrada_em);
    const ultimaSaida = toDate(row.ultima_saida) || toDate(row.ultima_saida_em);

    if (!ultimaAtividade || ultimaAtividade <= inactiveCutoff) {
      items.push({
        id: `user-inactive-${row.id}`,
        category: CATEGORY.system,
        message: `Usuário ${row.nome || row.id} está inativo há mais de ${INACTIVE_USER_DAYS} dia(s)`,
        date: (ultimaAtividade || inactiveCutoff).toISOString(),
        metadata: {
          usuarioId: row.id,
          ultimaAtividade,
          limiteDias: INACTIVE_USER_DAYS,
          verificado: row.verificado
        }
      });
    }

    if (
      ultimaEntrada &&
      (!ultimaSaida || ultimaSaida.getTime() < ultimaEntrada.getTime()) &&
      ultimaEntrada <= sessionCutoff
    ) {
      items.push({
        id: `session-open-${row.id}`,
        category: CATEGORY.system,
        message: `Sessão do usuário ${row.nome || row.id} está aberta há mais de ${OPEN_SESSION_MAX_HOURS} hora(s)`,
        date: ultimaEntrada.toISOString(),
        metadata: {
          usuarioId: row.id,
          ultimaEntrada,
          ultimaSaida,
          limiteHoras: OPEN_SESSION_MAX_HOURS
        }
      });
    }
  }

  return items;
}

async function collectNotifications() {
  const all = await Promise.all([
    getStockNotifications(),
    getManualMovementNotifications(),
    getPriceChangeNotifications(),
    getProductAvailabilityNotifications(),
    getOrderNotifications(),
    getBudgetNotifications(),
    getCrmNotifications(),
    getUserNotifications()
  ]);
  return all.flat().sort((a, b) => {
    const aDate = toDate(a.date) || new Date(0);
    const bDate = toDate(b.date) || new Date(0);
    return bDate.getTime() - aDate.getTime();
  });
}

router.get('/', async (_req, res) => {
  try {
    const items = await collectNotifications();
    res.json({ items });
  } catch (err) {
    console.error('Erro ao montar notificações:', err);
    res.status(500).json({ error: 'Erro ao listar notificações' });
  }
});

module.exports = router;
module.exports.collectNotifications = collectNotifications;
