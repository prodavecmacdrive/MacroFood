import Network from './Network.js'

export default class IronSource extends Network {
    constructor(callback) {
        super();

        this.callback = callback;
        this.onDapiReadyCallbackBind = this.onDapiReadyCallback.bind(this);

        (dapi.isReady()) ? this.onDapiReadyCallback() : dapi.addEventListener("ready", this.onDapiReadyCallbackBind);
    }

    onDapiReadyCallback() {
        dapi.removeEventListener("ready", this.onDapiReadyCallbackBind);
            
        dapi.getAudioVolume();
        dapi.getScreenSize();

        if(dapi.isViewable()) {
            setTimeout(() => {
                this.callback();
            }, 500);
        } else {
            dapi.addEventListener("viewableChange", () => {
                setTimeout(() => {
                    this.callback();
                }, 500);
            });
        }

        dapi.addEventListener("adResized", () => {
            this.game.resize();
        });

        dapi.addEventListener("audioVolumeChange", () => {});
    }

    openStore() {
        dapi.openStoreUrl();
    }
}