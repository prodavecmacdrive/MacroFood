export default class Scene extends Phaser.Scene {
    static PORTRAIT_MAX_WIDTH = 700;
    static PORTRAIT_MAX_HEIGHT = 300;
    static LANDSCAPE_MAX_WIDTH = 1300 * 1.5;
    static LANDSCAPE_MAX_HEIGHT = 700 * 1.5;

    constructor(name = 'Game') {
        super({key: name});
    }
  
    preload() {
        this.mainContainer = this.add.container(0, 0);
        this.game.size.resize();

        // Only mute on the very first load. On subsequent level restarts the
        // user has already interacted, so muting would cut the background music.
        if (!window.App.userInteracted) {
            this.sound.mute = true;
            this.input.once('pointerdown', () => {
                this.sound.mute = false;
                window.App.userInteracted = true;
            });
        }
    }

    sort() {
        this.mainContainer.sort('depth');
    }
}