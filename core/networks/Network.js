export default class Network {
    constructor(callback) {
        this.game = null;

        callback && window.addEventListener('load', callback);
    }

    addClickToStore(obj) {
        obj.setInteractive().on("pointerdown", this.ctaClick, this);
    }

    ctaClick() {
        if (typeof window.trackAxonEvent === 'function') window.trackAxonEvent('CTA_CLICKED');
        this.openStore();
    }

    openStore() {
        window.top.open( this.getUrl() );
    }

    getUrl() {
        if(this.game.device.os.android) {
            return App.androidUrl;
        }

        return App.iosUrl;
    }

    ready() {}

    complete() {}
}