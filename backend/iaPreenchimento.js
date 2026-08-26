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

const { normalizar, palavras, LIMIAR_PARECIDO } = require('./iaReconciliacao');
const { paraDecimal } = require('./numeros');
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
 * Casa um insumo lido com o cadastro de matéria-prima.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NÃO BASTA O NOME EXATO
 *
 * Uma ficha técnica é escrita por quem faz a peça, não por quem cadastrou o
 * insumo. "Verniz FO10 - 6717 Em Lamina De Madeira" no papel é "Verniz FO10
 * 6717" no estoque; "Caixa Nº6" é "Caixa N6". São o mesmo material, e exigir
 * que as duas grafias batam letra por letra fazia metade da ficha ficar de
 * fora — foi o que aconteceu com a Bandeja Vero PP: 23 insumos na lista, 6
 * chegando ao formulário.
 *
 * Então: nome exato primeiro; se não houver, o mais parecido acima do limiar.
 *
 * ---------------------------------------------------------------------------
 * O CASAMENTO POR SEMELHANÇA É ANUNCIADO
 *
 * `tipo` distingue os dois, e a distinção não é acadêmica: um casamento exato
 * é certeza, um casamento por semelhança é um palpite bom. A tela mostra o
 * nome LIDO com um (i) que revela para qual cadastro ele foi, e é isso que
 * permite a quem confere pegar o palpite errado antes de virar receita.
 */
/**
 * O insumo do cadastro está na MESMA ETAPA que a ficha diz?
 *
 * Cada insumo nasce com um processo em Matéria-prima, e a ficha técnica também
 * é escrita em blocos de etapa. Casar um "Catalisador" do bloco ACABAMENTO com
 * um "Catalisador" cadastrado em MONTAGEM é montar a peça com o material de
 * outra etapa — e o nome bate, então ninguém percebe.
 *
 * Quando a ficha NÃO diz a etapa, não há o que restringir e todos valem.
 *
 * O cadastro grava o processo pelo NOME, mas há código no programa que aceita
 * o id: por isso os dois são aceitos aqui, com o id resolvido contra a lista de
 * etapas antes de comparar.
 */
function mesmoProcesso(lido, insumo, etapasPorId) {
  const daFicha = normalizar(lido);
  if (!daFicha) return true;

  const bruto = insumo && insumo.processo;
  if (bruto === null || bruto === undefined || bruto === '') return false;

  const porId = etapasPorId && etapasPorId.get(String(bruto).trim());
  const doCadastro = normalizar(porId || bruto);
  return Boolean(doCadastro) && doCadastro === daFicha;
}

/**
 * Casa um insumo lido com o cadastro, dentro da etapa que a ficha declara.
 *
 * A etapa entra ANTES do nome, e não como desempate depois: um nome parecido
 * na etapa errada não é um casamento pior, é um casamento inválido.
 */
function casarInsumo(nome, porNome, registros, processo, etapasPorId) {
  const candidatos = processo
    ? registros.filter(r => mesmoProcesso(processo, r, etapasPorId))
    : registros;

  const exato = porNome.get(normalizar(nome));
  if (exato && (!processo || mesmoProcesso(processo, exato, etapasPorId))) {
    return { registro: exato, tipo: 'exato' };
  }

  // A frequência sai dos CANDIDATOS, não do catálogo inteiro: dentro de
  // MARCENARIA, "cola" pode ser comum e "freijo" único, e é essa comparação
  // que importa para escolher entre eles.
  const frequencia = frequenciaDeTermos(candidatos);

  let melhor = null;
  let nota = 0;
  let empatados = 0;
  for (const r of candidatos) {
    const n = proximidadeDeInsumo(nome, r && r.nome, frequencia);
    if (n > nota) { nota = n; melhor = r; empatados = 1; }
    else if (n === nota && n > 0) empatados += 1;
  }

  // Empate no topo é sorteio, não casamento. Dois insumos igualmente parecidos
  // com o que a ficha diz querem dizer que a ficha não foi específica o
  // bastante — e escolher um deles põe metade da chance de material errado na
  // receita, em silêncio.
  if (melhor && nota >= LIMIAR_PARECIDO && empatados > 1) {
    return { registro: null, tipo: null, ambiguo: melhor.nome };
  }

  if (melhor && nota >= LIMIAR_PARECIDO) return { registro: melhor, tipo: 'semelhante', nota };

  // Nome que existe no cadastro mas em OUTRA etapa: o motivo da recusa é
  // diferente de "não existe", e quem revisa precisa saber qual dos dois é —
  // um manda cadastrar, o outro manda conferir a etapa.
  if (exato) return { registro: null, tipo: null, foraDoProcesso: exato };
  return { registro: null, tipo: null };
}

