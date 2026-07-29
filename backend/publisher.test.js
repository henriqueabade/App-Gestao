const test = require('node:test');
const assert = require('node:assert/strict');

const { createPublishProgressTracker } = require('./publisher');

test('progresso da publicação acompanha as etapas reais sem retroceder', () => {
  const events = [];
  const tracker = createPublishProgressTracker(event => events.push(event));

  tracker.report(10, 'Repositório validado');
  tracker.consume('packaging platform=win32 arch=x64');
  tracker.consume('building target=nsis');
  tracker.consume('uploading file=app.exe progress=50%');
  tracker.consume('mensagem tardia de empacotamento');

  assert.deepEqual(events.map(event => event.progress), [10, 20, 38, 77, 77]);
  assert.equal(tracker.getProgress(), 77);
});

test('progresso reportado pela ferramenta fica reservado abaixo de 100%', () => {
  const events = [];
  const tracker = createPublishProgressTracker(event => events.push(event));

  tracker.consume('uploading 100%');

  assert.equal(events.at(-1).progress, 98);
});
