import { mnemonicToPrivateKey } from '@ton/crypto';
import { WalletContractV5R1, WalletContractV4, WalletContractV3R2 } from '@ton/ton';

// ─────────────────────────────────────────────────────────────────────────────
// 지갑 주소 진단 스크립트
// 같은 니모닉이라도 (버전 / workchain / networkGlobalId / subwalletNumber)에 따라
// 주소가 달라진다. 이 스크립트는 여러 조합의 주소를 출력해서,
// Tonkeeper가 보여주는 주소(0QBDp4...s6oY8nr)와 일치하는 설정을 찾는다.
//
// 사용법:
//   1) 이 파일을 scripts/diagnoseWallet.ts 로 저장
//   2) .env 의 WALLET_MNEMONIC 을 읽도록 되어 있음 (니모닉은 .env 에만, 절대 코드에 X)
//   3) npx blueprint run  →  diagnoseWallet 선택  →  아무 네트워크나 (계산만 함)
//      또는: npx ts-node scripts/diagnoseWallet.ts  (blueprint 없이 직접)
//
// 출력된 주소들 중 Tonkeeper testnet 주소(0QBDp4...s6oY8nr)와 일치하는 줄을 찾으면,
// 그 설정(networkGlobalId / subwalletNumber 등)을 .env 에 넣으면 된다.
// ─────────────────────────────────────────────────────────────────────────────

import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
    const mnemonicStr = process.env.WALLET_MNEMONIC;
    if (!mnemonicStr) {
        console.error('❌ .env 에 WALLET_MNEMONIC 이 없습니다.');
        process.exit(1);
    }
    const mnemonic = mnemonicStr.trim().split(/\s+/);
    console.log(`니모닉 단어 수: ${mnemonic.length} (24개여야 정상)\n`);

    const keyPair = await mnemonicToPrivateKey(mnemonic);

    const TESTNET = -3;
    const MAINNET = -239;

    console.log('찾는 목표 (Tonkeeper):');
    console.log('  testnet: 0QBDp4RBMGrflMciMyKEd8Js93gXoC0blgCVaoXY-s6oY8nr');
    console.log('  mainnet: UQBDp4RBMGrflMciMyKEd8Js93gXoC0blgCVaoXY-s6oY3Jh');
    console.log('  (※ 0Q=testnet bounceable, UQ=mainnet non-bounceable 표기)\n');
    console.log('─'.repeat(70));

    // ── V5R1, subwalletNumber 0~3, testnet & mainnet, workchain 0 ──
    for (const netId of [TESTNET, MAINNET]) {
        const netName = netId === TESTNET ? 'testnet' : 'mainnet';
        for (const sub of [0, 1, 2, 3]) {
            const w = WalletContractV5R1.create({
                walletId: { networkGlobalId: netId, workChain: 0, subwalletNumber: sub } as any,
                publicKey: keyPair.publicKey,
                workchain: 0,
            } as any);
            // 두 가지 표기로 출력
            const testBounce = w.address.toString({ testOnly: true, bounceable: true });
            const testNon = w.address.toString({ testOnly: true, bounceable: false });
            const mainNon = w.address.toString({ testOnly: false, bounceable: false });
            console.log(`V5R1 net=${netName} sub=${sub}`);
            console.log(`   testnet(0Q): ${testBounce}`);
            console.log(`   testnet(0U): ${testNon}`);
            console.log(`   mainnet(UQ): ${mainNon}`);
        }
    }

    console.log('─'.repeat(70));

    // ── V4R2 (workchain 0) — 혹시 Tonkeeper가 v4를 썼을 경우 대비 ──
    const v4 = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey });
    console.log(`V4R2  testnet(0Q): ${v4.address.toString({ testOnly: true, bounceable: true })}`);
    console.log(`V4R2  testnet(0U): ${v4.address.toString({ testOnly: true, bounceable: false })}`);
    console.log(`V4R2  mainnet(UQ): ${v4.address.toString({ testOnly: false, bounceable: false })}`);

    console.log('─'.repeat(70));
    console.log('\n👉 위 목록에서 0QBDp4...s6oY8nr 와 일치하는 줄을 찾으세요.');
    console.log('   그 줄의 설정(버전/net/sub)을 .env 에 반영하면 owner가 그 주소가 됩니다.');
}

main().catch(console.error);