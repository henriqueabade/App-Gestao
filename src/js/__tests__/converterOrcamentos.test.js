const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..', '..');

/** Recorta um trecho do arquivo real para exercitar a lógica de verdade. */
function recortar(fonte, inicioTexto, fimTexto) {
  const inicio = fonte.indexOf(inicioTexto);
  assert.notStrictEqual(inicio, -1, `trecho não encontrado: ${inicioTexto}`);
  const fim = fonte.indexOf(fimTexto, inicio);
  assert.notStrictEqual(fim, -1, `fim não encontrado: ${fimTexto}`);
  return fonte.slice(inicio, fim + fimTexto.length);
}

function recortarFuncao(fonte, nome) {
  const inicio = fonte.indexOf(`function ${nome}(`);
  assert.notStrictEqual(inicio, -1, `função ${nome} não encontrada`);
  let i = fonte.indexOf('{', inicio);
  let nivel = 0;
  for (; i < fonte.length; i += 1) {
    if (fonte[i] === '{') nivel += 1;
    else if (fonte[i] === '}') {
      nivel -= 1;
      if (nivel === 0) break;
    }
  }
  return fonte.slice(inicio, i + 1);
}

// ===================================================================
// Quem pode ser convertido
//
// A tabela do modal "Converter Orçamento" só pode oferecer o que de fato vira
// pedido. Deixar um rascunho ou um rejeitado passar leva o usuário a marcar,
// confirmar e receber erro; esconder um pendente some com trabalho legítimo.
// A regra é por EXCLUSÃO justamente para que um status novo apareça na lista
// em vez de desaparecer sem ninguém notar.
// ===================================================================
const FONTE_MODAL = fs.readFileSync(
  path.join(RAIZ, 'src/js/modals/pedido-converter-orcamentos.js'),
  'utf8'
);

function carregarRegra() {
  const contexto = vm.createContext({});
  vm.runInContext(
    [
      recortar(FONTE_MODAL, 'const SITUACOES_BLOQUEADAS', ']);'),
      recortarFuncao(FONTE_MODAL, 'normalizar'),
      recortarFuncao(FONTE_MODAL, 'podeConverter'),
      'this.podeConverter = podeConverter;'
    ].join('\n'),
    contexto
  );
  return contexto.podeConverter;
}

const podeConverter = carregarRegra();

test('pendente pode ser convertido', () => {
  assert.equal(podeConverter({ situacao: 'Pendente' }), true);
});

test('rascunho, cancelado, expirado e rejeitado ficam FORA da tabela', () => {
  for (const situacao of ['Rascunho', 'Cancelado', 'Expirado', 'Rejeitado']) {
    assert.equal(
      podeConverter({ situacao }),
      false,
      `"${situacao}" não pode ser convertido e não pode aparecer para seleção`
    );
  }
});

test('aprovado fica fora: já virou pedido', () => {
  assert.equal(podeConverter({ situacao: 'Aprovado' }), false);
});

test('a regra ignora acento, caixa e espaço', () => {
  for (const situacao of ['  rascunho ', 'RASCUNHO', 'Rascunho', 'EXPIRADO', ' rejeitado']) {
    assert.equal(podeConverter({ situacao }), false, `"${situacao}" precisa ser reconhecido`);
  }
});

test('status desconhecido aparece (falha para o lado de mostrar)', () => {
  assert.equal(
    podeConverter({ situacao: 'Em análise' }),
    true,
    'um status novo tem de aparecer na lista; sumir calado é pior que aparecer a mais'
  );
});

test('orçamento sem situação não é descartado à toa', () => {
  assert.equal(podeConverter({}), true);
  assert.equal(podeConverter({ situacao: null }), true);
});

// ===================================================================
// Último login no cartão da tela de login
// ===================================================================
const FONTE_LOGIN = fs.readFileSync(path.join(RAIZ, 'src/login/loginRenderer.js'), 'utf8');

function carregarUltimoLogin() {
  // `Date` e `Number` do host: sem isso o `vm` cria os seus próprios e o
  // `instanceof Date` do teste falharia por realm, não por defeito no código.
  const contexto = vm.createContext({ Date, Number });
  vm.runInContext(
    [
      recortarFuncao(FONTE_LOGIN, 'getUltimoLoginEm'),
      recortarFuncao(FONTE_LOGIN, 'formatarUltimoLogin'),
      'this.api = { getUltimoLoginEm, formatarUltimoLogin };'
    ].join('\n'),
    contexto
  );
  return contexto.api;
}

const { getUltimoLoginEm, formatarUltimoLogin } = carregarUltimoLogin();

test('lê o carimbo gravado no login', () => {
  const data = getUltimoLoginEm({ ultimoLoginEm: '2026-07-31T19:16:41.000Z' });
  assert.ok(data instanceof Date);
  assert.equal(data.toISOString(), '2026-07-31T19:16:41.000Z');
});

test('aceita os nomes vindos do banco também', () => {
  for (const chave of ['ultimo_login_em', 'ultimaEntrada', 'ultima_entrada']) {
    const data = getUltimoLoginEm({ [chave]: '2026-07-31T19:16:41.000Z' });
    assert.ok(data instanceof Date, `"${chave}" precisa ser reconhecido`);
  }
});

test('cadastro antigo (sem carimbo) não inventa data', () => {
  assert.equal(getUltimoLoginEm({ nome: 'Henrique' }), null,
    'sem data a linha some do cartão; mostrar "Invalid Date" seria pior');
  assert.equal(getUltimoLoginEm({ ultimoLoginEm: 'qualquer coisa' }), null);
  assert.equal(getUltimoLoginEm(null), null);
});

test('formata com data e hora, no padrão brasileiro', () => {
  const texto = formatarUltimoLogin(new Date('2026-07-31T19:16:41.000Z'));
  assert.match(texto, /31\/07\/2026/, 'a data precisa aparecer');
  assert.match(texto, /\d{2}:\d{2}/, 'a hora precisa aparecer');
});

test('sem data, o formatador devolve vazio em vez de quebrar', () => {
  assert.equal(formatarUltimoLogin(null), '');
});
