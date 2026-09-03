const path = require('path');

module.exports = {
  appId: 'com.santissimo.decor',
  productName: 'Santíssimo Decor',
  copyright: '© 2025 Santíssimo',

 directories: {
  output: 'C:/Users/henri/OneDrive/Work/Santissimo Decor/Novo Programa de Gestão/TestesApp/Instalador'
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

  npmRebuild: false,
  npmArgs: ["--include=dev"],

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

  // ---------------------------------------------------------------------------
  // ONDE O INSTALADOR É PUBLICADO — e de onde os clientes vão BAIXAR.
  //
  // São os mesmos valores que backend/publisher.js já lia do .env; aqui estavam
  // fixos, então mexer no .env não surtia efeito nenhum.
  //
  // ATENÇÃO ao repositório escolhido: o app instalado pede o feed de atualização
  // ao GitHub SEM CREDENCIAL. Em repositório privado a resposta é 404, e o
  // cliente vê "servidor de atualização indisponível" — publicar funciona (quem
  // publica tem token), baixar não. O repositório apontado aqui precisa ser
  // PÚBLICO.
  // ---------------------------------------------------------------------------
  publish: [
    {
      provider: 'github',
      owner: process.env.ELECTRON_PUBLISH_GITHUB_OWNER || 'henriqueabade',
      repo: process.env.ELECTRON_PUBLISH_GITHUB_REPO || 'App-Gestao',
      releaseType: process.env.ELECTRON_PUBLISH_GITHUB_RELEASE_TYPE || 'release'
    }
  ]
};
