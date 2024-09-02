import 'dotenv/config';
import { address, toNano, } from '@ton/core';
import { JettonMinter, jettonContentToCell } from '../wrappers/JettonMinter';
import { compile, NetworkProvider } from '@ton/blueprint';
import { mnemonicToWalletKey, KeyPair } from '@ton/crypto';

export async function run(provider: NetworkProvider) {
    const admin = address(process.env.JETTON_ADMIN ? process.env.JETTON_ADMIN : "");
    const content = jettonContentToCell({ type: 1, uri: process.env.JETTON_CONTENT_URI ? process.env.JETTON_CONTENT_URI : "" });
    const wallet_code = await compile('JettonWallet');
    const mnemonic : string = String(process.env.WALLET_MNEMONIC);
    const key : KeyPair = await mnemonicToWalletKey(mnemonic.split(" "));
    const public_key = key.publicKey;
    const minter = provider.open(
        JettonMinter.createFromConfig(
            {
                admin,
                content,
                wallet_code,
                public_key
            },
            await compile('JettonMinter')
        )
    );

    await minter.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(minter.address);

    console.log('getTotalSupply', await minter.getTotalSupply());
}