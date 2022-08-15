import Utility from "./Utility";
export default class Whal3s {

    apiToken: string;

    constructor(apiToken:string = '') {
        this.apiToken = apiToken
    }

    getUtility(utilityId: string) {
        console.log('getUtility')
        return new Utility(utilityId)
    }
    alert() {
        alert('This is Whal3s!!')
    }
}


