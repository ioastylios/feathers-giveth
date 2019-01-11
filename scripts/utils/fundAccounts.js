const ganacheAccounts = [
  '0x90f8bf6a479f320ead074411a4b0e7944ea8c9c1',
  '0xffcf8fdee72ac11b5c542428b35eef5769c409f0',
  '0x22d491bde2303f2f43325b2108d26f1eaba1e32b',
  '0xe11ba2b4d45eaed5996cd0823791e0c93114882d',
  '0xd03ea8624c8c5987235048901fb614fdca89b117',
];

/**
 * Funds the accounts defined
 *
 * @param  {Web3Provider}  web3      Web 3 provider to be used
 * @param  {Array}         accounts  Array of public addresses as string which should be prefunded
 * @param  {Web3Account}   from      A web3 account pointer
 */
module.exports = (web3, accounts = ganacheAccounts, from, { symbol = 'ETH' } = {}) => {
  const value = web3.utils.toWei('100');

  return new Promise(async (resolve, reject) => {
    try {
      await Promise.all(
        accounts.map(to => web3.eth.sendTransaction({ to, from, gas: 30000, value })),
      );
      console.log(` - Accounts funded:`);

      await Promise.all(
        accounts.map(async acc => {
          const balance = await web3.eth.getBalance(acc);
          console.log(`   ${acc} balance: ${web3.utils.fromWei(balance)} ${symbol}`);
        }),
      );
      resolve(accounts, value);
    } catch (e) {
      reject(e);
    }
  });
};
