import { toNano, Address } from '@ton/core';
import { MolePinJettonMinter } from '../build/MolePinJetton/MolePinJetton_MolePinJettonMinter';
import { MolePinJettonWallet } from '../build/MolePinJetton/MolePinJetton_MolePinJettonWallet';
import { NetworkProvider } from '@ton/blueprint';

// ─────────────────────────────────────────────────────────────────────────────
// MolePinJetton — testnet BURN 스크립트
// holder(=보내는 지갑)가 자신의 jetton wallet에서 토큰을 소각한다.
// burn은 wallet → minter로 BurnNotification이 가서 totalSupply가 줄어든다.
//
// 사용법: npx blueprint run  →  burnMol  →  testnet  →  Mnemonic
// 소각 후 tonscan에서 wallet 잔고 감소 + Minter의 Total supply 감소 확인.
//
// ※ 먼저 mintMol로 토큰이 있어야 burn 가능. (잔고보다 많이 burn하면 실패)
// ─────────────────────────────────────────────────────────────────────────────

// ★ 배포된 Minter 주소
const MINTER_ADDRESS = 'EQBLnuEoDNOpXF4DWEG9mRv6dB38-eiqE3gJFnDeZZrZoLN2';

// 소각량: 100,000 MOL (decimals 9). 잔고 이하로 설정.
const BURN_AMOUNT = 100_000n * 1_000_000_000n;

export async function run(provider: NetworkProvider) {
    const sender = provider.sender();
    const holderAddress = sender.address!;

    const minter = provider.open(
        MolePinJettonMinter.fromAddress(Address.parse(MINTER_ADDRESS)),
    );

    // holder의 jetton wallet 주소를 minter getter로 구함
    const walletAddr = await minter.getGetWalletAddress(holderAddress);
    const wallet = provider.open(MolePinJettonWallet.fromAddress(walletAddr));

    // 소각 전 상태
    const supplyBefore = (await minter.getGetJettonData()).totalSupply;
    let balanceBefore: bigint;
    try {
        balanceBefore = (await wallet.getGetWalletData()).balance;
    } catch {
        console.error('❌ holder의 wallet이 없습니다. 먼저 mintMol로 토큰을 발행하세요.');
        return;
    }

    console.log('── before burn ──');
    console.log('  holder        :', holderAddress.toString());
    console.log('  wallet        :', walletAddr.toString());
    console.log('  wallet balance:', balanceBefore.toString());
    console.log('  total supply  :', supplyBefore.toString());

    if (balanceBefore < BURN_AMOUNT) {
        console.error(`❌ 잔고(${balanceBefore})가 소각량(${BURN_AMOUNT})보다 적습니다.`);
        return;
    }

    console.log(`\nBurning ${BURN_AMOUNT.toString()} (raw, =${BURN_AMOUNT / 1_000_000_000n} MOL)...`);

    // burn은 holder의 wallet에 JettonBurn 메시지를 보냄 (gas 가드 위해 0.2 TON)
    await wallet.send(
        sender,
        { value: toNano('0.2') },
        {
            $$type: 'JettonBurn',
            queryId: 1n,
            amount: BURN_AMOUNT,
            responseDestination: holderAddress,
            customPayload: null,
        },
    );

    console.log('\n소각 트랜잭션 전송됨. 체인 반영까지 10~30초 대기...');
    await new Promise((r) => setTimeout(r, 15000));

    // 소각 후 상태
    const supplyAfter = (await minter.getGetJettonData()).totalSupply;
    console.log('\n── after burn ──');
    console.log('  total supply  :', supplyAfter.toString(), `(was ${supplyBefore.toString()})`);
    try {
        const balanceAfter = (await wallet.getGetWalletData()).balance;
        console.log('  wallet balance:', balanceAfter.toString(), `(was ${balanceBefore.toString()})`);
    } catch {
        console.log('  (wallet 조회 실패 — tonscan에서 확인)');
    }

    console.log('\ntonscan에서 확인:');
    console.log(`  https://testnet.tonscan.org/address/${MINTER_ADDRESS}`);
    console.log('  → Total supply 감소 확인');
}
