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
/**
 * O NOME da etapa, venha ela como nome ou como id.
 *
 * Matéria-prima guarda a etapa do insumo por id; a ficha da peça agrupa os
 * insumos pelo NOME do processo. Um id cru chegando lá vira uma seção chamada
 * "3", separada da seção certa.
 */
function nomeDaEtapa(bruto, etapasPorId) {
  const cru = texto(bruto).trim();
  if (!cru) return '';
  const porId = etapasPorId && etapasPorId.get(cru);
  return texto(porId).trim() || cru;
}

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
      //
      // Do cadastro ela vem como ID, e o que a ficha da peça agrupa é o NOME:
      // sem passar pelo mapa de etapas, a peça ganhava uma seção chamada "3".
      // É a mesma resolução que `mesmoProcesso` faz para comparar.
      processo: texto(linha.processo).trim() || nomeDaEtapa(insumo.processo, etapasPorId),
      quantidade,
      unidade: insumo.unidade || lida || '',
      preco_unitario: Number(insumo.preco_unitario) || 0,
      ordem
    });
  }

  return { itens, semCadastro, foraDoProcesso, unidadeDiferente, porSemelhanca };
}

/**
 * Casa um produto lido com o catálogo.
 *
 * Mesma ideia do insumo, com uma diferença: aqui existe CÓDIGO, e código é
 * identidade. Um pedido que traz "AVSØ 0114 MUI" não precisa que o nome bata —
 * e não deve deixar o nome desempatar, porque o nome do pedido costuma ser o
 * que o cliente chama a peça, não o que o catálogo chama.
 *
 * Sem código, cai no nome, com a mesma regra dos insumos: exato, depois
 * semelhante, e nunca por sorteio.
 */
function casarProduto(codigo, nome, porCodigo, porNome, registros, valor) {
  const porCod = porCodigo.get(normalizar(codigo));
  if (porCod) return { registro: porCod, tipo: 'exato', por: 'codigo' };

  const exato = porNome.get(normalizar(nome));
  if (exato) return { registro: exato, tipo: 'exato', por: 'nome' };

  if (!String(nome || '').trim()) return porValor(valor, registros, nome);

  const frequencia = frequenciaDeTermos(registros);
  let nota = 0;
  let empatados = [];
  for (const r of registros) {
    const n = proximidadeDeInsumo(nome, r && r.nome, frequencia);
    if (n > nota) { nota = n; empatados = [r]; }
    else if (n === nota && n > 0) empatados.push(r);
  }

  const parecidos = nota >= LIMIAR_PARECIDO ? empatados : [];
  if (parecidos.length === 1) return { registro: parecidos[0], tipo: 'semelhante', por: 'nome' };

  // EMPATE — e é aqui que o preço vale mais.
  //
  // "BASE AO CUBO 3060" fica igualmente parecido com as seis variantes de
  // "Base Ao Cubo Retangular" (P/M/G × dois materiais): o nome acertou a
  // família e não diz qual das seis. Escolher no par ou ímpar poria cinco
  // sextos de chance de vender a peça errada pelo preço da outra.
  //
  // O preço praticado é exatamente o que separa as seis. Procurar entre as
  // EMPATADAS, e não no catálogo inteiro, é o que impede um "Vaso Silvia" que
  // por acaso custe o mesmo de ganhar de um nome que já apontou a família.
  if (parecidos.length > 1) {
    const desempatada = porValor(valor, parecidos, nome);
    if (desempatada.registro) return desempatada;
    return { registro: null, tipo: null, ambiguo: parecidos[0].nome };
  }

  // Nome não serviu para nada: o preço é a última pista.
  return porValor(valor, registros, nome);
}

/**
 * Último recurso: o PREÇO.
 *
 * Um pedido escrito à mão às vezes traz o nome que o cliente inventou e nenhum
 * código — e aí o único dado que ainda aponta para o catálogo é quanto a peça
 * custa. É uma pista fraca, e por isso é a última: só vale se bater EXATO e se
 * uma única peça tiver aquele preço.
 *
 * "Aproximado" não existe aqui. Dois centavos de diferença podem ser outra peça
 * inteira, e casar por perto significaria vender a errada pelo preço da certa —
 * exatamente o erro que ninguém percebe até o pedido chegar ao cliente.
 */
