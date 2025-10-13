const path = require('path');

const LOGO_CID = 'company-logo';
const LOGO_FILENAME = 'logo.png';
const LOGO_RELATIVE_PATH = '../assets/Logo 40x40px.png';

function getLogoAttachment() {
  return {
    filename: LOGO_FILENAME,
    path: path.join(__dirname, LOGO_RELATIVE_PATH),
    cid: LOGO_CID
  };
}

function renderLogoImage() {
  return `<img src="cid:${LOGO_CID}" alt="Santíssimo Decor" style="max-width: 160px; height: auto; margin-bottom: 16px; display: block;" />`;
}

module.exports = {
  getLogoAttachment,
  renderLogoImage
};
