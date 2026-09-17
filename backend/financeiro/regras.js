/**
 * Regras editáveis do Financeiro (fase G) — tudo que decide quanto se paga
 * fica em tabela e é mudado pelo módulo, não no código:
 *
 *   comissao_regras      CMS (arquiteto) e Royalty: beneficiário e % sobre o
 *                        valor líquido da parcela, para todos os pedidos, um
 *                        cliente ou um pedido. A regra mais específica vale
 *                        (pedido > cliente > todos); regras do mesmo nível
 *                        somam (dois arquitetos no mesmo pedido). Uma regra
 *                        de 0% no pedido tira a comissão só dele.
 *   producao_setores     Marcenaria, Pintura… (dá para criar outros).
 *   producao_valores     quanto se paga por peça finalizada em cada setor:
 *                        o valor da peça, ou o padrão do setor (sem peça).
 *   financeiro_feriados  feriados além dos nacionais (o 5º dia útil).
 *   financeiro_configuracao  dia do pagamento das comissões, qual dia útil
 *                        paga a produção, se sábado conta.
 *
 * Mudar uma regra muda as contas do que ainda não foi fechado; o que foi
 * fechado guarda os percentuais e valores com que foi fechado.
 */
const c = require('./comum');
const calendario = require('./calendario');
const auditoria = require('./auditoria');

const TIPOS_REGRA = { cms: 'CMS', royalty: 'Royalty' };
const ESCOPOS = { todos: 'Todos os pedidos', cliente: 'Cliente', pedido: 'Pedido' };
const ativo = v => !(v === false || v === 'false' || v === 0 || v === 'f');

// ---------------------------------------------------------------- contas

/** As regras que valem para um pedido: { cms: [...], royalty: [...], pct_cms, pct_royalty, sem_regra }. Pura. */
function taxasDoPedido(regras, pedido) {
  const saida = {};
  for (const tipo of Object.keys(TIPOS_REGRA)) {
    const doTipo = (regras || []).filter(r => r && ativo(r.ativo) && r.tipo === tipo);
    const doPedido = doTipo.filter(r => r.escopo === 'pedido' && pedido && String(r.pedido_id) === String(pedido.id));
    const doCliente = doTipo.filter(r => r.escopo === 'cliente' && pedido && pedido.cliente_id !== null && pedido.cliente_id !== undefined && String(r.cliente_id) === String(pedido.cliente_id));
    const gerais = doTipo.filter(r => r.escopo === 'todos');
    const escolhidas = doPedido.length ? doPedido : (doCliente.length ? doCliente : gerais);
    saida[tipo] = escolhidas
      .map(r => ({ regra_id: r.id ?? null, beneficiario: r.beneficiario, percentual: Number(r.percentual) || 0, escopo: r.escopo }))
      .sort((a, b) => String(a.beneficiario).localeCompare(String(b.beneficiario), 'pt-BR'));
  }
  const soma = l => Math.round(l.reduce((s, r) => s + r.percentual, 0) * 10000) / 10000;
  return { cms: saida.cms, royalty: saida.royalty, pct_cms: soma(saida.cms), pct_royalty: soma(saida.royalty), sem_regra: !saida.cms.length && !saida.royalty.length };
}

/**
 * Quanto cada beneficiário recebe sobre `base`. O total de cada tipo é a
 * soma das partes (arredondadas em centavos), para bater com o detalhe.
 */
function valoresSobre(base, taxas) {
  const beneficiarios = [];
  const totais = { cms: 0, royalty: 0 };
  for (const tipo of Object.keys(TIPOS_REGRA)) {
    for (const r of taxas?.[tipo] || []) {
      const valor = c.centavos(Number(base || 0) * r.percentual / 100);
      beneficiarios.push({ tipo, beneficiario: r.beneficiario, percentual: r.percentual, valor });
      totais[tipo] = c.centavos(totais[tipo] + valor);
    }
  }
  return { cms: totais.cms, royalty: totais.royalty, total: c.centavos(totais.cms + totais.royalty), beneficiarios };
}

