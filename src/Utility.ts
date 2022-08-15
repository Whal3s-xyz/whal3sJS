import {API_URL} from "./env";
import Web3 from "web3";

type CallbackFunctionVariadic = (...args: any[]) => void;

interface Event {
    listeners: CallbackFunctionVariadic [];
}

interface EventArray {
    [key: string]: Event;
}

export default class Utility {

    apiToken: string;
    selectedAccount: any;
    nftContract: any | undefined;
    isInitialized = false;
    config: any
    web3: Web3 | undefined
    provider: any | undefined
    events: EventArray
    selectedAccountIsValid = false
    private id: string;

    constructor(id: string, apiToken: string = '') {
        this.id = id
        this.apiToken = apiToken
        this.events = {};
    }

    async init() {
        console.log('init')
        try {
            const config = await this.fetchConfig()
            this.config = config[Object.keys(config)[0]]
            this.dispatch('initialized')
        } catch (error) {
            if (typeof error === "string") {
                this.dispatch('initializationFailed', error)
            } else if (error instanceof Error) {
                this.dispatch('initializationFailed', error.message)

            }
        }


    }

    async switchNetwork(chainId: string) {
        let hexChainId
        if (this.web3?.utils.isHexStrict(chainId)) {
            hexChainId = chainId
        } else {
            hexChainId = this.web3?.utils.toHex(chainId)
        }
        try {

            await this.provider.request({
                method: 'wallet_switchEthereumChain',
                params: [{chainId: hexChainId}],
            });
            this.dispatch('networkSwitch')

        } catch (error) {


            if (typeof error === "string") {
                this.dispatch('networkSwitchFailed', error)
            } else if (error instanceof Error) {
                this.dispatch('networkSwitchFailed', error.message)
                // The network has not been added to MetaMask
                // if (error.code === 4902) {
                //     console.log("Please add the network to MetaMask")
                // }
                // console.log("Cannot switch to the network")
            }


        }


    }

    async connectWallet() {

        this.provider = (window as any).ethereum;
        if (typeof this.provider !== 'undefined') {

            this.provider
                .request({method: 'eth_requestAccounts'})
                .then((accounts: any) => {
                    this.setSelectedAccount(accounts[0])
                })
                .catch((error: unknown) => {
                    if (typeof error === "string") {
                        this.dispatch('walletError', error)
                    } else if (error instanceof Error) {
                        this.dispatch('walletError', error.message)

                    }
                    return;
                });
            let that = this;
            (window as any).ethereum.on('accountsChanged', function (accounts: any[]) {
                that.setSelectedAccount(accounts[0])
            });
        }
        this.web3 = new Web3(this.provider);
        const networkId = await this.web3.eth.net.getId();
        if (networkId !== this.config.chainId)
            await this.switchNetwork(this.config.chainId)

        this.nftContract = new this.web3.eth.Contract(JSON.parse(this.config.abi), this.config.contractAddress);
        this.isInitialized = true;
    }

    async performAction() {
        console.log('performAction')
        if (!this.isInitialized) {
            await this.init();
        }

        console.log(this.config.parameters)
        const txBuilder = await (this.nftContract?.methods[this.config.method](this.config.parameters));
        const gasAmount = await txBuilder.estimateGas({from: this.selectedAccount});
        const gasPrice = await this.web3?.eth.getGasPrice();

        const that = this
        txBuilder.send({
            from: this.selectedAccount,
            gasPrice: gasPrice, // customizable by user during MetaMask confirmation.
            gas: Number((gasAmount * 1.10).toFixed(0)), // customi
        })
            .once('sending', function (payload: any) {
                that.dispatch('sending', payload)
            })
            .once('sent', function (payload: any) {
                that.dispatch('sent', payload)
            })
            .once('transactionHash', function (hash: string) {
                that.createTransactionEngagement(hash)
                console.log('got transaction hash')
                that.dispatch('transactionHash', hash)
            })
            .once('receipt', function (receipt: any) {
                that.dispatch('receipt', receipt)
            })
            .on('confirmation', function (confNumber: any, receipt: any, latestBlockHash: string) {
                that.dispatch('confirmation', {confNumber, receipt, latestBlockHash})
            })
            .on('error', function (error: any) {
                that.dispatch('error', error)
            })
            .then(function (receipt: any) {
                that.dispatch('done', receipt)
            });


    }


    addEventListener(event: string, callback: CallbackFunctionVariadic) {
        // Check if the callback is not a function
        if (typeof callback !== 'function') {
            console.error(`The listener callback must be a function, the given type is ${typeof callback}`);
            return false;
        }
        // Check if the event is not a string
        if (typeof event !== 'string') {
            console.error(`The event name must be a string, the given type is ${typeof event}`);
            return false;
        }

        // Create the event if not exists

        if (this.events[event] === undefined) {
            this.events[event] = {
                listeners: []
            };
        }
        this.events[event].listeners.push(callback);
        return true
    }

    removeEventListener(event: string, callback: CallbackFunctionVariadic): boolean {
        // Check if this event not exists

        if (this.events[event] === undefined) {
            console.error(`This event: ${event} does not exist`);
            return false;
        }

        this.events[event].listeners = this.events[event].listeners.filter(listener => {
            return listener.toString() !== callback.toString();
        });
        return true
    }

    dispatch(event: string, details: any = null): boolean {
        // Check if this event not exists

        if (this.events[event] === undefined) {
            // console.error(`This event: ${event} does not exist`);
            return false;
        }

        this.events[event].listeners.forEach((fn: (details: any) => void) => {
            fn(details);
        });
        return true
    }

    async fetchConfig() {
        const configReponse = await fetch(`${API_URL}utility/${this.id}/config`)
        const config = await configReponse.json();
        return config;
    }

    async fetchEngagements() {
        const engagementReponse = await fetch(`${API_URL}utility/${this.id}/engagements`)
        const engagements = await engagementReponse.json();
        return engagements;
    }

    async validateWalletAddress(walletAddress = this.selectedAccount) {
        const validateReponse = await fetch(`${API_URL}utility/${this.id}/validate/wallet?wallet_address=${walletAddress}`)
        const validate = await validateReponse.json();
        return validate;

    }

    createTransactionEngagement(transactionHash: string) {
        let xhr = new XMLHttpRequest();
        xhr.open("POST", `${API_URL}utility/${this.id}/engagements`);

        xhr.setRequestHeader("Accept", "application/json");
        xhr.setRequestHeader("Content-Type", "application/json");

        xhr.onload = () => console.log(xhr.responseText);

        let data = {
            "type": "transaction",
            "transaction_hash": transactionHash
        }

        console.log(JSON.stringify(data))
        xhr.send(JSON.stringify(data));
    }

    setSelectedAccount(account: string) {
        this.selectedAccount = account
        console.log(`Selected account changed to ${this.selectedAccount}`);
        this.validateWalletAddress(account).then((response) => this.selectedAccountIsValid = response.valid)
    }
}

