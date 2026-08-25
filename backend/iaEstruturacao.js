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

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function descreverCampos(esquema) {
  return esquema.campos.map(c => {
    const partes = [`"${c.chave}"`, `(${c.tipo}${c.obrigatorio ? ', obrigatório' : ''})`];
    if (c.descricao) partes.push(`— ${c.descricao}`);
    return `- ${partes.join(' ')}`;
  }).join('\n');
}

function montarPrompt(esquema) {
  return [
    'Você extrai dados de documentos comerciais e devolve JSON.',
    '',
    esquema.instrucoes,
    '',
    'Campos de cada item:',
    descreverCampos(esquema),
    '',
    'Responda SOMENTE com um objeto JSON nesta forma:',
    '{"itens": [{' + esquema.campos.map(c => `"${c.chave}": ...`).join(', ') + '}]}',
    '',
    'Regras da resposta:',
    '- Use exatamente esses nomes de campo, sem acrescentar outros.',
    '- Campo sem valor no documento: use null. Nunca invente.',
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

/** O JSON pode vir embrulhado em cerca de código, apesar do formato pedido. */
function extrairJson(texto) {
  const cru = String(texto || '').trim();
  const semCerca = cru.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(semCerca);
  } catch (_) {
    // Última tentativa: o primeiro objeto completo do texto.
    const inicio = semCerca.indexOf('{');
    const fim = semCerca.lastIndexOf('}');
    if (inicio === -1 || fim <= inicio) return null;
    try { return JSON.parse(semCerca.slice(inicio, fim + 1)); } catch (_) { return null; }
  }
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

  const resposta = await pedir(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${chave}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: alvo,
      // Extração é trabalho determinístico: variação aqui não é criatividade,
      // é um preço diferente a cada execução sobre o mesmo documento.
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: montarPrompt(esquema) },
        { role: 'user', content: conteudo }
      ]
    })
  }, 'Groq');

  const escolha = resposta?.choices?.[0];
  if (!escolha) throw erro(502, 'Groq não devolveu nenhuma extração.');

  const dados = extrairJson(escolha.message?.content);
  if (!dados) throw erro(502, 'Groq devolveu uma resposta que não é JSON válido.');

  const brutos = Array.isArray(dados.itens) ? dados.itens
    : Array.isArray(dados) ? dados
      : null;
  if (!brutos) throw erro(502, 'Groq devolveu JSON sem a lista de itens.');

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

  // O corte por limite de saída é o caso mais traiçoeiro: a resposta é JSON
  // válido, só que incompleta. Sem aviso, o revisor aprova metade da lista
  // achando que é a lista inteira.
  const truncado = escolha.finish_reason === 'length';

  return { itens, descartados, modelo: alvo, truncado };
}

module.exports = {
  MAX_ITENS,
  estruturar,
  montarPrompt,
  descreverCampos,
  coagir,
  validarItem,
  extrairJson
};
