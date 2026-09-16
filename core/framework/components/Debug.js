export default class Debug {
    constructor(scene) {
        this.consoleOutput = [];

        this._scene = scene;

        this._addFps();
        this._addWatchError();
    }

    log(message) {
        this.consoleOutput.push(message);
        if (this.consoleOutput.length > 10) {
            this.consoleOutput.shift();
        }
    }

    _addFps() {
        this._fps = this._scene.add.text(0, 0, '', {fontFamily: 'LilitaOne-Regular, Arial', fontSize: 25, fill: '#00ff00'});
        this._fps.setCustomPosition(0, 0).setAlign('Top Left').setDepth(10000).setScrollFactor(0);
        this._scene.mainContainer.add(this._fps);
        
        this._scene.time.addEvent({delay: 100, callback: this._update, callbackScope: this, loop: true});
    }

    _addWatchError() {
        window.addEventListener('error', (e) => {
            let stack = e.error.stack;
            let message = e.error.toString();
            if (stack) {
                message += '\n' + stack;
            }
                
            document.write(message);
        });
    }

    _update() {
        let newText = '';
        for (let i = 0; i < this.consoleOutput.length; i++) {
            newText += this.consoleOutput[i];
            newText += '\n';
        }
        
        this._fps.setText('FPS: ' + this._scene.game.loop.actualFps.toFixed(1) + '\n' + newText);
    }
}