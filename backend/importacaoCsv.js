/**
 * Planilhas CSV de Clientes e Prospecções: modelo, exportação e importação.
 *
 * Tudo o que decide a planilha mora aqui, num lugar só — as colunas (e a
 * ordem), a leitura do arquivo, a escrita e a conferência de cada linha —,
 * para que o modelo, a exportação e a importação nunca discordem entre si.
 * Um CSV exportado volta pela importação sem ajuste.
 *
 * A importação NUNCA para por causa de uma linha. Cada linha termina em:
 *   - `registrado`                   entrou inteira;
 *   - `registrado_com_pendencias`    entrou, mas faltou dado (a lista diz qual);
 *   - `nao_registrado`               faltou o que identifica o registro
 *                                    (nome, documento) ou ele já existe;
 *   - `ignorado`                     linha de exemplo do modelo.
 * Pendência é o que o formulário pediria e a planilha não trouxe: o registro
 * entra assim mesmo, e o relatório final aponta o que completar.
 *
 * Formato: ponto e vírgula (o que o Excel em português abre direto), UTF-8
 * com BOM, datas dd/mm/aaaa, números com vírgula, Sim/Não. Na leitura aceita
 * também vírgula como separador, datas aaaa-mm-dd e números com ponto.
 *
 * Funções puras: quem grava é o controller de cada módulo.
 */

const listas = require('./prospeccaoListas');

const SEPARADOR = ';';
const BOM = String.fromCharCode(0xfeff);
const MARCA_EXEMPLO = 'EXEMPLO (apague esta linha)';

// ------------------------------------------------------------ texto

const texto = v => (v === undefined || v === null ? '' : String(v).trim());
const semAcento = v => texto(v).normalize('NFD').replace(/[\u0300-\u036F]/g, '');
/** A chave de comparação de um cabeçalho: sem acento, sem "(...)", sem "*", só letras e números. */
const chaveDoCabecalho = v => semAcento(v).toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^a-z0-9]/g, '');
const digitos = v => texto(v).replace(/\D/g, '');
const comparavel = v => semAcento(v).toLowerCase().replace(/\s+/g, ' ');

// ------------------------------------------------------------ CSV

/** Separador do arquivo: o que mais aparece fora de aspas na primeira linha. */
function detectarSeparador(conteudo) {
  const primeira = [];
  let aspas = false;
  for (const ch of String(conteudo)) {
    if (ch === '"') aspas = !aspas;
    else if ((ch === '\n' || ch === '\r') && !aspas) break;
    primeira.push(ch);
  }
  const linha = primeira.join('');
  const conta = c => linha.split(c).length - 1;
  const opcoes = [[';', conta(';')], [',', conta(',')], ['\t', conta('\t')]];
  opcoes.sort((a, b) => b[1] - a[1]);
  return opcoes[0][1] > 0 ? opcoes[0][0] : SEPARADOR;
}

/**
 * CSV (RFC 4180) → [{ numero, valores }]. `numero` é a linha no arquivo
 * (a do cabeçalho é a 1), para o relatório falar a mesma língua do Excel.
 * Aspas escapadas ("") e quebra de linha dentro de aspas são respeitadas.
 */
function lerCsv(conteudo) {
  const bruto = String(conteudo ?? '').replace(/^\uFEFF/, '');
  const separador = detectarSeparador(bruto);
  const linhas = [];
  let campo = '';
  let valores = [];
  let aspas = false;
  let numero = 1;
  let inicio = 1;
  const fecharLinha = () => {
    valores.push(campo);
    if (valores.some(v => v.trim() !== '')) linhas.push({ numero: inicio, valores });
    valores = [];
    campo = '';
  };
  for (let i = 0; i < bruto.length; i++) {
    const ch = bruto[i];
    if (aspas) {
      if (ch === '"') {
        if (bruto[i + 1] === '"') { campo += '"'; i++; } else aspas = false;
      } else if (ch === '\r' && bruto[i + 1] === '\n') {
        // Quebra dentro da célula (Alt+Enter) gravada como CRLF: fica só o \n.
        continue;
      } else {
        if (ch === '\n') numero++;
        campo += ch;
      }
      continue;
    }
    if (ch === '"') { aspas = true; continue; }
    if (ch === separador) { valores.push(campo); campo = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') {
      fecharLinha();
      numero++;
      inicio = numero;
      continue;
    }
    campo += ch;
  }
  if (campo !== '' || valores.length) fecharLinha();
  return { separador, linhas };
}

