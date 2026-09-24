/**
 * Importar boletos que JÁ existem no Banco do Brasil.
 *
 * Boleto emitido antes do app (pelo Gerenciador Financeiro) não tem linha na
 * tabela `boletos`: não sai em PDF, não sincroniza, não aparece na parcela e o
 * aviso do webhook é jogado fora ("não é de um boleto deste sistema"). Aqui
 * eles entram como se o app tivesse gerado — com a marca `origem = 'importado'`.
 *
 * Duas entradas, um destino:
 *   1. a LISTA do BB (GET /boletos por faixa de vencimento) escolhida na tela;
 *   2. a LINHA DIGITÁVEL colada em "NF-e e boletos de fora": o nosso número
 *      sai do campo livre e, se for do nosso convênio, o boleto é buscado no
 *      BB (GET /boletos/{nosso número}) e importado de verdade.
 *
 * Depois de criar a linha, quem preenche o resto é a SINCRONIZAÇÃO
 * (boletoOperacoes.sincronizar): estado, valores, vencimento, pagamento e
 * linha digitável vêm do próprio BB — aqui não se adivinha nada.
 *
 * Regras (decisões do dono, 23/09/2026):
 *   - só em produção valendo (a mesma trava das outras ações de boleto);
 *   - o mesmo nosso número nunca entra duas vezes (UNIQUE ambiente+nosso_numero
 *     e `chave_idempotencia`): a linha aparece como "já importado";
 *   - depois de importar, `proximo_sequencial_producao` pula para o maior
 *     sequencial importado + 1, senão o próximo boleto gerado repete um número
 *     que já existe no BB;
 *   - boleto sem parcela entra do mesmo jeito, só sem vínculo, e pode ser
 *     ligado depois pela mesma tela.
 *
 * SQL: sql/boletos_importados.sql (coluna `origem`, `pedido_id`/`parcela_id`
 * aceitando nulo). Sem ele, a tela avisa e nada quebra.
 */
const configuracao = require('./configuracaoCobranca');
const boletos = require('./boletos');
const calculo = require('./boletoCalculo');
const operacoes = require('./boletoOperacoes');
const externas = require('../fiscal/externas');
const recebimentos = require('./recebimentos');

const SQL_ARQUIVO = 'sql/boletos_importados.sql';
const ORIGEM_APP = 'app';
const ORIGEM_IMPORTADO = 'importado';
/** A faixa padrão da busca: 12 meses atrás até 12 meses à frente (decisão do dono). */
const MESES_PARA_TRAS = 12;
const MESES_PARA_FRENTE = 12;
/** Quando o BB recusa a faixa inteira, ela é quebrada em pedaços deste tamanho. */
const DIAS_POR_PEDACO = 90;
const MAXIMO_DE_PAGINAS = 50;

const digitos = v => String(v ?? '').replace(/\D/g, '');
const lista = r => (Array.isArray(r) ? r : (r && typeof r === 'object' && !r.error ? [r] : []));

function erro(mensagem, status = 400, extra = null) {
  const e = new Error(mensagem);
  e.status = status;
  if (extra) e.extra = extra;
  return e;
}

