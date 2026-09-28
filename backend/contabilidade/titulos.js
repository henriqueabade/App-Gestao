/**
 * Contas a pagar da Contabilidade (etapa 3): a conta (título) do fornecedor —
 * que é um CONTATO do CRM —, as parcelas e o pagamento de cada parcela.
 *
 * - Uma parcela tem um pagamento valendo; estornar (com motivo) libera. O
 *   valor pago é o que saiu do banco: acima da parcela vira juros/multa,
 *   abaixo vira desconto — os dois ficam gravados.
 * - Conta com pagamento não muda valor, competência nem parcelas (estorne
 *   antes); descrição, categoria, fornecedor e linha digitável mudam sempre.
 * - Cancelar (com motivo) só sem pagamento valendo.
 * - Competência fechada na Contabilidade recusa lançamento, pagamento e
 *   estorno nela (base.garantirAberta).
 * - Os pagamentos de comissão e produção NÃO viram conta aqui: eles já são
 *   `financeiro_pagamentos` do Financeiro (plano, seção B). A nota de serviço
 *   deles entra como documento recebido ligado ao pagamento.
 *
 * As contas ficam em funções puras sobre listas já lidas; as outras falam com
 * a API. Datas são texto 'YYYY-MM-DD' (new Date volta um dia em São Paulo).
 */
const c = require('../financeiro/comum');
const b = require('./base');
const eventos = require('./eventos');
const arquivos = require('./arquivos');

const FORMAS = ['Pix', 'Boleto', 'TED/DOC', 'Transferência', 'Débito automático', 'Cartão', 'Dinheiro', 'Cheque'];

/** As categorias que o relatório da contabilidade usa hoje (a lista completa vem na etapa 6). */
const CATEGORIAS_SUGERIDAS = ['Aquisição de Bens', 'Serviços de Terceiros', 'Impostos e Taxas', 'Aporte de Capital'];

const SITUACOES_PARCELA = { a_vencer: 'A vencer', vence_hoje: 'Vence hoje', vencida: 'Vencida', paga: 'Paga', cancelada: 'Cancelada' };
const SITUACOES_TITULO = { aberto: 'Em aberto', parcial: 'Paga em parte', vencido: 'Vencida', pago: 'Paga', cancelado: 'Cancelada' };
const VISOES = {
  abertas: 'Em aberto',
  vencidas: 'Vencidas',
  mes: 'Vencem no mês',
  pagas: 'Pagas no mês',
  todas: 'Lançadas no mês',
  canceladas: 'Canceladas'
};

const pad = n => String(n).padStart(2, '0');
const mesDe = iso => String(c.dia(iso) || '').slice(0, 7);
const ativo = p => p && !p.estornado_em;

