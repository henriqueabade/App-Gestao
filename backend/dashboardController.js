// Rota do Dashboard: GET /api/dashboard   (?atualizar=1 ignora o cache)
//
// As contas moram em dashboardResumo.js. Este arquivo decide QUEM vê O QUÊ e
// de onde os dados vêm. Três decisões moldam tudo aqui:
//
// 1. PERMISSÃO SEÇÃO A SEÇÃO, sem `exigirPermissao`. O módulo `dashboard` do
//    catálogo não tem chave nenhuma: `exigirPermissao('dashboard.x')` negaria
//    todo mundo (chave desconhecida é `false`), e `exigirPermissao([...])`
//    exige TODAS — quem não vê pedidos perderia o painel inteiro. Cada seção
//    pede as chaves do módulo de onde o número vem, e cada NOME pede a coluna
//    dele. Se as permissões não puderem ser conferidas, a resposta é 503 SEM
//    seção nenhuma: a tela falha aberta de propósito (`Permissoes.pode`
//    devolve true quando não sabe), então quem segura é o servidor — e um 200
//    vazio diria "seu perfil não tem indicadores", mentira quando o problema é
//    a sessão vencida ou o upstream fora do ar.
//
// 2. NADA DO PROXY GENÉRICO `GET /api/:table`. Ele não confere permissão e o
//    cache dele nunca expira. Aqui cada tabela é lida inteira (o upstream
//    ignora order/limit/select) com `createApiClient(req)`, e só as tabelas
//    das seções que o usuário pode ver. Tabela de itens e de movimentos não
//    entra: são as maiores do sistema e nenhum número daqui precisa delas.
//    `pedido_parcelas` entra, só para a previsão: de 1 a poucas linhas por
//    pedido, e sem ela não há como saber quando o dinheiro vence.
//
// 3. CACHE DE TABELA CRUA, 60 s, no molde do catalogoCache: guarda a PROMESSA
//    (a carga dupla do menu na abertura do app divide uma leitura em vez de
//    fazer duas) e falha não fica guardada. A chave leva a identidade de quem pediu: o app roda num
//    desktop, e outro login na mesma máquina não pode receber linhas lidas com
//    o token do anterior. O recorte por permissão é refeito a cada
//    requisição — o que se guarda é dado cru, nunca a resposta de alguém.

const express = require('express');
const crypto = require('crypto');
const { createApiClient, normalizeToken } = require('./apiHttpClient');
const { getToken } = require('./tokenStore');
const { obterPermissoesEfetivas } = require('./permissionsController');
const { can } = require('./permissionsRepository');
const resumo = require('./dashboardResumo');
const financeiro = require('./dashboardFinanceiro');

const router = express.Router();

const VALIDADE_MS = 60 * 1000;

/**
 * `apiHttpClient` não tem tempo-limite: um upstream pendurado segurava o painel
 * para sempre, com a máscara de carregamento do menu por cima. Cada tabela tem
 * 20 s. O ajuste por ambiente existe só para os testes não esperarem 20 s.
 */
const TEMPO_LIMITE_MS = (() => {
  const configurado = Number.parseInt(process.env.DASHBOARD_TEMPO_LIMITE_MS || '', 10);
  return Number.isFinite(configurado) && configurado > 0 ? configurado : 20 * 1000;
})();

const TEMPO_ESGOTADO = 'TEMPO_ESGOTADO';

