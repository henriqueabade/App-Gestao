/**
 * Troca de peças entre pedidos e peça avulsa (pedido do dono, 09/10/2026).
 *
 * O modal da troca roda de verdade no DOM mínimo (./apoio/domMinimo.js), com
 * a API simulada: os três passos, o resumo, as recusas e o envio. O resto
 * prende a ligação com a lista de Pedidos, o "Continuar produzindo" do
 * cancelamento (a função dos pontos da rota roda recortada do arquivo real)
 * e o card das peças avulsas no Fechar competência.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { criarAmbiente, esperarTarefas, Evento } = require('./apoio/domMinimo');

const SRC = path.join(__dirname, '..', '..');
const RAIZ = path.join(SRC, '..');
const ler = rel => fs.readFileSync(path.join(SRC, rel), 'utf8');

/** Recorta a função do arquivo real (a mesma ideia de realocacaoMultiplosDestinos). */
function recortarFuncao(fonte, nome) {
  const inicio = fonte.indexOf(`function ${nome}(`);
  assert.notStrictEqual(inicio, -1, `função ${nome} não encontrada`);
  let i = fonte.indexOf('(', inicio);
  for (let parenteses = 0; i < fonte.length; i += 1) {
    if (fonte[i] === '(') parenteses += 1;
    else if (fonte[i] === ')' && --parenteses === 0) break;
  }
  i = fonte.indexOf('{', i);
  for (let nivel = 0; i < fonte.length; i += 1) {
    if (fonte[i] === '{') nivel += 1;
    else if (fonte[i] === '}' && --nivel === 0) break;
  }
  return fonte.slice(inicio, i + 1);
}

const ESTADOS_PED55 = [
  { chave: 'pronta', rotulo: 'Pronta', detalhe: 'Marcenaria e Acabamento feitos', quantidade: 2, pronta: true },
  { chave: 'zero', rotulo: 'Por começar', detalhe: 'Nada feito', quantidade: 1, pronta: false }
];
const ESTADOS_PED66 = [
  { chave: 'pronta', rotulo: 'Pronta', detalhe: 'Marcenaria e Acabamento feitos', quantidade: 1, pronta: true },
  { chave: 'zero', rotulo: 'Por começar', detalhe: 'Nada feito', quantidade: 3, pronta: false }
];

function opcoesDaApi() {
  return {
    minimo_motivo: 10,
    sql_pendente: false,
    pedido: { id: 55, numero: 'PED55', cliente: 'Pupê', situacao: 'Produção', pode_trocar: true, motivo_bloqueio: null },
    itens: [{
      id: 501, codigo: 'POL-01', nome: 'Poltrona', quantidade: 3, estados: ESTADOS_PED55,
      candidatos: [{ item_id: 601, pedido_id: 66, numero: 'PED66', cliente: 'Figo Casa', situacao: 'Produção', quantidade: 4, estados: ESTADOS_PED66 }]
    }],
    historico: []
  };
}

