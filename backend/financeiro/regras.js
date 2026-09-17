/**
 * Regras editáveis do Financeiro (fase G) — tudo que decide quanto se paga
 * fica em tabela e é mudado pelo módulo, não no código:
 *
 *   comissao_regras      CMS e Royalty, em % sobre o valor líquido da parcela,
 *                        para todos os pedidos, um cliente ou um pedido. A
 *                        regra mais específica vale (pedido > cliente > todos).
 *                          CMS     vai para o DONO DO CLIENTE do pedido
 *                                  (clientes.dono_cliente), mesmo que ele não
 *                                  seja o dono do pedido: a regra diz de quem
 *                                  e quanto, e só vale nos clientes dele.
 *                                  Regras do mesmo nível somam.
 *                          Royalty vai para o DESENHISTA de cada peça
 *                                  (produtos.desenhado_por): a regra diz só o
 *                                  %, e a parcela é repartida na proporção do
 *                                  valor vendido das peças de cada desenhista
 *                                  (com o desconto do pedido, sem as peças
 *                                  devolvidas). Uma regra por nível.
 *                        Uma regra de 0% no pedido tira a comissão só dele.
 *   etapas_producao      os PROCESSOS (os mesmos da peça e da matéria-prima);
 *                        `producao_ativa` liga/desliga o pagamento de cada um.
 *   producao_valores     quanto o processo paga por peça: em R$ ou em % do
 *                        preço da tabela fixa — o da peça, ou o padrão do
 *                        processo. A conta de cada registro está em
 *                        producaoUnidades.js (proporcional aos insumos).
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
const unidades = require('./producaoUnidades');

const TIPOS_REGRA = { cms: 'CMS', royalty: 'Royalty' };
const ESCOPOS = { todos: 'Todos os pedidos', cliente: 'Cliente', pedido: 'Pedido' };
const ativo = v => !(v === false || v === 'false' || v === 0 || v === 'f');
const NIVEIS = ['pedido', 'cliente', 'todos'];
const SQL_PROCESSOS = 'Falta rodar sql/desenhistas_producao_parcela.sql no banco e reiniciar a API.';
const DESENHISTA_DA_PECA = 'Desenhista da peça';
const semAcento = unidades.semAcento;
const mesmoNome = (a, b) => semAcento(a) !== '' && semAcento(a) === semAcento(b);

// ---------------------------------------------------------------- contas

/** As regras de um tipo que valem para o pedido, no nível mais específico que tiver. */
function doNivelMaisEspecifico(lista, pedido) {
  const doPedido = lista.filter(r => r.escopo === 'pedido' && pedido && String(r.pedido_id) === String(pedido.id));
  const doCliente = lista.filter(r => r.escopo === 'cliente' && pedido && pedido.cliente_id !== null && pedido.cliente_id !== undefined && String(r.cliente_id) === String(pedido.cliente_id));
  const gerais = lista.filter(r => r.escopo === 'todos');
  return doPedido.length ? doPedido : (doCliente.length ? doCliente : gerais);
}

const soma4 = l => Math.round(l.reduce((s, r) => s + r.percentual, 0) * 10000) / 10000;
const porNome = (a, b) => String(a.beneficiario).localeCompare(String(b.beneficiario), 'pt-BR');

/**
 * As regras que valem para um pedido:
 * { cms: [...], royalty: [...], pct_cms, pct_royalty, sem_regra, ... }. Pura.
 *
 * `contexto` (o que as contas de verdade sempre mandam):
 *   dono_cliente   o dono do cliente do pedido (nome)
 *   desenhistas    [{ nome, valor }] — o valor vendido das peças de cada
 *                  desenhista no pedido (nome vazio = peça sem desenhista)
 * Sem `contexto` a conta é a antiga (quem recebe vem da regra), para os
 * fechamentos e testes de antes.
 */