/**
 * O que cada seção exige.
 *
 *   `exige`   TODAS as chaves, senão a seção nem é montada — e não aparece em
 *             `falhas`: sem permissão não é falha, é ausência.
 *   `valores` sem esta coluna os R$ saem `null` e as contagens continuam.
 *   `tabelas` as fontes do número: se uma falha, a seção vai para `falhas`.
 *   `nomes`   só dão nome às linhas das listas, no mesmo trato de
 *             orcamentosController e prospeccoesController ("nome é
 *             enfeite"): se a leitura falhar, a lista sai com "—" em vez de o
 *             card inteiro sumir. `prospeccoes` como fonte de nome só é lida
 *             para quem tem `pros.view`.
 *   `falha`   mensagem própria da seção quando QUALQUER fonte dela falha. Sem
 *             ela, vale a mensagem da tabela (FALHAS_DE_LEITURA).
 *   `extras`  tabelas que só ACRESCENTAM à seção e podem nem existir ainda (as
 *             da devolução nascem em sql/devolucoes.sql): se a leitura falhar,
 *             a seção sai sem elas — o que foi devolvido fica em zero, e as
 *             vendas e a previsão continuam.
 *
 * Previsão pede, além da view, as colunas Valor Total E Condição de Pedidos: o
 * cronograma de parcelas é valor + condição de pagamento, e quem não vê essas
 * colunas na grade não pode lê-lo aqui. Sem uma delas a seção nem existe — não
 * há "R$ null" que salve um gráfico feito só de dinheiro. É independente de
 * `vendas`: parcela fora do ar derruba só a previsão, e as barras de ouro ficam.
 *
 * Estoque pede `col_mp_estoque_atual` além da view: o card é feito de saldos,
 * e quem não pode ver a coluna Quantidade na grade não pode lê-la aqui.
 * Alertas pede orçamentos E pedidos: "aprovado sem pedido" revela os dois.
 *
 * Os NOMES das listas (cliente, destinatário, responsável, prospecção,
 * insumo) seguem a mesma regra do R$, cada um pela coluna dele: `pode` vai
 * junto para a conta, e o texto sai `null` para quem não vê a coluna na
 * grade. As chaves estão em COLUNAS_DE_TEXTO, em dashboardResumo.js.
 *
 * FINANCEIRO (decisão do dono, 24/09/2026): `receber`, `fiscal` e `pagar`,
 * cada uma atrás da permissão do Financeiro de onde vem, com as contas do
 * próprio módulo (dashboardFinanceiro.js). O Financeiro não tem colunas na
 * grade: quem vê a seção vê os R$ e os nomes, como no módulo.
 *   `carregar`    a seção que não sai de tabelas cruas: o painel do
 *                 Financeiro (comissões e produção) é apurado pelo próprio
 *                 módulo. O resultado entra no mesmo cache (60 s, por
 *                 identidade) e falha vira `falhas`, como a tabela.
 *   `complemento` o que só ACRESCENTA à seção e não é tabela (o certificado
 *                 digital da NF-e): falhou, a seção sai sem ele.
 */
const SECOES = [
  { nome: 'vendas', exige: ['ped.view'], valores: 'col_ped_total', tabelas: ['pedidos'], extras: ['devolucoes'], montar: resumo.resumirVendas },
  {
    nome: 'previsao',
    exige: ['ped.view', 'col_ped_total', 'col_ped_condicao'],
    tabelas: ['pedidos', 'pedido_parcelas'],
    extras: ['devolucao_parcelas'],
    nomes: ['clientes'],
    falha: 'Não foi possível ler as parcelas dos pedidos agora.',
    montar: resumo.resumirPrevisao
  },
  { nome: 'producao', exige: ['ped.view'], valores: 'col_ped_total', tabelas: ['pedidos'], nomes: ['clientes'], montar: resumo.resumirProducao },
  { nome: 'orcamentos', exige: ['orc.view'], valores: 'col_orc_total', tabelas: ['orcamentos'], nomes: ['clientes', 'prospeccoes'], montar: resumo.resumirOrcamentos },
  { nome: 'alertas', exige: ['orc.view', 'ped.view'], valores: 'col_orc_total', tabelas: ['orcamentos', 'pedidos'], nomes: ['clientes', 'prospeccoes'], montar: resumo.resumirAlertas },
  { nome: 'prospeccao', exige: ['pros.view'], valores: 'col_pros_valor', tabelas: ['prospeccoes'], montar: resumo.resumirProspeccao },
  { nome: 'clientes', exige: ['cli.view'], tabelas: ['clientes'], montar: resumo.resumirClientes },
  { nome: 'estoque', exige: ['mp.view', 'col_mp_estoque_atual'], valores: 'col_mp_custo_medio', tabelas: ['materia_prima'], montar: resumo.resumirEstoque },
  { nome: 'ia', exige: ['ia.view'], tabelas: ['ia_extracoes'], montar: resumo.resumirIa },
  {
    nome: 'receber',
    exige: ['financeiro.recebimento.view'],
    tabelas: ['pedidos', 'pedido_parcelas', 'recebimentos'],
    // Sem boletos, notas, ordens ou feriados a conta continua: é o que o
    // Financeiro faz quando a tabela ainda não existe.
    extras: ['boletos', 'notas_fiscais', 'ordens_pagamento', 'financeiro_feriados', 'boletos_eventos', 'configuracao_cobranca'],
    nomes: ['clientes'],
    falha: 'Não foi possível ler as contas a receber agora.',
    montar: financeiro.resumirReceber
  },
  {
    nome: 'fiscal',
    exige: ['financeiro.nfe.view'],
    tabelas: ['pedidos', 'notas_fiscais'],
    extras: ['notas_fiscais_externas'],
    nomes: ['clientes'],
    complemento: complementoFiscal,
    falha: 'Não foi possível ler as notas fiscais agora.',
    montar: financeiro.resumirFiscal
  },
  {
    nome: 'pagar',
    exige: ['financeiro.comissao.view'],
    tabelas: [],
    carregar: carregarPagar,
    falha: 'Não foi possível apurar as comissões e a produção agora.',
    montar: financeiro.resumirPagar
  }
];

