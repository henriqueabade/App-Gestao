#!/usr/bin/env node
/**
 * O MAPA de permissões por tabela da API (Segurança, 09/10/2026).
 *
 * A API passou a conferir, na rota genérica /api/:tabela, quem pode ler e
 * gravar cada tabela — com as MESMAS chaves das telas. Este script tira o
 * mapa do próprio código do backend:
 *
 *   1. acha cada rota (router.get/post/put/patch/delete e app.*) e a guarda
 *      dela (exigirPermissao('ped.view'), exigirAlgumaPermissao([...]),
 *      exigirSupAdmin, ...);
 *   2. segue as funções que o handler chama (no mesmo arquivo e nos
 *      require), até as chamadas à API: api.get('/api/pedidos'),
 *      c.inserir(api, 'producao_eventos', ...), db.put('/usuarios/…');
 *   3. para cada tabela e operação (ler, inserir, alterar, apagar), junta as
 *      chaves das rotas que chegam nela. Rota sem guarda, tarefa em segundo
 *      plano e o main.js = "todos" (qualquer usuário logado).
 *
 * É análise estática com o parser do TypeScript (já no node_modules): quando
 * não dá para saber quem é chamado (`objeto.metodo()`), liga a TODAS as
 * funções com esse nome no arquivo e nos require dele — o mapa sai mais
 * largo, nunca mais estreito (não quebra tela). O que ele não alcança, o modo
 * observar da API mostra no registro.
 *
 *   node scripts/mapa-permissoes-api.js                 grava o mapa na API ao lado
 *   node scripts/mapa-permissoes-api.js --relatorio <arquivo.json>   também o "porquê"
 *   node scripts/mapa-permissoes-api.js --conferir      só diz se o da API está em dia
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const RAIZ = path.join(__dirname, '..');
const BACKEND = path.join(RAIZ, 'backend');
const DESTINO = path.join(RAIZ, '..', 'Santissimo-db-API', 'acesso', 'politica-tabelas.json');

const OPS_HTTP = { get: 'ler', post: 'inserir', put: 'alterar', patch: 'alterar', delete: 'apagar' };
const METODOS_DE_ROTA = new Set(['get', 'post', 'put', 'patch', 'delete', 'all']);
// Rotas próprias da API (não são tabela).
const NAO_TABELAS = new Set(['tabelas', 'perfil', 'api', 'login', 'status', 'cadastro', 'avisos', 'senha']);
const RE_TABELA = /^[a-z_][a-z0-9_]*$/;
const RE_CHAVE = /^(?:[a-z_]+)(?:\.[a-z_]+)+$/;
const RECEPTORES_DB = new Set(['db', 'pool', 'database', 'remoteDb', 'banco']);

// ------------------------------------------------------------- arquivos

function arquivosJs(dir) {
  const fora = new Set(['node_modules', '__tests__', 'vendor', 'dist', 'build', 'sql', 'data']);
  const saida = [];
  for (const nome of fs.readdirSync(dir)) {
    if (fora.has(nome)) continue;
    const p = path.join(dir, nome);
    const st = fs.statSync(p);
    if (st.isDirectory()) saida.push(...arquivosJs(p));
    else if (/\.js$/.test(nome) && !/\.test\.js$/.test(nome)) saida.push(p);
  }
  return saida;
}

function resolverRequire(deArquivo, alvo) {
  if (!alvo.startsWith('.')) return null;
  const base = path.resolve(path.dirname(deArquivo), alvo);
  for (const c of [base, `${base}.js`, path.join(base, 'index.js')]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return path.normalize(c);
  }
  return null;
}

// -------------------------------------------------------------- análise

const rel = f => path.relative(RAIZ, f).replace(/\\/g, '/');
const nomeDe = n => (n && (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) ? n.text : (n && ts.isStringLiteral(n) ? n.text : null));
const ehFuncao = n => n && (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n));

function analisarArquivo(arquivo) {
  const texto = fs.readFileSync(arquivo, 'utf8');
  const fonte = ts.createSourceFile(arquivo, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const info = {
    arquivo,
    fonte,
    requires: new Map(),      // nome local -> arquivo (const X = require('./x'))
    importados: new Map(),    // nome local -> { arquivo, nome } (const { a: b } = require('./x'))
    constantes: new Map(),    // nome -> string | string[] (topo e funções: const X = '...')
    funcoes: new Map(),       // nome -> [no]
    rotas: [],
    agendados: [],            // funções passadas a setInterval/setTimeout
    globais: [],              // app.use('/api', fn) do server.js
    handlersIpc: new Set(),   // os handlers do ipcMain (main.js)
    tabelasDeConfig: new Map(), // chave ('tabela', 'tabelaRegistro'…) -> Set dos valores literais do arquivo
    permissoesDeConfig: new Set(), // { permissaoExecutar: 'x.y' | CONST } do arquivo
    roteadores: new Set(['router', 'app', 'rotas', 'roteador'])
  };

  const valorConstante = n => {
    if (!n) return undefined;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
    if (ts.isArrayLiteralExpression(n)) {
      const itens = n.elements.map(e => (ts.isStringLiteral(e) ? e.text : null));
      return itens.every(x => x !== null) ? itens : undefined;
    }
    if (ts.isAsExpression?.(n) || ts.isParenthesizedExpression(n)) return valorConstante(n.expression);
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'freeze') return valorConstante(n.arguments[0]);
    return undefined;
  };

  function visitar(no) {
    // require
    if (ts.isVariableDeclaration(no) && no.initializer) {
      let init = no.initializer;
      // const X = require('./x').algo
      let membro = null;
      if (ts.isPropertyAccessExpression(init) && ts.isCallExpression(init.expression)) { membro = init.name.text; init = init.expression; }
      if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === 'require' && init.arguments[0] && ts.isStringLiteral(init.arguments[0])) {
        const alvo = resolverRequire(arquivo, init.arguments[0].text);
        if (alvo) {
          if (ts.isIdentifier(no.name)) {
            if (membro) info.importados.set(no.name.text, { arquivo: alvo, nome: membro });
            else info.requires.set(no.name.text, alvo);
          } else if (ts.isObjectBindingPattern(no.name)) {
            for (const el of no.name.elements) {
              const local = nomeDe(el.name);
              const remoto = el.propertyName ? nomeDe(el.propertyName) : local;
              if (local) info.importados.set(local, { arquivo: alvo, nome: remoto });
            }
          }
        }
        if (ts.isIdentifier(no.name) && /express/.test(init.arguments[0]?.text || '') === false) { /* nada */ }
      }
      // express.Router()
      if (ts.isIdentifier(no.name) && ts.isCallExpression(no.initializer)) {
        const t = no.initializer.expression.getText(fonte);
        if (/(^|\.)Router$/.test(t) || /^express$/.test(t)) info.roteadores.add(no.name.text);
      }
      // constantes e funções nomeadas
      if (ts.isIdentifier(no.name)) {
        const v = valorConstante(no.initializer);
        if (v !== undefined) info.constantes.set(no.name.text, v);
        if (ehFuncao(no.initializer)) adicionarFuncao(no.name.text, no.initializer);
      }
    }
    if (ts.isFunctionDeclaration(no) && no.name) adicionarFuncao(no.name.text, no);
    if (ts.isPropertyAssignment(no) && /^permiss/i.test(nomeDe(no.name) || '')) {
      // resolvido depois (pode ser uma constante do arquivo)
      info._permissoesPendentes = info._permissoesPendentes || [];
      info._permissoesPendentes.push(no.initializer);
    }
    if (ts.isPropertyAssignment(no) && /tabela|table/i.test(nomeDe(no.name) || '') && ts.isStringLiteral(no.initializer) && RE_TABELA.test(no.initializer.text)) {
      const k = nomeDe(no.name);
      if (!info.tabelasDeConfig.has(k)) info.tabelasDeConfig.set(k, new Set());
      info.tabelasDeConfig.get(k).add(no.initializer.text);
    }
    if ((ts.isPropertyAssignment(no) && ehFuncao(no.initializer)) || ts.isMethodDeclaration(no)) {
      const nome = nomeDe(no.name);
      if (nome) adicionarFuncao(nome, ts.isMethodDeclaration(no) ? no : no.initializer);
    }
    // exports.x = function / module.exports.x = fn
    if (ts.isBinaryExpression(no) && no.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(no.left) && ehFuncao(no.right)) {
      adicionarFuncao(no.left.name.text, no.right);
    }
    // parâmetros chamados router
    if (ehFuncao(no)) for (const p of no.parameters || []) if (ts.isIdentifier(p.name) && /^(router|app|r)$/.test(p.name.text)) info.roteadores.add(p.name.text);

    if (ts.isCallExpression(no)) {
      const alvo = no.expression;
      if (ts.isPropertyAccessExpression(alvo) && ts.isIdentifier(alvo.expression)) {
        const receptor = alvo.expression.text;
        const metodo = alvo.name.text;
        const a0 = no.arguments[0];
        if (info.roteadores.has(receptor) && METODOS_DE_ROTA.has(metodo) && a0 && (ts.isStringLiteral(a0) || ts.isNoSubstitutionTemplateLiteral(a0)) && no.arguments.length >= 2) {
          info.rotas.push({ metodo: metodo.toUpperCase(), caminho: a0.text, args: no.arguments.slice(1), no });
        }
        if (receptor === 'app' && metodo === 'use' && no.arguments.length >= 2 && a0 && ts.isStringLiteral(a0) && a0.text === '/api') {
          info.globais.push(...no.arguments.slice(1));
        }
        // main.js: cada ipcMain.handle('canal', fn) é uma "rota"; a guarda fica
        // DENTRO do handler (verificarPermissaoIpc('mp.create')).
        if (receptor === 'ipcMain' && ['handle', 'on', 'handleOnce'].includes(metodo) && a0 && ts.isStringLiteral(a0) && no.arguments[1]) {
          info.rotas.push({ metodo: 'IPC', caminho: a0.text, args: [no.arguments[1]], no, ipc: true });
          info.handlersIpc.add(no.arguments[1]);
        }
      }
      if (ts.isIdentifier(alvo) && ['setInterval', 'setTimeout', 'setImmediate'].includes(alvo.text) && no.arguments[0]) {
        info.agendados.push(no.arguments[0]);
      }
    }
    ts.forEachChild(no, visitar);
  }
  function adicionarFuncao(nome, no) {
    if (!info.funcoes.has(nome)) info.funcoes.set(nome, []);
    info.funcoes.get(nome).push(no);
  }
  visitar(fonte);
  return info;
}

