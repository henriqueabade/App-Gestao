// A referência de publicação é uma versão publicada, nunca o HEAD observado
// ao abrir o programa. O cache antigo podia conter um HEAD ainda não publicado.
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-.][0-9A-Za-z]+)*$/;
const COMMIT_PATTERN = /^[a-f0-9]{40,64}$/i;

async function resolvePublicationReference({
  runGitCommand,
  version,
  headCommit,
  persistedCommit,
  persistedCommitConfirmed = false,
  persistedCommitVersion
}) {
  if (typeof runGitCommand !== 'function' || !COMMIT_PATTERN.test(headCommit || '')) {
    throw new Error('Não foi possível consultar o repositório para identificar a última publicação.');
  }
  const publishedVersion = String(version || '').trim().replace(/^v/, '');
  if (!VERSION_PATTERN.test(publishedVersion)) return null;

  const isAncestor = async commit => COMMIT_PATTERN.test(commit || '') &&
    (await runGitCommand(['merge-base', '--is-ancestor', commit, headCommit])) !== null;

  // Este indicador só é gravado pelo fluxo que concluiu a publicação.
  if (persistedCommitConfirmed && persistedCommitVersion === publishedVersion && await isAncestor(persistedCommit)) {
    return { commit: persistedCommit, source: 'confirmed-publication' };
  }

  // A tag identifica a entrega mesmo quando houve mais de uma tentativa com
  // mensagens de commit iguais para a mesma versão.
  for (const tag of [`v${publishedVersion}`, publishedVersion]) {
    const resolved = await runGitCommand(['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]);
    const commit = resolved?.trim();
    if (await isAncestor(commit)) return { commit, source: 'release-tag' };
  }

  const subject = `Publicação: versão ${publishedVersion}`;
  const output = await runGitCommand([
    'log', '--format=%H%x1f%s', '--fixed-strings', '--grep', subject, headCommit
  ]);
  if (output === null) {
    throw new Error('Não foi possível consultar o histórico da última versão publicada.');
  }
  const releases = output.split(/\r?\n/).map(line => line.split('\x1f'))
    .filter(([hash, title]) => COMMIT_PATTERN.test(hash || '') && title === subject);
  if (releases.length === 1) return { commit: releases[0][0], source: 'release-commit' };
  // Sem tag/cache confirmado, mensagens repetidas não comprovam qual entrega
  // foi publicada. Mantenha o estado desconhecido em vez de esconder mudanças.
  return null;
}

module.exports = { resolvePublicationReference };
