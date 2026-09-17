/**
 * Os números do Dashboard — só a regra, sem rede e sem relógio próprio.
 *
 * O painel antigo inventava tudo (Math.random, pedidos de mentira). Este lê o
 * banco, e cada número abaixo tem uma armadilha que o faria mentir calado:
 *
 *   - FUSO. O pedido convertido às 23h30 do dia 31 é gravado como 02h30Z do
 *     dia 1: sem converter para São Paulo, a venda muda de mês.
 *   - DATA SEM HORA. `orcamentos.validade`, `pedidos.data_aprovacao`,
 *     `pedidos.embarcar_previsao`, `pedidos.embarcar_real`,
 *     `prospeccoes.proximo_passo_data` e `pedido_parcelas.data_vencimento`
 *     são DATE; o upstream pode entregá-las
 *     como '2026-09-13T00:00:00.000Z', e passar isso por `new Date()` em São
 *     Paulo dá o dia 12. Essas colunas são cortadas como texto, nunca
 *     convertidas.
 *   - DINHEIRO EM TEXTO. `valor_final` às vezes chega "1.234,56"; `Number()`
 *     daria NaN e zeraria a soma inteira. Tudo passa por `paraDecimal`, e o
 *     arredondamento para centavos acontece só na saída.
 *   - CÓPIA DE RELATÓRIOS. Os KPIs de lá somam pedido cancelado no "faturado",
 *     dividem a taxa de aprovação por rascunho e descontam insumo negativo do
 *     valor do estoque. Aqui cada definição foi escrita de novo, de propósito,
 *     e os testes prendem a diferença.
 *
 * Todas as funções recebem as linhas cruas e `{ agora }`: o relógio vem de fora
 * para os testes poderem parar o tempo num dia 31 ou numa virada de mês. As
 * linhas vêm do cache COMPARTILHADO do controller — nada aqui as altera; toda
 * ordenação é feita sobre cópias.
 */

const { paraDecimal } = require('./numeros');

const FUSO = 'America/Sao_Paulo';
const SEM_NOME = '—';
const ROTULO_PROSPECCAO = 'Prospecção';

/**
 * Ordem oficial do funil. CÓPIA de `ETAPAS` em prospeccoesController.js, que
 * espelha o CHECK de `prospeccoes.etapa`.
 *
 * Não é um require de lá porque este arquivo é só conta: carregar o controller
 * traria junto o router inteiro, o cliente HTTP e o `tokenStore`, que já no
 * require lê (e, na migração, reescreve) o arquivo do token de quem está
 * logado. O teste deste módulo compara as duas listas — se alguém criar uma
 * etapa lá, o teste quebra aqui antes de o funil perder uma coluna calado.
 */
const ETAPAS = ['Novo', 'Contactado', 'Qualificado', 'Proposta', 'Negociação', 'Ganho', 'Perdido'];
const ETAPAS_TERMINAIS = new Set(['ganho', 'perdido']);
const ETAPAS_ABERTAS = ETAPAS.filter(e => !ETAPAS_TERMINAIS.has(normalizarTexto(e)));

/**
 * As situações do pedido, na ordem em que o gráfico as mostra. "Parcial" e
 * "Devolvido" não são valores de `pedidos.situacao`: vêm de `pedidos.devolucao`
 * (sql/devolucoes.sql) e, na tela, vencem o Enviado/Entregue que está por baixo.
 */
const SITUACOES_PEDIDO = ['Produção', 'Enviado', 'Entregue', 'Parcial', 'Devolvido', 'Cancelado', 'Outros'];

/** O que a devolução tira da parcela sem mexer no valor gravado dela (o resto já baixou o `valor`). */
const MODOS_QUE_NAO_BAIXAM_A_PARCELA = new Set(['abatimento_boleto', 'reembolso']);

/**
 * Faixas de IDADE do pedido em produção: há quanto tempo ele está na fábrica.
 * "60+" quer dizer "em produção há mais de 60 dias", e não "atrasado 60 dias".
 * Atraso é outra conta, feita sobre a previsão de embarque
 * (`pedidos.embarcar_previsao`) — ver `embarqueEmProducao`.
 */
const FAIXAS_IDADE = [
  { faixa: '0-15', ate: 15 },
  { faixa: '16-30', ate: 30 },
  { faixa: '31-60', ate: 60 },
  { faixa: '60+', ate: Infinity }
];

/**
 * Limite FIXO de estoque crítico — o mesmo 10 que Matéria-prima e Relatórios
 * já usam. Não existe estoque mínimo por insumo no banco; a tela precisa dizer
 * que o limite é fixo para ninguém achar que é configurado item a item.
 */
const LIMITE_CRITICO = 10;

/**
 * Menos de 7 dias para o embarque previsto (hoje incluso) é ATENÇÃO: o pedido
 * ainda está em dia, mas a tela o marca em vermelho. De 7 em diante, em dia.
 */
const DIAS_DE_ATENCAO_EMBARQUE = 7;

/** Quantos itens cada lista leva. O total real vai sempre junto. */
const LIMITE_LISTA = {
  // Produção vem INTEIRA: o cartão mostra cinco e expande o resto no próprio
  // lugar. 100 é só um teto de segurança contra uma resposta gigante; o que
  // passar dele entra no "+N não listados" da tela, que conta pelo total.
  maisAntigos: 100,
  vencendo7d: 8,
  aprovadosSemPedido: 5,
  followups: 6,
  negativos: 6,
  // Pedidos listados por mês no tooltip da previsão; os demais viram `outros`.
  previsao: 8
};

/**
 * Até quantos meses à frente do atual o gráfico da previsão vai. Parcela mais
 * longe que isso não some: vai para `alemDoHorizonte`, com valor, contagem e o
 * último mês — um parcelamento em 18x não pode encolher calado para 12.
 */
const HORIZONTE_PREVISAO_MESES = 12;

/**
 * A coluna da grade que libera cada texto que IDENTIFICA alguém: cliente,
 * prospecção, responsável, insumo.
 *
 * O R$ já virava `null` para quem não vê a coluna de valor, mas os nomes saíam
 * para todos — e o perfil com a coluna Cliente escondida em Pedidos e
 * Orçamentos lia aqui, nas listas do painel, justamente o nome que a grade e o
 * detalhe lhe negam. Sem a coluna o texto sai `null`. O "—" fica só para
 * "vazio no banco", que é outra afirmação.
 *
 * Número do documento, etapa, datas, dias e contagens não identificam ninguém
 * e saem sempre: o funil e os chips de atraso são feitos deles.
 */
const COLUNAS_DE_TEXTO = Object.freeze({
  clienteDoPedido: 'col_ped_cliente',
  destinatarioDoOrcamento: 'col_orc_cliente',
  donoDoOrcamento: 'col_orc_campo_dono',
  nomeDaProspeccao: 'col_pros_entidade',
  proximoPasso: 'col_pros_proximo_passo',
  nomeDoInsumo: 'col_mp_nome',
  unidadeDoInsumo: 'col_mp_unidade'
});

/**
 * O ponderado é Σ valor × probabilidade. Ao lado do valor em aberto, ele
 * entrega a probabilidade (com uma prospecção só, exatamente a dela) a quem
 * não vê essa coluna.
 */
const COLUNA_PROBABILIDADE = 'col_pros_prob';

// ---------------------------------------------------------------------------
// Texto, número e identificador
// ---------------------------------------------------------------------------

