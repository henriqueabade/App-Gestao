// Reproduz os cenarios que derrubavam a sessao e confirma que agora resistem.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = path.join(os.tmpdir(), 'teste-token-' + Date.now());
fs.mkdirSync(dir, { recursive: true });
process.env.APP_DATA_DIR = dir;
process.env.TOKEN_REFRESH_INTERVAL_MS = '1000';

const store = require(require('path').join(__dirname,'..','backend','tokenStore.js'));

const falhas = [];
const ok = (c, rot) => { console.log((c ? '  OK    ' : '  FALHA ') + rot); if (!c) falhas.push(rot); };

// token de mentira com exp no futuro
function fabricar(horas) {
  const payload = Buffer.from(JSON.stringify({
    id: 42, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + horas * 3600
  })).toString('base64').replace(/=/g, '');
  return 'aaa.' + payload + '.bbb';
}

console.log('\n1) Grava em diretorio gravavel');
ok(store.TOKEN_PATH.startsWith(dir), 'usa APP_DATA_DIR: ' + store.TOKEN_PATH.replace(dir, '<tmp>'));
const t1 = fabricar(12);
store.setToken(t1);
ok(fs.existsSync(store.TOKEN_PATH), 'arquivo criado');
ok(store.getToken() === t1, 'token lido de volta');

console.log('\n2) O ARQUIVO SOME (disco somente leitura / pasta apagada)');
fs.rmSync(store.TOKEN_PATH, { force: true });
store.refreshTokenFromDisk(true);
ok(store.getToken() === t1, 'token da MEMORIA sobrevive (antes era zerado -> 401 -> logout)');
ok(fs.existsSync(store.TOKEN_PATH), 'e o arquivo foi regravado sozinho');

console.log('\n3) Arquivo corrompido nao derruba a sessao');
fs.writeFileSync(store.TOKEN_PATH, '{lixo', 'utf-8');
store.refreshTokenFromDisk(true);
ok(store.getToken() === t1, 'token continua valido');

console.log('\n4) Limpeza DELIBERADA continua funcionando');
store.clearToken();
store.refreshTokenFromDisk(true);
ok(store.getToken() === null, 'clearToken() zera de verdade');
ok(!fs.existsSync(store.TOKEN_PATH), 'arquivo removido');

console.log('\n5) Validade do token');
store.setToken(fabricar(12));
let info = store.getTokenInfo();
ok(info.valido === true, 'token de 12h -> valido, expira em ' + (info.expiraEmMs / 3600000).toFixed(1) + 'h');
ok(info.usuarioId === 42, 'id do usuario extraido = ' + info.usuarioId);
store.setToken(fabricar(-1));
info = store.getTokenInfo();
ok(info.valido === false && info.motivo === 'expirado', 'token vencido -> invalido (' + info.motivo + ')');

console.log('\n6) Outro processo troca o token no disco (login em outra janela)');
const t2 = fabricar(12);
store.setToken(t1);
fs.writeFileSync(store.TOKEN_PATH, JSON.stringify({ token: t2 }), 'utf-8');
const st = fs.statSync(store.TOKEN_PATH);
fs.utimesSync(store.TOKEN_PATH, st.atime, new Date(Date.now() + 2000));
store.refreshTokenFromDisk(true);
ok(store.getToken() === t2, 'adota o token novo do disco');

fs.rmSync(dir, { recursive: true, force: true });
console.log(falhas.length ? '\n>>> ' + falhas.length + ' FALHA(S)' : '\n>>> TODOS OS TESTES PASSARAM');
process.exit(falhas.length ? 1 : 0);