/** A data + n meses, no mesmo dia (ou no último do mês, quando ele não existe). */
function somarMesesNaData(iso, n) {
  const [a, m, d] = String(iso).split('-').map(Number);
  const total = a * 12 + (m - 1) + Number(n || 0);
  const ano = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${pad(mes)}-${pad(Math.min(d, ultimo))}`;
}

/**
 * N parcelas mensais a partir do primeiro vencimento; o valor dividido em
 * centavos, com a sobra na última. Pura.
 */
function gerarParcelas({ quantidade = 1, primeiroVencimento, valorTotal }) {
  const q = Math.trunc(Number(quantidade));
  if (!(q >= 1 && q <= 60)) throw c.erro('Informe de 1 a 60 parcelas.');
  if (!c.dataValida(primeiroVencimento)) throw c.erro('Informe o vencimento da primeira parcela.');
  const total = b.valorDe(valorTotal) || 0;
  if (!(total > 0)) throw c.erro('Informe o valor da conta.');
  const emCentavos = Math.round(total * 100);
  const base = Math.floor(emCentavos / q);
  const sobra = emCentavos - base * q;
  return Array.from({ length: q }, (_, i) => ({
    numero: i + 1,
    vencimento: somarMesesNaData(primeiroVencimento, i),
    valor: (base + (i === q - 1 ? sobra : 0)) / 100,
    linha_digitavel: null
  }));
}

/**
 * As parcelas que a tela mandou, conferidas: data, valor e a soma igual ao
 * valor da conta. Numeradas de novo na ordem do vencimento. Pura.
 */
function conferirParcelas(parcelas, valorTotal) {
  const lista = Array.isArray(parcelas) ? parcelas : [];
  if (!lista.length) throw c.erro('A conta precisa de ao menos uma parcela.');
  if (lista.length > 60) throw c.erro('No máximo 60 parcelas.');
  const limpas = lista.map((p, i) => {
    const vencimento = String(p?.vencimento || '').slice(0, 10);
    if (!c.dataValida(vencimento)) throw c.erro(`Informe o vencimento da parcela ${i + 1}.`);
    const valor = b.valorDe(p?.valor);
    if (!(valor > 0)) throw c.erro(`Informe o valor da parcela ${i + 1}.`);
    const linha = b.digitos(p?.linha_digitavel).slice(0, 60) || null;
    return { id: p?.id ?? null, vencimento, valor, linha_digitavel: linha };
  }).sort((x, y) => x.vencimento.localeCompare(y.vencimento));
  const soma = c.centavos(limpas.reduce((s, p) => s + p.valor, 0));
  const total = c.centavos(valorTotal);
  if (Math.abs(soma - total) > 0.009) throw c.erro(`A soma das parcelas (${c.reais(soma)}) não bate com o valor da conta (${c.reais(total)}).`);
  return limpas.map((p, i) => ({ ...p, numero: i + 1 }));
}

/**
 * O cabeçalho da conta, conferido. `parcial` só confere o que veio. A
 * competência, quando não vem, é a do mês da emissão (ou do primeiro
 * vencimento). Pura.
 */
function validarTitulo(entrada = {}, { parcial = false, primeiroVencimento = null } = {}) {
  const tem = campo => entrada[campo] !== undefined;
  const t = {};
  if (!parcial || tem('descricao')) {
    t.descricao = c.texto(entrada.descricao, 200);
    if (t.descricao.length < 3) throw c.erro('Descreva a conta (ao menos 3 letras).');
  }
  if (!parcial || tem('valor_total')) {
    t.valor_total = b.valorDe(entrada.valor_total);
    if (!(t.valor_total > 0)) throw c.erro('Informe o valor da conta.');
  }
  if (!parcial || tem('data_emissao')) {
    const d = String(entrada.data_emissao || '').slice(0, 10);
    if (d && !c.dataValida(d)) throw c.erro('Data de emissão inválida.');
    t.data_emissao = d || null;
  }
  if (!parcial || tem('competencia')) {
    const comp = String(entrada.competencia || '');
    if (comp && !c.competenciaValida(comp)) throw c.erro('Competência inválida (AAAA-MM).');
    t.competencia = comp || mesDe(t.data_emissao ?? entrada.data_emissao) || mesDe(primeiroVencimento) || null;
    if (!parcial && !t.competencia) throw c.erro('Informe a competência da conta.');
  }
  if (!parcial || tem('categoria')) t.categoria = c.texto(entrada.categoria, 80) || null;
  if (!parcial || tem('numero_documento')) t.numero_documento = c.texto(entrada.numero_documento, 60) || null;
  if (!parcial || tem('observacao')) t.observacao = String(entrada.observacao ?? '').trim().slice(0, 1000) || null;
  if (!parcial || tem('contato_id')) {
    const id = entrada.contato_id;
    if (id !== null && id !== undefined && id !== '' && !/^\d+$/.test(String(id))) throw c.erro('Fornecedor inválido.');
    t.contato_id = id === null || id === undefined || id === '' ? null : Number(id);
  }
  if (!parcial || tem('documento_recebido_id')) {
    const id = entrada.documento_recebido_id;
    if (id !== null && id !== undefined && id !== '' && !/^\d+$/.test(String(id))) throw c.erro('Documento inválido.');
    t.documento_recebido_id = id === null || id === undefined || id === '' ? null : Number(id);
  }
  return t;
}

function situacaoDaParcela(parcela, pagamento, hoje, cancelado = false) {
  if (cancelado) return 'cancelada';
  if (pagamento) return 'paga';
  const venc = c.dia(parcela?.vencimento);
  const dia = c.dia(hoje);
  if (venc && dia && venc < dia) return 'vencida';
  if (venc && venc === dia) return 'vence_hoje';
  return 'a_vencer';
}

/** O pagamento que a tela vê. */
function pagamentoPublico(p) {
  if (!p) return null;
  return {
    id: p.id, data: c.dia(p.data_pagamento), competencia: p.competencia, valor_pago: c.centavos(p.valor_pago),
    juros: c.centavos(p.valor_juros), desconto: c.centavos(p.valor_desconto), forma: p.forma, observacao: p.observacao || null,
    estornado: Boolean(p.estornado_em), motivo_estorno: p.motivo_estorno || null
  };
}

/**
 * A conta inteira, com a situação de cada parcela e da conta. `contatos` é
 * um Map id -> contato. Pura.
 */
function montarTitulo(t, { parcelas = [], pagamentos = [], contatos = new Map(), hoje }) {
  const cancelado = t.status === 'cancelado';
  const minhas = c.lista(parcelas).filter(p => String(p.titulo_id) === String(t.id)).sort((x, y) => Number(x.numero) - Number(y.numero));
  const pags = c.lista(pagamentos).filter(p => String(p.titulo_id) === String(t.id));
  const linhas = minhas.map(p => {
    const pago = pags.find(x => ativo(x) && String(x.parcela_id) === String(p.id)) || null;
    const situacao = situacaoDaParcela(p, pago, hoje, cancelado);
    return {
      id: p.id, numero: Number(p.numero), de: minhas.length, vencimento: c.dia(p.vencimento), valor: c.centavos(p.valor),
      linha_digitavel: p.linha_digitavel || null, situacao, situacao_rotulo: SITUACOES_PARCELA[situacao],
      pagamento: pagamentoPublico(pago),
      estornos: pags.filter(x => !ativo(x) && String(x.parcela_id) === String(p.id)).map(pagamentoPublico)
    };
  });
  const soma = (lista, f) => c.centavos(lista.reduce((s, x) => s + f(x), 0));
  const abertas = linhas.filter(p => ['a_vencer', 'vence_hoje', 'vencida'].includes(p.situacao));
  const vencidas = linhas.filter(p => p.situacao === 'vencida');
  const pagas = linhas.filter(p => p.situacao === 'paga');
  let situacao = 'aberto';
  if (cancelado) situacao = 'cancelado';
  else if (linhas.length && pagas.length === linhas.length) situacao = 'pago';
  else if (vencidas.length) situacao = 'vencido';
  else if (pagas.length) situacao = 'parcial';
  const contato = t.contato_id !== null && t.contato_id !== undefined ? contatos.get(String(t.contato_id)) || null : null;
  return {
    id: t.id,
    contato_id: t.contato_id ?? null,
    fornecedor: contato?.nome || null,
    fornecedor_documento: contato ? b.documentoFormatado(contato.cnpj || contato.cpf) : null,
    documento_recebido_id: t.documento_recebido_id ?? null,
    descricao: t.descricao,
    categoria: t.categoria || null,
    numero_documento: t.numero_documento || null,
    data_emissao: c.dia(t.data_emissao),
    competencia: t.competencia,
    valor_total: c.centavos(t.valor_total),
    status: t.status,
    origem: t.origem || 'manual',
    observacao: t.observacao || null,
    criado_em: b.instanteBR(t.criado_em),
    cancelado_em: b.instanteBR(t.cancelado_em),
    motivo_cancelamento: t.motivo_cancelamento || null,
    parcelas: linhas,
    pago: soma(pagas, p => p.pagamento.valor_pago),
    aberto: soma(abertas, p => p.valor),
    vencido: soma(vencidas, p => p.valor),
    tem_pagamento: pagas.length > 0,
    situacao,
    situacao_rotulo: SITUACOES_TITULO[situacao],
    proximo_vencimento: abertas.map(p => p.vencimento).sort()[0] || null
  };
}

/** Uma linha da lista = uma parcela, com o que a conta tem de identificação. */
function linhaDaParcela(t, p) {
  return {
    titulo_id: t.id, parcela_id: p.id, numero: p.numero, de: p.de, vencimento: p.vencimento, valor: p.valor,
    situacao: p.situacao, situacao_rotulo: p.situacao_rotulo, pagamento: p.pagamento,
    fornecedor: t.fornecedor, fornecedor_documento: t.fornecedor_documento, descricao: t.descricao, categoria: t.categoria,
    numero_documento: t.numero_documento, competencia: t.competencia, documento_recebido_id: t.documento_recebido_id,
    linha_digitavel: p.linha_digitavel
  };
}

/**
 * As linhas de uma visão (as parcelas) e os totais da competência. Pura.
 *   abertas     todas em aberto (vencidas primeiro)
 *   vencidas    em aberto com vencimento antes de hoje
 *   mes         vencem no mês (menos as de conta cancelada)
 *   pagas       pagas no mês (pela data do pagamento)
 *   todas       as das contas lançadas no mês (competência da conta)
 *   canceladas  as das contas canceladas lançadas no mês
 */
function visaoDaLista(titulos, { visao = 'abertas', competencia, hoje }) {
  const v = VISOES[visao] ? visao : 'abertas';
  const linhas = [];
  for (const t of titulos) {
    for (const p of t.parcelas) {
      const aberta = ['a_vencer', 'vence_hoje', 'vencida'].includes(p.situacao);
      let entra = false;
      if (v === 'abertas') entra = aberta;
      else if (v === 'vencidas') entra = p.situacao === 'vencida';
      else if (v === 'mes') entra = p.situacao !== 'cancelada' && String(p.vencimento).startsWith(competencia);
      else if (v === 'pagas') entra = Boolean(p.pagamento) && String(p.pagamento.data).startsWith(competencia);
      else if (v === 'todas') entra = t.competencia === competencia && t.status !== 'cancelado';
      else if (v === 'canceladas') entra = t.status === 'cancelado' && t.competencia === competencia;
      if (entra) linhas.push(linhaDaParcela(t, p));
    }
  }
  const ordem = v === 'pagas'
    ? (x, y) => String(x.pagamento?.data).localeCompare(String(y.pagamento?.data))
    : (x, y) => String(x.vencimento).localeCompare(String(y.vencimento)) || Number(x.titulo_id) - Number(y.titulo_id) || x.numero - y.numero;
  return { visao: v, visao_rotulo: VISOES[v], linhas: linhas.sort(ordem), totais: totaisDaCompetencia(titulos, { competencia, hoje }) };
}

/** Os quatro números do topo da lista. Pura. */
function totaisDaCompetencia(titulos, { competencia }) {
  const parcelas = titulos.flatMap(t => t.parcelas);
  const abertas = parcelas.filter(p => ['a_vencer', 'vence_hoje', 'vencida'].includes(p.situacao));
  const junta = lista => ({ quantidade: lista.length, total: c.centavos(lista.reduce((s, p) => s + p.valor, 0)) });
  const pagasNoMes = parcelas.filter(p => p.pagamento && String(p.pagamento.data).startsWith(competencia));
  return {
    em_aberto: junta(abertas),
    vencido: junta(abertas.filter(p => p.situacao === 'vencida')),
    vence_no_mes: junta(abertas.filter(p => String(p.vencimento).startsWith(competencia))),
    pago_no_mes: { quantidade: pagasNoMes.length, total: c.centavos(pagasNoMes.reduce((s, p) => s + p.pagamento.valor_pago, 0)) }
  };
}

// ------------------------------------------------------------------ leitura

/** Os contatos (fornecedores) num Map; sem o SQL dos Contatos, vazio. */
async function lerContatos(api) {
  const linhas = await api.get('/api/contatos').then(c.lista).catch(() => []);
  return new Map(linhas.filter(Boolean).map(x => [String(x.id), x]));
}

async function lerBase(api) {
  const [titulos, parcelas, pagamentos, contatos] = await Promise.all([
    b.ler(api, 'titulos_pagar'), b.ler(api, 'titulo_pagar_parcelas'), b.ler(api, 'titulo_pagar_pagamentos'), lerContatos(api)
  ]);
  return { titulos, parcelas, pagamentos, contatos };
}

function montarTodos(base, hoje) {
  return base.titulos.map(t => montarTitulo(t, { parcelas: base.parcelas, pagamentos: base.pagamentos, contatos: base.contatos, hoje }));
}

/** As categorias já usadas + as da contabilidade, sem repetir (para a lista do campo). */
function categoriasDe(titulos) {
  const vistas = new Map();
  for (const nome of [...CATEGORIAS_SUGERIDAS, ...titulos.map(t => t.categoria).filter(Boolean)]) {
    const chave = String(nome).trim().toLowerCase();
    if (chave && !vistas.has(chave)) vistas.set(chave, String(nome).trim());
  }
  return [...vistas.values()].sort((x, y) => x.localeCompare(y, 'pt-BR'));
}

/** As categorias para a lista do campo e as formas de pagamento (a tela do formulário). */
async function categoriasDisponiveis(api) {
  const linhas = (await b.lerOpcional(api, 'titulos_pagar')) || [];
  return { categorias: categoriasDe(linhas), formas: FORMAS };
}

async function listar(api, { visao, competencia, hoje }) {
  const comp = c.competenciaValida(competencia) ? String(competencia) : c.competenciaDe(hoje);
  const base = await lerBase(api);
  const titulos = montarTodos(base, hoje);
  return { competencia: comp, hoje: c.dia(hoje), ...visaoDaLista(titulos, { visao, competencia: comp, hoje }), categorias: categoriasDe(base.titulos), formas: FORMAS };
}

async function lerTitulo(api, id) {
  const t = (await b.ler(api, 'titulos_pagar', { id: Number(id) }))[0] || null;
  if (!t) throw c.erro('Conta a pagar não encontrada.', 404);
  return t;
}

async function detalhe(api, id, { hoje }) {
  const t = await lerTitulo(api, id);
  const [parcelas, pagamentos, contatos] = await Promise.all([
    b.ler(api, 'titulo_pagar_parcelas', { titulo_id: Number(id) }),
    b.ler(api, 'titulo_pagar_pagamentos', { titulo_id: Number(id) }),
    lerContatos(api)
  ]);
  const montado = montarTitulo(t, { parcelas, pagamentos, contatos, hoje });
  const [doArquivo, historico, documento] = await Promise.all([
    arquivosDoTitulo(api, montado),
    eventos.atividade({ api, referenciaTipo: 'titulo', referenciaId: t.id, limite: 100 }).catch(() => []),
    t.documento_recebido_id ? b.ler(api, 'documentos_recebidos', { id: Number(t.documento_recebido_id) }).then(r => r[0] || null).catch(() => null) : null
  ]);
  return {
    titulo: montado,
    documento: documento && !documento.excluido_em ? {
      id: documento.id, tipo: documento.tipo, numero: documento.numero, serie: documento.serie, emitente: documento.emitente_nome,
      data_emissao: c.dia(documento.data_emissao), valor_total: c.centavos(documento.valor_total)
    } : null,
    arquivos: doArquivo,
    historico,
    formas: FORMAS,
    categorias: categoriasDe([t])
  };
}

/** Os arquivos da conta e os de cada pagamento dela (sem repetir). */
async function arquivosDoTitulo(api, montado) {
  const listas = await Promise.all([
    arquivos.listar(api, { alvoTipo: 'titulo', alvoId: montado.id }),
    ...montado.parcelas.flatMap(p => [p.pagamento, ...p.estornos].filter(Boolean))
      .map(pg => arquivos.listar(api, { alvoTipo: 'pagamento', alvoId: pg.id }))
  ]);
  const vistos = new Set();
  return listas.flat().filter(a => (vistos.has(a.id) ? false : vistos.add(a.id)));
}

// ------------------------------------------------------------------ gravação

async function conferirContato(api, contatoId) {
  if (contatoId === null || contatoId === undefined) return null;
  const achado = await api.get(`/api/contatos/${contatoId}`).catch(() => null);
  if (!achado || achado.error || String(achado.id) !== String(contatoId)) throw c.erro('Fornecedor não encontrado: escolha outro ou cadastre em Contatos.', 404);
  return achado;
}

async function conferirDocumento(api, documentoId, { ignorarTituloId = null } = {}) {
  if (documentoId === null || documentoId === undefined) return null;
  const doc = (await b.ler(api, 'documentos_recebidos', { id: Number(documentoId) }))[0] || null;
  if (!doc || doc.excluido_em) throw c.erro('Documento fiscal não encontrado.', 404);
  const outros = (await b.ler(api, 'titulos_pagar', { documento_recebido_id: Number(documentoId) }))
    .filter(t => t.status !== 'cancelado' && String(t.id) !== String(ignorarTituloId));
  if (outros.length) throw c.erro(`Este documento já é da conta "${outros[0].descricao}".`, 409, { titulo_id: outros[0].id });
  return doc;
}

async function inserirParcelas(api, tituloId, parcelas) {
  const gravadas = [];
  for (const p of parcelas) {
    gravadas.push(await b.inserir(api, 'titulo_pagar_parcelas', {
      titulo_id: Number(tituloId), numero: p.numero, vencimento: p.vencimento, valor: p.valor, linha_digitavel: p.linha_digitavel || null
    }));
  }
  return gravadas;
}

/**
 * Lança a conta. `entrada.parcelas` (a lista editada na tela) ou
 * `quantidade_parcelas` + `primeiro_vencimento` (divididas aqui).
 */
async function criar(api, { entrada = {}, usuarioId = null, hoje, origem = 'manual', registrarEvento = true }) {
  const primeiro = Array.isArray(entrada.parcelas) && entrada.parcelas.length ? String(entrada.parcelas[0]?.vencimento || '') : entrada.primeiro_vencimento;
  const t = validarTitulo(entrada, { primeiroVencimento: primeiro });
  const parcelas = Array.isArray(entrada.parcelas) && entrada.parcelas.length
    ? conferirParcelas(entrada.parcelas, t.valor_total)
    : gerarParcelas({ quantidade: entrada.quantidade_parcelas || 1, primeiroVencimento: entrada.primeiro_vencimento, valorTotal: t.valor_total });
  await b.garantirAberta(api, t.competencia, 'lançar contas nela');
  const contato = await conferirContato(api, t.contato_id);
  await conferirDocumento(api, t.documento_recebido_id);
  const titulo = await b.inserir(api, 'titulos_pagar', {
    ...t, status: 'aberto', origem: ['manual', 'nfe', 'nfse', 'outro'].includes(origem) ? origem : 'manual',
    criado_por: usuarioId, criado_em: c.agora()
  });
  try {
    await inserirParcelas(api, titulo.id, parcelas);
  } catch (e) {
    await api.delete(`/api/titulos_pagar/${titulo.id}`).catch(() => null);
    throw e;
  }
  if (registrarEvento) {
    await eventos.registrar(api, {
      tipo: 'titulo_criado', competencia: t.competencia, usuarioId, referenciaTipo: 'titulo', referenciaId: titulo.id,
      descricao: `${t.descricao}${contato ? ` — ${contato.nome}` : ''}: ${c.reais(t.valor_total)} em ${c.plural(parcelas.length, 'parcela', 'parcelas')} (1ª em ${c.impressa(parcelas[0].vencimento)})`
    });
  }
  return { id: titulo.id, competencia: t.competencia, parcelas: parcelas.length };
}

const ROTULOS_CAMPOS = {
  descricao: 'Descrição', categoria: 'Categoria', numero_documento: 'Nº do documento', observacao: 'Observação',
  contato_id: 'Fornecedor', valor_total: 'Valor', competencia: 'Competência', data_emissao: 'Emissão', documento_recebido_id: 'Documento fiscal'
};
const TRAVADOS_COM_PAGAMENTO = ['valor_total', 'competencia', 'data_emissao', 'documento_recebido_id'];

const igual = (x, y) => String(x ?? '') === String(y ?? '');

/** O que mudou nas parcelas (vencimento ou valor), comparando pela ordem. Pura. */
function parcelasMudaram(antes, depois) {
  if (antes.length !== depois.length) return true;
  const a = [...antes].sort((x, y) => Number(x.numero) - Number(y.numero));
  return depois.some((p, i) => c.dia(a[i].vencimento) !== p.vencimento || Math.abs(c.centavos(a[i].valor) - p.valor) > 0.009);
}

async function editar(api, id, { entrada = {}, usuarioId = null, hoje }) {
  const t = await lerTitulo(api, id);
  if (t.status === 'cancelado') throw c.erro('Esta conta foi cancelada.', 409);
  const [parcelas, pagamentos] = await Promise.all([
    b.ler(api, 'titulo_pagar_parcelas', { titulo_id: Number(id) }),
    b.ler(api, 'titulo_pagar_pagamentos', { titulo_id: Number(id) })
  ]);
  const comPagamento = pagamentos.some(ativo);
  const novos = validarTitulo(entrada, { parcial: true, primeiroVencimento: entrada.parcelas?.[0]?.vencimento });
  const mudou = Object.keys(novos).filter(k => !igual(k === 'valor_total' ? c.centavos(t[k]) : (k === 'data_emissao' ? c.dia(t[k]) : t[k]), novos[k]));
  const valorFinal = novos.valor_total ?? c.centavos(t.valor_total);

  // As parcelas: só a linha digitável muda com pagamento; sem pagamento, a lista inteira.
  let novasParcelas = null;
  const linhasNovas = [];
  const mandou = Array.isArray(entrada.parcelas) && entrada.parcelas.length;
  if (mandou) {
    const conferidas = conferirParcelas(entrada.parcelas, valorFinal);
    if (parcelasMudaram(parcelas, conferidas)) novasParcelas = conferidas;
    else {
      // Mesmas datas e valores: vale só a linha digitável de cada uma.
      const porNumero = new Map(parcelas.map(p => [Number(p.numero), p]));
      for (const p of conferidas) {
        const atual = porNumero.get(p.numero);
        if (atual && !igual(atual.linha_digitavel, p.linha_digitavel)) linhasNovas.push({ id: atual.id, linha_digitavel: p.linha_digitavel });
      }
    }
  } else if (mudou.includes('valor_total')) {
    throw c.erro('Mudou o valor: refaça as parcelas junto.');
  }
  if (comPagamento && (mudou.some(k => TRAVADOS_COM_PAGAMENTO.includes(k)) || novasParcelas)) {
    throw c.erro('Esta conta já tem pagamento: estorne-o antes de mudar valor, competência, emissão, documento ou parcelas.', 409);
  }
  await b.garantirAberta(api, t.competencia, 'alterar contas nela');
  if (novos.competencia && novos.competencia !== t.competencia) await b.garantirAberta(api, novos.competencia, 'lançar contas nela');
  if (mudou.includes('contato_id')) await conferirContato(api, novos.contato_id);
  if (mudou.includes('documento_recebido_id')) await conferirDocumento(api, novos.documento_recebido_id, { ignorarTituloId: t.id });

  const campos = Object.fromEntries(mudou.map(k => [k, novos[k]]));
  if (Object.keys(campos).length) await b.atualizar(api, 'titulos_pagar', t.id, { ...campos, atualizado_em: c.agora() });
  for (const l of linhasNovas) await b.atualizar(api, 'titulo_pagar_parcelas', l.id, { linha_digitavel: l.linha_digitavel });
  if (novasParcelas) {
    for (const p of parcelas) await b.excluir(api, 'titulo_pagar_parcelas', p.id);
    await inserirParcelas(api, t.id, novasParcelas);
  }
  const partes = mudou.map(k => ROTULOS_CAMPOS[k] || k);
  if (linhasNovas.length) partes.push('linha digitável');
  if (novasParcelas) partes.push('parcelas');
  if (partes.length) {
    await eventos.registrar(api, {
      tipo: 'titulo_alterado', competencia: novos.competencia || t.competencia, usuarioId, referenciaTipo: 'titulo', referenciaId: t.id,
      descricao: `${novos.descricao || t.descricao}: mudou ${partes.join(', ')}`,
      dados: { antes: Object.fromEntries(mudou.map(k => [k, t[k] ?? null])), depois: campos }
    });
  }
  return { id: t.id, alterado: partes };
}

async function cancelar(api, id, { motivo, usuarioId = null }) {
  const m = c.texto(motivo, 500);
  if (m.length < 5) throw c.erro('Diga por que a conta é cancelada (ao menos 5 letras).');
  const t = await lerTitulo(api, id);
  if (t.status === 'cancelado') throw c.erro('Esta conta já foi cancelada.', 409);
  const pagamentos = await b.ler(api, 'titulo_pagar_pagamentos', { titulo_id: Number(id) });
  if (pagamentos.some(ativo)) throw c.erro('Esta conta tem pagamento: estorne-o antes de cancelar.', 409);
  await b.garantirAberta(api, t.competencia, 'cancelar contas nela');
  await b.atualizar(api, 'titulos_pagar', t.id, { status: 'cancelado', cancelado_em: c.agora(), cancelado_por: usuarioId, motivo_cancelamento: m, atualizado_em: c.agora() });
  await eventos.registrar(api, {
    tipo: 'titulo_cancelado', competencia: t.competencia, usuarioId, referenciaTipo: 'titulo', referenciaId: t.id,
    descricao: `${t.descricao} (${c.reais(t.valor_total)}) cancelada: ${m}`
  });
  return { id: t.id, status: 'cancelado' };
}

/**
 * Registra o pagamento de uma parcela. O comprovante (opcional) vai junto:
 * se ele falhar, o pagamento fica e a resposta avisa.
 */
async function pagar(api, parcelaId, { entrada = {}, usuarioId = null, hoje }) {
  const parcela = (await b.ler(api, 'titulo_pagar_parcelas', { id: Number(parcelaId) }))[0] || null;
  if (!parcela) throw c.erro('Parcela não encontrada.', 404);
  const t = await lerTitulo(api, parcela.titulo_id);
  if (t.status === 'cancelado') throw c.erro('Esta conta foi cancelada.', 409);
  const data = String(entrada.data_pagamento || '').slice(0, 10);
  if (!c.dataValida(data)) throw c.erro('Informe a data do pagamento.');
  if (data > c.dia(hoje)) throw c.erro('A data do pagamento não pode ser futura.');
  const valor = b.valorDe(entrada.valor_pago);
  if (!(valor > 0)) throw c.erro('Informe o valor pago.');
  const forma = String(entrada.forma || '');
  if (!FORMAS.includes(forma)) throw c.erro(`Informe como foi pago (${FORMAS.join(', ')}).`);
  const competencia = data.slice(0, 7);
  await b.garantirAberta(api, competencia, 'registrar pagamentos nela');
  const jaPago = (await b.ler(api, 'titulo_pagar_pagamentos', { parcela_id: Number(parcela.id) })).find(ativo);
  if (jaPago) throw c.erro(`Esta parcela já foi paga em ${c.impressa(jaPago.data_pagamento)}. Estorne antes, se foi engano.`, 409);
  const diferenca = c.centavos(valor - c.centavos(parcela.valor));
  let pagamento;
  try {
    pagamento = await b.inserir(api, 'titulo_pagar_pagamentos', {
      parcela_id: Number(parcela.id), titulo_id: Number(t.id), data_pagamento: data, competencia, valor_pago: valor,
      valor_juros: diferenca > 0 ? diferenca : 0, valor_desconto: diferenca < 0 ? -diferenca : 0, forma,
      observacao: c.texto(entrada.observacao, 500) || null, criado_por: usuarioId, criado_em: c.agora()
    });
  } catch (e) {
    if (c.ehDuplicado(e)) throw c.erro('Esta parcela acabou de ser paga por outra pessoa.', 409);
    throw e;
  }
  let aviso = null;
  let comprovante = null;
  if (entrada.comprovante?.base64) {
    try {
      const r = await arquivos.salvar(api, {
        nome: entrada.comprovante.nome, tipo: entrada.comprovante.tipo, base64: entrada.comprovante.base64, categoria: 'comprovante',
        origem: 'fornecido', competencia, usuarioId, registrarEvento: false,
        vinculos: [{ alvo_tipo: 'pagamento', alvo_id: String(pagamento.id) }, { alvo_tipo: 'titulo', alvo_id: String(t.id) }]
      });
      comprovante = r.arquivo?.id ?? null;
    } catch (e) {
      aviso = `O pagamento foi registrado, mas o comprovante não: ${e.message}. Anexe de novo pela conta.`;
    }
  }
  const extra = diferenca > 0 ? ` (${c.reais(diferenca)} de juros/multa)` : (diferenca < 0 ? ` (${c.reais(-diferenca)} de desconto)` : '');
  await eventos.registrar(api, {
    tipo: 'pagamento_registrado', competencia, usuarioId, referenciaTipo: 'titulo', referenciaId: t.id,
    descricao: `Parcela ${parcela.numero} de "${t.descricao}": ${c.reais(valor)} em ${c.impressa(data)} (${forma})${extra}${comprovante ? ' — com comprovante' : ''}`,
    dados: { pagamento_id: pagamento.id, parcela_id: parcela.id }
  });
  return { pagamento: pagamentoPublico(pagamento), comprovante_id: comprovante, aviso };
}

async function estornar(api, pagamentoId, { motivo, usuarioId = null }) {
  const m = c.texto(motivo, 500);
  if (m.length < 5) throw c.erro('Diga o motivo do estorno (ao menos 5 letras).');
  const p = (await b.ler(api, 'titulo_pagar_pagamentos', { id: Number(pagamentoId) }))[0] || null;
  if (!p) throw c.erro('Pagamento não encontrado.', 404);
  if (!ativo(p)) throw c.erro('Este pagamento já foi estornado.', 409);
  await b.garantirAberta(api, p.competencia, 'estornar pagamentos nela');
  const t = await lerTitulo(api, p.titulo_id);
  await b.atualizar(api, 'titulo_pagar_pagamentos', p.id, { estornado_em: c.agora(), estornado_por: usuarioId, motivo_estorno: m });
  await eventos.registrar(api, {
    tipo: 'pagamento_estornado', competencia: p.competencia, usuarioId, referenciaTipo: 'titulo', referenciaId: t.id,
    descricao: `Pagamento de ${c.reais(p.valor_pago)} em ${c.impressa(p.data_pagamento)} de "${t.descricao}" estornado: ${m}`,
    dados: { pagamento_id: p.id, parcela_id: p.parcela_id }
  });
  return { id: p.id, estornado: true };
}

module.exports = {
  FORMAS, CATEGORIAS_SUGERIDAS, SITUACOES_PARCELA, SITUACOES_TITULO, VISOES,
  somarMesesNaData, gerarParcelas, conferirParcelas, validarTitulo, situacaoDaParcela, montarTitulo, visaoDaLista, totaisDaCompetencia,
  parcelasMudaram, categoriasDe,
  lerContatos, lerBase, montarTodos, categoriasDisponiveis, listar, detalhe, criar, editar, cancelar, pagar, estornar
};
