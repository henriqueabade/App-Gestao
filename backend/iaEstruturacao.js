// De TEXTO para LINHAS de tabela, com o Groq (Llama).
//
// Recebe o texto que a etapa de leitura produziu — venha de uma planilha lida
// na máquina ou da transcrição de um PDF pelo Gemini — e devolve itens no
// formato do destino escolhido.
//
// ---------------------------------------------------------------------------
// NADA DO QUE O MODELO DEVOLVE É CONFIADO
//
// A saída de um modelo de linguagem é uma SUGESTÃO, não um registro. Antes de
// virar item, cada campo passa por coerção e validação aqui: número em
// português vira número, texto é cortado no comprimento da coluna, campo
// obrigatório em falta derruba a linha com o motivo escrito.
//
// Isso não é desconfiança gratuita. Um preço que o modelo devolveu como
// "189,90 (à vista)" viraria NaN no banco; um nome de 4 mil caracteres
// estouraria a coluna; e um item sem quantidade entraria no estoque como zero
// sem ninguém notar.
//
// ---------------------------------------------------------------------------
// TRÊS TENTATIVAS ANTES DE DESISTIR
//
// O modo estrito da Groq recusa a resposta inteira quando o modelo devolve JSON
// malformado — e a causa mais comum não é o modelo estar perdido, é a geração
// ter sido CORTADA no meio por limite de saída. Devolver "Failed to validate
// JSON" ao usuário nesse caso é jogar fora uma extração que estava quase boa.
//
// Então, em ordem:
//
//   1. modo estrito (`json_object`), com `max_tokens` folgado;
//   2. se recusar, aproveitar o `failed_generation` que a própria Groq devolve
//      — é o texto que o modelo gerou, e costuma ser JSON cortado que dá para
//      fechar;
//   3. só então, uma segunda chamada SEM o modo estrito, deixando o modelo
//      escrever livre, e extraindo o JSON do texto.
//
// A terceira tentativa custa uma chamada a mais, e é por isso que ela é a
// última: a segunda não custa nada.
//
// ---------------------------------------------------------------------------
// DOCUMENTO LONGO É FATIADO
//
// Nenhuma dessas três tentativas resolve o caso em que o documento simplesmente
// não CABE numa resposta. Uma planilha de 18 clientes, com 13 campos e contatos
// cada, passa de qualquer teto de saída razoável — e o que acontece então é o
// modo de falha mais traiçoeiro deste módulo: a resposta é JSON válido, os
// itens que vieram estão certos, e os que faltaram não deixam rastro nenhum. O
// usuário recebe 3 dos 18 e não tem como saber que havia mais.
//
// Por isso, quando a resposta vem cortada, o texto é PARTIDO EM DOIS numa
// quebra de linha e cada metade é extraída por conta própria — de novo, e de
// novo, até caber. O resultado cortado é jogado fora: as metades cobrem o mesmo
// texto inteiro, e aproveitar as duas coisas duplicaria tudo o que veio antes
// do corte.
//
// Fatiar só DEPOIS do corte, e não preventivamente, é de propósito. O documento
// que cabe numa resposta só é o caso comum, e ele continua custando uma chamada;
// quem paga o fatiamento é o documento que precisa dele.
//
// ---------------------------------------------------------------------------
// POR QUE `json_object` E NÃO `json_schema`
//
// A Groq hospeda vários modelos e o suporte a `json_schema` varia de um para
// outro — o usuário escolhe o modelo no .env. Pedir um esquema estrito que o
// modelo dele não suporta devolveria 400 na primeira leitura de verdade.
// `json_object` é aceito por todos, o esquema vai descrito no prompt, e a
// garantia de forma vem da validação daqui — que precisaria existir de
// qualquer jeito.

const provedores = require('./iaProvedores');
const { paraDecimal } = require('./numeros');
const { obterEsquema } = require('./iaEsquemas');

const { erro, pedir, chaveGroq, modeloGroq, GROQ_BASE } = provedores;

/** Teto de itens por leitura. Vale como rede contra alucinação em laço. */
const MAX_ITENS = Number(process.env.IA_MAX_ITENS) || 300;

