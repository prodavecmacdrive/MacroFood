const fs = require('fs');

module.exports.load = function() {
    fs.readdir('assets/imagemap', (err, files) => {
        if (err || !files || files.length === 0) {
            this.imagemapsLoaded = true;
            this.loadChunck();
            return;
        }

        // Add all valid imagemap files as raw JSON/text resources.
        for (const title of files) {
            const ext = title.slice(title.lastIndexOf('.') + 1).toLowerCase();
            const name = title.slice(0, title.lastIndexOf('.')).replace(/\s+/g, '_');
            if (ext === 'json' || ext === 'txt' || ext === 'xml') {
                const content = fs.readFileSync('assets/imagemap/' + title, 'utf8');
                this.resources += `window.App.resources.imagemaps.${name} = ${JSON.stringify(content)};`;
            }
        }

        this.imagemapsLoaded = true;
        this.loadChunck();
    });
};