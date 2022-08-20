import {API_URL} from './env';
import Web3 from 'web3';

type CallbackFunctionVariadic = (...args: any[]) => void;

interface Event {
    listeners: CallbackFunctionVariadic[];
}

interface EventArray {
    [key: string]: Event;
}

export default class Utility {
    apiToken: string;
    selectedAccount: any;
    nftContract: any | undefined;
    isInitialized = false;
    config: any;
    web3: Web3 | undefined;
    provider: any | undefined;
    events: EventArray;
    selectedAccountIsValid = false;
    private id: string;
    apiUrl: string;
    private debug: boolean;
    engagementsCount: number = 0
    maxEngagements: number | null = null
    maxEngagementsPerWallet: number | null = null

    constructor(
        id: string,
        apiToken: string = '',
        apiUrl: string = API_URL,
        debug: boolean = false
    ) {
        this.id = id;
        this.apiToken = apiToken;
        this.apiUrl = apiUrl;
        this.debug = debug;
        this.events = {};
    }

    async init() {
        try {
            const info = await this.fetchInfo();
            this.engagementsCount = info.engagements
            this.maxEngagements = info.maxEngagements
            this.maxEngagementsPerWallet = info.maxEngagementsPerWallet
            this.config = await this.fetchConfig();
            this.dispatch('initialized');
        } catch (error) {
            if (typeof error === 'string') {
                this.dispatch('initializationFailed', error);
            } else if (error instanceof Error) {
                this.dispatch('initializationFailed', error.message);
            }
        }
    }

    async switchNetwork(chainId: string) {
        let hexChainId;
        if (this.web3?.utils.isHexStrict(chainId)) {
            hexChainId = chainId;
        } else {
            hexChainId = this.web3?.utils.toHex(chainId);
        }
        try {
            await this.provider.request({
                method: 'wallet_switchEthereumChain',
                params: [{chainId: hexChainId}],
            });
            this.dispatch('networkSwitch');
        } catch (error) {
            if (typeof error === 'string') {
                this.dispatch('networkSwitchFailed', error);
            } else if (error instanceof Error) {
                this.dispatch('networkSwitchFailed', error.message);
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
                    this.setSelectedAccount(accounts[0]);
                })
                .catch((error: unknown) => {
                    if (typeof error === 'string') {
                        this.dispatch('walletError', error);
                    } else if (error instanceof Error) {
                        this.dispatch('walletError', error.message);
                    }
                    return;
                });
            let that = this;
            (window as any).ethereum.on(
                'accountsChanged',
                function (accounts: any[]) {
                    that.setSelectedAccount(accounts[0]);
                }
            );
        }
        this.web3 = new Web3(this.provider);
        const networkId = await this.web3.eth.net.getId();
        if (networkId !== this.config.chainId)
            await this.switchNetwork(this.config.chainId);

        if (this.config.type === 'SMART_CONTRACT_INTERACTION') {
            this.nftContract = new this.web3.eth.Contract(
                this.config.abi,
                this.config.contractAddress
            );
        }

