const GivethTestToken = require('./../../src/contracts/js/GivethTestToken.js');

module.exports = (
  web3,
  accounts,
  from,
  { tokenName = 'Giveth Test Token', tokenSymbol = 'GTT', tokenDecimals = 18 } = {},
) => {
  console.log(`Deploying ERC20 token with symbol ${tokenSymbol}`);

  return new Promise(async (resolve, reject) => {
    try {
      const Token = await GivethTestToken.new(
        web3,
        tokenName,
        tokenSymbol,
        tokenDecimals,
        web3.utils.toWei('1000000'),
        { from },
      );
      console.log(` - Contract deployed: ${Token.$address}`);

      // Transfer tokens from account[0] to all other accounts
      await Promise.all(accounts.map(a => Token.transfer(a, web3.utils.toWei('100000'), { from })));
      console.log(` - Accounts funded:`);

      // Fetching balances
      await Promise.all(
        accounts.map(async a => {
          const balance = await Token.balanceOf(a);
          console.log(`   ${a} balance: ${web3.utils.fromWei(balance)} ${tokenSymbol}`);
        }),
      );
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
