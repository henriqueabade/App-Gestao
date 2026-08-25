// O que a IA deve extrair para cada destino, e como a tela de revisão desenha.
//
// Um esquema por destino, em UM lugar só. Ele responde três perguntas de uma
// vez, que sem isso viveriam separadas e sairiam de sincronia:
//
//   1. o que pedir ao modelo (campos e instruções);
//   2. como validar o que ele devolveu (tipo e obrigatoriedade);
//   3. quais colunas a grade de revisão mostra (rótulo e largura).
//
// A grade de revisão é montada a partir daqui, não de HTML escrito à mão. É o
// que permite acrescentar um destino novo sem tocar no front — e o que evita a
// situação clássica de o modelo extrair um campo que a tela não mostra, ou a
// tela pedir um campo que ninguém extraiu.
//
// ---------------------------------------------------------------------------
// TIPOS
//
//   texto    string, cortada no comprimento máximo
//   numero   aceita "1.234,56" e "1,234.56" (ver backend/numeros.js)
//   dinheiro igual a numero; a grade formata com 2 casas
//   data     ISO (aaaa-mm-dd)
//   lista    sub-registros (os contatos de uma empresa, os itens de um
//            orçamento). Traz `subcampos` com o mesmo formato dos campos, e a
//            grade desenha uma sub-tabela sob a linha.
//
// Nenhum tipo é confiado ao modelo: tudo passa por coerção em
// backend/iaEstruturacao.js antes de virar item.
//
// ---------------------------------------------------------------------------
// CHAVES DE CASAMENTO
//
// `chavesDeCasamento` é uma LISTA, em ordem de força. A primeira que existir no
// item decide. Para empresa isso importa: CNPJ é identificador de verdade e
// casa sem dúvida; nome fantasia é apelido — "Marcenaria Serrana" e
// "Marcenaria Serrana Ltda" podem ser a mesma empresa ou duas.
//
// `normalizar` limpa antes de comparar (CNPJ escrito com e sem pontuação é o
// mesmo CNPJ). `forte: true` diz que um empate ali dispensa qualquer ressalva.
//
// ---------------------------------------------------------------------------
// DESTINO QUE SÓ ATUALIZA
//
// `exigeAlvo: true` diz que o destino não cria registro novo — ele só preenche
// algo que já existe. É o caso dos insumos de produto: uma ficha técnica diz de
// que o produto é feito, não quanto ele custa, em que coleção está nem qual é o
// markup. Cadastrar produto a partir dela produziria uma ficha pela metade, com
// preço zero, no meio do catálogo.

/** Só os dígitos: CNPJ com e sem pontuação é o mesmo CNPJ. */
const soDigitos = valor => String(valor ?? '').replace(/\D/g, '');

/**
 * Contatos da empresa. Mesma forma nos dois destinos de empresa, porque as
 * tabelas `contatos_cliente` e `prospeccao_contatos` guardam as mesmas coisas
 * — e um documento não sabe (nem precisa saber) para qual das duas vai.
 */
const CAMPO_CONTATOS = {
  chave: 'contatos',
  rotulo: 'Contatos',
  tipo: 'lista',
  largura: 'media',
  max_itens: 20,
  descricao: 'Pessoas da empresa citadas no documento. Uma entrada por pessoa.',
  subcampos: [
    { chave: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true, max: 150, descricao: 'Nome da pessoa' },
    { chave: 'cargo', rotulo: 'Cargo', tipo: 'texto', max: 100, descricao: 'Função: Compras, Diretor, Sócio…' },
    { chave: 'email', rotulo: 'E-mail', tipo: 'texto', max: 150 },
    { chave: 'telefone_celular', rotulo: 'Celular', tipo: 'texto', max: 40, descricao: 'Telefone móvel/WhatsApp' },
    { chave: 'telefone_fixo', rotulo: 'Fixo', tipo: 'texto', max: 40, descricao: 'Telefone fixo' }
  ]
};

/**
 * Campos da EMPRESA, compartilhados por Clientes e Prospecções.
 *
 * As duas tabelas guardam as mesmas colunas de identificação e endereço. O que
 * muda entre os destinos é o que vem DEPOIS da empresa (etapa e origem só
 * existem em prospecção), então a parte comum fica aqui em vez de ser copiada.
 */