/**
 * Caixa, acento e espaço não mudam o status: "Em Produção" == "em producao".
 *
 * O NFD separa a letra do acento, e os acentos caem na faixa U+0300–U+036F.
 * A faixa vai por código numérico, e não numa regex: escrita com os
 * caracteres crus, ela fica invisível no editor.
 */
function normalizarTexto(s) {
  return [...String(s ?? '').normalize('NFD')]
    .filter(c => c.codePointAt(0) < 0x300 || c.codePointAt(0) > 0x36f)
    .join('')
    .trim()
    .toLowerCase();
}

function texto(v) {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t || null;
}

/** "Preenchido" para id de vínculo: 0 é id, "" e null não são. */
function temValor(v) {
  return v !== null && v !== undefined && String(v).trim() !== '';
}

const lista = v => (Array.isArray(v) ? v : []);

/** Dinheiro que chega como "1.234,56", "1234.56" ou número. Vazio vale zero. */
function dinheiro(v) {
  return paraDecimal(v) ?? 0;
}

function arredondar(v) {
  return Math.round(v * 100) / 100;
}

/** Sem a coluna de valor o R$ vira `null` — nunca 0, que seria mentira. */
function saidaDeValor(v, comValores) {
  return comValores ? arredondar(v) : null;
}

/**
 * Sem `pode`, tudo sai — o mesmo padrão aberto de `comValores`: as contas não
 * decidem permissão. O controller passa sempre o recorte de quem pediu.
 */
const LIBERA_TUDO = () => true;

function compararIds(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return String(a ?? '').localeCompare(String(b ?? ''));
}

/** Truthy de verdade: `Boolean('false')` é true, e o upstream já mandou 't'. */
function ehVerdadeiro(v) {
  if (v === true || v === 1) return true;
  return ['t', 'true', '1', 'sim'].includes(normalizarTexto(v));
}

function acumulador() {
  return { quantidade: 0, valor: 0 };
}

function somar(acc, valor) {
  acc.quantidade += 1;
  acc.valor += valor;
}

/** id -> nome_fantasia || razao_social. Serve a clientes e a prospecções. */
function mapaDeNomes(linhas) {
  const mapa = new Map();
  for (const l of lista(linhas)) {
    if (!temValor(l?.id)) continue;
    const nome = texto(l.nome_fantasia) || texto(l.razao_social);
    if (nome) mapa.set(String(l.id), nome);
  }
  return mapa;
}

// ---------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------

const formatadorDia = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit'
});

/**
 * Dia local de São Paulo ('YYYY-MM-DD') de uma coluna TIMESTAMP (um instante).
 *
 * Monta pelas partes em vez de confiar no padrão de data do 'en-CA': o formato
 * dessa localidade já mudou entre versões do ICU, e um "09/13/2026" aqui
 * quebraria toda comparação de texto sem erro nenhum.
 *
 * Texto que é SÓ data ('2026-09-13') volta como está: `new Date()` o leria como
 * meia-noite UTC — em São Paulo, dia 12.
 */
function diaLocal(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor.trim())) return valor.trim();
  const instante = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(instante.getTime())) return null;
  const partes = {};
  for (const p of formatadorDia.formatToParts(instante)) partes[p.type] = p.value;
  return `${partes.year}-${partes.month}-${partes.day}`;
}

/**
 * Dia de uma coluna DATE: corte de texto, NUNCA `new Date()`. O upstream pode
 * serializar a data como '2026-09-13T00:00:00.000Z'; convertida para São Paulo,
 * ela vira o dia 12 e o orçamento que vence hoje aparece vencido.
 */
function diaDeColunaDate(valor) {
  if (valor === null || valor === undefined) return null;
  const bruto = valor instanceof Date ? valor.toISOString() : String(valor).trim();
  const achado = /^(\d{4}-\d{2}-\d{2})/.exec(bruto);
  return achado ? achado[1] : null;
}

/**
 * Dia de uma coluna DATE que EXISTE no calendário. '2026-02-30' passa no corte
 * de texto, mas não é dia nenhum: comparado como texto ele viraria um prazo ou
 * um mês inventado. Aqui ele é `null` — "sem data".
 */
function diaDeCalendario(valor) {
  const dia = diaDeColunaDate(valor);
  if (!dia) return null;
  return new Date(utcDoDia(dia)).toISOString().slice(0, 10) === dia ? dia : null;
}

function utcDoDia(dia) {
  const [a, m, d] = dia.split('-').map(Number);
  return Date.UTC(a, m - 1, d);
}

/** a − b em dias, sobre as partes da data — sem hora local, sem horário de verão. */
function diferencaEmDias(a, b) {
  return Math.round((utcDoDia(a) - utcDoDia(b)) / 86400000);
}

function somarDias(dia, n) {
  return new Date(utcDoDia(dia) + n * 86400000).toISOString().slice(0, 10);
}

function deslocarMes(mes, n) {
  const [a, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 7);
}

function ultimoDiaDoMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

/** Os 12 meses do gráfico: do mês atual − 11 até o atual, em ordem. */
function janelaDe12Meses(mesAtual) {
  return Array.from({ length: 12 }, (_, i) => deslocarMes(mesAtual, i - 11));
}

/** `hoje` e `mesAtual` no fuso do negócio. */
function contextoDeTempo(agora = new Date()) {
  const instante = agora instanceof Date ? agora : new Date(agora);
  const hoje = diaLocal(instante);
  return { hoje, mesAtual: hoje.slice(0, 7) };
}

// ---------------------------------------------------------------------------
// Pedido
// ---------------------------------------------------------------------------

/**
 * O backend aceita qualquer texto em `pedidos.situacao`. O que não for uma das
 * quatro conhecidas vai para "Outros" — sumir com a linha deixaria o total do
 * gráfico menor que o número de pedidos.
 */
function situacaoDoPedido(situacao) {
  const s = normalizarTexto(situacao);
  if (s === 'producao' || s === 'em producao') return 'Produção';
  if (s === 'enviado') return 'Enviado';
  if (s === 'entregue') return 'Entregue';
  if (s === 'cancelado') return 'Cancelado';
  return 'Outros';
}

/**
 * A situação que o painel mostra: a devolução (parcial ou total) vence a
 * situação gravada, menos a do cancelado — pedido cancelado não se devolve.
 */
function situacaoNoPainel(pedido) {
  const situacao = situacaoDoPedido(pedido?.situacao);
  if (situacao === 'Cancelado') return situacao;
  const devolucao = normalizarTexto(pedido?.devolucao);
  if (devolucao === 'total') return 'Devolvido';
  if (devolucao === 'parcial') return 'Parcial';
  return situacao;
}

/**
 * O valor da VENDA como ela aconteceu. Numa devolução parcial o
 * `valor_final` passa a ser o que restou; o que foi vendido fica em
 * `valor_original`. O que voltou aparece à parte, na série roxa.
 */
function valorDaVenda(pedido) {
  return temValor(pedido?.devolucao) && temValor(pedido?.valor_original)
    ? dinheiro(pedido.valor_original)
    : dinheiro(pedido?.valor_final);
}

function indiceDaFaixa(dias) {
  return FAIXAS_IDADE.findIndex(f => dias <= f.ate);
}