/**
 * Teto de saída do modelo.
 *
 * Sem isto a Groq usa o padrão dela, que corta a geração bem antes do fim de
 * uma lista longa — e o JSON cortado é recusado pelo modo estrito, derrubando
 * a extração inteira com "Failed to validate JSON".
 */
const MAX_SAIDA = Number(process.env.IA_MAX_SAIDA_TOKENS) || 8000;

/**
 * Quantas chamadas de extração uma leitura pode gastar no total.
 *
 * O fatiamento é recursivo e cada nível dobra o número de chamadas. Sem teto,
 * um documento que o modelo se recusa a extrair — por qualquer motivo — geraria
 * dezenas de chamadas pagas sobre o mesmo arquivo antes de desistir.
 */
const MAX_CHAMADAS = Number(process.env.IA_MAX_CHAMADAS) || 16;

/** Quebra de linha. Nomeada porque aparece no corte e na contagem. */
const chr10 = String.fromCharCode(10);

/**
 * O piso do fatiamento é UMA LINHA, não um número de caracteres.
 *
 * Um piso em caracteres parece prudente e não é: ele para de partir enquanto o
 * pedaço ainda tem vários registros dentro, e aí a perda volta a ser silenciosa
 * bem na fronteira escolhida. O único piso que corresponde a algo real é o
 * registro: não existe extrair metade de uma linha.
 *
 * Quem impede a recursão de fugir é MAX_CHAMADAS, que é o custo de verdade.
 */
const MIN_LINHAS = 2;

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function descreverCampos(campos, recuo = '') {
  return campos.map(c => {
    const partes = [`"${c.chave}"`, `(${c.tipo}${c.obrigatorio ? ', obrigatório' : ''})`];
    if (c.descricao) partes.push(`— ${c.descricao}`);
    const linha = `${recuo}- ${partes.join(' ')}`;
    // A sub-lista é descrita recuada, logo abaixo do campo que a contém: sem
    // isso o modelo não sabe a forma dos objetos e devolve uma lista de
    // strings ou um objeto solto.
    if (c.tipo !== 'lista' || !c.subcampos?.length) return linha;
    return [linha, `${recuo}  Cada entrada de "${c.chave}" tem:`,
      descreverCampos(c.subcampos, `${recuo}  `)].join('\n');
  }).join('\n');
}

/** Exemplo da forma de um item, para o modelo copiar. */
function moldeDoItem(campos) {
  return '{' + campos.map(c => {
    if (c.tipo !== 'lista') return `"${c.chave}": ...`;
    return `"${c.chave}": [${moldeDoItem(c.subcampos || [])}]`;
  }).join(', ') + '}';
}

