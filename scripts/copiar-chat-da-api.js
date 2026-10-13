#!/usr/bin/env node
/**
 * Copia o chat interno da API (Santissimo-db-API/chat/) para o programa
 * (backend/chat/), que o usa com BANCO=DEV (banco local, sem a API no meio).
 * Os arquivos são IGUAIS nos dois lados — mudou lá, rode:
 *
 *   node scripts/copiar-chat-da-api.js             copia
 *   node scripts/copiar-chat-da-api.js --conferir  só diz se está igual
 *
 * O teste backend/chatCopia.test.js confere (quando a API está ao lado).
 */
const fs = require('fs');
const path = require('path');

const ORIGEM = path.join(__dirname, '..', '..', 'Santissimo-db-API', 'chat');
const DESTINO = path.join(__dirname, '..', 'backend', 'chat');
const ARQUIVOS = ['chat.js', 'presenca.js', 'eventos.js', 'rotas.js'];

const ler = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

function diferentes() {
  return ARQUIVOS.filter(a => !fs.existsSync(path.join(DESTINO, a)) || ler(path.join(ORIGEM, a)) !== ler(path.join(DESTINO, a)));
}

if (require.main === module) {
  if (!fs.existsSync(ORIGEM)) {
    console.error(`Não achei a pasta do chat da API em ${ORIGEM}.`);
    process.exit(1);
  }
  if (process.argv.includes('--conferir')) {
    const d = diferentes();
    if (!d.length) { console.log('Chat do programa igual ao da API.'); process.exit(0); }
    console.error(`Diferentes: ${d.join(', ')} — rode sem --conferir.`);
    process.exit(1);
  }
  fs.mkdirSync(DESTINO, { recursive: true });
  // Só o que mudou de verdade: regravar o igual trocaria o fim de linha
  // (CRLF do checkout por LF) e o git mostraria o arquivo como mudado.
  const copiados = diferentes();
  for (const a of copiados) fs.writeFileSync(path.join(DESTINO, a), ler(path.join(ORIGEM, a)));
  console.log(copiados.length ? `Copiado para ${DESTINO}: ${copiados.join(', ')}` : 'Nada a copiar: já está igual à API.');
}

module.exports = { ORIGEM, DESTINO, ARQUIVOS, diferentes };