const CAMPOS_EMPRESA = [
  {
    chave: 'nome_fantasia', rotulo: 'Empresa', tipo: 'texto', obrigatorio: true,
    max: 200, largura: 'grande', descricao: 'Nome pelo qual a empresa é conhecida'
  },
  { chave: 'razao_social', rotulo: 'Razão social', tipo: 'texto', max: 200, largura: 'media' },
  {
    chave: 'cnpj', rotulo: 'CNPJ', tipo: 'texto', max: 20, largura: 'media',
    descricao: 'Só o número, com ou sem pontuação. Não invente se não estiver no documento.'
  },
  { chave: 'inscricao_estadual', rotulo: 'Insc. estadual', tipo: 'texto', max: 30, largura: 'media' },
  { chave: 'site', rotulo: 'Site', tipo: 'texto', max: 150, largura: 'media' },
  { chave: 'end_logradouro', rotulo: 'Rua', tipo: 'texto', max: 200, largura: 'media' },
  { chave: 'end_numero', rotulo: 'Nº', tipo: 'texto', max: 20, largura: 'pequena' },
  { chave: 'end_complemento', rotulo: 'Compl.', tipo: 'texto', max: 100, largura: 'pequena' },
  { chave: 'end_bairro', rotulo: 'Bairro', tipo: 'texto', max: 100, largura: 'media' },
  { chave: 'end_cidade', rotulo: 'Cidade', tipo: 'texto', max: 100, largura: 'media' },
  { chave: 'end_uf', rotulo: 'UF', tipo: 'texto', max: 2, largura: 'pequena', descricao: 'Sigla de 2 letras' },
  { chave: 'end_cep', rotulo: 'CEP', tipo: 'texto', max: 15, largura: 'pequena' }
];

/** Instruções comuns à leitura de qualquer documento de empresa. */
const INSTRUCOES_EMPRESA = [
  'Extraia UMA entrada por EMPRESA. As pessoas da empresa vão na lista "contatos" dela.',
  '',
  'Atenção:',
  '- Se o documento citar várias pessoas da MESMA empresa, é uma entrada só, com vários contatos.',
  '- Se citar empresas diferentes, é uma entrada por empresa.',
  '- CNPJ só se estiver escrito. Nunca deduza nem complete.',
  '- UF é a sigla de duas letras ("RS", "SC"), não o nome do estado.',
  '- Separe celular de telefone fixo quando der para distinguir.',
  '- Não invente e-mail a partir do site nem nome a partir do e-mail.'
];

