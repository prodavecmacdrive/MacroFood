const fs = require('fs');
const path = require('path');
const zip = require('bestzip');
const open = require('open');

const textures = require('./Textures.js');
const sheets = require('./Sheets.js');
const fonts = require('./Fonts.js');
const audio = require('./Audio.js');
const spine = require('./Spine.js');
const imagemaps = require('./Imagemaps.js');

let config = require('../../config');

class BuilderPlugin {
    constructor(options = {}) {
        this.mode = options.mode;

        this.currentVersion = 0;
        this.isOpenTab = false;

        // Cached after the first full asset load so subsequent versions
        // don't re-encode the same files 14 extra times.
        this._cachedAssetResources = null;
        this._cachedFonts          = null;
    }

    apply(compiler) {
        compiler.hooks.done.tap('Builder Plugin', (compilation, callback) => {
            this.callback = callback;

            // Reset state for a fresh production run
            this.currentVersion        = 0;
            this._cachedAssetResources = null;
            this._cachedFonts          = null;
            
            this.setDefaultProps();

            if( !fs.existsSync('assets') ) fs.mkdirSync('assets');
            if( !fs.existsSync('dist') ) fs.mkdirSync('dist');
            if( !fs.existsSync('temp') ) fs.mkdirSync('temp');

            if(this.mode === 'production') {
                for (let i = 0; i < Object.keys(config.versions).length; i++) {
                    const versionDirPath = 'dist/' + Object.keys(config.versions)[i];
                    if( !fs.existsSync(versionDirPath) ) fs.mkdirSync(versionDirPath);
                }
                if( !fs.existsSync('dist/preview') ) fs.mkdirSync('dist/preview');
            }

            !fs.existsSync('assets/textures') ? fs.mkdir('assets/textures', () => textures.load.bind(this)()) : textures.load.bind(this)();
            !fs.existsSync('assets/sheets') ? fs.mkdir('assets/sheets', () => sheets.load.bind(this)()) : sheets.load.bind(this)();
            !fs.existsSync('assets/fonts') ? fs.mkdir('assets/fonts', () => fonts.load.bind(this)()) : fonts.load.bind(this)();
            !fs.existsSync('assets/audio') ? fs.mkdir('assets/audio', () => audio.load.bind(this)()) : audio.load.bind(this)();
            !fs.existsSync('assets/spine') ? fs.mkdir('assets/spine', () => spine.load.bind(this)()) : spine.load.bind(this)();
            !fs.existsSync('assets/imagemap') ? fs.mkdir('assets/imagemap', () => imagemaps.load.bind(this)()) : imagemaps.load.bind(this)();
        });
    }

    setDefaultProps() {
        this.buildComplete = false;
        this.texturesLoaded = false;
        this.sheetsLoaded = false;
        this.fontsLoaded = false;
        this.audioLoaded = false;
        this.spineLoaded = false;
        this.imagemapsLoaded = false;
        this.inlineSpine = false;

        this.currentNetworkCount = 0;

        this.fonts = '';

        // Base resource string — flow and scenesData are appended per-version in makeHtml()
        this.resources = `window.App={};window.App.CORE_VERSION;window.App.networkName='{network}';window.App.network=null;window.App.version='{version}';`;
        this.resources += `window.App.isDev=${this.mode === 'development'};`;
        this.resources += `window.App.iosUrl='${config.ios}';window.App.androidUrl='${config.android}';`;
        this.resources += 'window.App.resources={};window.App.resources.textures={};window.App.resources.sheets={};';
        this.resources += 'window.App.resources.audio={};window.App.resources.spine={};window.App.resources.imagemaps={};';
    }