function montarPrompt(esquema) {
  return [
    'Você extrai dados de documentos comerciais e devolve JSON.',
    '',
    esquema.instrucoes,
    '',
    'Campos de cada item:',
    descreverCampos(esquema.campos),
    '',
    'Responda SOMENTE com um objeto JSON nesta forma:',
    `{"itens": [${moldeDoItem(esquema.campos)}]}`,
    '',
    'Regras da resposta:',
    '- Use exatamente esses nomes de campo, sem acrescentar outros.',
    '- Campo sem valor no documento: use null. Nunca invente.',
    '- Lista sem nenhuma entrada: use [].',
    '- Números: devolva como estão no documento (pode manter a vírgula decimal).',
    '- Se não houver nenhum item, devolva {"itens": []}.'
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Coerção
// ---------------------------------------------------------------------------

const vazio = v => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/**
 * Converte um valor bruto do modelo para o tipo do campo.
 * Devolve `undefined` quando não dá para aproveitar — quem chama decide se
 * isso derruba a linha (campo obrigatório) ou só deixa a célula vazia.
 */
function coagir(campo, bruto) {
  // Lista vazia é resposta legítima ("esta empresa não tem contato no
  // documento") e precisa virar `[]`, não `null` — quem consome espera um
  // array e um null aqui estouraria no `.map`.
  if (campo.tipo === 'lista') return coagirLista(campo, bruto);

  if (vazio(bruto)) return null;

  if (campo.tipo === 'numero' || campo.tipo === 'dinheiro') {
    // `paraDecimal` é o mesmo conversor que o resto do programa usa: aceita
    // "1.234,56" e "1,234.56" e limita a 4 casas. Reimplementar aqui criaria
    // uma segunda regra de número no mesmo sistema.
    const n = paraDecimal(bruto);
    if (n === null) return undefined;
    // Quantidade e preço negativos não existem numa lista de compra; quase
    // sempre é sinal trocado de um estorno lido fora de contexto.
    if (n < 0) return undefined;
    return n;
  }

  if (campo.tipo === 'data') {
    const texto = String(bruto).trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    // dd/mm/aaaa, que é como o documento brasileiro escreve.
    const br = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(texto);
    if (br) return `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
    return undefined;
  }

  // Objeto ou array onde se esperava texto é alucinação de forma: descartar é
  // melhor do que gravar "[object Object]" na coluna.
  if (typeof bruto === 'object') return undefined;

  const texto = String(bruto).replace(/\s+/g, ' ').trim();
  if (!texto) return null;
  return campo.max ? texto.slice(0, campo.max) : texto;
}

/**
 * Sub-registros de um campo `lista` (os contatos de uma empresa).
 *
 * Entrada torta é DESCARTADA, não corrigida: um contato sem nome não serve
 * para nada e, pior, viraria uma linha em branco no cadastro da empresa. O que
 * caiu é anunciado junto do item, para o revisor saber que o documento tinha
 * mais gente do que a tela mostra.
 */
function coagirLista(campo, bruto) {
  if (bruto === null || bruto === undefined || bruto === '') return [];
  if (!Array.isArray(bruto)) return undefined;

  const subcampos = campo.subcampos || [];
  const obrigatorios = subcampos.filter(sc => sc.obrigatorio);
  const teto = campo.max_itens || 50;
  const saida = [];

  for (const cru of bruto) {
    if (saida.length >= teto) break;
    if (!cru || typeof cru !== 'object' || Array.isArray(cru)) continue;

    const entrada = {};
    let aproveitavel = true;
    for (const sc of subcampos) {
      const valor = coagir(sc, cru[sc.chave]);
      entrada[sc.chave] = valor === undefined ? null : valor;
    }
    for (const sc of obrigatorios) {
      const v = entrada[sc.chave];
      if (v === null || v === '') aproveitavel = false;
    }
    if (aproveitavel) saida.push(entrada);
  }

  return saida;
}

/** Quantas entradas de uma lista o modelo mandou e não sobreviveram. */
function contarDescartes(campo, bruto, aceitos) {
  if (!Array.isArray(bruto)) return 0;
  return Math.max(0, bruto.length - (aceitos?.length || 0));
}

/**
 * Uma linha crua do modelo vira `{ dados, problemas }`.
 * `problemas` vazio significa item aproveitável.
 */
function validarItem(esquema, bruto) {
  const dados = {};
  const problemas = [];

  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) {
    return { dados, problemas: ['A linha não veio como objeto'] };
  }

  for (const campo of esquema.campos) {
    const valor = coagir(campo, bruto[campo.chave]);

    if (valor === undefined) {
      problemas.push(`${campo.rotulo}: valor não reconhecido (${String(bruto[campo.chave]).slice(0, 40)})`);
      dados[campo.chave] = null;
      continue;
    }

    if (campo.tipo === 'lista') {
      const perdidos = contarDescartes(campo, bruto[campo.chave], valor);
      if (perdidos) {
        // Ressalva, não bloqueio: a empresa entra mesmo sem um dos contatos,
        // e esconder a perda é que seria grave.
        problemas.push(`${perdidos} ${campo.rotulo.toLowerCase()} sem os dados mínimos foram descartados`);
      }
      dados[campo.chave] = valor;
      continue;
    }

    if (campo.obrigatorio && (valor === null || valor === '')) {
      problemas.push(`${campo.rotulo} não veio preenchido`);
    }
    dados[campo.chave] = valor;
  }

  // Campo que o modelo inventou é sinal de que ele saiu do esquema. Não entra
  // no item, mas fica anotado: é o que explica um resultado estranho.
  const conhecidos = new Set(esquema.campos.map(c => c.chave));
  const extras = Object.keys(bruto).filter(k => !conhecidos.has(k));
  if (extras.length) problemas.push(`Campos ignorados: ${extras.slice(0, 5).join(', ')}`);

  return { dados, problemas };
}

// ---------------------------------------------------------------------------
// Chamada ao modelo
// ---------------------------------------------------------------------------

/**
 * Fecha um JSON que foi cortado no meio.
 *
 * Uma geração interrompida deixa chaves e colchetes abertos, e às vezes um
 * objeto pela metade (`{"nome": "Fita`). Descartar o texto inteiro por causa
 * disso jogaria fora as dezenas de itens que vieram completos ANTES do corte —
 * que é justamente o caso em que este socorro entra.
 *
 * O corte não pode cair em qualquer lugar: `{"a":1},{"c"` fechado à força vira
 * `{"a":1},{"c"}`, que não é JSON. Por isso o algoritmo só considera os pontos
 * em que um objeto ou uma lista TERMINOU, e tenta do mais recente para o mais
 * antigo até um deles parsear.
 */
function fecharJsonCortado(texto) {
  const cru = String(texto || '');
  const pilha = [];
  let dentroDeTexto = false;
  let escapado = false;

  /** Pontos onde um valor composto terminou, com o que ficava aberto ali. */
  const fechamentos = [];

  for (let i = 0; i < cru.length; i++) {
    const c = cru[i];
    if (escapado) { escapado = false; continue; }
    if (c === '\\') { escapado = true; continue; }
    if (c === '"') { dentroDeTexto = !dentroDeTexto; continue; }
    if (dentroDeTexto) continue;
    if (c === '{' || c === '[') { pilha.push(c === '{' ? '}' : ']'); continue; }
    if (c === '}' || c === ']') {
      pilha.pop();
      fechamentos.push({ pos: i, aberto: pilha.slice() });
    }
  }

  // Nada ficou aberto: ou é JSON completo (não é assunto desta função) ou é
  // texto que não começa como JSON.
  if (!pilha.length) return null;

  for (let i = fechamentos.length - 1; i >= 0; i--) {
    const { pos, aberto } = fechamentos[i];
    // De dentro para fora, e sem a vírgula que ficaria pendurada.
    const tentativa = cru.slice(0, pos + 1).replace(/,\s*$/, '')
      + aberto.slice().reverse().join('');
    try { return JSON.parse(tentativa); } catch (_) { /* tenta um ponto antes */ }
  }

  return null;
}

/** O JSON pode vir embrulhado em cerca de código, ou cortado no meio. */
function extrairJson(texto) {
  const cru = String(texto || '').trim();
  const semCerca = cru.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(semCerca);
  } catch (_) { /* segue para as tentativas de recuperação */ }

  // O primeiro objeto completo do texto.
  const inicio = semCerca.indexOf('{');
  const fim = semCerca.lastIndexOf('}');
  if (inicio !== -1 && fim > inicio) {
    try { return JSON.parse(semCerca.slice(inicio, fim + 1)); } catch (_) { /* segue */ }
  }

  // Geração cortada: fecha o que ficou aberto e aproveita o que veio inteiro.
  return fecharJsonCortado(inicio === -1 ? semCerca : semCerca.slice(inicio));
}

/** Corpo da chamada de extração. `estrito` liga o modo JSON da Groq. */
function corpoDaChamada({ modelo, sistema, conteudo, estrito }) {
  return JSON.stringify({
    model: modelo,
    // Extração é trabalho determinístico: variação aqui não é criatividade,
    // é um preço diferente a cada execução sobre o mesmo documento.
    temperature: 0,
    // Sem teto explícito, a Groq corta a geração bem antes do fim de uma lista
    // longa — e o JSON cortado é recusado pelo modo estrito, derrubando a
    // extração inteira.
    max_tokens: MAX_SAIDA,
    ...(estrito ? { response_format: { type: 'json_object' } } : {}),
    messages: [
      { role: 'system', content: sistema },
      { role: 'user', content: conteudo }
    ]
  });
}

/**
 * Pede a extração ao modelo, com as três tentativas descritas no topo.
 *
 * Devolve `{ dados, truncado }`. `truncado` é verdadeiro quando a geração foi
 * cortada por tamanho — o revisor precisa saber que pode faltar item do fim da
 * lista, e o dado que veio antes do corte continua valendo.
 */
async function pedirExtracao({ chave, modelo, sistema, conteudo }) {
  const chamar = estrito => pedir(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${chave}`, 'content-type': 'application/json' },
    body: corpoDaChamada({ modelo, sistema, conteudo, estrito })
  }, 'Groq');

  // 1) Modo estrito.
  let resposta;
  try {
    resposta = await chamar(true);
  } catch (e) {
    if (!e?.jsonInvalido) throw e;

    // 2) A recusa traz o que o modelo chegou a gerar. Quase sempre é um JSON
    //    bom cortado no meio, e fechá-lo sai de graça.
    const gerado = e.corpo?.error?.failed_generation;
    const salvo = gerado ? extrairJson(gerado) : null;
    if (salvo) return { dados: salvo, truncado: true };

    // 3) Só agora uma segunda chamada, sem o modo estrito. Solto, o modelo
    //    costuma acertar a forma; o que ele não faz é garantir — e por isso a
    //    validação daqui continua valendo do mesmo jeito.
    try {
      resposta = await chamar(false);
    } catch (e2) {
      // As duas falharam. Repetir "JSON malformado" deixaria o usuário sem
      // saída: o que resolve, aqui, é trocar o modelo.
      if (e2?.jsonInvalido) {
        throw erro(502,
          'O modelo não conseguiu montar a resposta neste documento. '
          + 'Troque o modelo em Configurar, ou tente com menos arquivos de uma vez.');
      }
      throw e2;
    }
  }

  const escolha = resposta?.choices?.[0];
  if (!escolha) throw erro(502, 'Groq não devolveu nenhuma extração.');

  const dados = extrairJson(escolha.message?.content);
  if (!dados) {
    throw erro(502,
      'Groq devolveu uma resposta que não é JSON. Tente de novo, ou troque o modelo em Configurar.');
  }

  // O corte por limite de saída é o caso mais traiçoeiro: a resposta é JSON
  // válido, só que incompleta.
  return { dados, truncado: escolha.finish_reason === 'length' };
}

/**
 * Parte o texto em dois, na quebra de linha mais próxima do meio.
 *
 * O corte TEM de cair entre linhas. Partir no meio de uma linha quebraria um
 * registro em dois, e cada metade viraria um item pela metade — que é pior do
 * que o corte que estamos tentando consertar, porque um item pela metade parece
 * um item bom.
 *
 * Devolve `null` quando não há onde cortar: pedaço curto demais, ou uma linha
 * só. Quem chama trata isso como "não dá para fatiar mais".
 */
function dividirEmDuas(texto) {
  const cru = String(texto || '');
  if (cru.split(chr10).filter(l => l.trim()).length < MIN_LINHAS) return null;

  const meio = Math.floor(cru.length / 2);
  const candidatos = [cru.lastIndexOf('\n', meio), cru.indexOf('\n', meio)]
    .filter(p => p > 0 && p < cru.length - 1)
    .sort((a, b) => Math.abs(a - meio) - Math.abs(b - meio));

  if (!candidatos.length) return null;
  const a = cru.slice(0, candidatos[0]).trim();
  const b = cru.slice(candidatos[0] + 1).trim();
  if (!a || !b) return null;
  return [a, b];
}

/** A lista de itens pode vir como `{itens:[...]}` ou como array solto. */
function listaCrua(dados) {
  if (Array.isArray(dados?.itens)) return dados.itens;
  if (Array.isArray(dados)) return dados;
  return null;
}

/**
 * Extrai o texto; se a resposta veio cortada, parte o texto e extrai as partes.
 *
 * `orcamento` é compartilhado por toda a recursão e conta as chamadas já
 * gastas. Quando ele zera, o que já foi extraído continua valendo e `truncado`
 * sobe verdadeiro — é a diferença entre entregar 30 dos 40 AVISANDO e entregar
 * 30 dos 40 em silêncio.
 */
async function extrairFatiando({ chave, modelo, sistema, texto, orcamento }) {
  if (orcamento.restantes <= 0) return { brutos: [], truncado: true };
  orcamento.restantes -= 1;

  const { dados, truncado } = await pedirExtracao({ chave, modelo, sistema, conteudo: texto });
  const brutos = listaCrua(dados);
  if (!brutos) throw erro(502, 'Groq devolveu JSON sem a lista de itens.');
  if (!truncado) return { brutos, truncado: false };

  const partes = dividirEmDuas(texto);
  // Não dá para partir mais. O que veio antes do corte continua valendo, e o
  // aviso sobe junto para a tela de revisão.
  if (!partes) return { brutos, truncado: true };

  const saida = [];
  let faltou = false;
  for (const parte of partes) {
    const r = await extrairFatiando({ chave, modelo, sistema, texto: parte, orcamento });
    saida.push(...r.brutos);
    faltou = faltou || r.truncado;
  }

  // Fica UM dos dois conjuntos, nunca a soma: as metades cobrem o mesmo texto
  // do pai, e somar duplicaria cada item que veio antes do corte.
  //
  // Fica o MAIOR. Quando o fatiamento funciona, ele é sempre o das metades. O
  // caso em que não é: o orçamento de chamadas acabou no meio da recursão e as
  // metades voltaram vazias — aí descartar o resultado do pai entregaria zero
  // item de um documento que tinha dado alguns, que é pior do que não ter
  // fatiado.
  if (saida.length < brutos.length) return { brutos, truncado: true };
  return { brutos: saida, truncado: faltou };
}

/**
 * Manda o texto para o Groq e devolve `{ itens, descartados, modelo }`.
 *
 * `descartados` não é detalhe: quando o documento tinha 40 linhas e saíram 37,
 * quem revisa precisa saber que 3 caíram e por quê — senão confere as 37,
 * aprova, e as outras 3 somem sem que ninguém perceba.
 */
async function estruturar({ texto, destino, modelo }) {
  const esquema = obterEsquema(destino);
  if (!esquema) throw erro(400, `O destino "${destino}" ainda não sabe extrair dados.`);

  const chave = chaveGroq();
  if (!chave) throw erro(400, 'GROQ_API_KEY não está preenchida no .env');

  const conteudo = String(texto || '').trim();
  if (!conteudo) throw erro(400, 'Não há texto lido para extrair.');

  const alvo = modelo || modeloGroq();

  const orcamento = { restantes: MAX_CHAMADAS };
  const { brutos, truncado } = await extrairFatiando({
    chave, modelo: alvo, sistema: montarPrompt(esquema), texto: conteudo, orcamento
  });

  const itens = [];
  const descartados = [];

  for (const [i, bruto] of brutos.entries()) {
    if (itens.length >= MAX_ITENS) {
      descartados.push({ linha: i + 1, motivo: `Passou do limite de ${MAX_ITENS} itens por leitura` });
      continue;
    }

    const { dados: item, problemas } = validarItem(esquema, bruto);

    // Falta de campo obrigatório derruba a linha; o resto é ressalva que
    // acompanha o item até a revisão.
    const bloqueia = problemas.some(p => p.includes('não veio preenchido') || p.includes('não veio como objeto'));
    if (bloqueia) {
      descartados.push({ linha: i + 1, motivo: problemas.join('; '), dados: item });
      continue;
    }

    itens.push({
      linha: itens.length + 1,
      dados: item,
      // A tela mostra isto ao lado do item — é o que faz o revisor olhar
      // primeiro para as linhas duvidosas.
      mensagem: problemas.length ? problemas.join('; ') : null
    });
  }

  return {
    itens,
    descartados,
    modelo: alvo,
    truncado,
    chamadas: MAX_CHAMADAS - orcamento.restantes
  };
}

module.exports = {
  MAX_ITENS,
  MAX_SAIDA,
  MAX_CHAMADAS,
  MIN_LINHAS,
  dividirEmDuas,
  extrairFatiando,
  corpoDaChamada,
  pedirExtracao,
  fecharJsonCortado,
  estruturar,
  montarPrompt,
  descreverCampos,
  moldeDoItem,
  coagir,
  coagirLista,
  validarItem,
  extrairJson
};