/** Um valor pronto para o CSV (aspas quando precisa). */
function celula(v) {
  const s = v === undefined || v === null ? '' : String(v);
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Cabeçalho do modelo/exportação: o título, com " *" nas obrigatórias. */
const tituloDaColuna = c => (c.obrigatoria ? `${c.titulo} *` : c.titulo);

/** Registros (objetos por `chave`) → texto CSV com BOM e fim de linha do Windows. */
function gerarCsv(colunas, registros = []) {
  const linhas = [colunas.map(c => celula(tituloDaColuna(c))).join(SEPARADOR)];
  for (const r of registros) linhas.push(colunas.map(c => celula(r?.[c.chave])).join(SEPARADOR));
  return BOM + linhas.join('\r\n') + '\r\n';
}

/**
 * Casa o cabeçalho do arquivo com as colunas conhecidas. Aceita o título
 * (com ou sem "*", acento e o que estiver entre parênteses) ou a própria chave.
 * Devolve o índice de cada chave e o que ficou sobrando/faltando.
 */
function mapearCabecalho(cabecalho = [], colunas) {
  const porChave = new Map();
  for (const c of colunas) {
    porChave.set(chaveDoCabecalho(c.titulo), c.chave);
    porChave.set(chaveDoCabecalho(c.chave), c.chave);
    for (const alt of c.alternativas || []) porChave.set(chaveDoCabecalho(alt), c.chave);
  }
  const indice = {};
  const desconhecidas = [];
  cabecalho.forEach((titulo, i) => {
    const chave = porChave.get(chaveDoCabecalho(titulo));
    if (chave && indice[chave] === undefined) indice[chave] = i;
    else if (texto(titulo)) desconhecidas.push(texto(titulo));
  });
  const ausentes = colunas.filter(c => indice[c.chave] === undefined).map(c => c.titulo);
  return { indice, desconhecidas, ausentes };
}

/** Linha do arquivo → objeto { chave: valor } (só as colunas conhecidas). */
function registroDaLinha(valores, indice) {
  const r = {};
  for (const [chave, i] of Object.entries(indice)) r[chave] = texto(valores[i]);
  return r;
}

// ------------------------------------------------------------ valores

/** "Sim"/"S"/"X"/"1"/"true" → true; "Não"/"N"/"0"/"false"/vazio → false; outro → null. */
function lerSimNao(v) {
  const s = comparavel(v);
  if (!s) return false;
  if (['sim', 's', 'x', '1', 'true', 'verdadeiro', 'yes', 'y'].includes(s)) return true;
  if (['nao', 'n', '0', 'false', 'falso', 'no'].includes(s)) return false;
  return null;
}

/** "1.234,56", "1234,56", "1234.56", "R$ 1.234" → número; vazio → null; inválido → NaN. */
function lerNumero(v) {
  let s = texto(v).replace(/R\$|%/gi, '').replace(/\s/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** "31/12/2026" ou "2026-12-31" → "2026-12-31"; vazio → null; inválido → undefined. */
function lerData(v) {
  const s = texto(v);
  if (!s) return null;
  let a; let m; let d;
  const br = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (br) [, d, m, a] = br;
  else if (iso) [, a, m, d] = iso;
  else return undefined;
  const data = new Date(Date.UTC(Number(a), Number(m) - 1, Number(d)));
  if (data.getUTCFullYear() !== Number(a) || data.getUTCMonth() !== Number(m) - 1 || data.getUTCDate() !== Number(d)) return undefined;
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Data e hora de Brasília ("31/12/2026 14:30", "31/12/2026", "2026-12-31 14:30")
 * → `{ iso, semHora }` (o instante, com o fuso -03:00); vazio → null;
 * inválido → undefined. Sem hora vale 00:00 daquele dia.
 */
function lerDataHora(v) {
  const s = texto(v);
  if (!s) return null;
  const m = /^(\S+)(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (!m) return undefined;
  const dia = lerData(m[1]);
  if (!dia) return undefined;
  const semHora = m[2] === undefined;
  const h = Number(m[2] ?? 0);
  const min = Number(m[3] ?? 0);
  if (h > 23 || min > 59) return undefined;
  const iso = `${dia}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00-03:00`;
  return { iso, semHora };
}

/** "2026-12-31" → "31/12/2026" (para a exportação). */
function dataBr(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto(v));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

const numeroBr = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))
  ? '' : String(Number(v)).replace('.', ','));

const emailValido = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(texto(v));

/** CNPJ com os dígitos verificadores certos. */
function cnpjValido(v) {
  const d = digitos(v);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = base => {
    let soma = 0;
    let peso = base.length - 7;
    for (const n of base) {
      soma += Number(n) * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(d.slice(0, 12));
  const d2 = dv(d.slice(0, 12) + d1);
  return d.endsWith(`${d1}${d2}`);
}

/** CPF com os dígitos verificadores certos. */
function cpfValido(v) {
  const d = digitos(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = n => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

const formatarCnpj = v => digitos(v).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const formatarCpf = v => digitos(v).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');

/** A linha é a de exemplo do modelo? */
const ehLinhaDeExemplo = r => Object.values(r || {}).some(v => comparavel(v).startsWith(comparavel(MARCA_EXEMPLO).slice(0, 7)) && comparavel(v).includes('apague'));

// ------------------------------------------------------------ colunas

const ENDERECO = [
  ['cep', 'CEP'], ['rua', 'Rua'], ['numero', 'Número'], ['complemento', 'Complemento'], ['bairro', 'Bairro'],
  ['cidade', 'Cidade'], ['estado', 'UF'], ['pais', 'País']
];

/** As 8 colunas de um endereço ("Registro - CEP", ...), mais o código IBGE quando pedido. */
function colunasDeEndereco(prefixo, rotulo, { ibge = false } = {}) {
  const lista = ENDERECO.map(([campo, nome]) => ({ chave: `${prefixo}_${campo}`, titulo: `${rotulo} - ${nome}` }));
  if (ibge) lista.push({ chave: `${prefixo}_codigo_municipio`, titulo: `${rotulo} - Código IBGE` });
  return lista;
}

const COLUNAS_CLIENTE = [
  { chave: 'tipo_pessoa', titulo: 'Tipo de pessoa (PJ ou PF)' },
  { chave: 'razao_social', titulo: 'Razão social', obrigatoria: true },
  { chave: 'nome_fantasia', titulo: 'Nome fantasia', obrigatoria: true },
  { chave: 'cnpj', titulo: 'CNPJ', alternativas: ['CNPJ (pessoa jurídica)'] },
  { chave: 'cpf', titulo: 'CPF', alternativas: ['CPF (pessoa física)'] },
  { chave: 'inscricao_estadual', titulo: 'Inscrição estadual' },
  { chave: 'indicador_ie', titulo: 'Indicador IE (1, 2 ou 9)' },
  { chave: 'email_nfe', titulo: 'E-mail para NF-e' },
  { chave: 'consumidor_final', titulo: 'Consumidor final (Sim ou Não)' },
  { chave: 'site', titulo: 'Site' },
  // Como em Prospecções (01/10/2026): "Rede: endereço | Rede: endereço".
  { chave: 'redes_sociais', titulo: 'Redes sociais (Rede: endereço | Rede: endereço)', alternativas: ['Redes sociais', 'Rede social'] },
  { chave: 'status_cliente', titulo: 'Status (Ativo ou Inativo)' },
  { chave: 'dono_cliente', titulo: 'Dono' },
  { chave: 'origem_captacao', titulo: 'Origem da captação' },
  ...colunasDeEndereco('reg', 'Registro', { ibge: true }),
  { chave: 'cob_igual', titulo: 'Cobrança igual ao registro (Sim ou Não)' },
  ...colunasDeEndereco('cob', 'Cobrança'),
  { chave: 'ent_igual', titulo: 'Entrega igual ao registro (Sim ou Não)' },
  ...colunasDeEndereco('ent', 'Entrega', { ibge: true }),
  { chave: 'contato_nome', titulo: 'Contato - Nome' },
  { chave: 'contato_cargo', titulo: 'Contato - Cargo' },
  { chave: 'contato_email', titulo: 'Contato - E-mail' },
  { chave: 'contato_telefone_fixo', titulo: 'Contato - Telefone fixo' },
  { chave: 'contato_telefone_celular', titulo: 'Contato - Celular' },
  { chave: 'anotacoes', titulo: 'Anotações' }
];

/**
 * A interação (atividade) de uma linha de prospecção (30/09/2026). Uma por
 * linha; para lançar mais de uma, repete-se a empresa (mesmo CNPJ ou, sem
 * CNPJ, o mesmo nome) numa linha nova só com estas colunas — a importação
 * acrescenta a interação à prospecção que já existe. O próximo passo usa as
 * colunas da própria prospecção ("Próximo passo" e a data dele).
 */
const COLUNAS_INTERACAO = [
  { chave: 'interacao_tipo', titulo: 'Interação - Tipo' },
  { chave: 'interacao_data', titulo: 'Interação - Quando aconteceu (dd/mm/aaaa hh:mm)' },
  { chave: 'interacao_contato', titulo: 'Interação - Com quem (nome do contato)' },
  { chave: 'interacao_duracao', titulo: 'Interação - Duração (min)' },
  { chave: 'interacao_resumo', titulo: 'Interação - Resumo' },
  { chave: 'interacao_detalhe', titulo: 'Interação - Detalhes' }
];

const COLUNAS_PROSPECCAO = [
  { chave: 'nome_fantasia', titulo: 'Empresa', obrigatoria: true, alternativas: ['Nome fantasia', 'Nome da empresa'] },
  { chave: 'razao_social', titulo: 'Razão social' },
  { chave: 'cnpj', titulo: 'CNPJ' },
  { chave: 'inscricao_estadual', titulo: 'Inscrição estadual' },
  { chave: 'site', titulo: 'Site' },
  { chave: 'redes_sociais', titulo: 'Redes sociais (Rede: endereço | Rede: endereço)', alternativas: ['Redes sociais', 'Rede social'] },
  { chave: 'segmento', titulo: 'Segmento' },
  { chave: 'origem', titulo: 'Origem' },
  { chave: 'etapa', titulo: 'Etapa' },
  { chave: 'valor_estimado', titulo: 'Valor estimado (R$)' },
  { chave: 'probabilidade', titulo: 'Probabilidade (%)' },
  { chave: 'responsavel', titulo: 'Responsável (nome ou e-mail)' },
  { chave: 'proximo_passo', titulo: 'Próximo passo' },
  { chave: 'proximo_passo_data', titulo: 'Data do próximo passo (dd/mm/aaaa)' },
  ...colunasDeEndereco('end', 'Endereço'),
  { chave: 'contato_nome', titulo: 'Contato principal - Nome' },
  { chave: 'contato_cargo', titulo: 'Contato principal - Cargo' },
  { chave: 'contato_email', titulo: 'Contato principal - E-mail' },
  { chave: 'contato_telefone_fixo', titulo: 'Contato principal - Telefone fixo' },
  { chave: 'contato_telefone_celular', titulo: 'Contato principal - Celular' },
  { chave: 'contato_decisor', titulo: 'Contato principal - Decisor (Sim ou Não)' },
  { chave: 'anotacoes', titulo: 'Anotações' },
  ...COLUNAS_INTERACAO
];

const ETAPAS_PROSPECCAO = ['Novo', 'Contactado', 'Qualificado', 'Proposta', 'Negociação', 'Ganho', 'Perdido'];
const PROBABILIDADE_DA_ETAPA = { 'Novo': 10, 'Contactado': 25, 'Qualificado': 50, 'Proposta': 65, 'Negociação': 80, 'Ganho': 100, 'Perdido': 0 };

// ------------------------------------------------------------ modelos

const EXEMPLO_CLIENTE = {
  tipo_pessoa: 'PJ', razao_social: 'Casa Exemplo Decorações LTDA', nome_fantasia: MARCA_EXEMPLO,
  cnpj: '11.222.333/0001-81', inscricao_estadual: '0628725380094', indicador_ie: '1', email_nfe: 'nfe@exemplo.com.br',
  consumidor_final: 'Não', site: 'www.exemplo.com.br', redes_sociais: 'Instagram: @casaexemplo | Facebook: facebook.com/casaexemplo',
  status_cliente: 'Ativo', dono_cliente: 'Nome do dono (usuário do sistema)',
  origem_captacao: 'Indicação', reg_cep: '30820-272', reg_rua: 'Av. Exemplo', reg_numero: '100', reg_complemento: 'Sala 1',
  reg_bairro: 'Centro', reg_cidade: 'Belo Horizonte', reg_estado: 'MG', reg_pais: 'Brasil', reg_codigo_municipio: '3106200',
  cob_igual: 'Sim', ent_igual: 'Sim', contato_nome: 'Maria da Silva', contato_cargo: 'Compradora',
  contato_email: 'maria@exemplo.com.br', contato_telefone_fixo: '(31) 3333-4444', contato_telefone_celular: '(31) 99999-8888',
  anotacoes: 'Colunas com * são obrigatórias. Cobrança/Entrega "Sim" copiam o endereço de registro.'
};

const EXEMPLO_PROSPECCAO = {
  nome_fantasia: MARCA_EXEMPLO, razao_social: 'Loja Exemplo LTDA', cnpj: '11.222.333/0001-81', segmento: 'Decoração',
  site: 'www.exemplo.com.br', redes_sociais: 'Instagram: @lojaexemplo | LinkedIn: linkedin.com/company/loja-exemplo',
  origem: 'Indicação', etapa: 'Novo', valor_estimado: '15.000,00', probabilidade: '10', responsavel: 'Nome ou e-mail do usuário',
  proximo_passo: 'Ligar para apresentar o catálogo', proximo_passo_data: '30/09/2026', end_cep: '30820-272', end_rua: 'Av. Exemplo',
  end_numero: '100', end_bairro: 'Centro', end_cidade: 'Belo Horizonte', end_estado: 'MG', end_pais: 'Brasil',
  contato_nome: 'João Souza', contato_cargo: 'Sócio', contato_email: 'joao@exemplo.com.br', contato_telefone_celular: '(31) 98888-7777',
  contato_decisor: 'Sim',
  anotacoes: `Etapas: ${ETAPAS_PROSPECCAO.join(', ')}. Colunas com * são obrigatórias. O tipo da interação precisa estar na lista `
    + 'do cadastro (a caixa com + e −) e a data dela não pode ser futura. Para mais de uma interação, repita a empresa (mesmo CNPJ '
    + 'ou nome) numa linha nova só com as colunas "Interação".',
  interacao_tipo: 'Ligação', interacao_data: '15/09/2026 14:30', interacao_contato: 'João Souza', interacao_duracao: '20',
  interacao_resumo: 'Apresentei a empresa e pedi o catálogo', interacao_detalhe: 'Quer uma proposta para as cinco lojas.'
};

const modeloDeClientes = () => gerarCsv(COLUNAS_CLIENTE, [EXEMPLO_CLIENTE]);
const modeloDeProspeccoes = () => gerarCsv(COLUNAS_PROSPECCAO, [EXEMPLO_PROSPECCAO]);

// ------------------------------------------------------------ contatos
// Fornecedores, prestadores e parceiros (backend/contatosController.js).

const COLUNAS_CONTATO = [
  { chave: 'nome', titulo: 'Nome (empresa ou pessoa)', obrigatoria: true, alternativas: ['Nome', 'Empresa', 'Nome fantasia'] },
  { chave: 'razao_social', titulo: 'Razão social' },
  { chave: 'tipo', titulo: 'Tipo (Fornecedor, Prestador de serviço…)', obrigatoria: true, alternativas: ['Tipo', 'Tipo de contato'] },
  { chave: 'tipo_pessoa', titulo: 'Tipo de pessoa (PJ ou PF)' },
  { chave: 'cnpj', titulo: 'CNPJ', alternativas: ['CNPJ (pessoa jurídica)'] },
  { chave: 'cpf', titulo: 'CPF', alternativas: ['CPF (pessoa física)'] },
  { chave: 'inscricao_estadual', titulo: 'Inscrição estadual' },
  { chave: 'inscricao_municipal', titulo: 'Inscrição municipal' },
  { chave: 'email', titulo: 'E-mail' },
  { chave: 'telefone_celular', titulo: 'Celular' },
  { chave: 'telefone_fixo', titulo: 'Telefone' },
  { chave: 'site', titulo: 'Site' },
  { chave: 'status', titulo: 'Status (Ativo ou Inativo)' },
  ...colunasDeEndereco('end', 'Endereço', { ibge: true }),
  { chave: 'pessoa_nome', titulo: 'Pessoa de contato - Nome' },
  { chave: 'pessoa_cargo', titulo: 'Pessoa de contato - Cargo' },
  { chave: 'pessoa_email', titulo: 'Pessoa de contato - E-mail' },
  { chave: 'pessoa_telefone_fixo', titulo: 'Pessoa de contato - Telefone' },
  { chave: 'pessoa_telefone_celular', titulo: 'Pessoa de contato - Celular' },
  { chave: 'anotacoes', titulo: 'Anotações' }
];

const EXEMPLO_CONTATO = {
  nome: MARCA_EXEMPLO, razao_social: 'Madeiras Exemplo LTDA', tipo: 'Fornecedor', tipo_pessoa: 'PJ', cnpj: '11.222.333/0001-81',
  inscricao_estadual: '0628725380094', email: 'vendas@exemplo.com.br', telefone_celular: '(31) 99999-8888', telefone_fixo: '(31) 3333-4444',
  site: 'www.exemplo.com.br', status: 'Ativo', end_cep: '30820-272', end_rua: 'Av. Exemplo', end_numero: '100', end_complemento: 'Galpão 2',
  end_bairro: 'Centro', end_cidade: 'Belo Horizonte', end_estado: 'MG', end_pais: 'Brasil', end_codigo_municipio: '3106200',
  pessoa_nome: 'Carlos Souza', pessoa_cargo: 'Vendedor', pessoa_email: 'carlos@exemplo.com.br', pessoa_telefone_celular: '(31) 98888-7777',
  anotacoes: 'Colunas com * são obrigatórias. O tipo precisa existir na lista do cadastro (a caixa com + e −).'
};

const modeloDeContatos = () => gerarCsv(COLUNAS_CONTATO, [EXEMPLO_CONTATO]);

/** Um contato do banco (com a primeira pessoa) → linha da planilha. */
function contatoParaLinha(c = {}, pessoa = null, tipoNome = null) {
  const pf = String(c.tipo_pessoa || 'PJ').toUpperCase() === 'PF';
  return {
    nome: c.nome, razao_social: c.razao_social, tipo: tipoNome || '', tipo_pessoa: pf ? 'PF' : 'PJ',
    cnpj: pf ? '' : formatarCnpj(c.cnpj), cpf: pf ? formatarCpf(c.cpf) : '',
    inscricao_estadual: c.inscricao_estadual, inscricao_municipal: c.inscricao_municipal, email: c.email,
    telefone_celular: c.telefone_celular, telefone_fixo: c.telefone_fixo, site: c.site, status: c.status || 'Ativo',
    end_cep: c.end_cep, end_rua: c.end_logradouro, end_numero: c.end_numero, end_complemento: c.end_complemento,
    end_bairro: c.end_bairro, end_cidade: c.end_cidade, end_estado: c.end_uf, end_pais: c.end_pais, end_codigo_municipio: c.end_codigo_municipio,
    pessoa_nome: pessoa?.nome, pessoa_cargo: pessoa?.cargo, pessoa_email: pessoa?.email,
    pessoa_telefone_fixo: pessoa?.telefone_fixo, pessoa_telefone_celular: pessoa?.telefone_celular,
    anotacoes: c.anotacoes
  };
}

/**
 * Uma linha de contato → { payload, pessoas, bloqueios, pendencias, avisos, documento, identificacao }.
 *
 * Impede o cadastro: sem nome, sem tipo conhecido, CNPJ/CPF inválido, já
 * cadastrado ou repetido no arquivo. Sem documento entra com pendência
 * (fornecedor sem CNPJ existe: pessoa física de serviço, MEI sem nota…).
 *
 * contexto: { documentosCadastrados: Set, documentosDoArquivo: Map(doc → linha), tipos: [{ id, nome }] }
 */
function conferirContato(r = {}, contexto = {}) {
  const bloqueios = [];
  const pendencias = [];
  const avisos = [];
  const nome = texto(r.nome);
  if (!nome) bloqueios.push('Nome é obrigatório.');

  const tipoInformado = comparavel(r.tipo_pessoa);
  let pf;
  if (!tipoInformado) pf = Boolean(digitos(r.cpf)) && !digitos(r.cnpj);
  else if (/^(pf|pessoa fisica|fisica|cpf)$/.test(tipoInformado)) pf = true;
  else if (/^(pj|pessoa juridica|juridica|cnpj)$/.test(tipoInformado)) pf = false;
  else {
    pf = false;
    pendencias.push(`Tipo de pessoa "${r.tipo_pessoa}" não reconhecido: cadastrado como pessoa jurídica.`);
  }

  const documento = pf ? digitos(r.cpf) : digitos(r.cnpj);
  const nomeDoc = pf ? 'CPF' : 'CNPJ';
  if (!documento) pendencias.push(`Sem ${nomeDoc}: complete no cadastro (a NF-e de entrada é achada por ele).`);
  else if (pf ? !cpfValido(documento) : !cnpjValido(documento)) bloqueios.push(`${nomeDoc} ${r[pf ? 'cpf' : 'cnpj']} é inválido (confira os dígitos).`);
  else if (contexto.documentosCadastrados?.has(documento)) bloqueios.push(`Já existe contato com este ${nomeDoc}.`);
  else if (contexto.documentosDoArquivo?.has(documento)) bloqueios.push(`${nomeDoc} repetido: já aparece na linha ${contexto.documentosDoArquivo.get(documento)}.`);

  const tipos = Array.isArray(contexto.tipos) ? contexto.tipos : [];
  const tipo = tipos.find(t => comparavel(t.nome) === comparavel(r.tipo)) || null;
  if (!texto(r.tipo)) bloqueios.push('Tipo é obrigatório (Fornecedor, Prestador de serviço…).');
  else if (!tipo) bloqueios.push(`Tipo "${r.tipo}" não está na lista: inclua-o no cadastro (a caixa com + e −) antes de importar.`);

  let status = 'Ativo';
  const statusInformado = comparavel(r.status);
  if (statusInformado === 'inativo') status = 'Inativo';
  else if (statusInformado && statusInformado !== 'ativo') pendencias.push(`Status "${r.status}" não reconhecido: cadastrado como Ativo.`);

  const end = enderecoDe(r, 'end');
  if (vazio(end)) pendencias.push('Sem endereço.');
  else {
    const faltas = faltasDoEndereco(end);
    if (faltas.length) pendencias.push(`Endereço incompleto: falta ${faltas.join(', ')}.`);
  }

  const pessoas = [];
  if (texto(r.pessoa_nome)) {
    pessoas.push({
      nome: texto(r.pessoa_nome), cargo: texto(r.pessoa_cargo), email: texto(r.pessoa_email),
      telefone_fixo: texto(r.pessoa_telefone_fixo), telefone_celular: texto(r.pessoa_telefone_celular)
    });
  } else if (texto(r.pessoa_cargo) || texto(r.pessoa_email) || texto(r.pessoa_telefone_celular) || texto(r.pessoa_telefone_fixo)) {
    avisos.push('Pessoa de contato sem nome: os dados dela foram ignorados.');
  }

  const payload = {
    nome, razao_social: texto(r.razao_social) || null, tipo_id: tipo ? tipo.id : null, tipo_pessoa: pf ? 'PF' : 'PJ',
    cnpj: pf ? null : (documento || null), cpf: pf ? (documento || null) : null,
    inscricao_estadual: texto(r.inscricao_estadual) || null, inscricao_municipal: texto(r.inscricao_municipal) || null,
    email: texto(r.email) || null, telefone_celular: texto(r.telefone_celular) || null, telefone_fixo: texto(r.telefone_fixo) || null,
    site: texto(r.site) || null, status,
    end_logradouro: end.rua || null, end_numero: end.numero || null, end_complemento: end.complemento || null, end_bairro: end.bairro || null,
    end_cidade: end.cidade || null, end_uf: end.estado || null, end_pais: end.pais || null, end_cep: end.cep || null,
    end_codigo_municipio: end.codigo_municipio || null,
    anotacoes: texto(r.anotacoes) || null
  };
  return { payload, pessoas, bloqueios, pendencias, avisos, documento: documento || null, identificacao: nome || (pf ? formatarCpf(documento) : formatarCnpj(documento)) };
}

// ------------------------------------------------------------ exportação

/** Um cliente do banco (com o primeiro contato) → linha da planilha. */
function clienteParaLinha(c = {}, contato = null) {
  const pf = String(c.tipo_pessoa || 'PJ').toUpperCase() === 'PF';
  const linha = {
    tipo_pessoa: pf ? 'PF' : 'PJ', razao_social: c.razao_social, nome_fantasia: c.nome_fantasia,
    cnpj: pf ? '' : formatarCnpj(c.cnpj) || texto(c.cnpj), cpf: pf ? formatarCpf(c.cpf) || texto(c.cpf) : '',
    inscricao_estadual: c.inscricao_estadual, indicador_ie: c.indicador_ie ?? '', email_nfe: c.email_nfe,
    consumidor_final: c.consumidor_final ? 'Sim' : 'Não', site: c.site, redes_sociais: listas.redesEmTexto(c.redes_sociais),
    status_cliente: c.status_cliente,
    dono_cliente: c.dono_cliente, origem_captacao: c.origem_captacao, anotacoes: c.anotacoes,
    cob_igual: 'Não', ent_igual: 'Não',
    contato_nome: contato?.nome, contato_cargo: contato?.cargo, contato_email: contato?.email,
    contato_telefone_fixo: contato?.telefone_fixo, contato_telefone_celular: contato?.telefone_celular
  };
  const colunaDoBanco = { cep: 'cep', rua: 'logradouro', numero: 'numero', complemento: 'complemento', bairro: 'bairro', cidade: 'cidade', estado: 'uf', pais: 'pais' };
  for (const prefixo of ['reg', 'cob', 'ent']) {
    for (const [campo] of ENDERECO) linha[`${prefixo}_${campo}`] = c[`${prefixo}_${colunaDoBanco[campo]}`];
  }
  linha.reg_codigo_municipio = c.reg_codigo_municipio;
  linha.ent_codigo_municipio = c.ent_codigo_municipio;
  return linha;
}

/** Uma prospecção do banco (com o contato principal e o nome do responsável) → linha. */
function prospeccaoParaLinha(p = {}, contato = null, responsavel = '') {
  return {
    nome_fantasia: p.nome_fantasia, razao_social: p.razao_social, cnpj: formatarCnpj(p.cnpj) || texto(p.cnpj),
    inscricao_estadual: p.inscricao_estadual, site: p.site, redes_sociais: listas.redesEmTexto(p.redes_sociais),
    segmento: p.segmento, origem: p.origem, etapa: p.etapa,
    valor_estimado: numeroBr(p.valor_estimado), probabilidade: p.probabilidade ?? '', responsavel,
    proximo_passo: p.proximo_passo, proximo_passo_data: dataBr(p.proximo_passo_data),
    end_cep: p.end_cep, end_rua: p.end_logradouro, end_numero: p.end_numero, end_complemento: p.end_complemento,
    end_bairro: p.end_bairro, end_cidade: p.end_cidade, end_estado: p.end_uf, end_pais: p.end_pais,
    contato_nome: contato?.nome, contato_cargo: contato?.cargo, contato_email: contato?.email,
    contato_telefone_fixo: contato?.telefone_fixo, contato_telefone_celular: contato?.telefone_celular,
    contato_decisor: contato ? (contato.decisor ? 'Sim' : 'Não') : '', anotacoes: p.anotacoes
  };
}

// ------------------------------------------------------------ conferência

/** Endereço de um prefixo, no formato do payload dos controllers. */
function enderecoDe(r, prefixo) {
  return {
    rua: texto(r[`${prefixo}_rua`]), numero: texto(r[`${prefixo}_numero`]), complemento: texto(r[`${prefixo}_complemento`]),
    bairro: texto(r[`${prefixo}_bairro`]), cidade: texto(r[`${prefixo}_cidade`]),
    estado: texto(r[`${prefixo}_estado`]).toUpperCase(), pais: texto(r[`${prefixo}_pais`]), cep: texto(r[`${prefixo}_cep`]),
    ...(r[`${prefixo}_codigo_municipio`] !== undefined ? { codigo_municipio: digitos(r[`${prefixo}_codigo_municipio`]) } : {})
  };
}

const CAMPOS_ENDERECO_FORMULARIO = [['rua', 'rua'], ['numero', 'número'], ['bairro', 'bairro'], ['cidade', 'cidade'], ['estado', 'UF'], ['pais', 'país'], ['cep', 'CEP']];
const faltasDoEndereco = end => CAMPOS_ENDERECO_FORMULARIO.filter(([campo]) => !end[campo]).map(([, nome]) => nome);
const vazio = end => CAMPOS_ENDERECO_FORMULARIO.every(([campo]) => !end[campo]) && !end.complemento;

/**
 * Uma linha de cliente → { payload, bloqueios, pendencias, avisos, documento }.
 *
 * Impede o cadastro: sem nome fantasia, sem razão social, sem CNPJ/CPF (ou
 * inválido), documento já cadastrado ou repetido no arquivo. O resto que o
 * formulário pediria (dono, status, endereços, contato, IE do contribuinte)
 * vira pendência — o cliente entra e o relatório diz o que completar.
 *
 * contexto: { documentosCadastrados: Set, documentosDoArquivo: Map(doc → linha), donos: [nomes], linha }
 */
function conferirCliente(r = {}, contexto = {}) {
  const bloqueios = [];
  const pendencias = [];
  const avisos = [];

  const tipoInformado = comparavel(r.tipo_pessoa);
  let pf;
  if (!tipoInformado) pf = Boolean(digitos(r.cpf)) && !digitos(r.cnpj);
  else if (/^(pf|pessoa fisica|fisica|cpf)$/.test(tipoInformado)) pf = true;
  else if (/^(pj|pessoa juridica|juridica|cnpj)$/.test(tipoInformado)) pf = false;
  else {
    pf = false;
    pendencias.push(`Tipo de pessoa "${r.tipo_pessoa}" não reconhecido: cadastrado como pessoa jurídica.`);
  }

  if (!texto(r.nome_fantasia)) bloqueios.push('Nome fantasia é obrigatório.');
  if (!texto(r.razao_social)) bloqueios.push('Razão social é obrigatória.');

  const documento = pf ? digitos(r.cpf) : digitos(r.cnpj);
  const nomeDoc = pf ? 'CPF' : 'CNPJ';
  if (!documento) bloqueios.push(`${nomeDoc} é obrigatório para pessoa ${pf ? 'física' : 'jurídica'}.`);
  else if (pf ? !cpfValido(documento) : !cnpjValido(documento)) bloqueios.push(`${nomeDoc} ${r[pf ? 'cpf' : 'cnpj']} é inválido (confira os dígitos).`);
  else if (contexto.documentosCadastrados?.has(documento)) bloqueios.push(`Já existe cliente com este ${nomeDoc}.`);
  else if (contexto.documentosDoArquivo?.has(documento)) bloqueios.push(`${nomeDoc} repetido: já aparece na linha ${contexto.documentosDoArquivo.get(documento)}.`);

  let indicador = digitos(r.indicador_ie);
  if (indicador && !['1', '2', '9'].includes(indicador)) {
    pendencias.push(`Indicador IE "${r.indicador_ie}" inválido: cadastrado como 9 (não contribuinte).`);
    indicador = '9';
  }
  if (!indicador) indicador = texto(r.inscricao_estadual) ? '1' : '9';
  if (indicador === '1' && !texto(r.inscricao_estadual)) pendencias.push('Contribuinte do ICMS (indicador 1) sem inscrição estadual.');

  let emailNfe = texto(r.email_nfe);
  if (emailNfe && !emailValido(emailNfe)) {
    pendencias.push(`E-mail para NF-e "${emailNfe}" inválido: não foi gravado.`);
    emailNfe = '';
  }
  const consumidor = lerSimNao(r.consumidor_final);
  if (consumidor === null) pendencias.push(`Consumidor final "${r.consumidor_final}" não é Sim/Não: cadastrado como Não.`);

  let status = texto(r.status_cliente);
  if (!status) {
    status = 'Ativo';
    pendencias.push('Status não informado: cadastrado como Ativo.');
  } else {
    const achado = ['Ativo', 'Inativo'].find(s => comparavel(s) === comparavel(status));
    if (achado) status = achado;
    else pendencias.push(`Status "${status}" fora da lista (Ativo/Inativo): gravado como veio.`);
  }

  let dono = texto(r.dono_cliente);
  if (!dono) pendencias.push('Dono não informado.');
  else if (Array.isArray(contexto.donos) && contexto.donos.length) {
    const achado = contexto.donos.find(n => comparavel(n) === comparavel(dono));
    if (achado) dono = achado;
    else pendencias.push(`Dono "${dono}" não é um usuário do sistema: gravado como veio (confira — o dono recebe a CMS).`);
  }

  const reg = enderecoDe(r, 'reg');
  const faltaReg = faltasDoEndereco(reg);
  if (faltaReg.length) pendencias.push(`Endereço de registro incompleto: falta ${faltaReg.join(', ')}.`);

  const copiar = (prefixo, igual, nome) => {
    const proprio = enderecoDe(r, prefixo);
    const marcado = lerSimNao(igual);
    if (marcado === true || (marcado !== null && vazio(proprio))) {
      if (marcado !== true) avisos.push(`Endereço de ${nome} vazio: usado o de registro.`);
      return { ...reg };
    }
    const falta = faltasDoEndereco(proprio);
    if (falta.length) pendencias.push(`Endereço de ${nome} incompleto: falta ${falta.join(', ')}.`);
    return proprio;
  };
  const cob = copiar('cob', r.cob_igual, 'cobrança');
  const ent = copiar('ent', r.ent_igual, 'entrega');

  const contatos = [];
  if (texto(r.contato_nome)) {
    let email = texto(r.contato_email);
    if (email && !emailValido(email)) {
      pendencias.push(`E-mail do contato "${email}" inválido: não foi gravado.`);
      email = '';
    }
    if (!email && !texto(r.contato_telefone_fixo) && !texto(r.contato_telefone_celular)) pendencias.push('Contato sem telefone nem e-mail.');
    contatos.push({
      nome: texto(r.contato_nome), cargo: texto(r.contato_cargo), email,
      telefone_fixo: texto(r.contato_telefone_fixo), telefone_celular: texto(r.contato_telefone_celular)
    });
  } else {
    pendencias.push('Sem contato.');
  }

  // Redes sociais: a mesma leitura de Prospecções (rede pelo domínio; fora da lista vira "Outra").
  const { redes, pendencias: pendenciasDasRedes } = listas.lerRedesDoCsv(r.redes_sociais);
  pendencias.push(...pendenciasDasRedes);

  const payload = {
    tipo_pessoa: pf ? 'PF' : 'PJ',
    razao_social: texto(r.razao_social),
    nome_fantasia: texto(r.nome_fantasia),
    cnpj: pf ? null : (documento ? formatarCnpj(documento) : null),
    cpf: pf ? documento || null : null,
    inscricao_estadual: texto(r.inscricao_estadual) || null,
    indicador_ie: Number(indicador),
    email_nfe: emailNfe || null,
    consumidor_final: consumidor === true,
    site: texto(r.site) || null,
    redes_sociais: redes,
    status_cliente: status,
    dono_cliente: dono || null,
    origem_captacao: texto(r.origem_captacao) || null,
    anotacoes: texto(r.anotacoes) || null,
    endereco_registro: reg,
    endereco_cobranca: cob,
    endereco_entrega: ent,
    contatos
  };
  return { payload, bloqueios, pendencias, avisos, documento, identificacao: texto(r.nome_fantasia) || texto(r.razao_social) || documento };
}

/**
 * Uma linha de prospecção → { payload, bloqueios, pendencias, avisos, cnpj }.
 *
 * Impede o cadastro: sem o nome da empresa, ou CNPJ que já está numa
 * prospecção ativa (ou repetido no arquivo). Etapa, probabilidade, valor,
 * responsável, data e contato fora do formato viram pendência.
 *
 * contexto: { cnpjsAtivos: Set, cnpjsDoArquivo: Map(cnpj → linha), usuarios: [{ id, nome, email }] }
 */
function conferirProspeccao(r = {}, contexto = {}) {
  const bloqueios = [];
  const pendencias = [];
  const avisos = [];

  const nome = texto(r.nome_fantasia);
  if (!nome) bloqueios.push('O nome da empresa é obrigatório.');

  let cnpj = digitos(r.cnpj);
  if (cnpj && !cnpjValido(cnpj)) {
    pendencias.push(`CNPJ ${r.cnpj} é inválido: não foi gravado.`);
    cnpj = '';
  }
  if (cnpj && contexto.cnpjsAtivos?.has(cnpj)) bloqueios.push('Já existe uma prospecção ativa com este CNPJ.');
  else if (cnpj && contexto.cnpjsDoArquivo?.has(cnpj)) bloqueios.push(`CNPJ repetido: já aparece na linha ${contexto.cnpjsDoArquivo.get(cnpj)}.`);

  let etapa = ETAPAS_PROSPECCAO.find(e => comparavel(e) === comparavel(r.etapa));
  if (!texto(r.etapa)) {
    etapa = 'Novo';
    avisos.push('Etapa não informada: entrou em Novo.');
  } else if (!etapa) {
    pendencias.push(`Etapa "${r.etapa}" não existe (${ETAPAS_PROSPECCAO.join(', ')}): entrou em Novo.`);
    etapa = 'Novo';
  }

  let probabilidade = lerNumero(r.probabilidade);
  if (probabilidade === null) probabilidade = PROBABILIDADE_DA_ETAPA[etapa];
  else if (Number.isNaN(probabilidade) || probabilidade < 0 || probabilidade > 100) {
    pendencias.push(`Probabilidade "${r.probabilidade}" inválida (0 a 100): usada a da etapa (${PROBABILIDADE_DA_ETAPA[etapa]}%).`);
    probabilidade = PROBABILIDADE_DA_ETAPA[etapa];
  }

  let valor = lerNumero(r.valor_estimado);
  if (valor === null) valor = 0;
  else if (Number.isNaN(valor) || valor < 0) {
    pendencias.push(`Valor estimado "${r.valor_estimado}" inválido: gravado como 0.`);
    valor = 0;
  }

  let responsavelId = null;
  const responsavel = texto(r.responsavel);
  if (responsavel) {
    const alvo = comparavel(responsavel);
    const achado = (contexto.usuarios || []).find(u => comparavel(u.nome) === alvo || comparavel(u.email) === alvo);
    if (achado) responsavelId = Number(achado.id);
    else pendencias.push(`Responsável "${responsavel}" não é um usuário do sistema: ficou sem responsável.`);
  } else {
    pendencias.push('Responsável não informado.');
  }

  const data = lerData(r.proximo_passo_data);
  if (data === undefined) pendencias.push(`Data do próximo passo "${r.proximo_passo_data}" inválida (use dd/mm/aaaa): não foi gravada.`);

  // A origem vem da lista do cadastro (a caixa com + e −). Fora dela entra
  // como veio, com a pendência de incluí-la na lista.
  let origem = texto(r.origem) || null;
  if (origem && Array.isArray(contexto.origens)) {
    const achada = listas.naLista(contexto.origens, origem);
    if (achada) origem = achada;
    else pendencias.push(`Origem "${origem}" não está na lista (inclua-a na caixa com + e −): gravada como veio.`);
  }

  const { redes, pendencias: pendenciasDasRedes } = listas.lerRedesDoCsv(r.redes_sociais);
  pendencias.push(...pendenciasDasRedes);

  const endereco = enderecoDe(r, 'end');
  if (endereco.estado && !/^[A-Z]{2}$/.test(endereco.estado)) {
    pendencias.push(`UF "${endereco.estado}" inválida (use a sigla, ex.: MG): não foi gravada.`);
    endereco.estado = '';
  }

  const contatos = [];
  if (texto(r.contato_nome)) {
    let email = texto(r.contato_email);
    if (email && !emailValido(email)) {
      pendencias.push(`E-mail do contato "${email}" inválido: não foi gravado.`);
      email = '';
    }
    if (!email && !texto(r.contato_telefone_fixo) && !texto(r.contato_telefone_celular)) pendencias.push('Contato principal sem telefone nem e-mail.');
    const decisor = lerSimNao(r.contato_decisor);
    if (decisor === null) pendencias.push(`Decisor "${r.contato_decisor}" não é Sim/Não: gravado como Não.`);
    contatos.push({
      nome: texto(r.contato_nome), cargo: texto(r.contato_cargo), email,
      telefone_fixo: texto(r.contato_telefone_fixo), telefone_celular: texto(r.contato_telefone_celular),
      decisor: decisor === true, principal: true
    });
  } else {
    pendencias.push('Sem contato principal.');
  }

  const payload = {
    nome_fantasia: nome,
    razao_social: texto(r.razao_social) || null,
    cnpj: cnpj ? formatarCnpj(cnpj) : null,
    inscricao_estadual: texto(r.inscricao_estadual) || null,
    site: texto(r.site) || null,
    redes_sociais: redes,
    segmento: texto(r.segmento) || null,
    origem,
    etapa,
    valor_estimado: valor,
    probabilidade: Math.round(probabilidade),
    responsavel_id: responsavelId,
    proximo_passo: texto(r.proximo_passo) || null,
    proximo_passo_data: data || null,
    anotacoes: texto(r.anotacoes) || null,
    endereco,
    contatos
  };
  return { payload, bloqueios, pendencias, avisos, cnpj, identificacao: nome || texto(r.razao_social) || cnpj };
}

/** A linha traz alguma coluna da interação? */
const temInteracao = (r = {}) => COLUNAS_INTERACAO.some(c => texto(r[c.chave]));

/** Um minuto de folga para o relógio da máquina (o mesmo do modal e do backend). */
const FOLGA_DO_RELOGIO_MS = 60 * 1000;

/**
 * A interação de uma linha → `{ interacao, bloqueios, pendencias, avisos }`.
 * `interacao` é null quando a linha não traz nenhuma coluna dela.
 *
 * Recusa a linha (decisão do dono, 30/09/2026): tipo fora dos registrados na
 * lista, data no futuro — a interação registra o que JÁ aconteceu —, e o que
 * o modal também exige: tipo, resumo e a data. "Com quem" é casado depois,
 * com os contatos da empresa (quem grava faz isso).
 *
 * contexto: { tipos: [nomes da lista], agora: ms }
 */
function conferirInteracao(r = {}, contexto = {}) {
  const bloqueios = [];
  const pendencias = [];
  const avisos = [];
  if (!temInteracao(r)) return { interacao: null, bloqueios, pendencias, avisos };

  const tipos = Array.isArray(contexto.tipos) ? contexto.tipos : [];
  const tipoInformado = texto(r.interacao_tipo);
  const tipo = listas.naLista(tipos, tipoInformado);
  if (!tipoInformado) bloqueios.push('Interação sem o tipo.');
  else if (!tipo) bloqueios.push(`Tipo de interação "${tipoInformado}" não está entre os registrados (${tipos.join(', ')}): inclua-o na caixa com + e − antes de importar.`);

  let resumo = texto(r.interacao_resumo);
  if (!resumo) bloqueios.push('Interação sem o resumo.');
  else if (resumo.length > 255) {
    resumo = resumo.slice(0, 255);
    pendencias.push('Resumo da interação com mais de 255 letras: foi cortado (o resto cabe em "Detalhes").');
  }

  const agora = Number.isFinite(contexto.agora) ? contexto.agora : Date.now();
  const quando = lerDataHora(r.interacao_data);
  if (quando === null) bloqueios.push('Interação sem a data (Quando aconteceu).');
  else if (quando === undefined) bloqueios.push(`Data da interação "${r.interacao_data}" inválida (use dd/mm/aaaa hh:mm).`);
  else if (new Date(quando.iso).getTime() > agora + FOLGA_DO_RELOGIO_MS) {
    bloqueios.push(`A interação registra o que já aconteceu: a data "${r.interacao_data}" está no futuro. Para algo que ainda vai acontecer, use o próximo passo.`);
  } else if (quando.semHora) avisos.push('Interação sem a hora: registrada às 00:00 do dia.');

  let duracao = null;
  const duracaoBruta = texto(r.interacao_duracao);
  if (duracaoBruta) {
    const n = lerNumero(duracaoBruta);
    if (Number.isNaN(n) || n === null || n < 0 || n > 32767) pendencias.push(`Duração "${duracaoBruta}" inválida (minutos): não foi gravada.`);
    else duracao = Math.round(n);
  }

  const interacao = {
    tipo: tipo || tipoInformado,
    data: quando?.iso || null,
    resumo,
    detalhe: String(r.interacao_detalhe ?? '').trim() || null,
    duracao_min: duracao,
    com_quem: texto(r.interacao_contato) || null
  };
  return { interacao, bloqueios, pendencias, avisos };
}

/**
 * Roda `fn` em cada item, no máximo `limite` ao mesmo tempo (a gravação de
 * centenas de linhas uma a uma levaria minutos; todas juntas afogariam a API).
 */
async function emParalelo(itens = [], limite = 4, fn) {
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < itens.length) {
      const i = proximo++;
      await fn(itens[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhador));
}

/** A situação final de uma linha a partir do que a conferência achou. */
function situacaoDaLinha({ bloqueios = [], pendencias = [] } = {}) {
  if (bloqueios.length) return 'nao_registrado';
  return pendencias.length ? 'registrado_com_pendencias' : 'registrado';
}

/** Totais do relatório. */
function resumirImportacao(resultados = []) {
  const conta = s => resultados.filter(r => r.situacao === s).length;
  return {
    linhas: resultados.length,
    registrados: conta('registrado'),
    com_pendencias: conta('registrado_com_pendencias'),
    nao_registrados: conta('nao_registrado'),
    ignorados: conta('ignorado')
  };
}

module.exports = {
  SEPARADOR, BOM, MARCA_EXEMPLO, COLUNAS_CLIENTE, COLUNAS_PROSPECCAO, COLUNAS_INTERACAO, COLUNAS_CONTATO, ETAPAS_PROSPECCAO,
  modeloDeContatos, contatoParaLinha, conferirContato, temInteracao, conferirInteracao, lerDataHora,
  lerCsv, gerarCsv, celula, detectarSeparador, mapearCabecalho, registroDaLinha, tituloDaColuna,
  lerSimNao, lerNumero, lerData, dataBr, numeroBr, cnpjValido, cpfValido, formatarCnpj, formatarCpf, digitos, comparavel,
  ehLinhaDeExemplo, modeloDeClientes, modeloDeProspeccoes, clienteParaLinha, prospeccaoParaLinha,
  conferirCliente, conferirProspeccao, situacaoDaLinha, resumirImportacao, emParalelo
};
