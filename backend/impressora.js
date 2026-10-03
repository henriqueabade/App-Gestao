/**
 * A impressora de PDF do backend (fase I da Contabilidade, 02/10/2026): o
 * pacote da competência gera na hora os dossiês dos pagamentos, os espelhos
 * do DDA, o DANFE das NF-e e o extrato do mês em PDF.
 *
 * Quem imprime é o Electron (janela oculta + printToPDF, o mesmo caminho do
 * DANFE): o main.js registra aqui uma "fábrica" de sessões quando o app abre
 * (o servidor da API roda dentro do processo principal). Uma sessão reaproveita
 * a mesma janela para vários documentos.
 *
 * Fora do app (os testes, um servidor solto) não há impressora: quem chama
 * recebe `imprimir = null` e decide o que fazer (o pacote leva o HTML).
 */
let fabrica = null;

/** `fn()` devolve `{ imprimir(html, { retrato }) -> Buffer, fechar() }`. null desliga. */
function registrar(fn) {
  fabrica = typeof fn === 'function' ? fn : null;
}

const disponivel = () => Boolean(fabrica);

/**
 * Abre uma sessão, roda `fn(imprimir)` e fecha a sessão (mesmo com erro).
 * Sem impressora, `imprimir` é null.
 */
async function sessao(fn) {
  if (!fabrica) return fn(null);
  const s = await fabrica();
  try {
    return await fn((html, opcoes = {}) => s.imprimir(html, opcoes));
  } finally {
    try { await s.fechar?.(); } catch (_) { /* a janela já fechou */ }
  }
}

module.exports = { registrar, disponivel, sessao };
