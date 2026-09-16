/**
 * Configuração da cobrança (boletos BB), guardada no banco — tabela
 * configuracao_cobranca, uma linha só, id = 1 (sql/cobranca_base.sql).
 *
 * O que fica aqui é o que toda máquina precisa ver igual: conta, convênio,
 * ambiente, client_id/app key de cada ambiente, o próximo "nosso número" e
 * os padrões do boleto. O CLIENT SECRET não mora aqui: fica cifrado em
 * segredos_app (chave mestra) ou no cofre local (cobrancaController.js).
 *
 * AMBIENTE — duas travas, e a mais restritiva vence (como na NF-e):
 *   banco ..... o que o Sup Admin escolheu na tela (vale para todo mundo);
 *   .env ...... BB_AMBIENTE=sandbox prende ESTA máquina no ambiente de testes.
 *
 * O ambiente de testes é gravado como 'sandbox' (nome das colunas), mas é a
 * HOMOLOGAÇÃO do BB (api.hm) — o sandbox do portal só serve ao portal — e usa
 * a conta de teste da documentação (`dadosDaConta`), não a real.
 * O .env nunca liga a produção sozinho.
 */
const SANDBOX = 'sandbox';
const PRODUCAO = 'producao';
const AMBIENTES = [SANDBOX, PRODUCAO];

/** Chaves aceitas na gravação, com tipo e limites. */
const CAMPOS = {
  ambiente: { tipo: 'opcao', opcoes: AMBIENTES },
  agencia: { tipo: 'digitos', min: 1, max: 5, obrigatorio: true },
  agencia_dv: { tipo: 'texto', max: 1 },
  conta: { tipo: 'digitos', min: 1, max: 12, obrigatorio: true },
  conta_dv: { tipo: 'texto', max: 1 },
  convenio: { tipo: 'digitos', tamanho: 7 },
  carteira: { tipo: 'inteiro', min: 1, max: 99 },
  variacao: { tipo: 'inteiro', min: 1, max: 999 },
  beneficiario_nome: { tipo: 'texto', max: 60, obrigatorio: true },
  beneficiario_cnpj: { tipo: 'digitos', tamanho: 14 },
  beneficiario_endereco: { tipo: 'texto', max: 80 },
  beneficiario_cep: { tipo: 'digitos', tamanho: 8, opcional: true },
  beneficiario_cidade: { tipo: 'texto', max: 60 },
  beneficiario_uf: { tipo: 'uf', opcional: true },
  client_id_sandbox: { tipo: 'texto', max: 200 },
  app_key_sandbox: { tipo: 'texto', max: 120 },
  client_id_producao: { tipo: 'texto', max: 200 },
  app_key_producao: { tipo: 'texto', max: 120 },
  proximo_sequencial_sandbox: { tipo: 'inteiro', min: 1, max: 9999999999 },
  // Conta de teste da homologação (sql/cobranca_homologacao.sql); vazio = a da documentação do BB.
  homologacao_convenio: { tipo: 'digitos', tamanho: 7, opcional: true },
  homologacao_agencia: { tipo: 'digitos', min: 1, max: 5, opcional: true },
  homologacao_conta: { tipo: 'digitos', min: 1, max: 12, opcional: true },
  homologacao_carteira: { tipo: 'inteiro', min: 1, max: 99, opcional: true },
  homologacao_variacao: { tipo: 'inteiro', min: 1, max: 999, opcional: true },
  proximo_sequencial_producao: { tipo: 'inteiro', min: 1, max: 9999999999 },
  especie: { tipo: 'opcao', opcoes: ['DM', 'DS', 'NP', 'RC', 'OU'] },
  aceite: { tipo: 'booleano' },
  juros_tipo: { tipo: 'opcao', opcoes: ['sem', 'valor_dia', 'percentual_mes'] },
  juros_percentual_mes: { tipo: 'decimal', min: 0, max: 100, casas: 3 },
  multa_percentual: { tipo: 'decimal', min: 0, max: 100 },
  multa_dias: { tipo: 'inteiro', min: 0, max: 30 },
  protesto_dias: { tipo: 'inteiro', min: 0, max: 99, opcional: true },
  negativacao_dias: { tipo: 'inteiro', min: 0, max: 99, opcional: true },
  dias_limite_recebimento: { tipo: 'inteiro', min: 0, max: 999 },
  desconto_percentual: { tipo: 'decimal', min: 0, max: 100 },
  desconto_dias: { tipo: 'inteiro', min: 0, max: 999 },
  indicador_pix: { tipo: 'booleano' },
  gerar_ao_emitir_nfe: { tipo: 'booleano' },
  mensagem_boleto: { tipo: 'texto', max: 400 }
};

/** Curto: quem muda o ambiente na tela precisa ver o efeito no próximo boleto. */
const VALIDADE_MS = 20 * 1000;

let cache = { linha: null, ate: 0 };

function limparCache() {
  cache = { linha: null, ate: 0 };
}

