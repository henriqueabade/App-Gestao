// A configuração do módulo de IA, guardada no banco.
//
// ---------------------------------------------------------------------------
// O QUE MORA AQUI E O QUE MORA NO .env
//
//   .env ....... GEMINI_API_KEY, GROQ_API_KEY. Segredo. Nunca sai do backend,
//                nunca é gravado no banco, nunca chega ao renderer.
//   banco ...... modelo de cada provedor e limites de envio.
//
// A separação não é estética. Uma chave gravada no banco seria lida por
// qualquer consulta, apareceria em backup e em log de replicação, e passaria a
// ser responsabilidade de quem administra o banco. Um nome de modelo, não.
//
// ---------------------------------------------------------------------------
// TRÊS CAMADAS, NESTA ORDEM
//
//   1. banco ....... o que alguém configurou na tela;
//   2. .env ........ o que a instalação define;
//   3. padrão ...... o que o programa faz quando ninguém disse nada.
//
// A ordem é o que permite subir a tabela sem mudar o comportamento de nenhuma
// instalação: sem linha no banco, tudo continua exatamente como estava.
//
// ---------------------------------------------------------------------------
// POR QUE UM CACHE, E POR QUE ELE É CURTO
//
// `modeloGroq()` é chamado no meio da extração, de dentro de código síncrono,
// e a cada fatia de um documento longo. Consultar o banco ali significaria uma
// requisição por fatia para ler um texto de trinta caracteres que ninguém mudou.
//
// Então a leitura é síncrona, sobre um cache que as rotas atualizam antes de
// começar o trabalho. O prazo é curto de propósito: alguém que troca o modelo
// na tela espera ver o efeito na próxima leitura, não daqui a uma hora.

/** Chaves aceitas, com o tipo e os limites de cada uma. */
const CAMPOS = {
  gemini_modelo: { tipo: 'texto', max: 120 },
  groq_modelo: { tipo: 'texto', max: 120 },

  // QUEM faz cada etapa.
  //
  // Ler e extrair são trabalhos diferentes, e nem sempre o melhor num é o
  // melhor no outro: um modelo que transcreve bem uma foto pode perder itens ao
  // montar a lista, e vice-versa. Deixar os dois presos a um provedor cada
  // obrigava a trocar de modelo quando o problema era de etapa.
  //
  // O mesmo provedor pode fazer as duas — não há nada que exija que sejam
  // diferentes.
  provedor_leitura: { tipo: 'opcao', opcoes: ['gemini', 'groq'] },
  provedor_extracao: { tipo: 'opcao', opcoes: ['gemini', 'groq'] },

  // Os limites de envio. Os tetos existem porque cada um deles tem uma forma
  // própria de dar errado quando esticado demais.
  arquivo_mb: {
    tipo: 'inteiro', min: 1, max: 50,
    porque: 'Acima disso o provedor recusa o envio, e a leitura falha depois de esperar o upload inteiro.'
  },
  arquivos: {
    tipo: 'inteiro', min: 1, max: 30,
    porque: 'Cada arquivo é uma chamada paga; muitos de uma vez esbarram no limite de uso do provedor.'
  },
  timeout_ms: {
    tipo: 'inteiro', min: 15000, max: 600000,
    porque: 'Curto demais derruba PDF grande no meio; longo demais deixa a tela travada sem explicação.'
  },
  texto_max_chars: {
    tipo: 'inteiro', min: 5000, max: 500000,
    porque: 'É quanto do documento chega ao modelo. Acima do que ele aguarda, o fim do texto é ignorado.'
  },
  max_itens: {
    tipo: 'inteiro', min: 10, max: 2000,
    porque: 'Rede contra alucinação em laço: um modelo confuso pode devolver a mesma linha mil vezes.'
  },
  max_saida_tokens: {
    tipo: 'inteiro', min: 1000, max: 32000,
    porque: 'Teto da resposta. Baixo demais corta a lista; alto demais o modelo pode não aceitar.'
  }
};

/** Quanto tempo o cache vale. Curto: trocar o modelo tem de surtir efeito já. */
const VALIDADE_MS = 20 * 1000;

let cache = { valores: null, ate: 0 };

/** Esquece o que foi lido. Usado depois de gravar e pelos testes. */
function limparCache() {
  cache = { valores: null, ate: 0 };
}