async function abrirTroca({ opcoes = opcoesDaApi(), respostaPost = null, erroPost = null } = {}) {
  const { janela, documento, montar, disparar } = criarAmbiente();
  montar(ler('html/modals/pedidos/trocar-pecas.html'));
  const chamadas = [];
  const confirmacoes = [];
  const toasts = [];
  const fechados = [];
  const avisos = [];
  janela.apiConfig = { getApiBaseUrl: async () => '' };
  janela.trocarPecasContext = { pedidoId: 55 };
  janela.fetch = async (caminho, op = {}) => {
    chamadas.push({ caminho, metodo: op.method || 'GET', corpo: op.body ? JSON.parse(op.body) : null });
    if (op.method === 'POST' && erroPost) return { ok: false, status: erroPost.status, json: async () => ({ error: erroPost.error }) };
    const corpo = op.method === 'POST'
      ? (respostaPost || { troca: { id: 1 }, a: { pedido: 'PED55', entrou: 'Por começar' }, b: { pedido: 'PED66', entrou: 'Pronta' } })
      : opcoes;
    return { ok: true, status: 200, json: async () => corpo };
  };
  janela.DialogPadrao = { confirm: async o => { confirmacoes.push(o); return true; } };
  janela.showToast = (m, t) => toasts.push([t, m]);
  janela.Modal = { close: id => fechados.push(id), signalReady: id => avisos.push(`pronto:${id}`) };
  janela.addEventListener('pedidoModalLoaded', e => avisos.push(e.detail));
  janela.addEventListener('pedido:pecas-trocadas', e => avisos.push(`trocadas:${e.detail.pedidoId}`));
  vm.createContext(janela);
  vm.runInContext(ler('js/modals/pedido-trocar-pecas.js'), janela);
  await esperarTarefas(10);
  const el = id => documento.getElementById(id);
  const botoesEm = id => el(id).querySelectorAll('button');
  const botao = (id, texto) => botoesEm(id).find(b => b.textContent.includes(texto));
  return { janela, documento, disparar, el, botao, botoesEm, chamadas, confirmacoes, toasts, fechados, avisos };
}

test('troca: carrega, mostra o pedido e avisa que está pronta; passos 2 e 3 só depois das escolhas', async () => {
  const t = await abrirTroca();
  assert.equal(t.chamadas[0].caminho, '/api/trocas-pecas/pedido/55');
  assert.equal(t.el('trocarPecasSubtitulo').textContent, 'PED55 · Pupê · Produção');
  assert.ok(t.el('trocarPecasCarregando').classList.contains('hidden'));
  assert.ok(!t.el('trocarPecasConteudo').classList.contains('hidden'));
  assert.ok(t.el('trocarPecasPasso2').classList.contains('hidden'));
  assert.ok(t.el('trocarPecasPasso3').classList.contains('hidden'));
  assert.match(t.el('trocarPecasHistorico').textContent, /Nenhuma troca neste pedido ainda/);
  assert.ok(t.avisos.includes('trocarPecas') && t.avisos.includes('pronto:trocarPecas'));
  // Um botão por estado da unidade, com a quantidade.
  assert.deepEqual(t.botoesEm('trocarPecasItens').map(b => b.textContent), ['2Pronta', '1Por começar']);
});

test('troca: o estado igual ao da peça que sai fica desligado; o resumo diz o que muda em cada pedido', async () => {
  const t = await abrirTroca();
  t.botao('trocarPecasItens', 'Pronta').click();
  assert.ok(!t.el('trocarPecasPasso2').classList.contains('hidden'));
  const igual = t.botao('trocarPecasCandidatos', 'Pronta');
  assert.equal(igual.disabled, true, 'trocar Pronta por Pronta não muda nada');
  assert.match(igual.title, /mesmo estado/);
  t.botao('trocarPecasCandidatos', 'Por começar').click();
  assert.ok(!t.el('trocarPecasPasso3').classList.contains('hidden'));
  const resumo = t.el('trocarPecasResumo').textContent;
  assert.match(resumo, /1 × POL-01 — Poltrona/);
  assert.match(resumo, /PED55 entrega a peça "Pronta" e recebe a "Por começar" do PED66\. PED55 passa a dever o que falta nela\./);
  assert.match(resumo, /PED66 recebe a "Pronta" e não paga a produção dela de novo\./);
  assert.match(resumo, /A matéria-prima não muda/);
  // No máximo o menor dos dois estados (2 prontas × 3 por começar).
  assert.equal(t.el('trocarPecasQuantidade').max, '2');
});

