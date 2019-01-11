const GivethTestToken = require('./../../src/contracts/js/GivethTestToken.js');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = (
  web3,
  accounts,
  from,
  { tokenName = 'Giveth Test Token', tokenSymbol = 'GTT', tokenDecimals = 18 } = {},
) => {
  console.log(`Deploying ERC20 token with symbol ${tokenSymbol}`);

  return new Promise(async (resolve, reject) => {
    try {
      // Deploy token contract
      const Token = await GivethTestToken.new(
        web3,
        tokenName,
        tokenSymbol,
        tokenDecimals,
        web3.utils.toWei('1100000'),
        { from },
      );
      console.log(` - Contract deployed: ${Token.$address}`);

      // Transfer tokens from account[0] to all other accounts
      // @dev:  deliberately not using Promises here so that each account is funded consecutively
      //        RSK nodes don't handle promises very well as that fires all txs requests at once
      let balance;

      for (const a of accounts) {
        console.log(`Funding account ${a}`);
        await Token.transfer(a, web3.utils.toWei('100000'), { from });

        balance = await Token.balanceOf(a);
        console.log(` - balance: ${web3.utils.fromWei(balance)} ${tokenSymbol}`);

        // wait for next tx, to give the RSK node some time to rest
        await sleep(2000);
      }

      resolve({
        token: {
          name: tokenName,
          address: Token.$address,
          symbol: tokenSymbol,
          decimals: tokenDecimals,
        },
      });
    } catch (er) {
      reject(er);
    }
  });
};
