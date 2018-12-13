const Web3 = require('web3');
const { LiquidPledging, LPVault } = require('giveth-liquidpledging');
const { LPPCappedMilestone } = require('lpp-capped-milestone');
const web3 = new Web3('http://localhost:8548');
const Confirm = require('prompt-confirm');
const { MiniMeTokenFactory, MiniMeToken, MiniMeTokenState } = require('minimetoken');

const config = require('./../../config/rsk.json')

const milestoneToCheck = "0x84B9B1b443d6cC59C2a6548EA52825e20EEA8d04";
const accountToCheck = "0x0414eFBbbf1D7BaeB15030F7815820963052932d";
const idPayment = 0;

const PledgeState = ["Pledged", "Paying", "Paid"]
const PaymentStatus = ["Pending", "Paid", "Canceled"]

const ERC20ABI = [
  // read balanceOf
  {
    constant: true,
    inputs: [{ name: '_owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: 'balance', type: 'uint256' }],
    type: 'function',
  },
  // read decimals
  // {
  //   constant: true,
  //   inputs: [],
  //   name: 'decimals',
  //   outputs: [{ name: '', type: 'uint8' }],
  //   type: 'function',
  // },
  // set allowance approval
  {
    constant: false,
    inputs: [{ name: '_spender', type: 'address' }, { name: '_amount', type: 'uint256' }],
    name: 'approve',
    outputs: [{ name: 'success', type: 'bool' }],
    type: 'function',
  },
  // read allowance of a specific address
  {
    constant: true,
    inputs: [{ name: '_owner', type: 'address' }, { name: '_spender', type: 'address' }],
    name: 'allowance',
    outputs: [{ name: 'remaining', type: 'uint256' }],
    type: 'function',
  },
];


/**
  Utility method to get a single pledge from liquidPledging

  Usage: node getPledge [pledgeId]
**/

async function getPledge(pledgeId) {
  const liquidPledging = new LiquidPledging(web3, config.blockchain.liquidPledgingAddress);
  const vault = new LPVault(web3, config.blockchain.vaultAddress);
  console.log('vault autopay?', await vault.autoPay())
  const payment = await vault.payments(idPayment)
  console.log('vault payment', payment);
  console.log('>> status: ', PaymentStatus[parseInt(payment.state)]);
  console.log('>> tokens paid to Milestone? ', payment.dest === milestoneToCheck);
  console.log('>> tokens paid: ', Web3.utils.fromWei(payment.amount));

  const pledge = await liquidPledging.getPledge(pledgeId);
  console.log('pledge', pledge)
  console.log('>> state: ', PledgeState[parseInt(pledge.pledgeState)])

  const milestone = new LPPCappedMilestone(web3, milestoneToCheck);
  const acceptedToken = await milestone.recipient();
  const completed = await milestone.completed();
  console.log("milestone's acceptedToken", acceptedToken);
  console.log("milestone completed? ", completed);

  const ERC20 = new MiniMeToken(web3, config.tokenWhitelist[1].address)
  const balanceOfVault = await ERC20.balanceOf(config.blockchain.vaultAddress)
  const balanceOfMilestone = await ERC20.balanceOf(milestoneToCheck)
  const balanceOfAccount = await ERC20.balanceOf(accountToCheck) 

  console.log('balanceOfVault', Web3.utils.fromWei(balanceOfVault));
  console.log('balanceOfMilestone', Web3.utils.fromWei(balanceOfMilestone));
  console.log('balanceOfAccount', Web3.utils.fromWei(balanceOfAccount));

} 

getPledge(process.argv[2]);