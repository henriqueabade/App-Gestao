/**
 * O programa no Windows (01/10/2026, pedido do dono): iniciar junto com o
 * Windows, em segundo plano; mostrar os avisos do sino no canto da tela
 * quando o programa não está na frente; tocar o "tum-tum" dos avisos.
 *
 * TUDO LIGADO DE FÁBRICA. Configurações › Programa no Windows desliga. As
 * preferências são da MÁQUINA (userData), não do usuário: valem para quem usa
 * este computador. Sem o arquivo (primeira vez depois de instalar), vale o
 * padrão — e `primeiraVez` avisa o main.js para ligar o início com o Windows.
 *
 * O som pode ser um arquivo do dono em src/assets (`arquivoDoSom`).
 */

const PADRAO = Object.freeze({ iniciarComWindows: true, avisosNoWindows: true, som: true });
const CHAVES = Object.keys(PADRAO);

/** Só as chaves conhecidas, e sempre booleanas (o que não veio fica no padrão). Pura. */
function normalizar(bruto = {}, base = PADRAO) {
  const saida = { ...base };
  for (const chave of CHAVES) {
    if (bruto && typeof bruto[chave] === 'boolean') saida[chave] = bruto[chave];
  }
  return saida;
}

/** Lê do arquivo; sem arquivo (ou ilegível), o padrão com `primeiraVez`. */
function ler(arquivo, fs = require('fs')) {
  try {
    return { ...normalizar(JSON.parse(fs.readFileSync(arquivo, 'utf8'))), primeiraVez: false };
  } catch (_) {
    return { ...PADRAO, primeiraVez: true };
  }
}

/** Grava as mudanças por cima do que já está e devolve o resultado. */
function gravar(arquivo, mudancas = {}, fs = require('fs')) {
  const atual = ler(arquivo, fs);
  const proximo = normalizar(mudancas, normalizar(atual));
  try {
    fs.mkdirSync(require('path').dirname(arquivo), { recursive: true });
    fs.writeFileSync(arquivo, JSON.stringify(proximo, null, 2), 'utf8');
  } catch (err) {
    console.error('[windows] preferências não gravadas:', err?.message || err);
  }
  return proximo;
}

/**
 * O som dos avisos escolhido pelo dono (01/10/2026): o arquivo que ele põe em
 * src/assets com o nome `som-aviso` — mp3, wav ou ogg, nessa preferência.
 * Devolve o nome do arquivo (relativo a src/assets) ou null: sem arquivo,
 * toca o "tum-tum" gerado na hora (src/js/utils/som-aviso.js).
 */
const ARQUIVOS_DE_SOM = Object.freeze(['som-aviso.mp3', 'som-aviso.wav', 'som-aviso.ogg']);

function arquivoDoSom(pastaAssets, fs = require('fs')) {
  for (const nome of ARQUIVOS_DE_SOM) {
    try {
      if (fs.statSync(require('path').join(pastaAssets, nome)).size > 0) return nome;
    } catch (_) { /* não tem esse: tenta o próximo */ }
  }
  return null;
}

module.exports = { PADRAO, CHAVES, normalizar, ler, gravar, ARQUIVOS_DE_SOM, arquivoDoSom };