const ESQUEMAS = {
  materia_prima: {
    id: 'materia_prima',
    rotulo: 'Matéria-prima (estoque)',
    tabelaAlvo: 'materia_prima',

    /**
     * Como reconhecer que o item JÁ EXISTE no sistema.
     * Casar por nome é o que a tela de Matéria-prima também faz ao recusar
     * insumo duplicado — usar outro critério aqui criaria dois conceitos de
     * "mesmo insumo" no mesmo programa.
     */
    // `forte` porque, aqui, o nome É a identidade: a própria tela de
    // Matéria-prima recusa cadastrar insumo com nome repetido. Casar por ele
    // não é indício, é certeza — e não merece ressalva na revisão.
    chavesDeCasamento: [{ campo: 'nome', rotulo: 'Insumo', forte: true }],

    /** Coluna que dá nome ao registro nas listas de escolha. */
    campoDeExibicao: 'nome',

    instrucoes: [
      'O documento é uma lista de insumos (matéria-prima): chapas, fitas, ferragens, colas, etc.',
      'Extraia UMA entrada por item da lista.',
      '',
      'Atenção:',
      '- Descrição do item vai em "nome", inteira, do jeito que está escrita.',
      '- "quantidade" é quantas unidades entraram, não o saldo em estoque.',
      '- "preco_unitario" é o preço de UMA unidade. Se só houver o total, divida pela quantidade.',
      '- Ignore linhas de subtotal, total geral, frete, imposto e observação.',
      '- Ignore a linha de cabeçalho da tabela.',
      '- Não invente valor que não está no documento: deixe o campo vazio.'
    ].join('\n'),

    campos: [
      {
        chave: 'nome',
        rotulo: 'Insumo',
        tipo: 'texto',
        obrigatorio: true,
        max: 200,
        largura: 'grande',
        descricao: 'Descrição do insumo, como está escrita no documento'
      },
      {
        chave: 'quantidade',
        rotulo: 'Qtde',
        tipo: 'numero',
        obrigatorio: true,
        largura: 'pequena',
        descricao: 'Quantidade que está entrando'
      },
      {
        chave: 'unidade',
        rotulo: 'Un.',
        tipo: 'texto',
        max: 20,
        largura: 'pequena',
        descricao: 'Unidade de medida: CH, M, M2, UN, KG, L'
      },
      {
        chave: 'preco_unitario',
        rotulo: 'Preço un.',
        tipo: 'dinheiro',
        largura: 'pequena',
        descricao: 'Preço de uma unidade'
      },
      {
        chave: 'categoria',
        rotulo: 'Categoria',
        tipo: 'texto',
        max: 60,
        largura: 'media',
        descricao: 'Tipo do insumo: Chapas, Ferragens, Acabamento, Consumível…'
      },
      {
        chave: 'descricao',
        rotulo: 'Observação',
        tipo: 'texto',
        max: 300,
        largura: 'media',
        descricao: 'Cor, medida, código do fornecedor — o que sobrar de detalhe'
      }
    ],

    /**
     * O que "atualizar" faz neste destino, em palavras.
     *
     * A tela mostra este texto no seletor de ação. Sem ele, "atualizar" é
     * ambíguo justamente onde não pode ser: uma lista de compra diz "40
     * chapas", e não dá para saber sozinho se são 40 que ENTRARAM ou 40 que
     * existem. Aqui a regra fica escrita: entra, soma.
     */
    explicacaoAtualizar: 'Dá entrada da quantidade no insumo que já existe (soma ao saldo) e atualiza preço, unidade e categoria.',
    explicacaoCriar: 'Cadastra o insumo e já lança a quantidade como saldo inicial.'
  },

  clientes: {
    id: 'clientes',
    rotulo: 'Clientes e contatos',
    tabelaAlvo: 'clientes',
    tabelaContatos: 'contatos_cliente',
    campoDeExibicao: 'nome_fantasia',

    // CNPJ primeiro: é identificador, não apelido. Casar por nome fantasia
    // sozinho juntaria duas filiais escritas igual — ou deixaria a mesma
    // empresa entrar duas vezes por causa de um "Ltda" a mais.
    chavesDeCasamento: [
      { campo: 'cnpj', rotulo: 'CNPJ', forte: true, normalizar: soDigitos },
      { campo: 'nome_fantasia', rotulo: 'Empresa' }
    ],

    instrucoes: [
      'O documento traz dados de CLIENTES: cartão de visita, cabeçalho de nota, lista de contatos, ficha cadastral.',
      '',
      ...INSTRUCOES_EMPRESA.slice(1)
    ].join('\n'),

    campos: [...CAMPOS_EMPRESA, CAMPO_CONTATOS],

    explicacaoAtualizar: 'Atualiza o cadastro do cliente que já existe e acrescenta os contatos que ainda não estão lá.',
    explicacaoCriar: 'Cadastra o cliente com os contatos lidos.'
  },

  produto_insumos: {
    id: 'produto_insumos',
    rotulo: 'Insumos de produtos',
    tabelaAlvo: 'produtos',
    campoDeExibicao: 'nome',

    // O produto tem de existir. Ver "DESTINO QUE SÓ ATUALIZA" no topo.
    exigeAlvo: true,
    motivoSemAlvo: 'Produto não encontrado no catálogo — escolha o produto na coluna "O que fazer"',

    // Código primeiro: é identificador do catálogo. Nome de produto se repete
    // com variação ("Painel Ripado 2,10" e "Painel Ripado 2,10m").
    chavesDeCasamento: [
      { campo: 'codigo', rotulo: 'Código', forte: true },
      { campo: 'nome', rotulo: 'Produto' }
    ],

    instrucoes: [
      'O documento é uma FICHA TÉCNICA: diz de que material cada produto é feito.',
      '',
      'Extraia UMA entrada por PRODUTO. Os materiais dele vão na lista "insumos".',
      '',
      'Atenção:',
      '- "quantidade" é quanto do insumo entra em UMA unidade do produto.',
      '- Mantenha o nome do insumo como está escrito; não troque por sinônimo.',
      '- Ignore linhas de mão de obra, tempo de processo, custo e total.',
      '- Se o documento tratar de um produto só, é uma entrada só.',
      '- Não invente quantidade: se o documento não disser, deixe null.'
    ].join('\n'),

    campos: [
      {
        chave: 'codigo', rotulo: 'Código', tipo: 'texto', max: 60, largura: 'media',
        descricao: 'Código do produto no catálogo, se estiver no documento'
      },
      {
        chave: 'nome', rotulo: 'Produto', tipo: 'texto', obrigatorio: true,
        max: 200, largura: 'grande', descricao: 'Nome do produto'
      },
      {
        chave: 'insumos', rotulo: 'Insumos', tipo: 'lista', largura: 'media',
        obrigatorio: true, max_itens: 60,
        descricao: 'Materiais que compõem o produto. Uma entrada por material.',
        subcampos: [
          { chave: 'nome', rotulo: 'Insumo', tipo: 'texto', obrigatorio: true, max: 200, descricao: 'Nome do material, como está escrito' },
          { chave: 'quantidade', rotulo: 'Qtde', tipo: 'numero', obrigatorio: true, descricao: 'Quanto entra em uma unidade do produto' }
        ]
      }
    ],

    explicacaoCriar: 'Indisponível: a ficha técnica não tem preço, coleção nem markup para cadastrar um produto.',
    explicacaoAtualizar: 'Acrescenta os insumos que faltam na ficha do produto e corrige a quantidade dos que já estão. NUNCA remove insumo que o documento não citou.'
  },

  prospeccoes: {
    id: 'prospeccoes',
    rotulo: 'Prospecções e contatos',
    tabelaAlvo: 'prospeccoes',
    tabelaContatos: 'prospeccao_contatos',
    campoDeExibicao: 'nome_fantasia',

    chavesDeCasamento: [
      { campo: 'cnpj', rotulo: 'CNPJ', forte: true, normalizar: soDigitos },
      { campo: 'nome_fantasia', rotulo: 'Empresa' }
    ],

    instrucoes: [
      'O documento traz empresas a PROSPECTAR: cartões de feira, lista de expositores, indicações, catálogo de fornecedores.',
      '',
      ...INSTRUCOES_EMPRESA.slice(1),
      '- "segmento" é o ramo da empresa (marcenaria, arquitetura, construtora…), se estiver escrito.'
    ].join('\n'),

    campos: [
      ...CAMPOS_EMPRESA,
      { chave: 'segmento', rotulo: 'Segmento', tipo: 'texto', max: 100, largura: 'media', descricao: 'Ramo de atuação' },
      CAMPO_CONTATOS
    ],

    explicacaoAtualizar: 'Atualiza a prospecção que já existe e acrescenta os contatos que ainda não estão lá.',
    explicacaoCriar: 'Cadastra a prospecção na etapa "Novo", com os contatos lidos.'
  }
};

