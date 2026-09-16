import Network from './Network.js'

export default class Vungle extends Network {
    constructor(callback) {
        super(callback);
    }

    complete() {
        parent.postMessage('complete', '*');
    }

    openStore() {
        parent.postMessage('download', '*');
    }
}