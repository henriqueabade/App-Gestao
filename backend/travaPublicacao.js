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
 * LÊ O ARQUIVO E TAMBÉM O MODO EM QUE O APP ESTÁ RODANDO
 * -------------------------------------------------------
 * O que vai para o instalador é o arquivo como está NO MOMENTO da publicação:
 * quem inicia em PROD e depois troca o arquivo para DEV só é pego lendo o
 * arquivo. Mas o processo pode estar em DEV com o arquivo em PROD — o ambiente
 * do processo vale mais que o `.env` (`dataConfig.js`), e é assim que o
 * iniciador de homologação roda (BANCO=DEV no ambiente). Publicar de dentro de
 * um programa em DEV, ou de uma máquina DEV isolada
 * (APP_GESTAO_AMBIENTE_ISOLADO=1), também é bloqueado — antes de token,
 * versão ou subprocesso (`verificarAmbienteParaPublicar`).
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
const CODIGO_ISOLADO = 'AMBIENTE_ISOLADO_BLOQUEIA_PUBLICACAO';

function erro(mensagem, codigo = CODIGO) {
  const e = new Error(mensagem);
  e.code = codigo;
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
 * O programa que está rodando pode publicar? `null` se sim.
 *
 * `env.BANCO` é o modo EFETIVO: o `dataConfig.js` só copia o BANCO do `.env`
 * quando o ambiente do processo não o define. Sem BANCO no ambiente (terminal
 * comum, testes) não há o que bloquear aqui — o arquivo é conferido à parte.
 */
function verificarProcessoParaPublicar(env = process.env, { isolado = false } = {}) {
  if (isolado || String(env.APP_GESTAO_AMBIENTE_ISOLADO || '').trim() === '1') {
    return erro(
      'Publicação bloqueada: este programa está num ambiente DEV isolado (APP_GESTAO_AMBIENTE_ISOLADO).\n\n'
      + 'Publicar daqui mandaria aos clientes um instalador montado fora do ambiente de produção. '
      + 'Publique pelo programa aberto em produção (BANCO=PROD).', CODIGO_ISOLADO);
  }
  const banco = String(env.BANCO ?? '').trim().toUpperCase();
  if (banco && banco !== 'PROD') {
    return erro(
      `Publicação bloqueada: o programa está rodando com BANCO=${banco}.\n\n`
      + 'O modo definido no ambiente do processo vale mais que o .env (é assim que o iniciador '
      + 'de homologação abre o programa), mesmo com o .env em BANCO=PROD. '
      + 'Feche e abra o programa em produção para publicar.');
  }
  return null;
}

/** Tudo o que impede publicar: primeiro o programa em execução, depois o arquivo. */
function verificarAmbienteParaPublicar({ env = process.env, caminhoEnv, isolado = false } = {}) {
  return verificarProcessoParaPublicar(env, { isolado }) || verificarBancoParaPublicar(caminhoEnv);
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
function exigirBancoProdParaPublicar({ argv = process.argv, caminhoEnv, env = process.env }) {
  if (!estaPublicando(argv)) return;
  const bloqueio = verificarAmbienteParaPublicar({ env, caminhoEnv });
  if (bloqueio) throw bloqueio;
}

module.exports = {
  CODIGO,
  CODIGO_ISOLADO,
  bancoDoPacote,
  verificarBancoParaPublicar,
  verificarProcessoParaPublicar,
  verificarAmbienteParaPublicar,
  estaPublicando,
  exigirBancoProdParaPublicar
};