function porValor(valor, registros, lido) {
  const alvo = paraDecimal(valor);
  if (!Number.isFinite(alvo) || alvo <= 0) return { registro: null, tipo: null };

  const iguais = registros.filter(r => {
    const p = paraDecimal(r && r.preco_tabela);
    return Number.isFinite(p) && p === alvo;
  });

  if (iguais.length === 1) return { registro: iguais[0], tipo: 'valor', por: 'valor' };
  if (!iguais.length) return { registro: null, tipo: null };

  // Duas peças pelo mesmo preço é comum num catálogo — tamanhos de uma mesma
  // linha custam igual, e materiais diferentes às vezes também. Escolher no par
  // ou ímpar seria sorteio, mas desistir joga fora o que o texto ainda diz:
  // resta olhar QUAIS palavras do pedido cada uma das candidatas contém.
  const escolhida = desempatarPorConteudo(lido, iguais);
  if (escolhida) return { registro: escolhida, tipo: 'valor', por: 'valor' };
  return { registro: null, tipo: null, ambiguo: iguais[0].nome };
}

/**
 * Desempata candidatas comparando o que o texto lido diz com o nome delas.
 *
 * Quatro medidas, em ordem, e nunca somadas — misturá-las num número só
 * exigiria inventar um peso, e o peso inventado é que decidiria a venda:
 *
 *   1. QUANTAS palavras do pedido a candidata tem no NOME. É a medida grossa e
 *      vem primeiro: quem cobre mais do que foi escrito é a aposta melhor.
 *   2. Empatado o número, QUAIS palavras. "Retangular" está em todas as seis e
 *      não separa nada; "Marron" está numa e resolve sozinha. Entre duas que
 *      acertaram duas palavras cada, ganha a que acertou a que distingue.
 *   3 e 4. Empatado o nome, as mesmas duas contas sobre o CÓDIGO. É lá que mora
 *      o tamanho — "BASE AO CUBO 3060" contra "BACR 3060 MNM" —, e é a última
 *      coisa que ainda distingue duas peças de mesmo nome e mesmo preço. O
 *      código vem depois porque é sigla: uma coincidência de três letras não
 *      pode ganhar de uma palavra escrita por extenso.
 *
 * Empate nas quatro devolve null: sem nada que separe, escolher é sortear.
 */
function desempatarPorConteudo(lido, candidatas) {
  const termos = termosDeInsumo(lido);

  // Tokeniza uma vez por candidata: as contas abaixo consultam os mesmos
  // termos várias vezes, e refazer a quebra ali dentro seria trabalho repetido
  // a cada item de cada pedido.
  const porNome = candidatas.map(c => termosDeInsumo(c && c.nome));
  const porCodigo = candidatas.map(c => termosDeInsumo(c && c.codigo));

  const notas = candidatas.map((c, i) => ({
    candidata: c,
    quantosNome: quantos(termos, porNome[i]),
    raroNome: raridade(termos, porNome[i], porNome),
    quantosCodigo: quantos(termos, porCodigo[i]),
    raroCodigo: raridade(termos, porCodigo[i], porCodigo)
  }));

  const melhor = (a, b) => (b.quantosNome - a.quantosNome)
    || (b.raroNome - a.raroNome)
    || (b.quantosCodigo - a.quantosCodigo)
    || (b.raroCodigo - a.raroCodigo);

  notas.sort(melhor);
  if (notas.length > 1 && melhor(notas[0], notas[1]) === 0) return null;
  return notas[0].quantosNome > 0 || notas[0].quantosCodigo > 0
    ? notas[0].candidata
    : null;
}

/** Quantas das palavras lidas a candidata contém. A medida grossa. */
function quantos(termosLidos, termosDaCandidata) {
  let total = 0;
  for (const t of termosLidos) if (termosDaCandidata.has(t)) total += 1;
  return total;
}

/**
 * O mesmo, pesando cada acerto pela raridade do termo ENTRE AS CANDIDATAS —
 * não no catálogo inteiro.
 *
 * A raridade que importa aqui é a que separa ESTAS peças umas das outras: num
 * empate entre seis "Base Ao Cubo Retangular", "cubo" é comum entre elas e não
 * decide nada, ainda que seja raro no catálogo todo.
 */
function raridade(termosLidos, termosDaCandidata, termosDeTodas) {
  let total = 0;
  for (const t of termosLidos) {
    if (!termosDaCandidata.has(t)) continue;
    total += 1 / termosDeTodas.filter(set => set.has(t)).length;
  }
  return total;
}

/** Itens de um pedido, casados com o catálogo de produtos. */
/**
 * O catálogo de peças com o preço PRATICADO junto.
 *
 * `preco_venda` é custo apurado: ele se move sozinho quando um insumo
 * encarece. O que vai ao cliente é o da `tabela_fixa`, e são duas colunas
 * diferentes — por isso o catálogo é montado com a junção, e não lido direto
 * de `/api/produtos`.
 */