test('troca: recusa sem motivo e acima do máximo; com tudo certo, confirma na caixa da casa e grava', async () => {
  const t = await abrirTroca();
  t.botao('trocarPecasItens', 'Pronta').click();
  t.botao('trocarPecasCandidatos', 'Por começar').click();
  const confirmar = t.el('trocarPecasConfirmar');
  assert.equal(confirmar.getAttribute('data-perm'), 'ped.trocar_pecas');

  t.el('trocarPecasMotivo').value = 'curto';
  confirmar.click();
  await esperarTarefas();
  assert.match(t.el('trocarPecasMensagem').textContent, /Diga o motivo da troca \(ao menos 10 letras\)/);

  t.el('trocarPecasMotivo').value = 'Cliente do PED66 tem pressa e a do PED55 pode esperar';
  t.el('trocarPecasQuantidade').value = '5';
  confirmar.click();
  await esperarTarefas();
  assert.match(t.el('trocarPecasMensagem').textContent, /Escolha de 1 a 2 peças/);
  assert.equal(t.chamadas.filter(c => c.metodo === 'POST').length, 0);

  t.el('trocarPecasQuantidade').value = '1';
  confirmar.click();
  await esperarTarefas(10);
  assert.equal(t.confirmacoes.length, 1);
  assert.equal(t.confirmacoes[0].confirmText, 'Trocar peças');
  assert.match(t.confirmacoes[0].message, /PED55 entrega "Pronta" e recebe "Por começar" do PED66/);
  const post = t.chamadas.find(c => c.metodo === 'POST');
  assert.equal(post.caminho, '/api/trocas-pecas');
  assert.deepEqual(post.corpo, {
    item_a: 501, chave_a: 'pronta', item_b: 601, chave_b: 'zero', quantidade: 1,
    motivo: 'Cliente do PED66 tem pressa e a do PED55 pode esperar'
  });
  assert.ok(t.toasts.some(([tipo, m]) => tipo === 'success' && /Troca feita: PED55 recebeu "Por começar"/.test(m)));
  assert.ok(t.avisos.includes('trocadas:55'), 'avisa a troca para quem estiver ouvindo');
  assert.equal(t.chamadas.filter(c => c.metodo === 'GET').length, 2, 'relê o pedido depois da troca');
  assert.ok(t.el('trocarPecasPasso2').classList.contains('hidden'), 'as escolhas recomeçam');
});

test('troca: estado que mudou no meio (409) relê as peças e pede a escolha de novo', async () => {
  const t = await abrirTroca({ erroPost: { status: 409, error: 'O estado de uma das peças mudou enquanto a tela estava aberta. Atualize e escolha de novo.' } });
  t.botao('trocarPecasItens', 'Pronta').click();
  t.botao('trocarPecasCandidatos', 'Por começar').click();
  t.el('trocarPecasMotivo').value = 'Cliente do PED66 tem pressa e a do PED55 pode esperar';
  t.el('trocarPecasConfirmar').click();
  await esperarTarefas(12);
  assert.equal(t.chamadas.filter(c => c.metodo === 'GET').length, 2, 'releu o pedido');
  assert.match(t.el('trocarPecasAviso').textContent, /mudou enquanto a tela estava aberta/);
  assert.ok(!t.el('trocarPecasAviso').classList.contains('hidden'));
  assert.ok(t.el('trocarPecasPasso2').classList.contains('hidden'), 'as escolhas velhas saem');
});

test('troca: pedido que não troca e SQL por rodar avisam; Esc fecha (a não ser com a caixa aberta por cima)', async () => {
  const opcoes = opcoesDaApi();
  opcoes.pedido.pode_trocar = false;
  opcoes.pedido.motivo_bloqueio = 'Só o pedido Aprovado ou em Produção troca peças.';
  const t = await abrirTroca({ opcoes });
  assert.equal(t.el('trocarPecasAviso').textContent, 'Só o pedido Aprovado ou em Produção troca peças.');
  assert.ok(t.botoesEm('trocarPecasItens').every(b => b.disabled));

  const semSql = opcoesDaApi();
  semSql.sql_pendente = true;
  const s = await abrirTroca({ opcoes: semSql });
  assert.match(s.el('trocarPecasAviso').textContent, /sql\/trocas_pecas_e_avulsas\.sql/);

  const caixa = s.documento.createElement('div');
  caixa.className = 'app-message-overlay';
  s.documento.body.appendChild(caixa);
  s.disparar(s.documento, 'keydown', { key: 'Escape' });
  assert.deepEqual(s.fechados, [], 'o Esc é da caixa de cima');
  caixa.remove();
  // A caixa da casa (DialogPadrao) é um <dialog data-dialog-padrao open>.
  const dialogo = s.documento.createElement('dialog');
  dialogo.setAttribute('data-dialog-padrao', 'true');
  dialogo.setAttribute('open', '');
  s.documento.body.appendChild(dialogo);
  s.disparar(s.documento, 'keydown', { key: 'Escape' });
  assert.deepEqual(s.fechados, [], 'o Esc da confirmação não fecha a troca por baixo');
  dialogo.remove();
  s.disparar(s.documento, 'keydown', { key: 'Escape' });
  assert.deepEqual(s.fechados, ['trocarPecas']);
});

