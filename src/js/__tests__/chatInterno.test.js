/**
 * Chat interno (12/10/2026) — as partes puras da tela (src/js/utils/chat.js).
 *
 * O arquivo roda como <script> no menu.html; sem `document` (aqui) ele
 * publica só as funções puras em window.ChatInterno.
 *
 * O que trava:
 *   - o texto vai para a tela escapado (nada de HTML de quem escreveu);
 *   - menção e citação viram marca ao enviar e voltam a nome ao editar;
 *   - citação sem permissão aparece "sem acesso", sem o nome;
 *   - o @ e o # só abrem no começo da palavra (e-mail não abre);
 *   - dias, horas, "visto há" e o agrupamento das mensagens;
 *   - a ordem das pessoas (Online primeiro) e o número do botão
 *     (silenciada conta só as menções);
 *   - menu.html carrega o chat e a folha dele (antes de controles.css);
 *   - o sino abre o chat na menção e a menção do chat sempre aparece.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..', '..');
const ler = relativo => fs.readFileSync(path.join(RAIZ, relativo), 'utf8');

function carregar() {
  const contexto = { window: {}, Date, Map, Set, console, URL, URLSearchParams };
  vm.runInNewContext(ler('src/js/utils/chat.js'), contexto, { filename: 'chat.js' });
  return contexto.window.ChatInterno;
}

const C = carregar();
const daqui = valor => JSON.parse(JSON.stringify(valor));
const nomes = new Map([['5', 'Ana Lima'], ['7', 'Bruno <b>Souza</b>']]);

test('o texto vai escapado; links, menções e citações viram marcação', () => {
  const html = C.textoParaHtml('<img src=x onerror=alert(1)> oi [[@5]] e [[@7]]\nveja [[#cliente:12]] em https://exemplo.com/a?b=1&c=2.', {
    nomes,
    euId: 5,
    refs: new Map([['cliente:12', { tipo: 'cliente', id: 12, rotulo: 'Loja <X>', detalhe: null }]])
  });
  assert.ok(!html.includes('<img'), 'HTML de quem escreveu não passa');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('<span class="chat-mencao chat-mencao--eu" data-usuario="5">@Ana Lima</span>'), 'a menção a mim é destacada');
  assert.ok(html.includes('@Bruno &lt;b&gt;Souza&lt;/b&gt;'), 'nome também vai escapado');
  assert.ok(html.includes('data-ref-tipo="cliente" data-ref-id="12"'));
  assert.ok(html.includes('<span>Loja &lt;X&gt;</span>'));
  assert.ok(html.includes('data-url="https://exemplo.com/a?b=1&amp;c=2"'), 'o link sem o ponto final');
  assert.ok(html.includes('</a>.'), 'o ponto final fica fora do link');
  assert.ok(html.includes('<br>'), 'quebra de linha');
});

test('citação: sem permissão aparece "sem acesso" (sem o nome); sumida, "não encontrado"', () => {
  const refs = new Map([
    ['pedido:3', { tipo: 'pedido', id: 3, sem_acesso: true }],
    ['tarefa:9', { tipo: 'tarefa', id: 9, nao_encontrado: true }]
  ]);
  const html = C.textoParaHtml('[[#pedido:3]] [[#tarefa:9]] [[#produto:4]]', { refs });
  assert.ok(html.includes('chat-ref--sem-acesso') && html.includes('Pedido (sem acesso)') && html.includes('fa-lock'));
  assert.ok(html.includes('chat-ref--sumiu') && html.includes('Tarefa não encontrada'));
  assert.ok(html.includes('chat-ref--carregando'), 'ainda sem resposta: carregando');
  assert.strictEqual(C.rotuloDaRef('cliente', { rotulo: 'Loja X', detalhe: 'Ativo' }).titulo, 'Cliente: Loja X · Ativo — clique para abrir');
  // Link não engole a marca colada nele.
  const colado = C.textoParaHtml('http://x.com[[@5]]', { nomes });
  assert.ok(colado.includes('data-url="http://x.com"') && colado.includes('@Ana Lima'));
});

test('texto curto (lista e aviso): @Nome e #nome do registro, numa linha', () => {
  const refs = new Map([['cliente:12', { tipo: 'cliente', id: 12, rotulo: 'Loja X' }], ['pedido:3', { sem_acesso: true }]]);
  assert.strictEqual(C.textoCurto('Oi [[@5]],\n\nveja [[#cliente:12]] e [[#pedido:3]] e [[@99]]', { nomes, refs }), 'Oi @Ana Lima, veja #Loja X e #Pedido e @alguém');
});

test('ao enviar, "@Ana Lima" vira [[@5]]; ao editar, volta', () => {
  const tokens = [
    { texto: '@Ana', marca: '[[@8]]' },
    { texto: '@Ana Lima', marca: '[[@5]]' },
    { texto: '#Loja X', marca: '[[#cliente:12]]' }
  ];
  assert.strictEqual(C.paraMarcas('Oi @Ana Lima e @Ana, veja #Loja X', tokens), 'Oi [[@5]] e [[@8]], veja [[#cliente:12]]', 'o nome mais comprido primeiro');
  assert.strictEqual(C.paraMarcas('sem nada', []), 'sem nada');
  const refs = new Map([['cliente:12', { tipo: 'cliente', id: 12, rotulo: 'Loja X' }]]);
  const volta = C.deMarcas('Oi [[@5]], veja [[#cliente:12]] e [[#pedido:3]] [[@5]]', { nomes, refs });
  assert.strictEqual(volta.texto, 'Oi @Ana Lima, veja #Loja X e #Pedido 3 @Ana Lima');
  assert.deepStrictEqual(daqui(volta.tokens), [
    { texto: '@Ana Lima', marca: '[[@5]]' },
    { texto: '#Loja X', marca: '[[#cliente:12]]' },
    { texto: '#Pedido 3', marca: '[[#pedido:3]]' }
  ]);
  assert.strictEqual(C.paraMarcas(volta.texto, volta.tokens), 'Oi [[@5]], veja [[#cliente:12]] e [[#pedido:3]] [[@5]]', 'ida e volta sem perder nada');
});

test('o @ e o # abrem no começo da palavra (e-mail não abre)', () => {
  assert.deepStrictEqual(daqui(C.gatilho('oi @an', 6)), { simbolo: '@', inicio: 3, consulta: 'an' });
  assert.deepStrictEqual(daqui(C.gatilho('@', 1)), { simbolo: '@', inicio: 0, consulta: '' });
  assert.deepStrictEqual(daqui(C.gatilho('veja #loja x', 12)), { simbolo: '#', inicio: 5, consulta: 'loja x' });
  assert.strictEqual(C.gatilho('ana@empresa', 11), null, 'e-mail');
  assert.strictEqual(C.gatilho('@Ana Lima e mais', 16), null, 'dois espaços depois: já passou');
  assert.strictEqual(C.gatilho('oi @ana\nlinha', 13), null, 'outra linha');
  assert.deepStrictEqual(daqui(C.gatilho('(#ped', 5)), { simbolo: '#', inicio: 1, consulta: 'ped' });
});

test('dias, horas e "visto há"', () => {
  const agora = new Date(2026, 9, 12, 15, 0);
  assert.strictEqual(C.rotuloDoDia(new Date(2026, 9, 12, 9, 0), agora), 'Hoje');
  assert.strictEqual(C.rotuloDoDia(new Date(2026, 9, 11, 23, 59), agora), 'Ontem');
  assert.match(C.rotuloDoDia(new Date(2026, 9, 9, 10, 0), agora), /^Sexta-feira, 9 de outubro$/);
  assert.match(C.rotuloDoDia(new Date(2025, 11, 25, 10, 0), agora), /2025/);
  assert.strictEqual(C.horaDe(new Date(2026, 9, 12, 7, 5)), '07:05');
  assert.strictEqual(C.quandoCurto(new Date(2026, 9, 12, 7, 5), agora), '07:05');
  assert.strictEqual(C.quandoCurto(new Date(2026, 9, 11, 7, 5), agora), 'Ontem');
  assert.strictEqual(C.quandoCurto(new Date(2026, 8, 3, 7, 5), agora), '03/09');
  assert.strictEqual(C.quandoCurto(new Date(2025, 8, 3, 7, 5), agora), '03/09/25');
  assert.strictEqual(C.vistoHa(new Date(2026, 9, 12, 14, 59, 40), agora), 'Visto agora');
  assert.strictEqual(C.vistoHa(new Date(2026, 9, 12, 14, 35), agora), 'Visto há 25 min');
  assert.strictEqual(C.vistoHa(new Date(2026, 9, 12, 12, 0), agora), 'Visto há 3 h');
  assert.strictEqual(C.vistoHa(new Date(2026, 9, 11, 18, 30), agora), 'Visto ontem às 18:30');
  assert.strictEqual(C.vistoHa(new Date(2026, 9, 1, 8, 0), agora), 'Visto em 01/10 às 08:00');
  assert.strictEqual(C.vistoHa(null, agora), '');
});

test('mensagens agrupadas: dia a dia; a mesma pessoa em menos de 5 min continua', () => {
  const m = (id, autor, h, min, extra = {}) => ({ id, autor_id: autor, tipo: 'texto', criado_em: new Date(2026, 9, 12, h, min).toISOString(), ...extra });
  const blocos = C.agrupar([
    { ...m(1, 5, 9, 0), criado_em: new Date(2026, 9, 11, 9, 0).toISOString() },
    m(2, 5, 9, 0),
    m(3, 5, 9, 3),
    m(4, 5, 9, 9),
    m(5, 7, 9, 10),
    m(6, 7, 9, 11, { resposta: { id: 5 } }),
    m(7, null, 9, 12, { tipo: 'sistema' }),
    m(8, 7, 9, 12)
  ], new Date(2026, 9, 12, 15, 0));
  assert.deepStrictEqual(daqui(blocos.map(b => (b.tipo === 'dia' ? b.rotulo : `${b.mensagem.id}${b.continua ? '+' : ''}`))),
    ['Ontem', '1', 'Hoje', '2', '3+', '4', '5', '6', '7', '8']);
});

test('pessoas: Online primeiro; o número do botão; o nome da conversa; digitando; reações', () => {
  const ordem = C.ordenarPessoas([
    { nome: 'Zé', estado: 'offline' }, { nome: 'Bia', estado: 'ausente' },
    { nome: 'Caio', estado: 'online' }, { nome: 'Ana', estado: 'online' }, { nome: 'Dora', estado: 'ocupado' }
  ]).map(p => p.nome);
  assert.deepStrictEqual(daqui(ordem), ['Ana', 'Caio', 'Dora', 'Bia', 'Zé']);
  assert.strictEqual(C.contarNaoLidas([
    { nao_lidas: 3, mencoes: 0 },
    { nao_lidas: 10, mencoes: 1, silenciada: true },
    { nao_lidas: 0, mencoes: 0 }
  ]), 4, 'silenciada conta só as menções');
  const ordemConversas = C.ordenarConversas([
    { id: 1, atualizada_em: '2026-10-12T10:00:00Z' },
    { id: 2, atualizada_em: '2026-10-12T12:00:00Z' },
    { id: 3, atualizada_em: '2026-10-01T10:00:00Z', fixada: true }
  ]).map(c => c.id);
  assert.deepStrictEqual(daqui(ordemConversas), [3, 2, 1], 'fixada primeiro');
  assert.strictEqual(C.nomeDaConversa({ tipo: 'direta', outro_id: 5 }, nomes), 'Ana Lima');
  assert.strictEqual(C.nomeDaConversa({ tipo: 'canal', nome: 'produção' }, nomes), 'produção');
  assert.strictEqual(C.nomeDaConversa({ tipo: 'grupo', nome: null }, nomes), 'Grupo');
  assert.strictEqual(C.quemDigita(['Ana']), 'Ana está digitando…');
  assert.strictEqual(C.quemDigita(['Ana', 'Bruno']), 'Ana e Bruno estão digitando…');
  assert.strictEqual(C.quemDigita(['Ana', 'Bruno', 'Caio']), 'Várias pessoas estão digitando…');
  assert.strictEqual(C.quemReagiu(['Você']), 'Você');
  assert.strictEqual(C.quemReagiu(['Ana', 'Bruno', 'Caio']), 'Ana, Bruno e Caio');
  assert.strictEqual(C.quemReagiu(['Ana', 'Bruno', 'Caio', 'Dora']), 'Ana, Bruno e mais 2');
  assert.strictEqual(C.iniciais('Ana Maria Lima'), 'AL');
  assert.strictEqual(C.corDoAvatar(3), C.corDoAvatar(11), 'a cor de cada um é fixa');
});

test('os quatro status que cada um escolhe e os quatro estados que os outros veem', () => {
  assert.deepStrictEqual(daqui(C.MEU_STATUS.map(s => [s.valor, s.rotulo, s.estado])), [
    ['automatico', 'Disponível', 'online'],
    ['ocupado', 'Ocupado', 'ocupado'],
    ['ausente', 'Ausente', 'ausente'],
    ['invisivel', 'Invisível', 'offline']
  ]);
  assert.deepStrictEqual(daqui(Object.keys(C.PRESENCA)), ['online', 'ausente', 'ocupado', 'offline']);
  // A mesma lista do servidor (chat/chat.js) — o que dá para citar.
  const servidor = ler('backend/chat/chat.js').match(/TIPOS_DE_REFERENCIA = (\[[^\]]+\])/)[1];
  assert.deepStrictEqual(daqui(C.TIPOS_REF), JSON.parse(servidor));
});

test('menu.html carrega o chat; o sino abre o chat na menção; a menção sempre aparece', () => {
  const menu = ler('src/html/menu.html');
  const posChat = menu.indexOf('href="../styles/chat.css"');
  assert.ok(posChat > 0 && posChat < menu.indexOf('href="../styles/controles.css"'), 'chat.css antes de controles.css');
  const scriptChat = menu.indexOf('src="../js/utils/chat.js"');
  assert.ok(scriptChat > menu.indexOf('src="../js/utils/som-aviso.js"'), 'depois do som dos avisos');
  assert.ok(scriptChat > menu.indexOf('src="../js/notifications.js"'));
  const sino = ler('src/js/notifications.js');
  assert.match(sino, /aviso\.origem === 'chat'[\s\S]{0,120}ChatInterno\.abrir\(\{ conversaId: aviso\.registro_id \}\)/);
  const categorias = require(path.join(RAIZ, 'src/js/utils/categorias-aviso.js'));
  assert.strictEqual(categorias.categoriaDoAviso({ tipo: 'mencao', origem: 'chat' }), 'conta');
  // Produtos ganha a porta de fora (a citação #produto abre o Visualizar).
  assert.match(ler('src/js/produtos.js'), /window\.ProdutosModulo = \{\s*abrirVisualizar:/);
});