/**
 * Prazo de embarque de um pedido EM PRODUÇÃO: a previsão, quantos dias faltam
 * (previsão − hoje; negativo = dias de atraso) e a classificação da tela.
 * "Hoje" é o dia de São Paulo do contexto; a previsão é DATE, cortada como
 * texto (diaDeCalendario) — pelo `new Date()` o '...T00:00:00.000Z' do dia 13
 * seria o dia 12, e o pedido que embarca hoje apareceria atrasado.
 */
function embarqueEmProducao(pedido, hoje) {
  const previsao = diaDeCalendario(pedido?.embarcar_previsao);
  if (!previsao) return { embarque: null, diasParaEmbarque: null, prazo: 'sem_previsao' };
  const dias = diferencaEmDias(previsao, hoje);
  let prazo = 'em_dia';
  if (dias < 0) prazo = 'atrasado';
  else if (dias < DIAS_DE_ATENCAO_EMBARQUE) prazo = 'atencao';
  return { embarque: previsao, diasParaEmbarque: dias, prazo };
}

/** Classificação de `embarqueEmProducao` -> contador de `prazo` e de `porSituacao12m`. */
const CONTADOR_DO_PRAZO = { em_dia: 'emDia', atencao: 'emDia', atrasado: 'atrasados', sem_previsao: 'semPrevisao' };

/**
 * Em que contador de prazo do donut o pedido cai, ou `null` fora da conta.
 *
 * Produção pela previsão contra hoje (atenção ainda é "em dia"). Enviado e
 * Entregue pelo embarque de VERDADE: em dia se `embarcar_real` <= previsão —
 * no dia ou adiantado —, atrasado se depois. Sem uma das duas datas não há o
 * que comparar: `semPrevisao` (pedido de antes da previsão, ou que a API deixou
 * ir de Produção direto para Entregue, sem embarque registrado). Cancelado e
 * Outros não têm prazo a cumprir.
 */
function contadorDePrazo(situacao, pedido, embarque) {
  if (situacao === 'Produção') return CONTADOR_DO_PRAZO[embarque.prazo];
  if (situacao !== 'Enviado' && situacao !== 'Entregue') return null;
  const previsao = diaDeCalendario(pedido?.embarcar_previsao);
  const real = diaDeCalendario(pedido?.embarcar_real);
  if (!previsao || !real) return 'semPrevisao';
  return real > previsao ? 'atrasados' : 'emDia';
}

/**
 * Destinatário do orçamento. Com cliente, o nome do cliente. Sem cliente, é
 * orçamento de prospecção — e o NOME da prospecção só sai para quem tem
 * `pros.view` E a coluna do nome dela: o pipeline comercial é protegido, e o
 * painel não pode virar a porta dos fundos dele. Os outros leem apenas
 * "Prospecção", que é categoria, não nome.
 *
 * Sem a coluna Cliente de Orçamentos não sai nada (`null`): nem "Prospecção",
 * porque a coluna escondida na grade é justamente essa.
 */
function destinatarioDoOrcamento(orc, { verDestinatario, nomesClientes, nomesProspeccoes, nomeDeProspeccao }) {
  if (!verDestinatario) return null;
  if (temValor(orc?.cliente_id)) return nomesClientes.get(String(orc.cliente_id)) || SEM_NOME;
  if (nomeDeProspeccao && temValor(orc?.prospeccao_id)) {
    return nomesProspeccoes.get(String(orc.prospeccao_id)) || ROTULO_PROSPECCAO;
  }
  return ROTULO_PROSPECCAO;
}

/**
 * O que `destinatarioDoOrcamento` pode usar, montado uma vez por conta. Sem a
 * coluna, o mapa nem é montado: não há nome a procurar.
 */
function nomesDeDestinatario({ clientes, prospeccoes }, { nomeDeProspeccao, pode }) {
  const verDestinatario = pode(COLUNAS_DE_TEXTO.destinatarioDoOrcamento);
  const verProspeccao = verDestinatario && nomeDeProspeccao && pode(COLUNAS_DE_TEXTO.nomeDaProspeccao);
  return {
    verDestinatario,
    nomesClientes: verDestinatario ? mapaDeNomes(clientes) : new Map(),
    nomesProspeccoes: verProspeccao ? mapaDeNomes(prospeccoes) : new Map(),
    nomeDeProspeccao: verProspeccao
  };
}

// ---------------------------------------------------------------------------
// 4.1 vendas
// ---------------------------------------------------------------------------

/**
 * Vendas fechadas = pedidos gerados. O pedido nasce da aprovação do orçamento,
 * e o mês da venda é o mês (em São Paulo) de `data_emissao`, que é o instante
 * da conversão.
 *
 * Por que não contar orçamento Aprovado: o PUT grava "Aprovado" ANTES de
 * converter (orcamentosController), então uma conversão que falhou e um pedido
 * cancelado depois continuariam contando como venda.
 *
 * `mesAnteriorMesmoPeriodo`: comparar o mês corrente, ainda pela metade, com o
 * anterior inteiro faz todo começo de mês parecer queda. Compara-se o mesmo
 * trecho — dias 1..D, com D limitado ao último dia do mês anterior (no dia 31
 * de outubro, setembro vai até o 30).
 *
 * `canceladosMes` conta pela data do CANCELAMENTO. Linha sem
 * `data_cancelamento` (cancelada antes de a coluna passar a ser gravada) fica
 * de fora: chutar a data seria pior.
 *
 * `serie12m` traz os meses vazios com zero. O gráfico de Relatórios pula mês
 * sem venda, e o eixo passa a mentir sobre a distância entre as barras.
 *
 * O QUE SAIU. Cada mês leva também `cancelado` (pedidos cancelados, pelo mês
 * do CANCELAMENTO) e `devolvido` (devoluções, pelo mês da DEVOLUÇÃO — a
 * tabela `devolucoes`, que pode nem existir ainda: sem ela, zero). A venda
 * continua no mês em que aconteceu, pelo valor vendido (`valorDaVenda`): um
 * pedido vendido em agosto e devolvido em setembro é venda de agosto e
 * devolução de setembro. `devolvidosMes` é o irmão de `canceladosMes`.
 */