/** Valor por peça de um produto num setor: o da peça, senão o padrão do setor, senão null. Pura. */
function valorUnitario(valores, produtoId, setorId) {
  const doSetor = (valores || []).filter(v => v && ativo(v.ativo) && String(v.setor_id) === String(setorId));
  const daPeca = produtoId !== null && produtoId !== undefined ? doSetor.find(v => v.produto_id !== null && v.produto_id !== undefined && String(v.produto_id) === String(produtoId)) : null;
  const padrao = doSetor.find(v => v.produto_id === null || v.produto_id === undefined);
  const escolhido = daPeca || padrao || null;
  return escolhido ? { valor: c.centavos(escolhido.valor_unitario), origem: daPeca ? 'peca' : 'padrao', valor_id: escolhido.id ?? null } : null;
}

// ---------------------------------------------------------------- leitura

async function lerConfiguracao(api) {
  const linhas = await c.ler(api, 'financeiro_configuracao');
  const linha = linhas.find(l => Number(l.id) === 1) || linhas[0] || null;
  return {
    id: linha?.id ?? null,
    comissao_dia_pagamento: Number(linha?.comissao_dia_pagamento) || calendario.PADRAO.comissao_dia_pagamento,
    producao_dia_util: Number(linha?.producao_dia_util) || calendario.PADRAO.producao_dia_util,
    sabado_dia_util: [true, 't', 'true', 1].includes(linha?.sabado_dia_util),
    atualizado_em: linha?.atualizado_em || null
  };
}

/** Tudo que as contas precisam, numa ida. */
async function lerTudo(api) {
  const [configuracao, regras, setores, valores, feriados] = await Promise.all([
    lerConfiguracao(api),
    c.ler(api, 'comissao_regras'),
    c.ler(api, 'producao_setores'),
    c.ler(api, 'producao_valores'),
    c.ler(api, 'financeiro_feriados')
  ]);
  return {
    configuracao,
    regras: regras.sort((a, b) => Number(a.id) - Number(b.id)),
    setores: setores.sort((a, b) => (Number(a.ordem) || 0) - (Number(b.ordem) || 0) || String(a.nome).localeCompare(String(b.nome), 'pt-BR')),
    valores,
    feriados: feriados.map(f => ({ ...f, data: c.dia(f.data) })).sort((a, b) => String(a.data).localeCompare(String(b.data)))
  };
}

/** Para a tela de regras: as regras com o nome do cliente/pedido, os valores com o nome da peça. */
async function paraTela(api) {
  const tudo = await lerTudo(api);
  const idsClientes = [...new Set(tudo.regras.filter(r => r.escopo === 'cliente' && r.cliente_id).map(r => String(r.cliente_id)))];
  const idsPedidos = [...new Set(tudo.regras.filter(r => r.escopo === 'pedido' && r.pedido_id).map(r => String(r.pedido_id)))];
  const idsProdutos = [...new Set(tudo.valores.filter(v => v.produto_id).map(v => String(v.produto_id)))];
  const buscar = (tabela, id) => api.get(`/api/${tabela}`, { query: { id } }).then(r => c.lista(r).find(l => String(l?.id) === id) || null).catch(() => null);
  const [clientes, pedidos, produtos] = await Promise.all([
    Promise.all(idsClientes.map(id => buscar('clientes', id))),
    Promise.all(idsPedidos.map(id => buscar('pedidos', id))),
    Promise.all(idsProdutos.map(id => buscar('produtos', id)))
  ]);
  const nomeCliente = new Map(clientes.filter(Boolean).map(x => [String(x.id), c.nomeDoCliente(x)]));
  const numeroPedido = new Map(pedidos.filter(Boolean).map(x => [String(x.id), x.numero || String(x.id)]));
  const nomeProduto = new Map(produtos.filter(Boolean).map(x => [String(x.id), [x.codigo, x.nome].filter(Boolean).join(' — ')]));
  const ano = Number(new Date().getFullYear());
  return {
    configuracao: tudo.configuracao,
    regras: tudo.regras.map(r => ({
      ...r, ativo: ativo(r.ativo), percentual: Number(r.percentual),
      alvo: r.escopo === 'cliente' ? (nomeCliente.get(String(r.cliente_id)) || `cliente ${r.cliente_id}`)
        : r.escopo === 'pedido' ? `Pedido ${numeroPedido.get(String(r.pedido_id)) || r.pedido_id}` : ESCOPOS.todos
    })),
    setores: tudo.setores.map(s => ({ ...s, ativo: ativo(s.ativo) })),
    valores: tudo.valores.filter(v => ativo(v.ativo)).map(v => ({
      ...v, valor_unitario: c.centavos(v.valor_unitario),
      produto: v.produto_id ? (nomeProduto.get(String(v.produto_id)) || `peça ${v.produto_id}`) : null,
      setor: (tudo.setores.find(s => String(s.id) === String(v.setor_id)) || {}).nome || null
    })),
    feriados: tudo.feriados,
    feriados_nacionais: [...calendario.feriadosNacionais(ano), ...calendario.feriadosNacionais(ano + 1)]
  };
}