async function catalogoDeProdutos(api) {
  const [produtos, tabela] = await Promise.all([
    api.get('/api/produtos').then(lista).catch(() => []),
    api.get('/api/tabela_fixa').then(lista).catch(() => [])
  ]);

  const precos = new Map();
  for (const linha of tabela) {
    const id = Number(linha?.id_prod);
    if (Number.isFinite(id)) precos.set(id, linha?.vlr_prod);
  }

  return produtos.map(p => ({
    ...p,
    preco_tabela: precos.has(Number(p?.id)) ? precos.get(Number(p?.id)) : null
  }));
}

/**
 * Preço PRATICADO da peça — o que vai para o cliente.
 *
 * `preco_tabela` e não `preco_venda`: o segundo é custo apurado e se move
 * sozinho quando um insumo encarece. Ver src/utils/precoTabela.js.
 */
function precoDeVenda(produto) {
  // `paraDecimal` e não `Number`: a API devolve o valor como veio do banco, e
  // "1.234,56" vira NaN no `Number` — a peça mais cara do catálogo é
  // justamente a que tem separador de milhar.
  const n = paraDecimal(produto?.preco_tabela);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function montarItensDeOrcamento(linhas, porCodigo, porNome, registros = []) {
  const itens = [];
  const semCadastro = [];

  for (const linha of linhas) {
    const nome = texto(linha && linha.nome).trim();
    if (!nome) continue;

    const { registro: produto } = casarProduto(
      linha.codigo, nome, porCodigo, porNome, registros, linha.valor_unitario);
    if (!produto) { semCadastro.push(nome); continue; }

    const quantidade = Number(linha.quantidade);
    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      semCadastro.push(`${nome} (quantidade não reconhecida)`);
      continue;
    }

    // Preço do documento quando existe; preço de tabela quando não. Zero num
    // orçamento é um preço errado que se parece com um preço.
    //
    // `paraDecimal` e não `Number` nos dois: o valor vem como texto, e
    // "1.234,56" vira NaN no `Number` — que cairia no `|| 0` e mandaria a peça
    // mais cara do catálogo para o cliente valendo zero.
    const lido = paraDecimal(linha.valor_unitario);
    const temPreco = Number.isFinite(lido) && lido > 0;

    // `precoDeVenda` e não `produto.preco_venda`: o segundo é CUSTO apurado, e
    // é o praticado que vai ao cliente. A grade da revisão já mostrava o
    // praticado; aqui ia o custo, então o número conferido na tela não era o
    // que chegava ao orçamento.
    const daTabela = precoDeVenda(produto);

    itens.push({
      produto_id: Number(produto.id),
      codigo: produto.codigo || null,
      nome: produto.nome,
      quantidade,
      valor_unitario: temPreco ? lido : (daTabela || 0),
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

/**
 * "28/42/56" escrito no campo de PARCELAS são dias, não valores.
 *
 * É como este ramo escreve prazo de pagamento, e o modelo copia a expressão
 * inteira para `parcelas` com frequência. Lida como valor, ela virava três
 * parcelas de R$ 28, R$ 42 e R$ 56 num pedido de oito mil reais — e os dias
 * caíam no padrão 30/60/90, que ninguém combinou.
 *
 * O sinal é ESTRUTURAL, não estatístico: dinheiro neste programa vem com `R$`
 * ou com centavos ("1.899,90"), e nenhum dos dois passa pelo teste de CADA
 * pedaço abaixo. É esse teste que separa uma coisa da outra — exigir que
 * TODOS casem é o que impede "R$ 28,00/42" de entrar aqui por engano.
 *
 * Uma conferência de `R$` na frase inteira estava aqui e foi tirada: ela nunca
 * chegava a decidir nada, porque o pedaço com `R$` já era recusado. Guarda que
 * não guarda parece proteção e não é.
 */
function diasEscritosComoParcelas(bruto) {
  const cru = texto(bruto).trim();
  if (!cru) return [];

  const pedacos = cru.split(/[/;|]| e /i);
  if (pedacos.length < 2) return [];

  const dias = pedacos.map(p => {
    const achado = /^\s*(\d{1,3})\s*(?:dias?)?\s*$/i.exec(p);
    const n = achado ? Number(achado[1]) : null;
    return Number.isFinite(n) && n > 0 && n <= 365 ? n : null;
  });

  return dias.every(n => n !== null) ? dias : [];
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

  // Quando o campo de parcelas traz DIAS, ele não traz valores — e são esses
  // dias que valem, porque o campo de prazo veio vazio justamente por eles
  // terem sido escritos do outro lado.
  const diasNasParcelas = diasEscritosComoParcelas(dados.parcelas);
  const valores = diasNasParcelas.length ? [] : numerosDe(dados.parcelas);
  const doPrazo = diasDe(dados.prazo);
  const dias = doPrazo.length ? doPrazo : diasNasParcelas;

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

  const [contatos, transportadoras] = await Promise.all([
    api.get('/api/contatos_cliente', { query: { id_cliente: alvo.id } }).then(lista).catch(() => []),
    api.get('/api/transportadoras', { query: { id_cliente: alvo.id } }).then(lista).catch(() => [])
  ]);

  saida.contato = escolherDoCadastro({
    lido: dados.contato,
    registros: contatos,
    coluna: 'nome',
    rotulo: 'Contato',
    avisos: saida.avisos
  });

  // A coluna chama `transportadora`, não `nome` — é o nome dela na tabela.
  saida.transportadora = escolherDoCadastro({
    lido: dados.transportadora,
    registros: transportadoras,
    coluna: 'transportadora',
    rotulo: 'Transportadora',
    avisos: saida.avisos
  });

  return saida;
}

/**
 * Escolhe um registro do cadastro do cliente, com a MESMA regra da grade.
 *
 * A grade de revisão já preenche contato e transportadora a partir do cadastro
 * (ver `anotarEmpresa`, em iaController.js): o que o documento trouxe vale se
 * existir; não existindo e havendo uma opção só, ela entra.
 *
 * Aqui a regra era outra — só aceitava o que o documento escreveu. O resultado
 * era a pior divergência possível: a tela mostrava o contato preenchido, e o
 * orçamento abria sem contato nenhum. Quem revisou conferiu uma coisa e
 * recebeu outra.
 */
function escolherDoCadastro({ lido, registros, coluna, rotulo, avisos }) {
  const nome = texto(lido);

  // Cliente SEM nenhum registro desses. Se o documento nomeou um, o aviso vale
  // do mesmo jeito — o que falta é cadastrar, e é isso que precisa ser dito.
  if (!registros.length) {
    if (nome) avisos.push(`${rotulo} "${nome}" não está no cadastro deste cliente`);
    return null;
  }

  if (nome) {
    const achado = indexarPor(registros, coluna).get(normalizar(nome));
    if (achado) return { id: Number(achado.id), nome: achado[coluna] };
  }

  // Documento CALADO e uma opção só: ela entra. É o que o sistema sabe, e
  // saber é melhor que deixar em branco.
  if (!nome && registros.length === 1) {
    return { id: Number(registros[0].id), nome: registros[0][coluna] };
  }

  // Documento que NOMEIA alguém que não está no cadastro é outra história:
  // trocar por quem está cadastrado põe a proposta no nome da pessoa errada, e
  // ninguém percebe — o nome certo estava escrito no pedido. O aviso manda
  // cadastrar, que é o que resolve.
  if (nome) avisos.push(`${rotulo} "${nome}" não está no cadastro deste cliente`);
  return null;
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
    // O catálogo COM a junção da tabela fixa. Lido direto de `/api/produtos`,
    // o preço praticado não vem — e o item saía com o custo apurado.
    const produtos = await catalogoDeProdutos(api);
    const r = montarItensDeOrcamento(
      lista(dados.itens), indexarPor(produtos, 'codigo'), indexarPor(produtos, 'nome'), produtos);
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
        nome: achado[esquema.campoDeExibicao] || achado.nome || achado.nome_fantasia || null,
        // O registro INTEIRO, e não só o nome: quando a leitura aponta para
        // algo que já existe, a tela abre o modal de EDITAR daquele registro —
        // e os modais de editar recebem o registro por variável global
        // (`window.produtoSelecionado`, `window.clienteEditar`), não por id.
        //
        // Vai daqui porque a busca já foi feita logo acima. Deixar a tela
        // buscar de novo seria uma segunda ida ao servidor para saber o que já
        // está na mão.
        registro: achado
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
  diasEscritosComoParcelas,
  casarProduto,
  proximidadeDeInsumo,
  termosDeInsumo,
  desempatarPorConteudo,
  frequenciaDeTermos,
  mesmoProcesso,
  interpretarPagamento,
  formaDePagamento,
  vincularAoCliente,
  catalogoDeProdutos,
  precoDeVenda,
  montarPreenchimento,
  montarInsumos,
  montarItensDeOrcamento,
  montarContatos,
  indexarPor
};
