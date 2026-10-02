/**
 * Pedidos do dono de 02/10/2026, na tela:
 *   - aceite dos Termos de Uso e da Política de Privacidade: no cadastro (duas
 *     caixas que só marcam pelo "Li e aceito", liberado depois de rolar o
 *     documento até o fim) e dentro do programa (caixa que não fecha sem
 *     aceitar ou recusar; recusar leva para a tela de login);
 *   - Usuários: coluna Termos (Aceito verde / Pendente vermelho) e o botão de
 *     pedir o aceite, à esquerda do Editar, só para o Sup Admin e só com os
 *     termos pendentes;
 *   - menu: os módulos nascem escondidos e só aparecem com a permissão —
 *     nada de mostrar tudo e esconder depois (o clarão do Ctrl+R).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ler = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const ACEITE = ler('js/utils/termos-aceite.js');
const DOCUMENTOS = ler('js/utils/termos-documentos.js');
const PERMISSOES = ler('js/permissoes.js');
const MENU_JS = ler('js/menu.js');
const MENU_HTML = ler('html/menu.html');
const MENU_CSS = ler('css/menu.css');
const LOGIN_HTML = ler('login/login.html');
const LOGIN_JS = ler('login/loginRenderer.js');
const USUARIOS_JS = ler('js/usuarios.js');
const USUARIOS_HTML = ler('html/usuarios.html');

// ---------------------------------------------------------------------------
// Um DOM de mentira, só com o que a caixa de aceite usa.
// ---------------------------------------------------------------------------
function conectar(no, ligado) {
  no.isConnected = ligado;
  no.children.forEach(filho => conectar(filho, ligado));
}

function criarElemento(tag) {
  const ouvintes = {};
  const classes = () => no.className.split(/\s+/).filter(Boolean);
  const no = {
    tagName: String(tag).toUpperCase(), children: [], parent: null, className: '', dataset: {}, atributos: {}, style: {},
    hidden: false, disabled: false, checked: false, textContent: '', isConnected: false, open: false, aberturas: 0,
    scrollTop: 0, clientHeight: 300, scrollHeight: 3000,
    classList: {
      add: (...c) => { no.className = [...new Set([...classes(), ...c])].join(' '); },
      remove: (...c) => { no.className = classes().filter(x => !c.includes(x)).join(' '); },
      contains: c => classes().includes(c)
    },
    setAttribute(nome, valor) { no.atributos[nome] = String(valor); },
    getAttribute(nome) { return no.atributos[nome] ?? null; },
    appendChild(filho) { filho.parent = no; no.children.push(filho); conectar(filho, no.isConnected); return filho; },
    append(...filhos) { filhos.forEach(f => no.appendChild(f)); },
    replaceChildren(...filhos) { no.children.forEach(f => { f.parent = null; conectar(f, false); }); no.children = []; no.append(...filhos); },
    remove() {
      if (no.parent) no.parent.children = no.parent.children.filter(x => x !== no);
      no.parent = null;
      conectar(no, false);
    },
    addEventListener(tipo, fn) { (ouvintes[tipo] = ouvintes[tipo] || []).push(fn); },
    disparar(tipo) {
      const evento = { defaultPrevented: false, preventDefault() { evento.defaultPrevented = true; } };
      (ouvintes[tipo] || []).forEach(fn => fn(evento));
      return evento;
    },
    focus() {},
    showModal() { no.open = true; no.aberturas += 1; },
    close() { no.open = false; no.disparar('close'); }
  };
  return no;
}

const todos = (no, filtro, achados = []) => {
  if (filtro(no)) achados.push(no);
  no.children.forEach(filho => todos(filho, filtro, achados));
  return achados;
};
const comClasse = (raiz, classe) => todos(raiz, n => n.classList.contains(classe));
const botaoDe = (raiz, texto) => todos(raiz, n => n.tagName === 'BUTTON' && n.textContent === texto)[0];
const textoDe = raiz => todos(raiz, () => true).map(n => n.textContent).filter(Boolean).join(' | ');
const esperar = () => new Promise(resolve => setImmediate(resolve));

/** Carrega os dois arquivos da tela num contexto com o DOM de mentira. */
function carregarAceite({ respostas = {} } = {}) {
  const body = criarElemento('body');
  body.isConnected = true;
  const pedidos = [];
  const armazenado = { local: {}, sessao: {} };
  const guarda = caixa => ({
    setItem: (k, v) => { caixa[k] = String(v); },
    getItem: k => (k in caixa ? caixa[k] : null),
    removeItem: k => { delete caixa[k]; }
  });
  const intervalos = [];
  const eletron = [];
  const avisos = [];
  const ctx = {
    document: { body, hidden: false, createElement: criarElemento, addEventListener() {} },
    console, setImmediate, Promise, Object, Math, JSON, String, Boolean, Map,
    requestAnimationFrame: fn => fn(),
    setInterval: fn => { intervalos.push(fn); return intervalos.length; },
    clearInterval: id => { intervalos[id - 1] = null; },
    localStorage: guarda(armazenado.local),
    sessionStorage: guarda(armazenado.sessao),
    apiConfig: { getApiBaseUrl: async () => 'http://local' },
    fetch: async (url, opcoes = {}) => {
      const caminho = url.replace('http://local', '');
      pedidos.push({ caminho, metodo: opcoes.method || 'GET', corpo: opcoes.body ? JSON.parse(opcoes.body) : null });
      const [status, corpo] = (respostas[caminho] || (() => [200, {}]))();
      return { ok: status >= 200 && status < 300, status, json: async () => corpo };
    },
    electronAPI: { openLoginHidden: async () => { eletron.push('openLoginHidden'); }, logout: async () => { eletron.push('logout'); } },
    showToast: (mensagem, tipo) => avisos.push([mensagem, tipo]),
    addEventListener() {}
  };
  ctx.window = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(DOCUMENTOS, ctx);
  vm.runInContext(ACEITE, ctx);
  const dialogos = () => body.children.filter(n => n.tagName === 'DIALOG');
  return { ctx, body, pedidos, armazenado, intervalos, eletron, avisos, dialogos, T: ctx.TermosAceite, D: ctx.TermosDocumentos };
}

