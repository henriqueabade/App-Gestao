/**
 * "Editar peças do pedido" (src/js/modals/pedido-editar-pecas.js e
 * src/html/modals/pedidos/editar-pecas.html, 14/10/2026) — só o dono, pedido
 * em Produção. As funções puras são recortadas e executadas sem DOM; o resto
 * prende a anatomia do HTML, a ligação no Visualizar e o modo edição do modal
 * da conversão (orcamento-converter.js).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..');
const ler = relativo => fs.readFileSync(path.join(RAIZ, relativo), 'utf8');
const FONTE = ler('js/modals/pedido-editar-pecas.js');
const plano = v => JSON.parse(JSON.stringify(v));

function puras() {
  const inicio = FONTE.indexOf('// início das funções puras');
  const fim = FONTE.indexOf('// fim das funções puras');
  assert.ok(inicio !== -1 && fim > inicio, 'o bloco de funções puras não foi encontrado');
  return vm.runInContext(`${FONTE.slice(inicio, fim)}\n({ nomeDaPeca, edicaoInicial, gruposDeIguais, mudou, entradaDaEdicao, unidadesNovas, decisoesDaConversao, problemaDaEdicao, pecaDoCatalogo })`, vm.createContext({}));
}

// O PED121: duas linhas iguais de Caixa Rio e uma Bandeja.
const DADOS = {
  pode_editar: true,
  linhas: [
    { item_id: 501, produto_id: 10, codigo: 'CXR-P', nome: 'Caixa Rio - P', quantidade: 2 },
    { item_id: 502, produto_id: 10, codigo: 'CXR-P', nome: 'Caixa Rio - P', quantidade: 2 },
    { item_id: 503, produto_id: 20, codigo: 'BLV-U', nome: 'Bandeja La Vie', quantidade: 1, travado: 'passou por troca' }
  ]
};

test('juntar as linhas iguais: a de baixo vai para a de cima, sem peça nova; o corpo leva todas as linhas', () => {
  const f = puras();
  const edicao = f.edicaoInicial(DADOS);
  assert.equal(f.mudou(DADOS, edicao), false);
  assert.deepStrictEqual(plano(f.gruposDeIguais(DADOS).map(g => g.map(l => l.item_id))), [[501, 502]], 'a travada não entra em grupo nenhum');
  edicao.linhas['501'].quantidade = 4;
  edicao.linhas['502'].juntar_em = 501;
  assert.equal(f.mudou(DADOS, edicao), true);
  assert.deepStrictEqual(plano(f.unidadesNovas(DADOS, edicao)), [], 'juntar não cria peça nova');
  assert.deepStrictEqual(plano(f.entradaDaEdicao(DADOS, edicao)), { linhas: [{ item_id: 501, quantidade: 4 }, { item_id: 502, juntar_em: 501 }, { item_id: 503, quantidade: 1 }] });
});

test('as unidades novas por peça, com a mesma conta do servidor', () => {
  const f = puras();
  const e = f.edicaoInicial(DADOS);
  e.linhas['501'].quantidade = 5;
  e.linhas['502'].juntar_em = 501;
  assert.deepStrictEqual(plano(f.unidadesNovas(DADOS, e)), [{ produto_id: 10, nome: 'CXR-P — Caixa Rio - P', qtd: 1 }], '2 + 2 juntadas = 4; pediu 5: 1 nova');
  const e2 = f.edicaoInicial(DADOS);
  e2.novas.push({ produto_id: 10, codigo: 'CXR-P', nome: 'Caixa Rio - P', quantidade: 2 });
  assert.deepStrictEqual(plano(f.unidadesNovas(DADOS, e2)), [{ produto_id: 10, nome: 'CXR-P — Caixa Rio - P', qtd: 2 }], 'peça que o pedido já tem aumenta a linha dela');
  const e3 = f.edicaoInicial(DADOS);
  e3.novas.push({ produto_id: 30, codigo: 'VSI-M', nome: 'Vaso Sílvia', quantidade: 3 });
  e3.linhas['501'].quantidade = 1;
  assert.deepStrictEqual(plano(f.unidadesNovas(DADOS, e3)), [{ produto_id: 30, nome: 'VSI-M — Vaso Sílvia', qtd: 3 }], 'tirar não pede escolha; a peça nova sim');
  assert.deepStrictEqual(plano(f.decisoesDaConversao({ items: [{ produto_id: '30', qtd_usar_pronta: 1, qtd_a_produzir: 2, parciais: [{ ordem: 2, quantidade: 1 }], forcarProduzirDoZero: false }] })),
    [{ produto_id: 30, qtd_usar_pronta: 1, qtd_a_produzir: 2, qtd_produzir_parcial: 0, parciais: [{ ordem: 2, quantidade: 1 }], forcarProduzirDoZero: false }]);
});

test('o que impede de revisar: quantidade torta, nada mudado, pedido sem peça e motivo curto', () => {
  const f = puras();
  const e = f.edicaoInicial(DADOS);
  assert.match(f.problemaDaEdicao(DADOS, e, 'Linhas repetidas vindas da IA'), /Nada foi mudado/);
  e.linhas['501'].quantidade = 1.5;
  assert.match(f.problemaDaEdicao(DADOS, e, 'Linhas repetidas vindas da IA'), /número inteiro/);
  e.linhas['501'].quantidade = 0;
  e.linhas['502'].quantidade = 0;
  e.linhas['503'].quantidade = 0;
  assert.match(f.problemaDaEdicao(DADOS, e, 'Linhas repetidas vindas da IA'), /não pode ficar sem nenhuma peça/);
  e.linhas['503'].quantidade = 1;
  assert.match(f.problemaDaEdicao(DADOS, e, 'curto'), /ao menos 10 letras/);
  assert.equal(f.problemaDaEdicao(DADOS, e, 'Cliente desistiu das caixas'), null);
  const catalogo = [{ id: 30, codigo: 'VSI-M', nome: 'Vaso Sílvia' }];
  assert.equal(f.pecaDoCatalogo(catalogo, 'VSI-M — Vaso Sílvia').id, 30);
  assert.equal(f.pecaDoCatalogo(catalogo, 'vsi-m').id, 30);
  assert.equal(f.pecaDoCatalogo(catalogo, 'outra'), null);
});

test('anatomia: vidro e tamanhos do padrão, Fechar vermelho, motivo, revisar e salvar; tudo por textContent', () => {
  const html = ler('html/modals/pedidos/editar-pecas.html');
  assert.match(html, /id="editarPecasPedidoOverlay" class="hidden fixed inset-0 z-\[1200\] bg-black\/50[^"]*ctl-padrao"/);
  assert.match(html, /bg-surface\/60 backdrop-blur-xl rounded-3xl/);
  assert.match(html, /id="fecharEditarPecas" type="button" class="btn-danger ctl-botao/);
  assert.match(html, /id="voltarEditarPecas" type="button" class="btn-neutral ctl-botao/);
  for (const id of ['editarPecasLinhas', 'editarPecasBusca', 'editarPecasMotivo', 'editarPecasRevisar', 'editarPecasSalvar', 'editarPecasResumo']) assert.ok(html.includes(`id="${id}"`), id);
  assert.ok(!/innerHTML/.test(FONTE), 'nada de innerHTML: os nomes vêm do banco');
  assert.match(FONTE, /\/api\/pedido-edicao\/\$\{encodeURIComponent\(pedidoId\)\}\/simular/);
  assert.match(FONTE, /assinatura: previa\.assinatura/);
  assert.match(FONTE, /window\.DialogPadrao\?\.confirm\?\.\(/);
  const menu = ler('html/menu.html');
  assert.ok(menu.indexOf('../styles/editar-pecas.css') > 0 && menu.indexOf('../styles/editar-pecas.css') < menu.indexOf('../styles/controles.css'));
});

test('no Visualizar: o botão nasce escondido, só aparece com o servidor dizendo que é o dono e em Produção; a edição recarrega o pedido', () => {
  const html = ler('html/modals/pedidos/visualizar.html');
  assert.match(html, /id="visualizarPedidoEditarPecas" type="button" class="hidden btn-warning ctl-botao ctl-botao--pequeno/);
  const js = ler('js/modals/pedido-visualizar.js');
  assert.match(js, /String\(pedido\?\.situacao \|\| ''\)\.trim\(\) !== 'Produção'\) return;/);
  assert.match(js, /fetchApi\('\/api\/pedido-edicao\/permissao'\)/);
  assert.match(js, /'editarPecasPedido'\]/, 'é um dos filhos');
  assert.match(js, /'pedido:pecas-editadas'\]/, 'e o evento dele recarrega o pedido');
  assert.match(FONTE, /new CustomEvent\('pedido:pecas-editadas'/);
});

test('o modal da conversão em modo edição: por cima, sem Substituir, sem as datas, e o Voltar não fecha a edição', () => {
  const conv = ler('js/modals/orcamento-converter.js');
  assert.match(conv, /const modoEdicao = ctx\.modo === 'edicao';/);
  assert.match(conv, /overlay\.style\.zIndex = String\(Math\.max\(2001, maiorAberto \+ 1\)\);/, 'acima do maior overlay aberto (o Modal sobe todos para 2000+)');
  assert.match(conv, /\$\{modoEdicao \? '' : replaceButtonHtml\}/);
  assert.match(conv, /if \(modoEdicao\) \{\s+try \{\s+cleanupReplaceModalIntegration\(\);\s+window\.confirmQuoteConversion\?\.\(\{ deletions, replacements, conversao \}\);/);
  assert.match(conv, /\/\/ Modo edição: só esta tela fecha; a edição das peças continua aberta\.\s+if \(modoEdicao\) \{\s+close\(\);\s+try \{ ctx\.aoCancelar\?\.\(\); \}/);
  // A mesma peça em duas linhas do orçamento é uma linha na revisão.
  assert.match(conv, /let rows = juntarLinhasDaMesmaPeca\(/);
  const inicio = conv.indexOf('function juntarLinhasDaMesmaPeca');
  const fim = conv.indexOf('const subtitulo', inicio);
  const juntar = vm.runInContext(`${conv.slice(inicio, fim)}\njuntarLinhasDaMesmaPeca`, vm.createContext({}));
  assert.deepStrictEqual(plano(juntar([{ produto_id: 10, nome: 'Caixa', qtd: 2 }, { produto_id: 20, nome: 'Bandeja', qtd: 1 }, { produto_id: 10, nome: 'Caixa', qtd: 2 }])),
    [{ produto_id: 10, nome: 'Caixa', qtd: 4 }, { produto_id: 20, nome: 'Bandeja', qtd: 1 }]);
});