/** A linha id = 1, ou null quando o SQL ainda não rodou. */
async function carregar(api, { forcar = false } = {}) {
  if (!forcar && cache.linha && Date.now() < cache.ate) return cache.linha;
  let linhas = [];
  try {
    const r = await api.get('/api/configuracao_cobranca', { query: { id: 1 } });
    linhas = Array.isArray(r) ? r : (r && typeof r === 'object' ? [r] : []);
  } catch (_) {
    linhas = [];
  }
  const linha = linhas.find(l => Number(l?.id) === 1) || null;
  cache = { linha, ate: Date.now() + VALIDADE_MS };
  return linha;
}

/** Valida as mudanças. Devolve `{ valores, erros }`; vazio em campo opcional vira null. */
function validar(entrada) {
  const valores = {};
  const erros = [];

  for (const [chave, bruto] of Object.entries(entrada || {})) {
    const campo = CAMPOS[chave];
    if (!campo) { erros.push(`"${chave}" não é uma configuração de cobrança`); continue; }

    const texto = bruto === null || bruto === undefined ? '' : String(bruto).trim();
    if (texto === '') {
      const exigido = campo.obrigatorio
        || (campo.tipo === 'digitos' && !campo.opcional && campo.tamanho)
        || (['opcao', 'booleano', 'decimal', 'uf', 'inteiro'].includes(campo.tipo) && !campo.opcional);
      if (exigido) erros.push(`${chave}: não pode ficar vazio`);
      else valores[chave] = null;
      continue;
    }

    switch (campo.tipo) {
      case 'texto':
        if (texto.length > campo.max) { erros.push(`${chave}: passa de ${campo.max} caracteres`); continue; }
        valores[chave] = texto;
        break;
      case 'digitos': {
        const digitos = texto.replace(/\D/g, '');
        if (campo.tamanho && digitos.length !== campo.tamanho) { erros.push(`${chave}: precisa ter ${campo.tamanho} dígitos`); continue; }
        if (campo.min && digitos.length < campo.min) { erros.push(`${chave}: precisa ter ao menos ${campo.min} dígitos`); continue; }
        if (campo.max && digitos.length > campo.max) { erros.push(`${chave}: passa de ${campo.max} dígitos`); continue; }
        valores[chave] = digitos;
        break;
      }
      case 'uf':
        if (!/^[A-Za-z]{2}$/.test(texto)) { erros.push(`${chave}: use a sigla com duas letras`); continue; }
        valores[chave] = texto.toUpperCase();
        break;
      case 'opcao':
        if (!campo.opcoes.includes(texto)) { erros.push(`${chave}: "${texto}" não é uma opção (${campo.opcoes.join(', ')})`); continue; }
        valores[chave] = texto;
        break;
      case 'inteiro': {
        const n = Number(texto);
        if (!Number.isInteger(n) || n < campo.min || n > campo.max) { erros.push(`${chave}: precisa ser um inteiro entre ${campo.min} e ${campo.max}`); continue; }
        valores[chave] = n;
        break;
      }
      case 'decimal': {
        const n = Number(texto.replace(',', '.'));
        if (!Number.isFinite(n) || n < campo.min || n > campo.max) { erros.push(`${chave}: precisa ser um número entre ${campo.min} e ${campo.max}`); continue; }
        const fator = 10 ** (campo.casas || 2);
        valores[chave] = Math.round(n * fator) / fator;
        break;
      }
      case 'booleano':
        if (!['true', 'false', '1', '0', 'sim', 'nao', 'não'].includes(texto.toLowerCase())) { erros.push(`${chave}: use sim ou não`); continue; }
        valores[chave] = ['true', '1', 'sim'].includes(texto.toLowerCase());
        break;
      default:
        erros.push(`${chave}: tipo desconhecido`);
    }
  }

  return { valores, erros };
}

/** Grava na linha 1. Sem a linha (SQL não rodou), avisa em vez de criar às cegas. */
async function gravar(api, valores, usuarioId) {
  const atual = await carregar(api, { forcar: true });
  if (!atual) {
    const e = new Error('A tabela configuracao_cobranca ainda não tem a linha da cobrança. Rode sql/cobranca_base.sql.');
    e.status = 409;
    throw e;
  }
  await api.put('/api/configuracao_cobranca/1', { ...valores, atualizado_em: new Date().toISOString(), atualizado_por: usuarioId ?? null });
  limparCache();
  return carregar(api, { forcar: true });
}

/**
 * O ambiente que VALE nesta máquina: o do banco, rebaixado ao de testes
 * quando o .env desta máquina prende em testes (BB_AMBIENTE=sandbox ou
 * homologacao). Sem configuração é o de testes.
 */
function ambienteEfetivo(cfg, env = process.env) {
  const doBanco = String(cfg?.ambiente || SANDBOX).trim().toLowerCase();
  const daMaquina = String(env.BB_AMBIENTE || '').trim().toLowerCase();
  if (daMaquina === SANDBOX || daMaquina === 'homologacao') return SANDBOX;
  return doBanco === PRODUCAO ? PRODUCAO : SANDBOX;
}