// ------------------------------------------------------------- validação

function validarRegra(entrada) {
  const tipo = String(entrada?.tipo || '');
  if (!TIPOS_REGRA[tipo]) throw c.erro('Escolha se a regra é de CMS ou de Royalty.');
  const beneficiario = c.texto(entrada?.beneficiario, 120);
  if (beneficiario.length < 2) throw c.erro('Diga quem recebe (o nome do arquiteto ou de quem recebe o royalty).');
  const percentual = Number(String(entrada?.percentual ?? '').replace(',', '.'));
  if (!Number.isFinite(percentual) || percentual < 0 || percentual > 100) throw c.erro('O percentual vai de 0 a 100.');
  const escopo = String(entrada?.escopo || 'todos');
  if (!ESCOPOS[escopo]) throw c.erro('Escolha a quem a regra se aplica.');
  const clienteId = escopo === 'cliente' ? Number(entrada?.cliente_id) : null;
  const pedidoId = escopo === 'pedido' ? Number(entrada?.pedido_id) : null;
  if (escopo === 'cliente' && !(Number.isInteger(clienteId) && clienteId > 0)) throw c.erro('Escolha o cliente da regra.');
  if (escopo === 'pedido' && !(Number.isInteger(pedidoId) && pedidoId > 0)) throw c.erro('Escolha o pedido da regra.');
  return {
    tipo, beneficiario, percentual: Math.round(percentual * 10000) / 10000, escopo,
    cliente_id: clienteId, pedido_id: pedidoId, observacao: c.texto(entrada?.observacao, 300) || null,
    ativo: entrada?.ativo === undefined ? true : ativo(entrada.ativo)
  };
}

const mesmaRegra = (a, b) => a.tipo === b.tipo && a.escopo === b.escopo
  && String(a.cliente_id ?? '') === String(b.cliente_id ?? '') && String(a.pedido_id ?? '') === String(b.pedido_id ?? '')
  && String(a.beneficiario).toLowerCase() === String(b.beneficiario).toLowerCase();

const descreverRegra = r => `${TIPOS_REGRA[r.tipo]} ${String(r.percentual).replace('.', ',')}% para ${r.beneficiario} (${r.escopo === 'todos' ? 'todos os pedidos' : r.escopo === 'cliente' ? `cliente ${r.cliente_id}` : `pedido ${r.pedido_id}`})`;

// ---------------------------------------------------------------- escrita

async function salvarRegra({ api, id = null, entrada, usuarioId = null }) {
  const nova = validarRegra(entrada);
  const regras = await c.ler(api, 'comissao_regras');
  const atual = id ? regras.find(r => String(r.id) === String(id)) : null;
  if (id && !atual) throw c.erro('Regra não encontrada.', 404);
  if (nova.ativo && regras.some(r => ativo(r.ativo) && String(r.id) !== String(id) && mesmaRegra(r, nova))) {
    throw c.erro(`Já existe uma regra ativa de ${TIPOS_REGRA[nova.tipo]} para ${nova.beneficiario} neste alcance. Altere a que existe.`, 409);
  }
  const quando = c.agora();
  if (atual) {
    await c.atualizar(api, 'comissao_regras', atual.id, { ...nova, atualizado_por: usuarioId, atualizado_em: quando });
    await auditoria.registrar(api, {
      tipo: 'regra_alterada', descricao: `${descreverRegra(nova)}${nova.ativo ? '' : ' — desativada'}`, referenciaId: atual.id,
      pedidoId: nova.pedido_id, usuarioId,
      dados: { antes: { percentual: Number(atual.percentual), beneficiario: atual.beneficiario, ativo: ativo(atual.ativo), escopo: atual.escopo }, depois: nova }
    });
    return { ...atual, ...nova };
  }
  const criada = await c.inserir(api, 'comissao_regras', { ...nova, criado_por: usuarioId, criado_em: quando, atualizado_por: usuarioId, atualizado_em: quando });
  await auditoria.registrar(api, { tipo: 'regra_criada', descricao: descreverRegra(nova), referenciaId: criada.id, pedidoId: nova.pedido_id, usuarioId, dados: { depois: nova } });
  return criada;
}