/** Abre o documento pela caixa, rola até o fim e clica em "Li e aceito". */
async function lerEAceitar(m, nomeDoDocumento, raiz = m.body) {
  botaoDe(raiz, nomeDoDocumento).disparar('click');
  const documento = m.dialogos().at(-1);
  const rolagem = comClasse(documento, 'termos-rolagem')[0];
  rolagem.scrollTop = rolagem.scrollHeight - rolagem.clientHeight;
  rolagem.disparar('scroll');
  botaoDe(documento, 'Li e aceito').disparar('click');
  await esperar();
}

// ---------------------------------------------------------------------------
// As caixas de aceite e o documento
// ---------------------------------------------------------------------------

test('cadastro: a caixa só marca pelo "Li e aceito", que só libera depois de rolar o documento até o fim', async () => {
  const m = carregarAceite();
  const alvo = criarElemento('div');
  m.body.appendChild(alvo);
  const mudancas = [];
  const caixas = m.T.ligarCaixas(alvo, { aoMudar: ok => mudancas.push(ok) });

  const marcas = todos(alvo, n => n.tagName === 'INPUT');
  assert.strictEqual(marcas.length, 2);
  assert.strictEqual(textoDe(alvo), 'Li e aceito os  | Termos de Uso | Li e aceito a  | Política de Privacidade');
  assert.strictEqual(caixas.completo(), false);
  assert.strictEqual(caixas.aceitos(), null);

  // Clicar na caixa NÃO marca: abre o documento.
  const clique = marcas[0].disparar('click');
  assert.strictEqual(clique.defaultPrevented, true, 'a marca não entra sozinha');
  assert.strictEqual(marcas[0].checked, false);
  let documento = m.dialogos().at(-1);
  assert.ok(documento.open, 'o documento abriu');
  assert.ok(textoDe(documento).includes('Termos de Uso') && textoDe(documento).includes(`Versão ${m.D.documento('termos_de_uso').versao}`));
  assert.ok(textoDe(documento).includes('Fim do documento.'));

  // Sem rolar até o fim, o aceite fica travado (e clicar nele não faz nada).
  const aceitar = botaoDe(documento, 'Li e aceito');
  const rolagem = comClasse(documento, 'termos-rolagem')[0];
  assert.strictEqual(aceitar.disabled, true);
  assert.ok(textoDe(documento).includes('Role o documento até o fim para liberar o aceite.'));
  rolagem.scrollTop = 1200; // no meio
  rolagem.disparar('scroll');
  assert.strictEqual(aceitar.disabled, true);
  aceitar.disparar('click');
  assert.ok(documento.open, 'no meio do documento não aceita');

  // Voltar fecha sem marcar.
  botaoDe(documento, 'Voltar').disparar('click');
  await esperar();
  assert.strictEqual(m.dialogos().length, 0);
  assert.strictEqual(marcas[0].checked, false);

  // Lendo até o fim e aceitando, a caixa marca.
  await lerEAceitar(m, 'Termos de Uso');
  assert.strictEqual(marcas[0].checked, true);
  assert.strictEqual(caixas.completo(), false, 'falta a Política de Privacidade');
  await lerEAceitar(m, 'Política de Privacidade');
  assert.strictEqual(caixas.completo(), true);
  assert.deepStrictEqual({ ...caixas.aceitos() }, { ...m.D.versoes() });
  assert.deepStrictEqual(mudancas, [false, true]);

  // Desmarcar é livre; limpar zera tudo.
  marcas[1].disparar('click');
  assert.strictEqual(marcas[1].checked, false);
  assert.strictEqual(caixas.aceitos(), null);
  caixas.limpar();
  assert.deepStrictEqual(marcas.map(x => x.checked), [false, false]);
});

