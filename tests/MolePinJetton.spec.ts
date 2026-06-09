import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { beginCell, toNano, Address, Cell  } from '@ton/core';
import '@ton/test-utils';
import { MolePinJettonMinter } from '../build/MolePinJetton/MolePinJetton_MolePinJettonMinter';
import { MolePinJettonWallet } from '../build/MolePinJetton/MolePinJetton_MolePinJettonWallet';

// MolePin fixed supply invariant: 6,942,420,888,888 tokens * 10^9 (decimals 9)
const MAX_SUPPLY = 6942420888888n * 1000000000n;

// Minimal off-chain content cell (TEP-64 prefix 0x01 + link). Real metadata
// is refined at deploy time; tests only need a valid cell.
function contentCell(): Cell {
    return beginCell().storeUint(0x01, 8).storeStringTail('https://molepin.example/mol.json').endCell();
}

describe('MolePinJettonMinter', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let alice: SandboxContract<TreasuryContract>;
    let bob: SandboxContract<TreasuryContract>;
    let minter: SandboxContract<MolePinJettonMinter>;

    // helper: open a holder's jetton wallet via the minter's getter
    async function walletOf(owner: Address): Promise<SandboxContract<MolePinJettonWallet>> {
        const addr = await minter.getGetWalletAddress(owner);
        return blockchain.openContract(MolePinJettonWallet.fromAddress(addr));
    }

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        alice = await blockchain.treasury('alice');
        bob = await blockchain.treasury('bob');

        minter = blockchain.openContract(
            await MolePinJettonMinter.fromInit(deployer.address, contentCell()),
        );

        const deployResult = await minter.send(
            deployer.getSender(),
            { value: toNano('0.1') },
            { $$type: 'Deploy', queryId: 0n },
        );

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: minter.address,
            deploy: true,
            success: true,
        });
    });

    it('deploys with zero supply, mintable, correct owner', async () => {
        const data = await minter.getGetJettonData();
        expect(data.totalSupply).toBe(0n);
        expect(data.mintable).toBe(true);
        expect(data.owner.toString()).toBe(deployer.address.toString());
    });

    it('owner can mint; supply and wallet balance increase', async () => {
        const amount = toNano('1000'); // 1000 MOL at 9 decimals
        const res = await minter.send(
            deployer.getSender(),
            { value: toNano('0.2') },
            { $$type: 'MolePinMint', queryId: 1n, amount, receiver: alice.address },
        );

        // minter accepted the mint
        expect(res.transactions).toHaveTransaction({
            from: deployer.address,
            to: minter.address,
            success: true,
        });

        // totalSupply went up
        const data = await minter.getGetJettonData();
        expect(data.totalSupply).toBe(amount);

        // alice's wallet got the balance
        const aliceWallet = await walletOf(alice.address);
        const wd = await aliceWallet.getGetWalletData();
        expect(wd.balance).toBe(amount);
        expect(wd.owner.toString()).toBe(alice.address.toString());
    });

    it('non-owner cannot mint', async () => {
        const res = await minter.send(
            alice.getSender(),
            { value: toNano('0.2') },
            { $$type: 'MolePinMint', queryId: 2n, amount: toNano('1'), receiver: alice.address },
        );
        // the mint message to minter must fail (owner guard)
        expect(res.transactions).toHaveTransaction({
            from: alice.address,
            to: minter.address,
            success: false,
        });
        const data = await minter.getGetJettonData();
        expect(data.totalSupply).toBe(0n);
    });

    it('mint cannot exceed max supply', async () => {
        const res = await minter.send(
            deployer.getSender(),
            { value: toNano('0.2') },
            { $$type: 'MolePinMint', queryId: 3n, amount: MAX_SUPPLY + 1n, receiver: alice.address },
        );
        expect(res.transactions).toHaveTransaction({
            from: deployer.address,
            to: minter.address,
            success: false,
        });
        const data = await minter.getGetJettonData();
        expect(data.totalSupply).toBe(0n);
    });

    it('can mint exactly up to max supply', async () => {
        const res = await minter.send(
            deployer.getSender(),
            { value: toNano('0.3') },
            { $$type: 'MolePinMint', queryId: 4n, amount: MAX_SUPPLY, receiver: alice.address },
        );
        expect(res.transactions).toHaveTransaction({
            from: deployer.address,
            to: minter.address,
            success: true,
        });
        const data = await minter.getGetJettonData();
        expect(data.totalSupply).toBe(MAX_SUPPLY);
    });

    it('closeMinting stops further mints', async () => {
        await minter.send(
            deployer.getSender(),
            { value: toNano('0.1') },
            { $$type: 'MolePinCloseMinting', queryId: 5n },
        );
        const data1 = await minter.getGetJettonData();
        expect(data1.mintable).toBe(false);

        const res = await minter.send(
            deployer.getSender(),
            { value: toNano('0.2') },
            { $$type: 'MolePinMint', queryId: 6n, amount: toNano('1'), receiver: alice.address },
        );
        expect(res.transactions).toHaveTransaction({
            from: deployer.address,
            to: minter.address,
            success: false,
        });
        const data2 = await minter.getGetJettonData();
        expect(data2.totalSupply).toBe(0n);
    });

    it('holder can transfer to another wallet', async () => {
        const minted = toNano('1000');
        await minter.send(
            deployer.getSender(),
            { value: toNano('0.2') },
            { $$type: 'MolePinMint', queryId: 7n, amount: minted, receiver: alice.address },
        );

        const aliceWallet = await walletOf(alice.address);
        const sendAmt = toNano('300');

        const res = await aliceWallet.send(
            alice.getSender(),
            { value: toNano('0.2') },
            {
                $$type: 'JettonTransfer',
                queryId: 8n,
                amount: sendAmt,
                destination: bob.address,
                responseDestination: alice.address,
                customPayload: null,
                forwardTonAmount: 0n,
                forwardPayload: beginCell().endCell().beginParse(),
            },
        );

        expect(res.transactions).toHaveTransaction({ from: alice.address, to: aliceWallet.address, success: true });

        const aliceWd = await aliceWallet.getGetWalletData();
        expect(aliceWd.balance).toBe(minted - sendAmt);

        const bobWallet = await walletOf(bob.address);
        const bobWd = await bobWallet.getGetWalletData();
        expect(bobWd.balance).toBe(sendAmt);
    });

    it('burn reduces holder balance and total supply', async () => {
        const minted = toNano('1000');
        await minter.send(
            deployer.getSender(),
            { value: toNano('0.2') },
            { $$type: 'MolePinMint', queryId: 9n, amount: minted, receiver: alice.address },
        );

        const aliceWallet = await walletOf(alice.address);
        const burnAmt = toNano('400');

        const res = await aliceWallet.send(
            alice.getSender(),
            { value: toNano('0.2') },
            {
                $$type: 'JettonBurn',
                queryId: 10n,
                amount: burnAmt,
                responseDestination: alice.address,
                customPayload: null,
            },
        );

        // burn notification reaches minter successfully
        expect(res.transactions).toHaveTransaction({ to: minter.address, success: true });

        const aliceWd = await aliceWallet.getGetWalletData();
        expect(aliceWd.balance).toBe(minted - burnAmt);

        const data = await minter.getGetJettonData();
        expect(data.totalSupply).toBe(minted - burnAmt);
    });
});
