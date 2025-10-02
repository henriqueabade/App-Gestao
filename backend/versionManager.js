const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const packageJsonPath = path.join(projectRoot, 'package.json');
const packageLockPath = path.join(projectRoot, 'package-lock.json');

function readJsonFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return { content, data: JSON.parse(content) };
}

function writeJsonFile(filePath, data) {
  const payload = JSON.stringify(data, null, 2);
  fs.writeFileSync(filePath, `${payload}\n`);
}

function getCurrentVersion() {
  try {
    const { data } = readJsonFile(packageJsonPath);
    return data.version || null;
  } catch (err) {
    throw new Error(`Não foi possível ler a versão atual: ${err.message}`);
  }
}

function applyProjectVersion(newVersion) {
  const backups = [];
  const updates = [];

  const { content: pkgContent, data: pkgData } = readJsonFile(packageJsonPath);
  backups.push({ file: packageJsonPath, content: pkgContent });
  pkgData.version = newVersion;
  updates.push({ file: packageJsonPath, data: pkgData });

  if (fs.existsSync(packageLockPath)) {
    const { content: lockContent, data: lockData } = readJsonFile(packageLockPath);
    backups.push({ file: packageLockPath, content: lockContent });
    lockData.version = newVersion;
    if (lockData.packages && lockData.packages['']) {
      lockData.packages[''].version = newVersion;
    }
    updates.push({ file: packageLockPath, data: lockData });
  }

  try {
    updates.forEach(entry => writeJsonFile(entry.file, entry.data));
  } catch (err) {
    backups.forEach(entry => {
      try {
        fs.writeFileSync(entry.file, entry.content);
      } catch (restoreErr) {
        console.error('Falha ao restaurar arquivo após erro de versão:', restoreErr);
      }
    });
    throw new Error(`Não foi possível aplicar a nova versão: ${err.message}`);
  }

  let reverted = false;
  return () => {
    if (reverted) return;
    reverted = true;
    backups.forEach(entry => {
      try {
        fs.writeFileSync(entry.file, entry.content);
      } catch (restoreErr) {
        console.error('Falha ao restaurar versão anterior:', restoreErr);
      }
    });
  };
}

module.exports = {
  getCurrentVersion,
  applyProjectVersion
};
