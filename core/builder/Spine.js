const fs = require('fs');
const base64Img = require('base64-img');
const imagemin = require('imagemin');
const imageminMozjpeg = require('imagemin-mozjpeg');
const imageminPngquant = require('imagemin-pngquant');

module.exports.load = function() {
	fs.readdir('assets/spine', (err, names) => {
        let files = [];
        for (const title of names) {
            const name = title.slice(0, title.indexOf('.'));
            
            this.isCurrentVersionAsset(name, 'spine') && files.push(title);
        }
        
        if(files.length === 0 || names.length === 0) {
            this.spineLoaded = true;
            this.inlineSpine = false;
            this.loadChunck();
            
            return;
        }
        
        let count = {current: 0, total: names.length / 3};
        for (let i = 0; i < files.length; i++) {
            const filename = files[i];
            const isPng = filename.endsWith('.png');
            const isJson = filename.endsWith('.json');
            const isAtlas = filename.endsWith('.atlas') || filename.endsWith('.atlas.txt');
            const name = filename.replace(/\.atlas(?:\.txt)?$/, '').replace(/\.[^.]+$/, '');

            if (isPng) {
                (async () => {
                    await imagemin(['assets/spine/' + filename], {
                        destination: 'temp/',
                        plugins: [
                            imageminMozjpeg(),
                            imageminPngquant({
                                quality: [0.6, 0.8]
                            })
                        ]
                    });
                    spineToBase64.bind(this)('temp/' + filename, filename, count);
                })();
            } else if (isJson) {
                fs.readFile('assets/spine/' + filename, 'utf8', (err, json) => {
                    addSpineEntry.call(this, name, 'json', JSON.minify(json));
                });
            } else if (isAtlas) {
                addSpineResource.call(this, name);
                fs.readFile('assets/spine/' + filename, 'utf8', (err, atlas) => {
                    this.resources += 'window.App.resources.spine.' + name + '.atlas = ' + JSON.stringify(atlas) + ';';
                });
            }
        }

        function addSpineResource(name) {
            this.resources += 'window.App.resources.spine.' + name + ' = window.App.resources.spine.' + name + ' || {};' + '\n';
        }

        function addSpineEntry(name, key, value) {
            addSpineResource.call(this, name);
            this.resources += 'window.App.resources.spine.' + name + '.' + key + ' = ' + JSON.stringify(value) + ';';
        }
    });

    function spineToBase64(path, title, count) {
        const name = title.slice(0, title.indexOf('.'));
        base64Img.base64(path, (err, data) => {
            this.resources += 'window.App.resources.spine.' + name + ' = window.App.resources.spine.' + name + ' || {};' + '\n';
            this.resources += 'window.App.resources.spine.' + name + '.png = ' + "'" + data + "'" + ';';
                
            count.current++;
                
            if(count.current === count.total) {
                this.spineLoaded = true;
                this.inlineSpine = true;
                this.loadChunck();
            }
        }); 
    }
}