// backend/verifyTransporter.js

// 1) carrega as variáveis do .env em process.env
require('dotenv').config();

const transporter = require('../src/email/transporter');

transporter.verify()
  .then(() => console.log('SMTP OK'))
  .catch(err => console.error('SMTP Error', err));
