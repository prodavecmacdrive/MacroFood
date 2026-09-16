const fs = require('fs');
const base64Img = require('base64-img');
const imagemin = require('imagemin');
const imageminMozjpeg = require('imagemin-mozjpeg');
const imageminPngquant = require('imagemin-pngquant');

const config = require('../../config');

module.exports.load = function() {
    fs.readdir('assets/textures', (err, names) => {
        let textures = false;

        for (const title of names) {
            const type = title.slice(title.length - 3, title.length);

            (type === 'png' || type === 'jpg') ? textures = true : fs.unlinkSync('assets/textures' + title);
        }

        let files = [];
        for (const title of names) {
            const name = title.slice(0, -4);
            
            this.isCurrentVersionAsset(name, 'textures') && files.push(title);
        }

        if(names.length === 0 || files.length === 0 || !textures) {
            this.texturesLoaded = true;
            this.loadChunck();

    	    return;
	    }
            
        let count = {current: 0, total: 0};
        for (let i = 0; i < files.length; i++) {
            if(config.compressTexture) {
                (async () => {
                    await imagemin(['assets/textures/' + files[i]], {
                        destination: 'temp/',
                        plugins: [
                            imageminMozjpeg(),
                            imageminPngquant({
                                quality: [0.5, 0.5]
                            })
                        ]
                    });
                    textureToBase64.bind(this)('temp/' + files[i], files[i], count);
                })();
            } else {
                textureToBase64.bind(this)('assets/textures/' + files[i], files[i], count);
            }

            count.total++;
        }
    });

    function textureToBase64(path, title, count) {
        base64Img.base64(path, (err, data) => {
            if(data) {
                title = title.replace(/ /g, "_").replace(/-/g, "_");
                this.resources += 'window.App.resources.textures.' + title.slice(0, -4) + ' = ' + "'" + data + "'" + ';';
            }

            count.current++;
                
            if(count.current === count.total) {
                this.texturesLoaded = true;
                this.loadChunck();
            }
        }); 
    }
}