/**
 * Palavras que não distinguem um insumo de outro.
 *
 * "mm" e "cm" aparecem no cadastro ("MDF 6 mm") e não na ficha ("MDF 06").
 * Preposições aparecem na ficha ("Diluente DF4068 Em Lamina De Madeira") e não
 * no cadastro. Nos dois casos elas só somam ruído à conta.
 */
const RUIDO = new Set([
  'em', 'de', 'da', 'do', 'das', 'dos', 'com', 'para', 'e', 'a', 'o', 'no', 'na',
  'mm', 'cm', 'ml', 'un', 'kg', 'tipo'
]);

/**
 * Os termos que identificam um insumo.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NÃO SERVE O `palavras()` DA RECONCILIAÇÃO
 *
 * Ele foi feito para nome de empresa, e ali as três regras que ele aplica
 * fazem sentido. Em nome de insumo, cada uma delas quebra um caso real do
 * estoque desta casa:
 *
 *   1. DESCARTA TOKEN DE UM CARACTERE. "MDF 6 mm" virava {mdf, mm} — sem o 6,
 *      que é EXATAMENTE o que distingue um MDF do outro. Sete espessuras de
 *      MDF viravam sete nomes idênticos, e nenhuma casava com nada.
 *
 *   2. NÃO SEPARA LETRA DE DÍGITO. A ficha escreve "DF4068" e o cadastro
 *      "DF 4068" — o mesmo código, dois tokens que não se parecem.
 *
 *   3. NÃO NORMALIZA ZERO À ESQUERDA. "MDF 06" e "MDF 6 mm" falavam do mesmo
 *      material com números diferentes.
 *
 * Reaproveitar `palavras()` aqui seria escolher a coerência entre dois lugares
 * do código em vez da coerência com o estoque — e o estoque é quem manda.
 */
function termosDeInsumo(valor) {
  const texto_ = normalizar(valor)
    // "DF4068" -> "df 4068"; "10R" -> "10 r"
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2');

  return new Set(
    texto_
      .split(/[^a-z0-9]+/)
      // "06" -> "6". Zero à esquerda é forma de escrever, não número diferente.
      .map(p => (/^\d+$/.test(p) ? String(Number(p)) : p))
      .filter(p => p && !RUIDO.has(p))
  );
}

/**
 * Proximidade entre um nome de ficha e um nome de cadastro.
 *
 * O Jaccard que a reconciliação usa não serve aqui, e o motivo é a forma como
 * uma ficha técnica é escrita: ela QUALIFICA o material. O cadastro diz
 * "Verniz FO10 6717" e a ficha diz "Verniz FO10 - 6717 Em Lamina De Madeira" —
 * o nome do cadastro inteiro está lá dentro, mais quatro palavras de contexto.
 * Jaccard conta essas quatro contra o casamento (3 de 7 palavras = 0,43) e
 * conclui que são coisas diferentes.
 *
 * A medida certa para "um nome contém o outro" é a CONTENÇÃO: quanto do menor
 * dos dois aparece no maior. Ali dá 3 de 3.
 *
 * A contenção sozinha, porém, casa demais: "Cola" está inteiramente dentro de
 * "Cola PVA extra 1kg" e de "Cola Fórmica" ao mesmo tempo. Por isso ela só
 * vale a partir de DUAS palavras em comum — abaixo disso, decide o Jaccard,
 * que é conservador. É o que mantém "MDF 06" e "MDF 09" como materiais
 * diferentes, que é o que eles são.
 */