// ----------------------------------------------------- o mundo inteiro

function montar() {
  const arquivos = [...arquivosJs(BACKEND), path.join(RAIZ, 'main.js')].map(f => path.normalize(f));
  const infos = new Map(arquivos.map(f => [f, analisarArquivo(f)]));

  /** O valor (texto/lista) de uma expressão de nome de tabela ou de chave, se der para saber. */
  function valor(info, n, escopoParams = null) {
    if (!n) return { tipo: 'nada' };
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return { tipo: 'texto', v: n.text };
    if (ts.isParenthesizedExpression(n)) return valor(info, n.expression, escopoParams);
    if (ts.isIdentifier(n)) {
      if (escopoParams && escopoParams.has(n.text)) return { tipo: 'param', i: escopoParams.get(n.text) };
      if (info.constantes.has(n.text)) { const v = info.constantes.get(n.text); return Array.isArray(v) ? { tipo: 'lista', v } : { tipo: 'texto', v }; }
      const imp = info.importados.get(n.text);
      if (imp && infos.get(imp.arquivo)?.constantes.has(imp.nome)) { const v = infos.get(imp.arquivo).constantes.get(imp.nome); return Array.isArray(v) ? { tipo: 'lista', v } : { tipo: 'texto', v }; }
      return { tipo: 'desconhecido' };
    }
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression)) {
      const mod = info.requires.get(n.expression.text);
      if (mod && infos.get(mod)?.constantes.has(n.name.text)) { const v = infos.get(mod).constantes.get(n.name.text); return Array.isArray(v) ? { tipo: 'lista', v } : { tipo: 'texto', v }; }
      return { tipo: 'desconhecido' };
    }
    if (ts.isTemplateExpression(n)) {
      // `/api/${X}/${id}` → o começo até o primeiro ${ e o que der para saber dele
      let s = n.head.text;
      const primeiro = n.templateSpans[0];
      // `/materia_prima/${id}`: a tabela já está no começo; o resto é o id.
      // (`/api/${tabela}` não: ali o nome da tabela É o que vem no ${}.)
      if (/^\/api\/[a-z_][a-z0-9_]*\//.test(s) || (/^\/[a-z_][a-z0-9_]*\//.test(s) && !/^\/api\//.test(s))) return { tipo: 'texto', v: s };
      if (primeiro) {
        const v = valor(info, primeiro.expression, escopoParams);
        if (v.tipo === 'texto') s += v.v + (primeiro.literal.text || '');
        else if (v.tipo === 'param') return { tipo: 'param', i: v.i, prefixo: s };
        else if ((s === '/api/' || s === '/') && ts.isPropertyAccessExpression(primeiro.expression) && info.tabelasDeConfig.has(primeiro.expression.name.text)) {
          // `/api/${cfg.tabela}`: qualquer { tabela: '…' } deste arquivo (a MESMA chave).
          return { tipo: 'tabelas', v: [...info.tabelasDeConfig.get(primeiro.expression.name.text)], prefixo: s };
        } else return { tipo: 'texto', v: s, incompleto: true };
      }
      return { tipo: 'texto', v: s };
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const e = valor(info, n.left, escopoParams);
      const d = valor(info, n.right, escopoParams);
      if (e.tipo === 'texto' && d.tipo === 'texto') return { tipo: 'texto', v: e.v + d.v };
      if (e.tipo === 'texto' && d.tipo === 'param') return { tipo: 'param', i: d.i, prefixo: e.v };
      if (e.tipo === 'texto') return { tipo: 'texto', v: e.v, incompleto: true };
      return { tipo: 'desconhecido' };
    }
    return { tipo: 'desconhecido' };
  }

  /** '/api/pedidos/3' → 'pedidos'; '/pedidos' (só no db) → 'pedidos'. */
  function tabelaDoCaminho(texto, receptorDb) {
    if (typeof texto !== 'string') return null;
    let m = /^\/api\/([a-z_][a-z0-9_]*)/.exec(texto);
    if (!m && receptorDb) m = /^\/([a-z_][a-z0-9_]*)/.exec(texto);
    if (!m) return null;
    return NAO_TABELAS.has(m[1]) || !RE_TABELA.test(m[1]) ? null : m[1];
  }

  /** O nó de função -> { arquivo, ops: [{tabela, op}], chamadas: [...], helper: Map(i -> Set(op)), params } */
  const nos = new Map();
  function noDe(info, fn) {
    if (nos.has(fn)) return nos.get(fn);
    const params = new Map();
    (fn.parameters || []).forEach((p, i) => { if (ts.isIdentifier(p.name)) params.set(p.name.text, i); });
    const registro = { info, fn, ops: [], chamadas: [], helper: new Map(), paramChamadas: [], params };
    nos.set(fn, registro);
    function andar(n) {
      if (n !== fn && ehFuncao(n) && n.name && ts.isFunctionDeclaration(n)) return; // função nomeada interna: nó próprio
      if (n !== fn && info.handlersIpc.has(n)) return; // handler de IPC: é rota, com a guarda dele
      if (ts.isCallExpression(n)) tratarChamada(n);
      ts.forEachChild(n, andar);
    }
    function tratarChamada(n) {
      const alvo = n.expression;
      // chamada à API: x.get('/api/t'), db.put('/t/1', ...)
      if (ts.isPropertyAccessExpression(alvo) && OPS_HTTP[alvo.name.text] !== undefined && n.arguments[0]) {
        const receptor = ts.isIdentifier(alvo.expression) ? alvo.expression.text : '';
        const ehDb = RECEPTORES_DB.has(receptor) || (info.requires.get(receptor) && /[\\/]db\.js$|remoteDatabase\.js$/.test(info.requires.get(receptor)));
        const v = valor(info, n.arguments[0], params);
        const op = OPS_HTTP[alvo.name.text];
        if (v.tipo === 'texto') {
          const t = tabelaDoCaminho(v.v, ehDb);
          if (t) registro.ops.push({ tabela: t, op });
        } else if (v.tipo === 'tabelas' && (v.prefixo === '/api/' || ehDb)) {
          for (const t of v.v) if (!NAO_TABELAS.has(t)) registro.ops.push({ tabela: t, op });
        } else if (v.tipo === 'param' && (v.prefixo === '/api/' || (ehDb && v.prefixo === '/') || ((v.prefixo === '' || v.prefixo === undefined) && /api|db|pool|banco|cliente|client/i.test(receptor)))) {
          // (o parâmetro puro só num cliente da API: `cache.delete(tabela)` é um Map)
          if (!registro.helper.has(v.i)) registro.helper.set(v.i, new Set());
          registro.helper.get(v.i).add(op);
        }
        if (info.roteadores.has(receptor)) return; // definição de rota, não chamada à API
      }
      // chamada de função (para seguir)
      let alvoChamada = null;
      if (ts.isIdentifier(alvo)) alvoChamada = { tipo: 'local', nome: alvo.text };
      else if (ts.isPropertyAccessExpression(alvo)) {
        const nome = alvo.name.text;
        if (ts.isIdentifier(alvo.expression) && info.requires.has(alvo.expression.text)) alvoChamada = { tipo: 'modulo', arquivo: info.requires.get(alvo.expression.text), nome };
        else if (ts.isCallExpression(alvo.expression) && ts.isIdentifier(alvo.expression.expression) && alvo.expression.expression.text === 'require' && alvo.expression.arguments[0] && ts.isStringLiteral(alvo.expression.arguments[0])) {
          const arq = resolverRequire(info.arquivo, alvo.expression.arguments[0].text);
          if (arq) alvoChamada = { tipo: 'modulo', arquivo: arq, nome };
        } else if (!OPS_HTTP[nome] && !['then', 'catch', 'finally', 'map', 'filter', 'forEach', 'reduce', 'find', 'some', 'every', 'push', 'join', 'split', 'slice', 'sort', 'includes', 'indexOf', 'keys', 'values', 'entries', 'has', 'set', 'add', 'trim', 'replace', 'toString', 'toFixed', 'json', 'status', 'send', 'end', 'test', 'exec', 'match', 'call', 'apply', 'bind', 'concat', 'flatMap', 'assign', 'from', 'isArray', 'parse', 'stringify', 'log', 'warn', 'error', 'info', 'debug', 'resolve', 'reject', 'all', 'allSettled', 'max', 'min', 'round', 'floor', 'ceil', 'abs', 'toISOString', 'getTime', 'normalize', 'toLowerCase', 'toUpperCase', 'padStart', 'localeCompare', 'startsWith', 'endsWith', 'delete', 'clear', 'size', 'emit', 'on', 'once', 'query'].includes(nome)) {
          alvoChamada = { tipo: 'metodo', nome };
        }
      }
      if (alvoChamada) {
        const args = n.arguments.map(a => valor(info, a, params));
        registro.chamadas.push({ ...alvoChamada, args });
      }
      // funções passadas como argumento (callbacks nomeados): segue também
      for (const a of n.arguments) if (ts.isIdentifier(a) && (info.funcoes.has(a.text) || info.importados.has(a.text))) registro.chamadas.push({ tipo: 'local', nome: a.text, args: [] });
    }
    ts.forEachChild(fn, andar);
    return registro;
  }

  /** As funções que uma chamada pode ser (lista de nós). */
  function resolver(info, chamada) {
    const achar = (arq, nome) => (infos.get(arq)?.funcoes.get(nome) || []).map(f => noDe(infos.get(arq), f));
    if (chamada.tipo === 'local') {
      if (info.funcoes.has(chamada.nome)) return info.funcoes.get(chamada.nome).map(f => noDe(info, f));
      const imp = info.importados.get(chamada.nome);
      if (imp) return achar(imp.arquivo, imp.nome);
      return [];
    }
    if (chamada.tipo === 'modulo') return achar(chamada.arquivo, chamada.nome);
    // método sem dono conhecido: as funções com esse nome aqui e nos require
    const lista = [...(info.funcoes.get(chamada.nome) || []).map(f => noDe(info, f))];
    for (const arq of new Set([...info.requires.values(), ...[...info.importados.values()].map(i => i.arquivo)])) lista.push(...achar(arq, chamada.nome));
    return lista;
  }

  // Os campos permissao* de configuração, já com as constantes resolvidas.
  for (const info of infos.values()) {
    for (const n of info._permissoesPendentes || []) {
      const v = valor(info, n);
      if (v.tipo === 'texto' && RE_CHAVE.test(v.v)) info.permissoesDeConfig.add(v.v);
      if (v.tipo === 'lista') v.v.filter(x => RE_CHAVE.test(x)).forEach(x => info.permissoesDeConfig.add(x));
    }
  }

  // Ajudantes de tabela (ponto fixo): função que repassa o próprio parâmetro a outro ajudante.
  for (const info of infos.values()) for (const lista of info.funcoes.values()) for (const f of lista) noDe(info, f);
  let mudou = true;
  for (let volta = 0; mudou && volta < 10; volta++) {
    mudou = false;
    for (const no of [...nos.values()]) {
      for (const ch of no.chamadas) {
        for (const alvo of resolver(no.info, ch)) {
          for (const [i, ops] of alvo.helper) {
            const a = ch.args[i];
            if (a && a.tipo === 'param') {
              if (!no.helper.has(a.i)) no.helper.set(a.i, new Set());
              for (const op of ops) if (!no.helper.get(a.i).has(op)) { no.helper.get(a.i).add(op); mudou = true; }
            }
          }
        }
      }
    }
  }

  /** O nome legível de um nó (para o --explicar). */
  const nomeDoNo = no => {
    const f = no.fn;
    const nome = f.name && f.name.text ? f.name.text : ts.isVariableDeclaration(f.parent) && ts.isIdentifier(f.parent.name) ? f.parent.name.text : ts.isPropertyAssignment(f.parent) ? nomeDe(f.parent.name) : '(anônima)';
    const linha = no.info.fonte.getLineAndCharacterOfPosition(f.getStart ? f.getStart(no.info.fonte) : 0).line + 1;
    return `${nome} (${rel(no.info.arquivo)}:${linha})`;
  };

  /** As tabelas que um conjunto de funções alcança: [{tabela, op, no}]. */
  function alcance(raizes, alvoExplicar = null) {
    const vistos = new Set();
    const pai = new Map();
    const fila = [...raizes];
    const ops = [];
    while (fila.length) {
      const no = fila.shift();
      if (!no || vistos.has(no)) continue;
      vistos.add(no);
      for (const o of no.ops) ops.push({ ...o, no });
      for (const ch of no.chamadas) {
        for (const alvo of resolver(no.info, ch)) {
          for (const [i, opsDoAjudante] of alvo.helper) {
            const a = ch.args[i];
            const tabelas = a && a.tipo === 'texto' ? [a.v] : a && a.tipo === 'lista' ? a.v : [];
            for (const t0 of tabelas) {
              const t = tabelaDoCaminho(t0, true) || (RE_TABELA.test(t0) ? t0 : null);
              if (t && !NAO_TABELAS.has(t)) for (const op of opsDoAjudante) ops.push({ tabela: t, op, no });
            }
          }
          if (!vistos.has(alvo) && !pai.has(alvo)) pai.set(alvo, { de: no, chamada: ch });
          fila.push(alvo);
        }
      }
    }
    if (alvoExplicar) {
      const achado = ops.find(o => o.tabela === alvoExplicar.tabela && o.op === alvoExplicar.op);
      if (!achado) return { ops, cadeia: null };
      const cadeia = [];
      for (let n = achado.no; n; n = pai.get(n)?.de) cadeia.unshift(`${nomeDoNo(n)}${pai.get(n) ? `  ← ${pai.get(n).chamada.tipo} ${pai.get(n).chamada.nome}` : ''}`);
      return { ops, cadeia };
    }
    return ops;
  }

  /** As chaves de uma guarda (args da rota que não são o handler). */
  function chavesDaGuarda(info, args) {
    const chaves = new Set();
    let supadmin = false;
    let guardada = false;
    const deTexto = v => {
      if (v.tipo === 'texto' && RE_CHAVE.test(v.v)) chaves.add(v.v);
      if (v.tipo === 'lista') v.v.filter(x => RE_CHAVE.test(x)).forEach(x => chaves.add(x));
    };
    // As chaves dentro do código da guarda: literais, constantes (REGISTRAR,
    // mod.VER) e campos permissao* de módulos de configuração (o catálogo das
    // integrações: `catalogo.INTEGRACOES[x].permissaoExecutar`).
    const literaisDe = n => {
      const andar = x => {
        if (ts.isStringLiteral(x) && RE_CHAVE.test(x.text)) chaves.add(x.text);
        else if (ts.isIdentifier(x) || ts.isPropertyAccessExpression(x)) {
          const v = valor(info, x);
          if (v.tipo === 'texto' || v.tipo === 'lista') deTexto(v);
          if (ts.isPropertyAccessExpression(x) && /^permiss/i.test(x.name.text)) {
            let raiz = x.expression;
            while (raiz && (ts.isPropertyAccessExpression(raiz) || ts.isElementAccessExpression(raiz) || ts.isNonNullExpression?.(raiz))) raiz = raiz.expression;
            const mod = raiz && ts.isIdentifier(raiz) ? info.requires.get(raiz.text) : null;
            if (mod && infos.get(mod)) for (const k of infos.get(mod).permissoesDeConfig) chaves.add(k);
          }
          if (ts.isIdentifier(x) && info.funcoes.has(x.text) && !vistosNaGuarda.has(x.text)) {
            vistosNaGuarda.add(x.text);
            for (const f of info.funcoes.get(x.text)) andar(f);
          }
        }
        ts.forEachChild(x, andar);
      };
      andar(n);
    };
    const vistosNaGuarda = new Set();
    for (const a of args) {
      let alvo = a;
      if (ts.isIdentifier(alvo)) {
        if (/supadmin/i.test(alvo.text)) { supadmin = true; guardada = true; continue; }
        if (/^exigir/i.test(alvo.text)) {
          guardada = true;
          for (const f of info.funcoes.get(alvo.text) || []) literaisDe(f);
          continue;
        }
      }
      if (ts.isCallExpression(alvo)) {
        const nome = ts.isIdentifier(alvo.expression) ? alvo.expression.text : ts.isPropertyAccessExpression(alvo.expression) ? alvo.expression.name.text : '';
        if (/^exigir/i.test(nome)) {
          guardada = true;
          if (/supadmin/i.test(nome) && !alvo.arguments.length) { supadmin = true; continue; }
          for (const x of alvo.arguments) {
            const v = valor(info, x);
            if (v.tipo !== 'desconhecido') deTexto(v);
            else if (ehFuncao(x)) literaisDe(x);
            else if (ts.isIdentifier(x)) for (const f of info.funcoes.get(x.text) || []) literaisDe(f);
            else literaisDe(x);
          }
        }
      }
    }
    return { guardada, supadmin, chaves: [...chaves] };
  }

  /** As funções-handler dos args da rota (inclusive as embrulhadas: rota('…', fn)). */
  function handlers(info, args) {
    const raizes = [];
    const pegar = n => {
      if (ehFuncao(n)) { raizes.push(noDe(info, n)); return; }
      if (ts.isIdentifier(n)) {
        if (/^exigir|supadmin/i.test(n.text)) return;
        raizes.push(...resolver(info, { tipo: 'local', nome: n.text }));
        return;
      }
      if (ts.isCallExpression(n)) {
        const nome = ts.isIdentifier(n.expression) ? n.expression.text : ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text : '';
        if (/^exigir/i.test(nome)) return;
        n.arguments.forEach(pegar);
        // o embrulho pode chamar coisas (rota() lê o usuário etc.)
        raizes.push(...resolver(info, ts.isIdentifier(n.expression) ? { tipo: 'local', nome } : { tipo: 'metodo', nome }));
      }
    };
    args.forEach(pegar);
    return raizes;
  }

  // ------------------------------------------------ rotas -> tabelas
  const mapa = {};       // tabela -> op -> { todos: bool, chaves: Set, origens: [] }
  const anotar = (tabela, op, origem, guarda) => {
    if (!mapa[tabela]) mapa[tabela] = {};
    if (!mapa[tabela][op]) mapa[tabela][op] = { todos: false, chaves: new Set(), origens: [], abertas: [] };
    const m = mapa[tabela][op];
    const aberta = !guarda.guardada || (!guarda.supadmin && !guarda.chaves.length);
    if (aberta) m.todos = true;
    guarda.chaves.forEach(c => m.chaves.add(c));
    if (aberta) { if (m.abertas.length < 30 && !m.abertas.includes(origem)) m.abertas.push(origem); }
    else if (m.origens.length < 40) m.origens.push(`${origem} [${guarda.supadmin ? 'supadmin' : guarda.chaves.join(',')}]`);
  };
  const rotasParaExplicar = [];

  /** IPC: a guarda é a chamada verificarPermissaoIpc('chave') dentro do handler. */
  function guardaDoIpc(info, handler) {
    const chaves = new Set();
    const funcoes = ehFuncao(handler) ? [handler] : ts.isIdentifier(handler) ? (info.funcoes.get(handler.text) || []) : [];
    const andar = n => {
      if (ts.isCallExpression(n)) {
        const nome = ts.isIdentifier(n.expression) ? n.expression.text : ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text : '';
        if (/^(verificarPermissao|exigir|podeIpc)/i.test(nome)) for (const a of n.arguments) { const v = valor(info, a); if (v.tipo === 'texto' && RE_CHAVE.test(v.v)) chaves.add(v.v); if (v.tipo === 'lista') v.v.filter(x => RE_CHAVE.test(x)).forEach(x => chaves.add(x)); }
      }
      ts.forEachChild(n, andar);
    };
    funcoes.forEach(andar);
    return { guardada: chaves.size > 0, supadmin: false, chaves: [...chaves] };
  }

  let totalRotas = 0;
  for (const info of infos.values()) {
    for (const r of info.rotas) {
      totalRotas += 1;
      const guarda = r.ipc ? guardaDoIpc(info, r.args[0]) : chavesDaGuarda(info, r.args);
      const raizes = handlers(info, r.args);
      const ops = alcance(raizes);
      const origem = `${r.metodo} ${r.caminho} (${rel(info.arquivo)})`;
      rotasParaExplicar.push({ origem, raizes });
      for (const { tabela, op } of ops) anotar(tabela, op, origem, guarda);
    }
    for (const g of info.globais) {
      for (const { tabela, op } of alcance(handlers(info, [g]))) anotar(tabela, op, `middleware global (${rel(info.arquivo)})`, { guardada: false, chaves: [] });
    }
    for (const a of info.agendados) {
      for (const { tabela, op } of alcance(handlers(info, [a]))) anotar(tabela, op, `segundo plano (${rel(info.arquivo)})`, { guardada: false, chaves: [] });
    }
  }
  // main.js fora dos IPC (a partida, os eventos do app, os relógios): roda
  // com o token de quem está logado, sem guarda — "todos".
  const main = infos.get(path.normalize(path.join(RAIZ, 'main.js')));
  if (main) {
    for (const { tabela, op } of alcance([noDe(main, main.fonte)])) anotar(tabela, op, 'main.js (fora dos IPC)', { guardada: false, chaves: [] });
  }

  // A TELA lendo/gravando tabela direto pelo proxy genérico do backend local
  // (`/api/<tabela>` que não é um router daqui): vale o módulo da página.
  const servidor = fs.readFileSync(path.join(BACKEND, 'server.js'), 'utf8');
  const prefixos = new Set([...servidor.matchAll(/app\.(?:use|get|post)\('\/api\/([a-z_-]+)/g)].map(m => m[1]));
  const { PERMISSIONS_CATALOG } = require(path.join(BACKEND, 'permissionsCatalog'));
  const moduloDaPagina = new Map();
  for (const m of Object.values(PERMISSIONS_CATALOG)) {
    if (m.page) moduloDaPagina.set(m.page, m.code);
    for (const extra of m.paginasExtras || []) moduloDaPagina.set(extra, m.code);
  }
  for (const f of arquivosJs(path.join(RAIZ, 'src', 'js'))) {
    const texto = fs.readFileSync(f, 'utf8');
    const relativo = rel(f);
    const pasta = /src\/js\/modals\/([^/]+)\//.exec(relativo);
    const pagina = pasta ? pasta[1] : path.basename(f, '.js');
    const codigo = moduloDaPagina.get(pagina);
    for (const m of texto.matchAll(/\/api\/([a-z_][a-z0-9_]*)(?![\w-])/g)) {
      const t = m[1];
      if (prefixos.has(t) || NAO_TABELAS.has(t)) continue;
      const guarda = codigo ? { guardada: true, supadmin: false, chaves: [`modulo:${codigo}`] } : { guardada: false, chaves: [] };
      for (const op of ['ler', 'inserir', 'alterar', 'apagar']) anotar(t, op, `tela ${relativo}`, guarda);
    }
  }

  /** A cadeia de chamadas de uma rota até a tabela (para conferir o mapa). */
  function explicar(trechoDaRota, tabela, op) {
    return rotasParaExplicar
      .filter(r => r.origem.includes(trechoDaRota))
      .map(r => ({ origem: r.origem, cadeia: alcance(r.raizes, { tabela, op }).cadeia }))
      .filter(r => r.cadeia);
  }

  return { mapa, totalRotas, arquivos: arquivos.length, explicar };
}

// ------------------------------------------------------------ a saída

function politica(mapa) {
  const tabelas = {};
  for (const t of Object.keys(mapa).sort()) {
    tabelas[t] = {};
    for (const op of ['ler', 'inserir', 'alterar', 'apagar']) {
      const m = mapa[t][op];
      if (!m) { tabelas[t][op] = 'supadmin'; continue; }
      tabelas[t][op] = m.todos ? 'todos' : [...m.chaves].sort();
      if (Array.isArray(tabelas[t][op]) && !tabelas[t][op].length) tabelas[t][op] = 'supadmin';
    }
  }
  return tabelas;
}

function textoDaPolitica(mapa) {
  return `${JSON.stringify({
    descricao: 'Gerado de App-Gestao por scripts/mapa-permissoes-api.js (análise das rotas do backend). Não edite à mão: as exceções ficam em acesso/politica.js (MANUAIS).',
    tabelas: politica(mapa)
  }, null, 2)}\n`;
}

if (require.main === module) {
  const { mapa, totalRotas, arquivos, explicar } = montar();
  const e = process.argv.indexOf('--explicar');
  if (e > 0) {
    // node scripts/mapa-permissoes-api.js --explicar "POST /:origem/:id/observacoes" clientes inserir
    const [trecho, tabela, op] = process.argv.slice(e + 1);
    for (const r of explicar(trecho, tabela, op)) console.log(`\n${r.origem}\n  ${r.cadeia.join('\n  → ')}`);
    process.exit(0);
  }
  const texto = textoDaPolitica(mapa);
  const i = process.argv.indexOf('--relatorio');
  if (i > 0 && process.argv[i + 1]) {
    const relatorio = {};
    for (const [t, ops] of Object.entries(mapa)) {
      relatorio[t] = {};
      for (const [op, m] of Object.entries(ops)) relatorio[t][op] = { todos: m.todos, chaves: [...m.chaves].sort(), abertas: m.abertas, origens: m.origens };
    }
    fs.writeFileSync(process.argv[i + 1], JSON.stringify(relatorio, null, 1));
  }
  if (process.argv.includes('--conferir')) {
    const atual = fs.existsSync(DESTINO) ? fs.readFileSync(DESTINO, 'utf8').replace(/\r\n/g, '\n') : null;
    if (atual === texto) { console.log('Mapa da API em dia.'); process.exit(0); }
    console.error('O mapa da API está diferente: rode sem --conferir.');
    process.exit(1);
  }
  if (process.argv.includes('--so-mostrar')) {
    console.log(texto);
  } else if (fs.existsSync(path.dirname(DESTINO))) {
    fs.writeFileSync(DESTINO, texto);
    console.log(`Gravado: ${DESTINO}`);
  }
  console.log(`${arquivos} arquivos, ${totalRotas} rotas, ${Object.keys(mapa).length} tabelas no mapa.`);
}

module.exports = { montar, politica, textoDaPolitica, DESTINO };
