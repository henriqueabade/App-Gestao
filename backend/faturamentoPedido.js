/**
 * Datas do faturamento de um pedido — de quando o prazo das parcelas conta.
 *
 * O VENCIMENTO de cada parcela é o início do faturamento mais o prazo em dias
 * daquela parcela (`pedidos.prazo` "0/30/60", na ordem de `numero_parcela`).
 * Pedido legado, sem início gravado, conta do dia (em São Paulo) da emissão —
 * que é a conta que a tela de pagamento sempre fez.
 *
 * O início sai de uma de três regras (`pedidos.faturamento_regra`):
 *
 *   ao_embarcar   começa na previsão de embarque. Se o pedido EMBARCAR DEPOIS
 *                 da previsão, passa a contar do embarque real e as parcelas
 *                 são reprogramadas. Embarque no dia ou adiantado não muda
 *                 nada — o início nunca vem antes da previsão.
 *   ao_converter  o dia em que o orçamento virou pedido.
 *   data          uma data escolhida.
 *
 * DUAS ARMADILHAS DE DATA, que já custaram um dia em outras telas:
 *
 *   - `embarcar_previsao`, `embarcar_real`, `inicio_faturamento` e
 *     `pedido_parcelas.data_vencimento` são DATE. O upstream pode entregá-las
 *     como '2026-09-13T00:00:00.000Z'; passar isso por `new Date()` em São
 *     Paulo dá o dia 12. Aqui elas são CORTADAS como texto, nunca convertidas.
 *   - "Hoje" e o dia da emissão são o dia de São Paulo. `toISOString()` dá o
 *     dia UTC, que das 21h à meia-noite já é amanhã.
 *
 * Só conta, sem requisição — exceto a projeção/reprogramação das parcelas,
 * que recebem o cliente da API pronto e não sabem de onde ele veio.
 */

const FUSO = 'America/Sao_Paulo';
const REGRAS_FATURAMENTO = ['ao_embarcar', 'ao_converter', 'data'];
const { travasDasParcelas } = require('./pedidoParcelas');

const formatadorDia = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit'
});

/**
 * 'YYYY-MM-DD' de uma coluna DATE, ou null.
 *
 * Aceita o texto puro e o ISO serializado ('2026-09-13T00:00:00.000Z' vira
 * '2026-09-13'), sempre por corte. Recusa o dia que não existe: 2026-02-30
 * passa pelo formato, e o banco só o recusaria no meio da gravação.
 */
function diaValido(valor) {
  if (typeof valor !== 'string') return null;
  const achado = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(valor.trim());
  if (!achado) return null;
  const [, a, m, d] = achado.map(Number);
  // A volta pelo calendário pega o dia impossível — e também o ano de dois
  // dígitos, que `Date.UTC` leria como 19xx.
  const volta = new Date(Date.UTC(a, m - 1, d));
  if (volta.getUTCFullYear() !== a || volta.getUTCMonth() !== m - 1 || volta.getUTCDate() !== d) {
    return null;
  }
  return `${achado[1]}-${achado[2]}-${achado[3]}`;
}

/**
 * Dia de São Paulo ('YYYY-MM-DD') de um INSTANTE — `data_emissao` é TIMESTAMP.
 *
 * Monta pelas partes em vez de confiar no padrão do 'en-CA': o formato dessa
 * localidade já mudou entre versões do ICU. Texto que é SÓ data volta como
 * está: `new Date('2026-09-13')` é meia-noite UTC, que em São Paulo é dia 12.
 */
function diaEmSaoPaulo(instante) {
  if (instante === null || instante === undefined || instante === '') return null;
  if (typeof instante === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(instante.trim())) {
    return diaValido(instante);
  }
  const quando = instante instanceof Date ? instante : new Date(instante);
  if (Number.isNaN(quando.getTime())) return null;
  const partes = {};
  for (const p of formatadorDia.formatToParts(quando)) partes[p.type] = p.value;
  return `${partes.year}-${partes.month}-${partes.day}`;
}

/** Hoje, em São Paulo. O relógio é injetável para os testes. */
function hojeEmSaoPaulo(agora = new Date()) {
  return diaEmSaoPaulo(agora);
}