function proximidadeDeInsumo(lido, cadastrado, frequencia) {
  const a = termosDeInsumo(lido);
  const b = termosDeInsumo(cadastrado);
  if (!a.size || !b.size) return 0;

  const comuns = [...a].filter(t => b.has(t));
  if (!comuns.length) return 0;

  const jaccard = comuns.length / (a.size + b.size - comuns.length);
  const contencao = comuns.length / Math.min(a.size, b.size);

  // Duas palavras em comum já bastam para a contenção valer.
  if (comuns.length >= 2) return Math.max(jaccard, contencao);

  // Com UMA palavra, o que decide é se ela IDENTIFICA.
  //
  // "Freijó" está inteiro dentro de "Lâmina de Freijó" e é a mesma madeira;
  // "Cola" está inteiro dentro de "Cola PVA", de "Cola Branca" e de "Cola
  // Fórmica", e não é nenhuma das três. A diferença entre os dois casos não é
  // o tamanho do nome — é quantos insumos do catálogo usam aquela palavra.
  //
  // Uma palavra que aparece uma vez só é o nome daquele material. Uma que
  // aparece em cinco é família, e escolher um dos cinco seria sorteio.
  const identifica = frequencia && comuns.every(t => (frequencia.get(t) || 0) <= 1);
  return identifica ? Math.max(jaccard, contencao) : jaccard;
}

