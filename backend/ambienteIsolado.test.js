const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const iso = require('./ambienteIsolado');

// Um .env DEV seguro para a VPS (sem segredo nenhum).
const SEGURO = {
  BANCO: 'DEV', NFE_AMBIENTE: 'homologacao', BB_AMBIENTE: 'sandbox',
  CONTABILIDADE_INTEGRACOES_AMBIENTE: 'homologacao', EMAIL_SENDING_ENABLED: 'false'
};
const BANCO_SEGURO = {
  DB_HOST: '127.0.0.1', DB_PORT: '5432', DB_USER: 'app_gestao_dev',
  DB_NAME: 'Santissimo_Decor_App_Gestao_Dev_VPS', DB_PASSWORD: 'x'
};
const MARCADOR = { ambiente: 'dev-vps', banco: 'Santissimo_Decor_App_Gestao_Dev_VPS', usuario: 'app_gestao_dev' };

test('marcador da máquina: ausente = livre; dev-vps = marcado; outro conteúdo ou ilegível = marcado e inválido', () => {
  const semArquivo = () => { const e = new Error('x'); e.code = 'ENOENT'; throw e; };
  assert.equal(iso.lerMarcador('/x', semArquivo), null);
  assert.deepEqual(iso.lerMarcador('/x', () => '# comentário\nambiente=dev-vps\nbanco=B\nusuario=U\n'),
    { ambiente: 'dev-vps', banco: 'B', usuario: 'U' });
  assert.deepEqual(iso.lerMarcador('/x', () => 'ambiente=producao'), { invalido: true });
  const semPermissao = () => { const e = new Error('x'); e.code = 'EACCES'; throw e; };
  assert.deepEqual(iso.lerMarcador('/x', semPermissao), { invalido: true });
});

test('endereço local: loopback e socket passam; qualquer outro host não', () => {
  for (const h of ['127.0.0.1', '127.1.2.3', 'localhost', '::1', '[::1]', '/var/run/postgresql']) assert.equal(iso.hostLocal(h), true, h);
  for (const h of ['', '10.0.0.5', '192.168.0.2', 'api.santissimodecor.com.br', '0.tcp.sa.ngrok.io', 'localhost.evil.com']) {
    assert.equal(iso.hostLocal(h), false, h);
  }
  assert.equal(iso.urlLocal('http://127.0.0.1:3000/api'), true);
  assert.equal(iso.urlLocal('https://api.santissimodecor.com.br'), false);
  assert.equal(iso.urlLocal('lixo'), false);
});

test('.env DEV seguro passa sem nenhum problema', () => {
  assert.deepEqual(iso.avaliar({ env: SEGURO, banco: BANCO_SEGURO, marcador: MARCADOR }), []);
});

test('.env de produção copiado para a VPS é barrado, chave por chave, sem citar valores', () => {
  const env = {
    BANCO: 'prod', API_BASE_URL: 'https://api.santissimodecor.com.br', API_URL: 'https://api.santissimodecor.com.br',
    SEGREDOS_CHAVE_MESTRA: 'CHAVE-SECRETA-123', GH_TOKEN: 'TOKEN-SECRETO', SMTP_PASS: 'SENHA-SMTP', SMTP_HOST: 'smtp.gmail.com',
    GEMINI_API_KEY: 'IA-1', GROQ_API_KEY: 'IA-2', EMAIL_SENDING_ENABLED: 'true'
  };
  const banco = { DB_HOST: '127.0.0.1', DB_PORT: '5433', DB_USER: 'postgres', DB_NAME: 'Santissimo_Decor_App_Gestao', DB_PASSWORD: 'SENHA-DB' };
  const problemas = iso.avaliar({ env, banco, marcador: MARCADOR });
  const texto = problemas.join('\n');
  for (const chave of ['BANCO', 'DB_NAME', 'DB_USER', 'NFE_AMBIENTE', 'BB_AMBIENTE', 'CONTABILIDADE_INTEGRACOES_AMBIENTE',
    'SEGREDOS_CHAVE_MESTRA', 'GH_TOKEN', 'SMTP_PASS', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'EMAIL_SENDING_ENABLED', 'SMTP_HOST', 'API_BASE_URL', 'API_URL']) {
    assert.match(texto, new RegExp(`\\b${chave}\\b`), chave);
  }
  for (const segredo of ['CHAVE-SECRETA-123', 'TOKEN-SECRETO', 'SENHA-SMTP', 'SENHA-DB', 'IA-1', 'IA-2', 'smtp.gmail.com', 'santissimodecor']) {
    assert.ok(!texto.includes(segredo), `não cita o valor ${segredo}`);
  }
});

test('banco remoto, superusuário e banco que não é o DEV da máquina são barrados', () => {
  const caso = banco => iso.avaliar({ env: SEGURO, banco: { ...BANCO_SEGURO, ...banco }, marcador: MARCADOR }).join('\n');
  assert.match(caso({ DB_HOST: 'db.producao.example.com' }), /DB_HOST/);
  assert.match(caso({ DB_HOST: '0.tcp.sa.ngrok.io' }), /DB_HOST/);
  assert.match(caso({ DB_USER: 'postgres' }), /DB_USER/);
  assert.match(caso({ DB_NAME: 'Santissimo_Decor_App_Gestao' }), /DB_NAME/);
  // Sem banco no marcador, vale o sufixo _Dev_VPS.
  assert.deepEqual(iso.avaliar({ env: SEGURO, banco: BANCO_SEGURO, marcador: { ambiente: 'dev-vps', banco: '', usuario: '' } }), []);
  assert.match(iso.avaliar({ env: SEGURO, banco: { ...BANCO_SEGURO, DB_NAME: 'Outro' }, marcador: { ambiente: 'dev-vps' } }).join(), /DB_NAME/);
});

