/**
 * Rateio da produção (24/09/2026) — o modal próprio e as correções do
 * "Fechar competência — produção" que o dono pediu.
 *
 * O que não pode se perder:
 *   - o rateio é da PRODUÇÃO e por PROCESSO de cada peça, em modal único
 *     (a aba nas Regras saiu);
 *   - cada processo mostra o que falta, e há o atalho "mesma divisão nos
 *     outros processos" da mesma peça;
 *   - dá para ratear o que já foi decidido, mesmo com outros pedidos
 *     esperando confirmação;
 *   - no Fechar competência: "Nada pronto" vermelho, "Tudo"/"Nada" por peça,
 *     botões visíveis e inativos quando já confirmado, datas no hover e as
 *     peças sem regra listadas;
 *   - peças e processos são números diferentes.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..');
const ler = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');
const lerBack = nome => fs.readFileSync(path.join(RAIZ, '..', 'backend', nome), 'utf8');
const HTML = ler('html', 'modals', 'financeiro', 'rateio-producao.html');
const REGRAS_HTML = ler('html', 'modals', 'financeiro', 'regras.html');
const FIN_HTML = ler('html', 'financeiro.html');
const FONTE = ler('js', 'modals', 'financeiro-modais.js');
const MODULO = ler('js', 'financeiro.js');
const FECHAMENTOS = lerBack('financeiro/fechamentos.js');
const PAINEL = lerBack('financeiro/painel.js');
const CONTROLLER = lerBack('financeiroController.js');

test('o rateio virou modal próprio, e a aba das Regras saiu', () => {
  assert.ok(!REGRAS_HTML.includes('data-fin-aba="colaboradores"'), 'a aba não existe mais');
  assert.ok(!FONTE.includes('montarColaboradores'), 'o código da aba saiu junto');

  assert.ok(MODULO.includes("'rateio-producao': { html: 'modals/financeiro/rateio-producao.html', overlay: 'finRateioProducao' }"));
  assert.ok(MODULO.includes("'rateio-producao': { rotulo: 'Rateio da produção'"), 'entra no mapa de destinos');
  assert.ok(FIN_HTML.includes('data-fin-acao="rateio-producao"'), 'e nas Ações rápidas');
  assert.ok(FONTE.includes('finRateioProducao: montarRateioProducao'), 'o montador está ligado ao overlay');

  for (const id of ['finRateioProducaoOverlay', 'finRateioSemSql', 'finRateioCompetencia', 'finRateioBuscar',
    'finRateioIndicadores', 'finRateioMensagem', 'finRateioEsperando', 'finRateioColabNome', 'finRateioColabSalvar',
    'finRateioColabLista', 'finRateioPecas', 'finRateioVazio', 'finRateioPorPessoa', 'finRateioFecharCompetencia']) {
    assert.ok(HTML.includes(`id="${id}"`), `sem #${id}`);
  }
  assert.ok(/id="finRateioColabSalvar"[^>]*data-perm="financeiro\.regras\.editar"/.test(HTML));
  assert.ok(/id="finRateioFecharCompetencia"[^>]*data-perm="financeiro\.competencia\.fechar"/.test(HTML));
  assert.ok(HTML.includes('sql/producao_colaboradores_rateio.sql'), 'diz qual SQL falta');
  // É produção, não comissão: a palavra certa em toda a tela.
  assert.ok(!/comiss/i.test(HTML), 'nenhuma menção a comissão nesta tela');
});

test('cada processo mostra o que falta e a peça tem o atalho de copiar a divisão', () => {
  const inicio = FONTE.indexOf('function montarRateioProducao(');
  const fim = FONTE.indexOf('// ------------------------------------------------ configuração fiscal', inicio);
  assert.ok(inicio > 0 && fim > inicio);
  const bloco = FONTE.slice(inicio, fim);

  assert.ok(bloco.includes("processo.completo ? '100%' : `faltam ${pct(processo.restante)}`"));
  assert.ok(bloco.includes("processo.completo ? 'badge-success' : 'badge-warning'"));
  assert.ok(bloco.includes('barra.style.width = `${Math.min(100, Number(processo.distribuido) || 0)}%`'));
  assert.ok(bloco.includes('const jaEstao = new Set(processo.linhas.map(l => String(l.colaborador_id)))'), 'quem já está sai da lista');
  assert.ok(bloco.includes('valor.placeholder = `até ${pct(processo.restante)}`'));
  assert.ok(bloco.includes('`Dar os ${pct(processo.restante)}`'));
  assert.ok(bloco.includes('if (podeEditar && !estado.fechado && !processo.completo)'), 'processo cheio não oferece mais ninguém');

  // O atalho da peça (decisão a1 do dono).
  assert.ok(bloco.includes('const modelo = peca.processos.find(p => p.completo)'));
  assert.ok(bloco.includes('Mesma divisão nos outros'));
  assert.ok(bloco.includes("fetchApi('/api/financeiro/rateio/peca'"));
  assert.ok(bloco.includes('setores: peca.processos.filter(p => p.setor_id !== modelo.setor_id).map(p => p.setor_id)'));

  // O que ainda espera decisão aparece como aviso, e não impede ratear o resto.
  assert.ok(bloco.includes("const esperando = (estado.bloqueios || []).filter(b => !/distribuí/i.test(b))"));
  assert.ok(!/innerHTML|insertAdjacentHTML/.test(bloco), 'tudo por createElement');
});

test('Fechar competência — produção: Nada pronto, Tudo/Nada por peça, inativos e datas no hover', () => {
  assert.ok(FONTE.includes("botaoDoPedido('Nada pronto', 'btn-danger text-white'"), 'o botão vermelho do pedido');
  assert.ok(FONTE.includes('async function marcarPedidoInteiro('), 'e a ação dele');
  assert.ok(FONTE.includes("prontas: 0 }))"), 'nada pronto grava zero em todos os processos');
  assert.ok(FONTE.includes("botaoDaPeca('Tudo', 'btn-success'") && FONTE.includes("botaoDaPeca('Nada', 'btn-danger text-white'"), 'Tudo/Nada da peça');
  assert.ok(FONTE.includes('linhaCodigo.append('), 'na frente da tag do código');

  // Já confirmado: visível e inativo, nunca escondido.
  assert.ok(FONTE.includes('b.disabled = peca.decidida'));
  assert.ok(FONTE.includes('b.disabled = Boolean(pedido.confirmado)'));

  // Datas no hover (pedido, peça) e a lista de peças sem regra.
  assert.ok(FONTE.includes('`Pedido já confirmado${pedido.confirmado_em ? ` em ${instanteCurto(pedido.confirmado_em)}` : \'\'}`'));
  assert.ok(FONTE.includes('`Tudo confirmado em ${instanteCurto(pedido.confirmado_em)}`'));
  assert.ok(FONTE.includes('`Decidida em ${instanteCurto(peca.decidida_em)}`'));
  assert.ok(FONTE.includes('const quais = (pedido.pecas_sem_valor || []).join(\', \');'), 'o hover lista as peças sem regra');
  assert.ok(FONTE.includes('function instanteCurto('), 'o formatador de data/hora');

  // O backend manda as datas e a lista.
  const CONF = lerBack('financeiro/producaoConfirmacao.js');
  assert.ok(CONF.includes('em: d.criado_em || null'));
  assert.ok(CONF.includes('decidida_em: datas.length ? datas[datas.length - 1] : null'));
  assert.ok(CONF.includes('pecas_sem_valor: pecas.filter(x => x.sem_valor)'));
  assert.ok(CONF.includes('confirmado_em:'));
});

test('o "Fechar competência" do modal Produção abre a tela da PRODUÇÃO, e leva ao rateio quando falta distribuir', () => {
  assert.ok(FONTE.includes("acionar(fecharBtn, () => abrirOutro('fechar-competencia-producao', { competencia: mesSel.value }))"),
    'antes abria o modal de comissões');
  assert.ok(FONTE.includes("abrirOutro('rateio-producao', { competencia: compSel.value })"), 'tudo confirmado e falta rateio: vai distribuir');
  assert.ok(FONTE.includes('rateio.colaboradores > 0 && rateio.pendentes > 0'), 'só quando o rateio está em uso');
});

test('peças e processos são números diferentes, no backend e na tela', () => {
  const PRODUCAO = lerBack('financeiro/producao.js');
  assert.ok(PRODUCAO.includes('function contarPecasEProcessos('));
  assert.ok(PRODUCAO.includes('pecas: contagem.pecas,') && PRODUCAO.includes('processos: contagem.processos,') && PRODUCAO.includes('unidades: contagem.unidades,'));
  assert.ok(FECHAMENTOS.includes('contagem: rateio ? rateio.contagem : contarPecasEProcessos(comp.linhas)'));
  assert.ok(FONTE.includes("{ rotulo: 'Processos pagos', valor: String(processos) }"), 'o cartão novo');
  assert.ok(FONTE.includes("`${previa.contagem?.pecas ?? previa.pecas ?? 0} · ${previa.contagem?.processos ?? previa.processos ?? 0} processo(s)`"));
});

test('a trava de 100% saiu das comissões e foi para a produção', () => {
  const comissao = FECHAMENTOS.slice(FECHAMENTOS.indexOf("if (tipo === 'comissao') {"), FECHAMENTOS.indexOf('} else {'));
  assert.ok(!comissao.includes('extra.rateio'), 'a comissão fecha como era antes');
  const producao = FECHAMENTOS.slice(FECHAMENTOS.indexOf('} else {'), FECHAMENTOS.indexOf('/** Comissões: a base inteira'));
  assert.ok(producao.includes('if (extra.rateio) bloqueios.push(extra.rateio)'), 'a produção é que trava');
  assert.ok(FECHAMENTOS.includes('await rateios.lerVisao({ api, linhas: comp.linhas })'));

  assert.ok(PAINEL.includes("chave: 'rateio_incompleto'") && PAINEL.includes("destino: 'rateio-producao'"));
  assert.ok(PAINEL.includes('processo sem rateio completo'), 'a pendência fala de processos');
  assert.ok(PAINEL.includes('rateios.lerVisao({ api, linhas: prodComp.linhas || [] })'));

  assert.ok(CONTROLLER.includes("fechamentos.previa({ api, tipo: 'producao', competencia, hoje, desde })"), 'a rota do rateio lê a produção');
  assert.ok(CONTROLLER.includes("router.post('/rateio/peca'"), 'e o atalho de copiar na peça');
});
