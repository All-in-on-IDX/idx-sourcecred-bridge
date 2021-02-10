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

const GITHUB_API_TOKEN = (
  process.env.GITHUB_API_TOKEN || 'ae744c063339472106c801f91394f0f71d61e17b'
)

const NodeAddress = sc.core.address.makeAddressModule({
  name: 'NodeAddress',
  nonce: 'N',
  otherNonces: new Map().set('E', 'EdgeAddress'),
})

const DiscordMemberPrefix = sc.plugins.discord.declaration.memberNodeType.prefix
const GithubMemberPrefix = sc.plugins.github.declaration.prefix
const EthNodePrefix = sc.plugins.ethereum.declaration.nodePrefix

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

const isEthAlias = a => NodeAddress.hasPrefix(a.address, EthNodePrefix)

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
      console.info('No Links; Skipping…')
      continue
    }
    for(let link of links.accounts) {
      if(link.host !== 'github.com') {
        console.info(`Unknown Link Host: ${link.host}`)
        continue
      }
      const alias = {
        description: `github/${link.id}`,
        address: NodeAddress.append(GithubMemberPrefix, 'user', link.id),
      }

      try {
        manager.ledger.addAlias(account.identity.id, alias)
      } catch(err) {
        console.error(err.message)
      }
    }
  }
})()