function taxasDoPedido(regras, pedido, contexto) {
  const ativas = (regras || []).filter(r => r && ativo(r.ativo) && TIPOS_REGRA[r.tipo]);
  const saida = {};

  if (!contexto) {
    for (const tipo of Object.keys(TIPOS_REGRA)) {
      saida[tipo] = doNivelMaisEspecifico(ativas.filter(r => r.tipo === tipo), pedido)
        .map(r => ({ regra_id: r.id ?? null, beneficiario: r.beneficiario, percentual: Number(r.percentual) || 0, escopo: r.escopo }))
        .sort(porNome);
    }
    return { cms: saida.cms, royalty: saida.royalty, pct_cms: soma4(saida.cms), pct_royalty: soma4(saida.royalty), sem_regra: !saida.cms.length && !saida.royalty.length };
  }

  // CMS: só as regras do dono do cliente do pedido.
  const dono = contexto.dono_cliente || null;
  const cmsDoDono = dono ? ativas.filter(r => r.tipo === 'cms' && mesmoNome(r.beneficiario, dono)) : [];
  saida.cms = doNivelMaisEspecifico(cmsDoDono, pedido)
    .map(r => ({ regra_id: r.id ?? null, beneficiario: dono, percentual: Number(r.percentual) || 0, escopo: r.escopo }))
    .sort(porNome);

  // Royalty: o % da regra mais específica (a mais recente, se houver duas), repartido entre os desenhistas.
  const royaltyDoNivel = doNivelMaisEspecifico(ativas.filter(r => r.tipo === 'royalty'), pedido)
    .slice().sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
  const regraRoyalty = royaltyDoNivel[0] || null;
  const pesos = new Map();
  let totalPecas = 0;
  let semDesenhista = 0;
  for (const d of contexto.desenhistas || []) {
    const valor = Math.max(0, Number(d.valor) || 0);
    totalPecas += valor;
    const nome = String(d.nome || '').trim();
    if (!nome) { semDesenhista += valor; continue; }
    const chave = semAcento(nome);
    const atual = pesos.get(chave) || { nome, valor: 0 };
    atual.valor += valor;
    pesos.set(chave, atual);
  }
  const pctRegra = regraRoyalty ? Number(regraRoyalty.percentual) || 0 : 0;
  saida.royalty = regraRoyalty && totalPecas > 0
    ? [...pesos.values()].map(p => {
      const participacao = p.valor / totalPecas;
      return {
        regra_id: regraRoyalty.id ?? null, beneficiario: p.nome, escopo: regraRoyalty.escopo,
        percentual: Math.round(pctRegra * participacao * 1000000) / 1000000,
        percentual_regra: pctRegra, participacao: Math.round(participacao * 1000000) / 1000000
      };
    }).sort(porNome)
    : [];

  return {
    cms: saida.cms, royalty: saida.royalty,
    pct_cms: soma4(saida.cms), pct_royalty: Math.round(saida.royalty.reduce((s, r) => s + r.percentual, 0) * 10000) / 10000,
    pct_royalty_regra: regraRoyalty ? pctRegra : null,
    dono_cliente: dono,
    sem_regra: !saida.cms.length && !regraRoyalty,
    sem_cms: !saida.cms.length,
    sem_royalty: !regraRoyalty,
    sem_desenhista: regraRoyalty ? Math.round((totalPecas > 0 ? semDesenhista / totalPecas : 0) * 10000) / 10000 : 0
  };
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

/** (Fase G, por setor) Valor por peça de um produto num setor: o da peça, senão o padrão do setor, senão null. Pura. */
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

/** Os processos (etapas_producao), em ordem. Sem a coluna `producao_ativa`, o SQL novo não rodou. */
async function lerEtapas(api) {
  const linhas = c.lista(await api.get('/api/etapas_producao').catch(() => []))
    .filter(e => e && String(e.nome || '').trim())
    .sort((a, b) => (Number(a.ordem) || 0) - (Number(b.ordem) || 0) || String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
  if (linhas.length && !linhas.some(e => Object.prototype.hasOwnProperty.call(e, 'producao_ativa'))) {
    throw c.erro(SQL_PROCESSOS, 409, { sql_pendente: true });
  }
  return linhas.map(e => ({ id: e.id, nome: String(e.nome).trim(), ordem: Number(e.ordem) || 0, producao_ativa: ativo(e.producao_ativa) }));
}

/** Tudo que as contas precisam, numa ida. */
async function lerTudo(api) {
  const [configuracao, regras, setores, valores, feriados, etapas] = await Promise.all([
    lerConfiguracao(api),
    c.ler(api, 'comissao_regras'),
    c.ler(api, 'producao_setores'),
    c.ler(api, 'producao_valores'),
    c.ler(api, 'financeiro_feriados'),
    lerEtapas(api)
  ]);
  return {
    configuracao,
    regras: regras.sort((a, b) => Number(a.id) - Number(b.id)),
    setores: setores.sort((a, b) => (Number(a.ordem) || 0) - (Number(b.ordem) || 0) || String(a.nome).localeCompare(String(b.nome), 'pt-BR')),
    etapas,
    valores,
    feriados: feriados.map(f => ({ ...f, data: c.dia(f.data) })).sort((a, b) => String(a.data).localeCompare(String(b.data)))
  };
}

/** Os donos de cliente (os únicos que recebem CMS), em ordem. */
async function donosDeClientes(api) {
  const linhas = c.lista(await api.get('/api/clientes', { query: { select: 'id,dono_cliente' } }).catch(() => []));
  const nomes = new Map();
  for (const l of linhas) {
    const nome = String(l?.dono_cliente || '').trim();
    if (nome && !nomes.has(semAcento(nome))) nomes.set(semAcento(nome), nome);
  }
  return [...nomes.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

const descreverValor = v => unidades.descreverRegra({ tipo: v.tipo === 'percentual' ? 'percentual' : 'valor', valor: v.valor_unitario, percentual: v.percentual });

/** Para a tela de regras: as regras com o nome do cliente/pedido, os valores com o nome da peça e do processo. */
async function paraTela(api) {
  const tudo = await lerTudo(api);
  const idsClientes = [...new Set(tudo.regras.filter(r => r.escopo === 'cliente' && r.cliente_id).map(r => String(r.cliente_id)))];
  const idsPedidos = [...new Set(tudo.regras.filter(r => r.escopo === 'pedido' && r.pedido_id).map(r => String(r.pedido_id)))];
  const valoresNovos = tudo.valores.filter(v => ativo(v.ativo) && v.etapa_id !== null && v.etapa_id !== undefined);
  const idsProdutos = [...new Set(valoresNovos.filter(v => v.produto_id).map(v => String(v.produto_id)))];
  const buscar = (tabela, id, select) => api.get(`/api/${tabela}`, { query: { id, ...(select ? { select } : {}) } }).then(r => c.lista(r).find(l => String(l?.id) === id) || null).catch(() => null);
  const [clientes, pedidos, produtos] = await Promise.all([
    Promise.all(idsClientes.map(id => buscar('clientes', id, 'id,nome_fantasia,razao_social,dono_cliente'))),
    Promise.all(idsPedidos.map(id => buscar('pedidos', id))),
    Promise.all(idsProdutos.map(id => buscar('produtos', id, 'id,codigo,nome')))
  ]);
  const nomeCliente = new Map(clientes.filter(Boolean).map(x => [String(x.id), c.nomeDoCliente(x)]));
  const numeroPedido = new Map(pedidos.filter(Boolean).map(x => [String(x.id), x.numero || String(x.id)]));
  const nomeProduto = new Map(produtos.filter(Boolean).map(x => [String(x.id), [x.codigo, x.nome].filter(Boolean).join(' — ')]));
  const ano = Number(new Date().getFullYear());
  return {
    configuracao: tudo.configuracao,
    regras: tudo.regras.map(r => ({
      ...r, ativo: ativo(r.ativo), percentual: Number(r.percentual),
      beneficiario: r.tipo === 'royalty' ? DESENHISTA_DA_PECA : r.beneficiario,
      alvo: r.escopo === 'cliente' ? (nomeCliente.get(String(r.cliente_id)) || `cliente ${r.cliente_id}`)
        : r.escopo === 'pedido' ? `Pedido ${numeroPedido.get(String(r.pedido_id)) || r.pedido_id}` : ESCOPOS.todos
    })),
    etapas: tudo.etapas,
    // Compatibilidade com a tela da fase G (setores): os processos com o nome antigo dos campos.
    setores: tudo.etapas.map(e => ({ id: e.id, nome: e.nome, ordem: e.ordem, ativo: e.producao_ativa })),
    valores: valoresNovos.map(v => ({
      id: v.id, etapa_id: v.etapa_id, produto_id: v.produto_id ?? null, tipo: v.tipo === 'percentual' ? 'percentual' : 'valor',
      valor_unitario: c.centavos(v.valor_unitario), percentual: v.percentual === null || v.percentual === undefined ? null : Number(v.percentual),
      descricao: descreverValor(v), observacao: v.observacao || null,
      produto: v.produto_id ? (nomeProduto.get(String(v.produto_id)) || `peça ${v.produto_id}`) : null,
      etapa: (tudo.etapas.find(e => String(e.id) === String(v.etapa_id)) || {}).nome || null,
      // Nome antigo, para quem ainda lê `setor`.
      setor_id: v.etapa_id, setor: (tudo.etapas.find(e => String(e.id) === String(v.etapa_id)) || {}).nome || null
    })),
    donos: await donosDeClientes(api),
    feriados: tudo.feriados,
    feriados_nacionais: [...calendario.feriadosNacionais(ano), ...calendario.feriadosNacionais(ano + 1)]
  };
}

// ------------------------------------------------------------- validação

function validarRegra(entrada) {
  const tipo = String(entrada?.tipo || '');
  if (!TIPOS_REGRA[tipo]) throw c.erro('Escolha se a regra é de CMS ou de Royalty.');
  const beneficiario = tipo === 'royalty' ? null : c.texto(entrada?.beneficiario, 120);
  if (tipo === 'cms' && beneficiario.length < 2) throw c.erro('Escolha o dono de cliente que recebe a CMS.');
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
  && (a.tipo === 'royalty' || semAcento(a.beneficiario) === semAcento(b.beneficiario));

const alcance = r => (r.escopo === 'todos' ? 'todos os pedidos' : r.escopo === 'cliente' ? `cliente ${r.cliente_id}` : `pedido ${r.pedido_id}`);
const descreverRegra = r => (r.tipo === 'royalty'
  ? `Royalty ${String(r.percentual).replace('.', ',')}% para o desenhista de cada peça (${alcance(r)})`
  : `CMS ${String(r.percentual).replace('.', ',')}% para ${r.beneficiario} (${alcance(r)})`);

/** CMS só para dono de cliente — e, no cliente ou no pedido, só para o dono DAQUELE cliente. */
async function conferirDonoDaRegra(api, regra) {
  if (regra.tipo !== 'cms') return;
  const donos = await donosDeClientes(api);
  if (!donos.some(d => mesmoNome(d, regra.beneficiario))) {
    throw c.erro(`${regra.beneficiario} não é dono de nenhum cliente: a CMS só vai para o dono do cliente.`, 422);
  }
  let clienteId = regra.cliente_id;
  if (regra.escopo === 'pedido') {
    const pedido = c.lista(await api.get('/api/pedidos', { query: { id: regra.pedido_id } }).catch(() => [])).find(p => String(p?.id) === String(regra.pedido_id));
    if (!pedido) throw c.erro('Pedido da regra não encontrado.', 404);
    clienteId = pedido.cliente_id;
  }
  if (regra.escopo === 'todos') return;
  const cliente = c.lista(await api.get('/api/clientes', { query: { id: clienteId, select: 'id,dono_cliente,nome_fantasia,razao_social' } }).catch(() => []))
    .find(x => String(x?.id) === String(clienteId));
  if (!cliente || !mesmoNome(cliente.dono_cliente, regra.beneficiario)) {
    throw c.erro(`${c.nomeDoCliente(cliente) || 'Este cliente'} não é de ${regra.beneficiario}: a CMS só vale nos clientes do próprio dono.`, 422);
  }
}

// ---------------------------------------------------------------- escrita

async function salvarRegra({ api, id = null, entrada, usuarioId = null }) {
  const nova = validarRegra(entrada);
  const regras = await c.ler(api, 'comissao_regras');
  const atual = id ? regras.find(r => String(r.id) === String(id)) : null;
  if (id && !atual) throw c.erro('Regra não encontrada.', 404);
  if (nova.ativo && regras.some(r => ativo(r.ativo) && String(r.id) !== String(id) && mesmaRegra(r, nova))) {
    throw c.erro(nova.tipo === 'royalty'
      ? 'Já existe uma regra ativa de Royalty neste alcance. Altere a que existe.'
      : `Já existe uma regra ativa de CMS para ${nova.beneficiario} neste alcance. Altere a que existe.`, 409);
  }
  if (nova.ativo) await conferirDonoDaRegra(api, nova);
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

/** (Fase G) Setores de produção — ficaram no banco, sem uso na tela. */
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

// ------------------------------------------------------------- processos

/** Linhas de uma tabela cujo campo de texto tem o nome (a API ignora filtro desconhecido: confere aqui). */
async function linhasComNome(api, tabela, campo, nome, select) {
  const linhas = c.lista(await api.get(`/api/${tabela}`, { query: { [campo]: nome, ...(select ? { select } : {}) } }).catch(() => []));
  return linhas.filter(l => l && String(l[campo] ?? '').trim() === nome);
}

/**
 * Inclui um processo (no fim da ordem), renomeia ou liga/desliga o pagamento.
 * Renomear troca o nome também nos insumos da matéria-prima, nos lotes do
 * estoque e nos itens faltantes, que guardam o processo pelo nome.
 */
async function salvarEtapa({ api, id = null, entrada, usuarioId = null }) {
  const etapas = await lerEtapas(api);
  const atual = id ? etapas.find(e => String(e.id) === String(id)) : null;
  if (id && !atual) throw c.erro('Processo não encontrado.', 404);
  const nome = entrada?.nome === undefined && atual ? atual.nome : c.texto(entrada?.nome, 60);
  if (nome.length < 2) throw c.erro('Dê um nome ao processo.');
  if (etapas.some(e => String(e.id) !== String(id) && semAcento(e.nome) === semAcento(nome))) throw c.erro(`Já existe o processo ${nome}.`, 409);
  const producaoAtiva = entrada?.producao_ativa === undefined ? (atual ? atual.producao_ativa : true) : ativo(entrada.producao_ativa);

  if (!atual) {
    const ordem = etapas.reduce((m, e) => Math.max(m, e.ordem), 0) + 1;
    const criado = await api.post('/api/etapas_producao', { nome, ordem, producao_ativa: producaoAtiva });
    const novoId = criado?.id ?? criado?.[0]?.id ?? null;
    await auditoria.registrar(api, { tipo: 'setor_alterado', descricao: `Processo ${nome} incluído`, referenciaId: novoId, usuarioId });
    return { id: novoId, nome, ordem, producao_ativa: producaoAtiva };
  }

  const renomeado = atual.nome !== nome;
  let atualizados = 0;
  if (renomeado) {
    for (const [tabela, campo] of [['materia_prima', 'processo'], ['produtos_em_cada_ponto', 'etapa_id'], ['pedidos_itens_faltantes', 'processo']]) {
      const linhas = await linhasComNome(api, tabela, campo, atual.nome, `id,${campo}`);
      for (const l of linhas) {
        if (l.id === null || l.id === undefined) continue;
        await api.put(`/api/${tabela}/${l.id}`, { [campo]: nome });
        atualizados += 1;
      }
    }
  }
  await api.put(`/api/etapas_producao/${atual.id}`, { nome, ordem: atual.ordem, producao_ativa: producaoAtiva });
  const partes = [];
  if (renomeado) partes.push(`${atual.nome} passou a se chamar ${nome}${atualizados ? ` (${atualizados} registro(s) de matéria-prima e estoque acompanharam)` : ''}`);
  if (producaoAtiva !== atual.producao_ativa) partes.push(`${nome}: pagamento de produção ${producaoAtiva ? 'ligado' : 'desligado'}`);
  if (partes.length) await auditoria.registrar(api, { tipo: 'setor_alterado', descricao: partes.join('; '), referenciaId: atual.id, usuarioId });
  return { ...atual, nome, producao_ativa: producaoAtiva, registros_renomeados: atualizados };
}

/** Exclui o processo — só se nenhum insumo da matéria-prima o usa. */
async function removerEtapa({ api, id, usuarioId = null }) {
  const etapas = await lerEtapas(api);
  const alvo = etapas.find(e => String(e.id) === String(id));
  if (!alvo) throw c.erro('Processo não encontrado.', 404);
  const insumos = await linhasComNome(api, 'materia_prima', 'processo', alvo.nome, 'id,processo');
  if (insumos.length) {
    throw c.erro(`${alvo.nome} é o processo de ${c.plural(insumos.length, 'insumo', 'insumos')} da matéria-prima: troque o processo deles antes de excluir.`, 409, { dependente: true });
  }
  await api.delete(`/api/etapas_producao/${alvo.id}`);
  let ordem = 1;
  for (const e of etapas.filter(x => String(x.id) !== String(alvo.id))) {
    if (e.ordem !== ordem) await api.put(`/api/etapas_producao/${e.id}`, { nome: e.nome, ordem, producao_ativa: e.producao_ativa }).catch(() => {});
    ordem += 1;
  }
  await auditoria.registrar(api, { tipo: 'setor_alterado', descricao: `Processo ${alvo.nome} excluído`, referenciaId: alvo.id, usuarioId });
  return true;
}

/** Valor de um processo lido da entrada: { tipo, valor_unitario, percentual }. */
function lerValorDaEntrada(entrada) {
  const tipo = entrada?.tipo === 'percentual' ? 'percentual' : 'valor';
  if (tipo === 'percentual') {
    const bruto = String(entrada?.percentual ?? entrada?.valor ?? '').trim().replace(/[\s%]/g, '').replace(',', '.');
    const p = Number(bruto);
    if (!bruto || !Number.isFinite(p) || p < 0 || p > 100) throw c.erro('O percentual vai de 0 a 100.');
    return { tipo, valor_unitario: 0, percentual: Math.round(p * 10000) / 10000 };
  }
  const bruto = String(entrada?.valor_unitario ?? entrada?.valor ?? '').trim().replace(/\s|R\$/g, '');
  const normal = bruto.includes(',') ? bruto.replace(/\./g, '').replace(',', '.') : bruto;
  if (!normal || !Number.isFinite(Number(normal)) || Number(normal) < 0) throw c.erro('Informe o valor por peça.');
  return { tipo, valor_unitario: c.centavos(normal), percentual: null };
}

/**
 * Valor de um processo: um por processo e peça (ou o padrão do processo, sem
 * peça). Gravar de novo o mesmo par troca o valor; `remover` desliga a linha.
 */
async function salvarValor({ api, entrada, usuarioId = null, valores = null, etapas = null }) {
  const etapaId = Number(entrada?.etapa_id ?? entrada?.setor_id);
  const listaEtapas = etapas || await lerEtapas(api);
  const etapa = listaEtapas.find(e => Number(e.id) === etapaId);
  if (!etapa) throw c.erro('Escolha o processo.');
  const produtoId = entrada?.produto_id === null || entrada?.produto_id === undefined || entrada?.produto_id === '' ? null : Number(entrada.produto_id);
  if (produtoId !== null && !(Number.isInteger(produtoId) && produtoId > 0)) throw c.erro('Peça inválida.');
  const todos = valores || await c.ler(api, 'producao_valores');
  const atual = todos.find(v => ativo(v.ativo) && v.etapa_id !== null && v.etapa_id !== undefined && Number(v.etapa_id) === etapaId && String(v.produto_id ?? '') === String(produtoId ?? '')) || null;
  const alvo = produtoId === null ? `padrão de ${etapa.nome}` : `peça ${produtoId} em ${etapa.nome}`;
  const quando = c.agora();

  if (entrada?.remover === true) {
    if (!atual) return null;
    await c.atualizar(api, 'producao_valores', atual.id, { ativo: false, atualizado_por: usuarioId, atualizado_em: quando });
    await auditoria.registrar(api, { tipo: 'valor_producao', descricao: `Valor ${alvo} removido (era ${descreverValor(atual)})`, referenciaId: atual.id, usuarioId });
    return null;
  }
  const lido = lerValorDaEntrada(entrada);
  const observacao = c.texto(entrada?.observacao, 300) || null;
  const novo = { ...lido };
  if (atual) {
    const igual = (atual.tipo === 'percentual' ? 'percentual' : 'valor') === novo.tipo
      && (novo.tipo === 'percentual' ? Number(atual.percentual) === novo.percentual : c.centavos(atual.valor_unitario) === novo.valor_unitario);
    if (igual && (atual.observacao || null) === observacao) return { ...atual };
    await c.atualizar(api, 'producao_valores', atual.id, { ...novo, observacao, atualizado_por: usuarioId, atualizado_em: quando });
    await auditoria.registrar(api, { tipo: 'valor_producao', descricao: `Valor ${alvo}: ${descreverValor(atual)} → ${descreverValor(novo)}`, referenciaId: atual.id, usuarioId, dados: { antes: descreverValor(atual), depois: descreverValor(novo) } });
    return { ...atual, ...novo, observacao };
  }
  const criado = await c.inserir(api, 'producao_valores', {
    setor_id: null, etapa_id: etapaId, produto_id: produtoId, ...novo, ativo: true, observacao,
    criado_por: usuarioId, criado_em: quando, atualizado_por: usuarioId, atualizado_em: quando
  });
  await auditoria.registrar(api, { tipo: 'valor_producao', descricao: `Valor ${alvo}: ${descreverValor(novo)}`, referenciaId: criado.id, usuarioId, dados: { depois: descreverValor(novo) } });
  return criado;
}

// --------------------------------------------------- regra de uma peça

/** Quantos insumos de cada processo a peça tem (a rota gravada). */
async function processosDaPecaNoBanco(api, produtoId) {
  const [passos, insumos] = await Promise.all([
    c.lista(await api.get('/api/produtos_insumos', { query: { produto_id: produtoId } }).catch(() => [])),
    c.lista(await api.get('/api/materia_prima', { query: { select: 'id,processo' } }).catch(() => []))
  ]);
  const processoDe = new Map(insumos.map(m => [String(m.id), String(m.processo || '').trim()]));
  const contagem = new Map();
  for (const p of passos.filter(x => String(x?.produto_id) === String(produtoId))) {
    const nome = processoDe.get(String(p.insumo_id));
    if (!nome) continue;
    contagem.set(nome, (contagem.get(nome) || 0) + 1);
  }
  return [...contagem].map(([nome, n]) => ({ nome, insumos: n }));
}

async function precoDaTabela(api, produtoId) {
  const linhas = c.lista(await api.get('/api/tabela_fixa', { query: { id_prod: produtoId } }).catch(() => []));
  const linha = linhas.find(l => String(l?.id_prod) === String(produtoId));
  const n = Number(linha?.vlr_prod);
  return Number.isFinite(n) && n > 0 ? c.centavos(n) : null;
}

const regraParaTela = r => (r ? { tipo: r.tipo, valor: r.valor, percentual: r.percentual, origem: r.origem, descricao: unidades.descreverRegra(r) } : null);

/**
 * O que o botão "Regra Produção" do cadastro da peça mostra: os processos, o
 * padrão de cada um e o valor próprio da peça (quando ela já existe).
 */
async function regraDaPeca(api, produtoId = null) {
  const [etapas, valores] = await Promise.all([lerEtapas(api), c.ler(api, 'producao_valores')]);
  const id = produtoId === null || produtoId === undefined || produtoId === '' ? null : Number(produtoId);
  const [processos, preco] = id ? await Promise.all([processosDaPecaNoBanco(api, id), precoDaTabela(api, id)]) : [[], null];
  return {
    produto_id: id,
    preco_tabela: preco,
    etapas: etapas.map(e => {
      const padrao = unidades.regraDaPeca(valores.filter(v => v.produto_id === null || v.produto_id === undefined), null, e.id);
      const todas = unidades.regraDaPeca(valores, id, e.id);
      return {
        id: e.id, nome: e.nome, ordem: e.ordem, producao_ativa: e.producao_ativa,
        padrao: regraParaTela(padrao),
        da_peca: todas && todas.origem === 'peca' ? regraParaTela(todas) : null
      };
    }),
    processos
  };
}

/**
 * Grava a regra da peça (junto do Registrar/Salvar do cadastro).
 * `valores`: [{ etapa_id, modo: 'padrao' | 'valor' | 'percentual', valor }].
 * No fim confere: todo processo com insumo na peça, e pagando, tem valor.
 */
async function salvarRegraDaPeca({ api, produtoId, valores = [], usuarioId = null }) {
  const id = Number(produtoId);
  if (!(Number.isInteger(id) && id > 0)) throw c.erro('Peça inválida.');
  const produto = c.lista(await api.get('/api/produtos', { query: { id, select: 'id,codigo,nome' } }).catch(() => [])).find(p => Number(p?.id) === id);
  if (!produto) throw c.erro('Peça não encontrada.', 404);
  const etapas = await lerEtapas(api);
  let atuais = await c.ler(api, 'producao_valores');
  for (const v of Array.isArray(valores) ? valores : []) {
    const etapaId = Number(v?.etapa_id);
    if (!etapas.some(e => Number(e.id) === etapaId)) throw c.erro('Um dos processos da regra não existe mais. Reabra a Regra Produção.', 422);
    const modo = String(v?.modo || 'padrao');
    if (modo === 'padrao') {
      await salvarValor({ api, entrada: { etapa_id: etapaId, produto_id: id, remover: true }, usuarioId, valores: atuais, etapas });
    } else {
      await salvarValor({ api, entrada: { etapa_id: etapaId, produto_id: id, tipo: modo === 'percentual' ? 'percentual' : 'valor', valor: v?.valor }, usuarioId, valores: atuais, etapas });
    }
    atuais = await c.ler(api, 'producao_valores');
  }
  const processos = await processosDaPecaNoBanco(api, id);
  const { usados, faltam } = unidades.pendenciasDaPeca({ processos, etapas, valores: atuais, produtoId: id });
  return {
    produto_id: id, completa: !faltam.length, faltam,
    processos: usados.map(u => ({ ...u, regra: regraParaTela(u.regra) }))
  };
}

// ------------------------------------------------------ calendário e prazos

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
  TIPOS_REGRA, ESCOPOS, SQL_PROCESSOS, DESENHISTA_DA_PECA, ativo,
  taxasDoPedido, valoresSobre, valorUnitario, validarRegra,
  lerConfiguracao, lerEtapas, lerTudo, donosDeClientes, paraTela,
  salvarRegra, salvarSetor, salvarEtapa, removerEtapa, salvarValor,
  processosDaPecaNoBanco, precoDaTabela, regraDaPeca, salvarRegraDaPeca,
  adicionarFeriado, removerFeriado, salvarConfiguracao
};
