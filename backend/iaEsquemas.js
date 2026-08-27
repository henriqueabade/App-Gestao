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
// `colunaAlvo` existe porque o item e a tabela nem sempre falam a mesma língua:
// no orçamento o campo lido chama-se "cliente" (é assim que ele aparece na
// grade) e a coluna correspondente em `clientes` é `nome_fantasia`. Quando os
// dois nomes coincidem, `colunaAlvo` é dispensável.
//
// ---------------------------------------------------------------------------
// DESTINO QUE PROCURA EM MAIS DE UMA TABELA
//
// `tabelasAlvo` (lista) existe para o orçamento: a empresa lida tanto pode ser
// um CLIENTE quanto uma PROSPECÇÃO, e o documento não diz qual. Obrigar o
// usuário a escolher antes de enviar o arquivo seria pedir uma informação que
// ele só descobre depois de ler.
//
// A busca vai na ordem da lista — cliente primeiro, porque um orçamento para
// quem já compra é o caso comum, e porque a prospecção que virou cliente
// continua na tabela de prospecções. Qual das duas casou fica gravado em
// `ia_extracao_itens.alvo_tabela`, e é ele que decide a série do número:
// ORC para cliente, OCRP para prospecção.
//
// ---------------------------------------------------------------------------
// AÇÕES OFERECIDAS
//
// `acoes` diz quais das três (criar / atualizar / ignorar) fazem sentido no
// destino, e `acaoAoCasar` diz qual propor quando o alvo é encontrado. Nem todo
// destino usa as três:
//
//   matéria-prima, clientes, prospecções .. cadastra OU atualiza
//   insumos de produto ................... só atualiza (o produto tem de existir)
//   orçamentos ........................... só cadastra, mas PRECISA de um alvo
//
// O orçamento é o caso que obriga a separar as duas ideias. O alvo dele não é
// um orçamento que já existe — é o CLIENTE a quem o orçamento novo se prende.
// É o que `alvoEhVinculo` marca: o alvo não é o registro que vai mudar, é o
// registro em que o novo se pendura.
//
// ---------------------------------------------------------------------------
// DESTINO QUE SÓ ATUALIZA
//
// `exigeAlvo: true` diz que o destino não cria registro novo — ele só preenche
// algo que já existe. É o caso dos insumos de produto: uma ficha técnica diz de
// que o produto é feito, não quanto ele custa, em que coleção está nem qual é o
// markup. Cadastrar produto a partir dela produziria uma ficha pela metade, com
// preço zero, no meio do catálogo.

