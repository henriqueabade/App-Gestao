const test = require('node:test');
const assert = require('node:assert/strict');
const n = require('./nucleo');
const cli = require('./cli');

const arquivoDe = (nome, texto) => ({
  id: nome.slice(0, 13), nome, caminho: `/x/${nome}`, texto, sha256: n.sha256(texto),
  cabecalho: n.lerCabecalho(texto), problemas: n.problemasDoArquivo(nome, texto)
});
const sql = (id, corpo, { destrutiva = 'nao', transacao = 'sim', requer = '', escopo = 'app' } = {}) =>
  `-- migracao: ${id}\n-- descricao: teste\n-- requer: ${requer}\n-- escopo: ${escopo}\n-- transacao: ${transacao}\n-- destrutiva: ${destrutiva}\n\n${corpo}\n`;
const registro = a => ({ id: a.id, arquivo: a.nome, sha256: a.sha256, escopo: a.cabecalho.escopo });

test('todas as migrações do repositório estão no padrão, sem id repetido e sem problema', () => {
  const arquivos = n.listarArquivos();
  assert.ok(arquivos.some(a => a.id === n.ID_DO_CONTROLE), 'a migração do controle existe');
  for (const a of arquivos) assert.deepEqual(a.problemas, [], a.nome);
});

test('toda migração do repositório está congelada no manifesto; mudou, a conferência acusa', () => {
  const arquivos = n.listarArquivos();
  assert.deepEqual(n.problemasDoManifesto(n.lerManifesto(), arquivos), []);
  const controle = arquivos.find(a => a.id === n.ID_DO_CONTROLE);
  assert.equal(controle.cabecalho.escopo, 'infra');
  const alterado = arquivos.map(a => ({ ...a, sha256: a.id === n.ID_DO_CONTROLE ? '0'.repeat(64) : a.sha256 }));
  assert.match(n.problemasDoManifesto({ migracoes: [registro(controle)] }, alterado).join(), /MUDOU depois de registrado/);
  const nova = arquivoDe('20991231_0000_nova.sql', sql('20991231_0000', 'SELECT 1;'));
  assert.match(n.problemasDoManifesto({ migracoes: [registro(controle)] }, [controle, nova]).join(), /não está registrado/);
});

test('checksum igual no Windows e na VPS: BOM e CRLF não mudam o SHA-256', () => {
  const lf = sql('20991231_0000', 'CREATE TABLE t (id int);');
  assert.equal(n.sha256('﻿' + lf.replace(/\n/g, '\r\n')), n.sha256(lf));
  assert.notEqual(n.sha256(lf + ' '), n.sha256(lf));
});

test('as conferências por palavra ignoram comentários, textos e corpos $$', () => {
  const inocente = "-- DROP TABLE x\nCOMMENT ON TABLE t IS 'DELETE FROM y; COMMIT;';\nDO $$ BEGIN RAISE NOTICE 'TRUNCATE'; END $$;\nCREATE TABLE \"drop table\" (id int);\n" +
    'CREATE TRIGGER g BEFORE UPDATE OR DELETE OR TRUNCATE ON t FOR EACH STATEMENT EXECUTE FUNCTION f();';
  assert.deepEqual(n.analisar(inocente), { destrutivo: [], proibido: [], foraDeTransacao: [], controlaTransacao: false, metaComandos: false });
  const a = n.analisar("BEGIN;\nUPDATE clientes SET nome = 'x';\nDROP TABLE velha;\nTRUNCATE t;\nCREATE INDEX CONCURRENTLY i ON t (c);\nGRANT ALL ON t TO PUBLIC;\n\\i outro.sql");
  assert.ok(a.destrutivo.length >= 3);
  assert.equal(a.controlaTransacao, true);
  assert.equal(a.metaComandos, true);
  assert.ok(a.foraDeTransacao.length === 1);
  assert.match(a.proibido.join(), /GRANT/);
});

