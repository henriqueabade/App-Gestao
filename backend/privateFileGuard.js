const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

function isPrivateFile(url) {
  try {
    if (!url.startsWith('file:')) return false;
    let file = fileURLToPath(url);
    // Também bloqueia atalhos/symlinks que apontem para um arquivo privado.
    try { file = fs.realpathSync(file); } catch (_) {}
    const name = path.basename(file).toLowerCase().replace(/[. ]+$/, '').split(':')[0];
    return name === '.env' || name.startsWith('.env.') || /^authtoken(?:\.|$)/.test(name);
  } catch (_) { return true; }
}

const installed = new WeakSet();
function protectSession(session) {
  if (installed.has(session)) return;
  session.webRequest.onBeforeRequest({ urls: ['file://*/*'] }, (details, callback) => {
    callback({ cancel: isPrivateFile(details.url) });
  });
  installed.add(session);
}

module.exports = { isPrivateFile, protectSession };
