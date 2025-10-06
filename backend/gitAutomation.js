function getLogger(logger) {
  if (logger && typeof logger.log === 'function') return logger;
  return console;
}

function log(logger, level, message) {
  const targetLogger = logger && typeof logger[level] === 'function' ? logger : console;
  const fn = typeof targetLogger[level] === 'function' ? targetLogger[level] : console.log;
  fn.call(targetLogger, message);
}

function performReleaseCommit({ runGitCommand, version, logger }) {
  if (typeof runGitCommand !== 'function') {
    throw new Error('runGitCommand function is required');
  }
  if (!version) {
    throw new Error('version is required to create release commit');
  }

  const activeLogger = getLogger(logger);
  const commitMessage = `Publicação: versão ${version}`;

  const statusOutput = runGitCommand(['status', '--porcelain']);
  if (statusOutput === null) {
    log(activeLogger, 'error', 'Falha ao executar "git status --porcelain".');
    return { success: false, code: 'git-status-failed', message: 'Falha ao verificar alterações no repositório.' };
  }

  if (!statusOutput.trim()) {
    log(activeLogger, 'log', 'Nenhuma alteração detectada. Pulando commit e push de release.');
    return { success: true, code: 'no-changes', message: 'Nenhuma alteração para publicar.' };
  }

  const filesToAdd = ['package.json', 'package-lock.json'];
  const addArgs = ['add', ...filesToAdd];
  const addCommand = ['git', ...addArgs].join(' ');
  const addResult = runGitCommand(addArgs);
  if (addResult === null) {
    log(activeLogger, 'error', `Falha ao executar "${addCommand}".`);
    return { success: false, code: 'git-add-failed', message: 'Falha ao preparar arquivos para commit.' };
  }

  const commitResult = runGitCommand(['commit', '-m', commitMessage]);
  if (commitResult === null) {
    log(activeLogger, 'error', `Falha ao executar "git commit" com mensagem "${commitMessage}".`);
    return { success: false, code: 'git-commit-failed', message: 'Não foi possível criar o commit de release.' };
  }
  log(activeLogger, 'log', `Commit criado com sucesso: ${commitMessage}`);

  const pushResult = runGitCommand(['push']);
  if (pushResult === null) {
    log(activeLogger, 'error', 'Falha ao executar "git push".');
    return { success: false, code: 'git-push-failed', message: 'Não foi possível enviar o commit de release.' };
  }
  log(activeLogger, 'log', 'Push realizado com sucesso.');

  return {
    success: true,
    code: 'pushed',
    message: 'Commit de release criado e enviado com sucesso.',
    commitMessage
  };
}

module.exports = {
  performReleaseCommit
};
