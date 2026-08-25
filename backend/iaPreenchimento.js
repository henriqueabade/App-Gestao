// A carga que ABRE UM MODAL JÁ PREENCHIDO, a partir de um item lido.
//
// ---------------------------------------------------------------------------
// POR QUE ESTE ARQUIVO EXISTE
//
// A leitura de IA não grava nada. Ela prepara o formulário que a pessoa já
// conhece e devolve o controle: quem confere, corrige e salva é o usuário, no
// modal do módulo de destino, com a validação daquele módulo valendo.
//
// Isso muda onde mora a dificuldade. Preencher "nome" e "quantidade" é trivial
// e poderia ser feito no navegador. O que NÃO pode ser feito lá é resolver
// IDENTIDADE: a ficha técnica diz "MDF 06", e o formulário de produto precisa
// do `insumo_id`, do preço unitário e da unidade daquele insumo no cadastro.
// Descobrir isso no renderer significaria baixar a matéria-prima inteira e
// repetir, em JavaScript de tela, a mesma normalização de nome que o aplicador
// já faz aqui — dois lugares para a mesma regra, e um deles sem teste.
//
// Então a divisão é esta:
//
//   backend (aqui) ..... resolve IDENTIDADE — insumo_id, produto_id, o alvo, e
//                        diz o que não encontrou;
//   front .............. resolve APRESENTAÇÃO — em que campo cada valor entra e
//                        como formatá-lo, com os mesmos utilitários que o
//                        módulo de destino já usa.
//
// ---------------------------------------------------------------------------
// O QUE NÃO É ENCONTRADO NÃO É INVENTADO
//
// Insumo que não está na matéria-prima, produto que não está no catálogo: a
// linha NÃO entra no formulário e o nome dela volta em `avisos`. Preencher com
// um id chutado seria o pior desfecho possível — o formulário abriria completo,
// o usuário salvaria confiando, e a peça ficaria com o material errado na
// receita.
//
// A perda precisa doer na hora certa: antes de salvar, na tela, com o nome do
// que faltou escrito.

const { normalizar } = require('./iaReconciliacao');
const esquemas = require('./iaEsquemas');

/** Modal de destino de cada leitura. */
const MODAIS = {
  materia_prima: {
    overlay: 'novoInsumo',
    html: 'modals/materia-prima/novo.html',
    script: '../js/modals/materia-prima-novo.js',
    rotulo: 'Novo Insumo'
  },
  clientes: {
    overlay: 'novoCliente',
    html: 'modals/clientes/novo.html',
    script: '../js/modals/cliente-novo.js',
    rotulo: 'Novo Cliente'
  },
  prospeccoes: {
    overlay: 'novaProspeccao',
    html: 'modals/prospeccoes/novo.html',
    script: '../js/modals/prospeccao-novo.js',
    rotulo: 'Nova Prospecção'
  },
  produto_insumos: {
    overlay: 'novoProduto',
    html: 'modals/produtos/novo.html',
    script: '../js/modals/produto-novo.js',
    rotulo: 'Novo Produto'
  },
  orcamentos: {
    overlay: 'novoOrcamento',
    html: 'modals/orcamentos/novo.html',
    script: '../js/modals/orcamento-novo.js',
    rotulo: 'Novo Orçamento'
  }
};

/**
 * Sigla -> nome do estado.
 *
 * O documento escreve "RS"; o formulário tem um <select> cujas opções são os
 * nomes por extenso ("Rio Grande do Sul"), porque vêm de um serviço de geografia
 * internacional. Mandar a sigla para lá não seleciona nada e não dá erro: o
 * campo simplesmente fica vazio, e o endereço chega ao cadastro sem estado.
 *
 * A tabela vive aqui, e não na tela, porque é o backend que monta a carga — e
 * porque uma lista de 27 linhas que não muda é mais barata de manter do que uma
 * consulta a mais em cada preenchimento.
 */
const ESTADOS = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia',
  CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás',
  MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul',
  MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná',
  PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia',
  RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo',
  SE: 'Sergipe', TO: 'Tocantins'
};

const lista = r => (Array.isArray(r) ? r : []);
const texto = v => (v === null || v === undefined ? '' : String(v));