function resumirVendas({ pedidos, devolucoes } = {}, { agora = new Date(), comValores = true } = {}) {
  const { hoje, mesAtual } = contextoDeTempo(agora);
  const mesAnterior = deslocarMes(mesAtual, -1);
  const diaLimite = Math.min(Number(hoje.slice(8, 10)), ultimoDiaDoMes(mesAnterior));
  const meses = janelaDe12Meses(mesAtual);

  const atual = acumulador();
  const mesmoPeriodo = acumulador();
  const anterior = acumulador();
  const cancelados = acumulador();
  const devolvidos = acumulador();
  const porMes = new Map(meses.map(m => [m, acumulador()]));
  const canceladoPorMes = new Map(meses.map(m => [m, acumulador()]));
  const devolvidoPorMes = new Map(meses.map(m => [m, acumulador()]));

  for (const d of lista(devolucoes)) {
    const mes = diaDeColunaDate(d?.data_devolucao)?.slice(0, 7);
    if (!mes) continue;
    const valor = dinheiro(d?.valor);
    if (mes === mesAtual) somar(devolvidos, valor);
    if (devolvidoPorMes.has(mes)) somar(devolvidoPorMes.get(mes), valor);
  }

  for (const p of lista(pedidos)) {
    const valor = valorDaVenda(p);

    if (situacaoDoPedido(p?.situacao) === 'Cancelado') {
      const diaCancelamento = diaLocal(p?.data_cancelamento);
      const mesCancelamento = diaCancelamento ? diaCancelamento.slice(0, 7) : null;
      if (mesCancelamento === mesAtual) somar(cancelados, valor);
      if (canceladoPorMes.has(mesCancelamento)) somar(canceladoPorMes.get(mesCancelamento), valor);
      continue;
    }

    const dia = diaLocal(p?.data_emissao);
    if (!dia) continue;
    const mes = dia.slice(0, 7);
    if (mes === mesAtual) somar(atual, valor);
    if (mes === mesAnterior) {
      somar(anterior, valor);
      if (Number(dia.slice(8, 10)) <= diaLimite) somar(mesmoPeriodo, valor);
    }
    if (porMes.has(mes)) somar(porMes.get(mes), valor);
  }

  const comTicket = acc => ({
    quantidade: acc.quantidade,
    valor: saidaDeValor(acc.valor, comValores),
    ticketMedio: saidaDeValor(acc.quantidade ? acc.valor / acc.quantidade : 0, comValores)
  });

  return {
    mesAtual: comTicket(atual),
    mesAnteriorMesmoPeriodo: comTicket(mesmoPeriodo),
    mesAnterior: comTicket(anterior),
    canceladosMes: {
      quantidade: cancelados.quantidade,
      valor: saidaDeValor(cancelados.valor, comValores)
    },
    devolvidosMes: {
      quantidade: devolvidos.quantidade,
      valor: saidaDeValor(devolvidos.valor, comValores)
    },
    serie12m: meses.map(mes => ({
      mes,
      quantidade: porMes.get(mes).quantidade,
      valor: saidaDeValor(porMes.get(mes).valor, comValores),
      cancelado: {
        quantidade: canceladoPorMes.get(mes).quantidade,
        valor: saidaDeValor(canceladoPorMes.get(mes).valor, comValores)
      },
      devolvido: {
        quantidade: devolvidoPorMes.get(mes).quantidade,
        valor: saidaDeValor(devolvidoPorMes.get(mes).valor, comValores)
      }
    }))
  };
}

// ---------------------------------------------------------------------------
// 4.2 produção
// ---------------------------------------------------------------------------

/**
 * Pedidos em produção, há quanto tempo estão lá e se vão embarcar no prazo.
 *
 * A idade conta do dia em São Paulo da CONVERSÃO. `data_aprovacao` do pedido é
 * gravada por buildPedidoPayload (orcamentosController) como o dia UTC do
 * MESMO instante que vai em `data_emissao`: numa conversão entre 21h e 23h59 em
 * São Paulo esse dia já é o seguinte. Contada dele, a idade saía 1 dia menor —
 * o pedido convertido às 22h30 de 28/08 aparecia "há 15 dias" em 13/09 e
 * pulava de faixa nas bordas 15/16, 30/31 e 60/61. Então: quando a aprovação é
 * o próprio corte de texto da emissão, as duas são o mesmo instante e vale o
 * dia local da emissão; quando é outra data (linha antiga, aprovação lançada
 * em outro dia), vale a aprovação — DATE, corte de texto. Sem aprovação, a
 * emissão. Corrigir só quem grava não bastaria: as linhas já gravadas ficam
 * com o dia UTC.
 *
 * Pedido sem nenhuma das duas entra na contagem, mas não em faixa nem em "mais
 * antigos" — sem data não há idade a mostrar.
 *
 * Data de início no futuro (digitada errada, relógio adiantado) conta como 0
 * dia: "há -2 dias" não diz nada a ninguém.
 *
 * `cliente` só sai com a coluna Cliente de Pedidos (COLUNAS_DE_TEXTO). A
 * previsão de embarque, os dias e o prazo saem sempre: datas e contagens não
 * identificam ninguém.
 *
 * PRAZO DE EMBARQUE (`embarqueEmProducao`). Cada item de `maisAntigos` leva
 * `embarque` (a previsão, 'YYYY-MM-DD' ou null), `diasParaEmbarque` (previsão
 * − hoje, negativo no atraso; null sem previsão) e `prazo`:
 *   - 'atrasado'     passou da previsão e continua na fábrica;
 *   - 'atencao'      embarca em menos de DIAS_DE_ATENCAO_EMBARQUE dias, hoje
 *                    incluso — ainda está em dia;
 *   - 'em_dia'       faltam 7 dias ou mais;
 *   - 'sem_previsao' pedido de antes da previsão existir (ou data impossível).
 *
 * `prazo` (o bloco) resume os pedidos EM PRODUÇÃO — o mesmo universo de
 * `quantidade`, sem a janela de 12 meses. `emDia` é "ainda não atrasou": ele
 * INCLUI os de atenção, e `atencao` é só o recorte dele que embarca em menos
 * de 7 dias. Assim emDia + atrasados + semPrevisao = quantidade, e o `emDia`
 * daqui quer dizer o mesmo que o de `porSituacao12m`.
 *
 * `maisAntigos` traz TODOS os pedidos listáveis (a tela mostra cinco e expande
 * o resto), até o teto de LIMITE_LISTA.
 *
 * `porSituacao12m` usa a mesma janela de `serie12m` (mês local da emissão) e
 * traz sempre as cinco chaves, para o donut não mudar de cor entre recargas.
 * Cada uma leva `emDia`, `atrasados` e `semPrevisao` (ver `contadorDePrazo`),
 * que somam a `quantidade` dela — zeros em Cancelado e Outros. A janela é
 * outra que a do bloco `prazo`: um pedido emitido há mais de 12 meses e ainda
 * na fábrica conta no KPI e não no donut.
 */
