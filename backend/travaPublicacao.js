/**
 * Trava de publicação: instalador só sai com o `.env` em BANCO=PROD.
 *
 * POR QUE EXISTE
 * --------------
 * O `.env` vai DENTRO do instalador (ver `files` em electron-builder.config.js),
 * e é dele que cada cliente lê o BANCO ao abrir o app. Publicar com BANCO=DEV
 * mandaria todos os clientes procurarem um PostgreSQL em `localhost` na própria
 * máquina — ninguém conseguiria entrar no sistema — e levaria junto, dentro de
 * cada instalador, o usuário e a senha do banco de desenvolvimento.
 *
 * LÊ O ARQUIVO, NÃO O MODO EM QUE O APP ESTÁ RODANDO
 * --------------------------------------------------
 * O modo do app é decidido na inicialização (`dataConfig.js`); o que vai para o
 * instalador é o arquivo como está NO MOMENTO da publicação. Quem troca o `.env`
 * para PROD sem reiniciar publica certo — e quem inicia em PROD e depois troca
 * o arquivo para DEV seria pego só lendo o arquivo.
 *
 * SEM EFEITOS COLATERAIS
 * ----------------------
 * Não carrega `dataConfig.js` de propósito: ele copia o `.env` para
 * `process.env` e interrompe o processo com BANCO inválido. Aqui só se lê, e a
 * resposta é um erro com mensagem que se entende — inclusive dentro do
 * electron-builder, que carrega este arquivo pelo config.
 */
const fs = require('fs');
const dotenv = require('dotenv');

const CODIGO = 'BANCO_DEV_BLOQUEIA_PUBLICACAO';

function erro(mensagem) {
  const e = new Error(mensagem);
  e.code = CODIGO;
  return e;
}

/**
 * O BANCO que o instalador vai levar, lido do `.env` indicado.
 * Sem arquivo ou sem a chave vale PROD — é o mesmo padrão de `dataConfig.js`.
 */
function bancoDoPacote(caminhoEnv) {
  if (!fs.existsSync(caminhoEnv)) return 'PROD';
  const lido = dotenv.parse(fs.readFileSync(caminhoEnv));
  return String(lido.BANCO ?? '').trim().toUpperCase() || 'PROD';
}

/**
 * `null` quando pode publicar; um Error com a explicação quando não pode.
 *
 * Falha FECHADA: um `.env` que não se consegue ler também bloqueia. Na dúvida
 * sobre o que vai dentro do instalador, não se publica.
 */
function verificarBancoParaPublicar(caminhoEnv) {
  let banco;
  try {
    banco = bancoDoPacote(caminhoEnv);
  } catch (err) {
    return erro(
      'Publicação bloqueada: não foi possível ler o .env para conferir o BANCO '
      + `(${err && err.message ? err.message : err}). Corrija o arquivo e publique de novo.`);
  }

  if (banco === 'PROD') return null;

  if (banco === 'DEV') {
    return erro(
      'Publicação bloqueada: o .env está com BANCO=DEV.\n\n'
      + 'O .env vai dentro do instalador. Publicado assim, todos os clientes tentariam '
      + 'usar o banco de desenvolvimento e ninguém conseguiria entrar no sistema.\n\n'
      + 'Troque para BANCO=PROD no .env e publique de novo.');
  }

  return erro(
    `Publicação bloqueada: BANCO="${banco}" no .env não é válido. `
    + 'Use BANCO=PROD para publicar.');
}

/**
 * O electron-builder vai publicar nesta execução?
 *
 * `--publish never` e a ausência da opção só GERAM o instalador — isso
 * continua liberado em DEV. Qualquer outra política (`always`, `onTag`,
 * `onTagOrDraft`) publica.
 */
function estaPublicando(argv = process.argv) {
  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i]);
    let politica;
    if (arg === '--publish' || arg === '-p') politica = argv[i + 1];
    else if (arg.startsWith('--publish=')) politica = arg.slice('--publish='.length);
    else continue;
    if (String(politica ?? '').trim().toLowerCase() !== 'never') return true;
  }
  return false;
}

/** Para o electron-builder: lança quando a execução publicaria em DEV. */
function exigirBancoProdParaPublicar({ argv = process.argv, caminhoEnv }) {
  if (!estaPublicando(argv)) return;
  const bloqueio = verificarBancoParaPublicar(caminhoEnv);
  if (bloqueio) throw bloqueio;
}

module.exports = {
  CODIGO,
  bancoDoPacote,
  verificarBancoParaPublicar,
  estaPublicando,
  exigirBancoProdParaPublicar
};