test('documento que cabe inteiro na tela já está no fim; Esc no documento é só "Voltar"', async () => {
  const m = carregarAceite();
  const promessa = m.T.abrirDocumento('politica_de_privacidade');
  const documento = m.dialogos()[0];
  const rolagem = comClasse(documento, 'termos-rolagem')[0];
  rolagem.scrollHeight = rolagem.clientHeight; // cabe inteiro
  rolagem.disparar('scroll');
  assert.strictEqual(botaoDe(documento, 'Li e aceito').disabled, false);
  const esc = documento.disparar('cancel');
  assert.strictEqual(esc.defaultPrevented, true);
  assert.strictEqual(await promessa, false, 'Esc não aceita');
  assert.strictEqual(await m.T.abrirDocumento('nao_existe'), false);
});

// ---------------------------------------------------------------------------
// A caixa obrigatória dentro do programa
// ---------------------------------------------------------------------------

test('dentro do programa: a caixa explica o motivo, não tem X, não fecha no Esc e volta se for tirada da tela', async () => {
  const m = carregarAceite({ respostas: { '/api/usuarios/me/termos': () => [200, { pendente: true }] } });
  const sessao = m.T.verificarSessao();
  await esperar();
  const caixa = m.dialogos()[0];
  assert.ok(caixa && caixa.open && caixa.classList.contains('termos-dialogo--exigir'));

  const texto = textoDe(caixa);
  assert.ok(texto.includes('O administrador pediu que você leia e aceite os documentos abaixo'), 'o cabeçalho diz por que apareceu');
  assert.ok(texto.includes('Esta caixa só fecha com a sua resposta: aceitar os dois documentos ou recusar.'));
  assert.ok(texto.includes('Se recusar, o seu acesso é desativado'));
  assert.deepStrictEqual(todos(caixa, n => n.tagName === 'BUTTON').map(b => b.textContent), ['Termos de Uso', 'Política de Privacidade', 'Recusar', 'Aceitar e continuar'], 'sem X e sem Fechar');
  assert.strictEqual(botaoDe(caixa, 'Aceitar e continuar').disabled, true, 'só aceita depois dos dois documentos');

  // Esc não fecha.
  assert.strictEqual(caixa.disparar('cancel').defaultPrevented, true);
  assert.ok(caixa.open);
  // Fechada à força, reabre na hora.
  caixa.close();
  assert.ok(caixa.open, 'close() sem resposta: a caixa volta');
  // Arrancada do documento, o vigia a põe de volta.
  caixa.remove();
  caixa.open = false;
  m.intervalos.filter(Boolean).forEach(fn => fn());
  assert.ok(caixa.isConnected && caixa.open, 'tirada da tela: volta');
  // Enquanto ela está aberta, nova conferência não abre outra nem pergunta de novo.
  const perguntas = m.pedidos.length;
  m.T.verificarSessao();
  await esperar();
  assert.strictEqual(m.dialogos().length, 1);
  assert.strictEqual(m.pedidos.length, perguntas);
  assert.strictEqual(typeof sessao.then, 'function');
});

test('aceitar: grava com as versões lidas, fecha a caixa e libera o programa', async () => {
  let falhar = true;
  const m = carregarAceite({
    respostas: {
      '/api/usuarios/me/termos': () => [200, { pendente: true }],
      '/api/usuarios/me/termos/aceitar': () => (falhar ? [409, { error: 'Os documentos foram atualizados.' }] : [200, { success: true }])
    }
  });
  const sessao = m.T.verificarSessao();
  await esperar();
  const caixa = m.dialogos()[0];
  await lerEAceitar(m, 'Termos de Uso', caixa);
  await lerEAceitar(m, 'Política de Privacidade', caixa);
  const aceitar = botaoDe(caixa, 'Aceitar e continuar');
  assert.strictEqual(aceitar.disabled, false);

  // Falha ao gravar: a caixa fica, com o motivo.
  aceitar.disparar('click');
  await esperar(); await esperar();
  const erro = comClasse(caixa, 'termos-erro')[0];
  assert.strictEqual(erro.hidden, false);
  assert.strictEqual(erro.textContent, 'Os documentos foram atualizados.');
  assert.ok(caixa.open, 'sem gravar, não fecha');

  falhar = false;
  botaoDe(caixa, 'Aceitar e continuar').disparar('click');
  assert.strictEqual(await sessao, true);
  assert.strictEqual(m.dialogos().length, 0, 'aceito: a caixa sai');
  const gravacao = m.pedidos.filter(p => p.caminho === '/api/usuarios/me/termos/aceitar').at(-1);
  assert.strictEqual(gravacao.metodo, 'POST');
  assert.deepStrictEqual(gravacao.corpo, { documentos: { ...m.D.versoes() } });
  assert.deepStrictEqual(m.avisos, [['Aceite registrado. Obrigado!', 'success']]);
  assert.deepStrictEqual(m.eletron, [], 'aceitar não desloga');
});