/**
 * O painel de comissões e produção do mês, apurado pelo Financeiro (o mesmo
 * da tela do módulo). Carregado sob demanda: o require puxa o módulo inteiro.
 */
async function carregarPagar(api, { agora }) {
  const { hoje, mesAtual } = resumo.contextoDeTempo(agora);
  const cfg = await require('./cobranca/configuracaoCobranca').carregar(api).catch(() => null);
  return require('./financeiro/painel').carregar({ api, competencia: mesAtual, hoje, desde: cfg?.recebimentos_desde || null });
}

/**
 * O certificado digital e as pendências da configuração fiscal (o card "NF-e
 * com problema"). O resumo é o do roteador fiscal, que já guarda o
 * certificado aberto.
 */
async function complementoFiscal(api) {
  const configuracao = require('./fiscal/configuracaoFiscal');
  const fiscal = require('./fiscalController');
  const cfg = await configuracao.carregar(api);
  const certificado = typeof fiscal.resumoDoCertificado === 'function' ? await fiscal.resumoDoCertificado(api, cfg) : null;
  return { certificado, pendenciasConfiguracao: configuracao.pendencias(cfg) };
}

/** Mensagem curta do card em erro. Nunca o erro cru: ele cita rota e status do upstream. */
const FALHAS_DE_LEITURA = {
  pedidos: {
    erro: 'Não foi possível ler os pedidos agora.',
    demora: 'Os pedidos demoraram demais para responder.'
  },
  orcamentos: {
    erro: 'Não foi possível ler os orçamentos agora.',
    demora: 'Os orçamentos demoraram demais para responder.'
  },
  clientes: {
    erro: 'Não foi possível ler os clientes agora.',
    demora: 'Os clientes demoraram demais para responder.'
  },
  prospeccoes: {
    erro: 'Não foi possível ler as prospecções agora.',
    demora: 'As prospecções demoraram demais para responder.'
  },
  materia_prima: {
    erro: 'Não foi possível ler a matéria-prima agora.',
    demora: 'A matéria-prima demorou demais para responder.'
  },
  ia_extracoes: {
    erro: 'Não foi possível ler as leituras da IA agora.',
    demora: 'As leituras da IA demoraram demais para responder.'
  }
};

const FALHA_DE_MONTAGEM = 'Não foi possível montar este indicador agora.';

/** Corpo do 503: sem saber quem pede, não há recorte a aplicar (ver a rota). */
const PERMISSOES_INDISPONIVEIS = 'Não foi possível conferir suas permissões agora.';

// ---------------------------------------------------------------------------
// Cache de tabelas cruas
// ---------------------------------------------------------------------------

const cache = new Map(); // `${identidade}:${tabela}` -> { promessa, expiraEm }