function resumirProducao(
  { pedidos, clientes } = {},
  { agora = new Date(), comValores = true, pode = LIBERA_TUDO } = {}
) {
  const { hoje, mesAtual } = contextoDeTempo(agora);
  const janela = new Set(janelaDe12Meses(mesAtual));
  const verCliente = pode(COLUNAS_DE_TEXTO.clienteDoPedido);
  const nomes = verCliente ? mapaDeNomes(clientes) : new Map();

  const total = acumulador();
  const prazo = { emDia: acumulador(), atencao: acumulador(), atrasados: acumulador(), semPrevisao: acumulador() };
  const idades = FAIXAS_IDADE.map(f => ({ faixa: f.faixa, quantidade: 0 }));
  const comIdade = [];
  const porSituacao = new Map(SITUACOES_PEDIDO.map(s => [s, { ...acumulador(), emDia: 0, atrasados: 0, semPrevisao: 0 }]));

  for (const p of lista(pedidos)) {
    const situacao = situacaoDoPedido(p?.situacao);
    const valor = dinheiro(p?.valor_final);
    const diaEmissao = diaLocal(p?.data_emissao);
    const embarque = situacao === 'Produção' ? embarqueEmProducao(p, hoje) : null;

    if (diaEmissao && janela.has(diaEmissao.slice(0, 7))) {
      // No donut a devolução vence o Enviado/Entregue; devolvido não tem prazo a cumprir.
      const noPainel = situacaoNoPainel(p);
      const daSituacao = porSituacao.get(noPainel);
      somar(daSituacao, valor);
      const contador = contadorDePrazo(noPainel, p, embarque);
      if (contador) daSituacao[contador] += 1;
    }
    if (situacao !== 'Produção') continue;

    somar(total, valor);
    somar(prazo[CONTADOR_DO_PRAZO[embarque.prazo]], valor);
    if (embarque.prazo === 'atencao') somar(prazo.atencao, valor);
    const aprovacao = diaDeColunaDate(p?.data_aprovacao);
    // O corte de TEXTO da emissão é exatamente o que o gravador pôs na
    // aprovação. Aqui ele não é a data do pedido (isso é `diaEmissao`, em São
    // Paulo): só serve para reconhecer que as duas colunas são o mesmo instante.
    const mesmoInstante = aprovacao && diaEmissao && aprovacao === diaDeColunaDate(p?.data_emissao);
    const inicio = mesmoInstante ? diaEmissao : (aprovacao || diaEmissao);
    if (!inicio) continue;
    const dias = Math.max(0, diferencaEmDias(hoje, inicio));
    idades[indiceDaFaixa(dias)].quantidade += 1;
    comIdade.push({ p, dias, valor, embarque });
  }

  const maisAntigos = [...comIdade]
    .sort((a, b) => b.dias - a.dias || compararIds(a.p.id, b.p.id))
    .slice(0, LIMITE_LISTA.maisAntigos)
    .map(({ p, dias, valor, embarque }) => ({
      id: p.id ?? null,
      numero: texto(p.numero),
      cliente: verCliente ? ((temValor(p.cliente_id) && nomes.get(String(p.cliente_id))) || SEM_NOME) : null,
      dias,
      valor: saidaDeValor(valor, comValores),
      embarque: embarque.embarque,
      diasParaEmbarque: embarque.diasParaEmbarque,
      prazo: embarque.prazo
    }));

  const soma = acc => ({ quantidade: acc.quantidade, valor: saidaDeValor(acc.valor, comValores) });

  return {
    quantidade: total.quantidade,
    valor: saidaDeValor(total.valor, comValores),
    prazo: {
      emDia: soma(prazo.emDia),
      atencao: soma(prazo.atencao),
      atrasados: soma(prazo.atrasados),
      semPrevisao: soma(prazo.semPrevisao)
    },
    porIdade: idades,
    maisAntigos,
    porSituacao12m: SITUACOES_PEDIDO.map(situacao => {
      const daSituacao = porSituacao.get(situacao);
      return {
        situacao,
        quantidade: daSituacao.quantidade,
        valor: saidaDeValor(daSituacao.valor, comValores),
        emDia: daSituacao.emDia,
        atrasados: daSituacao.atrasados,
        semPrevisao: daSituacao.semPrevisao
      };
    })
  };
}

// ---------------------------------------------------------------------------
// 4.3 orçamentos
// ---------------------------------------------------------------------------

/**
 * Orçamentos em aberto, os que vencem logo e como andam as decisões.
 *
 * Nenhum código expira orçamento sozinho: Pendente vencido continua Pendente.
 * Por isso vencidos são separados dos vigentes — somados, o "em aberto"
 * incharia com proposta morta. Sem validade conta como vigente.
 *
 * `data_emissao` do orçamento não serve para nada aqui: o PUT a reescreve a
 * cada edição. A data da DECISÃO é `data_aprovacao` (um instante), gravada
 * também para Rejeitado e Expirado.
 *
 * `taxaAprovacao` é sobre os DECIDIDOS no período. A de Relatórios divide por
 * todos, rascunho incluso, e parece sempre ruim. Sem decisão, `null` — 0%
 * diria que tudo foi recusado.
 *
 * `destinatario` e `dono` só saem com as colunas deles (COLUNAS_DE_TEXTO).
 */
function resumirOrcamentos(
  { orcamentos, clientes, prospeccoes } = {},
  { agora = new Date(), comValores = true, nomeDeProspeccao = false, pode = LIBERA_TUDO } = {}
) {
  const { hoje } = contextoDeTempo(agora);
  const fimDaSemana = somarDias(hoje, 7);
  const inicio90 = somarDias(hoje, -89);
  const nomes = nomesDeDestinatario({ clientes, prospeccoes }, { nomeDeProspeccao, pode });
  const verDono = pode(COLUNAS_DE_TEXTO.donoDoOrcamento);

  const vigentes = acumulador();
  const vencidos = acumulador();
  const rascunhos = acumulador();
  const vencendo = [];
  const decisao = { aprovado: 0, rejeitado: 0, expirado: 0 };

  for (const o of lista(orcamentos)) {
    const situacao = normalizarTexto(o?.situacao);
    const valor = dinheiro(o?.valor_final);

    if (situacao === 'pendente') {
      const validade = diaDeColunaDate(o?.validade);
      if (validade && validade < hoje) somar(vencidos, valor);
      else somar(vigentes, valor);
      if (validade && validade >= hoje && validade <= fimDaSemana) vencendo.push({ o, validade, valor });
    } else if (situacao === 'rascunho') {
      somar(rascunhos, valor);
    } else if (Object.prototype.hasOwnProperty.call(decisao, situacao)) {
      const dia = diaLocal(o?.data_aprovacao);
      if (dia && dia >= inicio90 && dia <= hoje) decisao[situacao] += 1;
    }
  }

  const itensVencendo = [...vencendo]
    .sort((a, b) => a.validade.localeCompare(b.validade) || compararIds(a.o.id, b.o.id))
    .slice(0, LIMITE_LISTA.vencendo7d)
    .map(({ o, validade, valor }) => ({
      id: o.id ?? null,
      numero: texto(o.numero),
      destinatario: destinatarioDoOrcamento(o, nomes),
      dono: verDono ? (texto(o.dono) || SEM_NOME) : null,
      validade,
      diasRestantes: diferencaEmDias(validade, hoje),
      valor: saidaDeValor(valor, comValores)
    }));

  const decididos = decisao.aprovado + decisao.rejeitado + decisao.expirado;
  const soma = acc => ({ quantidade: acc.quantidade, valor: saidaDeValor(acc.valor, comValores) });

  return {
    pendentesVigentes: soma(vigentes),
    pendentesVencidos: soma(vencidos),
    rascunhos: soma(rascunhos),
    vencendo7d: { total: vencendo.length, itens: itensVencendo },
    decisao90d: {
      aprovados: decisao.aprovado,
      rejeitados: decisao.rejeitado,
      expirados: decisao.expirado,
      decididos,
      taxaAprovacao: decididos ? Math.round((decisao.aprovado / decididos) * 10000) / 10000 : null
    }
  };
}

// ---------------------------------------------------------------------------
// 4.4 alertas
// ---------------------------------------------------------------------------

/**
 * Orçamento Aprovado sem pedido: a conversão falhou OU o pedido foi excluído.
 * O PUT grava "Aprovado" antes de converter, e quando a conversão estoura o
 * orçamento fica aprovado sem pedido nenhum. E excluir o pedido não mexe no
 * orçamento de origem (excluirPedidoEmCascata não o tem entre as
 * dependentes): ele continua Aprovado, apontando para nada. As duas causas
 * deixam a mesma linha no banco — daqui não dá para dizer qual foi, então o
 * alerta não pode afirmar uma delas. Sem ele, ninguém percebe até o cliente
 * cobrar a entrega.
 *
 * Casa pelas duas pontas: o pedido reusa o id do orçamento, mas linha antiga
 * pode ter só `orcamento_id` preenchido (ou só o id igual). Pedido cancelado
 * também conta como correspondente: a conversão aconteceu.
 */