test('recusar: pede confirmação, desativa e leva para a tela de login com o aviso', async () => {
  const m = carregarAceite({
    respostas: {
      '/api/usuarios/me/termos': () => [200, { pendente: true }],
      '/api/usuarios/me/termos/recusar': () => [200, { success: true, desativado: true }]
    }
  });
  m.armazenado.local.user = '{"id":7}';
  m.armazenado.local.rememberUser = '1';
  m.armazenado.sessao.currentUser = '{"id":7}';
  m.T.verificarSessao();
  await esperar();
  const caixa = m.dialogos()[0];

  // Primeiro clique: só a confirmação, dizendo o que acontece.
  botaoDe(caixa, 'Recusar').disparar('click');
  await esperar();
  let confirmacao = m.dialogos().at(-1);
  assert.ok(confirmacao.classList.contains('termos-dialogo--confirmar'));
  assert.ok(textoDe(confirmacao).includes('o seu acesso é desativado agora;'));
  assert.ok(textoDe(confirmacao).includes('a sua conta não é excluída: só o administrador pode reativá-la.'));
  botaoDe(confirmacao, 'Voltar').disparar('click');
  await esperar();
  assert.strictEqual(m.pedidos.some(p => p.caminho.endsWith('/recusar')), false, 'voltar não recusa');
  assert.ok(caixa.open);

  botaoDe(caixa, 'Recusar').disparar('click');
  await esperar();
  confirmacao = m.dialogos().at(-1);
  botaoDe(confirmacao, 'Recusar e sair').disparar('click');
  await esperar(); await esperar(); await esperar();

  assert.strictEqual(m.pedidos.filter(p => p.caminho === '/api/usuarios/me/termos/recusar' && p.metodo === 'POST').length, 1);
  assert.strictEqual(m.armazenado.local.termosRecusados, '1', 'a tela de login vai explicar');
  assert.ok(!('user' in m.armazenado.local) && !('rememberUser' in m.armazenado.local) && !('currentUser' in m.armazenado.sessao), 'sem sessão guardada: não entra sozinho de novo');
  assert.deepStrictEqual(m.eletron, ['openLoginHidden', 'logout']);
  assert.strictEqual(m.dialogos().length, 0);
});

test('recusar que o backend não aceita (único Sup Admin) mostra o motivo e mantém a caixa; sem pedido, nada aparece', async () => {
  const m = carregarAceite({
    respostas: {
      '/api/usuarios/me/termos': () => [200, { pendente: true }],
      '/api/usuarios/me/termos/recusar': () => [409, { error: 'Você é o único Sup Admin ativo.', code: 'UNICO_SUP_ADMIN' }]
    }
  });
  m.T.verificarSessao();
  await esperar();
  const caixa = m.dialogos()[0];
  botaoDe(caixa, 'Recusar').disparar('click');
  await esperar();
  botaoDe(m.dialogos().at(-1), 'Recusar e sair').disparar('click');
  await esperar(); await esperar(); await esperar();
  assert.ok(caixa.open);
  assert.strictEqual(comClasse(caixa, 'termos-erro')[0].textContent, 'Você é o único Sup Admin ativo.');
  assert.deepStrictEqual(m.eletron, []);
  assert.ok(!('termosRecusados' in m.armazenado.local));

  for (const resposta of [() => [200, { pendente: false }], () => [500, { error: 'x' }], () => { throw new Error('sem rede'); }]) {
    const livre = carregarAceite({ respostas: { '/api/usuarios/me/termos': resposta } });
    assert.strictEqual(await livre.T.verificarSessao(), false);
    assert.strictEqual(livre.dialogos().length, 0, 'sem pedido (ou sem resposta) o programa segue');
  }
});

test('a caixa entra antes de qualquer módulo, e o programa confere de novo ao voltar para a frente e a cada minuto', () => {
  const ini = MENU_JS.indexOf("window.addEventListener('load', async () => {");
  const carga = MENU_JS.slice(ini, MENU_JS.indexOf('// Ajustes responsivos ao redimensionar', ini));
  assert.ok(carga.indexOf('await window.TermosAceite?.verificarSessao?.();') > 0);
  assert.ok(carga.indexOf('await window.TermosAceite?.verificarSessao?.();') < carga.indexOf('await carregarPreferenciasMenuDoBanco();'));
  assert.ok(carga.indexOf('await window.TermosAceite?.verificarSessao?.();') < carga.indexOf('loadPage(pageToLoad)'));
  assert.ok(carga.includes('window.TermosAceite?.vigiarSessao?.();'));
  assert.ok(ACEITE.includes("global.addEventListener('focus', conferir);"));
  assert.ok(ACEITE.includes("document.addEventListener('visibilitychange', conferir);"));
  assert.ok(ACEITE.includes('const INTERVALO_DA_VIGIA_MS = 60 * 1000;'));

  // Os arquivos entram nas duas telas, na ordem certa (texto → caixa → quem usa).
  for (const [html, depois] of [[MENU_HTML, '../js/menu.js'], [LOGIN_HTML, 'loginRenderer.js']]) {
    const texto = html.indexOf('<script src="../js/utils/termos-documentos.js">');
    const caixa = html.indexOf('<script src="../js/utils/termos-aceite.js">');
    assert.ok(texto > 0 && caixa > texto && html.indexOf(`<script src="${depois}">`) > caixa);
    assert.ok(html.includes('styles/termos-aceite.css'));
  }
  // A folha da caixa não depende de Tailwind, Font Awesome nem folha de módulo.
  const css = ler('styles/termos-aceite.css');
  assert.ok(css.includes('background: rgba(255, 255, 255, 0.08);') && css.includes('backdrop-filter: blur(24px);'), 'o vidro padrão dos modais');
  assert.ok(css.includes('dialog.termos-dialogo::backdrop { background: rgba(0, 0, 0, 0.5); }'));
  assert.ok(css.includes('height: 40px;') && css.includes('font-size: 14px;') && css.includes('font-weight: 600;'), 'as medidas do botão padrão');
  assert.ok(!ACEITE.includes('fa-') && !ACEITE.includes('innerHTML'));
});

