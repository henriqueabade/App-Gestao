/**
 * Trava de publicação em BANCO=DEV e selo "DEV" do cabeçalho.
 *
 * O `.env` vai DENTRO do instalador. Publicado com BANCO=DEV, todos os clientes
 * tentariam um PostgreSQL em `localhost` na própria máquina e ninguém entraria
 * no sistema — com a senha do banco de desenvolvimento dentro de cada
 * instalador. Estes testes usam `.env` TEMPORÁRIOS: nenhum deles depende do
 * `.env` real de quem está rodando, que pode estar em qualquer um dos modos.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const trava = require('./travaPublicacao');

const raiz = path.resolve(__dirname, '..');
const ler = arquivo => fs.readFileSync(path.join(raiz, arquivo), 'utf8');

/** Um `.env` temporário com o conteúdo dado (ou nenhum, com `null`). */
function envCom(conteudo) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trava-publicacao-'));
  const arquivo = path.join(dir, '.env');
  if (conteudo !== null) fs.writeFileSync(arquivo, conteudo);
  return arquivo;
}

// ---------------------------------------------------------------------------
// O que pode e o que não pode ser publicado
// ---------------------------------------------------------------------------

test('BANCO=DEV bloqueia a publicação, e a mensagem diz como resolver', () => {
  const bloqueio = trava.verificarBancoParaPublicar(envCom('BANCO=DEV\nAPI_PORT=3000\n'));

  assert.ok(bloqueio, 'publicou com o .env em DEV');
  assert.equal(bloqueio.code, trava.CODIGO);
  assert.match(bloqueio.message, /BANCO=DEV/);
  // Quem lê a caixa de erro precisa saber O QUE fazer, não só que falhou.
  assert.match(bloqueio.message, /Troque para BANCO=PROD/);
});

test('dev minúsculo e com espaços também bloqueia', () => {
  // `dataConfig.js` normaliza assim; a trava não pode ser mais ingênua que ele.
  assert.ok(trava.verificarBancoParaPublicar(envCom('BANCO=  dev  \n')));
});

test('BANCO=PROD libera', () => {
  assert.equal(trava.verificarBancoParaPublicar(envCom('BANCO=PROD\n')), null);
});

test('sem BANCO no arquivo vale PROD, como no dataConfig', () => {
  assert.equal(trava.verificarBancoParaPublicar(envCom('API_PORT=3000\n')), null);
  assert.equal(trava.verificarBancoParaPublicar(envCom('BANCO=\n')), null);
});

test('sem .env nenhum vale PROD', () => {
  assert.equal(trava.verificarBancoParaPublicar(envCom(null)), null);
});

test('valor que não é DEV nem PROD bloqueia', () => {
  // O cliente pararia na inicialização com "BANCO inválido" — tão ruim quanto DEV.
  const bloqueio = trava.verificarBancoParaPublicar(envCom('BANCO=HOMOLOG\n'));
  assert.ok(bloqueio);
  assert.match(bloqueio.message, /HOMOLOG/);
});

test('.env que não se consegue ler bloqueia (falha fechada)', () => {
  // Um diretório no lugar do arquivo: existe, mas a leitura falha. Na dúvida
  // sobre o que vai dentro do instalador, não se publica.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trava-publicacao-dir-'));
  const bloqueio = trava.verificarBancoParaPublicar(dir);
  assert.ok(bloqueio);
  assert.match(bloqueio.message, /não foi possível ler o \.env/);
});

// ---------------------------------------------------------------------------
// Publicar x só gerar o instalador
// ---------------------------------------------------------------------------

test('reconhece quando o electron-builder vai publicar', () => {
  assert.equal(trava.estaPublicando(['node', 'eb', '--publish', 'always']), true);
  assert.equal(trava.estaPublicando(['node', 'eb', '--publish', 'onTagOrDraft']), true);
  assert.equal(trava.estaPublicando(['node', 'eb', '-p', 'onTag']), true);
  assert.equal(trava.estaPublicando(['node', 'eb', '--publish=always']), true);

  assert.equal(trava.estaPublicando(['node', 'eb', '--publish', 'never']), false);
  assert.equal(trava.estaPublicando(['node', 'eb', '--publish=never']), false);
  assert.equal(trava.estaPublicando(['node', 'eb', '--config', 'x.js']), false);
  assert.equal(trava.estaPublicando(['node', '--test']), false);
});

