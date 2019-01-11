const mongoose = require('mongoose');
const rimraf = require('rimraf');

module.exports = async (blockchainDatabase, mongoUrl) =>
  new Promise(async (resolve, reject) => {
    try {
      // Remove blockchain db
      if (blockchainDatabase) {
        rimraf.sync(blockchainDatabase);
        console.log(`Blockchain database at ${blockchainDatabase} has been erased`);
      } else console.log('Can not erase the blockchain database, no path was provided');

      if (mongoUrl) {
        mongoose.connect(mongoUrl);
        const db = mongoose.connection;

        db.on('error', err => {
          reject(err);
        });

        // once mongo connected, start migration
        db.once('open', () => {
          console.log('Connected to MongoDB');

          db.dropDatabase().then(() => {
            console.log('Mongo database dropped');
            resolve();
          });
        });
      } else console.log('Can not erase the mongo DB, no connection URL provided');
    } catch (e) {
      reject(e);
    }
  });
