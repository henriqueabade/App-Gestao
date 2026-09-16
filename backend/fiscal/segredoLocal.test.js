/**
 * Onde o certificado e a senha ficam (backend/fiscal/segredoLocal.js).
 *
 * O cofre é injetado: o de verdade é o safeStorage do Electron, que não existe
 * no Node dos testes. O que importa provar: a senha nunca é gravada em claro,
 * sem cofre não se guarda nada, e um cofre diferente não lê o que outro cifrou.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const segredoLocal = require('./segredoLocal');

const SENHA = 'senha-secreta-123';

function cofreFalso(nome = 'teste') {
  return {
    nome,
    cifrar: texto => Buffer.from(`${nome}:${texto}`).toString('base64'),
    decifrar: base64 => {
      const texto = Buffer.from(base64, 'base64').toString();
      if (!texto.startsWith(`${nome}:`)) throw new Error('cofre errado');
      return texto.slice(nome.length + 1);
    }
  };
}

function ambiente() {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'fiscal-'));
  const origem = path.join(pasta, 'origem.pfx');
  fs.writeFileSync(origem, Buffer.from('conteudo do pfx'));
  return { pasta: path.join(pasta, 'guardado'), origem };
}

test('outros segredos (senha do e-mail): cifrados no mesmo cofre, um arquivo por nome, e nunca em claro', () => {
  const { pasta } = ambiente();
  const segredo = segredoLocal.criar({ pasta, cofre: cofreFalso(), env: {} });
  assert.equal(segredo.lerSegredo('smtp'), null);
  assert.equal(segredo.guardarSegredo('smtp', 'senha-do-email'), true);
  const lido = segredo.lerSegredo('smtp');
  assert.equal(lido.valor, 'senha-do-email');
  assert.match(lido.guardadoEm, /^\d{4}-\d{2}-\d{2}T/);
  const arquivo = path.join(pasta, 'segredo-smtp.json');
  assert.ok(fs.existsSync(arquivo));
  assert.ok(!fs.readFileSync(arquivo, 'utf8').includes('senha-do-email'), 'nada em claro no disco');
  assert.equal(segredo.lerSegredo('../outro'), null, 'o nome é saneado');

  const outroCofre = segredoLocal.criar({ pasta, cofre: cofreFalso('outro'), env: {} });
  assert.match(outroCofre.lerSegredo('smtp').erro, /outro cofre/);
  const semCofre = segredoLocal.criar({ pasta, cofre: null, env: {} });
  assert.match(semCofre.lerSegredo('smtp').erro, /cofre do sistema/);
  assert.throws(() => semCofre.guardarSegredo('smtp', 'x'), /exige o cofre/);

  segredo.removerSegredo('smtp');
  assert.equal(segredo.lerSegredo('smtp'), null);
  assert.equal(segredo.fonte(), null, 'os segredos não mexem no certificado');
});

test('guarda o .pfx copiado e a senha cifrada; a fonte devolve a senha decifrada', () => {
  const { pasta, origem } = ambiente();
  const segredo = segredoLocal.criar({ pasta, cofre: cofreFalso(), env: {} });
  assert.equal(segredo.fonte(), null, 'nada guardado, nada no env');

  const validados = [];
  const dados = segredo.guardar({ caminhoOrigem: origem, senha: SENHA, validar: (buf, senha) => { validados.push([buf.toString(), senha]); return { ok: true }; } });
  assert.deepEqual(dados, { ok: true });
  assert.deepEqual(validados, [['conteudo do pfx', SENHA]]);

  const fonte = segredo.fonte();
  assert.equal(fonte.origem, 'arquivo');
  assert.equal(fonte.senha, SENHA);
  assert.equal(fs.readFileSync(fonte.caminho).toString(), 'conteudo do pfx');

  const config = fs.readFileSync(path.join(pasta, 'certificado.json'), 'utf8');
  assert.ok(!config.includes(SENHA), 'a senha não pode estar em claro no arquivo');
  assert.match(config, /"cifra": "teste"/);
});

test('validação que falha não grava nada', () => {
  const { pasta, origem } = ambiente();
  const segredo = segredoLocal.criar({ pasta, cofre: cofreFalso(), env: {} });
  assert.throws(() => segredo.guardar({ caminhoOrigem: origem, senha: 'x', validar: () => { throw new Error('Senha do certificado incorreta.'); } }), /Senha do certificado incorreta/);
  assert.equal(fs.existsSync(path.join(pasta, 'certificado.pfx')), false);
  assert.equal(segredo.fonte(), null);
});

test('sem cofre não guarda; com outro cofre não lê', () => {
  const { pasta, origem } = ambiente();
  const semCofre = segredoLocal.criar({ pasta, cofre: null, env: {} });
  assert.throws(() => semCofre.guardar({ caminhoOrigem: origem, senha: SENHA }), e => e.status === 500 && /cofre/.test(e.message));
  assert.equal(semCofre.temCofre, false);

  segredoLocal.criar({ pasta, cofre: cofreFalso('a'), env: {} }).guardar({ caminhoOrigem: origem, senha: SENHA });
  const outro = segredoLocal.criar({ pasta, cofre: cofreFalso('b'), env: {} }).fonte();
  assert.equal(outro.senha, null);
  assert.match(outro.erro, /outro cofre/);

  const semCofreDepois = segredoLocal.criar({ pasta, cofre: null, env: {} }).fonte();
  assert.equal(semCofreDepois.senha, null);
  assert.match(semCofreDepois.erro, /cofre do sistema/);
});

test('variáveis de ambiente valem só quando não há certificado guardado; remover apaga tudo', () => {
  const { pasta, origem } = ambiente();
  const env = { NFE_CERT_PATH: origem, NFE_CERT_SENHA: 'do-env' };
  const segredo = segredoLocal.criar({ pasta, cofre: cofreFalso(), env });
  assert.deepEqual(segredo.fonte(), { origem: 'env', caminho: origem, senha: 'do-env' });

  segredo.guardar({ caminhoOrigem: origem, senha: SENHA });
  assert.equal(segredo.fonte().origem, 'arquivo', 'o guardado vence o env');

  segredo.remover();
  assert.equal(segredo.fonte().origem, 'env');
  segredo.remover();
  assert.equal(segredoLocal.criar({ pasta, cofre: cofreFalso(), env: {} }).fonte(), null);
});

test('fora do Electron não há cofre, e a pasta padrão respeita FISCAL_LOCAL_DIR', () => {
  assert.equal(segredoLocal.cofreDoElectron(), null);
  const anterior = process.env.FISCAL_LOCAL_DIR;
  process.env.FISCAL_LOCAL_DIR = 'C:/tmp/fiscal-x';
  try {
    assert.equal(segredoLocal.pastaPadrao(), 'C:/tmp/fiscal-x');
  } finally {
    if (anterior === undefined) delete process.env.FISCAL_LOCAL_DIR; else process.env.FISCAL_LOCAL_DIR = anterior;
  }
});
