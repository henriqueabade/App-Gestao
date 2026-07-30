const test = require('node:test');
const assert = require('node:assert');

const regra = require('../utils/restauracao.js');

const X = { id: 7, nome: 'Usuário X' };
const Y = { id: 9, nome: 'Usuário Y' };

function estado({ motivo = 'offline', dono = X, salvoEm = Date.now() } = {}) {
  return {
    sectionId: 'produtos',
    motivo,
    usuarioId: dono ? String(dono.id) : null,
    salvoEm,
    storage: { user: dono ? JSON.stringify(dono) : null }
  };
}

// --- 1. Só restaura em desconexão -----------------------------------------

test('queda de internet permite restaurar', () => {
  assert.strictEqual(regra.podeRestaurar(estado({ motivo: 'offline' }), X).ok, true);
});

test('banco indisponível permite restaurar', () => {
  assert.strictEqual(regra.podeRestaurar(estado({ motivo: 'offline-db' }), X).ok, true);
});

test('corte pelo administrador permite restaurar', () => {
  for (const motivo of ['admin-disabled', 'admin-pending', 'pin']) {
    assert.strictEqual(regra.podeRestaurar(estado({ motivo }), X).ok, true, motivo);
  }
});

test('sair pelo menu NÃO restaura', () => {
  const veredito = regra.podeRestaurar(estado({ motivo: 'logout' }), X);
  assert.deepStrictEqual(veredito, { ok: false, causa: 'saida-normal' });
});

test('logout por inatividade NÃO restaura', () => {
  assert.strictEqual(regra.podeRestaurar(estado({ motivo: 'idle-timeout' }), X).causa, 'saida-normal');
});

test('estado sem motivo (versões antigas, gravado ao sair) NÃO restaura', () => {
  assert.strictEqual(regra.podeRestaurar(estado({ motivo: null }), X).causa, 'saida-normal');
});

test('usuário removido do sistema NÃO restaura', () => {
  assert.strictEqual(regra.podeRestaurar(estado({ motivo: 'user-removed' }), X).causa, 'saida-normal');
});

// --- 2. Só restaura para o mesmo usuário -----------------------------------

test('se X caiu e Y loga, não restaura — e a causa manda preservar o arquivo', () => {
  const veredito = regra.podeRestaurar(estado({ dono: X }), Y);
  assert.deepStrictEqual(veredito, { ok: false, causa: 'outro-usuario' });
});

test('X caiu e X loga: restaura', () => {
  assert.strictEqual(regra.podeRestaurar(estado({ dono: X }), X).ok, true);
});

test('sem dono identificado NÃO restaura (antes voltava para qualquer um)', () => {
  assert.strictEqual(regra.podeRestaurar(estado({ dono: null }), X).causa, 'sem-dono');
});

test('sem saber quem está logando NÃO restaura', () => {
  assert.strictEqual(regra.podeRestaurar(estado({ dono: X }), null).causa, 'sem-usuario-atual');
});

test('id como número, string ou JSON são o mesmo usuário', () => {
  assert.strictEqual(regra.podeRestaurar(estado({ dono: X }), 7).ok, true);
  assert.strictEqual(regra.podeRestaurar(estado({ dono: X }), '7').ok, true);
  assert.strictEqual(regra.podeRestaurar(estado({ dono: X }), JSON.stringify(X)).ok, true);
});

test('estado antigo, só com storage.user, ainda identifica o dono', () => {
  const antigo = { motivo: 'offline', salvoEm: Date.now(), storage: { user: JSON.stringify(X) } };
  assert.strictEqual(regra.podeRestaurar(antigo, X).ok, true);
  assert.strictEqual(regra.podeRestaurar(antigo, Y).causa, 'outro-usuario');
});

// --- 3. Janela de 30 minutos ----------------------------------------------

test('dentro dos 30 minutos restaura', () => {
  const salvoEm = Date.now() - 29 * 60 * 1000;
  assert.strictEqual(regra.podeRestaurar(estado({ salvoEm }), X).ok, true);
});

test('passados os 30 minutos não restaura', () => {
  const salvoEm = Date.now() - 31 * 60 * 1000;
  assert.strictEqual(regra.podeRestaurar(estado({ salvoEm }), X).causa, 'expirado');
});

test('sem estado guardado não há o que restaurar', () => {
  assert.deepStrictEqual(regra.podeRestaurar(null, X), { ok: false, causa: 'sem-estado' });
});

// --- Ordem de avaliação ----------------------------------------------------

test('saída voluntária é barrada antes de qualquer conferência de dono', () => {
  // Garante que sair pelo menu nunca vaza por outro caminho.
  assert.strictEqual(regra.podeRestaurar(estado({ motivo: 'logout', dono: null }), null).causa, 'saida-normal');
});
