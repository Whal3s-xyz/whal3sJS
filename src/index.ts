import Utility from './Utility';
import { API_URL } from './env';
export default class Whal3s {
  apiToken: string;
  apiUrl: string;
  debug: boolean;

  constructor(
    apiToken: string = '',
    apiUrl: string = API_URL,
    debug: boolean = false
  ) {
    this.apiToken = apiToken;
    this.apiUrl = apiUrl;
    this.debug = debug;
  }

  getUtility(utilityId: string) {
    return new Utility(utilityId, this.apiToken, this.apiUrl, this.debug);
  }
  alert() {
    alert('This is Whal3s!!');
  }
}