test('tela de login: as caixas no cadastro, o cadastro leva os aceites e a resposta diz o que falta', () => {
  assert.ok(LOGIN_HTML.includes('<div id="registerAceites"'));
  const formulario = LOGIN_HTML.slice(LOGIN_HTML.indexOf('<form id="registerForm"'), LOGIN_HTML.indexOf('</form>', LOGIN_HTML.indexOf('<form id="registerForm"')));
  assert.ok(formulario.indexOf('id="registerAceites"') > formulario.indexOf('id="confirmPassword"'), 'depois dos campos');
  assert.ok(formulario.indexOf('id="registerAceites"') < formulario.indexOf('>Cadastrar</button>'), 'antes do botão Cadastrar');
  assert.ok(LOGIN_JS.includes("const aceitesDoCadastro = window.TermosAceite?.ligarCaixas("));
  const envio = LOGIN_JS.slice(LOGIN_JS.indexOf("registerForm.addEventListener('submit'"), LOGIN_JS.indexOf('// === 8)'));
  assert.ok(envio.indexOf('const aceites = aceitesDoCadastro?.aceitos();') < envio.indexOf('window.electronAPI.register('));
  assert.ok(envio.includes("showToast('Para se cadastrar, leia e aceite os Termos de Uso e a Política de Privacidade.', 'warning', 5000);"));
  assert.ok(/window\.electronAPI\.register\(\s*name,\s*emailReg,\s*passwordReg,\s*aceites\s*\)/.test(envio));
  assert.ok(envio.includes('await showCadastroRecebido(result.emailEnviado !== false);'));
  assert.ok(LOGIN_JS.includes('Depois da confirmação, o administrador define as suas permissões e libera o acesso.'));
  assert.ok(ler('../preload.js').includes("ipcRenderer.invoke('registrar-usuario', { name, email, password, aceites })"));
});

// ---------------------------------------------------------------------------
// Usuários: a coluna Termos e o botão de pedir o aceite
// ---------------------------------------------------------------------------

function carregarTermosDeUsuarios({ supAdmin = true } = {}) {
  const ini = USUARIOS_JS.indexOf('const TERMOS_SEM_SQL');
  const fim = USUARIOS_JS.indexOf('async function pedirAceiteDosTermos');
  assert.ok(ini > 0 && fim > ini);
  const cliques = [];
  const ctx = {
    document: { createElement: criarElemento },
    window: { Permissoes: { supAdmin } },
    usuarioLogado: { perfil: supAdmin ? 'Sup Admin' : 'Admin' },
    formatarDataHoraCompleta: v => (v ? `[${v}]` : 'Sem registro'),
    pedirAceiteDosTermos: (usuario, botao) => cliques.push([usuario.id, botao.dataset.acao]),
    String, Boolean
  };
  vm.runInNewContext(`${USUARIOS_JS.slice(ini, fim)}; this.resolverTermos = resolverTermos; this.criarBotaoDosTermos = criarBotaoDosTermos;`, ctx);
  return { ...ctx, cliques };
}