/** Como o ambiente aparece nas mensagens. */
function nomeDoAmbiente(ambiente) {
  return ambiente === PRODUCAO ? 'produção' : 'homologação';
}

/**
 * Conta e convênio de TESTE da homologação do BB (documentação da API
 * Cobranças; o convênio e a carteira conferem com a listagem do portal).
 * Na homologação o BB só aceita estes — a conta real dá 403.
 */
const CONTA_TESTE = { convenio: '3128557', agencia: '452', conta: '123873', carteira: 17, variacao: 35 };
/**
 * Pagador de teste da homologação (o do exemplo do portal: 86.761.393/0001-71).
 * Um CNPJ real, mesmo válido, é recusado lá ("4500947 — O CNPJ informado
 * para o pagador está inválido", 16/09/2026). BB_PAGADOR_TESTE no .env troca.
 */
const PAGADOR_TESTE_CNPJ = '86761393000171';

/** Conta, convênio, carteira e variação que valem no ambiente: os reais em produção, os de teste na homologação. */
function dadosDaConta(cfg, ambiente) {
  if (ambiente === PRODUCAO) {
    return { convenio: String(cfg?.convenio || ''), agencia: String(cfg?.agencia || ''), conta: String(cfg?.conta || ''), carteira: Number(cfg?.carteira) || null, variacao: Number(cfg?.variacao) || null, teste: false };
  }
  const v = (chave, padrao) => (cfg?.[`homologacao_${chave}`] === null || cfg?.[`homologacao_${chave}`] === undefined || cfg?.[`homologacao_${chave}`] === '' ? padrao : cfg[`homologacao_${chave}`]);
  return {
    convenio: String(v('convenio', CONTA_TESTE.convenio)), agencia: String(v('agencia', CONTA_TESTE.agencia)), conta: String(v('conta', CONTA_TESTE.conta)),
    carteira: Number(v('carteira', CONTA_TESTE.carteira)), variacao: Number(v('variacao', CONTA_TESTE.variacao)), teste: true
  };
}

/** client_id e app key do ambiente pedido (o secret vem de outro lugar). */
function credenciais(cfg, ambiente) {
  const sufixo = ambiente === PRODUCAO ? 'producao' : 'sandbox';
  return {
    ambiente: ambiente === PRODUCAO ? PRODUCAO : SANDBOX,
    clientId: String(cfg?.[`client_id_${sufixo}`] || '').trim() || null,
    appKey: String(cfg?.[`app_key_${sufixo}`] || '').trim() || null
  };
}

/** O próximo sequencial do nosso número no ambiente. */
function proximoSequencial(cfg, ambiente) {
  const n = Number(ambiente === PRODUCAO ? cfg?.proximo_sequencial_producao : cfg?.proximo_sequencial_sandbox);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/** O que falta para registrar boletos no ambiente (a tela lista, o registro bloqueia). */
function pendencias(cfg, ambiente = SANDBOX, { secret = false } = {}) {
  if (!cfg) return ['Configuração de cobrança ainda não cadastrada (rode sql/cobranca_base.sql).'];
  const faltas = [];
  const vazio = v => v === null || v === undefined || String(v).trim() === '';
  const conta = dadosDaConta(cfg, ambiente);
  const sufixo = conta.teste ? ' de teste (homologação)' : '';
  for (const [chave, rotulo] of [['agencia', 'agência'], ['conta', 'conta'], ['convenio', 'convênio'], ['carteira', 'carteira'], ['variacao', 'variação']]) {
    if (vazio(conta[chave])) faltas.push(`Cobrança sem ${rotulo}${sufixo}`);
  }
  for (const [chave, rotulo] of [['beneficiario_nome', 'nome do beneficiário'], ['beneficiario_cnpj', 'CNPJ do beneficiário']]) {
    if (vazio(cfg[chave])) faltas.push(`Cobrança sem ${rotulo}`);
  }
  if (String(conta.convenio || '').replace(/\D/g, '').length !== 7) faltas.push(`Convênio${sufixo} precisa ter 7 dígitos (nosso número de 17 posições)`);
  const c = credenciais(cfg, ambiente);
  const nome = nomeDoAmbiente(c.ambiente);
  if (!c.clientId) faltas.push(`Sem client_id de ${nome} (Portal Developers BB)`);
  if (!c.appKey) faltas.push(`Sem app key de ${nome} (Portal Developers BB)`);
  if (!secret) faltas.push(`Sem client_secret de ${nome} guardado (banco ou este computador)`);
  return faltas;
}

module.exports = {
  CAMPOS, VALIDADE_MS, SANDBOX, PRODUCAO, AMBIENTES, CONTA_TESTE, PAGADOR_TESTE_CNPJ,
  carregar, validar, gravar, limparCache, ambienteEfetivo, nomeDoAmbiente, dadosDaConta, credenciais, proximoSequencial, pendencias
};
