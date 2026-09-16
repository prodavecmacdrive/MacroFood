const fs = require('fs');
const base64Img = require('base64-img');
const imagemin = require('imagemin');
const jsonminify = require('jsonminify');
const texturePacker = require('free-tex-packer-core');
const imageminMozjpeg = require('imagemin-mozjpeg');
const imageminPngquant = require('imagemin-pngquant');

const config = require('../../config');

module.exports.load = function() {
	let images = [];

    let options = {
        // width: 5555,
        // height: 5555,
        width: 9955,
        height: 9955,
        fixedSize: false,
        padding: 2,
        trimmed: true,
        allowRotation: false,
        detectIdentical: true,
        allowTrim: true, 
        removeFileExtension: true,
        prependFolderName: true,
        exporter: 'PhaserArray'
    };
        
    fs.readdir('assets/sheets', (err, files) => {
        let textures = false;
        let titles = [];

        for (const title of files) {
            const type = title.slice(title.length - 3, title.length);
            if (type === 'png' || type === 'jpg') {
                textures = true;
                titles.push(title);
            } else {
                fs.unlinkSync('assets/sheets/' + title);
            }
        }

        for (const title of titles) {
            const name = title.slice(0, -4);
            this.isCurrentVersionAsset(name, 'sheets') && images.push({path: title, contents: fs.readFileSync('assets/sheets/' + title)});
        }

        if(images.length === 0 || files.length === 0 || !textures) {
            this.sheetsLoaded = true;
            this.loadChunck();

            return;
        }

        texturePacker(images, options, (files) => {
            fs.promises.mkdir('temp/', { recursive: true }).catch(console.error);
            fs.writeFile('temp/atlas.png', files[1].buffer, (err) => {
                if(config.compressAtlas) {
                    (async () => {
                        await imagemin(['temp/atlas.png'], {
                            destination: 'temp/',
                            plugins: [
                                imageminMozjpeg(),
                                imageminPngquant({
                                    quality: [0.85, 0.85]
                                })
                            ]
                        });
                                
                        sheetsToBase64.bind(this)(files);
                    })();
                } else {
                    sheetsToBase64.bind(this)(files);
                }
            });
        })
    });
}

function sheetsToBase64(files) {
    base64Img.base64('temp/atlas.png', (err, data) => {
        const json = jsonminify(String(files[0].buffer))
        json.slice(1, 1);

        this.resources += 'window.App.resources.sheets.' + 'json' + ' = '  + json + ';';
        this.resources += 'window.App.resources.sheets.' + 'png' + ' = ' + "'" + data + "'" + ';';
        
        this.sheetsLoaded = true;
        this.loadChunck();
    });
}