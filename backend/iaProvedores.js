// Camada de acesso aos provedores de IA do módulo.
//
// São dois, com papéis diferentes:
//
//   Gemini (Google) ..... LEITURA. Recebe o PDF ou a foto e devolve o conteúdo
//                         em texto. É o único dos dois que enxerga documento
//                         e imagem, então todo OCR passa por aqui.
//   Groq (Llama) ........ ESTRUTURAÇÃO. Recebe o texto — venha do Gemini ou de
//                         uma planilha lida localmente — e devolve JSON no
//                         formato da tabela de destino.
//
// Planilha NÃO passa pelo Gemini: ela já é texto estruturado, e mandar uma
// imagem de tabela para um modelo de visão só adiciona erro de leitura a um
// dado que estava exato.
//
// ---------------------------------------------------------------------------
// AS CHAVES NUNCA SAEM DAQUI
//
// Este arquivo roda no backend local. `configuracao()` devolve apenas se a
// chave existe e os quatro últimos caracteres — o suficiente para o usuário
// conferir que colou a chave certa, e insuficiente para usá-la. Nenhuma rota
// pode devolver `process.env.*_API_KEY` cru: o renderer é uma página web e
// tudo que chega nele é inspecionável.

// Endereço dos provedores. Vem de variável de ambiente com padrão embutido:
// quem usa um proxy corporativo ou um endpoint regional aponta para lá sem
// mexer no código — e é por aqui que os testes trocam o provedor por um duplo
// local, em vez de sequestrar o `fetch` global e derrubar de quebra as
// chamadas do app para a própria API.
const GEMINI_BASE = (process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
const GROQ_BASE = (process.env.GROQ_API_BASE || 'https://api.groq.com/openai/v1').replace(/\/+$/, '');

/**
 * Modelos padrão.
 *
 * São um ponto de partida, não uma verdade: o catálogo dos dois provedores
 * muda com frequência e um id que não existe mais devolve 404 na primeira
 * chamada. Por isso a tela de configuração LISTA os modelos da conta — o
 * usuário confere e ajusta o .env com o que ele realmente tem.
 */
const configArmazenada = require('./iaConfiguracao');

const PADROES = {
  geminiModelo: 'gemini-2.5-flash',
  groqModelo: 'llama-3.3-70b-versatile'
};

/**
 * Três camadas, nesta ordem: o que foi configurado na TELA, o que a instalação
 * pôs no .env, e o padrão do programa.
 *
 * A ordem é o que permite a configuração no banco existir sem mudar nada em
 * quem nunca a usou: sem linha gravada, tudo continua como estava.
 */
const escolher = (chave, variavel, padrao) => {
  const daTela = configArmazenada.configurado(chave);
  if (daTela !== null && daTela !== undefined && daTela !== '') return daTela;
  const doEnv = process.env[variavel];
  if (doEnv !== undefined && String(doEnv).trim() !== '') {
    const n = Number(doEnv);
    return typeof padrao === 'number' ? (Number.isFinite(n) && n > 0 ? n : padrao) : String(doEnv).trim();
  }
  return padrao;
};

const LIMITES = {
  // 10 MB e não 15: o arquivo viaja em base64 dentro do JSON, o que infla o
  // corpo em ~33%, e a requisição inline do Gemini é recusada perto de 20 MB.
  arquivoMb: () => escolher('arquivo_mb', 'IA_MAX_ARQUIVO_MB', 10),
  arquivos: () => escolher('arquivos', 'IA_MAX_ARQUIVOS', 10),
  timeoutMs: () => escolher('timeout_ms', 'IA_TIMEOUT_MS', 120000),
  // O texto lido é gravado em ia_extracao_arquivos.texto e trafega pela API
  // externa, que recusa corpo grande. O corte acontece antes de gravar.
  textoMaxChars: () => escolher('texto_max_chars', 'IA_TEXTO_MAX_CHARS', 120000)
};

// ---------------------------------------------------------------------------
// Erros
// ---------------------------------------------------------------------------

function erro(status, mensagem, causa) {
  const e = new Error(mensagem);
  e.status = status;
  if (causa) e.causa = causa;
  return e;
}

/**
 * Erro de provedor, com o CORPO da resposta pendurado.
 *
 * O corpo não é curiosidade: quando a Groq recusa um JSON malformado, ela
 * devolve em `error.failed_generation` o texto que o modelo chegou a gerar. É
 * quase sempre um JSON bom cortado no meio — e aproveitá-lo evita uma segunda
 * chamada paga só para pedir a mesma coisa de novo.
 */
function erroDeProvedor(status, mensagem, corpo) {
  const e = erro(status, mensagem, String(corpo?.error?.message || corpo?.message || '').slice(0, 300));
  e.corpo = corpo;
  return e;
}

/**
 * Traduz a falha do provedor para algo acionável.
 *
 * "Erro 401" não diz a ninguém o que fazer. Quem está configurando precisa
 * saber se a chave está errada, se o modelo não existe ou se apenas estourou
 * a cota — as três levam a ações completamente diferentes.
 */
function traduzirFalha(provedor, status, corpo) {
  const detalhe = String(corpo?.error?.message || corpo?.message || '').slice(0, 300);
  const montar = (st, msg) => erroDeProvedor(st, msg, corpo);

  if (status === 401 || status === 403) {
    return montar(status, `${provedor}: chave recusada. Confira a credencial no .env.`);
  }
  if (status === 404) {
    return montar(status, `${provedor}: modelo não encontrado. Veja em Configurar quais modelos a sua conta tem.`);
  }
  if (status === 429) {
    return montar(status, `${provedor}: limite de uso atingido. Tente de novo em alguns instantes.`);
  }
  // A Groq recusa quando o modelo devolve JSON malformado no modo estrito. A
  // mensagem crua ("Failed to validate JSON. Please adjust your prompt") não
  // diz nada a quem está usando: quem chama sabe se dá para tentar de outro
  // jeito, e é por `jsonInvalido` que ele reconhece o caso.
  if (/failed to validate json/i.test(detalhe)) {
    const e = montar(status || 400,
      `${provedor}: a resposta veio com JSON malformado.`);
    e.jsonInvalido = true;
    return e;
  }
  if (status >= 500) {
    return montar(502, `${provedor}: o serviço respondeu com erro. Tente de novo.`);
  }
  return montar(status || 502, `${provedor}: ${detalhe || 'falha na chamada'}`);
}

/**
 * fetch com prazo. Sem isto uma chamada travada segura o pedido do usuário até
 * o timeout do Node — que é longo o bastante para parecer que o app morreu.
 */
async function pedir(url, opcoes = {}, provedor = 'IA') {
  const controlador = new AbortController();
  const prazo = setTimeout(() => controlador.abort(), LIMITES.timeoutMs());
  let resposta;
  try {
    resposta = await fetch(url, { ...opcoes, signal: controlador.signal });
  } catch (e) {
    if (e.name === 'AbortError') {
      throw erro(504, `${provedor}: a resposta demorou demais (${Math.round(LIMITES.timeoutMs() / 1000)}s).`);
    }
    throw erro(502, `${provedor}: não foi possível conectar. Verifique a internet.`, e.message);
  } finally {
    clearTimeout(prazo);
  }

  const texto = await resposta.text();
  let corpo = null;
  try { corpo = texto ? JSON.parse(texto) : null; } catch (_) { corpo = { message: texto.slice(0, 300) }; }

  if (!resposta.ok) throw traduzirFalha(provedor, resposta.status, corpo);
  return corpo;
}

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

const chaveGemini = () => String(process.env.GEMINI_API_KEY || '').trim();
const chaveGroq = () => String(process.env.GROQ_API_KEY || '').trim();

const modeloGemini = () => escolher('gemini_modelo', 'GEMINI_MODEL', PADROES.geminiModelo);
const modeloGroq = () => escolher('groq_modelo', 'GROQ_MODEL', PADROES.groqModelo);

/** Só o suficiente para conferir que é a chave certa. Nunca a chave. */
function mascarar(chave) {
  if (!chave) return null;
  if (chave.length <= 8) return '••••';
  return `${chave.slice(0, 4)}••••${chave.slice(-4)}`;
}

/**
 * Estado do que está no .env. Não chama provedor nenhum: é a resposta da
 * pergunta "eu preenchi tudo?", que precisa funcionar mesmo sem internet.
 */
/** Nome da variável de ambiente equivalente a cada configuração. */
const VARIAVEL = {
  gemini_modelo: 'GEMINI_MODEL',
  groq_modelo: 'GROQ_MODEL',
  arquivo_mb: 'IA_MAX_ARQUIVO_MB',
  arquivos: 'IA_MAX_ARQUIVOS',
  timeout_ms: 'IA_TIMEOUT_MS',
  texto_max_chars: 'IA_TEXTO_MAX_CHARS',
  max_itens: 'IA_MAX_ITENS',
  max_saida_tokens: 'IA_MAX_SAIDA_TOKENS'
};

/** `tela`, `env` ou `padrao` — de onde veio o valor que está valendo. */
function origemDe(chave, variavel) {
  if (configArmazenada.configurado(chave) !== null) return 'tela';
  if (variavel && String(process.env[variavel] || '').trim()) return 'env';
  return 'padrao';
}

function configuracao() {
  const gemini = chaveGemini();
  const groq = chaveGroq();
  return {
    gemini: {
      papel: 'Leitura de PDF e imagem',
      variavelChave: 'GEMINI_API_KEY',
      variavelModelo: 'GEMINI_MODEL',
      configurado: Boolean(gemini),
      chave_mascarada: mascarar(gemini),
      modelo: modeloGemini(),
      modelo_padrao: PADROES.geminiModelo,
      modelo_do_env: Boolean(String(process.env.GEMINI_MODEL || '').trim()),
      // De onde veio o valor que está valendo. A tela mostra isso porque
      // "por que este modelo?" é a primeira pergunta de quem abre a
      // configuração e vê algo diferente do que esperava.
      modelo_origem: origemDe('gemini_modelo', 'GEMINI_MODEL')
    },
    groq: {
      papel: 'Transformar o texto lido em dados',
      variavelChave: 'GROQ_API_KEY',
      variavelModelo: 'GROQ_MODEL',
      configurado: Boolean(groq),
      chave_mascarada: mascarar(groq),
      modelo: modeloGroq(),
      modelo_padrao: PADROES.groqModelo,
      modelo_do_env: Boolean(String(process.env.GROQ_MODEL || '').trim()),
      modelo_origem: origemDe('groq_modelo', 'GROQ_MODEL')
    },
    limites: {
      arquivo_mb: LIMITES.arquivoMb(),
      arquivos: LIMITES.arquivos(),
      timeout_ms: LIMITES.timeoutMs(),
      timeout_s: Math.round(LIMITES.timeoutMs() / 1000),
      texto_max_chars: LIMITES.textoMaxChars(),
      max_itens: escolher('max_itens', 'IA_MAX_ITENS', 300),
      max_saida_tokens: escolher('max_saida_tokens', 'IA_MAX_SAIDA_TOKENS', 8000)
    },
    // O que a tela precisa para desenhar os campos: faixa aceita e o motivo de
    // cada teto, para o aviso sair explicado em vez de "valor inválido".
    campos: configArmazenada.CAMPOS,
    origens: Object.fromEntries(Object.keys(configArmazenada.CAMPOS).map(c => [c, origemDe(c, VARIAVEL[c])])),
    pronto: Boolean(gemini && groq)
  };
}

// ---------------------------------------------------------------------------
// Listagem de modelos
// ---------------------------------------------------------------------------

/**
 * Modelos do Gemini que servem para ler documento.
 *
 * O catálogo devolve também modelos de embedding e de imagem, que não geram
 * texto. Filtramos por quem declara `generateContent`: oferecer na tela um
 * modelo que vai dar 400 na primeira leitura é pior do que não listar nada.
 */
async function listarModelosGemini() {
  const chave = chaveGemini();
  if (!chave) throw erro(400, 'GEMINI_API_KEY não está preenchida no .env');

  const dados = await pedir(`${GEMINI_BASE}/models?key=${encodeURIComponent(chave)}&pageSize=200`, {}, 'Gemini');
  const modelos = Array.isArray(dados?.models) ? dados.models : [];

  return modelos
    .filter(m => Array.isArray(m.supportedGenerationMethods)
      ? m.supportedGenerationMethods.includes('generateContent')
      : true)
    // `models/gemini-2.5-flash` -> `gemini-2.5-flash`, que é como o id entra
    // no .env e na URL de geração.
    .map(m => ({
      id: String(m.name || '').replace(/^models\//, ''),
      rotulo: m.displayName || null,
      entrada_max: m.inputTokenLimit ?? null
    }))
    .filter(m => m.id)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Modelos da conta Groq. A API é compatível com a da OpenAI. */
async function listarModelosGroq() {
  const chave = chaveGroq();
  if (!chave) throw erro(400, 'GROQ_API_KEY não está preenchida no .env');

  const dados = await pedir(`${GROQ_BASE}/models`, {
    headers: { authorization: `Bearer ${chave}` }
  }, 'Groq');

  const modelos = Array.isArray(dados?.data) ? dados.data : [];
  return modelos
    .map(m => ({
      id: String(m.id || ''),
      rotulo: m.owned_by || null,
      entrada_max: m.context_window ?? null
    }))
    .filter(m => m.id)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Testa os dois provedores e diz, para cada um, se a chave funciona e se o
 * modelo escolhido existe na conta.
 *
 * Um provedor falhar não impede o outro de ser testado: quando as duas chaves
 * estão erradas, o usuário precisa ver os dois problemas de uma vez, não
 * descobrir o segundo depois de consertar o primeiro.
 */
async function testarConexao() {
  const cfg = configuracao();

  const testar = async (nome, listar, modeloEscolhido) => {
    if (!cfg[nome].configurado) {
      return {
        ok: false,
        motivo: `${cfg[nome].variavelChave} não está preenchida no .env`,
        modelos: [],
        modelo_existe: null
      };
    }
    try {
      const modelos = await listar();
      const existe = modelos.some(m => m.id === modeloEscolhido);
      return {
        ok: true,
        motivo: null,
        modelos,
        modelo_existe: existe,
        // Sem aviso, um id inválido só apareceria na primeira leitura de
        // verdade — depois de o usuário já ter enviado os arquivos.
        aviso: existe ? null
          : `O modelo "${modeloEscolhido}" não está na sua conta. Escolha um da lista e ajuste ${cfg[nome].variavelModelo} no .env.`
      };
    } catch (e) {
      return { ok: false, motivo: e.message, modelos: [], modelo_existe: null };
    }
  };

  const [gemini, groq] = await Promise.all([
    testar('gemini', listarModelosGemini, cfg.gemini.modelo),
    testar('groq', listarModelosGroq, cfg.groq.modelo)
  ]);

  return { gemini, groq, pronto: Boolean(gemini.ok && groq.ok) };
}

// ---------------------------------------------------------------------------
// Leitura de documento e imagem (Gemini)
// ---------------------------------------------------------------------------

/**
 * Instrução de leitura.
 *
 * Pede TRANSCRIÇÃO, não interpretação: quem estrutura os dados é o passo
 * seguinte, com o esquema da tabela de destino na mão. Um modelo de visão que
 * já tenta adivinhar campos inventa cabeçalho, funde coluna e "conserta" preço
 * — e o erro entra silencioso, porque não sobra o texto original para conferir.
 */
const PROMPT_LEITURA = [
  'Transcreva TODO o conteúdo textual deste documento, em português, preservando a ordem em que aparece.',
  '',
  'Regras:',
  '- Tabelas: uma linha por linha da tabela, com as células separadas por " | ". Repita o cabeçalho uma vez.',
  '- Mantenha os números exatamente como estão escritos, inclusive a vírgula decimal e o separador de milhar.',
  '- Não converta unidades, não arredonde e não corrija o que parecer errado.',
  '- Não resuma, não comente e não acrescente nada que não esteja no documento.',
  '- Se algum trecho estiver ilegível, escreva [ilegível] no lugar.',
  '- Se o documento não tiver texto algum, responda exatamente: SEM TEXTO'
].join('\n');

const MIMES_GEMINI = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'
]);

/**
 * Manda um PDF ou uma imagem para o Gemini e devolve o texto transcrito.
 *
 * `temperature: 0` porque isto é transcrição: variação aqui não é criatividade,
 * é erro de leitura.
 */
async function lerComGemini({ buffer, mime, modelo }) {
  const chave = chaveGemini();
  if (!chave) throw erro(400, 'GEMINI_API_KEY não está preenchida no .env');
  if (!MIMES_GEMINI.has(mime)) throw erro(400, `Tipo de arquivo não suportado na leitura: ${mime}`);

  const alvo = modelo || modeloGemini();
  const corpo = {
    contents: [{
      role: 'user',
      parts: [
        { inline_data: { mime_type: mime, data: buffer.toString('base64') } },
        { text: PROMPT_LEITURA }
      ]
    }],
    generationConfig: { temperature: 0, maxOutputTokens: 8192 }
  };

  const resposta = await pedir(
    `${GEMINI_BASE}/models/${encodeURIComponent(alvo)}:generateContent?key=${encodeURIComponent(chave)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo)
    },
    'Gemini'
  );

  // Recusa por política vem com HTTP 200 e nenhum candidato. Sem esta
  // checagem, o arquivo terminaria com texto vazio e ninguém saberia por quê.
  const bloqueio = resposta?.promptFeedback?.blockReason;
  if (bloqueio) throw erro(422, `Gemini recusou ler este arquivo (${bloqueio}).`);

  const candidato = resposta?.candidates?.[0];
  if (!candidato) throw erro(502, 'Gemini não devolveu nenhuma leitura para este arquivo.');
  if (candidato.finishReason === 'SAFETY') {
    throw erro(422, 'Gemini interrompeu a leitura deste arquivo por política de conteúdo.');
  }

  const texto = (candidato.content?.parts || [])
    .map(p => p?.text || '')
    .join('')
    .trim();

  // O corte por limite de saída não é erro, mas o usuário PRECISA saber: o
  // final do documento não entrou, e um item pode ter ficado de fora.
  const truncado = candidato.finishReason === 'MAX_TOKENS';
  if (texto === 'SEM TEXTO') return { texto: '', truncado, vazio: true };
  return { texto, truncado, vazio: !texto };
}

module.exports = {
  PADROES,
  LIMITES,
  erroDeProvedor,
  PROMPT_LEITURA,
  MIMES_GEMINI,
  lerComGemini,
  configuracao,
  listarModelosGemini,
  listarModelosGroq,
  testarConexao,
  // Exportados para os testes e para as próximas etapas (leitura e extração).
  erro,
  pedir,
  traduzirFalha,
  mascarar,
  modeloGemini,
  modeloGroq,
  origemDe,
  chaveGemini,
  chaveGroq,
  GEMINI_BASE,
  GROQ_BASE
};
