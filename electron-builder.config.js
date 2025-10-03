const path = require('path');

module.exports = {
  appId: 'com.santissimo.decor',
  productName: 'Santíssimo Decor',
  copyright: '© 2025 Santíssimo',

  directories: {
    output: path.join(__dirname, 'dist')
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
  artifactName: '${productName}-Setup-${version}-${arch}.${ext}',

  win: {
    target: 'nsis',
    icon: path.join('src', 'assets', 'Logo.ico') // ajuste se seu ícone estiver em outro caminho
  },

  nsis: {
    oneClick: false,
    perMachine: true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    include: path.join('build', 'installer.nsh')
  },

  // 🔧 ALTERE SOMENTE ESTES DOIS CAMPOS:
  publish: [
    {
      provider: 'github',
      owner: 'henriqueabade', // ex.: "henriqueabade"
      repo: 'App-Gestao',   // ex.: "App-Gestao"
      releaseType: 'release'       // 'draft' para testes; use 'release' se preferir publicar final
    }
  ]
};