async function salvarSetor({ api, id = null, entrada, usuarioId = null }) {
  const nome = c.texto(entrada?.nome, 60);
  if (nome.length < 2) throw c.erro('Dê um nome ao setor.');
  const setores = await c.ler(api, 'producao_setores');
  if (setores.some(s => String(s.id) !== String(id) && String(s.nome).toLowerCase() === nome.toLowerCase())) throw c.erro(`Já existe o setor ${nome}.`, 409);
  const campos = { nome, ativo: entrada?.ativo === undefined ? true : ativo(entrada.ativo) };
  if (id) {
    const atual = setores.find(s => String(s.id) === String(id));
    if (!atual) throw c.erro('Setor não encontrado.', 404);
    await c.atualizar(api, 'producao_setores', atual.id, campos);
    await auditoria.registrar(api, { tipo: 'setor_alterado', descricao: `Setor ${atual.nome}${atual.nome !== nome ? ` passou a se chamar ${nome}` : ''}${campos.ativo ? '' : ' — desativado'}`, referenciaId: atual.id, usuarioId });
    return { ...atual, ...campos };
  }
  const ordem = setores.reduce((m, s) => Math.max(m, Number(s.ordem) || 0), 0) + 1;
  const criado = await c.inserir(api, 'producao_setores', { ...campos, ordem, criado_em: c.agora() });
  await auditoria.registrar(api, { tipo: 'setor_alterado', descricao: `Setor ${nome} criado`, referenciaId: criado.id, usuarioId });
  return criado;
}

/**
 * Valor por peça: um por setor e peça (ou o padrão do setor, sem peça).
 * Gravar de novo o mesmo par troca o valor; `remover` desliga a linha.
 */
async function salvarValor({ api, entrada, usuarioId = null }) {
  const setorId = Number(entrada?.setor_id);
  const setores = await c.ler(api, 'producao_setores');
  const setor = setores.find(s => Number(s.id) === setorId);
  if (!setor) throw c.erro('Escolha o setor.');
  const produtoId = entrada?.produto_id === null || entrada?.produto_id === undefined || entrada?.produto_id === '' ? null : Number(entrada.produto_id);
  if (produtoId !== null && !(Number.isInteger(produtoId) && produtoId > 0)) throw c.erro('Peça inválida.');
  const valores = await c.ler(api, 'producao_valores');
  const atual = valores.find(v => ativo(v.ativo) && Number(v.setor_id) === setorId && String(v.produto_id ?? '') === String(produtoId ?? '')) || null;
  const alvo = produtoId === null ? `padrão de ${setor.nome}` : `peça ${produtoId} em ${setor.nome}`;
  const quando = c.agora();

  if (entrada?.remover === true) {
    if (!atual) return null;
    await c.atualizar(api, 'producao_valores', atual.id, { ativo: false, atualizado_por: usuarioId, atualizado_em: quando });
    await auditoria.registrar(api, { tipo: 'valor_producao', descricao: `Valor ${alvo} removido (era ${c.reais(atual.valor_unitario)})`, referenciaId: atual.id, usuarioId });
    return null;
  }
  const bruto = String(entrada?.valor_unitario ?? '').trim().replace(',', '.');
  if (!bruto || !Number.isFinite(Number(bruto)) || Number(bruto) < 0) throw c.erro('Informe o valor por peça.');
  const valor = c.centavos(bruto);
  const observacao = c.texto(entrada?.observacao, 300) || null;
  if (atual) {
    await c.atualizar(api, 'producao_valores', atual.id, { valor_unitario: valor, observacao, atualizado_por: usuarioId, atualizado_em: quando });
    await auditoria.registrar(api, { tipo: 'valor_producao', descricao: `Valor ${alvo}: ${c.reais(atual.valor_unitario)} → ${c.reais(valor)}`, referenciaId: atual.id, usuarioId, dados: { antes: c.centavos(atual.valor_unitario), depois: valor } });
    return { ...atual, valor_unitario: valor, observacao };
  }
  const criado = await c.inserir(api, 'producao_valores', {
    setor_id: setorId, produto_id: produtoId, valor_unitario: valor, ativo: true, observacao,
    criado_por: usuarioId, criado_em: quando, atualizado_por: usuarioId, atualizado_em: quando
  });
  await auditoria.registrar(api, { tipo: 'valor_producao', descricao: `Valor ${alvo}: ${c.reais(valor)}`, referenciaId: criado.id, usuarioId, dados: { depois: valor } });
  return criado;
}