test('a lista de rede permitida nunca libera endereço de produção', () => {
  const env = { ...SEGURO, DEV_REDE_PERMITIDA: 'api.hm.bb.com.br, api.bb.com.br, api.santissimodecor.com.br' };
  const problemas = iso.avaliar({ env, banco: BANCO_SEGURO, marcador: MARCADOR }).join('\n');
  assert.match(problemas, /api\.bb\.com\.br/);
  assert.match(problemas, /api\.santissimodecor\.com\.br/);
  assert.doesNotMatch(problemas, /api\.hm\.bb\.com\.br/);
  assert.deepEqual(iso.redePermitida(env), ['api.hm.bb.com.br', 'api.bb.com.br', 'api.santissimodecor.com.br']);
});

test('fora da máquina isolada nada muda (o Windows do dono continua como estava)', () => {
  const perigoso = { BANCO: 'PROD', GH_TOKEN: 'x', SEGREDOS_CHAVE_MESTRA: 'y' };
  assert.deepEqual(iso.exigirNaInicializacao({ env: perigoso, banco: {}, lerMarcadorDaMaquina: () => null }), { ativo: false });
});

test('na máquina isolada o .env perigoso impede a inicialização; o seguro libera e devolve a marca do banco', () => {
  assert.throws(
    () => iso.exigirNaInicializacao({ env: { BANCO: 'PROD' }, banco: {}, lerMarcadorDaMaquina: () => MARCADOR }),
    e => e.code === iso.CODIGO && e.problemas.length > 0 && /não vai iniciar/.test(e.message));
  assert.throws(() => iso.exigirNaInicializacao({ env: SEGURO, banco: BANCO_SEGURO, lerMarcadorDaMaquina: () => ({ invalido: true }) }),
    e => e.code === iso.CODIGO);
  assert.deepEqual(iso.exigirNaInicializacao({ env: SEGURO, banco: BANCO_SEGURO, lerMarcadorDaMaquina: () => MARCADOR }),
    { ativo: true, marcaDoBanco: 'app-gestao:dev-vps', permitidos: [] });
  // A variável liga a trava mesmo sem o arquivo.
  assert.throws(() => iso.exigirNaInicializacao({ env: { APP_GESTAO_AMBIENTE_ISOLADO: '1' }, banco: {}, lerMarcadorDaMaquina: () => null }),
    e => e.code === iso.CODIGO);
});

test('dataConfig liga a trava e a barreira na inicialização (fora dos testes); main.js prende o Chromium', () => {
  const dataConfig = fs.readFileSync(path.join(__dirname, 'dataConfig.js'), 'utf8');
  assert.match(dataConfig, /testing \? \{ ativo: false \}\s*:\s*require\('\.\/ambienteIsolado'\)\.exigirNaInicializacao\(\{ env: process\.env, banco: privateDatabaseEnv \}\)/);
  assert.match(dataConfig, /if \(isolamento\.ativo\) require\('\.\/barreiraDeRede'\)\.instalar\(/);
  assert.match(dataConfig, /module\.exports = \{[^}]*isolamento/);
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  const linha = main.indexOf("const { isDev: useLocalDatabase } = require('./backend/dataConfig');");
  const chromium = main.indexOf("app.commandLine.appendSwitch('host-resolver-rules'");
  assert.ok(linha > 0 && chromium > linha && chromium < main.indexOf('app.whenReady()'), 'host-resolver-rules antes do whenReady');
});

test('banco sem a marca do DEV da máquina é recusado antes de qualquer consulta; com a marca, segue', async () => {
  const carregar = (marca, consultas) => {
    class Pool {
      on() {}
      async query(sql) { consultas.push(sql); return /shobj_description/.test(sql) ? { rows: [{ marca }] } : { rows: [{ ok: 1 }] }; }
      async connect() { consultas.push('connect'); return { query: async () => ({ rows: [] }), release() {} }; }
    }
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'localDatabase.js'), 'utf8'), {
      module, process: { env: {} },
      require: name => name === './dataConfig'
        ? { isDev: true, readDatabaseConfig: () => ({}), isolamento: { ativo: true, marcaDoBanco: 'app-gestao:dev-vps' } }
        : { Pool }
    });
    return module.exports;
  };
  const semMarca = [];
  const dbProducao = carregar(null, semMarca);
  await assert.rejects(dbProducao.query('SELECT * FROM usuarios'), { code: 'dev-banco-sem-marca', status: 503 });
  await assert.rejects(dbProducao.connect(), { code: 'dev-banco-sem-marca' });
  assert.equal(dbProducao.isReady(), false);
  assert.ok(semMarca.every(sql => /shobj_description/.test(sql)), 'nenhuma consulta de dados chegou ao banco sem marca');

  const comMarca = [];
  const dbDev = carregar('app-gestao:dev-vps', comMarca);
  await dbDev.query('SELECT 1');
  await dbDev.query('SELECT 2');
  assert.equal(comMarca.filter(sql => /shobj_description/.test(sql)).length, 1, 'confere a marca uma vez só');
  assert.deepEqual(comMarca.filter(sql => !/shobj_description/.test(sql)), ['SELECT 1', 'SELECT 2']);
});