function resumirAlertas(
  { orcamentos, pedidos, clientes, prospeccoes } = {},
  { comValores = true, nomeDeProspeccao = false, pode = LIBERA_TUDO } = {}
) {
  const convertidos = new Set();
  for (const p of lista(pedidos)) {
    if (temValor(p?.orcamento_id)) convertidos.add(String(p.orcamento_id));
    if (temValor(p?.id)) convertidos.add(String(p.id));
  }
  const nomes = nomesDeDestinatario({ clientes, prospeccoes }, { nomeDeProspeccao, pode });

  const semPedido = lista(orcamentos).filter(o =>
    normalizarTexto(o?.situacao) === 'aprovado' && temValor(o?.id) && !convertidos.has(String(o.id))
  );

  // A falha mais recente primeiro: é a que alguém ainda consegue explicar.
  const instante = o => new Date(o?.data_aprovacao ?? 0).getTime() || 0;
  const itens = [...semPedido]
    .sort((a, b) => instante(b) - instante(a) || compararIds(b.id, a.id))
    .slice(0, LIMITE_LISTA.aprovadosSemPedido)
    .map(o => ({
      id: o.id ?? null,
      numero: texto(o.numero),
      destinatario: destinatarioDoOrcamento(o, nomes),
      valor: saidaDeValor(dinheiro(o.valor_final), comValores)
    }));

  return { aprovadosSemPedido: { quantidade: semPedido.length, itens } };
}

// ---------------------------------------------------------------------------
// 4.5 prospecção
// ---------------------------------------------------------------------------

/**
 * Pipeline comercial ABERTO: fora de Ganho/Perdido, ainda sem cliente e não
 * arquivado. O `funil` de /api/prospeccoes/lista conta arquivadas de propósito
 * (lá é histórico); aqui isso inflaria o pipeline com o que já morreu.
 *
 * `followups` só olha o conjunto aberto: cobrar o próximo passo de uma
 * prospecção perdida seria ruído. `dias` é data − hoje, negativo no atraso.
 *
 * `convertidosMes` é "clientes novos VIA PROSPECÇÃO": `clientes` não tem data
 * de criação, então cliente cadastrado direto não entra em conta nenhuma.
 *
 * `nome` e `proximoPasso` só saem com as colunas deles, e o `valorPonderado`
 * pede também a da probabilidade (COLUNAS_DE_TEXTO, COLUNA_PROBABILIDADE).
 */
function resumirProspeccao(
  { prospeccoes } = {},
  { agora = new Date(), comValores = true, pode = LIBERA_TUDO } = {}
) {
  const { hoje, mesAtual } = contextoDeTempo(agora);
  const fimDaSemana = somarDias(hoje, 7);
  const etapaOficial = new Map(ETAPAS.map(e => [normalizarTexto(e), e]));
  const funil = new Map(ETAPAS_ABERTAS.map(e => [e, acumulador()]));
  const verNome = pode(COLUNAS_DE_TEXTO.nomeDaProspeccao);
  const verPasso = pode(COLUNAS_DE_TEXTO.proximoPasso);
  const verProbabilidade = pode(COLUNA_PROBABILIDADE);

  let abertos = 0;
  let valorEmAberto = 0;
  let valorPonderado = 0;
  const followups = { atrasados: 0, hoje: 0, proximos7: 0 };
  const cobrar = [];
  let convertidosMes = 0;

  for (const p of lista(prospeccoes)) {
    if (temValor(p?.cliente_id)) {
      const dia = diaLocal(p?.convertida_em);
      if (dia && dia.slice(0, 7) === mesAtual) convertidosMes += 1;
      continue;
    }
    const etapaNormalizada = normalizarTexto(p?.etapa);
    if (ETAPAS_TERMINAIS.has(etapaNormalizada)) continue;
    if (normalizarTexto(p?.status) === 'arquivada') continue;

    abertos += 1;
    const valor = dinheiro(p?.valor_estimado);
    // Probabilidade fora de 0–100 é dado torto; sem o limite, 150% faria o
    // ponderado passar do valor em aberto.
    const probabilidade = Math.min(100, Math.max(0, paraDecimal(p?.probabilidade) ?? 0));
    valorEmAberto += valor;
    valorPonderado += (valor * probabilidade) / 100;

    const etapa = etapaOficial.get(etapaNormalizada) || texto(p?.etapa);
    if (funil.has(etapa)) somar(funil.get(etapa), valor);

    const data = diaDeColunaDate(p?.proximo_passo_data);
    if (!data) continue;
    if (data < hoje) followups.atrasados += 1;
    else if (data === hoje) followups.hoje += 1;
    else if (data <= fimDaSemana) followups.proximos7 += 1;
    if (data <= hoje) {
      cobrar.push({
        id: p.id ?? null,
        nome: verNome ? (texto(p.nome_fantasia) || texto(p.razao_social) || SEM_NOME) : null,
        etapa,
        proximoPasso: verPasso ? texto(p.proximo_passo) : null,
        data,
        dias: diferencaEmDias(data, hoje)
      });
    }
  }

  return {
    abertos,
    valorEmAberto: saidaDeValor(valorEmAberto, comValores),
    valorPonderado: saidaDeValor(valorPonderado, comValores && verProbabilidade),
    funil: ETAPAS_ABERTAS.map(etapa => ({
      etapa,
      quantidade: funil.get(etapa).quantidade,
      valor: saidaDeValor(funil.get(etapa).valor, comValores)
    })),
    followups: {
      ...followups,
      itens: [...cobrar]
        .sort((a, b) => a.data.localeCompare(b.data) || compararIds(a.id, b.id))
        .slice(0, LIMITE_LISTA.followups)
    },
    convertidosMes
  };
}

// ---------------------------------------------------------------------------
// 4.6 clientes
// ---------------------------------------------------------------------------

/** Ativo = status_cliente "Ativo" em qualquer grafia. A mesma regra de Relatórios. */
function resumirClientes({ clientes } = {}) {
  const linhas = lista(clientes);
  return {
    ativos: linhas.filter(c => normalizarTexto(c?.status_cliente) === 'ativo').length,
    total: linhas.length
  };
}

// ---------------------------------------------------------------------------
// 4.7 estoque
// ---------------------------------------------------------------------------

/**
 * Saúde do estoque de matéria-prima.
 *
 * Insumo infinito não tem controle de estoque: na conta, o "zero" dele pareceria
 * falta. Quantidades NUNCA são somadas entre insumos — metro, litro e unidade
 * não se somam, então só se contam itens.
 *
 * `valorEstoque` é custo de reposição (preco_unitario é o último preço
 * digitado) e só com saldo positivo. Relatórios desconta os negativos: o
 * estoque "vale menos" porque alguém esqueceu de dar entrada.
 *
 * Quantidade vazia conta como zero, como em Relatórios.
 *
 * `nome` e `unidade` só saem com as colunas deles (COLUNAS_DE_TEXTO). A
 * quantidade sai sempre: a seção inteira já exige a coluna do saldo.
 */
