const { isDev } = require('./dataConfig');
module.exports = isDev ? require('./localDataClient') : require('./remoteDatabase');