        this.isInitialized = true;
    }

    async performAction() {
        if (this.debug) console.log('performAction');

        if (!this.isInitialized) {
            await this.init();
        }

        if (this.config.type === 'TRANSACTION') {
            const that = this;
            const transactionObject = {
                from: this.selectedAccount,
                to: this.config.toAddress,
                value: this.config.value,
                common: {
                    customChain: {
                        networkId: this.config.chainId,
                        chainId: this.config.chainId,
                    },
                },
            }
            const gasAmount = await this.web3?.eth.estimateGas(transactionObject)
            const gasPrice = await this.web3?.eth.getGasPrice();

            this.web3?.eth
                ?.sendTransaction({
                    ...transactionObject,
                    gasPrice: gasPrice, // customizable by user during MetaMask confirmation.
                    gas: Number(((gasAmount ?? 500) * 1.1).toFixed(0)), // customi
                })
                .once('sending', function (payload: any) {
                    that.dispatch('sending', payload);
                })
                .once('sent', function (payload: any) {
                    that.dispatch('sent', payload);
                })
                .once('transactionHash', function (hash: string) {
                    that.createTransactionEngagement(hash);
                    if (that.debug) console.log('got transaction hash');
                    that.dispatch('transactionHash', hash);
                })
                .once('receipt', function (receipt: any) {
                    that.dispatch('receipt', receipt);
                })
                .on('confirmation', function (confNumber: any, receipt: any) {
                    that.dispatch('confirmation', {confNumber, receipt});
                })
                .on('error', function (error: any) {
                    that.dispatch('error', error);
                })
                .then(function (receipt: any) {
                    that.dispatch('done', receipt);
                }).catch((error) => {
                if (this.debug)
                    console.log(error)
                if (error.code === 3)
                    that.dispatch('notEnoughFunds', error);
            });
        } else if (this.config.type === 'SMART_CONTRACT_INTERACTION') {
            const formattedParams = this.mapParamsToContractMethod(
                this.config.parameters,
                this.config.method
            );

            if (this.debug) console.log('builing transaction')
            let txBuilder;
            try{
                txBuilder = await this.nftContract?.methods[this.config.method](
                    ...formattedParams
                );
            } catch (error) {
                if (this.debug) console.log(error)
                this.dispatch('transactionBuildingError', error)
                return;
            }

            if (this.debug) console.log('estimate gas amount')
            let gasAmount;
            try{
                gasAmount = await txBuilder.estimateGas({
                    from: this.selectedAccount,
                    gas: 9950000
                })
            } catch (error) {
                if (this.debug) console.log(error)
                this.dispatch('estimateGasError', error)
                return;
            }


            if (this.debug) console.log('estimate gas price')
            let gasPrice;
            try{
                gasPrice = await this.web3?.eth.getGasPrice();
            } catch (error) {
                if (this.debug) console.log(error)
                this.dispatch('gasPriceError', error)
                return;
            }

            const that = this;
            txBuilder
                .send({
                    from: this.selectedAccount,
                    gasPrice: gasPrice, // customizable by user during MetaMask confirmation.
                    gas: Number((gasAmount * 1.1).toFixed(0)), // customi
                })
                .once('sending', function (payload: any) {
                    that.dispatch('sending', payload);
                })
                .once('sent', function (payload: any) {
                    that.dispatch('sent', payload);
                })
                .once('transactionHash', function (hash: string) {
                    that.createTransactionEngagement(hash);
                    if (that.debug) console.log('got transaction hash');
                    that.dispatch('transactionHash', hash);
                })
                .once('receipt', function (receipt: any) {
                    that.dispatch('receipt', receipt);
                })
                .on(
                    'confirmation',
                    function (confNumber: any, receipt: any, latestBlockHash: string) {
                        that.dispatch('confirmation', {
                            confNumber,
                            receipt,
                            latestBlockHash,
                        });
                    }
                )
                .on('error', function (error: Error) {
                    that.dispatch('error', error);
                })
                .then(function (receipt: any) {
                    that.dispatch('done', receipt);
                })
                .catch((error: unknown) => {
                    if(this.debug)console.log(error)
                    if (typeof error === 'string') {
                        this.dispatch('walletError', error);
                    } else if (error instanceof Error) {
                        this.dispatch('walletError', error.message);
                    }

                });


        } else {
            this.dispatch('invalidAction');
        }
    }

    addEventListener(event
                         :
                         string, callback
                         :
                         CallbackFunctionVariadic
    ) {
        // Check if the callback is not a function
        if (typeof callback !== 'function') {
            console.error(
                `The listener callback must be a function, the given type is ${typeof callback}`
            );
            return false;
        }
        // Check if the event is not a string
        if (typeof event !== 'string') {
            console.error(
                `The event name must be a string, the given type is ${typeof event}`
            );
            return false;
        }

        // Create the event if not exists

        if (this.events[event] === undefined) {
            this.events[event] = {
                listeners: [],
            };
        }
        this.events[event].listeners.push(callback);
        return true;
    }

    removeEventListener(
        event
            :
            string,
        callback
            :
            CallbackFunctionVariadic
    ):
        boolean {
        // Check if this event not exists

        if (this.events[event] === undefined) {
            console.error(`This event: ${event} does not exist`);
            return false;
        }

        this.events[event].listeners = this.events[event].listeners.filter(
            (listener) => {
                return listener.toString() !== callback.toString();
            }
        );
        return true;
    }

    dispatch(event: string, details: any = null):
        boolean {
        // Check if this event not exists

        if (this.events[event] === undefined) {
            // console.error(`This event: ${event} does not exist`);
            return false;
        }

        this.events[event].listeners.forEach((fn: (details: any) => void) => {
            fn(details);
        });
        return true;
    }

    async fetchInfo() {
        const apiUrl = this.apiUrl;
        const infoReponse = await fetch(`${apiUrl}utility/${this.id}`);
        const info = await infoReponse.json();
        return info;
    }

    async fetchConfig() {
        const apiUrl = this.apiUrl;
        const configReponse = await fetch(`${apiUrl}utility/${this.id}/config`);
        const config = await configReponse.json();
        return config;
    }

    async fetchEngagements() {
        const apiUrl = this.apiUrl;
        const engagementReponse = await fetch(
            `${apiUrl}utility/${this.id}/engagements`
        );
        const engagements = await engagementReponse.json();
        return engagements;
    }

    async validateWalletAddress(walletAddress = this.selectedAccount) {
        const apiUrl = this.apiUrl;
        const validateReponse = await fetch(
            `${apiUrl}utility/${this.id}/validate/wallet?wallet_address=${walletAddress}`
        );
        const validate = await validateReponse.json();
        return validate;
    }

    createTransactionEngagement(transactionHash
                                    :
                                    string
    ) {
        let xhr = new XMLHttpRequest();
        const apiUrl = this.apiUrl;
        xhr.open('POST', `${apiUrl}utility/${this.id}/engagements`);

        xhr.setRequestHeader('Accept', 'application/json');
        xhr.setRequestHeader('Content-Type', 'application/json');

        xhr.onload = () => console.log(xhr.responseText);

        let data = {
            type: 'transaction',
            transaction_hash: transactionHash,
        };

        if (this.debug) console.log(JSON.stringify(data));
        xhr.send(JSON.stringify(data));
    }

    setSelectedAccount(account
                           :
                           string
    ) {
        this.selectedAccount = account;
        if (this.debug)
            console.log(`Selected account changed to ${this.selectedAccount}`);
        this.validateWalletAddress(account).then(
            (response) => (this.selectedAccountIsValid = response.valid)
        );
    }

    getContractMethodParams(method: string) {
        if (!this.nftContract) return null;

        if (this.debug) console.log(this.nftContract.options);
        if (this.debug) console.log(this.nftContract.options.jsonInterface);
        const params = this.nftContract.options.jsonInterface.filter(
            (item: any) => item.name === method && item.type === 'function'
        );
        if (this.debug) console.log(params);
        return params[0];
    }

    mapParamsToContractMethod(params: any, method: string) {
        const that = this;
        const methodParams = this.getContractMethodParams(method)?.inputs;
        if (this.debug) console.log({methodParams: methodParams});
        const formattedParams = params.map(function (param: any, index: number) {
            if (methodParams[index]?.type === 'uint256')
                return that.web3?.utils.toBN(param);
            return param;
        });
        if (this.debug) console.log({formattedParams: formattedParams});
        return formattedParams;
    }

}