/** O primeiro valor preenchido entre várias chaves possíveis da resposta do BB. */
function primeiro(objeto, chaves) {
  for (const chave of chaves) {
    const v = objeto?.[chave];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return null;
}

function numero(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** '01.10.2026' (BB) ou '2026-10-01' → '2026-10-01'. */
function dia(valor) {
  const t = String(valor ?? '').trim();
  const bb = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(t);
  if (bb) return `${bb[3]}-${bb[2]}-${bb[1]}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  return iso ? iso[0] : null;
}

/** 'YYYY-MM-DD' → 'dd.mm.yyyy', como o BB pede nos filtros. */
function diaParaBB(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

function somarDias(iso, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + Number(n)));
  return d.toISOString().slice(0, 10);
}

function somarMeses(iso, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]) - 1 + Number(n);
  const d = new Date(Date.UTC(ano, mes, 1));
  // Dia 31 num mês de 30: fica no último dia do mês, sem virar o mês seguinte.
  const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(Number(m[3]), ultimo));
  return d.toISOString().slice(0, 10);
}

/** A faixa de vencimento padrão da busca, a partir de hoje. Pura. */
function faixaPadrao(hoje) {
  return { de: somarMeses(hoje, -MESES_PARA_TRAS), ate: somarMeses(hoje, MESES_PARA_FRENTE) };
}

/** A faixa quebrada em pedaços de 90 dias (o BB recusa janelas muito largas). Pura. */
function pedacosDaFaixa(de, ate, dias = DIAS_POR_PEDACO) {
  const pedacos = [];
  let inicio = dia(de);
  const fim = dia(ate);
  if (!inicio || !fim || inicio > fim) return pedacos;
  while (inicio <= fim) {
    const proximo = somarDias(inicio, dias - 1);
    const parcial = proximo && proximo < fim ? proximo : fim;
    pedacos.push({ de: inicio, ate: parcial });
    inicio = somarDias(parcial, 1);
    if (pedacos.length > 40) break;
  }
  return pedacos;
}

// ------------------------------------------------------ nosso número

/**
 * O nosso número escondido no campo livre da linha digitável (convênio de 7
 * posições: 000000 + convênio + sequencial de 10 + carteira). Devolve null
 * quando o campo livre não tem esse formato ou é de outro convênio. Pura.
 */
function nossoNumeroDoCampoLivre(campoLivre, convenio) {
  const livre = digitos(campoLivre);
  const conv = digitos(convenio);
  if (livre.length !== 25 || conv.length !== 7) return null;
  if (livre.slice(0, 6) !== '000000') return null;
  const doBoleto = livre.slice(6, 13);
  if (doBoleto !== conv) return null;
  const sequencial = Number(livre.slice(13, 23));
  if (!Number.isInteger(sequencial) || sequencial <= 0) return null;
  const carteira = Number(livre.slice(23, 25));
  const nn = calculo.nossoNumero(conv, sequencial);
  return { nosso_numero: nn.numeroTituloCliente, dv: nn.dv, formatado: nn.formatado, sequencial, carteira, convenio: conv };
}

/** O sequencial de 10 dígitos dentro do nosso número de 20. Pura. */
function sequencialDoNossoNumero(nossoNumero) {
  const n = digitos(nossoNumero);
  if (n.length !== 20) return null;
  const seq = Number(n.slice(10));
  return Number.isInteger(seq) && seq > 0 ? seq : null;
}

// ------------------------------------------------------ leitura do BB

/**
 * Uma linha da lista do BB no formato da tela. O BB varia os nomes dos
 * campos entre a lista e o detalhe, então cada dado é procurado em várias
 * chaves; o que não vier fica null e a sincronização completa depois. Pura.
 */
function normalizarDoBB(item) {
  const bruto = item || {};
  const nossoNumero = digitos(primeiro(bruto, ['numeroBoletoBB', 'numeroTituloCliente', 'nossoNumero']));
  const documento = digitos(primeiro(bruto, ['numeroInscricaoSacado', 'numeroInscricaoPagador', 'cpfCnpjSacado']));
  return {
    nosso_numero: nossoNumero.length === 20 ? nossoNumero : (nossoNumero ? nossoNumero.padStart(20, '0') : null),
    seu_numero: String(primeiro(bruto, [
      'numeroTituloBeneficiario', 'numeroTituloCedenteCobranca', 'textoNumeroTituloBeneficiario', 'numeroDocumentoTituloCobranca'
    ]) || '').trim() || null,
    valor: numero(primeiro(bruto, ['valorOriginalTituloCobranca', 'valorOriginal', 'valorAtualTituloCobranca'])),
    valor_atual: numero(primeiro(bruto, ['valorAtualTituloCobranca', 'valorAtual'])),
    valor_pago: numero(primeiro(bruto, ['valorPagoSacado', 'valorPago'])),
    vencimento: dia(primeiro(bruto, ['dataVencimentoTituloCobranca', 'dataVencimento'])),
    emissao: dia(primeiro(bruto, ['dataRegistroTituloCobranca', 'dataEmissaoTituloCobranca', 'dataRegistro'])),
    codigo_estado: numero(primeiro(bruto, ['codigoEstadoTituloCobranca', 'codigoEstado'])),
    situacao_bb: String(primeiro(bruto, ['estadoTituloCobranca', 'textoEstadoTituloCobranca']) || '').trim() || null,
    pagador_nome: String(primeiro(bruto, ['nomeSacado', 'nomePagador', 'nomeRazaoSocialSacado']) || '').trim() || null,
    pagador_documento: documento || null,
    carteira: numero(primeiro(bruto, ['numeroCarteiraCobranca', 'codigoCarteiraCobranca', 'numeroCarteira'])),
    variacao: numero(primeiro(bruto, ['numeroVariacaoCarteiraCobranca', 'numeroVariacaoCarteira'])),
    bruto
  };
}

/** A situação que a tela mostra, mesmo quando o BB só mandou o código. Pura. */
function situacaoLegivel(linha) {
  if (linha?.situacao_bb) return linha.situacao_bb;
  const codigo = linha?.codigo_estado;
  if (codigo === null || codigo === undefined) return '—';
  return operacoes.ESTADOS_BB?.[codigo] || `ESTADO ${codigo}`;
}

// ------------------------------------------------------ sugestão da parcela

/** "PED120P1" → { pedido: 'PED120', parcela: 1 }; qualquer outra coisa, null. Pura. */
function lerSeuNumero(texto) {
  const m = /^([A-Za-z0-9-]*?)P(\d{1,3})$/.exec(String(texto ?? '').trim());
  if (!m || !m[1]) return null;
  return { pedido: m[1].toUpperCase(), parcela: Number(m[2]) };
}

const mesmoValor = (a, b) => a !== null && b !== null && Math.abs(Number(a) - Number(b)) <= 0.01;

/** Quantos dias separam dois dias ISO (null quando algum não é dia). Pura. */
function distanciaEmDias(a, b) {
  const x = Date.parse(`${a}T12:00:00Z`);
  const y = Date.parse(`${b}T12:00:00Z`);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return Math.round(Math.abs(x - y) / 86400000);
}

/**
 * Vencimento "quase igual": o boleto antigo às vezes foi registrado com a
 * data corrida para o dia útil seguinte, ou prorrogado no banco. Até esta
 * distância a parcela ainda é sugerida — mas com confiança MÉDIA, que não
 * vem marcada: quem confirma é o usuário.
 */
const DIAS_DE_FOLGA_NO_VENCIMENTO = 5;

/**
 * A parcela que combina com o boleto do BB. Devolve { parcela, pedido,
 * motivo, confianca } ou null. Pura.
 *
 * Ordem das regras (a primeira que fecha, ganha):
 *   1. o "seu número" no padrão do app (PED120P1) — confiança ALTA;
 *   2. documento do pagador + valor + vencimento — ALTA (o BB só manda o
 *      pagador no detalhe; na lista ele vem vazio, daí a regra 3);
 *   3. mesmo valor e mesmo vencimento, uma parcela só — ALTA;
 *   4. mesmo valor e vencimento a até 5 dias, uma parcela só — MÉDIA.
 *
 * Empate nunca vira sugestão: com duas parcelas iguais não há como escolher
 * e o palpite errado criaria recebimento no pedido errado.
 *
 * Confiança ALTA é o que a tela já deixa **marcado** (decisão do dono,
 * 24/09/2026): o valor e o dia batendo, marcar à mão um por um é trabalho à
 * toa. Importar, mesmo assim, só quando ele clicar.
 *
 * @param {object} p.candidatos { parcelas, pedidos, clientes, ocupadas }
 *   `ocupadas` são as parcelas que já têm boleto vivo: não se sugere cobrar
 *   duas vezes a mesma parcela.
 */
function sugerirParcela(linha, { parcelas = [], pedidos = [], clientes = [], ocupadas = new Set() } = {}) {
  const pedidoPorId = new Map(pedidos.map(p => [String(p.id), p]));
  const clientePorId = new Map(clientes.map(c => [String(c.id), c]));
  const doPedido = pedido => (pedido ? pedidoPorId.get(String(pedido)) || null : null);
  const nomeDoPedido = pedido => {
    const cliente = clientePorId.get(String(pedido?.cliente_id));
    return cliente?.nome_fantasia || cliente?.razao_social || cliente?.nome || null;
  };

  const seu = lerSeuNumero(linha?.seu_numero);
  if (seu) {
    const pedido = pedidos.find(p => String(p.numero || '').trim().toUpperCase() === seu.pedido) || null;
    const parcela = pedido
      ? parcelas.find(p => Number(p.pedido_id) === Number(pedido.id) && Number(p.numero_parcela) === seu.parcela) || null
      : null;
    if (parcela) return { parcela, pedido, motivo: `Seu número ${linha.seu_numero}: pedido ${pedido.numero}, parcela ${seu.parcela}.`, confianca: 'alta' };
  }

  // Só parcela livre e de pedido que não foi cancelado entra nas regras de
  // valor/vencimento — o resto não pode receber boleto de todo jeito.
  const livres = parcelas.filter(p => {
    if (ocupadas.has(String(p.id))) return false;
    const pedido = doPedido(p.pedido_id);
    if (!pedido) return false;
    return String(pedido.situacao || '').toLowerCase() !== 'cancelado';
  });
  const mesmoDia = livres.filter(p => mesmoValor(numero(p.valor), linha?.valor) && dia(p.data_vencimento) === linha?.vencimento);

  const doc = digitos(linha?.pagador_documento);
  if (doc) {
    const ids = new Set(clientes.filter(c => digitos(c.cnpj) === doc || digitos(c.cpf) === doc).map(c => String(c.id)));
    const doPagador = mesmoDia.filter(p => ids.has(String(doPedido(p.pedido_id)?.cliente_id)));
    if (doPagador.length === 1) {
      const pedido = doPedido(doPagador[0].pedido_id);
      return {
        parcela: doPagador[0], pedido, confianca: 'alta',
        motivo: `${nomeDoPedido(pedido) || 'O pagador'}, mesmo valor e mesmo vencimento (pedido ${pedido?.numero || '—'}).`
      };
    }
    if (doPagador.length > 1) return null;
  }

  if (mesmoDia.length === 1) {
    const pedido = doPedido(mesmoDia[0].pedido_id);
    return {
      parcela: mesmoDia[0], pedido, confianca: 'alta',
      motivo: `Mesmo valor e mesmo vencimento: pedido ${pedido?.numero || '—'}, parcela ${mesmoDia[0].numero_parcela}${nomeDoPedido(pedido) ? ` (${nomeDoPedido(pedido)})` : ''}.`
    };
  }
  if (mesmoDia.length > 1) return null;

  const perto = livres
    .map(p => ({ parcela: p, distancia: distanciaEmDias(dia(p.data_vencimento), linha?.vencimento) }))
    .filter(c => mesmoValor(numero(c.parcela.valor), linha?.valor) && c.distancia !== null && c.distancia <= DIAS_DE_FOLGA_NO_VENCIMENTO);
  if (perto.length === 1) {
    const pedido = doPedido(perto[0].parcela.pedido_id);
    const dias = perto[0].distancia;
    return {
      parcela: perto[0].parcela, pedido, confianca: 'media',
      motivo: `Mesmo valor, vencimento ${dias === 1 ? 'a 1 dia' : `a ${dias} dias`} de distância: pedido ${pedido?.numero || '—'}, parcela ${perto[0].parcela.numero_parcela}. Confira antes de importar.`
    };
  }
  return null;
}

// ------------------------------------------------------ banco de dados

/** A coluna da fase existe na linha lida? (sem o SQL, a tela avisa e não quebra) */
const sqlPronto = linha => Boolean(linha) && Object.prototype.hasOwnProperty.call(linha, 'origem');

function exigirSql(linha) {
  if (!sqlPronto(linha)) throw erro(`Falta rodar ${SQL_ARQUIVO} no banco e reiniciar a API para importar boletos.`, 409, { sql_pendente: true, arquivo: SQL_ARQUIVO });
}

/**
 * O SQL da fase já rodou? Só dá para saber olhando uma linha que exista —
 * numa tabela vazia a resposta é "não sei", e a importação segue (o banco
 * recusaria a coluna que não existe, e o erro apareceria na tela).
 */
async function estadoDoSql(api) {
  const algum = await api.get('/api/boletos').then(lista).catch(() => []);
  if (!algum.length) return { pronto: true, desconhecido: true };
  return { pronto: sqlPronto(algum[0]), desconhecido: false };
}

/**
 * Os boletos já gravados cujo nosso número está na lista.
 *
 * `gravados` evita reler a tabela quando quem chama já a tem na mão (a tela
 * da importação precisa dela também para saber quais parcelas estão
 * ocupadas).
 */
async function jaImportados(api, ambiente, nossosNumeros = [], gravados = null) {
  const alvo = new Set(nossosNumeros.filter(Boolean).map(String));
  if (!alvo.size) return new Map();
  const todos = gravados || await api.get('/api/boletos', { query: { ambiente } }).then(lista).catch(() => []);
  const mapa = new Map();
  for (const b of todos) {
    if (String(b?.ambiente) !== String(ambiente)) continue;
    const nn = String(b?.nosso_numero || '');
    if (alvo.has(nn)) mapa.set(nn, b);
  }
  return mapa;
}

// ------------------------------------------------------ lista do BB

/**
 * Os boletos da conta no BB, na faixa de vencimento pedida. Pagina enquanto o
 * BB disser que há continuidade e, se ele recusar a faixa inteira, quebra em
 * pedaços de 90 dias.
 *
 * @returns {{ boletos: Array, paginas: number, pedacos: number, aviso: string|null }}
 */
async function listarNoBB({ bb, conexao, conta, situacao = 'A', de, ate }) {
  const convenio = digitos(conta?.convenio);
  const base = {
    indicadorSituacao: situacao === 'B' ? 'B' : 'A',
    agenciaBeneficiario: digitos(conta?.agencia),
    contaBeneficiario: digitos(conta?.conta),
    ...(convenio ? { numeroConvenio: convenio } : {})
  };

  async function umaFaixa(inicio, fim) {
    const achados = [];
    let indice = null;
    for (let pagina = 0; pagina < MAXIMO_DE_PAGINAS; pagina += 1) {
      const query = {
        ...base,
        dataInicioVencimento: diaParaBB(inicio),
        dataFimVencimento: diaParaBB(fim),
        ...(indice ? { indicadorContinuidade: 'S', proximoIndice: indice } : {})
      };
      let resposta;
      try {
        resposta = await bb.chamar({ ...conexao, metodo: 'GET', caminho: '/boletos', query });
      } catch (e) {
        // "Nenhum boleto" volta como 404 na API de Cobranças: lista vazia.
        if (e?.extra?.http === 404) break;
        throw e;
      }
      achados.push(...lista(resposta?.boletos ?? resposta));
      const continua = String(resposta?.indicadorContinuidade || '').toUpperCase() === 'S';
      indice = continua ? (resposta?.proximoIndice ?? resposta?.indice ?? null) : null;
      if (!indice) break;
    }
    return achados;
  }

  const inicio = dia(de);
  const fim = dia(ate);
  if (!inicio || !fim) throw erro('Informe a faixa de vencimento (de e até).');
  if (inicio > fim) throw erro('A faixa de vencimento está invertida: a data inicial é depois da final.');

  let brutos;
  let pedacos = 1;
  let aviso = null;
  try {
    brutos = await umaFaixa(inicio, fim);
  } catch (e) {
    // O BB limita o tamanho da janela em algumas contas: tenta em pedaços.
    if (e?.status === 409 || e?.extra?.http === 404) throw e;
    const partes = pedacosDaFaixa(inicio, fim);
    if (partes.length <= 1) throw e;
    brutos = [];
    for (const parte of partes) brutos.push(...await umaFaixa(parte.de, parte.ate));
    pedacos = partes.length;
    aviso = `O BB recusou a faixa inteira; a busca foi feita em ${partes.length} pedaços de ${DIAS_POR_PEDACO} dias.`;
  }

  const vistos = new Set();
  const linhas = [];
  for (const item of brutos) {
    const linha = normalizarDoBB(item);
    if (!linha.nosso_numero || vistos.has(linha.nosso_numero)) continue;
    vistos.add(linha.nosso_numero);
    linhas.push(linha);
  }
  linhas.sort((a, b) => String(a.vencimento || '').localeCompare(String(b.vencimento || '')));
  return { boletos: linhas, paginas: linhas.length ? 1 : 0, pedacos, aviso };
}

/**
 * A lista pronta para a tela: cada boleto do BB com a parcela sugerida e a
 * marca de quem já está no app.
 */
async function listarParaImportar({ api, bb, conexao, cfg, ambiente, situacao, de, ate, pedidoId = null }) {
  const conta = configuracao.dadosDaConta(cfg, ambiente);
  const { boletos: doBB, aviso, pedacos } = await listarNoBB({ bb, conexao, conta, situacao, de, ate });

  const [parcelas, pedidos, clientes, gravados, pagas] = await Promise.all([
    api.get('/api/pedido_parcelas').then(lista).catch(() => []),
    api.get('/api/pedidos').then(lista).catch(() => []),
    api.get('/api/clientes').then(lista).catch(() => []),
    api.get('/api/boletos').then(lista).catch(() => []),
    parcelasPagas(api)
  ]);
  const sql = gravados.length ? { pronto: sqlPronto(gravados[0]), desconhecido: false } : { pronto: true, desconhecido: true };
  const existentes = await jaImportados(api, ambiente, doBB.map(b => b.nosso_numero), gravados);
  // Parcela que já tem boleto vivo não entra na sugestão: ninguém cobra a
  // mesma parcela duas vezes, e o `vincular` recusaria assim mesmo.
  const ocupadas = new Set(gravados.filter(b => boletos.ocupaParcela(b)).map(b => String(b.parcela_id)));
  // Parcela já paga (Pix, cartão…) também não: não se cobra o que já entrou.
  for (const p of parcelas) if (pagas.has(chaveDaParcela(p))) ocupadas.add(String(p.id));

  const doPedido = pedidoId ? pedidos.find(p => Number(p.id) === Number(pedidoId)) || null : null;
  const linhas = doBB.map(linha => {
    const existente = existentes.get(linha.nosso_numero) || null;
    const sugestao = existente ? null : sugerirParcela(linha, { parcelas, pedidos, clientes, ocupadas });
    return {
      ...linha,
      situacao_texto: situacaoLegivel(linha),
      sequencial: sequencialDoNossoNumero(linha.nosso_numero),
      ja_importado: Boolean(existente),
      boleto_id: existente?.id ?? null,
      boleto_status: existente?.status ?? null,
      boleto_origem: existente?.origem ?? null,
      sugestao: sugestao
        ? {
          parcela_id: sugestao.parcela.id, numero_parcela: sugestao.parcela.numero_parcela,
          pedido_id: sugestao.pedido?.id ?? null, pedido_numero: sugestao.pedido?.numero ?? null,
          motivo: sugestao.motivo, confianca: sugestao.confianca
        }
        : null
    };
  });

  // Aberto no Visualizar pedido: os do pedido primeiro, o resto continua à mão.
  const doPedidoPrimeiro = doPedido
    ? [...linhas].sort((a, b) => Number(b.sugestao?.pedido_id === doPedido.id) - Number(a.sugestao?.pedido_id === doPedido.id))
    : linhas;

  return {
    ambiente,
    conta: { agencia: conta.agencia, conta: conta.conta, convenio: conta.convenio, teste: conta.teste },
    situacao: situacao === 'B' ? 'B' : 'A',
    de, ate, pedacos, aviso,
    sql_pendente: !sql.pronto,
    sql_arquivo: SQL_ARQUIVO,
    pedido: doPedido ? { id: doPedido.id, numero: doPedido.numero } : null,
    boletos: doPedidoPrimeiro,
    resumo: {
      total: linhas.length,
      ja_importados: linhas.filter(l => l.ja_importado).length,
      com_sugestao: linhas.filter(l => l.sugestao).length,
      // Os que a tela já entrega marcados: valor e vencimento batem com uma
      // parcela só. O resto o usuário resolve à mão.
      certos: linhas.filter(l => l.sugestao?.confianca === 'alta').length,
      a_conferir: linhas.filter(l => l.sugestao?.confianca === 'media').length
    }
  };
}

/**
 * Os pedidos e parcelas que a tela oferece para relacionar um boleto à mão:
 * busca pelo número do pedido ou pelo nome do cliente. Traz no máximo 20
 * pedidos — a tela é para escolher, não para navegar o cadastro inteiro.
 */
async function parcelasParaEscolher({ api, busca = '', pedidoId = null, limite = 20 }) {
  const termo = String(busca || '').trim().toLowerCase();
  const [pedidos, parcelas, clientes, comBoleto, pagas] = await Promise.all([
    api.get('/api/pedidos').then(lista).catch(() => []),
    api.get('/api/pedido_parcelas').then(lista).catch(() => []),
    api.get('/api/clientes').then(lista).catch(() => []),
    api.get('/api/boletos').then(lista).catch(() => []),
    parcelasPagas(api)
  ]);
  const nomeDoCliente = new Map(clientes.map(c => [String(c.id), c.nome_fantasia || c.razao_social || c.nome || '']));
  const ocupadas = new Set(comBoleto.filter(b => boletos.ocupaParcela(b)).map(b => String(b.parcela_id)));

  const escolhidos = pedidos.filter(p => {
    if (pedidoId) return Number(p.id) === Number(pedidoId);
    if (String(p.situacao || '').toLowerCase() === 'cancelado') return false;
    if (!termo) return true;
    const cliente = nomeDoCliente.get(String(p.cliente_id)) || '';
    return String(p.numero || '').toLowerCase().includes(termo) || cliente.toLowerCase().includes(termo);
  })
    .sort((a, b) => Number(b.id) - Number(a.id))
    .slice(0, limite);

  return {
    pedidos: escolhidos.map(p => ({
      id: p.id, numero: p.numero, situacao: p.situacao,
      cliente: nomeDoCliente.get(String(p.cliente_id)) || null,
      parcelas: parcelas
        .filter(pa => Number(pa.pedido_id) === Number(p.id))
        .sort((a, b) => Number(a.numero_parcela) - Number(b.numero_parcela))
        .map(pa => ({
          id: pa.id, numero_parcela: pa.numero_parcela, valor: numero(pa.valor),
          data_vencimento: dia(pa.data_vencimento), ocupada: ocupadas.has(String(pa.id)),
          // Paga (Pix, cartão…): a tela mostra, mas não deixa escolher.
          paga: pagas.has(chaveDaParcela(pa))
        }))
    }))
  };
}

// ------------------------------------------------ pela linha digitável

/** O boleto no BB pelo nosso número, ou null quando o banco não o conhece. */
async function consultarNoBB({ bb, conexao, nossoNumero, convenio }) {
  const nn = digitos(nossoNumero);
  try {
    const detalhe = await bb.chamar({ ...conexao, metodo: 'GET', caminho: `/boletos/${nn}`, query: { numeroConvenio: digitos(convenio) } });
    return { ...normalizarDoBB(detalhe), nosso_numero: nn };
  } catch (e) {
    if (e?.extra?.http === 404) return null;
    throw e;
  }
}

/**
 * A linha digitável colada em "NF-e e boletos de fora" é do NOSSO convênio no
 * BB? Então ela não é "de fora": o boleto existe lá e entra importado, com
 * PDF, sincronização e webhook (decisão do dono, 23/09/2026).
 *
 * Devolve, para cada entrada, `{ parcela_id, linha, no_bb, doBB, erro }`:
 *   - `no_bb: true`  → importar (o chamador decide se é prévia ou gravação);
 *   - `no_bb: false` → segue o caminho de sempre, como boleto de fora;
 *   - `erro`         → parece nosso, mas o BB não respondeu: não adivinha.
 */
async function reconhecerLinhas({ bb, conexao, cfg, ambiente, linhas = [], hoje }) {
  const conta = configuracao.dadosDaConta(cfg, ambiente);
  const saida = [];
  for (const entrada of Array.isArray(linhas) ? linhas : []) {
    const item = { parcela_id: entrada?.parcela_id ?? null, linha: entrada?.linha, no_bb: false, doBB: null, erro: null };
    let lido = null;
    try {
      lido = externas.lerLinhaDigitavel(entrada?.linha, hoje);
    } catch (_) {
      // Linha que nem é boleto: o caminho de fora explica o erro com detalhe.
      saida.push(item);
      continue;
    }
    const nosso = lido.banco === '001' ? nossoNumeroDoCampoLivre(lido.campo_livre, conta.convenio) : null;
    if (!nosso) { saida.push(item); continue; }
    try {
      const doBB = await consultarNoBB({ bb, conexao, nossoNumero: nosso.nosso_numero, convenio: conta.convenio });
      if (doBB) {
        item.no_bb = true;
        item.doBB = { ...doBB, vencimento: doBB.vencimento || lido.vencimento, valor: doBB.valor ?? lido.valor, carteira: doBB.carteira ?? nosso.carteira };
      }
    } catch (e) {
      item.erro = `Este boleto é do convênio ${conta.convenio} (o seu, no BB), mas a consulta ao banco falhou: ${e.message} Tente de novo em instantes.`;
    }
    saida.push(item);
  }
  return saida;
}

/**
 * O caminho de "NF-e e boletos de fora" com a importação no meio: a linha que
 * for do nosso convênio no BB entra como boleto DE VERDADE (com PDF,
 * sincronização e webhook); o resto segue como boleto de fora, como sempre.
 *
 * A resposta tem o mesmo formato do de fora (`resultados` por parcela), com
 * `no_bb: true` nas que vieram do banco — é o que a tela mostra como
 * "reconhecido no BB".
 */
async function informarPelaLinha({
  api, bb, conexao, cfg, ambiente, pedidoId, linhas = [], apenasPrevia = false,
  usuarioId = null, hoje, ocupadaPeloBB = () => false, informarDeFora
}) {
  const entradas = (Array.isArray(linhas) ? linhas : []).filter(l => digitos(l?.linha));
  const reconhecidas = conexao
    ? await reconhecerLinhas({ bb, conexao, cfg, ambiente, linhas: entradas, hoje })
    : entradas.map(l => ({ parcela_id: l?.parcela_id ?? null, linha: l?.linha, no_bb: false, doBB: null, erro: null }));

  const parcelas = await api.get('/api/pedido_parcelas', { query: { pedido_id: pedidoId } }).then(lista).catch(() => []);
  const daParcela = id => parcelas.find(p => Number(p.id) === Number(id)) || null;
  const pedido = await api.get('/api/pedidos', { query: { id: pedidoId } }).then(r => lista(r)[0] || null).catch(() => null);

  const resultados = [];
  const paraFora = [];
  for (const item of reconhecidas) {
    const parcela = daParcela(item.parcela_id);
    const base = { parcela_id: item.parcela_id, numero_parcela: parcela?.numero_parcela ?? null };
    if (item.erro) { resultados.push({ ...base, ok: false, erro: item.erro }); continue; }
    if (!item.no_bb) { paraFora.push({ parcela_id: item.parcela_id, linha: item.linha }); continue; }
    if (!parcela) { resultados.push({ ...base, ok: false, erro: 'Parcela não encontrada neste pedido.' }); continue; }

    const aviso = `Reconhecido no Banco do Brasil (nosso número ${item.doBB.nosso_numero}): entra como boleto de verdade, com PDF e aviso de pagamento — não como boleto de fora.`;
    if (apenasPrevia) {
      resultados.push({
        ...base, ok: true, no_bb: true, avisos: [aviso],
        boleto: {
          nosso_numero: item.doBB.nosso_numero, valor: item.doBB.valor, vencimento: item.doBB.vencimento,
          banco: '001', banco_nome: 'Banco do Brasil', situacao_bb: situacaoLegivel(item.doBB), seu_numero: item.doBB.seu_numero
        }
      });
      continue;
    }
    try {
      const r = await importarUm({
        api, bb, conexao, cfg, ambiente, doBB: item.doBB, usuarioId, hoje,
        vinculo: { pedido_id: Number(pedidoId), parcela_id: parcela.id, numero_parcela: parcela.numero_parcela, pedido_numero: pedido?.numero || null }
      });
      resultados.push({ ...base, ok: true, no_bb: true, ja_existia: r.ja_existia, boleto: r.boleto, avisos: [aviso, ...(r.avisos || [])] });
    } catch (e) {
      resultados.push({ ...base, ok: false, erro: `Reconhecido no BB, mas a importação falhou: ${e.message}` });
    }
  }

  let deFora = { resultados: [] };
  if (paraFora.length) {
    deFora = await informarDeFora({ linhas: paraFora, apenasPrevia });
    resultados.push(...(deFora.resultados || []));
  }

  // A ordem da tela é a das parcelas mandadas.
  const posicao = new Map(entradas.map((l, i) => [String(l.parcela_id), i]));
  resultados.sort((a, b) => (posicao.get(String(a.parcela_id)) ?? 0) - (posicao.get(String(b.parcela_id)) ?? 0));
  return {
    ...deFora,
    resultados,
    importados: resultados.filter(r => r.no_bb && r.ok && !r.ja_existia).length,
    reconhecidos_no_bb: resultados.filter(r => r.no_bb).length
  };
}

// ------------------------------------------------------ importação

/** A linha do banco a partir do que o BB contou. Pura. */
function linhaDoBoleto({ doBB, ambiente, cfg, conta, vinculo = {}, usuarioId = null, agora = new Date().toISOString() }) {
  const sequencial = sequencialDoNossoNumero(doBB.nosso_numero);
  return {
    pedido_id: vinculo.pedido_id ?? null,
    parcela_id: vinculo.parcela_id ?? null,
    numero_parcela: vinculo.numero_parcela ?? null,
    nota_fiscal_id: null,
    ambiente,
    convenio: String(conta.convenio || ''),
    carteira: Number(doBB.carteira || conta.carteira) || null,
    variacao: Number(doBB.variacao || conta.variacao) || null,
    sequencial,
    nosso_numero: doBB.nosso_numero,
    nosso_numero_dv: sequencial ? calculo.nossoNumero(conta.convenio, sequencial).dv : null,
    numero_documento: doBB.seu_numero || null,
    valor: doBB.valor ?? doBB.valor_atual ?? null,
    data_emissao: doBB.emissao || null,
    data_vencimento: doBB.vencimento || null,
    pagador: doBB.pagador_nome || doBB.pagador_documento
      ? { nome: doBB.pagador_nome, documento: doBB.pagador_documento }
      : null,
    // Entra como registrado: a sincronização logo em seguida traz o estado,
    // o pagamento e o vencimento que valem no BB.
    status: 'registrado',
    situacao_bb: doBB.situacao_bb || null,
    codigo_estado_bb: doBB.codigo_estado ?? null,
    origem: ORIGEM_IMPORTADO,
    erro: null,
    requisicao: null,
    resposta: doBB.bruto || null,
    chave_idempotencia: `${ambiente}:${doBB.nosso_numero}`,
    criado_por: usuarioId,
    criado_em: agora,
    atualizado_em: agora
  };
}

/** O maior sequencial entre os importados + 1, quando passa do que a configuração tem. Pura. */
function sequencialDepoisDaImportacao(cfg, ambiente, sequenciais = []) {
  const atual = configuracao.proximoSequencial(cfg, ambiente);
  const maior = sequenciais.map(Number).filter(n => Number.isInteger(n) && n > 0).reduce((a, b) => Math.max(a, b), 0);
  return maior >= atual ? maior + 1 : null;
}

/**
 * Boleto importado JÁ PAGO cuja parcela tinha um recebimento lançado à mão: o
 * lançamento de quem digitou continua valendo (o app nunca deixa dois na
 * mesma parcela). O que muda é o aviso — se o BB cobrou outro valor ou pagou
 * noutro dia, isso precisa aparecer para conferência (decisão do dono,
 * 23/09/2026). Pura.
 */
function avisosDoRecebimentoQueJaExistia(boleto, resultado) {
  const r = resultado?.recebimento;
  if (!resultado?.ja_existia || !r || r.origem === 'boleto') return [];
  const avisos = [`A parcela já tinha um recebimento lançado à mão (${r.origem === 'manual' ? 'manual' : r.origem}): ele continua valendo e nada foi lançado em dobro.`];
  const pago = numero(boleto?.valor_pago);
  const lancado = numero(r.valor_recebido);
  if (pago !== null && lancado !== null && Math.abs(pago - lancado) > 0.01) {
    avisos.push(`Confira o valor: o BB recebeu R$ ${pago.toFixed(2).replace('.', ',')} e o lançamento à mão diz R$ ${lancado.toFixed(2).replace('.', ',')}.`);
  }
  const pagoEm = dia(boleto?.data_pagamento);
  const lancadoEm = dia(r.data_recebimento);
  if (pagoEm && lancadoEm && pagoEm !== lancadoEm) {
    avisos.push(`Confira a data: o BB pagou em ${pagoEm.split('-').reverse().join('/')} e o lançamento à mão diz ${lancadoEm.split('-').reverse().join('/')}.`);
  }
  return avisos;
}

/**
 * Traz UM boleto do BB para a tabela `boletos` e sincroniza em seguida.
 * Nunca lança por causa da sincronização: o boleto fica importado e o aviso
 * volta na resposta.
 */
async function importarUm({ api, bb, conexao, cfg, ambiente, doBB, vinculo = {}, usuarioId = null, hoje }) {
  const conta = configuracao.dadosDaConta(cfg, ambiente);
  const jaEsta = await jaImportados(api, ambiente, [doBB.nosso_numero]);
  const existente = jaEsta.get(doBB.nosso_numero);
  if (existente) {
    return { ok: true, ja_existia: true, nosso_numero: doBB.nosso_numero, boleto: boletos.enxuto(existente) };
  }

  // Parcela já paga (Pix, cartão…) não recebe boleto (decisão do dono,
  // 24/09/2026): importe sem relacionar ou estorne o pagamento antes.
  if (vinculo.pedido_id && vinculo.numero_parcela) {
    const pagas = await parcelasPagas(api, { pedido_id: vinculo.pedido_id });
    if (pagas.has(`${Number(vinculo.pedido_id)}:${Number(vinculo.numero_parcela)}`)) {
      throw erro(`A parcela ${vinculo.numero_parcela} do pedido ${vinculo.pedido_numero || vinculo.pedido_id} já tem pagamento registrado: estorne-o em "Pagamentos" ou importe sem relacionar.`, 409);
    }
  }

  const linha = linhaDoBoleto({ doBB, ambiente, cfg, conta, vinculo, usuarioId });
  let criado;
  try {
    criado = await api.post('/api/boletos', linha);
  } catch (e) {
    // Corrida com outra máquina: o UNIQUE do banco decide e o boleto já está lá.
    const jaDeNovo = await jaImportados(api, ambiente, [doBB.nosso_numero]);
    const achado = jaDeNovo.get(doBB.nosso_numero);
    if (achado) return { ok: true, ja_existia: true, nosso_numero: doBB.nosso_numero, boleto: boletos.enxuto(achado) };
    throw e;
  }
  const id = criado?.id ?? criado?.data?.id ?? criado?.[0]?.id ?? null;
  if (!id) throw erro('A API não devolveu o id do boleto importado.', 502);
  let boleto = { ...linha, ...(criado && typeof criado === 'object' && !Array.isArray(criado) ? criado : {}), id };

  await boletos.registrarEvento(api, id, {
    origem: 'importacao', tipo: 'importado', nosso_numero: doBB.nosso_numero,
    mensagem: `Importado do Banco do Brasil${vinculo.pedido_id ? ` e ligado à parcela ${vinculo.numero_parcela} do pedido ${vinculo.pedido_numero || vinculo.pedido_id}` : ' sem parcela vinculada'}.`,
    payload: doBB.bruto || null, usuario_id: usuarioId
  });

  const avisos = [];
  let sincronizado = null;
  try {
    sincronizado = await operacoes.sincronizar({ api, bb, conexao, boleto, cfg, hoje, usuarioId, origem: 'importacao' });
    boleto = sincronizado.boleto;
    avisos.push(...(sincronizado.avisos || []));
    avisos.push(...avisosDoRecebimentoQueJaExistia(boleto, sincronizado.recebimento));
  } catch (e) {
    avisos.push(`Importado, mas a consulta ao BB não respondeu agora: ${e.message}`);
  }

  return {
    ok: true, ja_existia: false, nosso_numero: doBB.nosso_numero,
    boleto: boletos.enxuto(boleto), avisos,
    divergencias: sincronizado?.divergencias || [],
    recebimento: sincronizado?.recebimento || null
  };
}

/**
 * Os dados que valem dos boletos escolhidos na tela, lidos do BB de novo: o
 * que a tela mandou é só a escolha, nunca a fonte. Uma busca pela faixa
 * resolve todos de uma vez; o que faltar é consultado um a um.
 *
 * @returns {Map<string, object>} nosso número → boleto do BB
 */
async function buscarEscolhidos({ bb, conexao, cfg, ambiente, escolhidos = [], situacao = 'A', de = null, ate = null }) {
  const conta = configuracao.dadosDaConta(cfg, ambiente);
  const querem = [...new Set(escolhidos.map(e => digitos(e?.nosso_numero)).filter(nn => nn.length === 20))];
  const mapa = new Map();
  if (!querem.length) return mapa;

  if (dia(de) && dia(ate)) {
    try {
      const { boletos: achados } = await listarNoBB({ bb, conexao, conta, situacao, de, ate });
      for (const b of achados) if (querem.includes(b.nosso_numero)) mapa.set(b.nosso_numero, b);
    } catch (_) { /* a consulta um a um resolve abaixo */ }
  }
  for (const nn of querem) {
    if (mapa.has(nn)) continue;
    const doBB = await consultarNoBB({ bb, conexao, nossoNumero: nn, convenio: conta.convenio });
    if (doBB) mapa.set(nn, doBB);
  }
  return mapa;
}

/**
 * Importa os boletos escolhidos na tela. Cada um responde por si — um erro
 * não impede os outros — e, no fim, o sequencial da configuração pula para
 * depois do maior nosso número importado.
 *
 * @param {Array} escolhidos [{ nosso_numero, pedido_id?, parcela_id?, numero_parcela? }]
 */
async function importar({ api, bb, conexao, cfg, ambiente, escolhidos = [], doBB = new Map(), usuarioId = null, hoje }) {
  const sql = await estadoDoSql(api);
  if (!sql.pronto) {
    throw erro(`Falta rodar ${SQL_ARQUIVO} no banco e reiniciar a API para importar boletos.`, 409, { sql_pendente: true, arquivo: SQL_ARQUIVO });
  }
  const resultados = [];
  const sequenciais = [];
  for (const escolha of escolhidos) {
    const nn = digitos(escolha?.nosso_numero);
    const dados = doBB.get(nn) || null;
    if (!dados) {
      resultados.push({ ok: false, nosso_numero: nn || null, erro: 'Boleto não está mais na lista do BB. Busque de novo.' });
      continue;
    }
    try {
      const r = await importarUm({
        api, bb, conexao, cfg, ambiente, doBB: dados, usuarioId, hoje,
        vinculo: {
          pedido_id: escolha.pedido_id ?? null,
          parcela_id: escolha.parcela_id ?? null,
          numero_parcela: escolha.numero_parcela ?? null,
          pedido_numero: escolha.pedido_numero ?? null
        }
      });
      if (!r.ja_existia) sequenciais.push(sequencialDoNossoNumero(nn));
      resultados.push(r);
    } catch (e) {
      resultados.push({ ok: false, nosso_numero: nn, erro: e.message, status: e.status || 500 });
    }
  }

  let sequencialNovo = null;
  const campo = ambiente === configuracao.PRODUCAO ? 'proximo_sequencial_producao' : 'proximo_sequencial_sandbox';
  const proximo = sequencialDepoisDaImportacao(cfg, ambiente, sequenciais);
  if (proximo) {
    try {
      await configuracao.gravar(api, { [campo]: proximo }, usuarioId);
      sequencialNovo = proximo;
    } catch (e) {
      resultados.push({ ok: false, nosso_numero: null, erro: `Os boletos entraram, mas o próximo sequencial não foi atualizado: ${e.message}` });
    }
  }

  return {
    resultados,
    importados: resultados.filter(r => r.ok && !r.ja_existia).length,
    ja_existiam: resultados.filter(r => r.ok && r.ja_existia).length,
    erros: resultados.filter(r => !r.ok).length,
    proximo_sequencial: sequencialNovo
  };
}

/**
 * As parcelas já PAGAS (Pix, cartão, boleto, quitação por fora), como
 * "pedido:parcela": não recebem boleto importado (decisão do dono,
 * 24/09/2026). Sem a tabela de recebimentos, nenhuma.
 */
async function parcelasPagas(api, query = {}) {
  const recs = await api.get('/api/recebimentos', { query }).then(lista).catch(() => []);
  return new Set(recs.filter(r => r && r.status === 'confirmado').map(r => `${Number(r.pedido_id)}:${Number(r.numero_parcela)}`));
}
const chaveDaParcela = p => `${Number(p?.pedido_id)}:${Number(p?.numero_parcela)}`;

/**
 * Os recebimentos confirmados que vieram deste boleto (pago no banco ou
 * quitado por fora): eles mudam de parcela junto com o boleto.
 */
async function recebimentosDoBoleto(api, boleto) {
  if (!boleto?.pedido_id) return [];
  let doPedido = [];
  try {
    doPedido = await recebimentos.lerTodos(api, { pedido_id: boleto.pedido_id });
  } catch (e) {
    if (!e?.extra?.sql_pendente) throw e;
  }
  return doPedido.filter(r => r && r.status === 'confirmado' && Number(r.boleto_id) === Number(boleto.id));
}

// A trava da comissão fechada mora em recebimentos.js (a edição do pagamento usa a mesma).
const comissaoFechadaCom = (api, recs) => recebimentos.comissaoFechadaCom(api, recs);

const competenciaImpressa = comp => String(comp || '').split('-').reverse().join('/');

/**
 * Relaciona um boleto importado a outra parcela — ou o solta, sem parcela.
 * Serve para corrigir o boleto colado na parcela errada (decisão do dono,
 * 24/09/2026):
 *   - MUDAR de parcela leva junto o pagamento que veio dele (o recebimento
 *     troca de parcela): a parcela nova fica paga e a antiga volta a ficar
 *     em aberto. A parcela nova não pode ter boleto vivo, boleto de fora nem
 *     pagamento;
 *   - SOLTAR só o boleto que ainda não foi pago (o pago muda de parcela);
 *   - nos dois casos, o pagamento que já entrou numa competência de comissão
 *     FECHADA trava a mudança, com a explicação.
 * Boleto que o app gerou não passa por aqui: ele nasce na parcela certa.
 */
async function vincular({ api, boleto, pedidoId = null, parcelaId = null, usuarioId = null }) {
  exigirSql(boleto);
  if (String(boleto.origem) !== ORIGEM_IMPORTADO) {
    throw erro('Só boleto importado do BB pode trocar de parcela por aqui.', 409);
  }
  const recs = await recebimentosDoBoleto(api, boleto);
  const pago = String(boleto.status) === 'pago' || recs.length > 0;

  if (!pedidoId || !parcelaId) {
    if (pago) throw erro('Este boleto já foi pago: em vez de soltá-lo, mude-o para a parcela certa (o pagamento vai junto).', 409);
    const limpo = await boletos.atualizarBoleto(api, boleto, { pedido_id: null, parcela_id: null, numero_parcela: null });
    await boletos.registrarEvento(api, boleto.id, {
      origem: 'importacao', tipo: 'desvinculado', nosso_numero: boleto.nosso_numero,
      mensagem: 'Boleto importado ficou sem parcela vinculada.', usuario_id: usuarioId
    });
    return { boleto: boletos.enxuto(limpo) };
  }

  const [parcelas, pedidos] = await Promise.all([
    api.get('/api/pedido_parcelas', { query: { pedido_id: pedidoId } }).then(lista).catch(() => []),
    api.get('/api/pedidos', { query: { id: pedidoId } }).then(lista).catch(() => [])
  ]);
  const parcela = parcelas.find(p => Number(p.id) === Number(parcelaId) && Number(p.pedido_id) === Number(pedidoId)) || null;
  if (!parcela) throw erro('Parcela não encontrada neste pedido.', 404);
  if (Number(boleto.parcela_id) === Number(parcela.id)) throw erro(`O boleto já está na parcela ${parcela.numero_parcela}.`, 409);

  const [doPedido, externos, recsDestino] = await Promise.all([
    api.get('/api/boletos', { query: { pedido_id: pedidoId } }).then(lista).catch(() => []),
    externas.listarBoletos(api, pedidoId).catch(() => []),
    recebimentos.lerTodos(api, { pedido_id: pedidoId }).catch(() => [])
  ]);
  const ocupada = doPedido.find(b => Number(b.parcela_id) === Number(parcelaId) && Number(b.id) !== Number(boleto.id) && boletos.ocupaParcela(b));
  if (ocupada) throw erro(`A parcela ${parcela.numero_parcela} já tem o boleto ${ocupada.nosso_numero} (${ocupada.status}).`, 409);
  if (externas.boletoExternoDaParcela(externos, parcela)) {
    throw erro(`A parcela ${parcela.numero_parcela} tem boleto de fora: remova-o antes de trazer este para ela.`, 409);
  }
  const pagaNoDestino = recsDestino.find(r => r && r.status === 'confirmado' && Number(r.numero_parcela) === Number(parcela.numero_parcela)
    && !recs.some(x => Number(x.id) === Number(r.id)));
  if (pagaNoDestino) throw erro(`A parcela ${parcela.numero_parcela} já tem pagamento registrado: estorne-o antes, se foi engano.`, 409);

  const fechada = await comissaoFechadaCom(api, recs);
  if (fechada) {
    throw erro(`O pagamento deste boleto já entrou na comissão de ${competenciaImpressa(fechada.competencia)}, que está fechada: mudar de parcela desmancharia o fechamento.`, 409);
  }

  const pedido = pedidos.find(p => Number(p.id) === Number(pedidoId)) || null;
  const antes = boleto.numero_parcela;
  const atualizado = await boletos.atualizarBoleto(api, boleto, {
    pedido_id: Number(pedidoId), parcela_id: Number(parcelaId), numero_parcela: parcela.numero_parcela
  });
  // O pagamento vai junto: a parcela nova fica paga e a antiga volta a ficar em aberto.
  for (const r of recs) {
    await api.put(`/api/recebimentos/${r.id}`, {
      pedido_id: Number(pedidoId), parcela_id: Number(parcelaId), numero_parcela: parcela.numero_parcela,
      atualizado_em: new Date().toISOString()
    });
  }
  const deOnde = antes ? `da parcela ${antes} para a parcela ${parcela.numero_parcela}` : `à parcela ${parcela.numero_parcela}`;
  await boletos.registrarEvento(api, boleto.id, {
    origem: 'importacao', tipo: 'vinculado', nosso_numero: boleto.nosso_numero,
    mensagem: `Ligado ${deOnde} do pedido ${pedido?.numero || pedidoId}.${recs.length ? ' O pagamento foi junto.' : ''}`, usuario_id: usuarioId
  });
  return {
    boleto: boletos.enxuto(atualizado), parcela: { id: parcela.id, numero_parcela: parcela.numero_parcela },
    pedido: pedido ? { id: pedido.id, numero: pedido.numero } : null,
    recebimentos_movidos: recs.length
  };
}

module.exports = {
  SQL_ARQUIVO, ORIGEM_APP, ORIGEM_IMPORTADO, MESES_PARA_TRAS, MESES_PARA_FRENTE, DIAS_POR_PEDACO,
  faixaPadrao, pedacosDaFaixa, diaParaBB, somarMeses, somarDias,
  nossoNumeroDoCampoLivre, sequencialDoNossoNumero, normalizarDoBB, situacaoLegivel,
  lerSeuNumero, sugerirParcela, distanciaEmDias, DIAS_DE_FOLGA_NO_VENCIMENTO, linhaDoBoleto, sequencialDepoisDaImportacao, avisosDoRecebimentoQueJaExistia,
  sqlPronto, exigirSql, estadoDoSql, jaImportados, parcelasPagas, listarNoBB, listarParaImportar, importarUm, importar, vincular,
  consultarNoBB, reconhecerLinhas, informarPelaLinha, parcelasParaEscolher, buscarEscolhidos
};