/**
 * Traz a configuração do banco para o cache.
 *
 * Falha de leitura NÃO derruba a chamada: sem a tabela — numa instalação que
 * ainda não rodou o SQL — o módulo tem de continuar funcionando pelo .env,
 * exatamente como funcionava antes.
 */
async function carregar(api) {
  if (cache.valores && Date.now() < cache.ate) return cache.valores;

  let linhas = [];
  try {
    const r = await api.get('/api/ia_configuracao');
    linhas = Array.isArray(r) ? r : [];
  } catch (_) {
    linhas = [];
  }

  const valores = {};
  for (const l of linhas) {
    const chave = String(l?.chave || '').trim();
    if (CAMPOS[chave] && l.valor !== null && l.valor !== undefined && l.valor !== '') {
      valores[chave] = String(l.valor);
    }
  }

  cache = { valores, ate: Date.now() + VALIDADE_MS };
  return valores;
}

/**
 * O valor configurado na tela, ou `null`.
 *
 * Síncrono de propósito: quem chama está no meio da extração e não pode virar
 * assíncrono só por causa disto. Antes de a extração começar, a rota já
 * chamou `carregar`.
 */
function configurado(chave) {
  const bruto = cache.valores ? cache.valores[chave] : null;
  if (bruto === null || bruto === undefined || bruto === '') return null;

  const campo = CAMPOS[chave];
  if (!campo) return null;
  if (campo.tipo !== 'inteiro') return bruto;

  const n = Number(bruto);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Valida um conjunto de mudanças. Devolve `{ valores, erros }`. */
function validar(entrada) {
  const valores = {};
  const erros = [];

  for (const [chave, bruto] of Object.entries(entrada || {})) {
    const campo = CAMPOS[chave];
    if (!campo) { erros.push(`"${chave}" não é uma configuração deste módulo`); continue; }

    // Vazio quer dizer "volte ao padrão": apaga a linha do banco e o .env
    // torna a valer. É a única forma de desfazer uma escolha sem adivinhar
    // qual era o valor de antes.
    if (bruto === null || bruto === undefined || String(bruto).trim() === '') {
      valores[chave] = null;
      continue;
    }

    if (campo.tipo === 'opcao') {
      const valor = String(bruto).trim().toLowerCase();
      if (!campo.opcoes.includes(valor)) {
        erros.push(`${chave}: "${bruto}" não é uma opção (${campo.opcoes.join(', ')})`);
        continue;
      }
      valores[chave] = valor;
      continue;
    }

    if (campo.tipo === 'texto') {
      const texto = String(bruto).trim();
      if (texto.length > campo.max) {
        erros.push(`${chave}: passa de ${campo.max} caracteres`);
        continue;
      }
      valores[chave] = texto;
      continue;
    }

    const n = Number(String(bruto).replace(',', '.'));
    if (!Number.isFinite(n)) { erros.push(`${chave}: "${bruto}" não é um número`); continue; }

    const inteiro = Math.trunc(n);
    if (inteiro < campo.min || inteiro > campo.max) {
      erros.push(`${chave}: precisa ficar entre ${campo.min} e ${campo.max}. ${campo.porque}`);
      continue;
    }
    valores[chave] = String(inteiro);
  }

  return { valores, erros };
}

/**
 * Grava as mudanças.
 *
 * Uma linha por chave, criada ou atualizada — a API remota não tem upsert, e
 * `?chave=x` é filtro por igualdade, que é justamente o que existe.
 */
async function gravar(api, valores, usuarioId) {
  const atuais = await api.get('/api/ia_configuracao')
    .then(r => (Array.isArray(r) ? r : [])).catch(() => []);
  const porChave = new Map(atuais.map(l => [String(l.chave), l]));

  for (const [chave, valor] of Object.entries(valores)) {
    const existente = porChave.get(chave);

    if (valor === null) {
      // Voltar ao padrão é APAGAR a linha, não gravar vazio: uma linha com
      // valor em branco continuaria vencendo o .env, e o "volte ao padrão"
      // não voltaria a padrão nenhum.
      if (existente) await api.delete(`/api/ia_configuracao/${existente.id}`);
      continue;
    }

    const payload = {
      chave,
      valor,
      atualizado_em: new Date().toISOString(),
      atualizado_por: usuarioId ?? null
    };

    if (existente) await api.put(`/api/ia_configuracao/${existente.id}`, payload);
    else await api.post('/api/ia_configuracao', payload);
  }

  limparCache();
}

module.exports = { CAMPOS, VALIDADE_MS, carregar, configurado, validar, gravar, limparCache };
