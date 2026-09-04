/**
 * Tabela fixa de preços (`tabela_fixa`).
 *
 * A peça tem DOIS preços e eles não se confundem:
 *
 *   produtos.preco_venda  → preço CALCULADO. Sobe e desce sozinho toda vez que
 *                           um insumo muda de custo. É o custo apurado da peça.
 *   tabela_fixa.vlr_prod  → preço PRATICADO. Só muda quando alguém marca
 *                           "Atualizar Tabela Fixa" ao salvar o produto.
 *
 * Quem vende lê o preço praticado; quem calcula lê o preço apurado. Sem essa
 * separação, reajustar um insumo mudaria silenciosamente o valor de todos os
 * orçamentos em aberto — foi exatamente isso que a tabela fixa veio impedir.
 *
 * Colunas: id_prod (PK, = produtos.id), cod_prod, vlr_prod.
 */
const pool = require('./db');
const { paraDecimal } = require('./numeros');
const descontos = require('./descontos');

const ENDPOINT = '/tabela_fixa';
const ORCAMENTOS_ITENS = '/orcamentos_itens';
const ORCAMENTOS = '/orcamentos';

/**
 * Situações em que o orçamento ainda é uma proposta viva e, portanto, deve
 * acompanhar o preço de tabela. "Aprovado", "Rejeitado" e "Expirado" ficam de
 * fora: já foram para o cliente com um número, e pedido não se remarca.
 */
const SITUACOES_ABERTAS = ['Rascunho', 'Pendente'];

function comoLista(dados) {
  return Array.isArray(dados) ? dados : [];
}

