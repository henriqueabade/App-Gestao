// Valida os guards de permissão nos handlers IPC (sem regex, por busca direta).
const fs = require('fs');
const http = require('http');
const src = fs.readFileSync(require('path').resolve(__dirname,'..','main.js'), 'utf8');

const esperado = {
  'adicionar-categoria': 'mp.category.create',
  'adicionar-unidade': 'mp.unit.create',
  'adicionar-colecao': 'prod.collection.create',
  'adicionar-produto': 'prod.create',
  'atualizar-produto': 'prod.edit',
  'excluir-produto': 'prod.delete',
  'inserir-lote-produto': 'prod.stock.input',
  'atualizar-lote-produto': 'prod.stock.adjust',
  'excluir-lote-produto': 'prod.stock.output',
  'adicionar-etapa-producao': 'prod.stage.insert',
  'salvar-produto-detalhado': 'prod.edit',
  'adicionar-materia-prima': 'mp.create',
  'atualizar-materia-prima': 'mp.edit',
  'excluir-materia-prima': 'mp.delete',
  'atualizar-preco-materia-prima': 'mp.edit',
  'registrar-entrada-materia-prima': 'mp.stock.input',
  'registrar-saida-materia-prima': 'mp.stock.output'
};

let fail = 0;
const ok = (c, t) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + t); if (!c) fail++; };

for (const [h, perm] of Object.entries(esperado)) {
  const i = src.indexOf("ipcMain.handle('" + h + "'");
  if (i < 0) { ok(false, h + ' - handler NAO ENCONTRADO'); continue; }
  const trecho = src.slice(i, i + 250);
  const j = trecho.indexOf('verificarPermissaoIpc(');
  if (j < 0) { ok(false, h + ' - SEM GUARD'); continue; }
  const usado = trecho.slice(j).split("'")[1];
  ok(usado === perm, h + ' -> ' + usado + (usado !== perm ? ' (esperado ' + perm + ')' : ''));
}

// registrar-usuario deve continuar SEM guard (cadastro acontece antes do login)
const ir = src.indexOf("ipcMain.handle('registrar-usuario'");
const trechoRu = src.slice(ir, ir + 250);
ok(ir >= 0 && trechoRu.indexOf('verificarPermissaoIpc') < 0,
  'registrar-usuario SEM guard (fluxo pre-login preservado)');

// Comportamento em runtime
const fnSrc = src.match(/async function verificarPermissaoIpc[\s\S]*?\n}\n/)[0];
let cen = 'restrito';
const srv = http.createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'application/json' });
  if (cen === 'supadmin') return r.end(JSON.stringify({ supAdmin: true, permissoes: {} }));
  r.end(JSON.stringify({
    supAdmin: false,
    permissoes: { prod: { ativo: true, acoes: { 'prod.edit': true, 'prod.delete': false }, colunas: {} } }
  }));
});
srv.listen(3000, async () => {
  const f = new Function('currentApiPort', 'configuredApiPort', 'DEFAULT_API_PORT', 'return ' + fnSrc)(3000, 3000, 3000);
  ok((await f('prod.edit')) === true, 'runtime: prod.edit permitido');
  ok((await f('prod.delete')) === false, 'runtime: prod.delete negado');
  cen = 'supadmin';
  ok((await f('prod.delete')) === true, 'runtime: Sup Admin ignora restricoes');
  srv.close();
  console.log(fail ? '\n' + fail + ' FALHA(S)' : '\nTODOS OS TESTES PASSARAM');
  process.exit(fail ? 1 : 0);
});
