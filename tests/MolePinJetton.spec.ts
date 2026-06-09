import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { toNano } from '@ton/core';
import { MolePinJetton } from '../build/MolePinJetton/MolePinJetton_MolePinJetton';
import '@ton/test-utils';

describe('MolePinJetton', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let molePinJetton: SandboxContract<MolePinJetton>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        molePinJetton = blockchain.openContract(await MolePinJetton.fromInit());

        deployer = await blockchain.treasury('deployer');

        const deployResult = await molePinJetton.send(
            deployer.getSender(),
            {
                value: toNano('0.05'),
            },
            null,
        );

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: molePinJetton.address,
            deploy: true,
            success: true,
        });
    });

    it('should deploy', async () => {
        // the check is done inside beforeEach
        // blockchain and molePinJetton are ready to use
    });
});