function idNumerico(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

/** Converte para decimal aceitando "1.234,56"; devolve null se não der. */
function valorNumerico(valor) {
  if (valor === undefined || valor === null || String(valor).trim() === '') return null;
  const numero = paraDecimal(valor);
  return Number.isFinite(numero) ? numero : null;
}

// --------------------------------------------------------------- leitura

/** Todas as linhas da tabela fixa. */
async function listarTabelaFixa() {
  const dados = await pool.get(ENDPOINT).catch(err => {
    console.error('[tabelaFixa] Falha ao listar:', err?.message || err);
    return [];
  });
  return comoLista(dados);
}

/**
 * Mapa id_prod → valor, que é o formato que todo consumidor quer: a lista de
 * produtos, os orçamentos e os relatórios cruzam por id, não varrem a tabela.
 */
async function mapaDePrecos() {
  const linhas = await listarTabelaFixa();
  const mapa = new Map();
  for (const linha of linhas) {
    const id = idNumerico(linha?.id_prod);
    if (id === null) continue;
    mapa.set(id, valorNumerico(linha?.vlr_prod));
  }
  return mapa;
}

/** Linha da tabela fixa de um produto, ou null. */
async function obterPrecoTabela(produtoId) {
  const id = idNumerico(produtoId);
  if (id === null) return null;
  const dados = await pool.get(ENDPOINT, { query: { id_prod: id, limit: 1 } }).catch(() => []);
  const [linha] = comoLista(dados);
  return linha || null;
}

/**
 * Acopla `preco_tabela` a uma lista de produtos já carregada.
 * Produto sem linha na tabela fixa fica com `null` — e null é diferente de
 * zero: a tela mostra célula vazia e o orçamento recusa o item.
 */
async function anexarPrecoTabela(produtos = []) {
  const lista = comoLista(produtos);
  if (!lista.length) return lista;
  const mapa = await mapaDePrecos();
  return lista.map(produto => {
    const id = idNumerico(produto?.id);
    return {
      ...produto,
      preco_tabela: id !== null && mapa.has(id) ? mapa.get(id) : null
    };
  });
}

// --------------------------------------------------------------- escrita

/**
 * Cria a linha da peça na tabela fixa. Usado no cadastro do produto: peça
 * nova nasce com preço praticado igual ao calculado.
 *
 * Nunca derruba o cadastro: se a tabela fixa falhar, o produto continua
 * criado e o erro vai para o log — o preço se preenche depois pela edição,
 * mas um cadastro perdido o usuário teria de refazer inteiro.
 */
async function registrarPrecoTabela({ produtoId, codigo, valor }) {
  const id = idNumerico(produtoId);
  if (id === null) return null;

  const jaExiste = await obterPrecoTabela(id);
  if (jaExiste) return jaExiste;

  try {
    return await pool.post(ENDPOINT, {
      id_prod: id,
      cod_prod: codigo != null ? String(codigo) : null,
      vlr_prod: valorNumerico(valor) ?? 0
    });
  } catch (err) {
    console.error('[tabelaFixa] Falha ao registrar preço do produto', id, err?.message || err);
    return null;
  }
}

/**
 * Grava o preço praticado e repassa para os orçamentos ainda abertos.
 * Só é chamada quando o usuário escolheu "Atualizar Tabela Fixa".
 *
 * Devolve o resumo do que mudou para a tela poder avisar quantos orçamentos
 * foram remarcados.
 */
async function gravarPrecoTabela({ produtoId, codigo, valor }) {
  const id = idNumerico(produtoId);
  if (id === null) {
    const err = new Error('produto_id é obrigatório para gravar na tabela fixa');
    err.code = 'TABELA_FIXA_ID_OBRIGATORIO';
    throw err;
  }

  const novoValor = valorNumerico(valor);
  if (novoValor === null) {
    const err = new Error('Valor inválido para a tabela fixa');
    err.code = 'TABELA_FIXA_VALOR_INVALIDO';
    throw err;
  }

  const atual = await obterPrecoTabela(id);
  const payload = {
    id_prod: id,
    cod_prod: codigo != null ? String(codigo) : (atual?.cod_prod ?? null),
    vlr_prod: novoValor
  };

  // A linha é identificada por id_prod (PK). Atualiza se existe, cria se não —
  // o produto pode ser anterior à tabela fixa e ainda não ter linha.
  if (atual) {
    await pool.put(`${ENDPOINT}/${id}`, payload);
  } else {
    await pool.post(ENDPOINT, payload);
  }

  const orcamentosAtualizados = await propagarParaOrcamentosAbertos(id, novoValor);
  return { produtoId: id, valor: novoValor, orcamentosAtualizados };
}

/**
 * Põe o CÓDIGO da linha em dia, sem encostar no preço.
 *
 * POR QUE O CÓDIGO NÃO PODE DEPENDER DA ESCOLHA
 * ---------------------------------------------
 * "Atualizar Tabela Fixa" é uma decisão sobre PREÇO: reprecificar ou não o que
 * já foi proposto ao cliente. O código não é preço — é a identidade da peça, e
 * ela mudou de fato.
 *
 * Só que quem gravava aqui era `gravarPrecoTabela`, que escreve as duas
 * colunas de uma vez e só roda quando a pessoa marca a opção. Editar o código
 * e NÃO marcar deixava `cod_prod` apontando para um código que não existe mais
 * — e nada na tela dizia isso, porque a tabela fixa é lida por `id_prod` em
 * todo o resto do sistema. A divergência só aparecia para quem fosse ler a
 * tabela pelo código.
 *
 * NÃO CRIA LINHA
 * --------------
 * Peça sem linha na tabela fixa é peça SEM preço praticado, e o sistema inteiro
 * conta com isso (ver `anexarPrecoTabela`: null, não zero). Criar uma linha
 * aqui só para carregar o código novo inventaria um preço de zero — que não é
 * "sem preço", é uma venda de graça que ninguém aprovou.
 *
 * NÃO DERRUBA O SALVAMENTO
 * ------------------------
 * A peça já foi gravada quando isto roda. Uma falha aqui vira log e resultado
 * devolvido ao chamador, como em `registrarPrecoTabela` — perder a edição
 * inteira por causa de uma coluna de código seria trocar um problema pequeno
 * por um grande.
 */
async function sincronizarCodigo({ produtoId, codigo }) {
  const id = idNumerico(produtoId);
  if (id === null) return null;

  const atual = await obterPrecoTabela(id);
  if (!atual) return null;

  const novo = codigo != null ? String(codigo) : null;
  const gravado = atual.cod_prod != null ? String(atual.cod_prod) : null;
  if (gravado === novo) return null;

  try {
    await pool.put(`${ENDPOINT}/${id}`, { cod_prod: novo });
    return { produtoId: id, de: gravado, para: novo };
  } catch (err) {
    console.error('[tabelaFixa] Falha ao sincronizar o código do produto', id, err?.message || err);
    return null;
  }
}

/** Remove a linha da peça — chamado junto da exclusão do produto. */
async function removerPrecoTabela(produtoId) {
  const id = idNumerico(produtoId);
  if (id === null) return;
  await pool.delete(`${ENDPOINT}/${id}`).catch(err => {
    console.error('[tabelaFixa] Falha ao remover preço do produto', id, err?.message || err);
  });
}

// ------------------------------------------------------------ propagação

/**
 * Recalcula o item mantendo os PERCENTUAIS de desconto que já estavam nele.
 *
 * O desconto é guardado em percentual E em reais. Se só o unitário mudasse,
 * o valor em reais ficaria descolado do percentual e a soma das linhas não
 * fecharia com o total do orçamento.
 *
 * A convenção das colunas (quais são por unidade e quais são da linha) mora
 * em backend/descontos.js — errá-la produz números plausíveis e errados.
 */
function recalcularItem(item, novoUnitario) {
  return descontos.calcularItem({
    valorUnitario: novoUnitario,
    quantidade: item?.quantidade,
    pctPagamento: item?.desconto_pagamento_prc,
    pctEspecial: item?.desconto_especial_prc
  });
}

/**
 * Repassa o novo preço para os itens de orçamentos em Rascunho/Pendente.
 *
 * Pedido nunca entra aqui: quando o orçamento vira pedido o preço é copiado
 * para `pedidos_itens`, e aquele número é o que foi combinado com o cliente.
 */
async function propagarParaOrcamentosAbertos(produtoId, novoValor) {
  const id = idNumerico(produtoId);
  if (id === null) return 0;

  const itens = comoLista(
    await pool.get(ORCAMENTOS_ITENS, { query: { produto_id: id } }).catch(() => [])
  );
  if (!itens.length) return 0;

  // Descobre a situação de cada orçamento envolvido antes de escrever: filtrar
  // por situação no upstream exigiria o operador `in`, que este cliente barra.
  const orcamentoIds = [...new Set(itens.map(item => item?.orcamento_id).filter(v => v != null))];
  const abertos = new Set();
  await Promise.all(
    orcamentoIds.map(async orcamentoId => {
      const dados = await pool
        .get(ORCAMENTOS, { query: { id: orcamentoId, select: 'id,situacao', limit: 1 } })
        .catch(() => []);
      const [orcamento] = comoLista(dados);
      if (orcamento && SITUACOES_ABERTAS.includes(String(orcamento.situacao))) {
        abertos.add(String(orcamentoId));
      }
    })
  );

  if (!abertos.size) return 0;

  const alvos = itens.filter(item => abertos.has(String(item?.orcamento_id)));
  await Promise.all(
    alvos.map(item =>
      pool.put(`${ORCAMENTOS_ITENS}/${item.id}`, recalcularItem(item, novoValor)).catch(err => {
        console.error('[tabelaFixa] Falha ao repassar preço ao item', item?.id, err?.message || err);
      })
    )
  );

  return abertos.size;
}

module.exports = {
  SITUACOES_ABERTAS,
  listarTabelaFixa,
  mapaDePrecos,
  obterPrecoTabela,
  anexarPrecoTabela,
  registrarPrecoTabela,
  gravarPrecoTabela,
  sincronizarCodigo,
  removerPrecoTabela,
  propagarParaOrcamentosAbertos,
  recalcularItem
};