test('Usuários: coluna Termos depois de Status — Aceito em verde, Pendente em vermelho', () => {
  const colunas = [...USUARIOS_HTML.matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map(m => m[1]);
  assert.deepStrictEqual(colunas, ['Avatar', 'Nome', 'E-mail', 'Perfil', 'Situação', 'Status', 'Termos', 'Ações']);
  assert.ok(USUARIOS_JS.indexOf('data-status-badge') < USUARIOS_JS.indexOf('<span data-termos-badge'), 'a célula vem depois da de Status');

  const { resolverTermos } = carregarTermosDeUsuarios();
  const aceito = resolverTermos({ termos_situacao: 'aceito', termos_aceitos_em: '2026-10-02', termos_versao: '1.0', privacidade_versao: '1.0' });
  assert.deepStrictEqual([aceito.rotulo, aceito.classe], ['Aceito', 'badge-success']);
  assert.strictEqual(aceito.dica, 'Aceito em [2026-10-02] (Termos de Uso 1.0 e Política de Privacidade 1.0)');

  const pendente = resolverTermos({ termos_situacao: 'pendente' });
  assert.deepStrictEqual([pendente.rotulo, pendente.classe], ['Pendente', 'badge-danger']);
  const pedido = resolverTermos({ termos_situacao: 'pendente', termos_solicitado: true, termos_solicitados_em: '2026-10-02', termos_recusados_em: '2026-10-03' });
  assert.ok(pedido.dica.includes('Aceite pedido em [2026-10-02]') && pedido.dica.includes('Recusou em [2026-10-03].'));

  const semSql = resolverTermos({ termos_situacao: 'indisponivel' });
  assert.deepStrictEqual([semSql.rotulo, semSql.classe], ['—', 'badge-secondary']);
  assert.ok(semSql.dica.includes('sql/usuarios_termos.sql'));
  const css = ler('css/usuarios.css');
  assert.ok(css.includes('.badge-secondary {'));
});

test('Usuários: o botão dos termos fica à esquerda do Editar, só o Sup Admin aciona e só com os termos pendentes', () => {
  const ordem = ['actionsWrapper.appendChild(toggleBtn);', 'actionsWrapper.appendChild(criarBotaoDosTermos(u));', 'actionsWrapper.appendChild(editBtn);', 'actionsWrapper.appendChild(deleteBtn);']
    .map(trecho => USUARIOS_JS.indexOf(trecho));
  assert.ok(ordem.every(p => p > 0) && ordem.join() === [...ordem].sort((a, b) => a - b).join(), 'tomada, termos, editar, excluir');

  const sup = carregarTermosDeUsuarios({ supAdmin: true });
  const livre = sup.criarBotaoDosTermos({ id: 7, nome: 'Ana', termos_situacao: 'pendente' });
  assert.strictEqual(livre.disabled, false);
  assert.strictEqual(livre.title, 'Pedir a Ana o aceite dos Termos de Uso e da Política de Privacidade');
  assert.ok(livre.children[0].classList.contains('fa-file-signature'));
  livre.disparar('click');
  assert.deepStrictEqual(sup.cliques, [[7, 'termos']]);

  const aceito = sup.criarBotaoDosTermos({ id: 8, termos_situacao: 'aceito' });
  assert.deepStrictEqual([aceito.disabled, aceito.title], [true, 'Termos já aceitos']);
  const pedido = sup.criarBotaoDosTermos({ id: 9, termos_situacao: 'pendente', termos_solicitado: true, termos_solicitados_em: '2026-10-02' });
  assert.strictEqual(pedido.disabled, true);
  assert.ok(pedido.title.startsWith('Aceite já pedido em [2026-10-02]'));
  const semSql = sup.criarBotaoDosTermos({ id: 10, termos_situacao: 'indisponivel' });
  assert.ok(semSql.disabled && semSql.title.includes('sql/usuarios_termos.sql'));
  [aceito, pedido, semSql].forEach(b => b.disparar('click'));
  assert.strictEqual(sup.cliques.length, 1, 'desabilitado não pede nada');

  const admin = carregarTermosDeUsuarios({ supAdmin: false });
  const negado = admin.criarBotaoDosTermos({ id: 7, termos_situacao: 'pendente' });
  assert.deepStrictEqual([negado.disabled, negado.title], [true, 'Só o Sup Admin pede o aceite dos termos']);

  const pedir = USUARIOS_JS.slice(USUARIOS_JS.indexOf('async function pedirAceiteDosTermos'), USUARIOS_JS.indexOf('function fecharPopoversUsuarios'));
  assert.ok(pedir.includes('await window.DialogPadrao.confirm({'), 'confirma pelo diálogo padrão');
  assert.ok(pedir.includes('/termos/solicitar`, { method: \'POST\' })'));
  assert.ok(pedir.includes('window.BotaoAcao.comCarregamento('), 'carregando depois da confirmação');
});

// ---------------------------------------------------------------------------
// Menu: nada proibido chega a ser desenhado
// ---------------------------------------------------------------------------

/** Um menu de mentira: Dashboard, Pedidos, CRM (Clientes, Tarefas) e Usuários. */
function menuFalso() {
  const item = (pagina, classe = 'sidebar-item') => {
    const no = criarElemento('div');
    no.classList.add(classe);
    if (pagina) no.atributos['data-page'] = pagina;
    no.toggleAttribute = (nome, ligado) => { if (ligado) no.atributos[nome] = ''; else delete no.atributos[nome]; };
    return no;
  };
  const dashboard = item('dashboard');
  const pedidos = item('pedidos');
  const crm = item(null);
  const submenu = item(null, 'submenu');
  const clientes = item('clientes', 'submenu-item');
  const tarefas = item('tarefas', 'submenu-item');
  const usuarios = item('usuarios');
  submenu.previousElementSibling = crm;
  submenu.querySelector = () => [clientes, tarefas].find(x => 'data-perm-liberado' in x.atributos) || null;
  const paginas = [dashboard, pedidos, clientes, tarefas, usuarios];
  return {
    crm, paginas,
    liberados: () => paginas.filter(x => 'data-perm-liberado' in x.atributos).map(x => x.atributos['data-page']),
    document: {
      readyState: 'complete',
      body: criarElemento('body'),
      querySelectorAll: seletor => {
        if (seletor === '.sidebar-item[data-page], .submenu-item[data-page]') return paginas;
        if (seletor === '.submenu') return [submenu];
        return [];
      }
    }
  };
}

function carregarPermissoes(respostas) {
  const menu = menuFalso();
  const fila = [...respostas];
  let buscas = 0;
  const esperas = [];
  const eventos = [];
  const ctx = {
    document: menu.document,
    console: { warn() {}, error() {}, log() {} },
    apiConfig: { getApiBaseUrl: async () => '' },
    fetch: async () => {
      buscas += 1;
      const proxima = fila.length > 1 ? fila.shift() : fila[0];
      if (proxima === 'falha') throw new Error('sem rede');
      return { ok: true, json: async () => proxima };
    },
    // As esperas entre tentativas correm na hora; a nova tentativa agendada fica guardada.
    setTimeout: (fn, ms) => { if (ms >= 5000) esperas.push(fn); else fn(); return 1; },
    dispatchEvent: evento => eventos.push(evento.detail),
    CustomEvent: function (nome, opcoes) { this.type = nome; this.detail = opcoes?.detail; },
    Promise, Object, Boolean, String, Map, Set, WeakMap, Array
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(PERMISSOES, ctx);
  return { P: ctx.Permissoes, menu, buscas: () => buscas, esperas, eventos };
}

const PERFIL_COMERCIAL = {
  usuarioId: 7, perfil: 'Comercial', supAdmin: false,
  paginas: { dashboard: 'dashboard', pedidos: 'ped', clientes: 'cli', tarefas: 'tarefas', usuarios: 'usuarios' },
  permissoes: { dashboard: { ativo: true }, ped: { ativo: false }, cli: { ativo: true }, tarefas: { ativo: false }, usuarios: { ativo: false } }
};

test('menu: nasce escondido e só o módulo permitido recebe a marca que o mostra', async () => {
  // A folha esconde tudo o que não tem a marca — é o estado em que o HTML chega.
  const regra = MENU_CSS.slice(MENU_CSS.indexOf('.sidebar-item[data-page]:not([data-perm-liberado])'), MENU_CSS.indexOf('/* O quadro que ocupa o lugar do módulo'));
  for (const seletor of ['.sidebar-item[data-page]:not([data-perm-liberado])', '.submenu-item[data-page]:not([data-perm-liberado])', '#crmToggle:not([data-perm-liberado])', '#laminacaoToggle:not([data-perm-liberado])']) {
    assert.ok(regra.includes(seletor), `falta ${seletor}`);
  }
  assert.ok(regra.includes('display: none !important;'));
  assert.ok(!/data-perm-liberado/.test(MENU_HTML), 'nenhum item do menu vem liberado no HTML');
  assert.ok(MENU_HTML.indexOf('js/permissoes.js') < MENU_HTML.indexOf('js/menu.js'));

  const m = carregarPermissoes([PERFIL_COMERCIAL]);
  assert.strictEqual(m.P.moduloAtivo('dashboard'), false, 'antes de as permissões chegarem: nenhum módulo');
  assert.strictEqual(m.P.podeAbrirPagina('usuarios'), false);
  assert.deepStrictEqual(m.menu.liberados(), [], 'nada desenhado antes da resposta');

  await m.P.init();
  assert.deepStrictEqual(m.menu.liberados(), ['dashboard', 'clientes']);
  assert.ok('data-perm-liberado' in m.menu.crm.atributos, 'o grupo CRM aparece: tem um módulo liberado');
  assert.strictEqual(m.P.podeAbrirPagina('pedidos'), false);
  assert.strictEqual(m.P.podeAbrirPagina('clientes'), true);
});

test('menu: grupo sem nenhum módulo some; permissão retirada tira a marca; Sup Admin vê tudo', async () => {
  const semCrm = { ...PERFIL_COMERCIAL, permissoes: { ...PERFIL_COMERCIAL.permissoes, cli: { ativo: false } } };
  const m = carregarPermissoes([PERFIL_COMERCIAL, semCrm]);
  await m.P.init();
  assert.ok('data-perm-liberado' in m.menu.crm.atributos);
  await m.P.recarregar(m.menu.document);
  assert.deepStrictEqual(m.menu.liberados(), ['dashboard']);
  assert.ok(!('data-perm-liberado' in m.menu.crm.atributos), 'CRM sem módulo liberado não aparece');

  const sup = carregarPermissoes([{ supAdmin: true, perfil: 'Sup Admin', paginas: {}, permissoes: {} }]);
  await sup.P.init();
  assert.deepStrictEqual(sup.menu.liberados(), ['dashboard', 'pedidos', 'clientes', 'tarefas', 'usuarios']);
});

test('menu: sem conseguir as permissões nenhum módulo aparece (antes aparecia tudo); a carga insiste e se recupera sozinha', async () => {
  const m = carregarPermissoes(['falha', 'falha', 'falha', PERFIL_COMERCIAL]);
  await m.P.init();
  assert.strictEqual(m.buscas(), 3, 'três tentativas antes de desistir');
  assert.strictEqual(m.P.indisponivel, true);
  assert.deepStrictEqual(m.menu.liberados(), [], 'na dúvida, nada');
  assert.strictEqual(m.P.podeAbrirPagina('dashboard'), false);
  // (objetos criados dentro do vm: comparar pelo JSON)
  assert.strictEqual(JSON.stringify(m.eventos), '[{"indisponivel":true}]');

  // A nova tentativa agendada traz as permissões e o menu aparece.
  assert.strictEqual(m.esperas.length, 1);
  await m.esperas[0]();
  assert.strictEqual(m.P.indisponivel, false);
  assert.deepStrictEqual(m.menu.liberados(), ['dashboard', 'clientes']);
  assert.strictEqual(JSON.stringify(m.eventos.at(-1)), '{"indisponivel":false}');

  // O backend dizendo "não sei quem é você" ({ erro: true }) vale como falha.
  const semIdentidade = carregarPermissoes([{ erro: true, permissoes: {} }]);
  await semIdentidade.P.init();
  assert.strictEqual(semIdentidade.P.indisponivel, true);
  assert.deepStrictEqual(semIdentidade.menu.liberados(), []);
});

test('menu: recarga que falha não derruba o menu de quem já tinha as permissões', async () => {
  const m = carregarPermissoes([PERFIL_COMERCIAL, 'falha']);
  await m.P.init();
  await m.P.recarregar(m.menu.document);
  assert.strictEqual(m.P.indisponivel, false);
  assert.deepStrictEqual(m.menu.liberados(), ['dashboard', 'clientes']);
});

test('abrir módulo: espera as permissões, na dúvida não abre e nunca mais entra em laço atrás do Dashboard', () => {
  const pode = MENU_JS.slice(MENU_JS.indexOf('function podeAbrirModulo(page)'), MENU_JS.indexOf('function primeiraPaginaPermitida'));
  assert.ok(!/return true;/.test(pode), 'nenhum caminho libera na dúvida');
  assert.strictEqual((pode.match(/return false;/g) || []).length, 2);

  const abrir = MENU_JS.slice(MENU_JS.indexOf('async function loadPage(page, options = {}) {'), MENU_JS.indexOf('const loadId = ++moduleLoadSequence;'));
  assert.ok(abrir.indexOf('await window.Permissoes?.carregar?.();') < abrir.indexOf('if (!podeAbrirModulo(page)) {'), 'a permissão chega antes de decidir');
  assert.ok(abrir.includes('const alternativa = primeiraPaginaPermitida(page, reserva);'));
  assert.ok(abrir.includes('mostrarSemAcesso();'));
  assert.ok(!abrir.includes(': MENU_DEFAULT_PAGE_FALLBACK;'), 'a reserva não é mais o Dashboard à força');

  // primeiraPaginaPermitida: reserva, Dashboard, depois a ordem do menu — nunca a própria página proibida.
  const fonte = MENU_JS.slice(MENU_JS.indexOf('function primeiraPaginaPermitida'), MENU_JS.indexOf('/**\n * Nada pode ser aberto'.replace('\n', '\r\n')) > 0
    ? MENU_JS.indexOf('/**\r\n * Nada pode ser aberto')
    : MENU_JS.indexOf('/**\n * Nada pode ser aberto'));
  const permitidas = new Set(['clientes', 'tarefas']);
  const ctx = {
    document: { querySelectorAll: () => ['dashboard', 'pedidos', 'clientes', 'tarefas'].map(p => ({ dataset: { page: p } })) },
    podeAbrirModulo: p => permitidas.has(p),
    Array
  };
  vm.runInNewContext(`${fonte}; this.primeira = primeiraPaginaPermitida;`, ctx);
  assert.strictEqual(ctx.primeira('pedidos', null), 'clientes', 'sem Dashboard: o primeiro permitido do menu');
  assert.strictEqual(ctx.primeira('pedidos', 'tarefas'), 'tarefas', 'a reserva pedida vem primeiro');
  assert.strictEqual(ctx.primeira('clientes', null), 'tarefas', 'nunca devolve a própria página');
  permitidas.clear();
  assert.strictEqual(ctx.primeira('pedidos', null), null, 'nada permitido: quadro de sem acesso, sem laço');
  assert.ok(MENU_JS.includes("titulo.textContent = indisponivel ? 'Carregando as suas permissões' : 'Nenhum módulo liberado';"));
});