// ---------------------------------------------------------------------------
// O QUE É COLUNA E O QUE É DETALHE
//
// `naGrade: false` num campo diz que ele NÃO vira coluna da grade de revisão:
// ele aparece no (i) da linha, onde continua editável.
//
// A distinção é de leitura, não de importância. A grade responde "esta linha
// está certa?" de relance — e para isso serve o punhado de campos que
// identificam a linha e mostram o que ela vale. O resto (forma de pagamento,
// observações, transportadora, validade) é conferido uma vez, quando se olha
// para aquela linha específica; ocupando coluna, ele espremia as outras a
// ponto de nenhuma poder ser lida.
//
// ---------------------------------------------------------------------------

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
// Doze colunas de empresa espremidas numa tabela dentro de um modal davam a
// cada uma menos de dez caracteres: "PROVENCE CAS…", "39.778.846…", "Rua
// Modes…". A tabela mostrava tudo e não deixava ler nada.
//
// Na grade ficam as quatro que IDENTIFICAM a empresa e decidem se a linha está
// certa. Endereço, site e inscrição estadual são conferidos uma vez, olhando
// para aquela empresa — e para isso serve o (i).
const CAMPOS_EMPRESA = [
  {
    chave: 'nome_fantasia', rotulo: 'Empresa', tipo: 'texto', obrigatorio: true,
    max: 200, largura: 'enorme', descricao: 'Nome pelo qual a empresa é conhecida'
  },
  { chave: 'razao_social', rotulo: 'Razão social', tipo: 'texto', max: 200, largura: 'enorme' },
  {
    chave: 'cnpj', rotulo: 'CNPJ', tipo: 'texto', max: 20, largura: 'grande',
    descricao: 'Só o número, com ou sem pontuação. Não invente se não estiver no documento.'
  },
  { chave: 'inscricao_estadual', rotulo: 'Insc. estadual', tipo: 'texto', max: 30, largura: 'media', naGrade: false },
  { chave: 'site', rotulo: 'Site', tipo: 'texto', max: 150, largura: 'media', naGrade: false },
  { chave: 'end_logradouro', rotulo: 'Rua', tipo: 'texto', max: 200, largura: 'media', naGrade: false },
  { chave: 'end_numero', rotulo: 'Nº', tipo: 'texto', max: 20, largura: 'pequena', naGrade: false },
  { chave: 'end_complemento', rotulo: 'Compl.', tipo: 'texto', max: 100, largura: 'pequena', naGrade: false },
  { chave: 'end_bairro', rotulo: 'Bairro', tipo: 'texto', max: 100, largura: 'media', naGrade: false },
  { chave: 'end_cidade', rotulo: 'Cidade', tipo: 'texto', max: 100, largura: 'media', naGrade: false },
  { chave: 'end_uf', rotulo: 'UF', tipo: 'texto', max: 2, largura: 'pequena', naGrade: false, descricao: 'Sigla de 2 letras' },
  { chave: 'end_cep', rotulo: 'CEP', tipo: 'texto', max: 15, largura: 'pequena', naGrade: false }
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
  '- Não invente e-mail a partir do site nem nome a partir do e-mail.',
  '',
  'O documento quase sempre JUNTA o que o cadastro separa. Desmembre:',
  '- "R. João Cachoeira, 152" -> logradouro "R. João Cachoeira", número "152".',
  '- "Q SHIS QI 9 CL Bloco B Loja 34" -> o que vier depois do número',
  '  (bloco, loja, sala, andar, apto) é COMPLEMENTO.',
  '- "SP/SP", "BRASILIA/DF", "São José do Rio Preto/SP" -> cidade e UF.',
  '  Quando vier só a sigla repetida ("SP/SP"), a cidade é a capital do estado.',
  '- Uma célula com dois nomes separados por barra ("LIA / SOFIA",',
  '  "VITOR/PRISCILLA") são DUAS pessoas: uma entrada de contato para cada.',
  '- Não jogue fora coluna que tem valor: se a planilha traz cidade, e-mail ou',
  '  inscrição estadual, eles precisam sair preenchidos.'
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
      '- Se a MESMA linha trouxer mais de um preço (preço cheio e preço com',
      '  desconto por quantidade, ou colunas de faixas), use SEMPRE o MAIOR.',
      '  O desconto é decidido depois, no módulo; a leitura registra o preço cheio.',
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
        descricao: 'Preço de uma unidade; o MAIOR quando a linha trouxer mais de um'
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

    // O produto NÃO precisa existir.
    //
    // Aqui estava um erro de projeto que só apareceu com uma ficha de verdade:
    // a ficha técnica de uma peça NOVA é justamente o caso mais comum de se
    // querer ler — a peça ainda não está no catálogo, e é para não digitar os
    // 23 insumos à mão que o módulo existe. Exigir o produto cadastrado antes
    // fechava a porta exatamente para quem mais precisava dela.
    //
    // O que tornava a exigência razoável (a ficha não tem preço, coleção nem
    // markup) deixou de valer quando a leitura passou a ABRIR O MODAL em vez
    // de gravar: no formulário de Novo Produto esses campos estão ali, à vista,
    // para quem sabe respondê-los.
    rotuloAlvo: 'Produto',
    acoes: ['criar', 'atualizar', 'ignorar'],
    avisoAoCriar: 'Produto NOVO: não está no catálogo, e o formulário de cadastro abre com os insumos preenchidos',

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
      'A ficha é organizada em ETAPAS DE PRODUÇÃO, e cada etapa vem como um',
      'título acima da sua lista de itens — MARCENARIA, ACABAMENTO, MONTAGEM,',
      'EMBALAGEM, PINTURA, e assim por diante.',
      '',
      'Atenção:',
      '- "processo" é o título da etapa sob a qual o insumo está escrito.',
      '  Repita o mesmo título em TODOS os insumos daquele bloco.',
      '- Se a mesma etapa aparecer mais de uma vez, mantenha o nome nas duas:',
      '  são blocos diferentes da mesma etapa, e os insumos dos dois entram.',
      '- MANTENHA A ORDEM em que os insumos aparecem, etapa por etapa, de cima',
      '  para baixo. A ordem é a sequência de produção.',
      '- "unidade" costuma vir entre parênteses depois do número:',
      '  "0,07 (m2)" é quantidade 0,07 e unidade "m2".',
      '- "quantidade" é quanto do insumo entra em UMA unidade do produto.',
      '- Mantenha o nome do insumo como está escrito; não troque por sinônimo',
      '  nem corte o final ("Em Lamina De Madeira" faz parte do nome).',
      '- Ignore linhas de mão de obra, tempo de processo, custo e total.',
      '- Ignore as linhas de cabeçalho da tabela ("ITEM | QUANTIDADE").',
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
        // `obrigatorio` e `exigido` são coisas diferentes, e confundi-las
        // custa caro nos dois sentidos.
        //
        //   `obrigatorio` .. sem isto a linha NÃO SOBREVIVE À EXTRAÇÃO. Vale
        //                    para o que, faltando, torna a linha um lixo:
        //                    insumo sem nome, insumo sem quantidade.
        //
        //   `exigido` ...... sem isto a linha não pode ir para o FORMULÁRIO,
        //                    mas continua na grade para ser completada. É o
        //                    caso da unidade e do processo: a ficha às vezes
        //                    não os escreve, e descartar o insumo por causa
        //                    disso perderia um material que existe — mas
        //                    mandá-lo assim para a tabela do produto criaria
        //                    uma linha sem etapa e sem unidade, que ninguém
        //                    consegue corrigir do outro lado.
        subcampos: [
          {
            chave: 'processo', rotulo: 'Processo', tipo: 'texto', max: 60, exigido: true,
            descricao: 'Etapa de produção sob a qual o insumo está listado: MARCENARIA, ACABAMENTO, MONTAGEM, EMBALAGEM…'
          },
          { chave: 'nome', rotulo: 'Insumo', tipo: 'texto', obrigatorio: true, exigido: true, max: 200, descricao: 'Nome do material, como está escrito' },
          { chave: 'quantidade', rotulo: 'Qtde', tipo: 'numero', obrigatorio: true, exigido: true, descricao: 'Quanto entra em uma unidade do produto' },
          {
            chave: 'unidade', rotulo: 'Un.', tipo: 'texto', max: 20, exigido: true,
            descricao: 'Unidade da quantidade, normalmente entre parênteses: m2, ml, m, cm2, UN'
          }
        ]
      }
    ],

    explicacaoCriar: 'Abre o formulário de Novo Produto com o nome e os insumos preenchidos, na ordem e nos processos do documento. Preço, coleção e markup você completa lá.',
    explicacaoAtualizar: 'Abre a ficha do produto que já existe com os insumos lidos acrescentados. NUNCA remove insumo que o documento não citou.'
  },

  orcamentos: {
    id: 'orcamentos',
    rotulo: 'Orçamentos',

    // O alvo é o CLIENTE ou a PROSPECÇÃO, não um orçamento.
    // Ver "DESTINO QUE PROCURA EM MAIS DE UMA TABELA" no topo.
    tabelaAlvo: 'clientes',
    tabelasAlvo: [
      { tabela: 'clientes', rotulo: 'Cliente' },
      { tabela: 'prospeccoes', rotulo: 'Prospecção' }
    ],
    campoDeExibicao: 'nome_fantasia',
    alvoEhVinculo: true,
    exigeAlvo: true,
    rotuloAlvo: 'Cliente ou prospecção',
    acoes: ['criar', 'ignorar'],
    acaoAoCasar: 'criar',
    motivoSemAlvo: 'Empresa não encontrada em Clientes nem em Prospecções — escolha na coluna "O que fazer", ou cadastre-a antes pelo destino "Clientes e contatos"',

    // Um pedido traz OS DOIS nomes da empresa — "Nome Fantasia: Casa Vicenzo"
    // e "Razão Social: Lavoro e Decorazione Ltda" — e o cadastro pode ter sido
    // feito por qualquer um deles. Procurar só por nome fantasia fazia o
    // pedido da Casa Vicenzo cair como "empresa não encontrada" quando o
    // modelo, lendo o documento de cima para baixo, escrevia a razão social.
    chavesDeCasamento: [
      { campo: 'cnpj', rotulo: 'CNPJ', forte: true, normalizar: soDigitos },
      { campo: 'cliente', rotulo: 'Empresa', colunaAlvo: 'nome_fantasia' },
      { campo: 'razao_social', rotulo: 'Razão social', colunaAlvo: 'razao_social' },
      { campo: 'razao_social', rotulo: 'Razão social', colunaAlvo: 'nome_fantasia' },
      { campo: 'cliente', rotulo: 'Empresa', colunaAlvo: 'razao_social' }
    ],

    instrucoes: [
      'O documento é um PEDIDO DE ORÇAMENTO ou uma lista de itens que um cliente quer comprar.',
      '',
      'Extraia UMA entrada por ORÇAMENTO. Os produtos pedidos vão na lista "itens".',
      '',
      'Atenção:',
      '- "cliente" é o NOME FANTASIA da empresa que está pedindo, não o do fornecedor.',
      '- Se o documento trouxer Nome Fantasia E Razão Social, ponha o nome',
      '  fantasia em "cliente" e a razão social em "razao_social".',
      '- Se trouxer um só, ponha esse em "cliente" e deixe "razao_social" null.',
      '- "quantidade" é quantas unidades do produto o cliente quer.',
      '- "valor_unitario" é o preço de UMA unidade. Se só houver o total da linha, divida pela quantidade.',
      '- Se a MESMA linha trouxer mais de um preço (preço cheio e preço com',
      '  desconto por quantidade, ou colunas de faixas), use SEMPRE o MAIOR.',
      '  O desconto é decidido depois, no módulo; a leitura registra o preço cheio.',
      '- Se o documento não trouxer preço, deixe "valor_unitario" em null: o preço de tabela será usado.',
      '- Ignore linhas de subtotal, total geral, frete e imposto.',
      '- "prazo" é o prazo de entrega, como está escrito ("30 dias", "30/60/90").',
      '',
      'O pedido traz, quase sempre, um bloco de dados comerciais no cabeçalho.',
      'Nenhum deles é opcional quando está escrito:',
      '- "contato" é a PESSOA do cliente citada no pedido ("Contato: Lílian").',
      '  Não confunda com o nome da empresa nem com quem autorizou.',
      '- "transportadora" é a empresa de frete ("Transportadora: Rodonaves").',
      '- "forma_pagamento" é o meio ("pix", "boleto", "cartão").',
      '- "condicao_pagamento" é "à vista" ou "a prazo". Quando o documento não',
      '  disser com essas palavras, deduza: mais de uma parcela é a prazo.',
      '- "parcelas" junta quantidade e valores como estão escritos —',
      '  "3x R$61,62/R$1.661,62/R$861,62". Não some, não divida, não arredonde.'
    ].join('\n'),

    campos: [
      {
        chave: 'cliente', rotulo: 'Cliente', tipo: 'texto', obrigatorio: true,
        max: 200, largura: 'grande', descricao: 'Empresa que está pedindo o orçamento'
      },
      {
        chave: 'razao_social', rotulo: 'Razão social', tipo: 'texto', max: 200, largura: 'media',
        naGrade: false, descricao: 'Razão social da empresa, se o documento trouxer as duas formas'
      },
      { chave: 'cnpj', rotulo: 'CNPJ', tipo: 'texto', max: 20, largura: 'media', naGrade: false },
      {
        chave: 'validade', rotulo: 'Validade', tipo: 'data', largura: 'media', naGrade: false,
        descricao: 'Até quando a proposta vale, se o documento disser'
      },
      // Prazo fica na grade: é o que muda de pedido para pedido e o que se
      // confere junto com o cliente. `largura: grande` para caber inteiro —
      // "30/60/90" cortado em "30/6" não diz nada.
      { chave: 'prazo', rotulo: 'Prazo', tipo: 'texto', max: 60, largura: 'grande', descricao: 'Prazo de entrega' },
      { chave: 'forma_pagamento', rotulo: 'Pagamento', tipo: 'texto', max: 80, largura: 'media', naGrade: false },
      {
        chave: 'condicao_pagamento', rotulo: 'Condição', tipo: 'texto', max: 40, largura: 'media', naGrade: false,
        descricao: 'À vista ou a prazo, como o documento disser'
      },
      {
        chave: 'parcelas', rotulo: 'Parcelas', tipo: 'texto', max: 200, largura: 'media', naGrade: false,
        descricao: 'Quantidade e valor de cada parcela, como está escrito'
      },
      {
        chave: 'transportadora', rotulo: 'Transportadora', tipo: 'texto', max: 120, largura: 'media', naGrade: false,
        descricao: 'Transportadora indicada no pedido'
      },
      {
        chave: 'contato', rotulo: 'Contato', tipo: 'texto', max: 150, largura: 'media', naGrade: false,
        descricao: 'Pessoa de contato do cliente citada no pedido'
      },
      { chave: 'observacoes', rotulo: 'Observações', tipo: 'texto', max: 500, largura: 'media', naGrade: false },
      {
        chave: 'itens', rotulo: 'Itens', tipo: 'lista', largura: 'media',
        obrigatorio: true, max_itens: 100,
        descricao: 'Produtos pedidos. Uma entrada por produto.',
        subcampos: [
          { chave: 'codigo', rotulo: 'Código', tipo: 'texto', max: 60, descricao: 'Código do produto, se estiver no documento' },
          { chave: 'nome', rotulo: 'Produto', tipo: 'texto', obrigatorio: true, max: 200, descricao: 'Nome do produto, como está escrito' },
          { chave: 'quantidade', rotulo: 'Qtde', tipo: 'numero', obrigatorio: true },
          { chave: 'valor_unitario', rotulo: 'Valor un.', tipo: 'dinheiro', descricao: 'Preço de uma unidade, o MAIOR quando houver vários; null se o documento não disser' }
        ]
      }
    ],

    explicacaoCriar: 'Cria um orçamento PENDENTE para o cliente ou prospecção escolhido, com os itens lidos. Nada é aprovado nem vira pedido.',
    explicacaoAtualizar: 'Indisponível: a leitura cria orçamento novo, nunca mexe num que já existe.'
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
/**
 * Tabelas em que o destino procura o alvo, sempre como lista.
 * Destino de tabela única continua declarando só `tabelaAlvo`.
 */
function tabelasAlvoDo(destino) {
  const esquema = obterEsquema(destino);
  if (!esquema) return [];
  if (Array.isArray(esquema.tabelasAlvo) && esquema.tabelasAlvo.length) return esquema.tabelasAlvo;
  return [{ tabela: esquema.tabelaAlvo, rotulo: esquema.rotuloAlvo || null }];
}

/** Ações que a grade deve oferecer neste destino. */
function acoesDoDestino(destino) {
  const esquema = obterEsquema(destino);
  return esquema?.acoes || ['criar', 'atualizar', 'ignorar'];
}

function camposParaTela(destino) {
  const esquema = obterEsquema(destino);
  if (!esquema) return [];
  return esquema.campos.map(c => ({
    chave: c.chave,
    rotulo: c.rotulo,
    tipo: c.tipo,
    obrigatorio: Boolean(c.obrigatorio),
    largura: c.largura || 'media',
    // `naGrade: false` tira o campo das COLUNAS e o manda para o (i) da linha.
    // Ele continua sendo extraído, continua editável e continua indo para o
    // formulário — o que muda é só onde aparece.
    //
    // A grade é o que se lê de relance para decidir se a linha está certa.
    // Um pedido tem quinze campos, e mostrar os quinze fazia cada coluna ficar
    // com quatro caracteres de largura: a tabela mostrava tudo e não deixava
    // ler nada.
    naGrade: c.naGrade !== false,
    // A sub-tabela da grade é desenhada a partir daqui, pelo mesmo caminho
    // que desenha as colunas de cima.
    ...(c.tipo === 'lista' ? {
      subcampos: (c.subcampos || []).map(sc => ({
        chave: sc.chave,
        rotulo: sc.rotulo,
        tipo: sc.tipo,
        obrigatorio: Boolean(sc.obrigatorio),
        // `exigido` bloqueia a ida ao formulário sem derrubar a linha na
        // extração — ver o comentário no esquema de produto_insumos.
        exigido: Boolean(sc.exigido)
      }))
    } : {})
  }));
}

module.exports = {
  ESQUEMAS,
  DESTINOS_PRONTOS,
  obterEsquema,
  camposParaTela,
  acoesDoDestino,
  tabelasAlvoDo,
  soDigitos,
  CAMPO_CONTATOS,
  CAMPOS_EMPRESA
};