test('publicar em DEV lança; só gerar o instalador em DEV continua livre', () => {
  const emDev = envCom('BANCO=DEV\n');

  assert.throws(
    () => trava.exigirBancoProdParaPublicar({ argv: ['eb', '--publish', 'always'], caminhoEnv: emDev }),
    err => err.code === trava.CODIGO
  );
  // `npm run dist` sem publicar: o senhor pode querer um instalador DEV para
  // testar na própria máquina. A trava pedida é de PUBLICAÇÃO.
  assert.doesNotThrow(() => trava.exigirBancoProdParaPublicar({ argv: ['eb'], caminhoEnv: emDev }));
  assert.doesNotThrow(() =>
    trava.exigirBancoProdParaPublicar({ argv: ['eb', '--publish', 'never'], caminhoEnv: emDev }));

  assert.doesNotThrow(() => trava.exigirBancoProdParaPublicar({
    argv: ['eb', '--publish', 'always'], caminhoEnv: envCom('BANCO=PROD\n')
  }));
});

// ---------------------------------------------------------------------------
// Os dois caminhos de publicação estão amarrados à trava
// ---------------------------------------------------------------------------

test('o botão "Publicar atualização" confere o banco ANTES do token', () => {
  const fonte = ler('backend/publisher.js');
  const validacao = fonte.slice(fonte.indexOf('function validatePublishEnvironment('));

  const banco = validacao.indexOf('verificarBancoParaPublicar(');
  const token = validacao.indexOf('getFreshGithubToken(');
  assert.ok(banco > 0, 'validatePublishEnvironment não confere o banco');
  // Nem vale conferir credencial de uma publicação que não pode acontecer.
  assert.ok(banco < token, 'o banco precisa ser conferido antes do token');
  assert.match(validacao, /verificarBancoParaPublicar\(path\.join\(projectRoot, '\.env'\)\)/);
});

test('npm run publish pelo terminal também passa pela trava', () => {
  const fonte = ler('electron-builder.config.js');
  const chamada = fonte.indexOf('exigirBancoProdParaPublicar(');
  // Antes do `module.exports`: a trava roda quando o electron-builder carrega o
  // config, e é o único ponto por onde o terminal passa.
  assert.ok(chamada > 0 && chamada < fonte.indexOf('module.exports'));
  assert.match(fonte, /argv:\s*process\.argv/);
  assert.match(fonte, /caminhoEnv:\s*path\.join\(__dirname, '\.env'\)/);
});

test('carregar o config sem publicar nunca lança, esteja o .env como estiver', () => {
  // O próprio suíte carrega este arquivo (localDataClient.test.js). Se a trava
  // disparasse sem `--publish`, qualquer teste quebraria com o .env em DEV.
  const caminho = require.resolve('../electron-builder.config');
  delete require.cache[caminho];
  assert.doesNotThrow(() => require('../electron-builder.config'));
});

// ---------------------------------------------------------------------------
// Selo "DEV"
// ---------------------------------------------------------------------------

test('o selo nasce escondido, ao lado do nome da empresa', () => {
  const html = ler('src/html/menu.html');
  const selo = html.match(/<span id="seloBancoDev"[^>]*>DEV<\/span>/);
  assert.ok(selo, 'não há selo DEV no cabeçalho');
  // Escondido por padrão: em PROD, nada pode aparecer — nem por um instante.
  assert.match(selo[0], /class="[^"]*\bhidden\b/);
  assert.ok(html.indexOf('id="seloBancoDev"') > html.indexOf('id="companyName"'));
});

test('o selo não define display, para a classe hidden continuar valendo', () => {
  const css = ler('src/css/menu.css');
  const bloco = css.match(/\.selo-banco-dev\s*\{[^}]*\}/);
  assert.ok(bloco, 'estilo do selo sumiu');
  assert.doesNotMatch(bloco[0], /display\s*:/);
});

test('o processo principal responde só o NOME do modo', () => {
  const main = ler('main.js');
  const handler = main.match(/ipcMain\.handle\('get-modo-banco',[^\n]*/);
  assert.ok(handler, 'canal get-modo-banco não existe');
  assert.match(handler[0], /useLocalDatabase \? 'DEV' : 'PROD'/);
  // Nada da configuração do banco atravessa para o renderer.
  assert.doesNotMatch(handler[0], /process\.env|DB_|readDatabaseConfig/);
});

test('o preload expõe o modo e o menu revela o selo só em DEV', () => {
  assert.match(ler('preload.js'), /getModoBanco:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('get-modo-banco'\)/);

  const menu = ler('src/js/menu.js');
  assert.match(menu, /window\.electronAPI\.getModoBanco\(\)/);
  assert.match(menu, /classList\.toggle\('hidden', modo !== 'DEV'\)/);
});
