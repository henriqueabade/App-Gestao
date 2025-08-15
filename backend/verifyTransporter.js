// backend/verifyTransporter.js

// 1) carrega as variáveis do .env em process.env sem logs verbosos
require('dotenv').config({ quiet: true });

const transporter = require('../src/email/transporter');

const DEBUG = process.env.DEBUG === 'true';
transporter
  .verify()
  .then(() => {
    if (DEBUG) console.log('SMTP OK');
  })
  .catch((err) => console.error('SMTP Error', err));