/** Índice por nome normalizado; a primeira ocorrência ganha. */
function indexarPor(registros, campo) {
  const mapa = new Map();
  for (const r of registros) {
    const chave = normalizar(r && r[campo]);
    if (chave && !mapa.has(chave)) mapa.set(chave, r);
  }
  return mapa;
}

/**
 * Insumos de uma ficha técnica, prontos para a tabela do formulário de produto.
 *
 * Três coisas que a ficha tem, o formulário precisa, e que se perdiam:
 *
 *   `processo`  a ficha é escrita em blocos de etapa (MARCENARIA, ACABAMENTO,
 *               MONTAGEM, EMBALAGEM) e a tabela do produto AGRUPA por eles. Sem
 *               o processo, os 23 insumos caíam num monte só chamado "—", que
 *               não se parece em nada com o papel que a pessoa tem na mão.
 *
 *   `ordem`     dentro da etapa, a sequência é a ordem de produção. Ela vem da
 *               posição no documento — não de nome, não de id.
 *
 *   `preco_unitario` e `unidade` vêm do CADASTRO, não do documento: são eles
 *               que fazem o custo do produto bater. A unidade lida ("m2", "ml")
 *               serve para conferir, e por isso volta em `avisos` quando
 *               diverge da cadastrada: ali a divergência é erro de custo, não
 *               diferença de escrita.
 */
function montarInsumos(linhas, porNome) {
  const itens = [];
  const semCadastro = [];
  const unidadeDiferente = [];
  let ordem = 0;

  for (const linha of linhas) {
    const nome = texto(linha && linha.nome).trim();
    if (!nome) continue;

    const insumo = porNome.get(normalizar(nome));
    if (!insumo) { semCadastro.push(nome); continue; }

    const quantidade = Number(linha.quantidade);
    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      semCadastro.push(`${nome} (quantidade não reconhecida)`);
      continue;
    }

    const lida = texto(linha.unidade).trim();
    if (lida && insumo.unidade && normalizar(lida) !== normalizar(insumo.unidade)) {
      unidadeDiferente.push(`${nome}: documento diz "${lida}", cadastro diz "${insumo.unidade}"`);
    }

    ordem += 1;
    itens.push({
      insumo_id: Number(insumo.id),
      nome: insumo.nome,
      // A etapa vem do documento quando ele diz, e do cadastro quando não diz:
      // o insumo já nasce com um processo em Matéria-prima.
      processo: texto(linha.processo).trim() || texto(insumo.processo).trim() || '',
      quantidade,
      unidade: insumo.unidade || lida || '',
      preco_unitario: Number(insumo.preco_unitario) || 0,
      ordem
    });
  }

  return { itens, semCadastro, unidadeDiferente };
}

/** Itens de um pedido, casados com o catálogo de produtos. */
function montarItensDeOrcamento(linhas, porCodigo, porNome) {
  const itens = [];
  const semCadastro = [];

  for (const linha of linhas) {
    const nome = texto(linha && linha.nome).trim();
    if (!nome) continue;

    const produto = porCodigo.get(normalizar(linha.codigo)) || porNome.get(normalizar(nome));
    if (!produto) { semCadastro.push(nome); continue; }

    const quantidade = Number(linha.quantidade);
    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      semCadastro.push(`${nome} (quantidade não reconhecida)`);
      continue;
    }

    // Preço do documento quando existe; preço de tabela quando não. Zero num
    // orçamento é um preço errado que se parece com um preço.
    const lido = Number(linha.valor_unitario);
    const temPreco = Number.isFinite(lido) && lido > 0;

    itens.push({
      produto_id: Number(produto.id),
      codigo: produto.codigo || null,
      nome: produto.nome,
      quantidade,
      valor_unitario: temPreco ? lido : (Number(produto.preco_venda) || 0),
      preco_de_tabela: !temPreco
    });
  }

  return { itens, semCadastro };
}

