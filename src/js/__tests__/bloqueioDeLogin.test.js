const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..', '..');
const FONTE = fs.readFileSync(path.join(RAIZ, 'main.js'), 'utf8');

/**
 * Bloqueio por tentativas de login.
 *
 * O bloqueio vivia só na memória do processo principal: errar a senha três
 * vezes travava a conta, mas fechar e reabrir o app zerava a contagem e as três
 * tentativas voltavam — indefinidamente. Um bloqueio que se desfaz fechando a
 * janela não protege nada.
 *
 * O que se defende aqui é a persistência: a contagem tem de atravessar o
 * reinício, e tem de expirar sozinha quando a janela de tempo acaba.
 */

function recortar(fonte, inicio, fim) {
  const i = fonte.indexOf(inicio);
  assert.notStrictEqual(i, -1, `trecho não encontrado: ${inicio}`);
  const f = fonte.indexOf(fim, i);
  assert.notStrictEqual(f, -1, `fim não encontrado: ${fim}`);
  return fonte.slice(i, f + fim.length);
}

/**
 * Carrega o controle de tentativas com um disco falso.
 *
 * O arquivo é o mesmo do app; o que muda é o `fs`, que aqui guarda em memória —
 * assim dá para simular "fechou e abriu" recarregando o módulo com o mesmo
 * conteúdo de disco.
 */
function carregar(discoInicial = {}) {
  const disco = { ...discoInicial };
  const CAMINHO = 'C:/fake/userData/login-attempts.json';

  const contexto = {
    console: { warn() {}, error() {}, info() {} },
    Date,
    Math,
    Number,
    JSON,
    Object,
    Map,
    path: { join: (...partes) => partes.join('/') },
    app: { getPath: () => 'C:/fake/userData' },
    fs: {
      readFileSync(caminho) {
        if (!(caminho in disco)) {
          const erro = new Error('ENOENT');
          erro.code = 'ENOENT';
          throw erro;
        }
        return disco[caminho];
      },
      writeFileSync(caminho, conteudo) { disco[caminho] = conteudo; }
    }
  };

  vm.createContext(contexto);
  vm.runInContext(
    [
      recortar(FONTE, 'const LOGIN_MAX_TENTATIVAS', 'const tentativasLogin = new Map();'),
      recortar(FONTE, 'let arquivoTentativas = null;', 'let tentativasCarregadas = false;'),
      recortar(FONTE, 'function caminhoDasTentativas()', '\n}'),
      recortar(FONTE, 'function carregarTentativas()', '\n}'),
      recortar(FONTE, 'function salvarTentativas()', '\n}'),
      recortar(FONTE, 'function chaveTentativa(', '\n}'),
      recortar(FONTE, 'function lerTentativas(', '\n}'),
      recortar(FONTE, 'function minutosParaLiberar(', '\n}'),
      recortar(FONTE, 'function registrarFalhaLogin(', '\n}'),
      recortar(FONTE, 'function limparTentativasLogin(', '\n}'),
      'this.LOGIN_MAX_TENTATIVAS = LOGIN_MAX_TENTATIVAS;',
      'this.lerTentativas = lerTentativas;',
      'this.registrarFalhaLogin = registrarFalhaLogin;',
      'this.limparTentativasLogin = limparTentativasLogin;',
      'this.minutosParaLiberar = minutosParaLiberar;'
    ].join('\n'),
    contexto
  );

  return { ...contexto, disco, CAMINHO };
}

test('três falhas bloqueiam a conta', () => {
  const app = carregar();

  assert.equal(app.registrarFalhaLogin('a@b.com'), 1);
  assert.equal(app.registrarFalhaLogin('a@b.com'), 2);
  assert.equal(app.registrarFalhaLogin('a@b.com'), 3);
  assert.ok(app.lerTentativas('a@b.com') >= app.LOGIN_MAX_TENTATIVAS);
});

test('o bloqueio SOBREVIVE a fechar e abrir o app', () => {
  const primeira = carregar();
  primeira.registrarFalhaLogin('a@b.com');
  primeira.registrarFalhaLogin('a@b.com');
  primeira.registrarFalhaLogin('a@b.com');

  // Reabrir = carregar de novo, do mesmo disco. Era exatamente aqui que a
  // contagem se perdia e as três tentativas voltavam.
  const segunda = carregar(primeira.disco);
  assert.equal(
    segunda.lerTentativas('a@b.com'), 3,
    'a contagem tem de vir do disco, não da memória do processo'
  );
});

test('e-mail é comparado sem diferenciar maiúsculas nem espaços', () => {
  const app = carregar();
  app.registrarFalhaLogin('  A@B.com ');
  app.registrarFalhaLogin('a@b.COM');
  assert.equal(app.lerTentativas('a@b.com'), 2, 'trocar a caixa não zera a contagem');
});

test('login certo limpa a contagem, no disco também', () => {
  const primeira = carregar();
  primeira.registrarFalhaLogin('a@b.com');
  primeira.registrarFalhaLogin('a@b.com');
  primeira.limparTentativasLogin('a@b.com');

  const segunda = carregar(primeira.disco);
  assert.equal(segunda.lerTentativas('a@b.com'), 0);
});

test('a janela expira sozinha: bloqueio não é permanente', () => {
  const app = carregar();
  app.registrarFalhaLogin('a@b.com');
  app.registrarFalhaLogin('a@b.com');
  app.registrarFalhaLogin('a@b.com');
  assert.ok(app.minutosParaLiberar('a@b.com') > 0, 'a mensagem diz quanto falta');

  // Um arquivo com a janela já vencida não pode bloquear ninguém.
  const vencido = carregar({
    'C:/fake/userData/login-attempts.json': JSON.stringify({
      'a@b.com': { falhas: 3, expiraEm: Date.now() - 1000 }
    })
  });
  assert.equal(vencido.lerTentativas('a@b.com'), 0);
});

test('arquivo corrompido não impede o login', () => {
  // Perder a contagem é aceitável; travar o acesso de todo mundo não é.
  const app = carregar({ 'C:/fake/userData/login-attempts.json': '{ isso não é json' });
  assert.equal(app.lerTentativas('a@b.com'), 0);
});

test('a contagem de um e-mail não afeta a de outro', () => {
  const app = carregar();
  app.registrarFalhaLogin('a@b.com');
  app.registrarFalhaLogin('a@b.com');
  app.registrarFalhaLogin('a@b.com');
  assert.equal(app.lerTentativas('outro@b.com'), 0);
});