/**
 * Quem está pedindo, na MESMA credencial que `createApiClient` vai usar
 * (cabeçalho; na falta dele, o token salvo). Guarda-se o sha256, não o token:
 * nem a chave do Map nem um eventual log carregam a credencial crua.
 */
function identidadeDe(req) {
  const credencial = normalizeToken(req?.headers?.authorization || '') || normalizeToken(getToken()) || '';
  return crypto.createHash('sha256').update(credencial).digest('hex');
}

/**
 * A leitura com prazo — de cada tabela e da identificação de quem pede. O
 * timer é SEMPRE limpo: sem isso, cada leitura rápida deixaria um timer vivo
 * segurando o processo por 20 s. A requisição que estourou segue até o fim lá
 * no fetch, mas o resultado dela é ignorado — e como o `race` já a assinou,
 * uma falha tardia não vira rejeição solta.
 */
function comTempoLimite(promessa, ms, rotulo) {
  let timer = null;
  const estouro = new Promise((_, rejeitar) => {
    timer = setTimeout(() => {
      const erro = new Error(`Tempo esgotado ao ler ${rotulo} (${ms} ms)`);
      erro.code = TEMPO_ESGOTADO;
      rejeitar(erro);
    }, ms);
  });
  return Promise.race([promessa, estouro]).finally(() => clearTimeout(timer));
}

/**
 * Resposta que não é lista é FALHA, não lista vazia: zero pedidos no painel
 * seria uma afirmação, e falsa.
 */
function extrairLinhas(dados, tabela) {
  if (Array.isArray(dados)) return dados;
  if (Array.isArray(dados?.data)) return dados.data;
  throw new Error(`Resposta inesperada ao ler ${tabela}`);
}

function varrerVencidos(agora) {
  for (const [chave, item] of cache) {
    if (item.expiraEm <= agora) cache.delete(chave);
  }
}

/**
 * Lê a tabela, reaproveitando o que ainda vale para ESTA identidade.
 *
 * `lidoEm` é o instante em que a leitura foi pedida: o dado é no mínimo tão
 * novo quanto isso, então o "Atualizado às" da tela nunca promete mais frescor
 * do que tem. Entradas vencidas saem a cada leitura — cada login gera chaves
 * novas, e sem a varredura o Map só cresceria.
 */
function lerTabela(api, identidade, tabela, { opcional = false } = {}) {
  const agora = Date.now();
  varrerVencidos(agora);

  const chave = `${identidade}:${tabela}`;
  const guardado = cache.get(chave);
  if (guardado) return guardado.promessa;

  const promessa = comTempoLimite(api.get(`/api/${tabela}`), TEMPO_LIMITE_MS, tabela)
    .then(dados => ({ linhas: extrairLinhas(dados, tabela), lidoEm: agora }))
    .catch(err => {
      // Tabela OPCIONAL que não veio (as da devolução, antes de sql/devolucoes.sql):
      // vale como vazia, e a ausência fica guardada pelo prazo do cache — sem isso
      // cada recarga do painel bateria de novo numa tabela que não existe.
      if (opcional) return { linhas: [], lidoEm: agora };
      // Falha (ou estouro de tempo) não fica em cache: a próxima tentativa
      // tem de ir ao upstream. Só apaga se a entrada ainda for ESTA promessa —
      // um `?atualizar=1` no meio pode já ter posto outra no lugar.
      if (cache.get(chave)?.promessa === promessa) cache.delete(chave);
      throw err;
    });

  cache.set(chave, { promessa, expiraEm: agora + VALIDADE_MS });
  return promessa;
}

/**
 * O que não é tabela crua (o `carregar` e o `complemento` de uma seção), no
 * mesmo cache e com o mesmo prazo. A chave leva `@` para nunca colidir com o
 * nome de uma tabela. Falha não fica guardada.
 */
function lerCalculado(identidade, chave, calcular) {
  const agora = Date.now();
  varrerVencidos(agora);

  const chaveCache = `${identidade}:@${chave}`;
  const guardado = cache.get(chaveCache);
  if (guardado) return guardado.promessa;

  const promessa = comTempoLimite(Promise.resolve().then(calcular), TEMPO_LIMITE_MS, chave)
    .then(dados => ({ dados, lidoEm: agora }))
    .catch(err => {
      if (cache.get(chaveCache)?.promessa === promessa) cache.delete(chaveCache);
      throw err;
    });

  cache.set(chaveCache, { promessa, expiraEm: agora + VALIDADE_MS });
  return promessa;
}