function resumirEstoque(
  { materia_prima: materias } = {},
  { comValores = true, pode = LIBERA_TUDO } = {}
) {
  const verNome = pode(COLUNAS_DE_TEXTO.nomeDoInsumo);
  const verUnidade = pode(COLUNAS_DE_TEXTO.unidadeDoInsumo);
  let zerados = 0;
  let criticos = 0;
  let valorEstoque = 0;
  const negativos = [];

  for (const m of lista(materias)) {
    if (ehVerdadeiro(m?.infinito)) continue;
    const quantidade = paraDecimal(m?.quantidade) ?? 0;
    if (quantidade < 0) {
      negativos.push({ m, quantidade });
    } else if (quantidade === 0) {
      zerados += 1;
    } else {
      if (quantidade < LIMITE_CRITICO) criticos += 1;
      valorEstoque += quantidade * dinheiro(m?.preco_unitario);
    }
  }

  const itens = [...negativos]
    .sort((a, b) => a.quantidade - b.quantidade || compararIds(a.m.id, b.m.id))
    .slice(0, LIMITE_LISTA.negativos)
    .map(({ m, quantidade }) => ({
      id: m.id ?? null,
      nome: verNome ? (texto(m.nome) || SEM_NOME) : null,
      quantidade,
      unidade: verUnidade ? texto(m.unidade) : null,
      processo: texto(m.processo)
    }));

  return {
    negativos: { quantidade: negativos.length, itens },
    zerados,
    criticos,
    limiteCritico: LIMITE_CRITICO,
    valorEstoque: saidaDeValor(valorEstoque, comValores)
  };
}

// ---------------------------------------------------------------------------
// 4.8 IA
// ---------------------------------------------------------------------------

/** 'revisao' = leitura pronta esperando conferência (SITUACOES em iaController). */
function resumirIa({ ia_extracoes: extracoes } = {}) {
  return {
    emRevisao: lista(extracoes).filter(e => normalizarTexto(e?.status) === 'revisao').length
  };
}

// ---------------------------------------------------------------------------
// Previsão de faturamento (SPEC-previsao)
// ---------------------------------------------------------------------------

/**
 * Vencimento de uma parcela: coluna DATE, corte de texto — e só se o dia existe
 * no calendário. '2026-02-30' passaria no corte e iria para fevereiro; aqui ele
 * é "sem data" e aparece em `semData`, em vez de virar um mês inventado.
 */
function diaDeVencimento(valor) {
  return diaDeCalendario(valor);
}

/** Os meses de `inicio` a `fim`, inclusive e sem buraco ('YYYY-MM' ordena como texto). */
function mesesEntre(inicio, fim) {
  const meses = [];
  for (let mes = inicio; mes <= fim; mes = deslocarMes(mes, 1)) meses.push(mes);
  return meses;
}

/**
 * Número do documento em ordem NATURAL: "PED99" antes de "PED100". Em ordem de
 * texto puro o PED100 vem antes, e a lista do tooltip parece embaralhada.
 */
function compararNumeroDoDocumento(a, b) {
  return String(a ?? '').localeCompare(String(b ?? ''), 'pt-BR', { numeric: true });
}