    isCurrentVersionAsset(name, folder) {
        let includes = false;
        let includesCurrentVersion = false;

        const currentVesion = this.mode === 'production' ? Object.keys(config.versions)[this.currentVersion] : config.currentVersion;

        for (const key in config.versions) {
            if(config.versions[key][folder] && config.versions[key][folder].includes(name)) {
                if(currentVesion === key) includesCurrentVersion = true;
                includes = true;
            }
        }

        if(includesCurrentVersion || !includes) return true;

        return false;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scene-settings helper
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Reads all game-settings_scene-N.json files present on disk and returns
     * an object keyed by 'scene-N'.  Missing files are silently skipped.
     */
    _readSceneSettings() {
        const scenesData = {};
        for (let i = 1; i <= 3; i++) {
            const filePath = `game-settings_scene-${i}.json`;
            if (fs.existsSync(filePath)) {
                try {
                    scenesData[`scene-${i}`] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                } catch (e) {
                    console.warn(`[Builder] Could not parse ${filePath}:`, e.message);
                }
            }
        }
        return scenesData;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Build pipeline
    // ─────────────────────────────────────────────────────────────────────────

    loadChunck() {
        if(!this.audioLoaded || !this.fontsLoaded || !this.sheetsLoaded || !this.texturesLoaded || !this.spineLoaded || !this.imagemapsLoaded || this.buildComplete) return;
        
        this.buildComplete = true;

        // Cache the asset portion of resources after the first full load so
        // subsequent versions can skip the expensive re-encode cycle.
        if (!this._cachedAssetResources) {
            this._cachedAssetResources = this.resources;
            this._cachedFonts          = this.fonts;
        }

        this.makeHtml(this.mode === 'development' ? 'dev' : config.networks[0]);
    }

    makeHtml(network) {
        let html = fs.readFileSync(`./core/template/${network === 'IronSource' ? 'dapi' : 'mraid'}.html`, 'utf8');
        const engine = fs.readFileSync(`core/libs/phaser${config.customPhaser ? '-custom' : ''}.min.js`, 'utf8');
        const spineLib = (this.inlineSpine) ? fs.readFileSync('core/libs/SpinePlugin.min.js', 'utf8') : '';

        // Resolve which version's flow to embed
        const versionKey = this.mode === 'production'
            ? Object.keys(config.versions)[this.currentVersion]
            : config.currentVersion;
        const versionCfg = config.versions[versionKey] || {};
        const flow       = Array.isArray(versionCfg.flow) ? versionCfg.flow : [];

        // Build full resources string: cached asset data + per-version flow + scene-specific settings.
        const scenesData  = this._readSceneSettings();
        const levelSelect = versionCfg.levelSelect === true;

        // AppLovin Playable Analytics helper — compliant implementation for Applovin builds (and dev testing),
        // silent no-op stub for every other network so game code never throws ReferenceError and other networks remain untouched.
        const isApplovinOrDev = (network === 'Applovin') || (this.mode === 'development' && network === 'dev');
        const axonHelper = isApplovinOrDev
            ? '(function(){' +
                  'var _hasStarted=false;' +
                  'var _hasOutcome=false;' +
                  'var _hasPass25=false;' +
                  'var _hasPass50=false;' +
                  'var _hasPass75=false;' +
                  'var _sent={};' +
                  'function _send(evt){' +
                      'if(typeof window.ALPlayableAnalytics!==\'undefined\'){' +
                          'window.ALPlayableAnalytics.trackEvent(evt);' +
                          'console.log(\'[Axon] Event: \'+evt);' +
                      '}else{' +
                          'console.log(\'[Axon local] Event: \'+evt);' +
                      '}' +
                  '}' +
                  'var fn=function(eventName){' +
                      'if(eventName===\'LOADING\'||eventName===\'LOADED\'||eventName===\'DISPLAYED\'||eventName===\'ENDCARD_SHOWN\'||eventName===\'CTA_CLICKED\'){' +
                          'if(_sent[eventName])return;' +
                          '_sent[eventName]=true;' +
                          '_send(eventName);' +
                          'return;' +
                      '}' +
                      'if(eventName===\'CHALLENGE_STARTED\'){' +
                          'if(_hasStarted)return;' +
                          '_hasStarted=true;' +
                          '_send(\'CHALLENGE_STARTED\');' +
                          'return;' +
                      '}' +
                      'if(eventName===\'CHALLENGE_PASS_25\'){' +
                          'if(!_hasStarted){_hasStarted=true;_send(\'CHALLENGE_STARTED\');}' +
                          'if(_hasPass25||_hasOutcome)return;' +
                          '_hasPass25=true;' +
                          '_send(\'CHALLENGE_PASS_25\');' +
                          'return;' +
                      '}' +
                      'if(eventName===\'CHALLENGE_PASS_50\'){' +
                          'if(!_hasStarted){_hasStarted=true;_send(\'CHALLENGE_STARTED\');}' +
                          'if(!_hasPass25){_hasPass25=true;_send(\'CHALLENGE_PASS_25\');}' +
                          'if(_hasPass50||_hasOutcome)return;' +
                          '_hasPass50=true;' +
                          '_send(\'CHALLENGE_PASS_50\');' +
                          'return;' +
                      '}' +
                      'if(eventName===\'CHALLENGE_PASS_75\'){' +
                          'if(!_hasStarted){_hasStarted=true;_send(\'CHALLENGE_STARTED\');}' +
                          'if(!_hasPass25){_hasPass25=true;_send(\'CHALLENGE_PASS_25\');}' +
                          'if(!_hasPass50){_hasPass50=true;_send(\'CHALLENGE_PASS_50\');}' +
                          'if(_hasPass75||_hasOutcome)return;' +
                          '_hasPass75=true;' +
                          '_send(\'CHALLENGE_PASS_75\');' +
                          'return;' +
                      '}' +
                      'if(eventName===\'CHALLENGE_SOLVED\'||eventName===\'CHALLENGE_FAILED\'){' +
                          'if(!_hasStarted){_hasStarted=true;_send(\'CHALLENGE_STARTED\');}' +
                          'if(_hasOutcome)return;' +
                          '_hasOutcome=true;' +
                          '_send(eventName);' +
                          'return;' +
                      '}' +
                      'if(eventName===\'CHALLENGE_RETRY\'){' +
                          'if(!_hasStarted)return;' +
                          '_hasOutcome=false;' +
                          '_hasPass25=false;' +
                          '_hasPass50=false;' +
                          '_hasPass75=false;' +
                          '_send(\'CHALLENGE_RETRY\');' +
                          'return;' +
                      '}' +
                      '_send(eventName);' +
                  '};' +
                  'window.trackAxonEvent=fn;' +
              '})();'
            : 'window.trackAxonEvent=function(){};';

        const fullResources = axonHelper
            + this.resources
            + `window.App.flow=${JSON.stringify(flow)};`
            + `window.App.scenesData=${JSON.stringify(scenesData)};`
            + `window.App.levelSelect=${levelSelect};`;

        html = html.replace('{engine}', engine + spineLib);
        html = html.replace('{fonts}', this.fonts);
        html = html.replace('{resources}', fullResources);
        html = html.replace('{fonts}', '');
        html = html.replace('{network}', network);
        html = html.replace('{title}', config.name);
        
        (this.mode === 'development') ? this.buildDev(html) : this.buildProd(html, network);
    }

    buildDev(html) {
        html = html.replace('{devCode}', `<script src = './../../main.js'></script>`);
        html = html.replace('{code}', '');
        html = html.replace('{version}', config.currentVersion);

        fs.writeFile('./dist/index.html', html, (err) => {
            if(!this.isOpenTab) {
                open('http://localhost:3080/index.html');
                this.isOpenTab = true;
            }
        });
    }

    buildProd(html, network) {
        let code = '';
        try {
            code = fs.readFileSync('dist/main.js', 'utf8');
        } catch (e) {
            console.error(`[Builder Error] Failed to read dist/main.js for network ${network}, version ${this.currentVersion}`);
            throw e;
        }
        html = html.replace('{devCode}', '');
        html = html.replace('{code}', code);

        const folderName = Object.keys(config.versions)[this.currentVersion];
        const versionCfg = config.versions[folderName] || {};
        const versionTitle = versionCfg.name || `${config.name}_${folderName}`;
        html = html.replace('{version}', folderName);

        const suffix = (config.mirrors && config.mirrors[network]) ? config.mirrors[network] : network.toLowerCase();
        const filenameBase = `${versionTitle}_${suffix}`;
        const htmlFilename = filenameBase + '.html';
        const zipFilename = filenameBase + '.zip';

        const makeNextNetwork = () => {
            if(this.currentNetworkCount !== config.networks.length - 1) {
                this.currentNetworkCount++;
                this.makeHtml(config.networks[this.currentNetworkCount]);
            } else {
                const versionZipName = `${versionTitle}.zip`;
                const folderPath = `dist/${folderName}`;
                const destZipPath = path.resolve(process.cwd(), 'dist', versionZipName);

                const finishVersion = () => {
                    if(this.currentVersion !== Object.keys(config.versions).length - 1) {
                        this.buildNextVersion();
                    } else {
                        console.log('[Builder] Reached end of versions. Unlinking dist/main.js');
                        fs.unlink('dist/main.js', () => {});
                    }
                };

                if (fs.existsSync(folderPath)) {
                    const filesToZip = fs.readdirSync(folderPath);
                    if (filesToZip.length > 0) {
                        zip({
                            source: filesToZip,
                            destination: destZipPath,
                            cwd: folderPath
                        }).then(() => {
                            console.log(`[Builder] Version archive created: dist/${versionZipName}`);
                            fs.rmSync(folderPath, { recursive: true, force: true });
                            finishVersion();
                        }).catch((zipErr) => {
                            console.error(`[Builder] Version zip failed for ${folderName}:`, zipErr.message);
                            finishVersion();
                        });
                    } else {
                        fs.rmSync(folderPath, { recursive: true, force: true });
                        finishVersion();
                    }
                } else {
                    finishVersion();
                }
            }
        };

        if(network === 'Google') {
            const googleHtmlFilename = 'index.html';
            fs.writeFile(`dist/${folderName}/${googleHtmlFilename}`, html, (err) => {
                if (err) {
                    console.error('[Builder] Failed to write index.html for Google:', err);
                    makeNextNetwork();
                    return;
                }
                zip({
                    source: googleHtmlFilename,
                    destination: zipFilename,
                    cwd: `dist/${folderName}/`
                }).then(() => {
                    fs.unlink(`dist/${folderName}/${googleHtmlFilename}`, () => makeNextNetwork());
                }).catch((zipErr) => {
                    console.error('[Builder] Adwords zip failed for ' + folderName + ':', zipErr.message);
                    fs.unlink(`dist/${folderName}/${googleHtmlFilename}`, () => makeNextNetwork());
                });
            });
        } else if(network === 'TikTok') {
            let c = fs.readFileSync('./core/template/config.json', 'utf8');
            fs.writeFileSync(`dist/${folderName}/config.json`, c);
            
            fs.writeFile(`dist/${folderName}/${htmlFilename}`, html, (err) => {
                zip({
                    source: [htmlFilename, 'config.json'],
                    destination: zipFilename,
                    cwd: `dist/${folderName}/`
                }).then(() => {
                    fs.unlink(`dist/${folderName}/config.json`, () => {});
                    fs.unlink(`dist/${folderName}/${htmlFilename}`, () => makeNextNetwork());
                }).catch((zipErr) => {
                    console.error('[Builder] TikTok zip failed for ' + folderName + ':', zipErr.message);
                    fs.unlink(`dist/${folderName}/config.json`, () => {});
                    fs.unlink(`dist/${folderName}/${htmlFilename}`, () => makeNextNetwork());
                });
            });
        } else if(network === 'Vungle') {
            fs.writeFile(`dist/${folderName}/${htmlFilename}`, html, (err) => makeNextNetwork());
        } else {
            fs.writeFile(`dist/${folderName}/${htmlFilename}`, html, (err) => {
                if(network === 'UnityAds') {
                    const previewBase = versionTitle;
                    const previewPath = `dist/preview/${previewBase}.html`;
                    fs.copyFile(`dist/${folderName}/${htmlFilename}`, previewPath, (copyErr) => {
                        if(copyErr) {
                            console.error('[Builder] Preview copy failed for ' + previewPath + ':', copyErr.message);
                        }
                        makeNextNetwork();
                    });
                } else {
                    makeNextNetwork();
                }
            });
        }
    }

    /**
     * Advance to the next build variant.
     *
        * Because all 18 variants share identical assets, we skip re-running the
     * asset loaders and instead restore the cached resources + fonts strings,
     * then jump straight to HTML generation.
     */
    buildNextVersion() {
        this.currentVersion++;
        this.buildComplete       = false;
        this.currentNetworkCount = 0;

        // Restore cached asset data — no re-encoding needed
        this.resources = this._cachedAssetResources;
        this.fonts     = this._cachedFonts;

        // Mark all asset loaders as done so loadChunck() fires immediately
        this.texturesLoaded   = true;
        this.sheetsLoaded     = true;
        this.fontsLoaded      = true;
        this.audioLoaded      = true;
        this.spineLoaded      = true;
        this.imagemapsLoaded  = true;

        this.loadChunck();
    }
}
  
module.exports = BuilderPlugin;