/** Contatos, sem os vazios que virariam linha em branco no cadastro. */
function montarContatos(linhas) {
  return lista(linhas)
    .filter(c => texto(c && c.nome).trim())
    .map((c, i) => ({
      nome: texto(c.nome).trim(),
      cargo: texto(c.cargo).trim(),
      email: texto(c.email).trim(),
      telefone_celular: texto(c.telefone_celular).trim(),
      telefone_fixo: texto(c.telefone_fixo).trim(),
      // O primeiro é o principal, como em toda criação de empresa no programa.
      principal: i === 0
    }));
}

/**
 * Monta a carga de preenchimento de UM item.
 *
 * Devolve `{ modal, campos, contatos, itens, insumos, alvo, avisos }`.
 *
 * `campos` sai com as chaves do ESQUEMA (nome, cnpj, end_cidade…), nunca com
 * ids de elemento: quem sabe em que caixa cada valor entra é o front, e
 * renomear um campo de formulário não pode obrigar a mexer no backend.
 */
async function montarPreenchimento({ api, destino, item }) {
  const modal = MODAIS[destino];
  if (!modal) {
    const e = new Error(`O destino "${destino}" não tem formulário para abrir.`);
    e.status = 400;
    throw e;
  }

  const esquema = esquemas.obterEsquema(destino);
  const dados = (item && item.dados) || {};
  const avisos = [];

  // Só os campos simples do esquema: as listas têm tratamento próprio abaixo.
  const campos = {};
  for (const campo of esquema.campos) {
    if (campo.tipo === 'lista') continue;
    const valor = dados[campo.chave];
    if (valor !== null && valor !== undefined && valor !== '') campos[campo.chave] = valor;
  }

  // O nome por extenso do estado, para o <select> que não conhece siglas.
  const uf = texto(campos.end_uf).trim().toUpperCase();
  if (ESTADOS[uf]) campos.end_estado_nome = ESTADOS[uf];

  const saida = { modal, campos, alvo: null, avisos };

  if (destino === 'clientes' || destino === 'prospeccoes') {
    saida.contatos = montarContatos(dados.contatos);
    const perdidos = lista(dados.contatos).length - saida.contatos.length;
    if (perdidos > 0) avisos.push(`${perdidos} contato(s) sem nome não entraram`);
  }

  if (destino === 'produto_insumos') {
    const materias = await api.get('/api/materia_prima').then(lista).catch(() => []);
    const r = montarInsumos(lista(dados.insumos), indexarPor(materias, 'nome'));
    saida.insumos = r.itens;
    if (r.semCadastro.length) {
      avisos.push(`Fora da lista, por não estarem em Matéria-prima: ${r.semCadastro.join(', ')}`);
    }
    for (const d of r.unidadeDiferente) avisos.push(`Unidade diferente — ${d}`);
    if (!r.itens.length) avisos.push('Nenhum insumo desta ficha está cadastrado em Matéria-prima.');
  }

  if (destino === 'orcamentos') {
    const produtos = await api.get('/api/produtos').then(lista).catch(() => []);
    const r = montarItensDeOrcamento(
      lista(dados.itens), indexarPor(produtos, 'codigo'), indexarPor(produtos, 'nome'));
    saida.itens = r.itens;
    if (r.semCadastro.length) {
      avisos.push(`Fora do orçamento, por não estarem no catálogo: ${r.semCadastro.join(', ')}`);
    }
    if (r.itens.some(i => i.preco_de_tabela)) {
      avisos.push('Itens sem preço no documento entraram com o preço de tabela — confira.');
    }
  }

  // O vínculo: no orçamento é o cliente ou a prospecção; nos demais é o
  // registro que a leitura reconheceu.
  const alvoId = Number(item && item.alvo_id);
  if (Number.isInteger(alvoId) && alvoId > 0) {
    const tabela = (item && item.alvo_tabela) || esquema.tabelaAlvo;
    const registro = await api.get(`/api/${tabela}/${alvoId}`).catch(() => null);
    const achado = Array.isArray(registro) ? registro[0] : registro;
    if (achado) {
      saida.alvo = {
        tabela,
        id: alvoId,
        nome: achado[esquema.campoDeExibicao] || achado.nome || achado.nome_fantasia || null
      };
    }
  }

  return saida;
}

module.exports = {
  MODAIS,
  ESTADOS,
  montarPreenchimento,
  montarInsumos,
  montarItensDeOrcamento,
  montarContatos,
  indexarPor
};
