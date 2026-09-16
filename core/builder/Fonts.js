const fs = require('fs');
const fetch = require('fetch-base64');

module.exports.load = function() {
	this.fonts = '';

    fs.readdir('assets/fonts', (err, names) => {
        let font = false;
        let currentVersionFonts = [];
            
        for (const title of names) {
            const type = title.slice(title.length - 3, title.length);
            (type === 'ttf') ? font = true : fs.unlinkSync('assets/fonts/' + title);
        }
        
        let files = [];
        for (const title of names) {
            const name = title.slice(0, -4);
            
            this.isCurrentVersionAsset(name, 'fonts') && files.push(title);
        }

        if(names.length === 0 || files.length === 0 || !font) {
            this.resources += 'window.App.resources.fonts = ' + "'" + 'Arial.ttf' + "'" + ';';
            this.fontsLoaded = true;
            this.loadChunck();
                
            return;
        }

        for (let i = 0; i < files.length; i++) {
            fetch.local('assets/fonts/' + files[i]).then((data) => {
                fs.readFile('core/template/font.html', 'utf8', (err, font) => {
                    const name = files[i].toLocaleLowerCase().slice(0, -4);
                    font = font.replace('name', name);
                    font = font.replace('{data}', data[0]);
                    font = font.replace('name2', name);
                    this.fonts += font;
                    
                    this.fontsLoaded = true;
                    this.loadChunck();
                });
            }).catch((reason) => {});

            currentVersionFonts.push(files[i]);
        }
        
        currentVersionFonts.push('Arial.ttf');
            
        this.resources += 'window.App.resources.fonts = ' + "'" + currentVersionFonts + "'" + ';';
    });
}