test('arquivo com problema é apontado: nome, cabeçalho, destrutiva sem marcar, transação, psql', () => {
  assert.match(n.problemasDoArquivo('nova_tabela.sql', '').join(), /nome fora do padrão/);
  assert.match(n.problemasDoArquivo('20991231_0000_x.sql', sql('20991231_0001', 'SELECT 1;')).join(), /diferente do id/);
  assert.match(n.problemasDoArquivo('20991231_0000_x.sql', sql('20991231_0000', 'DELETE FROM t;')).join(), /destrutiva: sim/);
  assert.deepEqual(n.problemasDoArquivo('20991231_0000_x.sql', sql('20991231_0000', 'DELETE FROM t WHERE id = 1;', { destrutiva: 'sim' })), []);
  assert.match(n.problemasDoArquivo('20991231_0000_x.sql', sql('20991231_0000', 'CREATE INDEX CONCURRENTLY i ON t (c);')).join(), /transacao: nao/);
  assert.match(n.problemasDoArquivo('20991231_0000_x.sql', sql('20991231_0000', 'COMMIT;')).join(), /BEGIN\/COMMIT/);
  assert.match(n.problemasDoArquivo('20991231_0000_x.sql', sql('20991231_0000', 'CREATE ROLE x;')).join(), /proibido/);
  assert.match(n.problemasDoArquivo('20991231_0000_x.sql', sql('20991231_0000', 'SELECT 1;', { escopo: 'qualquer' })).join(), /escopo/);
});

test('erro guardado sem valores de dados', () => {
  const e = n.erroSemDados({ code: '23505', message: 'duplicate key value violates unique constraint "u"\nDETAIL: Key (email)=(fulano@real.com) already exists.' });
  assert.equal(e.codigo, '23505');
  assert.doesNotMatch(e.mensagem, /fulano|DETAIL/);
  assert.equal(n.erroSemDados({ message: "invalid input syntax for type integer: 'abc123'" }).mensagem, "invalid input syntax for type integer: '…'");
});

const CONTROLE = arquivoDe(`${n.ID_DO_CONTROLE}_controle_de_migracoes.sql`, sql(n.ID_DO_CONTROLE, 'CREATE SCHEMA controle;', { escopo: 'infra' }));
const NOVA = arquivoDe('20991231_0000_nova.sql', sql('20991231_0000', 'CREATE TABLE t (id int);'));
const BASE = {
  arquivos: [CONTROLE, NOVA],
  manifesto: { migracoes: [registro(CONTROLE), registro(NOVA)] },
  estado: { banco: 'B_Dev_VPS', marca: 'app-gestao:dev-vps', temControle: true, aplicadas: [{ id: CONTROLE.id, arquivo: CONTROLE.nome, sha256: CONTROLE.sha256 }] },
  ambiente: 'dev-vps', opcoes: { confirmarBanco: 'B_Dev_VPS' }
};
const plano = mudancas => n.planejar({ ...BASE, arquivo: NOVA, ...mudancas });

test('na VPS: congelada no manifesto, banco marcado, confirmado, em ordem -> aplica sem esperar OK', () => {
  assert.deepEqual(plano({}), { situacao: 'aplicar', motivos: [] });
});

test('produção e bancos sem marca são recusados; a confirmação precisa repetir o nome do banco', () => {
  assert.match(plano({ estado: { ...BASE.estado, marca: null } }).motivos.join(), /não tem a marca/);
  assert.match(plano({ estado: { ...BASE.estado, marca: 'app-gestao:dev-windows' } }).motivos.join(), /não tem a marca/);
  assert.match(plano({ opcoes: { confirmarBanco: 'Outro' } }).motivos.join(), /confirmar-banco/);
  assert.equal(plano({ ambiente: 'producao' }).situacao, 'recusada');
});

test('em qualquer ambiente, fora do manifesto ou diferente do registrado, recusa', () => {
  const semNova = { migracoes: BASE.manifesto.migracoes.slice(0, 1) };
  assert.match(plano({ manifesto: semNova }).motivos.join(), /não está no manifesto/);
  const outroSha = { migracoes: [BASE.manifesto.migracoes[0], { ...BASE.manifesto.migracoes[1], sha256: '1'.repeat(64) }] };
  assert.match(plano({ manifesto: outroSha }).motivos.join(), /não é o arquivo registrado/);
  const windows = { ambiente: 'dev-windows', estado: { ...BASE.estado, marca: 'app-gestao:dev-windows' } };
  assert.equal(plano(windows).situacao, 'aplicar');
  assert.match(plano({ ...windows, manifesto: semNova }).motivos.join(), /não está no manifesto/);
});

