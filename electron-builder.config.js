const path = require('path');
const os = require('os');

module.exports = {
  appId: 'com.santissimo.decor',
  productName: 'Santíssimo Decor',
  copyright: '© 2025 Santíssimo',
  directories: {
  output: 'C:/Users/henri/Desktop/TestesApp/Instalador'
},
  files: [
    "**/*",
    "!node_modules/.bin",
    "!node_modules/electron*",
    "!node_modules/@electron*",
    "!dist",
    "!*.md",
    "!tests",
    "!.vscode",
    "!*.map"
  ],
  asar: true,
  artifactName: "${productName}-Setup-${version}.exe",
  win: {
    target: 'nsis',
    icon: path.join('src', 'assets', 'Logo.ico')
  },
  nsis: {
    oneClick: false,
    perMachine: true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    include: path.join('build', 'installer.nsh')
  }
};

