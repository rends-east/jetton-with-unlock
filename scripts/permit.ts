import { Address, beginCell, Cell, fromNano, OpenedContract, toNano, } from '@ton/core';
import { compile, sleep, NetworkProvider, UIProvider, } from '@ton/blueprint';
import { JettonWallet, } from '../wrappers/JettonWallet';
import { promptBool, promptAmount, promptAddress, displayContentCell, waitForTransaction, promptUrl, } from '../wrappers/utils';
import { mnemonicToWalletKey, KeyPair } from '@ton/crypto';
let jettonWalletContract: OpenedContract<JettonWallet>;
let walletAddress: Address;
let treasuryAddress: Address;


const permitAction = async (provider: NetworkProvider, ui: UIProvider) => {
    const sender = provider.sender();
    let retry: boolean;
    let mintAmount: string;

    do {
        retry = false;
        mintAmount = await promptAmount('Please provide mint amount in decimal form:', ui);
        ui.write(`Mint ${mintAmount} tokens to ${walletAddress}\n`);
        retry = !(await promptBool('Is it ok?(yes/no)', ['yes', 'no'], ui));
    } while (retry);

    ui.write(`Minting ${mintAmount} to ${walletAddress}\n`);
    const nanoAmount = toNano(mintAmount);
    
    const lastSeqno = (await provider.api().getLastBlock()).last.seqno;
    const curState = (await provider.api().getAccountLite(lastSeqno, jettonWalletContract.address)).account;

    if (curState.last === null)
        throw ("Last transaction can't be null on deployed contract");

    const mnemonic : string = String(process.env.WALLET_MNEMONIC);
    const key : KeyPair = await mnemonicToWalletKey(mnemonic.split(" "));
    let privKey = key.secretKey;
    const res = await jettonWalletContract.sendPermit(sender,
        toNano(1),
        10n,
        walletAddress,
        1n,
        treasuryAddress,
        0,
        privKey);
    const gotTrans = await waitForTransaction(provider,
        jettonWalletContract.address,
        curState.last.lt,
        10);
    // if (gotTrans) {
    //     const supplyAfter = await jettonWalletContract.getTotalSupply();
    //     if (supplyAfter == supplyBefore + nanoAmount) {
    //         ui.write("Mint successfull!\nCurrent supply:" + fromNano(supplyAfter));
    //     }
    //     else {
    //         ui.write("Mint failed!");
    //     }
    // }
    // else {
    //     failedTransMessage(ui);
    // }
}

export async function run(provider: NetworkProvider) {
    const ui = provider.ui();
    const sender = provider.sender();
    const hasSender = sender.address !== undefined;
    const api = provider.api()
    const jettonCode = await compile('JettonWallet');
    let done = false;
    let retry: boolean;

    do {
        retry = false;
        walletAddress = await promptAddress('Введи адрес жетон-волета:', ui);
        const isContractDeployed = await provider.isContractDeployed(walletAddress);
        if (!isContractDeployed) {
            retry = true;
            ui.write("This contract is not active!\nPlease use another address, or deploy it first");
        }
        else {
            const lastSeqno = (await api.getLastBlock()).last.seqno;
            const contractState = (await api.getAccount(lastSeqno, walletAddress)).account.state as {
                data: string | null;
                code: string | null;
                type: "active";
            };
            if (!(Cell.fromBase64(contractState.code as string)).equals(minterICOCode)) {
                ui.write("Contract code differs from the current contract version!\n");
                const resp = await ui.choose("Use address anyway", ["Yes", "No"], (c) => c);
                retry = resp == "No";
            }
        }
    } while (retry);

    jettonWalletContract = provider.open(JettonWallet.createFromAddress(walletAddress));
    let actionList: string[] = ['Permit', 'Quit'];

    do {
        const action = await ui.choose("Pick action:", actionList, (c) => c);
        switch (action) {
            case 'Permit':
                await permitAction(provider, ui);
                break;
            case 'Quit':
                done = true;
                break;
        }
    } while (!done);
}