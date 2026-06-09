import { toNano, beginCell, Cell, Dictionary } from '@ton/core';
import { sha256_sync } from '@ton/crypto';
import { MolePinJettonMinter } from '../build/MolePinJetton/MolePinJetton_MolePinJettonMinter';
import { NetworkProvider } from '@ton/blueprint';

// ── TEP-64 on-chain metadata: 0x00 prefix + dict keyed by sha256(fieldName) ──
const ONCHAIN_PREFIX = 0x00;
const SNAKE_PREFIX = 0x00;

function toSha256Key(field: string): bigint {
    return BigInt('0x' + sha256_sync(field).toString('hex'));
}

function makeSnakeCell(value: string): Cell {
    const data = Buffer.from(value, 'utf-8');
    const root = beginCell().storeUint(SNAKE_PREFIX, 8);
    const CHUNK = 127 - 1;
    if (data.length <= CHUNK) {
        root.storeBuffer(data);
        return root.endCell();
    }
    const chunks: Buffer[] = [];
    for (let i = 0; i < data.length; i += 127) chunks.push(data.subarray(i, i + 127));
    let curr: Cell | null = null;
    for (let i = chunks.length - 1; i >= 1; i--) {
        const b = beginCell().storeBuffer(chunks[i]);
        if (curr) b.storeRef(curr);
        curr = b.endCell();
    }
    root.storeBuffer(chunks[0].subarray(0, CHUNK));
    if (curr) root.storeRef(curr);
    return root.endCell();
}

function buildOnchainMetadata(fields: Record<string, string>): Cell {
    const dict = Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell());
    for (const key of Object.keys(fields)) {
        dict.set(toSha256Key(key), makeSnakeCell(fields[key]));
    }
    return beginCell().storeUint(ONCHAIN_PREFIX, 8).storeDict(dict).endCell();
}

export async function run(provider: NetworkProvider) {
    const deployer = provider.sender();
    const ownerAddress = deployer.address!;

    const content = buildOnchainMetadata({
        name: 'MolePin',
        symbol: 'MOL',
        decimals: '9',
        description: 'MolePin (MOL) — omnichain MemeFi token. TON deployment.',
    });

    const minter = provider.open(
        await MolePinJettonMinter.fromInit(ownerAddress, content),
    );

    await minter.send(
        deployer,
        { value: toNano('0.1') },
        { $$type: 'Deploy', queryId: 0n },
    );
    await provider.waitForDeploy(minter.address);

    console.log('MolePinJettonMinter deployed at:', minter.address.toString());

    const data = await minter.getGetJettonData();
    console.log('  totalSupply:', data.totalSupply.toString());
    console.log('  mintable   :', data.mintable);
    console.log('  owner      :', data.owner.toString());

    console.log('Done. Verify on testnet.tonscan.org');
}