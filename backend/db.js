const { isDev } = require('./dataConfig');
module.exports = require('./auditoriaCaptura').comAuditoria(isDev ? require('./localDataClient') : require('./remoteDatabase'), { sistema: true, caminhosSemApi: true });
