import { toNano, Address } from '@ton/core';
import { MolePinJettonMinter } from '../build/MolePinJetton/MolePinJetton_MolePinJettonMinter';
import { MolePinJettonWallet } from '../build/MolePinJetton/MolePinJetton_MolePinJettonWallet';
import { NetworkProvider } from '@ton/blueprint';

// ─────────────────────────────────────────────────────────────────────────────
// MolePinJetton — testnet MINT 스크립트
// 이미 배포된 Minter에 fromAddress 로 연결해서 owner 가 토큰을 발행한다.
// (owner = .env 니모닉 지갑. mint 는 owner 만 가능하도록 컨트랙트에 가드돼 있음)
//
// 사용법: npx blueprint run  →  mintMol  →  testnet  →  Mnemonic
// 발행 후 tonscan 에서 Total supply 증가 + Holders 에 wallet 생성 확인.
// ─────────────────────────────────────────────────────────────────────────────

// ★ 배포된 Minter 주소 (deploy 출력의 "deployed at" — bounceable EQ.. 형식)
const MINTER_ADDRESS = 'EQBeUlFobJcMr6Lf8KcSXWn7APxfMKEYX9j_rZsCm1qzKEVn';

// 발행량: 1,000,000 MOL (decimals 9). 필요하면 숫자만 바꾸면 됨.
const MINT_AMOUNT = 1_000_000n * 1_000_000_000n;

export async function run(provider: NetworkProvider) {
    const sender = provider.sender();
    const ownerAddress = sender.address!; // 이 지갑이 Minter의 owner여야 함

    const minter = provider.open(
        MolePinJettonMinter.fromAddress(Address.parse(MINTER_ADDRESS)),
    );

    // 발행 전 상태
    const before = await minter.getGetJettonData();
    console.log('── before mint ──');
    console.log('  totalSupply:', before.totalSupply.toString());
    console.log('  owner      :', before.owner.toString());
    console.log('  보내는 지갑 :', ownerAddress.toString());

    // owner 가드: 보내는 지갑이 owner와 다르면 mint는 컨트랙트에서 실패함.
    if (before.owner.toString() !== ownerAddress.toString()) {
        console.warn('⚠️  보내는 지갑이 owner와 다릅니다. mint가 컨트랙트에서 거부될 수 있습니다.');
    }

    // 수신자 = owner 자신에게 발행 (테스트). 다른 주소로 주고 싶으면 receiver 변경.
    const receiver = ownerAddress;

    console.log(`\nMinting ${MINT_AMOUNT.toString()} (raw, =${MINT_AMOUNT / 1_000_000_000n} MOL) to`, receiver.toString());

    await minter.send(
        sender,
        { value: toNano('0.2') }, // mint + wallet 배포 가스 (테스트는 0.2 TON 여유)
        { $$type: 'MolePinMint', queryId: 1n, amount: MINT_AMOUNT, receiver },
    );

    // 비동기라 잠깐 대기 후 상태 확인 (TON은 메시지가 몇 블록에 걸쳐 처리됨)
    console.log('\n발행 트랜잭션 전송됨. 체인 반영까지 10~30초 대기...');
    await new Promise((r) => setTimeout(r, 15000));

    const after = await minter.getGetJettonData();
    console.log('\n── after mint ──');
    console.log('  totalSupply:', after.totalSupply.toString());

    // receiver의 jetton wallet 주소 + 잔고 확인
    const walletAddr = await minter.getGetWalletAddress(receiver);
    console.log('  receiver wallet:', walletAddr.toString());
    try {
        const wallet = provider.open(MolePinJettonWallet.fromAddress(walletAddr));
        const wd = await wallet.getGetWalletData();
        console.log('  wallet balance :', wd.balance.toString());
    } catch (e) {
        console.log('  (wallet 아직 미반영 — tonscan에서 잠시 후 확인하세요)');
    }

    console.log('\ntonscan에서 확인:');
    console.log(`  https://testnet.tonscan.org/address/${MINTER_ADDRESS}`);
    console.log('  → Total supply 증가 + Holders 탭에 wallet 생성 확인');
}
