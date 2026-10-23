/**
 * Proteções nas sessões do Chromium: janelas do programa, a janela oculta do
 * PDF e a sessão própria da atualização automática ("electron-updater").
 * Ligadas pelo main.js em cada sessão criada (WeakSet: uma vez por sessão).
 *
 * - Pedido ao backend local leva o segredo do programa (acessoLocal.js), mas
 *   só se partir de uma tela do programa (file:// ou o próprio servidor).
 * - Pedido para fora só aceita gzip/deflate, e resposta em br é cancelada
 *   antes do corpo: a brotli do Chromium 120 não tem a correção do
 *   CVE-2026-111497. (Fonte WOFF2 tem Brotli por dentro e não passa por aqui:
 *   isso só a troca do Electron resolve.)
 * - Cadeia com autoridade do incidente eMudhra/emSign é recusada; o resto
 *   segue o resultado do próprio Chromium (-3), sem afrouxar nada. O Electron
 *   não usa a CRLSet do Chrome, e a lista embutida no Chromium 120 é de 2023.
 */
const acessoLocal = require('./acessoLocal');
const { spkiDe, bloqueada, temBrotli, ACEITO } = require('./redeSegura');

const instaladas = new WeakSet();
const TODOS = { urls: ['http://*/*', 'https://*/*'] };

function origemDe(endereco) {
  try {
    const u = new URL(endereco);
    return u.protocol === 'file:' ? 'file:' : u.origin;
  } catch (_) {
    return '';
  }
}

/** O pedido saiu de uma tela do programa? */
function daTelaDoPrograma(detalhes) {
  // Navegação aberta pelo próprio main.js (loadFile/loadURL da tela do PDF).
  if (detalhes.resourceType === 'mainFrame') return true;
  let quem = detalhes.frame?.url || detalhes.referrer || '';
  if (!quem) {
    try { quem = detalhes.webContents?.getURL?.() || ''; } catch (_) { quem = ''; }
  }
  const origem = origemDe(quem);
  return origem === 'file:' || acessoLocal.origensDoServidor().includes(origem);
}

/** Troca um cabeçalho sem duplicar pela diferença de maiúsculas. */
function definir(cabecalhos, nome, valor) {
  for (const chave of Object.keys(cabecalhos)) {
    if (chave.toLowerCase() === nome.toLowerCase()) delete cabecalhos[chave];
  }
  if (valor !== undefined) cabecalhos[nome] = valor;
}

function valorDe(cabecalhos, nome) {
  for (const [chave, valor] of Object.entries(cabecalhos || {})) {
    if (chave.toLowerCase() === nome) return [].concat(valor).join(', ');
  }
  return '';
}

/**
 * A resposta veio em Brotli? No Windows o Chromium (120 e 156) entrega ao
 * onHeadersReceived os cabeçalhos já sem o Content-Encoding e põe no lugar o
 * X-Content-Encoding-Over-Network: olhar só o primeiro deixava passar o br
 * (visto na homologação do Electron 45, 23/10/2026). O corpo ainda não foi lido
 * nesse ponto: cancelar aqui impede a decodificação.
 */
function respostaEmBrotli(cabecalhos) {
  return temBrotli(valorDe(cabecalhos, 'content-encoding')) || temBrotli(valorDe(cabecalhos, 'x-content-encoding-over-network'));
}

/** Alguma chave da cadeia (certificado do Electron, com issuerCert) está bloqueada? */
function cadeiaBloqueada(certificado) {
  const vistos = new Set();
  for (let c = certificado; c && c.data && !vistos.has(c.fingerprint); c = c.issuerCert) {
    vistos.add(c.fingerprint);
    const spki = spkiDe(c.data);
    if (!spki) return `chave ilegível em ${c.subjectName || 'certificado sem nome'}`;
    const nome = bloqueada(spki);
    if (nome) return nome;
  }
  return null;
}

function instalarNaSessao(sessao, { avisar = mensagem => console.warn(mensagem) } = {}) {
  if (!sessao || instaladas.has(sessao)) return;
  instaladas.add(sessao);

  sessao.webRequest.onBeforeSendHeaders(TODOS, (detalhes, pronto) => {
    const cabecalhos = { ...detalhes.requestHeaders };
    if (acessoLocal.ehDoBackendLocal(detalhes.url)) {
      definir(cabecalhos, acessoLocal.CABECALHO, daTelaDoPrograma(detalhes) ? acessoLocal.cabecalhos()[acessoLocal.CABECALHO] : undefined);
    } else {
      definir(cabecalhos, 'Accept-Encoding', ACEITO);
    }
    pronto({ requestHeaders: cabecalhos });
  });

  sessao.webRequest.onHeadersReceived(TODOS, (detalhes, pronto) => {
    if (!acessoLocal.ehDoBackendLocal(detalhes.url) && respostaEmBrotli(detalhes.responseHeaders)) {
      avisar(`[seguranca] resposta Brotli cancelada (CVE-2026-111497): ${origemDe(detalhes.url)}`);
      return pronto({ cancel: true });
    }
    return pronto({});
  });

  sessao.setCertificateVerifyProc((pedido, pronto) => {
    const motivo = cadeiaBloqueada(pedido.validatedCertificate || pedido.certificate);
    if (motivo) {
      avisar(`[seguranca] certificado recusado para ${pedido.hostname}: ${motivo}`);
      return pronto(-2);
    }
    return pronto(-3);
  });
}

module.exports = { instalarNaSessao, cadeiaBloqueada, daTelaDoPrograma, respostaEmBrotli };