/** Destinos que já sabem estruturar e aplicar. Os demais chegam nas próximas etapas. */
const DESTINOS_PRONTOS = Object.keys(ESQUEMAS);

const obterEsquema = destino => ESQUEMAS[destino] || null;

/**
 * Descrição dos campos para o front desenhar a grade de revisão.
 * `descricao` fica de fora: ela é instrução para o modelo, não rótulo de tela.
 */
function camposParaTela(destino) {
  const esquema = obterEsquema(destino);
  if (!esquema) return [];
  return esquema.campos.map(c => ({
    chave: c.chave,
    rotulo: c.rotulo,
    tipo: c.tipo,
    obrigatorio: Boolean(c.obrigatorio),
    largura: c.largura || 'media',
    // A sub-tabela da grade é desenhada a partir daqui, pelo mesmo caminho
    // que desenha as colunas de cima.
    ...(c.tipo === 'lista' ? {
      subcampos: (c.subcampos || []).map(sc => ({
        chave: sc.chave,
        rotulo: sc.rotulo,
        tipo: sc.tipo,
        obrigatorio: Boolean(sc.obrigatorio)
      }))
    } : {})
  }));
}

module.exports = {
  ESQUEMAS,
  DESTINOS_PRONTOS,
  obterEsquema,
  camposParaTela,
  soDigitos,
  CAMPO_CONTATOS,
  CAMPOS_EMPRESA
};
