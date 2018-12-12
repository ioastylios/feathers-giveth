const Web3 = require('web3');
const { LiquidPledging } = require('giveth-liquidpledging');
const { LPPCappedMilestone } = require('lpp-capped-milestone');
const web3 = new Web3('http://localhost:8548');
const Confirm = require('prompt-confirm');
const { MiniMeTokenFactory, MiniMeToken, MiniMeTokenState } = require('minimetoken');

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
  const liquidPledging = new LiquidPledging(web3, "0x46579394802b5e4d2C0647436BFcc71A2d9E8478");

  const pledge = await liquidPledging.getPledge(pledgeId);
  console.log('pledge', pledge)

  const milestone = new LPPCappedMilestone(web3, "0x657bC94Cd3f7915De06AB15a667A76E2B83A8810");
  const acceptedToken = await milestone.recipient();
  console.log('acceptedToken', acceptedToken)

  const ERC20 = new MiniMeToken(web3, "0x428Eee6c7f663a8249518743B861420e94C3dD70")
  const balanceOfVault = await ERC20.balanceOf("0xd916d3eB4AbEa19118bCFB8F06430309b4aB1298")
  const balanceOfMilestone = await ERC20.balanceOf("0x428Eee6c7f663a8249518743B861420e94C3dD70")
  const balanceOfAccount = await ERC20.balanceOf("0x9501A90A1B57Eee96fa4A9f1259f4e75435aD4Cd") 

  console.log('balanceOfVault', Web3.utils.fromWei(balanceOfVault));
  console.log('balanceOfMilestone', Web3.utils.fromWei(balanceOfMilestone));
  console.log('balanceOfAccount', Web3.utils.fromWei(balanceOfAccount));

} 

getPledge(process.argv[2]);