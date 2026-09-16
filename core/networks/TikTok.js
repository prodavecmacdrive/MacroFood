import Network from './Network.js'

export default class TikTok extends Network {
    constructor(callback) {
        let api = document.createElement('script');
        api.type = 'text/javascript';
        api.src = ['https://sf16-muse-va.ibyte', 'dtos.com/obj/union-fe-nc-i18n/playable/sdk/playable-sdk.js'].join('');
        
        setTimeout(() => {
            document.body.appendChild(api);
        }, 100)
        
        super(callback);
    }

    openStore() {
        window.openAppStore();
    }
}