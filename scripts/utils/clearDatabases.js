const mongoose = require('mongoose');
const rimraf = require('rimraf');

module.exports = async (blockchainDatabase, mongoUrl) =>
  new Promise(async (resolve, reject) => {
    try {
      // Remove blockchain db
      rimraf.sync(blockchainDatabase);
      console.log(`Blockchain database at ${blockchainDatabase} has been erased`);

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
    } catch (e) {
      reject(e);
    }
  });
