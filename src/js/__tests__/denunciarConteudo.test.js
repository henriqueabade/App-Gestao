/**
 * Denunciar conteúdo (16/10/2026) — políticas 11.12 e 11.16 da Microsoft Store:
 * a mensagem do chat e o resultado da IA vão por e-mail ao suporte, e os
 * Termos de Uso e a Política de Privacidade abrem a qualquer momento em
 * Configurações. Ver src/js/utils/denunciar-conteudo.js.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..', '..');
const ler = rel => fs.readFileSync(path.join(raiz, rel), 'utf8');
const CAMINHO = path.join(raiz, 'js', 'utils', 'denunciar-conteudo.js');
const { CONTROLADOR } = require('../utils/termos-documentos');

/** Carrega o utilitário com um `self` de mentira (DialogPadrao, electronAPI). */
function carregar(self) {
  delete require.cache[require.resolve(CAMINHO)];
  global.self = self;
  try {
    return require(CAMINHO);
  } finally {
    delete global.self;
    delete require.cache[require.resolve(CAMINHO)];
  }
}

test('o e-mail vai para o contato dos Termos de Uso, com assunto, referência e trecho', () => {
  const { montarEmail } = carregar({});
  const email = montarEmail({
    assunto: 'Denúncia no chat — mensagem #7',
    linhas: ['Conversa: Geral (#3)', '', 'Autor: Ana'],
    trecho: 'texto   da\nmensagem'
  });
  assert.strictEqual(email.para, CONTROLADOR.contato);
  assert.ok(email.url.startsWith(`mailto:${CONTROLADOR.contato}?subject=`));
  const url = new URL(email.url);
  assert.strictEqual(url.searchParams.get('subject'), 'Denúncia no chat — mensagem #7');
  const corpo = url.searchParams.get('body');
  assert.match(corpo, /^Motivo: \(escreva aqui\)/);
  assert.match(corpo, /Conversa: Geral \(#3\)\r\nAutor: Ana/, 'linha vazia da lista não entra');
  assert.match(corpo, /Trecho: "texto da mensagem"/);
});

test('trecho longo é cortado; sem trecho, a linha não aparece', () => {
  const { montarEmail, cortar, LIMITE_DO_TRECHO } = carregar({});
  const longo = cortar('x'.repeat(1000));
  assert.strictEqual(longo.length, LIMITE_DO_TRECHO);
  assert.ok(longo.endsWith('…'));
  assert.doesNotMatch(montarEmail({ assunto: 'A', linhas: ['L'] }).corpo, /Trecho/);
});

test('só abre o e-mail depois de confirmar', async () => {
  const abertos = [];
  const self = {
    DialogPadrao: { confirm: async () => resposta },
    electronAPI: { openExternal: async url => { abertos.push(url); return true; } }
  };
  let resposta = false;
  const { abrir } = carregar(self);
  const pedido = { titulo: 'Denunciar mensagem', explicacao: 'x', assunto: 'Denúncia', linhas: ['L'] };
  assert.strictEqual(await abrir(pedido), false);
  assert.deepStrictEqual(abertos, []);
  resposta = true;
  assert.strictEqual(await abrir(pedido), true);
  assert.strictEqual(abertos.length, 1);
  assert.ok(abertos[0].startsWith(`mailto:${CONTROLADOR.contato}?`));
});

test('chat: "Denunciar" só na mensagem dos outros; IA: "Reportar resultado" com linhas extraídas', () => {
  const CHAT = ler('js/utils/chat.js');
  assert.ok(CHAT.includes("${minha ? '' : `<button type=\"button\" data-acao=\"denunciar\""));
  assert.ok(CHAT.includes("case 'denunciar': return denunciar(id);"));
  assert.match(CHAT, /function denunciar\(id\) \{[\s\S]*?window\.DenunciarConteudo\.abrir\(/);

  const IA_HTML = ler('html/modals/ia/detalhes.html');
  const IA_JS = ler('js/modals/ia-detalhes.js');
  assert.match(IA_HTML, /id="iaDetReportar"[^>]*class="ia-btn-transparente ctl-botao hidden"/);
  assert.ok(IA_JS.includes("get('iaDetReportar')?.addEventListener('click', reportarResultado);"));
  assert.ok(IA_JS.includes("get('iaDetReportar')?.classList.toggle('hidden', !(leitura.itens || []).length);"));
  // Só a referência da leitura: nada do texto lido vai no e-mail.
  const reportar = IA_JS.match(/function reportarResultado\(\) \{[\s\S]*?\n {2}\}/)[0];
  assert.doesNotMatch(reportar, /texto|arquivos|trecho/);

  const MENU = ler('html/menu.html');
  assert.ok(MENU.indexOf('utils/termos-documentos.js') < MENU.indexOf('utils/denunciar-conteudo.js'));
});

test('Configurações: Termos de Uso e Política de Privacidade só para leitura', () => {
  const CFG_HTML = ler('html/configuracoes.html');
  const CFG_JS = ler('js/configuracoes.js');
  for (const id of ['personalTermosDeUso', 'personalPoliticaDePrivacidade']) {
    assert.match(CFG_HTML, new RegExp(`id="${id}" class="personal-button personal-button--ghost ctl-botao"`));
  }
  assert.ok(CFG_JS.includes("['#personalTermosDeUso', 'termos_de_uso']"));
  assert.ok(CFG_JS.includes("['#personalPoliticaDePrivacidade', 'politica_de_privacidade']"));
  assert.ok(CFG_JS.includes('window.TermosAceite.abrirDocumento(chave, { somenteLeitura: true })'));
  assert.ok(CFG_JS.includes('initDocumentosAceitos();'));
});