/** `dia` + `n` dias, sobre as partes da data — sem hora local, sem horário de verão. */
function somarDias(dia, n) {
  const base = diaValido(dia);
  if (!base) return null;
  const [a, m, d] = base.split('-').map(Number);
  const dias = Math.trunc(Number(n)) || 0;
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** Um vencimento por prazo: início + os dias de cada parcela. */
function calcularVencimentos(inicio, prazos = []) {
  return (Array.isArray(prazos) ? prazos : []).map(dias => somarDias(inicio, dias));
}

/**
 * Os dias de cada parcela, a partir de `pedidos.prazo` ("0/30/60").
 *
 * O texto é a ÚNICA fonte dos dias: `pedido_parcelas` não tem coluna de
 * prazo. Com `quantidade`, devolve exatamente um prazo por parcela: faltando
 * segmento, repete o último ("30" para três parcelas vira 30/30/30); texto
 * vazio vira zeros. Segmento que não é número é ignorado, e prazo negativo
 * também — não existe parcela vencendo antes de o faturamento começar.
 */
function prazosDoTexto(prazo, quantidade) {
  const lidos = String(prazo ?? '')
    .split('/')
    .map(parte => parseInt(parte, 10))
    .filter(n => Number.isFinite(n) && n >= 0);
  if (quantidade === undefined || quantidade === null) return lidos;

  const total = Math.max(0, Math.trunc(Number(quantidade)) || 0);
  const ultimo = lidos.length ? lidos[lidos.length - 1] : 0;
  return Array.from({ length: total }, (_, i) => (i < lidos.length ? lidos[i] : ultimo));
}

const vazio = v => v === undefined || v === null || String(v).trim() === '';

/**
 * Confere o FORMATO das datas escolhidas, sem resolver o início.
 *
 * Existe separado de `resolverDatas` porque a rota do pedido precisa recusar
 * o formato antes de ler o banco, e só depois de ler sabe o dia da conversão.
 * `inicio_faturamento` só vem preenchido na regra 'data'; nas outras ele
 * depende do pedido.
 */
function validarDatas(entrada) {
  const dados = entrada && typeof entrada === 'object' ? entrada : {};

  if (vazio(dados.embarcar_previsao)) {
    return { ok: false, erro: 'Informe a previsão de embarque.' };
  }
  const embarcarPrevisao = diaValido(dados.embarcar_previsao);
  if (!embarcarPrevisao) {
    return { ok: false, erro: 'A previsão de embarque não é uma data válida.' };
  }

  const regra = vazio(dados.faturamento_regra) ? '' : String(dados.faturamento_regra).trim();
  if (!regra) {
    return { ok: false, erro: 'Escolha quando o faturamento começa.' };
  }
  if (!REGRAS_FATURAMENTO.includes(regra)) {
    return { ok: false, erro: 'Opção de início do faturamento desconhecida.' };
  }

  let inicioInformado = null;
  if (regra === 'data') {
    if (vazio(dados.inicio_faturamento)) {
      return { ok: false, erro: 'Informe a data de início do faturamento.' };
    }
    inicioInformado = diaValido(dados.inicio_faturamento);
    if (!inicioInformado) {
      return { ok: false, erro: 'A data de início do faturamento não é uma data válida.' };
    }
  }

  return {
    ok: true,
    embarcar_previsao: embarcarPrevisao,
    faturamento_regra: regra,
    inicio_faturamento: inicioInformado
  };
}

/**
 * Confere e resolve as datas — do modal da conversão ou do botão no
 * pagamento. Devolve as três colunas prontas para gravar, ou a mensagem que o
 * usuário vai ler.
 *
 * `dataConversao` é o dia (em São Paulo) em que o orçamento virou pedido:
 * hoje, na conversão; o dia da emissão, para um pedido que já existe.
 */
function resolverDatas(entrada, { dataConversao } = {}) {
  const formato = validarDatas(entrada);
  if (!formato.ok) return formato;

  let inicio = formato.inicio_faturamento;
  if (formato.faturamento_regra === 'ao_embarcar') {
    inicio = formato.embarcar_previsao;
  } else if (formato.faturamento_regra === 'ao_converter') {
    inicio = diaValido(dataConversao);
    if (!inicio) {
      return {
        ok: false,
        erro: 'Não foi possível saber o dia da conversão deste pedido. Escolha outra opção de início do faturamento.'
      };
    }
  }

  return {
    ok: true,
    embarcar_previsao: formato.embarcar_previsao,
    faturamento_regra: formato.faturamento_regra,
    inicio_faturamento: inicio
  };
}

/**
 * De onde os prazos do pedido contam: o início gravado ou, no legado, o dia
 * da emissão em São Paulo. `null` quando não há nenhum dos dois.
 */
function baseDoFaturamento(pedido) {
  return diaValido(pedido?.inicio_faturamento) || diaEmSaoPaulo(pedido?.data_emissao) || null;
}

/**
 * O novo início do faturamento quando o pedido embarca, ou `null` (não muda).
 *
 * Só a regra 'ao_embarcar' reage ao embarque: o início passa a ser o dia REAL
 * do embarque, antes ou depois da previsão — a previsão só valia até o pedido
 * embarcar. Se o dia real já é o início gravado, nada muda.
 */
function inicioAposEmbarque(pedido, embarcarReal) {
  if (String(pedido?.faturamento_regra || '').trim() !== 'ao_embarcar') return null;
  const real = diaValido(embarcarReal);
  if (!real) return null;
  return real === diaValido(pedido?.inicio_faturamento) ? null : real;
}

const formatarDia = dia => {
  const [a, m, d] = String(dia).split('-');
  return `${d}/${m}/${a}`;
};

/**
 * Projeta, sem escrever, os vencimentos LIVRES a partir de `inicio`.
 * Pagamentos/boletos/ordens preservam as datas já registradas. É a mesma
 * conta usada pelo espelho, pelo XML e pela gravação ao enviar o pedido.
 * Erros de leitura viram avisos; desconhecer os vínculos não libera datas.
 */
async function projetarParcelas(api, pedidoId, inicio, prazoTexto, avisos = []) {
  const base = diaValido(inicio);
  if (!base) {
    avisos.push('Início do faturamento inválido: os vencimentos das parcelas não foram recalculados.');
    return [];
  }

  let lidas;
  try {
    lidas = await api.get('/api/pedido_parcelas', { query: { pedido_id: pedidoId } });
    if (!Array.isArray(lidas)) throw new Error('A API não devolveu uma lista válida de parcelas.');
  } catch (err) {
    avisos.push(`Não foi possível ler as parcelas para reprogramar os vencimentos: ${err?.message || err}`);
    return [];
  }

  const parcelas = (Array.isArray(lidas) ? lidas : [])
    // O filtro é conferido aqui também: se o upstream o ignorasse, a tabela
    // inteira voltaria — e os vencimentos de TODOS os pedidos seriam
    // reescritos com os prazos deste.
    .filter(p => p?.id !== undefined && p?.id !== null && String(p.pedido_id) === String(pedidoId))
    // O upstream ignora `order`: devolve na ordem de inserção. É a ordem de
    // `numero_parcela` que casa cada parcela com o seu prazo.
    .sort((a, b) => (Number(a.numero_parcela) || 0) - (Number(b.numero_parcela) || 0)
      || (Number(a.id) || 0) - (Number(b.id) || 0));

  if (!parcelas.length) return [];
  // Ler as travas também na reprogramação automática: o embarque e a
  // emissão não podem desfazer a data real de uma parcela paga/importada.
  const vinculos = {};
  let podeReprogramar = true;
  const query = { pedido_id: pedidoId };
  // URLs literais também permitem ao gerador de política da API reconhecer
  // as leituras necessárias nas rotas de emissão e conferência da NF-e.
  await Promise.all([
    { campo: 'boletos', tabela: 'boletos', ler: () => api.get('/api/boletos', { query }) },
    { campo: 'recebimentos', tabela: 'recebimentos', ler: () => api.get('/api/recebimentos', { query }) },
    { campo: 'externos', tabela: 'boletos_externos', ler: () => api.get('/api/boletos_externos', { query }) },
    { campo: 'ordens', tabela: 'ordens_pagamento', ler: () => api.get('/api/ordens_pagamento', { query }) }
  ].map(async ({ campo, tabela, ler }) => {
    try {
      const resposta = await ler();
      if (resposta?.error) throw new Error(String(resposta.error));
      if (!Array.isArray(resposta) && (!resposta || typeof resposta !== 'object' || resposta.id === undefined)) {
        throw new Error(`A API não devolveu uma lista válida de ${tabela}.`);
      }
      const lista = Array.isArray(resposta) ? resposta : (resposta?.id ? [resposta] : []);
      vinculos[campo] = lista.filter(l => String(l?.pedido_id) === String(pedidoId));
    } catch (err) {
      // Tabela de uma fase ainda não instalada é legado sem vínculos;
      // falha de permissão/rede não é prova de que a parcela está livre.
      const texto = `${err?.message || ''} ${err?.body?.error || ''} ${err?.body?.detalhe || ''}`;
      const ausente = err?.code === '42P01' || (err?.status === 404 && /tabela|table|não encontrada|does not exist/i.test(texto));
      if (!ausente) {
        podeReprogramar = false;
        avisos.push(`Não foi possível conferir ${tabela}: os vencimentos registrados foram preservados (${err?.message || err}).`);
      }
      vinculos[campo] = [];
    }
  }));
  const travas = travasDasParcelas({ parcelas, ...vinculos });
  const vencimentos = calcularVencimentos(base, prazosDoTexto(prazoTexto, parcelas.length));
  return parcelas.map((parcela, i) => ({
    ...parcela,
    data_vencimento: !podeReprogramar || travas.has(Number(parcela.numero_parcela))
      ? diaValido(parcela.data_vencimento) : vencimentos[i]
  }));
}

/**
 * Persiste a mesma projeção somente quando a operação de envio a pede.
 * Um PUT por parcela alterada, mantendo os ids. Cada falha vira aviso, e
 * a resposta mostra a data que continuou salva, sem fingir sucesso.
 */
async function reprogramarParcelas(api, pedidoId, inicio, prazoTexto, avisos = []) {
  // A leitura inicial fica aqui para devolver a data realmente salva mesmo
  // quando um PUT isolado falhar. A projeção nunca escreve no banco.
  const atuais = new Map();
  const apiComRetrato = {
    get: async (caminho, opcoes) => {
      const resposta = await api.get(caminho, opcoes);
      if (caminho === '/api/pedido_parcelas') {
        for (const p of Array.isArray(resposta) ? resposta : []) {
          if (String(p?.pedido_id) === String(pedidoId)) atuais.set(String(p.id), diaValido(p.data_vencimento));
        }
      }
      return resposta;
    }
  };
  const parcelas = await projetarParcelas(apiComRetrato, pedidoId, inicio, prazoTexto, avisos);

  const resultado = [];
  for (let i = 0; i < parcelas.length; i++) {
    const parcela = parcelas[i];
    const atual = atuais.get(String(parcela.id)) ?? null;
    const novo = diaValido(parcela.data_vencimento);
    let gravado = atual;
    if (novo !== atual) {
      try {
        await api.put(`/api/pedido_parcelas/${parcela.id}`, { data_vencimento: novo });
        gravado = novo;
      } catch (err) {
        avisos.push(
          `Parcela ${parcela.numero_parcela ?? i + 1}: não foi possível mudar o vencimento para `
          + `${formatarDia(novo)}; continua em ${atual ? formatarDia(atual) : '(sem data)'} `
          + `(${err?.message || err}).`
        );
      }
    }
    resultado.push({
      id: parcela.id,
      numero_parcela: parcela.numero_parcela ?? null,
      valor: parcela.valor === undefined || parcela.valor === null ? null : Number(parcela.valor),
      data_vencimento: gravado
    });
  }
  return resultado;
}

module.exports = {
  REGRAS_FATURAMENTO,
  diaValido,
  diaEmSaoPaulo,
  hojeEmSaoPaulo,
  somarDias,
  calcularVencimentos,
  prazosDoTexto,
  validarDatas,
  resolverDatas,
  baseDoFaturamento,
  inicioAposEmbarque,
  projetarParcelas,
  reprogramarParcelas
};