test('não repete: mesma migração com o mesmo SHA é "já aplicada"; com outro SHA é divergência', () => {
  const aplicadas = [...BASE.estado.aplicadas, { id: NOVA.id, arquivo: NOVA.nome, sha256: NOVA.sha256 }];
  assert.equal(plano({ estado: { ...BASE.estado, aplicadas } }).situacao, 'ja-aplicada');
  const divergente = [...BASE.estado.aplicadas, { id: NOVA.id, arquivo: NOVA.nome, sha256: '2'.repeat(64) }];
  assert.match(plano({ estado: { ...BASE.estado, aplicadas: divergente } }).motivos.join(), /OUTRO conteúdo/);
  const controleMudou = [{ id: CONTROLE.id, arquivo: CONTROLE.nome, sha256: '3'.repeat(64) }];
  assert.match(plano({ estado: { ...BASE.estado, aplicadas: controleMudou } }).motivos.join(), /divergência/);
});

test('ordem, dependências, primeira migração e destrutiva sem backup', () => {
  const semControle = { ...BASE.estado, temControle: false, aplicadas: [] };
  assert.match(plano({ estado: semControle }).motivos.join(), /a primeira é/);
  assert.equal(n.planejar({ ...BASE, arquivo: CONTROLE, estado: semControle }).situacao, 'aplicar');
  const depois = arquivoDe('20991231_0001_depois.sql', sql('20991231_0001', 'SELECT 1;', { requer: '20991231_0000' }));
  const comDepois = { arquivos: [CONTROLE, NOVA, depois], manifesto: { migracoes: [...BASE.manifesto.migracoes, registro(depois)] } };
  const r = n.planejar({ ...BASE, ...comDepois, arquivo: depois });
  assert.match(r.motivos.join(), /requer 20991231_0000/);
  assert.match(r.motivos.join(), /anteriores ainda não aplicadas/);
  const destrutiva = arquivoDe('20991231_0000_nova.sql', sql('20991231_0000', 'DROP TABLE velha;', { destrutiva: 'sim' }));
  const aprovada = { migracoes: [BASE.manifesto.migracoes[0], registro(destrutiva)] };
  assert.match(n.planejar({ ...BASE, arquivo: destrutiva, arquivos: [CONTROLE, destrutiva], manifesto: aprovada }).motivos.join(), /backup/);
  assert.equal(n.planejar({ ...BASE, arquivo: destrutiva, arquivos: [CONTROLE, destrutiva], manifesto: aprovada, opcoes: { ...BASE.opcoes, backupFeito: true } }).situacao, 'aplicar');
});

function clienteFalso({ falharEm = null, temControle = true } = {}) {
  const consultas = [];
  return {
    consultas,
    async query(texto, valores) {
      consultas.push(texto);
      if (falharEm && texto.includes(falharEm)) throw Object.assign(new Error('relation "x" does not exist'), { code: '42P01' });
      if (/to_regclass/.test(texto)) return { rows: [{ tem: temControle }] };
      if (/SELECT sha256 FROM controle\.migracoes_aplicadas/.test(texto)) return { rows: [] };
      if (/pg_try_advisory_lock/.test(texto)) return { rows: [{ ok: true }] };
      return { rows: [], valores };
    }
  };
}

test('aplicar: transação, trava, SQL, registro e diário, nessa ordem', async () => {
  const c = clienteFalso();
  const r = await n.aplicar({ client: c, arquivo: NOVA, ambiente: 'dev-vps', info: { maquina: 'vps', commit: 'abc' } });
  assert.equal(r.situacao, 'aplicada');
  const passos = c.consultas.map(q => q.split(/\s+/).slice(0, 3).join(' '));
  assert.deepEqual(passos.slice(0, 4), ['BEGIN', 'SET LOCAL lock_timeout', 'SET LOCAL statement_timeout', 'SELECT pg_advisory_xact_lock(hashtext($1))']);
  assert.ok(c.consultas.indexOf(NOVA.texto) > c.consultas.findIndex(q => /pg_advisory_xact_lock/.test(q)));
  assert.ok(c.consultas.findIndex(q => /INSERT INTO controle\.migracoes_aplicadas/.test(q)) > c.consultas.indexOf(NOVA.texto));
  assert.equal(c.consultas.at(-1), 'COMMIT');
});

