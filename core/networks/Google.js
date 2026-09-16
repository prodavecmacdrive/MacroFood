import Network from './Network.js'

export default class Google extends Network {
    constructor(callback) {
        let exitApi = document.createElement('script');
        exitApi.type = 'text/javascript';
        exitApi.src = ['https://tpc.google', 'syndication.com/pagead/gadgets/html5/api/exitapi.js'].join('');
        
        setTimeout(() => {
            document.body.appendChild(exitApi);
        }, 100)
        
        super(callback);
    }

    openStore() {
        window.ExitApi ? window.ExitApi.exit() : window.top.open( this.getUrl() );
    }
}