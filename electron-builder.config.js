const path = require('path');
const publishProvider = process.env.ELECTRON_PUBLISH_PROVIDER || 'github';

const publishConfig = (() => {
  switch (publishProvider) {
    case 'github':
      const slug = process.env.ELECTRON_PUBLISH_GITHUB_SLUG || process.env.GITHUB_REPOSITORY;
      const [slugOwner, slugRepo] = slug ? slug.split('/') : [];
      return {
        provider: 'github',
        owner: process.env.ELECTRON_PUBLISH_GITHUB_OWNER || slugOwner,
        repo: process.env.ELECTRON_PUBLISH_GITHUB_REPO || slugRepo,
        releaseType: process.env.ELECTRON_PUBLISH_GITHUB_RELEASE_TYPE || 'draft'
      };
    case 'generic':
      return {
        provider: 'generic',
        url: process.env.ELECTRON_PUBLISH_GENERIC_URL
      };
    case 'spaces':
      return {
        provider: 'spaces',
        name: process.env.ELECTRON_PUBLISH_SPACES_NAME,
        region: process.env.ELECTRON_PUBLISH_SPACES_REGION,
        endpoint: process.env.ELECTRON_PUBLISH_SPACES_ENDPOINT,
        path: process.env.ELECTRON_PUBLISH_SPACES_PATH || '/'
      };
    default:
      throw new Error(`Unsupported ELECTRON_PUBLISH_PROVIDER: ${publishProvider}`);
  }
})();

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
    icon: path.join('src', 'assets', 'Logo.ico')
  },
  nsis: {
    oneClick: false,
    perMachine: true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    include: path.join('build', 'installer.nsh')
  },
  publish: [publishConfig]
};