/** Em quantos insumos do catálogo cada termo aparece. */
function frequenciaDeTermos(registros) {
  const freq = new Map();
  for (const r of registros) {
    for (const t of termosDeInsumo(r && r.nome)) freq.set(t, (freq.get(t) || 0) + 1);
  }
  return freq;
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
function montarInsumos(linhas, porNome, registros = [], etapasPorId = new Map()) {
  const itens = [];
  const semCadastro = [];
  const foraDoProcesso = [];
  const unidadeDiferente = [];
  const porSemelhanca = [];
  let ordem = 0;

  for (const linha of linhas) {
    const nome = texto(linha && linha.nome).trim();
    if (!nome) continue;

    const processo = texto(linha.processo).trim();
    const achado = casarInsumo(nome, porNome, registros, processo, etapasPorId);
    const insumo = achado.registro;

    if (!insumo) {
      // Existe no cadastro, mas em outra etapa. O motivo da recusa é diferente
      // de "não existe", e quem revisa precisa saber qual dos dois é.
      if (achado.foraDoProcesso) {
        foraDoProcesso.push(`${nome} (cadastrado em "${achado.foraDoProcesso.processo}", não em "${processo}")`);
      } else {
        semCadastro.push(nome);
      }
      continue;
    }
    if (achado.tipo === 'semelhante') porSemelhanca.push(`"${nome}" entrou como "${insumo.nome}"`);

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

  return { itens, semCadastro, foraDoProcesso, unidadeDiferente, porSemelhanca };
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


// ---------------------------------------------------------------------------
// O BLOCO COMERCIAL DO PEDIDO
//
// Um pedido de verdade traz, no cabeçalho, tudo o que o formulário de orçamento
// pergunta: quem é o contato, qual a transportadora, como se paga, em quantas
// vezes e com que prazo. Estava tudo sendo lido e nada estava chegando ao
// formulário — a pessoa relia o PDF e digitava de novo, que é exatamente o
// trabalho que este módulo existe para tirar da frente.
//
// O que o documento diz e o que o formulário quer não têm a mesma forma:
//
//   "pix"                          -> a opção `pix` do <select>
//   "Quantidade de Parcelas: 3"    -> `count: 3`
//   "Prazo: 30/60/90"              -> vencimentos em 30, 60 e 90 dias
//   "R$61,62/R$1.661,62/R$861,62"  -> três valores DIFERENTES, em centavos
//
// A conversão mora aqui, e não na tela, porque é regra de negócio com casos
// tortos de verdade: uma parcela só, valores iguais, prazo escrito por extenso.
// ---------------------------------------------------------------------------

/** As opções que o <select> de forma de pagamento realmente tem. */
const FORMAS_DE_PAGAMENTO = [
  { valor: 'pix', termos: ['pix'] },
  { valor: 'boleto', termos: ['boleto', 'bancario', 'duplicata'] },
  { valor: 'cartao', termos: ['cartao', 'credito', 'card'] }
];

/**
 * A forma de pagamento lida, traduzida para uma opção que existe no select.
 *
 * Devolver o texto cru não adiantaria: um `<select>` que recebe um valor
 * inexistente não reclama, fica vazio — e o pedido sai sem forma de pagamento
 * sem ninguém notar.
 */
function formaDePagamento(lido) {
  const chave = normalizar(lido);
  if (!chave) return null;
  const achado = FORMAS_DE_PAGAMENTO.find(f => f.termos.some(t => chave.includes(t)));
  return achado ? achado.valor : null;
}

/**
 * Números de uma lista escrita com barra, ponto e vírgula ou "e".
 *
 * O "3x" que costuma abrir a frase é CONTAGEM, não valor. Sem tirá-lo antes de
 * partir, ele gruda no primeiro número — "3x R$61,62" vira 361,62 — e a
 * primeira parcela sai com um valor que parece plausível, que é a pior forma
 * de errar.
 */
function numerosDe(texto_) {
  return texto(texto_)
    .replace(/^\s*\d+\s*x\s*/i, '')
    .split(/[/;|]| e |,\s*(?=R?\$)/i)
    .map(p => paraDecimal(p.replace(/[^\d.,-]/g, '')))
    .filter(n => Number.isFinite(n) && n > 0);
}

/** Dias de vencimento de um prazo escrito como "30/60/90" ou "30 dias". */
function diasDe(prazo) {
  return texto(prazo)
    .split(/[/;|]| e /i)
    .map(p => {
      const n = /(\d+)/.exec(p);
      return n ? Number(n[1]) : null;
    })
    .filter(n => Number.isFinite(n) && n > 0);
}

/**
 * O bloco de pagamento, na forma que o formulário de orçamento repõe.
 *
 * `condicao` é deduzida quando o documento não diz com todas as letras: mais de
 * uma parcela é a prazo. Deduzir aqui é seguro porque a pessoa vê o resultado
 * no formulário antes de salvar; deixar em branco obrigaria a preencher à mão
 * justamente o campo que decide o resto do bloco.
 */
function interpretarPagamento(dados) {
  const forma = formaDePagamento(dados.forma_pagamento);
  const valores = numerosDe(dados.parcelas);
  const dias = diasDe(dados.prazo);

  const declarada = normalizar(dados.condicao_pagamento);
  const aVista = declarada.includes('vista')
    || (!declarada && valores.length <= 1 && dias.length <= 1);

  if (aVista) {
    return {
      forma,
      condicao: 'vista',
      // O prazo de uma venda à vista é o prazo de ENTREGA, e é isso que o
      // campo do formulário pede.
      prazo_vista: texto(dados.prazo).trim() || null,
      parcelas: null
    };
  }

  const quantidade = Math.max(valores.length, dias.length);
  if (!quantidade) return { forma, condicao: 'prazo', prazo_vista: null, parcelas: null };

  const itens = [];
  for (let i = 0; i < quantidade; i++) {
    itens.push({
      // Centavos, que é a unidade em que o parcelamento trabalha. Trabalhar em
      // reais com casas decimais espalharia erro de arredondamento por cada
      // parcela até a soma não fechar com o total.
      amount: Number.isFinite(valores[i]) ? Math.round(valores[i] * 100) : 0,
      dueInDays: Number.isFinite(dias[i]) ? dias[i] : (i + 1) * 30
    });
  }

  // Valores diferentes entre si é o caso comum num pedido de verdade — e o
  // formulário só respeita valor a valor no modo "diferentes".
  const todosIguais = itens.every(i => i.amount === itens[0].amount);

  return {
    forma,
    condicao: 'prazo',
    prazo_vista: null,
    parcelas: {
      count: quantidade,
      mode: todosIguais ? 'equal' : 'custom',
      items: itens
    }
  };
}

/**
 * O contato e a transportadora do pedido, casados com o cadastro do cliente.
 *
 * Os dois são <select> alimentados a partir do cliente escolhido: o formulário
 * quer o id, e o documento traz o nome. Sem casar aqui, "Contato: Lílian" e
 * "Transportadora: Rodonaves" chegariam como texto que o select ignora.
 */
async function vincularAoCliente(api, alvo, dados) {
  const saida = { contato: null, transportadora: null, avisos: [] };
  if (!alvo || alvo.tabela !== 'clientes') return saida;

  const nomeContato = texto(dados.contato).trim();
  if (nomeContato) {
    const contatos = await api.get('/api/contatos_cliente', { query: { id_cliente: alvo.id } })
      .then(lista).catch(() => []);
    const achado = indexarPor(contatos, 'nome').get(normalizar(nomeContato));
    if (achado) saida.contato = { id: Number(achado.id), nome: achado.nome };
    else saida.avisos.push(`Contato "${nomeContato}" não está no cadastro deste cliente`);
  }

  const nomeTransp = texto(dados.transportadora).trim();
  if (nomeTransp) {
    const transportadoras = await api.get('/api/transportadoras', { query: { id_cliente: alvo.id } })
      .then(lista).catch(() => []);
    // A coluna chama `transportadora`, não `nome` — é o nome dela na tabela.
    const achado = indexarPor(transportadoras, 'transportadora').get(normalizar(nomeTransp));
    if (achado) saida.transportadora = { id: Number(achado.id), nome: achado.transportadora };
    else saida.avisos.push(`Transportadora "${nomeTransp}" não está cadastrada para este cliente`);
  }

  return saida;
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
    const [materias, etapas] = await Promise.all([
      api.get('/api/materia_prima').then(lista).catch(() => []),
      api.get('/api/etapas_producao').then(lista).catch(() => [])
    ]);
    const etapasPorId = new Map(etapas.map(e => [String(e.id), e.nome]));

    const r = montarInsumos(lista(dados.insumos), indexarPor(materias, 'nome'), materias, etapasPorId);
    saida.insumos = r.itens;
    if (r.semCadastro.length) {
      avisos.push(`Fora da lista, por não estarem em Matéria-prima: ${r.semCadastro.join(', ')}`);
    }
    if (r.foraDoProcesso.length) {
      avisos.push(`Fora da lista, por estarem em outra etapa: ${r.foraDoProcesso.join('; ')}`);
    }
    // Casamento por semelhança é palpite bom, não certeza. Dizer qual virou
    // qual é o que permite pegar o palpite errado antes de virar receita.
    if (r.porSemelhanca.length) {
      avisos.push(`Casados por semelhança: ${r.porSemelhanca.join('; ')}`);
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

  // O bloco comercial depende do cliente já resolvido: contato e
  // transportadora são listas DAQUELE cliente.
  if (destino === 'orcamentos') {
    saida.pagamento = interpretarPagamento(dados);
    const vinculos = await vincularAoCliente(api, saida.alvo, dados);
    saida.contato = vinculos.contato;
    saida.transportadora = vinculos.transportadora;
    avisos.push(...vinculos.avisos);
  }

  return saida;
}

module.exports = {
  MODAIS,
  ESTADOS,
  casarInsumo,
  proximidadeDeInsumo,
  termosDeInsumo,
  frequenciaDeTermos,
  mesmoProcesso,
  interpretarPagamento,
  formaDePagamento,
  vincularAoCliente,
  montarPreenchimento,
  montarInsumos,
  montarItensDeOrcamento,
  montarContatos,
  indexarPor
};