test('aplicar: falhou -> ROLLBACK, diário com a falha (sem dados) e erro claro', async () => {
  const c = clienteFalso({ falharEm: 'CREATE TABLE t' });
  await assert.rejects(n.aplicar({ client: c, arquivo: NOVA, ambiente: 'dev-vps' }), e => e.code === 'MIGRACAO_FALHOU' && /FALHOU e nada dela foi gravado/.test(e.message));
  assert.ok(c.consultas.includes('ROLLBACK'));
  assert.ok(!c.consultas.includes('COMMIT'));
  assert.ok(c.consultas.findIndex(q => /migracoes_execucoes/.test(q)) > c.consultas.indexOf('ROLLBACK'));
});

test('impressões digitais: iguais, e cada diferença apontada', () => {
  const a = { banco: 'A', estrutura_sha256: 'x', objetos: { 'tabela public.t': '1', 'indice public.i': '2' }, migracoes: [{ id: '1', sha256: 'a' }] };
  assert.equal(n.compararImpressoes(a, { ...a }).iguais, true);
  const b = { banco: 'B', estrutura_sha256: 'y', objetos: { 'tabela public.t': '9', 'view public.v': '3' }, migracoes: [{ id: '1', sha256: 'b' }, { id: '2', sha256: 'c' }] };
  const d = n.compararImpressoes(a, b);
  assert.equal(d.iguais, false);
  assert.deepEqual(d.soNoPrimeiro, ['indice public.i']);
  assert.deepEqual(d.soNoSegundo, ['view public.v']);
  assert.deepEqual(d.diferentes, ['tabela public.t']);
  assert.deepEqual(d.migracoes, { soNoPrimeiro: [], soNoSegundo: ['2'], shaDiferente: ['1'] });
  // A migração de infraestrutura (controle de cada ambiente) não conta como diferença.
  const comControle = { ...a, migracoes: [...a.migracoes, { id: 'controle', sha256: 'z' }] };
  const r = n.compararImpressoes(comControle, a, id => (id === 'controle' ? 'infra' : 'app'));
  assert.equal(r.iguais, true);
  assert.deepEqual(r.infra, ['controle']);
});

test('impressão digital: o CHECK restaurado de um dump vale o mesmo que o criado direto', () => {
  const direto = "CHECK (((ambiente)::text = ANY ((ARRAY['dev-windows'::character varying, 'dev-vps'::character varying])::text[])))";
  const restaurado = "CHECK (((ambiente)::text = ANY (ARRAY[('dev-windows'::character varying)::text, ('dev-vps'::character varying)::text])))";
  assert.equal(n.canonico(direto), n.canonico(restaurado));
  assert.equal(n.canonico("CHECK ((x)::text = ANY ((ARRAY['a]b'::character varying, 'it''s'::character varying])::text[]))"),
    n.canonico("CHECK ((x)::text = ANY (ARRAY[('a]b'::character varying)::text, ('it''s'::character varying)::text]))"));
  // Uma regra diferente de verdade continua diferente.
  assert.notEqual(n.canonico(direto), n.canonico(direto.replace("'dev-vps'", "'producao'")));
  assert.equal(n.canonico('CREATE INDEX i ON public.t USING btree (a)'), 'CREATE INDEX i ON public.t USING btree (a)');
});

test('o executor só conecta em banco local e nunca pega senha por argumento', async () => {
  assert.throws(() => cli.configuracaoDaConexao({ host: 'db.producao.example.com', usuario: 'u', banco: 'b' }), /só conecta em banco LOCAL/);
  assert.throws(() => cli.configuracaoDaConexao({ host: '0.tcp.sa.ngrok.io', usuario: 'u', banco: 'b' }), /LOCAL/);
  const cfg = cli.configuracaoDaConexao({ host: '127.0.0.1', usuario: 'u', banco: 'b', senha: 'NAO-USAR' });
  assert.equal(typeof cfg.password, 'function');
  assert.ok(!JSON.stringify(cfg).includes('NAO-USAR'));
  assert.equal(cli.dentroDoRepositorio(`${n.RAIZ}/qualquer`), true);
  assert.equal(cli.dentroDoRepositorio('/home/outra-pasta'), false);
});

test('a máquina precisa combinar com o ambiente pedido', () => {
  if (process.platform !== 'win32') assert.throws(() => cli.conferirMaquina('dev-windows'), /só roda no Windows/);
  assert.throws(() => cli.conferirMaquina('producao'), /dev-vps ou dev-windows|só roda na VPS/);
});
