import { Address, beginCell, Cell, fromNano, OpenedContract, toNano, } from '@ton/core';
import { compile, sleep, NetworkProvider, UIProvider, } from '@ton/blueprint';
import { JettonMinter, jettonContentToCell, } from '../wrappers/JettonMinter';
import { promptBool, promptAmount, promptAddress, displayContentCell, waitForTransaction, promptUrl, } from '../wrappers/utils';
let minterContract: OpenedContract<JettonMinter>;

const adminActions = ['Mint', 'Change admin', 'Change content'];
const userActions  = ['Info', 'Quit'];

const failedTransMessage = (ui: UIProvider) => {
    ui.write("Failed to get indication of transaction completion from API!\nCheck result manually, or try again\n");
};

const infoAction = async (provider: NetworkProvider, ui: UIProvider) => {
    const jettonData = await minterContract.getJettonData();
    ui.write("Jetton info:\n\n");
    ui.write(`Admin: ${jettonData.adminAddress}\n`);
    ui.write(`Total supply: ${fromNano(jettonData.totalSupply)}\n`);
    ui.write(`Mintable: ${jettonData.mintable}\n`);
    const displayContent = await ui.choose('Display content?', ['Yes', 'No'], (c) => c);
    if (displayContent == 'Yes') {
        displayContentCell(jettonData.content, ui);
    }
};

const changeAdminAction = async (provider: NetworkProvider, ui: UIProvider) => {
    let retry: boolean;
    let newAdmin: Address;
    let curAdmin = await minterContract.getAdminAddress();
    do {
        retry = false;
        newAdmin = await promptAddress('Please specify new admin address:', ui);
        if (newAdmin.equals(curAdmin)) {
            retry = true;
            ui.write("Address specified matched current admin address!\nPlease pick another one.\n");
        }
        else {
            ui.write(`New admin address is going to be: ${newAdmin}\nKindly double check it!\n`);
            retry = !(await promptBool('Is it ok?(yes/no)', ['yes', 'no'], ui));
        }
    } while (retry);

    const lastSeqno = (await provider.api().getLastBlock()).last.seqno;
    const curState = (await provider.api().getAccountLite(lastSeqno, minterContract.address)).account;

    if (curState.last === null)
        throw ("Last transaction can't be null on deployed contract");

    await minterContract.sendChangeAdmin(provider.sender(), newAdmin);
    const transDone = await waitForTransaction(provider,
        minterContract.address,
        curState.last.lt,
        10);
    if (transDone) {
        const adminAfter = await minterContract.getAdminAddress();
        if (adminAfter.equals(newAdmin)) {
            ui.write("Admin changed successfully");
        } else {
            ui.write("Admin address hasn't changed!\nSomething went wrong!\n");
        }
    } else {
        failedTransMessage(ui);
    }
};

const changeContentAction = async (provider: NetworkProvider, ui: UIProvider) => {
    let retry: boolean;
    let newContent: string;
    let curContent = await minterContract.getContent();
    do {
        retry = false;
        newContent = await promptUrl('Please specify new content:', ui);
        if (curContent.equals(jettonContentToCell({ type: 1, uri: newContent }))) {
            retry = true;
            ui.write("URI specified matched current content!\nPlease pick another one.\n");
        } else {
            ui.write(`New content is going to be: ${newContent}\nKindly double check it!\n`);
            retry = !(await promptBool('Is it ok?(yes/no)', ['yes', 'no'], ui));
        }
    } while (retry);

    const lastSeqno = (await provider.api().getLastBlock()).last.seqno;
    const curState = (await provider.api().getAccountLite(lastSeqno, minterContract.address)).account;

    if (curState.last === null)
        throw ("Last transaction can't be null on deployed contract");

    await minterContract.sendChangeContent(provider.sender(), jettonContentToCell({ type: 1, uri: newContent }));
    const transDone = await waitForTransaction(provider,
        minterContract.address,
        curState.last.lt,
        10);
    if (transDone) {
        const contentAfter = await minterContract.getContent();
        if (contentAfter.equals(jettonContentToCell({ type: 1, uri: newContent }))) {
            ui.write("Content changed successfully");
        } else {
            ui.write("Content hasn't changed!\nSomething went wrong!\n");
        }
    } else {
        failedTransMessage(ui);
    }
};


const mintAction = async (provider:NetworkProvider, ui:UIProvider) => {
    const sender = provider.sender();
    let retry:boolean;
    let mintAddress:Address;
    let mintAmount:string;
    let forwardAmount:string;

    do {
        retry = false;
        const fallbackAddr = sender.address ?? await minterContract.getAdminAddress();
        mintAddress = await promptAddress(`Please specify address to mint to`, ui, fallbackAddr);
        mintAmount  = await promptAmount('Please provide mint amount in decimal form:', ui);
        ui.write(`Mint ${mintAmount} tokens to ${mintAddress}\n`);
        retry = !(await promptBool('Is it ok?(yes/no)', ['yes', 'no'], ui));
    } while(retry);

    ui.write(`Minting ${mintAmount} to ${mintAddress}\n`);
    const supplyBefore = await minterContract.getTotalSupply();
    const nanoMint     = toNano(mintAmount);

    const res = await minterContract.sendMint(sender,
                                              mintAddress,
                                              nanoMint,
                                              toNano('0.05'),
                                              toNano('0.1'));
}


export async function run(provider: NetworkProvider) {
    const ui = provider.ui();
    const sender = provider.sender();
    const hasSender = sender.address !== undefined;
    const api = provider.api()
    const minterCode = await compile('JettonMinter');
    let done = false;
    let retry: boolean;
    let minterAddress: Address;

    do {
        retry = false;
        minterAddress = await promptAddress('Please enter jetton-master address:', ui);
        const isContractDeployed = await provider.isContractDeployed(minterAddress);
        if (!isContractDeployed) {
            retry = true;
            ui.write("This contract is not active!\nPlease use another address, or deploy it first");
        }
        else {
            const lastSeqno = (await api.getLastBlock()).last.seqno;
            const contractState = (await api.getAccount(lastSeqno, minterAddress)).account.state as {
                data: string | null;
                code: string | null;
                type: "active";
            };
            if (!(Cell.fromBase64(contractState.code as string)).equals(minterCode)) {
                ui.write("Contract code differs from the current contract version!\n");
                const resp = await ui.choose("Use address anyway", ["Yes", "No"], (c) => c);
                retry = resp == "No";
            }
        }
    } while (retry);

    minterContract = provider.open(JettonMinter.createFromAddress(minterAddress));
    const isAdmin = hasSender ? (await minterContract.getAdminAddress()).equals(sender.address) : true;
    let actionList: string[];
    if (isAdmin) {
        actionList = [...adminActions, ...userActions];
        ui.write("Current wallet is jetton admin!\n");
    }
    else {
        actionList = userActions;
        ui.write("Current wallet is not admin!\nAvaliable actions restricted\n");
    }

    do {
        const action = await ui.choose("Pick action:", actionList, (c) => c);
        switch (action) {
            case 'Mint':
                await mintAction(provider, ui);
                break;
            case 'Change admin':
                await changeAdminAction(provider, ui);
                break;
            case 'Change content':
                await changeContentAction(provider, ui);
                break;
            case 'Info':
                await infoAction(provider, ui);
                break;
            case 'Quit':
                done = true;
                break;
        }
    } while (!done);
}