/** Sem data vai para o fim: quem tem vencimento é ordenado primeiro. */
function compararVencimento(a, b) {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

/**
 * As parcelas de UM pedido, em ordem de vencimento, cada uma com o seu número.
 * O número é o `numero_parcela` gravado; linha sem ele (legado) leva a posição
 * na ordem de vencimento — o "parcela 3 de 6" do tooltip tem de fechar com o
 * total mesmo assim.
 */
function parcelasDoPedido(linhas) {
  return linhas
    .map(linha => ({ linha, vencimento: diaDeVencimento(linha?.data_vencimento) }))
    .sort((a, b) =>
      compararVencimento(a.vencimento, b.vencimento) ||
      compararIds(a.linha?.numero_parcela, b.linha?.numero_parcela) ||
      compararIds(a.linha?.id, b.linha?.id))
    .map(({ linha, vencimento }, i) => {
      const gravado = paraDecimal(linha?.numero_parcela);
      return {
        numero: Number.isInteger(gravado) && gravado > 0 ? gravado : i + 1,
        vencimento,
        valor: dinheiro(linha?.valor)
      };
    });
}

/**
 * Previsão de faturamento: cada parcela no mês do SEU vencimento.
 *
 * O gráfico de vendas põe o pedido inteiro no mês em que foi gerado, mas o
 * dinheiro entra quando cada parcela vence — à vista, a prazo ou em 6x. Não
 * existe baixa de pagamento no banco: a parcela é só PROGRAMADA, nunca
 * "recebida" nem "vencida", e nada aqui afirma isso.
 *
 *   - Pedido cancelado não será faturado: as parcelas dele somem. Elas não
 *     são órfãs — o pedido existe —, só não contam. Órfã é a parcela cujo
 *     pedido não está na tabela; ela é contada em `orfas`, não somada.
 *   - `data_vencimento` é DATE: corte de texto. Pelo `new Date()` em São
 *     Paulo, a parcela de '2026-10-01T00:00:00.000Z' cairia em setembro.
 *   - Pedido sem nenhuma parcela (linha antiga, conversão que não copiou o
 *     parcelamento) entra UMA vez, estimado: o valor_final no dia em São Paulo
 *     da emissão — o mesmo dia em que ele conta como venda. Assim toda venda
 *     fechada aparece na previsão, e no tempo as duas séries somam o mesmo (a
 *     menos dos centavos do parcelamento).
 *   - A janela começa nos MESMOS 12 meses de `serie12m` (as barras de ouro e
 *     as verdes ficam lado a lado) e vai até o último mês com parcela, no
 *     máximo HORIZONTE_PREVISAO_MESES à frente. O que passa disso vai para
 *     `alemDoHorizonte`; o que vence antes da janela é histórico e fica fora.
 *   - O QUE SAIU da previsão aparece à parte, por mês de vencimento:
 *     `cancelado` (as parcelas dos pedidos cancelados) e `devolvido` (o que a
 *     devolução tirou das parcelas — `devolucao_parcelas`, que pode nem
 *     existir ainda). A parcela que a devolução reduziu já vem com o `valor`
 *     novo; a que ganhou abatimento no boleto ou teve parte reembolsada
 *     continua com o valor cheio gravado, e o desconto é tirado aqui. Parcela
 *     que zerou sai da previsão.
 *   - Nada é cortado calado: `semParcelas`, `orfas`, `semData` e
 *     `alemDoHorizonte` dizem o que ficou fora das barras, e `outros` diz
 *     quantos pedidos do mês não couberam na lista.
 *
 * `cliente` só sai com a coluna Cliente de Pedidos (COLUNAS_DE_TEXTO); o
 * número do pedido sai sempre. A seção inteira já exige as colunas de valor e
 * de condição (ver SECOES no controller), então os R$ saem sempre.
 */
function resumirPrevisao(
  { pedidos, pedido_parcelas: parcelas, clientes, devolucao_parcelas: devolvidas } = {},
  { agora = new Date(), pode = LIBERA_TUDO } = {}
) {
  const { mesAtual } = contextoDeTempo(agora);
  const inicio = deslocarMes(mesAtual, -11);
  const teto = deslocarMes(mesAtual, HORIZONTE_PREVISAO_MESES);
  const verCliente = pode(COLUNAS_DE_TEXTO.clienteDoPedido);
  const nomes = verCliente ? mapaDeNomes(clientes) : new Map();

  const conhecidos = new Set();
  const ativos = new Map();
  for (const p of lista(pedidos)) {
    if (!temValor(p?.id)) continue;
    conhecidos.add(String(p.id));
    if (situacaoDoPedido(p.situacao) !== 'Cancelado') ativos.set(String(p.id), p);
  }

  // O que a devolução tirou: por mês de vencimento (a série roxa) e, por
  // parcela, o que ainda precisa sair do valor gravado dela.
  const devolvidoPorMes = new Map();
  const aTirarDaParcela = new Map();
  for (const d of lista(devolvidas)) {
    const desconto = dinheiro(d?.desconto);
    if (!(desconto > 0)) continue;
    const mes = diaDeVencimento(d?.data_vencimento)?.slice(0, 7);
    if (mes) devolvidoPorMes.set(mes, (devolvidoPorMes.get(mes) || 0) + desconto);
    if (MODOS_QUE_NAO_BAIXAM_A_PARCELA.has(texto(d?.modo))) {
      const chave = `${d?.pedido_id}:${d?.numero_parcela}`;
      aTirarDaParcela.set(chave, (aTirarDaParcela.get(chave) || 0) + desconto);
    }
  }

  const linhasPorPedido = new Map();
  const canceladoPorMes = new Map();
  let orfas = 0;
  for (const linha of lista(parcelas)) {
    const pedidoId = temValor(linha?.pedido_id) ? String(linha.pedido_id) : null;
    if (pedidoId === null || !conhecidos.has(pedidoId)) {
      orfas += 1;
      continue;
    }
    if (!ativos.has(pedidoId)) {
      // Pedido cancelado: a parcela não será faturada — vai para a série vermelha.
      const mes = diaDeVencimento(linha?.data_vencimento)?.slice(0, 7);
      const valor = dinheiro(linha?.valor_original ?? linha?.valor);
      if (mes && valor > 0) canceladoPorMes.set(mes, (canceladoPorMes.get(mes) || 0) + valor);
      continue;
    }
    if (!linhasPorPedido.has(pedidoId)) linhasPorPedido.set(pedidoId, []);
    linhasPorPedido.get(pedidoId).push(linha);
  }

  // Cada parcela datada, já com o pedido dela. Um pedido estimado vira uma
  // "parcela 1 de 1" marcada `estimada`, para a tela trocar o texto dela.
  const lancamentos = [];
  const semParcelas = acumulador();
  let semData = 0;
  for (const [pedidoId, pedido] of ativos) {
    const linhas = linhasPorPedido.get(pedidoId);
    if (!linhas) {
      // Devolvido por inteiro e sem parcelas lançadas: não há o que programar.
      if (normalizarTexto(pedido.devolucao) === 'total') continue;
      const valor = dinheiro(pedido.valor_final);
      somar(semParcelas, valor);
      const dia = diaLocal(pedido.data_emissao);
      if (!dia) semData += 1;
      else lancamentos.push({ pedido, totalParcelas: 1, numero: 1, vencimento: dia, valor, estimada: true });
      continue;
    }
    for (const parcela of parcelasDoPedido(linhas)) {
      if (!parcela.vencimento) {
        semData += 1;
        continue;
      }
      const tirar = aTirarDaParcela.get(`${pedidoId}:${parcela.numero}`) || 0;
      const valor = Math.max(0, parcela.valor - tirar);
      // Parcela que a devolução zerou não está mais programada.
      if (!(valor > 0) && (tirar > 0 || temValor(pedido.devolucao))) continue;
      lancamentos.push({ pedido, totalParcelas: linhas.length, ...parcela, valor, estimada: false });
    }
  }

  const ultimoMes = lancamentos.reduce((maior, l) => {
    const mes = l.vencimento.slice(0, 7);
    return maior === null || mes > maior ? mes : maior;
  }, null);
  const fim = ultimoMes && ultimoMes > mesAtual ? (ultimoMes < teto ? ultimoMes : teto) : mesAtual;
  const meses = mesesEntre(inicio, fim);

  // mês -> pedido -> item. Os lançamentos já vêm em ordem de vencimento
  // dentro de cada pedido, então as parcelas de um item nascem ordenadas.
  const porMes = new Map(meses.map(mes => [mes, new Map()]));
  const alem = { valor: 0, parcelas: 0, ate: null };
  for (const l of lancamentos) {
    const mes = l.vencimento.slice(0, 7);
    if (mes > fim) {
      alem.valor += l.valor;
      alem.parcelas += 1;
      if (alem.ate === null || mes > alem.ate) alem.ate = mes;
      continue;
    }
    const doMes = porMes.get(mes);
    if (!doMes) continue;
    const chave = String(l.pedido.id);
    if (!doMes.has(chave)) {
      doMes.set(chave, { pedido: l.pedido, totalParcelas: l.totalParcelas, estimada: l.estimada, valor: 0, parcelas: [] });
    }
    const item = doMes.get(chave);
    item.valor += l.valor;
    item.parcelas.push(l);
  }

  const itemDeSaida = ({ pedido, totalParcelas, estimada, valor, parcelas: doItem }) => ({
    pedidoId: pedido.id ?? null,
    numero: texto(pedido.numero),
    cliente: verCliente
      ? ((temValor(pedido.cliente_id) && nomes.get(String(pedido.cliente_id))) || SEM_NOME)
      : null,
    totalParcelas,
    valor: arredondar(valor),
    estimada,
    parcelas: doItem.map(p => ({ numero: p.numero, vencimento: p.vencimento, valor: arredondar(p.valor) }))
  });

  let programado = alem.valor;
  const saida = meses.map(mes => {
    const itens = [...porMes.get(mes).values()].sort((a, b) =>
      a.parcelas[0].vencimento.localeCompare(b.parcelas[0].vencimento) ||
      compararNumeroDoDocumento(a.pedido.numero, b.pedido.numero) ||
      compararIds(a.pedido.id, b.pedido.id));
    const valor = itens.reduce((soma, item) => soma + item.valor, 0);
    if (mes >= mesAtual) programado += valor;
    return {
      mes,
      valor: arredondar(valor),
      cancelado: arredondar(canceladoPorMes.get(mes) || 0),
      devolvido: arredondar(devolvidoPorMes.get(mes) || 0),
      parcelas: itens.reduce((soma, item) => soma + item.parcelas.length, 0),
      pedidos: itens.length,
      outros: Math.max(0, itens.length - LIMITE_LISTA.previsao),
      itens: itens.slice(0, LIMITE_LISTA.previsao).map(itemDeSaida)
    };
  });

  return {
    meses: saida,
    programadoDesteMes: arredondar(programado),
    alemDoHorizonte: { valor: arredondar(alem.valor), parcelas: alem.parcelas, ate: alem.ate },
    semParcelas: { pedidos: semParcelas.quantidade, valor: arredondar(semParcelas.valor) },
    orfas,
    semData
  };
}

module.exports = {
  resumirVendas,
  resumirProducao,
  resumirOrcamentos,
  resumirAlertas,
  resumirProspeccao,
  resumirClientes,
  resumirEstoque,
  resumirIa,
  resumirPrevisao,
  contextoDeTempo,
  diaLocal,
  diaDeColunaDate,
  diferencaEmDias,
  somarDias,
  deslocarMes,
  situacaoDoPedido,
  situacaoNoPainel,
  valorDaVenda,
  normalizarTexto,
  ETAPAS,
  FAIXAS_IDADE,
  DIAS_DE_ATENCAO_EMBARQUE,
  LIMITE_CRITICO,
  LIMITE_LISTA,
  HORIZONTE_PREVISAO_MESES
};
