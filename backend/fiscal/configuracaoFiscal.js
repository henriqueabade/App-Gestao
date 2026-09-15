/**
 * Configuração fiscal do emitente, guardada no banco (tabela configuracao_fiscal,
 * uma linha só, id = 1 — ver sql/notas_fiscais_base.sql).
 *
 * O que fica aqui é o que todo computador que emite precisa ver igual: os
 * dados do emitente, o ambiente, a série e o próximo número de cada ambiente
 * (a SEFAZ numera homologação e produção em separado) e os padrões da
 * operação. O certificado e a senha NÃO ficam aqui: moram no computador que
 * emite (segredoLocal.js).
 *
 * AMBIENTE — duas travas, e a mais restritiva vence:
 *   banco ..... o que o Sup Admin escolheu na tela (vale para todo mundo);
 *   .env ...... NFE_AMBIENTE=homologacao prende ESTA máquina em homologação.
 * O .env nunca liga a produção sozinho: ligar produção é decisão registrada
 * no banco, por quem tem a permissão, e não uma variável esquecida num
 * computador de desenvolvimento.
 */
const HOMOLOGACAO = 'homologacao';
const PRODUCAO = 'producao';

/** Chaves aceitas na gravação, com tipo e limites. */
const CAMPOS = {
  cnpj: { tipo: 'digitos', tamanho: 14 },
  razao_social: { tipo: 'texto', max: 60, obrigatorio: true },
  nome_fantasia: { tipo: 'texto', max: 60 },
  inscricao_estadual: { tipo: 'digitos', min: 2, max: 14, obrigatorio: true },
  inscricao_municipal: { tipo: 'texto', max: 15 },
  cnae: { tipo: 'digitos', tamanho: 7, opcional: true },
  crt: { tipo: 'opcao', opcoes: ['1', '2', '3', '4'] },
  logradouro: { tipo: 'texto', max: 60, obrigatorio: true },
  numero: { tipo: 'texto', max: 60, obrigatorio: true },
  complemento: { tipo: 'texto', max: 60 },
  bairro: { tipo: 'texto', max: 60, obrigatorio: true },
  codigo_municipio: { tipo: 'digitos', tamanho: 7 },
  municipio: { tipo: 'texto', max: 60, obrigatorio: true },
  uf: { tipo: 'uf' },
  cep: { tipo: 'digitos', tamanho: 8 },
  telefone: { tipo: 'digitos', min: 6, max: 14, opcional: true },
  email: { tipo: 'texto', max: 60 },
  ambiente: { tipo: 'opcao', opcoes: [HOMOLOGACAO, PRODUCAO] },
  serie_homologacao: { tipo: 'inteiro', min: 1, max: 999 },
  proximo_numero_homologacao: { tipo: 'inteiro', min: 1, max: 999999999 },
  serie_producao: { tipo: 'inteiro', min: 1, max: 999 },
  proximo_numero_producao: { tipo: 'inteiro', min: 1, max: 999999999 },
  natureza_operacao: { tipo: 'texto', max: 60, obrigatorio: true },
  cfop_dentro_uf: { tipo: 'digitos', tamanho: 4 },
  cfop_fora_uf: { tipo: 'digitos', tamanho: 4 },
  csosn: { tipo: 'digitos', tamanho: 3 },
  pcred_sn: { tipo: 'decimal', min: 0, max: 100 },
  pis_cst: { tipo: 'digitos', tamanho: 2 },
  cofins_cst: { tipo: 'digitos', tamanho: 2 },
  unidade_padrao: { tipo: 'texto', max: 6, obrigatorio: true },
  modalidade_frete_padrao: { tipo: 'opcao', opcoes: ['0', '1', '2', '3', '4', '9'] },
  informacoes_complementares: { tipo: 'texto', max: 5000 },
  resp_tec_cnpj: { tipo: 'digitos', tamanho: 14, opcional: true },
  resp_tec_contato: { tipo: 'texto', max: 60 },
  resp_tec_email: { tipo: 'texto', max: 60 },
  resp_tec_fone: { tipo: 'digitos', min: 6, max: 14, opcional: true }
};

/** Curto: quem muda o ambiente na tela precisa ver o efeito na próxima emissão. */
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
    const r = await api.get('/api/configuracao_fiscal', { query: { id: 1 } });
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
    if (!campo) { erros.push(`"${chave}" não é uma configuração fiscal`); continue; }

    const texto = bruto === null || bruto === undefined ? '' : String(bruto).trim();
    if (texto === '') {
      if (campo.obrigatorio || (campo.tipo === 'digitos' && !campo.opcional && campo.tamanho) || ['opcao', 'inteiro', 'uf', 'decimal'].includes(campo.tipo)) {
        erros.push(`${chave}: não pode ficar vazio`);
      } else {
        valores[chave] = null;
      }
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
        if (!/^[A-Za-z]{2}$/.test(texto)) { erros.push('uf: use a sigla com duas letras'); continue; }
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
        valores[chave] = Math.round(n * 100) / 100;
        break;
      }
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
    const e = new Error('A tabela configuracao_fiscal ainda não tem a linha do emitente. Rode sql/notas_fiscais_base.sql.');
    e.status = 409;
    throw e;
  }
  const payload = {
    ...valores,
    atualizado_em: new Date().toISOString(),
    atualizado_por: usuarioId ?? null
  };
  await api.put('/api/configuracao_fiscal/1', payload);
  limparCache();
  return carregar(api, { forcar: true });
}

/**
 * O ambiente que VALE nesta máquina: o do banco, rebaixado a homologação
 * quando o .env desta máquina prende em homologação. Sem configuração no
 * banco é homologação — o padrão seguro.
 */
function ambienteEfetivo(cfg, env = process.env) {
  const doBanco = String(cfg?.ambiente || HOMOLOGACAO).trim().toLowerCase();
  const daMaquina = String(env.NFE_AMBIENTE || '').trim().toLowerCase();
  if (daMaquina === HOMOLOGACAO) return HOMOLOGACAO;
  return doBanco === PRODUCAO ? PRODUCAO : HOMOLOGACAO;
}

/** Série e próximo número do ambiente pedido. */
function numeracao(cfg, ambiente) {
  const emProducao = ambiente === PRODUCAO;
  return {
    serie: Number(emProducao ? cfg?.serie_producao : cfg?.serie_homologacao) || 1,
    proximoNumero: Number(emProducao ? cfg?.proximo_numero_producao : cfg?.proximo_numero_homologacao) || 1
  };
}

/** O que falta para o emitente estar completo (a tela lista, a emissão bloqueia). */
function pendencias(cfg) {
  if (!cfg) return ['Configuração fiscal ainda não cadastrada (rode sql/notas_fiscais_base.sql).'];
  const faltando = [];
  for (const [chave, campo] of Object.entries(CAMPOS)) {
    const exigido = campo.obrigatorio || (campo.tipo === 'digitos' && campo.tamanho && !campo.opcional) || campo.tipo === 'uf';
    if (!exigido) continue;
    const valor = cfg[chave];
    if (valor === null || valor === undefined || String(valor).trim() === '') faltando.push(chave);
  }
  return faltando.map(c => `Emitente sem ${c.replace(/_/g, ' ')}`);
}

module.exports = {
  CAMPOS, VALIDADE_MS, HOMOLOGACAO, PRODUCAO,
  carregar, validar, gravar, limparCache, ambienteEfetivo, numeracao, pendencias
};