async function adicionarFeriado({ api, entrada, usuarioId = null }) {
  const data = String(entrada?.data || '').slice(0, 10);
  if (!c.dataValida(data)) throw c.erro('Informe a data do feriado.');
  const descricao = c.texto(entrada?.descricao, 80);
  if (descricao.length < 3) throw c.erro('Diga que feriado é.');
  const nacional = calendario.feriadosNacionais(Number(data.slice(0, 4))).find(f => f.data === data);
  if (nacional) throw c.erro(`${c.impressa(data)} já é feriado nacional (${nacional.descricao}).`, 409);
  const existentes = await c.ler(api, 'financeiro_feriados');
  if (existentes.some(f => c.dia(f.data) === data)) throw c.erro(`${c.impressa(data)} já está no calendário.`, 409);
  const criado = await c.inserir(api, 'financeiro_feriados', { data, descricao, criado_por: usuarioId, criado_em: c.agora() });
  await auditoria.registrar(api, { tipo: 'feriado_alterado', descricao: `Feriado ${c.impressa(data)} (${descricao}) incluído`, referenciaId: criado.id, usuarioId });
  return criado;
}

async function removerFeriado({ api, id, usuarioId = null }) {
  const existentes = await c.ler(api, 'financeiro_feriados');
  const alvo = existentes.find(f => String(f.id) === String(id));
  if (!alvo) throw c.erro('Feriado não encontrado.', 404);
  await api.delete(`/api/financeiro_feriados/${alvo.id}`);
  await auditoria.registrar(api, { tipo: 'feriado_alterado', descricao: `Feriado ${c.impressa(alvo.data)} (${alvo.descricao}) retirado`, referenciaId: alvo.id, usuarioId });
  return true;
}

async function salvarConfiguracao({ api, entrada, usuarioId = null }) {
  const diaPagamento = Number(entrada?.comissao_dia_pagamento);
  if (!Number.isInteger(diaPagamento) || diaPagamento < 1 || diaPagamento > 28) throw c.erro('O dia do pagamento das comissões vai de 1 a 28.');
  const diaUtil = Number(entrada?.producao_dia_util);
  if (!Number.isInteger(diaUtil) || diaUtil < 1 || diaUtil > 20) throw c.erro('O dia útil do pagamento da produção vai de 1 a 20.');
  const campos = { comissao_dia_pagamento: diaPagamento, producao_dia_util: diaUtil, sabado_dia_util: entrada?.sabado_dia_util === true, atualizado_por: usuarioId, atualizado_em: c.agora() };
  const atual = await lerConfiguracao(api);
  if (atual.id) await c.atualizar(api, 'financeiro_configuracao', atual.id, campos);
  else await c.inserir(api, 'financeiro_configuracao', { id: 1, ...campos });
  await auditoria.registrar(api, {
    tipo: 'configuracao_alterada', usuarioId,
    descricao: `Comissões até o dia ${diaPagamento}; produção até o ${diaUtil}º dia útil${campos.sabado_dia_util ? ' (sábado conta)' : ''}`,
    dados: { antes: atual, depois: campos }
  });
  return { ...atual, ...campos };
}

module.exports = {
  TIPOS_REGRA, ESCOPOS, ativo,
  taxasDoPedido, valoresSobre, valorUnitario, validarRegra,
  lerConfiguracao, lerTudo, paraTela,
  salvarRegra, salvarSetor, salvarValor, adicionarFeriado, removerFeriado, salvarConfiguracao
};
