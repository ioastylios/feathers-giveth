/* eslint-disable import/no-extraneous-dependencies, prefer-destructuring */
const path = require('path');
const mkdirp = require('mkdirp');
const Ganache = require('ganache-cli');

process.on('uncaughtException', console.log);
process.on('unhandledRejection', console.log);

module.exports = async (blockTime = 0) => {
  // create folder to store chain data
  const dbPath = path.join(__dirname, '../data/ganache-cli/rsk');
  mkdirp.sync(dbPath);

  // start networks
  const rskNetwork = Ganache.server({
    total_accounts: 11,
    ws: true,
    seed: 'RSK is awesome!',
    db_path: dbPath,
    network_id: 88,
    logger: {
      log: val => console.log('RSK: ', val),
    },
    blockTime,
  });

  rskNetwork.listen(8545, '127.0.0.1', () => {});
  rskNetwork.waitForStart = () =>
    new Promise((resolve, reject) => {
      if (rskNetwork.listening) {
        resolve();
        return;
      }

      rskNetwork.on('listening', () => resolve());
      rskNetwork.on('close', () => reject(new Error('closed')));
    });

  return rskNetwork
};