test('Pedidos: ícone de troca na linha, com permissão própria e só para Aprovado/Produção', () => {
  const PEDIDOS = ler('js/pedidos.js');
  assert.ok(PEDIDOS.includes("const trocaLiberada = ['Aprovado', 'Produção'].includes(p.situacao);"));
  const icone = PEDIDOS.split('\n').find(l => l.includes('acao-trocar-pecas') && l.includes('<i '));
  assert.ok(icone, 'sem o ícone na linha');
  assert.match(icone, /data-perm="ped\.trocar_pecas"/);
  assert.match(icone, /fa-exchange-alt/);
  assert.match(icone, /\$\{trocaLiberada \? '' : 'icon-disabled'\}/);
  const abrir = recortarFuncao(PEDIDOS, 'abrirTrocarPecas');
  assert.ok(abrir.includes("window.trocarPecasContext = { pedidoId }"));
  assert.ok(abrir.includes("'modals/pedidos/trocar-pecas.html'") && abrir.includes("'../js/modals/pedido-trocar-pecas.js'"));
  assert.ok(ler('html/menu.html').includes('<link rel="stylesheet" href="../styles/trocar-pecas.css">'));
  assert.ok(ler('html/modals/usuarios/permissoes.html').includes('name="ped.trocar_pecas"'));
  const catalogo = fs.readFileSync(path.join(RAIZ, 'backend', 'permissionsCatalog.js'), 'utf8');
  assert.ok(catalogo.includes('"key": "ped.trocar_pecas"') && catalogo.includes('"column": "acao_trocar_pecas"'));
});

/** etapasDisponiveis do cancelamento, recortada, com a rota de 5 passos. */
function pontosDaRota(piso) {
  const contexto = vm.createContext({
    itemInfo: new Map([['501', { item: { id: 501 }, grupo: { ordem_origem: piso } }]]),
    estornoPorItem: new Map([['501', {
      rota: [1, 2, 3, 4, 5].map(ordem => ({ ordem, insumo_nome: `Insumo ${ordem}`, processo: ordem <= 3 ? 'Marcenaria' : 'Acabamento' }))
    }]]),
    destinationState: new Map(),
    pisoDoItem: () => piso
  });
  vm.runInContext(`${recortarFuncao(ler('js/modals/pedido-cancelar.js'), 'etapasDisponiveis')}\nthis.etapasDisponiveis = etapasDisponiveis;`, contexto);
  // JSON: o array nasce no outro contexto (outro Array.prototype).
  return acao => JSON.parse(JSON.stringify(contexto.etapasDisponiveis('501', -1, acao)
    .map(o => ({ ordem: o.ordem, selecionada: o.selecionada, rotulo: o.rotulo }))));
}

