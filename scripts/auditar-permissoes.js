// Auditoria do sistema de permissoes.
//   node scripts/auditar-permissoes.js [modulo ...]     (sem argumentos: todos)
//
// Verifica, por modulo:
//   1. toda permissao do catalogo esta ligada a um elemento real em src/
//   2. nenhum marcador aponta para chave inexistente
//   3. nenhum elemento acumula acao E coluna (permissao duplicada)
//   4. cabecalho <th> e celula <td> pareados (senao a tabela desalinha)
//   5. nenhum guarda de backend usa chave morta — `can()` NEGA chave
//      desconhecida, entao um guarda orfao trava a rota para sempre
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { PERMISSIONS_CATALOG } = require(path.join(ROOT, 'backend', 'permissionsCatalog.js'));

const ESCOPO = {
  prod: { pagina: 'produtos',      modais: 'produtos',      prefixoJs: 'produto' },
  mp:   { pagina: 'materia-prima', modais: 'materia-prima', prefixoJs: 'materia-prima' },
  orc:  { pagina: 'orcamentos',    modais: 'orcamentos',    prefixoJs: 'orcamento' },
  ped:  { pagina: 'pedidos',       modais: 'pedidos',       prefixoJs: 'pedido' },
  cli:  { pagina: 'clientes',      modais: 'clientes',      prefixoJs: 'cliente' },
  ctt:  { pagina: 'contatos',      modais: 'contatos',      prefixoJs: 'contato' },
  rel:  { pagina: 'relatorios',    modais: 'relatorios',    prefixoJs: 'relatorio' },
  cfg:  { pagina: 'configuracoes', modais: 'configuracoes', prefixoJs: 'configuracao' },
};

const validas = new Set();
for (const m of Object.values(PERMISSIONS_CATALOG)) {
  m.actions.forEach(a => validas.add(a.key));
  m.columns.forEach(c => validas.add(c.key));
}

const falhas = [];
const ok = (c, rot) => { console.log((c ? '  OK    ' : '  FALHA ') + rot); if (!c) falhas.push(rot); };

const RE_ACAO      = /data-perm="([^"]+)"/g;
const RE_ESCONDE   = /data-perm-hide="([^"]+)"/g;
const RE_COL       = /data-perm-col="([^"]+)"/g;
const RE_SET_ACAO  = /setAttribute\(\s*'data-perm'\s*,\s*'([^']+)'/g;
const RE_SET_COL   = /setAttribute\(\s*'data-perm-col'\s*,\s*'([^']+)'/g;
const RE_LITERAL   = /'([a-z_]+(?:\.[a-z_]+)+)'/g;