/** Descarta tudo o que está guardado, de todos os usuários. */
function invalidar() {
  cache.clear();
}

// ---------------------------------------------------------------------------
// Rota
// ---------------------------------------------------------------------------

/**
 * Permissões de quem pediu, ou `null` quando não dá para saber: exceção,
 * estouro do prazo, resposta vazia, ou o objeto marcado `erro: true` — o que
 * `obterPermissoesEfetivas` devolve quando não identifica o usuário (token
 * vencido, upstream fora). `null` vira 503 na rota — ver o topo do arquivo.
 *
 * O prazo é o mesmo das tabelas. Sem ele, uma identificação pendurada segurava
 * a requisição até o tempo-limite do undici (~300 s), e a tela desistia antes,
 * aos 30 s, com "demorou demais".
 */
async function permissoesOuNada(req) {
  try {
    const permissoes = await comTempoLimite(obterPermissoesEfetivas(req), TEMPO_LIMITE_MS, 'permissoes');
    if (!permissoes || typeof permissoes !== 'object' || permissoes.erro === true) return null;
    return permissoes;
  } catch (err) {
    console.warn('[dashboard] permissões indisponíveis; painel fechado:', err?.message || err);
    return null;
  }
}

function tabelasDaSecao(secao, nomeDeProspeccao) {
  const nomes = (secao.nomes || []).filter(t => t !== 'prospeccoes' || nomeDeProspeccao);
  return [...secao.tabelas, ...(secao.extras || []), ...nomes];
}

function mensagemDeFalha(tabela, erro) {
  const mensagens = FALHAS_DE_LEITURA[tabela];
  if (!mensagens) return 'Não foi possível ler os dados agora.';
  return erro?.code === TEMPO_ESGOTADO ? mensagens.demora : mensagens.erro;
}

