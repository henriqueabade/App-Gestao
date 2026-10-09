/**
 * Entrar pelo nome completo e o nome que não repete (pedido do dono,
 * 09/10/2026). A API decide em produção (acesso/login.js e acesso/nomes.js no
 * Santissimo-db-API); aqui: o login do DEV (localAuth), a conferência das
 * rotas de usuário e as ligações do main.js e do backend.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcrypt');

const NomeCompleto = require('../src/js/utils/nome-completo');

test('nome completo: junta, separa, compara sem acento/maiúscula/espaço e exige o sobrenome', () => {
  assert.equal(NomeCompleto.juntar('  Ana ', ' Paula   Lima '), 'Ana Paula Lima');
  assert.deepEqual(NomeCompleto.separar('Ana Paula Lima'), { nome: 'Ana', sobrenome: 'Paula Lima' });
  assert.equal(NomeCompleto.mesmoNome('JOÃO  da silva', 'joao da Silva'), true);
  assert.equal(NomeCompleto.mesmoNome('', ''), false, 'vazio nunca é "o mesmo nome"');
  assert.equal(NomeCompleto.mensagem('Ana'), 'Informe o nome e o sobrenome.');
  assert.equal(NomeCompleto.mensagem('Ana Lima'), '');
  assert.equal(NomeCompleto.mensagemDasPartes('Ana', ''), 'Informe o sobrenome.');
  assert.equal(NomeCompleto.mensagemDasPartes('', 'Lima'), 'Informe o nome.');
  assert.equal(NomeCompleto.ehEmail('ana@loja.com'), true);
  assert.equal(NomeCompleto.ehEmail('Ana Lima'), false);
});

test('login do DEV (localAuth): pelo e-mail ou pelo nome completo; nome de dois cadastros com a mesma senha pede o e-mail', async () => {
  const hash = await bcrypt.hash('Senha@1', 4);
  const outra = await bcrypt.hash('Outra@1', 4);
  const usuarios = [
    { id: 1, nome: 'Ana Paula Lima', email: 'ana@loja.com', senha: hash },
    { id: 2, nome: 'João da Silva', email: 'joao1@loja.com', senha: hash },
    { id: 3, nome: 'joao  DA silva', email: 'joao2@loja.com', senha: hash },
    { id: 4, nome: 'Bia Souza', email: 'bia@loja.com', senha: outra }
  ];
  const caminhoDb = require.resolve('./localDatabase');
  const caminhoAuth = require.resolve('./localAuth');
  const antes = require.cache[caminhoDb];
  require.cache[caminhoDb] = {
    id: caminhoDb, filename: caminhoDb, loaded: true,
    exports: {
      query: async (sql, p = []) => {
        if (/WHERE lower\(email\) = \$1/.test(sql)) return { rows: usuarios.filter(u => u.email.toLowerCase() === p[0]) };
        if (/WHERE nome IS NOT NULL/.test(sql)) return { rows: usuarios };
        throw new Error('consulta inesperada: ' + sql);
      }
    }
  };
  delete require.cache[caminhoAuth];
  try {
    const localAuth = require('./localAuth');
    assert.equal((await localAuth.login('ANA@loja.com', 'Senha@1')).usuario.id, 1);
    assert.equal((await localAuth.login('ana  paula LIMA', 'Senha@1')).usuario.id, 1);
    assert.equal((await localAuth.login('Bia Souza', 'Outra@1')).usuario.id, 4);
    await assert.rejects(localAuth.login('Bia Souza', 'Senha@1'), e => e.code === 'auth-failed');
    await assert.rejects(localAuth.login('Fulano de Tal', 'Senha@1'), e => e.code === 'auth-failed');
    await assert.rejects(localAuth.login('Joao da Silva', 'Senha@1'), e => e.code === 'nome-ambiguo' && /Entre com o e-mail/.test(e.message));
    const token = (await localAuth.login('Ana Paula Lima', 'Senha@1')).token;
    assert.equal(localAuth.verifyToken(token).id, 1);
  } finally {
    if (antes) require.cache[caminhoDb] = antes; else delete require.cache[caminhoDb];
    delete require.cache[caminhoAuth];
  }
});

test('rotas de usuário: o nome tem de ser completo e único; o nome que não mudou passa (repetido antigo não trava)', async () => {
  const { conferirNomeDoUsuario, validarNovoUsuario } = require('./usuariosController');
  const lidos = [];
  const api = {
    get: async (caminho, op) => {
      lidos.push([caminho, op?.query]);
      return [{ id: 1, nome: 'Ana Paula Lima' }, { id: 2, nome: 'João da Silva' }, { id: 3, nome: 'joao da silva' }];
    }
  };
  assert.equal(await conferirNomeDoUsuario(api, '  Bruno   Reis '), 'Bruno Reis');
  assert.deepEqual(lidos[0], ['/api/usuarios', { select: 'id,nome' }]);
  await assert.rejects(conferirNomeDoUsuario(api, 'Bruno'), e => e.status === 400 && e.campo === 'nome');
  await assert.rejects(conferirNomeDoUsuario(api, 'ANA paula lima'), e => e.status === 409 && e.code === 'NOME_JA_CADASTRADO' && e.campo === 'nome');
  // O próprio nome, na edição, não conta como repetido:
  assert.equal(await conferirNomeDoUsuario(api, 'Ana Paula Lima', { excetoId: 1 }), 'Ana Paula Lima');
  // O repetido antigo (João/joao) edita outro dado mandando o mesmo nome: passa sem consultar.
  lidos.length = 0;
  assert.equal(await conferirNomeDoUsuario(api, 'João da Silva', { excetoId: 2, antes: { id: 2, nome: 'João da Silva' } }), 'João da Silva');
  assert.equal(lidos.length, 0);
  // Mas mudar o nome para o de outro é recusado:
  await assert.rejects(conferirNomeDoUsuario(api, 'Ana Paula Lima', { excetoId: 2, antes: { id: 2, nome: 'João da Silva' } }), e => e.status === 409);

  assert.equal(validarNovoUsuario({ nome: 'Ana', sobrenome: 'Lima', email: 'a@b.com', senha: 'Senha@123', perfil: 'Vendedor' }).nome, 'Ana Lima');
  assert.throws(() => validarNovoUsuario({ nome: 'Ana', email: 'a@b.com', senha: 'Senha@123', perfil: 'Vendedor' }), e => e.status === 400 && e.campo === 'nome');
});

test('ligações: a API recebe o nome como veio (só sem espaço sobrando) e o bloqueio por tentativas conta o nome sem acento', () => {
  const backend = fs.readFileSync(path.join(__dirname, 'backend.js'), 'utf8');
  assert.ok(backend.includes('const normalizedEmail = normalizarLogin(email);'));
  assert.ok(backend.includes("error.code = 'nome-ambiguo';"), 'o 409 do nome ambíguo vira o recado');
  assert.ok(backend.includes("throw erroDaResposta(data, "), 'o cadastro leva código e campo do erro');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(main.includes("return NomeCompleto.ehEmail(email) ? String(email || '').trim().toLowerCase() : NomeCompleto.chave(email);"));
  assert.ok(main.includes("return { enviado: false, motivo: 'login pelo nome', semEmail: true };"), 'o código da senha só sai para e-mail digitado');
  assert.ok(main.includes("code: err.code || null, campo: err.campo || null"), 'o cadastro devolve o campo do erro à tela');
});
