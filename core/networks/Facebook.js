import Network from './Network.js'

export default class Facebook extends Network {
    constructor(callback) {
        super(callback);
    }

    openStore() {
        window.FbPlayableAd ? window.FbPlayableAd.onCTAClick() : window.top.open( this.getUrl() );
    }
}