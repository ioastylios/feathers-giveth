const generateClass = require('eth-contract-class').default;

const GivethTestTokenArtifact = require('./../build/contracts/GivethTestToken.json');

module.exports = generateClass(
    GivethTestTokenArtifact.abi,
    GivethTestTokenArtifact.bytecode,
);