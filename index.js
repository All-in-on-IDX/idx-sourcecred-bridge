#! /usr/bin/env node

/**
 * This will be a piece of software to generate aliases for SourceCred
 * identites from the accounts linked to an IDX identity.
 * 
 * The basic plan of attack is:
 * 1. Load a SourceCred ledger
 * 2. From that ledger, get a list of accounts
 * 3. For each account, use the ETH address to look up the IDX DID
 * 4. For the DID, access the Ceramic Accounts Index
 * 5. For each associated account, create a SourceCred alias
 */

// import sc from 'sourcecred'
const sc = require('sourcecred-publish-test').sourcecred
const Ceramic = require('@ceramicnetwork/http-client').default
const { definitions } = require('idx-account-linker/src/docIDs.json')
const IDX = require('@ceramicstudio/idx').IDX
require('dotenv').config()

const GITHUB_API_TOKEN = process.env.GITHUB_API_TOKEN

if(!GITHUB_API_TOKEN) {
  console.error('Missing GITHUB_API_TOKEN')
  process.exit(-5)
}

const NodeAddress = sc.core.address.makeAddressModule({
  name: 'NodeAddress',
  nonce: 'N',
  otherNonces: new Map().set('E', 'EdgeAddress'),
})
const prefixes = {
  'https://discord.com': sc.plugins.discord.declaration.memberNodeType.prefix,
  'https://github.com': sc.plugins.github.declaration.userNodeType.prefix,
  ethereum: sc.plugins.ethereum.declaration.nodePrefix,
}
const createCeramic = async (url = 'https://ceramic-clay.3boxlabs.com') => {
  const ceramic = new Ceramic(url)
  ceramic.didFor = async(addr) => (
    (await ceramic.createDocument('caip10-link',
      { metadata: {
        family: 'caip10-link',
        controllers: [`${addr.toLowerCase()}@eip155:1`],
      } }
    )).content
  )
  return Promise.resolve(ceramic)
}

const storage = new sc.ledger.storage.GithubStorage(
  GITHUB_API_TOKEN, 'MetaFam/XP',
)

const manager = new sc.ledger.manager.LedgerManager({
  storage,
})

const addressUtils = sc.plugins.ethereum.utils.address
const isEthAlias = a => NodeAddress.hasPrefix(a.address, prefixes.ethereum)

;(async () => {
  const ceramic = await createCeramic()
  const idx = new IDX({ ceramic, aliases: definitions })
  const res = await manager.reloadLedger()
  if(res.error) {
    console.log('error', res.error)
  }
  //const ledgerAccount = manager.ledger.accountByAddress(addressUtils.nodeAddressForEthAddress(addr));
  const accounts = manager.ledger.accounts()
  const ethAccounts = accounts.filter(acc => {
    return acc.identity.aliases.find(isEthAlias);
  })

  for(account of ethAccounts) {
    const ethAlias = account.identity.aliases.find(isEthAlias)
    const ethAddress = NodeAddress.toParts(ethAlias.address)[2]
    
    console.log(ethAddress)

    const did = await ceramic.didFor(ethAddress)
    if(!did) {
      console.info('No DID; Skipping…')
      continue
    }
    const links = await idx.get('aka', did)
    if(!links || !links.accounts) {
      console.info(`No Links; ${did}; Skipping…`)
      continue
    }
    for(let link of links.accounts) {
      const url = `${link.protocol}://${link.host}`
      const prefix = prefixes[url]
      if(!prefix) {
        console.info(prefixes)
        console.info(`Unknown Link URL: ${url}`)
        continue
      }
      const alias = {
        description: `${link.host.split('.')[0]}/${link.id}`,
        address: NodeAddress.append(prefix, 'user', link.id),
      }

      try {
        manager.ledger.addAlias(account.identity.id, alias)
      } catch(err) {
        console.error(err.message)
      }
    }
  }
})()
