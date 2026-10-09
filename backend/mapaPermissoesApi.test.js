/**
 * O mapa de permissões por tabela da API (Segurança, 09/10/2026), tirado das
 * rotas do backend por scripts/mapa-permissoes-api.js. A API carrega o
 * resultado de Santissimo-db-API/acesso/politica-tabelas.json.
 *
 * O que se trava aqui: o mapa sai, com chaves que existem no catálogo; os
 * pontos de referência (quem apaga pedido, quem lê boleto) estão certos; e a
 * cópia da API está em dia — mudou uma rota ou uma tabela e esqueceu de gerar
 * o mapa: no modo bloquear a API negaria o que a tela pede. Quando o
 * repositório da API não está ao lado, esse último pula.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { montar, politica, textoDaPolitica, DESTINO } = require('../scripts/mapa-permissoes-api');
const { PERMISSIONS_CATALOG } = require('./permissionsCatalog');

const { mapa } = montar();
const p = politica(mapa);

const CHAVES = new Set();
for (const m of Object.values(PERMISSIONS_CATALOG)) {
  CHAVES.add(`modulo:${m.code}`);
  m.actions.forEach(a => CHAVES.add(a.key));
  m.columns.forEach(c => CHAVES.add(c.key));
}

test('toda regra do mapa é "todos", "supadmin" ou chaves que existem no catálogo', () => {
  assert.ok(Object.keys(p).length > 100, 'o mapa cobre as tabelas do programa');
  for (const [tabela, ops] of Object.entries(p)) {
    for (const op of ['ler', 'inserir', 'alterar', 'apagar']) {
      const r = ops[op];
      if (r === 'todos' || r === 'supadmin') continue;
      assert.ok(Array.isArray(r) && r.length, `${tabela}.${op}: ${JSON.stringify(r)}`);
      for (const chave of r) assert.ok(CHAVES.has(chave), `${tabela}.${op}: chave desconhecida ${chave}`);
    }
  }
});

test('pontos de referência: as guardas das rotas viraram as regras das tabelas', () => {
  assert.deepEqual(p.pedidos.apagar, ['ped.delete']);
  assert.ok(p.pedidos.inserir.includes('orc.convert'), 'o pedido nasce da conversão do orçamento');
  assert.ok(Array.isArray(p.boletos.ler) && p.boletos.ler.includes('financeiro.boleto.view'), 'boleto não é de todos');
  assert.ok(Array.isArray(p.notas_fiscais.ler), 'nota fiscal não é de todos');
  assert.ok(Array.isArray(p.financeiro_fechamentos.inserir) && p.financeiro_fechamentos.inserir.includes('financeiro.competencia.fechar'));
  assert.ok(p.trocas_pecas.inserir.includes('ped.trocar_pecas'));
  assert.deepEqual(p.materia_prima.inserir, ['mp.create'], 'IPC adicionar-materia-prima');
  assert.deepEqual(p.categoria.apagar, ['mp.category.delete'], 'o IPC passou a conferir (09/10/2026)');
  assert.deepEqual(p.unidades.apagar, ['mp.unit.delete']);
  assert.ok(Array.isArray(p.transportadoras.inserir) && !p.transportadoras.inserir.includes('todos'), 'criar transportadora deixou de ser de todos');
  assert.deepEqual(p.servicos_laminacao.ler, ['modulo:lam_servicos'], 'a tela da Laminação lê pelo proxy: vale o módulo');
  // As leituras que todas as telas fazem continuam abertas.
  assert.equal(p.clientes.ler, 'todos');
  assert.equal(p.tarefas.ler, 'todos');
});

test('as rotas que eram abertas e ganharam guarda (Segurança, 09/10/2026)', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(main.includes("if (!(await verificarPermissaoIpc('mp.category.delete'))) return negadoIpc('mp.category.delete');"));
  assert.ok(main.includes("if (!(await verificarPermissaoIpc('mp.unit.delete'))) return negadoIpc('mp.unit.delete');"));
  const transp = fs.readFileSync(path.join(__dirname, 'transportadorasController.js'), 'utf8');
  assert.ok(transp.includes("router.post('/', exigirAlgumaPermissao(PODE_GRAVAR),"));
  assert.ok(transp.includes("router.delete('/:id', exigirAlgumaPermissao(PODE_GRAVAR),"));
});

test('o mapa da API está em dia com as rotas', { skip: !fs.existsSync(DESTINO) && 'repositório da API não está ao lado' }, () => {
  assert.equal(fs.readFileSync(DESTINO, 'utf8').replace(/\r\n/g, '\n'), textoDaPolitica(mapa), 'rode: node scripts/mapa-permissoes-api.js');
});
