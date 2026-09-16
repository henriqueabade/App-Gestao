/**
 * Leitura do certificado A1 (backend/fiscal/certificado.js).
 *
 * O .pfx do teste é gerado na hora (certificadoDeTeste.js): o de verdade fica
 * fora do repositório. O que se prende aqui é o que a tela e a SEFAZ dependem:
 * titular e CNPJ tirados do CN, validade, chave em PEM, e as mensagens de
 * senha errada e de arquivo que não é certificado.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { gerarPfx } = require('./certificadoDeTeste');
const certificado = require('./certificado');

const SENHA = 'segredo';
const PFX = gerarPfx({ senha: SENHA });

test('abre o .pfx e devolve titular, CNPJ, validade e chave/certificado em PEM', () => {
  const dados = certificado.abrirPfx(PFX, SENHA);
  assert.equal(dados.titular, 'EMPRESA TESTE LTDA');
  assert.equal(dados.cnpj, '12345678000199');
  assert.match(dados.chavePrivadaPem, /-----BEGIN RSA PRIVATE KEY-----/);
  assert.match(dados.certificadoPem, /-----BEGIN CERTIFICATE-----/);
  assert.deepEqual(dados.cadeiaPem, []);
  assert.ok(dados.validoAte > new Date(), 'validade no futuro');
  assert.equal(dados.emissor, 'AC TESTE');
});

test('senha errada e arquivo que não é certificado têm mensagens próprias', () => {
  assert.throws(() => certificado.abrirPfx(PFX, 'outra'), e => e.status === 400 && /Senha do certificado incorreta/.test(e.message));
  assert.throws(() => certificado.abrirPfx(Buffer.from('isto não é um pfx'), SENHA), e => e.status === 400 && /não é um certificado/.test(e.message));
  assert.throws(() => certificado.abrirPfx(Buffer.alloc(0), SENHA), /vazio/);
});

test('CN sem CNPJ vira titular inteiro e cnpj nulo', () => {
  const pfx = gerarPfx({ cn: 'PESSOA FISICA TESTE', senha: SENHA, bits: 1024 });
  const dados = certificado.abrirPfx(pfx, SENHA);
  assert.equal(dados.titular, 'PESSOA FISICA TESTE');
  assert.equal(dados.cnpj, null);
});

test('resumo não carrega chave nem PEM, e avisa vencimento próximo e vencido', () => {
  const dados = certificado.abrirPfx(PFX, SENHA);
  const r = certificado.resumo(dados);
  assert.equal(r.configurado, true);
  assert.ok(!('chavePrivadaPem' in r) && !('certificadoPem' in r), 'resumo sem material da chave');
  assert.ok(r.diasRestantes >= 363 && r.diasRestantes <= 365);
  assert.equal(r.vencido, false);
  assert.equal(r.venceEmBreve, false);

  const perto = certificado.resumo(certificado.abrirPfx(gerarPfx({ senha: SENHA, diasValidade: 10 }), SENHA));
  assert.equal(perto.venceEmBreve, true);
  assert.equal(perto.vencido, false);

  const vencido = certificado.resumo(certificado.abrirPfx(gerarPfx({ senha: SENHA, diasValidade: -2 }), SENHA));
  assert.equal(vencido.vencido, true);

  assert.deepEqual(certificado.resumo(null), { configurado: false });
});
