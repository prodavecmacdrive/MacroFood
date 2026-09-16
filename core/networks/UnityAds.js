import Network from './Network.js'

export default class UnityAds extends Network {
    constructor(callback) {
        super(callback);
    }

    openStore() {
        window.mraid ? window.mraid.open( this.getUrl() ) : window.top.open( this.getUrl() );
    }
}