test('cancelamento, "Continuar produzindo": a peça pronta não continua; o padrão é onde ela entrou', () => {
  const doZero = pontosDaRota(0);
  const avulsa = doZero('avulsa');
  assert.deepEqual(avulsa.map(o => o.ordem), [0, 1, 2, 3, 4], 'o fim da rota (pronta) fica de fora');
  assert.equal(avulsa[0].rotulo, 'Por começar — nada feito ainda');
  assert.deepEqual(avulsa.filter(o => o.selecionada).map(o => o.ordem), [0]);
  // O retorno ao estoque continua como era: fim da rota marcado.
  const estoque = doZero('stock');
  assert.deepEqual(estoque.map(o => o.ordem), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(estoque.filter(o => o.selecionada).map(o => o.ordem), [5]);

  const daMontagem = pontosDaRota(3)('avulsa');
  assert.deepEqual(daMontagem.map(o => o.ordem), [3, 4], 'nunca antes de onde a peça entrou');
  assert.deepEqual(daMontagem.filter(o => o.selecionada).map(o => o.ordem), [3]);
  assert.deepEqual(pontosDaRota(5)('avulsa'), [], 'peça pronta: sem ponto para continuar');
});

test('cancelamento: o botão "Continuar produzindo", o envio como action avulsa e o recomeço que zera as listas por ponto', () => {
  const CANCELAR = ler('js/modals/pedido-cancelar.js');
  assert.ok(CANCELAR.includes('Continuar produzindo'));
  assert.ok(CANCELAR.includes("avulsa: 'avulsaPorEtapa'"));
  assert.ok(/action:\s*'avulsa'/.test(CANCELAR), 'o envio da avulsa');
  assert.ok(CANCELAR.includes("if (action === 'avulsa' && !etapas.length)"), 'peça pronta não abre a caixa');
  const reset = recortarFuncao(CANCELAR, 'resetAllDestinations');
  assert.ok(reset.includes('state.stockPorEtapa = [];') && reset.includes('state.avulsaPorEtapa = [];'),
    'zerar só o total deixava as escolhas antigas valendo');
});

test('Fechar competência: card das peças avulsas com devolver, cancelar a produção e substituir a peça de um pedido', () => {
  const FIN = ler('js/modals/financeiro-modais.js');
  const card = recortarFuncao(FIN, 'cardDoPedido');
  assert.ok(card.includes('Peças avulsas — ${pedido.numero} (cancelado)'));
  assert.ok(card.includes('if (pedido.avulsa) card.appendChild(blocoDasAvulsas(pedido));'));
  const bloco = recortarFuncao(FIN, 'blocoDasAvulsas');
  assert.ok(bloco.includes("botao('Devolver ao estoque', 'btn-secondary text-white', 'estoque')"));
  assert.ok(bloco.includes("botao('Cancelar a produção', 'btn-danger text-white', 'descarte')"));
  assert.ok(bloco.includes("trocar.dataset.perm = 'ped.trocar_pecas'"));
  assert.ok(bloco.includes("abrirModalDePedido('modals/pedidos/trocar-pecas.html', '../js/modals/pedido-trocar-pecas.js', 'trocarPecas'"));
  const encerrar = recortarFuncao(FIN, 'encerrarAvulsa');
  assert.ok(encerrar.includes('/api/pecas-avulsas/${encodeURIComponent(avulsa.id)}/opcoes'));
  assert.ok(encerrar.includes('/api/pecas-avulsas/${encodeURIComponent(avulsa.id)}/encerrar'));
  assert.ok(encerrar.includes('await carregar({ silencioso: true })'), 'o card some/atualiza depois');
  const caixa = recortarFuncao(FIN, 'pedirEncerrarAvulsa');
  assert.ok(caixa.includes("'app-message-overlay"), 'a caixa da casa (o Esc do modal de baixo respeita)');
  assert.ok(caixa.includes('filhoAberto = true') && caixa.includes('filhoAberto = false'));
  assert.ok(caixa.includes('if (Number(e.ordem) === Number(opcoes.atual)) o.selected = true;'), 'o ponto atual vem marcado');
  // Peça avulsa que terminou: o recado da confirmação aparece.
  assert.ok(FIN.includes("for (const recado of resposta?.avisos || []) window.showToast?.(recado, 'info');"));
});

test('o DOM mínimo dispara Esc com a tecla certa (sanidade do próprio teste)', () => {
  const e = new Evento('keydown', { key: 'Escape' });
  assert.equal(e.key, 'Escape');
});
