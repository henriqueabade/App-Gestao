/**
 * Onde o certificado e a senha ficam guardados.
 *
 * Só no computador que emite, nunca no banco, nunca no .env. O .env deste app
 * viaja dentro do instalador (docs/banco-dev-prod.md), então uma senha nele
 * iria parar em toda máquina que instala o programa.
 *
 * A pasta é `fiscal/` dentro do userData do Electron (%APPDATA%\<app>\fiscal).
 * O .pfx é copiado para lá e a senha é cifrada pelo cofre do sistema
 * (Electron safeStorage: no Windows, DPAPI do usuário logado). Quem copiar o
 * arquivo para outra máquina ou outro usuário não consegue decifrar.
 *
 * Em DEV/testes, sem Electron, valem as variáveis NFE_CERT_PATH e NFE_CERT_SENHA
 * — e o cofre pode ser injetado (`criar({ cofre })`) para os testes não
 * dependerem do Electron.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const NOME_ARQUIVO_PFX = 'certificado.pfx';
const NOME_ARQUIVO_CONFIG = 'certificado.json';

/** Cofre do Electron, quando este código roda dentro dele; senão, nenhum. */
function cofreDoElectron() {
  if (!process.versions.electron) return null;
  try {
    const { safeStorage } = require('electron');
    if (!safeStorage || !safeStorage.isEncryptionAvailable()) return null;
    return {
      nome: 'safeStorage',
      cifrar: texto => safeStorage.encryptString(texto).toString('base64'),
      decifrar: base64 => safeStorage.decryptString(Buffer.from(base64, 'base64'))
    };
  } catch (_) {
    return null;
  }
}

function pastaPadrao() {
  if (process.env.FISCAL_LOCAL_DIR) return process.env.FISCAL_LOCAL_DIR;
  if (process.versions.electron) {
    try {
      const { app } = require('electron');
      return path.join(app.getPath('userData'), 'fiscal');
    } catch (_) { /* segue para a pasta do usuário */ }
  }
  return path.join(os.homedir(), '.santissimo-fiscal');
}

/**
 * `cofre` e `pasta` são resolvidos NA HORA do uso, não na criação: o
 * fiscalController é carregado junto com o server.js, antes do `app` do
 * Electron estar pronto — e o safeStorage só responde depois disso.
 * Passar `cofre: null` desliga o cofre; `undefined` usa o do Electron.
 */
function criar({ pasta, cofre, env = process.env } = {}) {
  const obterPasta = () => pasta || pastaPadrao();
  const obterCofre = () => (cofre === undefined ? cofreDoElectron() : cofre);
  const arquivoPfxEm = () => path.join(obterPasta(), NOME_ARQUIVO_PFX);
  const arquivoConfigEm = () => path.join(obterPasta(), NOME_ARQUIVO_CONFIG);

  function lerConfig() {
    try {
      return JSON.parse(fs.readFileSync(arquivoConfigEm(), 'utf8'));
    } catch (_) {
      return null;
    }
  }

  /**
   * De onde vem o certificado, nesta ordem: o que o Sup Admin guardou pela
   * tela; senão, as variáveis de ambiente (DEV). Devolve null quando não há.
   */
  function fonte() {
    const cfg = lerConfig();
    const arquivoPfx = arquivoPfxEm();
    const cofre = obterCofre();
    if (cfg && fs.existsSync(arquivoPfx)) {
      if (!cofre) {
        // Sem cofre a senha não pode ser lida: não é falha silenciosa.
        return { origem: 'arquivo', caminho: arquivoPfx, senha: null, erro: 'O cofre do sistema não está disponível para ler a senha.' };
      }
      if (cfg.senha?.cifra !== cofre.nome) {
        return { origem: 'arquivo', caminho: arquivoPfx, senha: null, erro: 'A senha foi guardada por outro cofre; cadastre o certificado de novo.' };
      }
      try {
        return { origem: 'arquivo', caminho: arquivoPfx, senha: cofre.decifrar(cfg.senha.valor), guardadoEm: cfg.guardadoEm || null };
      } catch (_) {
        return { origem: 'arquivo', caminho: arquivoPfx, senha: null, erro: 'Não foi possível decifrar a senha do certificado neste computador.' };
      }
    }
    if (env.NFE_CERT_PATH) {
      return { origem: 'env', caminho: env.NFE_CERT_PATH, senha: env.NFE_CERT_SENHA ?? '' };
    }
    return null;
  }

  /** Copia o .pfx para a pasta e guarda a senha cifrada. `validar` abre o arquivo antes. */
  function guardar({ caminhoOrigem, senha, validar }) {
    const cofre = obterCofre();
    if (!cofre) {
      const e = new Error('Guardar o certificado exige o cofre do sistema (só dentro do aplicativo).');
      e.status = 500;
      throw e;
    }
    const conteudo = fs.readFileSync(caminhoOrigem);
    const dados = typeof validar === 'function' ? validar(conteudo, senha) : null;

    fs.mkdirSync(obterPasta(), { recursive: true });
    fs.writeFileSync(arquivoPfxEm(), conteudo);
    fs.writeFileSync(arquivoConfigEm(), JSON.stringify({
      senha: { cifra: cofre.nome, valor: cofre.cifrar(String(senha ?? '')) },
      guardadoEm: new Date().toISOString()
    }, null, 2));
    return dados;
  }

  function remover() {
    for (const arquivo of [arquivoPfxEm(), arquivoConfigEm()]) {
      try { fs.unlinkSync(arquivo); } catch (_) { /* já não existe */ }
    }
  }

  return {
    get pasta() { return obterPasta(); },
    get temCofre() { return Boolean(obterCofre()); },
    fonte, guardar, remover
  };
}

module.exports = { criar, pastaPadrao, cofreDoElectron };