function coletar(texto, alvo) {
  for (const m of texto.matchAll(RE_ACAO)) alvo.acoes.add(m[1]);
  for (const m of texto.matchAll(RE_ESCONDE)) alvo.acoes.add(m[1]);
  for (const m of texto.matchAll(RE_SET_ACAO)) alvo.acoes.add(m[1]);
  for (const m of texto.matchAll(RE_COL)) alvo.cols.add(m[1]);
  for (const m of texto.matchAll(RE_SET_COL)) alvo.cols.add(m[1]);
  // chave dinamica (ex.: o icone "Concluir" de Pedidos): as opcoes possiveis
  // aparecem como literais no mesmo arquivo
  if (texto.includes('data-perm="$' + '{')) {
    for (const m of texto.matchAll(RE_LITERAL)) {
      if (validas.has(m[1])) alvo.acoes.add(m[1]);
    }
  }
  // Idem para COLUNAS: em Produtos a coluna de preco troca de identidade
  // (Custo <-> Tabela) e a celula usa `data-perm-col="${modo.permCol}"`. As
  // chaves possiveis aparecem como literais no mesmo arquivo, e o cabecalho e
  // reescrito em tempo de execucao por sincronizarCabecalhoPreco().
  if (texto.includes('data-perm-col="$' + '{') || /setAttribute\(\s*'data-perm-col'\s*,\s*[^']/.test(texto)) {
    for (const m of texto.matchAll(/'(col_[a-z0-9_]+)'/g)) {
      if (validas.has(m[1])) { alvo.cols.add(m[1]); alvo.dinamicas.add(m[1]); }
    }
  }
}

// Varredura de todo o src/: uma permissao pode ser aplicada fora dos arquivos
// do proprio modulo (ctt.view e usada por Clientes; cfg.roles.* por Usuarios).
const noRepo = { acoes: new Set(), cols: new Set(), dinamicas: new Set() };
(function varrer(dir) {
  for (const nome of fs.readdirSync(dir)) {
    const p = path.join(dir, nome);
    if (fs.statSync(p).isDirectory()) varrer(p);
    else if (/\.(html|js)$/.test(nome)) coletar(fs.readFileSync(p, 'utf8'), noRepo);
  }
})(path.join(ROOT, 'src'));

function arquivosDo(mod) {
  const e = ESCOPO[mod];
  const out = [];
  for (const rel of ['src/html/' + e.pagina + '.html', 'src/js/' + e.pagina + '.js']) {
    if (fs.existsSync(path.join(ROOT, rel))) out.push(rel);
  }
  const dirModais = path.join(ROOT, 'src/html/modals', e.modais);
  if (fs.existsSync(dirModais)) {
    for (const f of fs.readdirSync(dirModais)) out.push('src/html/modals/' + e.modais + '/' + f);
  }
  for (const f of fs.readdirSync(path.join(ROOT, 'src/js/modals'))) {
    if (f.startsWith(e.prefixoJs) && f.endsWith('.js')) out.push('src/js/modals/' + f);
  }
  return out;
}

// guardas de backend, uma vez so
const guardas = [];
{
  const arquivos = ['main.js'].concat(
    fs.readdirSync(path.join(ROOT, 'backend')).filter(x => x.endsWith('.js')).map(x => 'backend/' + x)
  );
  for (const f of arquivos) {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of t.matchAll(/(?:verificarPermissaoIpc|exigirPermissao)\(\s*'([^']+)'/g)) {
      guardas.push(m[1]);
    }
  }
}

const alvos = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(ESCOPO);

for (const mod of alvos) {
  const cat = PERMISSIONS_CATALOG[mod];
  if (!cat || !ESCOPO[mod]) {
    console.log('\n### ' + mod + ': sem escopo definido');
    falhas.push(mod + ' sem escopo');
    continue;
  }

  console.log('\n########## ' + cat.label + ' (' + mod + ') ##########');
  const doModulo = { acoes: new Set(), cols: new Set(), dinamicas: new Set() };
  const th = new Set(), td = new Set(), porLista = new Set();

  for (const rel of arquivosDo(mod)) {
    const t = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    coletar(t, doModulo);
    for (const m of t.matchAll(/<th[^>]*data-perm-col="([^"]+)"/g)) th.add(m[1]);
    for (const m of t.matchAll(/<td[^>]*data-perm-col="([^"]+)"/g)) { if (m[1].indexOf('$') < 0) td.add(m[1]); }
    for (const m of t.matchAll(RE_SET_COL)) td.add(m[1]);
    // Tabela orientada a dados (Relatorios): a coluna negada sai da LISTA, e
    // com ela cabecalho, celulas, dropdown e exportacao. Nao ha celula marcada.
    for (const m of t.matchAll(/<th[^>]*data-perm-col="([^"]+)"[^>]*data-column-key=/g)) porLista.add(m[1]);
    for (const m of t.matchAll(/<th[^>]*data-column-key=[^>]*data-perm-col="([^"]+)"/g)) porLista.add(m[1]);
  }

  console.log('\n1) Catalogo: ' + cat.actions.length + ' acoes, ' + cat.columns.length + ' colunas');

  console.log('\n2) Cada permissao esta ligada a um elemento real');
  const semA = cat.actions.filter(a => !noRepo.acoes.has(a.key)).map(a => a.key);
  const semC = cat.columns.filter(c => !noRepo.cols.has(c.key)).map(c => c.key);
  ok(semA.length === 0, 'acoes sem elemento: ' + (semA.join(', ') || 'nenhuma'));
  ok(semC.length === 0, 'colunas sem elemento: ' + (semC.join(', ') || 'nenhuma'));
  const fora = cat.actions.filter(a => noRepo.acoes.has(a.key) && !doModulo.acoes.has(a.key)).map(a => a.key);
  if (fora.length) console.log('        (aplicadas fora do modulo: ' + fora.join(', ') + ')');

  console.log('\n3) Nenhum marcador aponta para chave inexistente');
  const orfas = [].concat([...doModulo.acoes], [...doModulo.cols])
    .filter(k => !validas.has(k) && k.indexOf('$') < 0);
  ok(orfas.length === 0, 'marcadores orfaos: ' + (orfas.join(', ') || 'nenhum'));

  console.log('\n4) Nenhum elemento acumula acao E coluna');
  const ambos = [...doModulo.acoes].filter(k => doModulo.cols.has(k));
  ok(ambos.length === 0, 'chaves duplicadas: ' + (ambos.join(', ') || 'nenhuma'));

  console.log('\n5) Paridade cabecalho <th> x celula <td>');
  const soTh = [...th].filter(k => !td.has(k) && !porLista.has(k) && !doModulo.dinamicas.has(k));
  const soTd = [...td].filter(k => !th.has(k) && k.indexOf('$') < 0 && !doModulo.dinamicas.has(k));
  ok(soTh.length === 0, 'nenhuma chave so no cabecalho' + (soTh.length ? ' -> ' + soTh.join(', ') : ''));
  ok(soTd.length === 0, 'nenhuma chave so na celula' + (soTd.length ? ' -> ' + soTd.join(', ') : ''));
  if (porLista.size) console.log('        (' + porLista.size + ' colunas filtradas pela lista de dados, por desenho)');

  console.log('\n6) Guardas do backend');
  const mortos = [...new Set(guardas.filter(k => !validas.has(k)))];
  ok(mortos.length === 0, 'guardas com chave morta: ' + (mortos.join(', ') || 'nenhum'));
  const doMod = [...new Set(guardas.filter(k => k.indexOf(mod + '.') === 0))];
  console.log('        (' + doMod.length + ' guardas de ' + mod + ')');
}

console.log(falhas.length ? '\n>>> ' + falhas.length + ' FALHA(S)' : '\n>>> TODOS OS TESTES PASSARAM');
process.exit(falhas.length ? 1 : 0);