router.get('/', async (req, res) => {
  // Dado de negócio por usuário: nem o cache de disco do Chromium deve guardá-lo.
  res.set('Cache-Control', 'no-store');

  try {
    const agora = new Date();
    const { hoje, mesAtual } = resumo.contextoDeTempo(agora);
    const responder = (secoes, falhas, geradoEm = agora) =>
      res.json({ geradoEm: geradoEm.toISOString(), hoje, mesAtual, secoes, falhas });

    const permissoes = await permissoesOuNada(req);
    // 503, e não 200 vazio. Vazio é a resposta de quem de fato não tem módulo
    // nenhum, e a tela a traduz como "Seu perfil ainda não tem indicadores
    // liberados": mandar falar com o administrador por causa de uma sessão
    // vencida é mentira. Continua fechado — nenhuma seção sai, nenhuma tabela
    // é lida, nada fica guardado, e a próxima chamada tenta de novo.
    if (!permissoes) return res.status(503).json({ error: PERMISSOES_INDISPONIVEIS });

    const pode = chave => can(permissoes, chave);
    const visiveis = SECOES.filter(secao => secao.exige.every(pode));
    if (!visiveis.length) return responder({}, {});

    const nomeDeProspeccao = pode('pros.view');
    const necessarias = [...new Set(visiveis.flatMap(secao => tabelasDaSecao(secao, nomeDeProspeccao)))];
    // Opcional só a tabela que NENHUMA seção visível exige: as notas fiscais
    // são extras das contas a receber e a fonte da seção fiscal — se a leitura
    // falhar, a seção fiscal tem de ir para `falhas`, não sair com zero nota.
    const obrigatorias = new Set(visiveis.flatMap(secao => secao.tabelas));
    const extras = new Set(visiveis.flatMap(secao => secao.extras || []).filter(t => !obrigatorias.has(t)));

    if (String(req.query?.atualizar ?? '') === '1') invalidar();

    const api = createApiClient(req);
    const identidade = identidadeDe(req);
    // O que não é tabela (Financeiro): em paralelo com as leituras.
    const calculos = Promise.all(visiveis.map(async secao => {
      const [carregado, complemento] = await Promise.allSettled([
        secao.carregar ? lerCalculado(identidade, `${secao.nome}:carregar`, () => secao.carregar(api, { agora })) : Promise.resolve(null),
        secao.complemento ? lerCalculado(identidade, `${secao.nome}:complemento`, () => secao.complemento(api, { agora })) : Promise.resolve(null)
      ]);
      return [secao.nome, { carregado, complemento }];
    })).then(pares => new Map(pares));
    // allSettled: uma tabela fora do ar derruba SÓ as seções que dependem dela.
    const leituras = await Promise.allSettled(necessarias.map(t => lerTabela(api, identidade, t, { opcional: extras.has(t) })));
    const calculados = await calculos;

    const linhas = {};
    const lidoEm = {};
    const erros = {};
    necessarias.forEach((tabela, i) => {
      const leitura = leituras[i];
      if (leitura.status === 'fulfilled') {
        linhas[tabela] = leitura.value.linhas;
        lidoEm[tabela] = leitura.value.lidoEm;
      } else {
        erros[tabela] = leitura.reason;
        console.warn(`[dashboard] falha ao ler ${tabela}:`, leitura.reason?.message || leitura.reason);
      }
    });

    const secoes = {};
    const falhas = {};
    const usadas = new Set();
    const instantesCalculados = [];
    for (const secao of visiveis) {
      const tabelaQueFalhou = secao.tabelas.find(t => erros[t]);
      if (tabelaQueFalhou) {
        falhas[secao.nome] = secao.falha || mensagemDeFalha(tabelaQueFalhou, erros[tabelaQueFalhou]);
        continue;
      }
      const { carregado, complemento } = calculados.get(secao.nome) || {};
      if (secao.carregar && carregado?.status !== 'fulfilled') {
        console.warn(`[dashboard] falha ao apurar ${secao.nome}:`, carregado?.reason?.message || carregado?.reason);
        falhas[secao.nome] = secao.falha || FALHA_DE_MONTAGEM;
        continue;
      }
      if (secao.complemento && complemento?.status === 'rejected') {
        console.warn(`[dashboard] ${secao.nome} sai sem o complemento:`, complemento.reason?.message || complemento.reason);
      }
      try {
        secoes[secao.nome] = secao.montar(secao.carregar ? carregado.value.dados : linhas, {
          agora,
          comValores: secao.valores ? pode(secao.valores) : true,
          nomeDeProspeccao,
          // Os nomes, coluna a coluna: a conta pergunta, o recorte é daqui.
          pode,
          complemento: complemento?.status === 'fulfilled' ? complemento.value?.dados ?? null : null
        });
        if (secao.carregar) instantesCalculados.push(carregado.value.lidoEm);
        tabelasDaSecao(secao, nomeDeProspeccao)
          .filter(t => lidoEm[t] !== undefined)
          .forEach(t => usadas.add(t));
      } catch (err) {
        // Uma linha torta que quebre a conta de UMA seção não pode levar o
        // painel inteiro junto: a seção vai para `falhas` e o resto sai.
        console.error(`[dashboard] falha ao montar a seção ${secao.nome}:`, err);
        falhas[secao.nome] = FALHA_DE_MONTAGEM;
      }
    }

    // `geradoEm` é a leitura MAIS ANTIGA entre as tabelas usadas. Se veio do
    // cache, é a hora do cache: a hora da resposta mentiria sobre um dado de
    // até um minuto atrás.
    const instantes = [...[...usadas].map(t => lidoEm[t]), ...instantesCalculados];
    return responder(secoes, falhas, instantes.length ? new Date(Math.min(...instantes)) : agora);
  } catch (err) {
    console.error('[dashboard] erro inesperado ao montar o painel:', err?.message || err);
    return res.status(500).json({ error: 'Não foi possível montar o painel agora.' });
  }
});

module.exports = router;
module.exports.invalidar = invalidar;
module.exports.SECOES = SECOES;
module.exports.VALIDADE_MS = VALIDADE_MS;
module.exports.TEMPO_LIMITE_MS = TEMPO_LIMITE_MS;
