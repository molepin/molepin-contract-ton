import { toNano } from '@ton/core';
import { MolePinJetton } from '../build/MolePinJetton/MolePinJetton_MolePinJetton';
import { NetworkProvider } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const molePinJetton = provider.open(await MolePinJetton.fromInit());

    await molePinJetton.send(
        provider.sender(),
        {
            value: toNano('0.05'),
        },
        null,
    );

    await provider.waitForDeploy(molePinJetton.address);

    // run methods on `molePinJetton`
}
