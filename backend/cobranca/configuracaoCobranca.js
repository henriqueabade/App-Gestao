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
 *   .env ...... BB_AMBIENTE=sandbox prende ESTA máquina em sandbox.
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
 * O ambiente que VALE nesta máquina: o do banco, rebaixado a sandbox quando
 * o .env desta máquina prende em sandbox. Sem configuração é sandbox.
 */
function ambienteEfetivo(cfg, env = process.env) {
  const doBanco = String(cfg?.ambiente || SANDBOX).trim().toLowerCase();
  const daMaquina = String(env.BB_AMBIENTE || '').trim().toLowerCase();
  if (daMaquina === SANDBOX) return SANDBOX;
  return doBanco === PRODUCAO ? PRODUCAO : SANDBOX;
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
  for (const [chave, rotulo] of [['agencia', 'agência'], ['conta', 'conta'], ['convenio', 'convênio'], ['carteira', 'carteira'], ['variacao', 'variação'],
    ['beneficiario_nome', 'nome do beneficiário'], ['beneficiario_cnpj', 'CNPJ do beneficiário']]) {
    if (vazio(cfg[chave])) faltas.push(`Cobrança sem ${rotulo}`);
  }
  if (String(cfg.convenio || '').replace(/\D/g, '').length !== 7) faltas.push('Convênio precisa ter 7 dígitos (nosso número de 17 posições)');
  const c = credenciais(cfg, ambiente);
  const nome = c.ambiente === PRODUCAO ? 'produção' : 'sandbox';
  if (!c.clientId) faltas.push(`Sem client_id de ${nome} (Portal Developers BB)`);
  if (!c.appKey) faltas.push(`Sem app key de ${nome} (Portal Developers BB)`);
  if (!secret) faltas.push(`Sem client_secret de ${nome} guardado (banco ou este computador)`);
  return faltas;
}

module.exports = {
  CAMPOS, VALIDADE_MS, SANDBOX, PRODUCAO, AMBIENTES,
  carregar, validar, gravar, limparCache, ambienteEfetivo, credenciais, proximoSequencial, pendencias
};
