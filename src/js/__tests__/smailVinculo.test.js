/**
 * Vincular ao Santíssimo Mail (src/js/utils/smail-vinculo.js, 14/10/2026):
 * as partes puras da janela e as ligações no sino.
 *
 * O que trava:
 *   - o código aparece agrupado e o tempo de 10 minutos corre até vencer;
 *   - cada erro da integração vira uma frase (limite com a espera, desligada,
 *     sessão, permissão, rota que ainda não existe);
 *   - a situação de cada vínculo (ativo, encerrado, vencido) e o
 *     reconhecimento automático só quando a API informa;
 *   - o código nunca vai para localStorage/sessionStorage nem para log;
 *   - o sino tem a entrada no rodapé e abre a janela pelo aviso de segurança
 *     (smail_preautorizacao, sempre visível).
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..', '..');
const ler = relativo => fs.readFileSync(path.join(RAIZ, relativo), 'utf8');
const contexto = { window: {}, Date, Map, Set, console, URL };
vm.runInNewContext(ler('src/js/utils/smail-vinculo.js'), contexto, { filename: 'smail-vinculo.js' });
const S = contexto.window.SmailVinculo;
const daqui = valor => JSON.parse(JSON.stringify(valor));

test('o código para ditar e o tempo de 10 minutos', () => {
  assert.strictEqual(S.formatarCodigo('abcde23456'), 'ABCDE 23456');
  assert.strictEqual(S.formatarCodigo(''), '');
  const agora = new Date('2026-10-14T12:00:00Z');
  assert.deepStrictEqual(daqui(S.tempoRestante('2026-10-14T12:10:00Z', agora)), { segundos: 600, texto: '10:00', vencido: false, fracao: 1 });
  assert.strictEqual(S.tempoRestante('2026-10-14T12:01:05Z', agora).texto, '1:05');
  assert.strictEqual(S.tempoRestante('2026-10-14T12:00:00Z', agora).vencido, true);
  assert.strictEqual(S.tempoRestante('lixo', agora).vencido, true);
  assert.strictEqual(S.tempoRestante('2026-10-14T12:05:00Z', agora).fracao, 0.5);
});

test('cada erro da integração vira uma frase para a pessoa', () => {
  assert.match(S.mensagemDoErro(429, { error: 'limite' }, 420), /Tente de novo em 7 min/);
  assert.match(S.mensagemDoErro(429, { error: 'limite' }), /daqui a alguns minutos/);
  assert.match(S.mensagemDoErro(503, { error: 'indisponivel' }), /desligada ou fora do ar/);
  assert.match(S.mensagemDoErro(503, { error: 'indisponivel', message: 'Com o banco DEV não há API central…' }), /banco DEV/);
  assert.match(S.mensagemDoErro(401, { error: 'nao_autenticado' }), /sessão expirou/);
  assert.match(S.mensagemDoErro(403, { error: 'sem_permissao' }), /perfil não pode/);
  assert.match(S.mensagemDoErro(404, { error: 'sem_rota' }), /ainda não tem a vinculação/);
  assert.match(S.mensagemDoErro(404, { error: 'nao_encontrado' }), /não existe mais/);
  assert.match(S.mensagemDoErro(0, null), /Sem conexão/);
  assert.strictEqual(S.formatarEspera(30), '30 s');
  assert.strictEqual(S.formatarEspera(3900), '1 h e 5 min');
});

test('vínculos: situação, ordem e o reconhecimento automático só quando a API informa', () => {
  const agora = new Date('2026-10-14T12:00:00Z');
  const ativo = { id: 'a', status: 'ativo', criadoEm: '2026-10-01T00:00:00Z', expiraEm: '2027-10-01T00:00:00Z', revogadoEm: null };
  const encerrado = { id: 'b', status: 'revogado', criadoEm: '2026-10-10T00:00:00Z', expiraEm: '2027-10-10T00:00:00Z', revogadoEm: '2026-10-12T00:00:00Z' };
  const vencido = { id: 'c', status: 'revogado', criadoEm: '2025-01-01T00:00:00Z', expiraEm: '2026-01-01T00:00:00Z', revogadoEm: null };
  assert.strictEqual(S.situacaoDoVinculo(ativo, agora).valor, 'ativo');
  assert.strictEqual(S.situacaoDoVinculo(encerrado, agora).rotulo, 'Encerrado');
  assert.strictEqual(S.situacaoDoVinculo(vencido, agora).rotulo, 'Vencido');
  assert.deepStrictEqual(daqui(S.ordenarVinculos([vencido, encerrado, ativo], agora).map(v => v.id)), ['a', 'b', 'c'], 'ativos primeiro, depois o mais novo');
  assert.strictEqual(S.reconhecimentoAutomatico({ reconhecimento_automatico: true }), true);
  assert.strictEqual(S.reconhecimentoAutomatico({ reconhecimento_automatico: false }), false);
  assert.strictEqual(S.reconhecimentoAutomatico({}), null, 'a API de hoje não informa: a tela não diz nada');
  assert.strictEqual(S.quandoFoi('2026-10-14T09:05:00', new Date('2026-10-14T15:00:00')), 'hoje às 09:05');
  assert.strictEqual(S.dataCurta('2026-10-01T12:00:00'), '01/10/2026');
  assert.deepStrictEqual(daqui(S.ESCOPOS.map(e => e.valor)), ['crm', 'tarefas', 'calendario', 'chat', 'perfil'], 'os escopos do contrato da API');
});

test('o código não fica guardado: nada de storage nem de log na janela', () => {
  const fonte = ler('src/js/utils/smail-vinculo.js');
  assert.ok(!/localStorage|sessionStorage|indexedDB/.test(fonte), 'nada de storage');
  assert.ok(!/console\.(log|info|warn|error|debug)\([^)]*codigo/i.test(fonte), 'nada de log com o código');
  assert.ok(!/\?codigo=|[&?]codigo=/.test(fonte), 'nada de código na URL');
  assert.match(fonte, /function fechar\(\) \{\s+esquecerCodigo\(\);/, 'fechar esquece o código');
  const backend = ler('backend/smailVinculosController.js');
  assert.match(backend, /Cache-Control', 'no-store'/);
});

test('o sino: a entrada no rodapé; o aviso de segurança abre a janela e sempre aparece', () => {
  const menu = ler('src/html/menu.html');
  assert.ok(menu.indexOf('href="../styles/smail-vinculo.css"') > 0 && menu.indexOf('href="../styles/smail-vinculo.css"') < menu.indexOf('href="../styles/controles.css"'));
  assert.ok(menu.indexOf('src="../js/utils/smail-vinculo.js"') > 0);
  const sino = ler('src/js/notifications.js');
  assert.match(sino, /criar\('button', 'sino-rodape'\)/);
  assert.match(sino, /criar\('strong', null, 'Gerar código para o Santíssimo Mail'\)/, 'o mesmo texto que o Mail manda escolher no sino');
  assert.match(sino, /window\.SmailVinculo\.abrir\(\);/);
  assert.match(sino, /aviso\.origem === 'smail'[\s\S]{0,80}SmailVinculo\?\.abrir\?\.\(\)/);
  assert.match(sino, /smail_preautorizacao: 'fa-user-shield'/);
  const categorias = require(path.join(RAIZ, 'src/js/utils/categorias-aviso.js'));
  assert.strictEqual(categorias.categoriaDoAviso({ tipo: 'smail_preautorizacao', origem: 'smail' }), 'conta');
  assert.match(ler('src/js/aviso-windows.js'), /smail_preautorizacao: 'fa-user-shield'/);
});
