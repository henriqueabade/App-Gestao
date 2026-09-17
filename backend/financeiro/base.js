/**
 * Leitura do que as contas do Financeiro completo (fase G) precisam.
 * Tudo numa ida por tabela; as contas ficam em comissoes.js / producao.js.
 */
const c = require('./comum');
const regras = require('./regras');
const contasReceber = require('../cobranca/contasReceber');

async function lerFechamentos(api) {
  const [fechamentos, itens, pagamentos] = await Promise.all([
    c.ler(api, 'financeiro_fechamentos'),
    c.ler(api, 'financeiro_fechamento_itens'),
    c.ler(api, 'financeiro_pagamentos')
  ]);
  return {
    fechamentos: fechamentos.map(f => ({ ...f, competencia: String(f.competencia || '').trim() })),
    itens,
    pagamentos: pagamentos.map(p => ({ ...p, competencia: String(p.competencia || '').trim(), data_pagamento: c.dia(p.data_pagamento) }))
  };
}

/**
 * A base das comissões: as contas a receber (fase E), os ajustes, as regras
 * e os fechamentos. `desde` é o corte "controlar a partir de" da cobrança.
 */
async function lerComissoes(api, { hoje, desde = null }) {
  const [receber, ajustes, tudo, fech] = await Promise.all([
    contasReceber.lerBase(api, hoje),
    c.ler(api, 'ajustes_financeiros'),
    regras.lerTudo(api),
    lerFechamentos(api)
  ]);
  const linhas = contasReceber.parcelasDosPedidos({ ...receber, hoje, desde });
  return { receber, linhas, ajustes, regras: tudo, ...fech };
}

/** Nomes dos clientes que aparecem (um GET por cliente, como as contas a receber). */
async function nomesDosClientes(api, ids) {
  const unicos = [...new Set(ids.filter(v => v !== null && v !== undefined).map(String))];
  const achados = await Promise.all(unicos.map(id => api.get('/api/clientes', { query: { id } })
    .then(r => c.lista(r).find(x => String(x?.id) === id) || null).catch(() => null)));
  return new Map(achados.filter(Boolean).map(x => [String(x.id), c.nomeDoCliente(x)]));
}

module.exports = { lerFechamentos, lerComissoes, nomesDosClientes };
