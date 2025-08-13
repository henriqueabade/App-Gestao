const test = require('node:test');
const assert = require('node:assert');
const { getColorFromText } = require('../src/utils/colorParser');

test('azul petróleo', () => {
  assert.strictEqual(getColorFromText('azul petróleo'), '#0E4D64');
});

test('verde água claro', () => {
  assert.strictEqual(getColorFromText('verde água claro'), '#6bffc6');
});

test('rosa choque', () => {
  assert.strictEqual(getColorFromText('rosa choque'), '#FF1493');
});

test('transparente', () => {
  assert.strictEqual(getColorFromText('transparente'), '#00000000');
});

test('mostarda escura', () => {
  assert.strictEqual(getColorFromText('mostarda escura'), '#7F6A00');
});

test('variações de acento', () => {
  assert.strictEqual(getColorFromText('salmão'), '#FA8072');
  assert.strictEqual(getColorFromText('salmao'), '#FA8072');
});
