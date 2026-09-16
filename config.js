module.exports = {
    'name': 'SDP_mip_grknopa_MacroFood_Bg_Real_NonUGC_Gen_EN',
    // 'networks': ['Applovin', 'Facebook', 'Google', 'IronSource', 'Liftoff', 'TikTok', 'UnityAds', 'Vungle'],
    'networks': ['Applovin', 'Facebook', 'Google', 'Mintegral', 'Moloco', 'UnityAds'],
    'mirrors': {
        'Applovin': 'al',
        'Facebook': 'fb',
        'Google': 'gg',
        'Mintegral': 'mtg',
        'Moloco': 'mo',
        'UnityAds': 'un'
    },
    'customPhaser': true,
    'compressAtlas': true,
    'compressTexture': true,
    'compressAudio': true,
    'ios': 'https://apps.apple.com/ua/app/sand-drop-color-puzzle/id6786642612',
    'android': 'https://play.google.com/store/apps/details?id=com.fingersyoda.sanddrop',

    // Dev mode previews scene-1 only; override to test other flows.
    'currentVersion': 'full',

    // ── Build variants per background & flow ──────────────────────────────────
    'versions': {
        // Default Background (bg.png -> Bg)
        'full': { flow: ['scene-1'], textures: ['bg'] },
        '30s': { flow: ['scene-2'], textures: ['bg'] },
        '59s': { flow: ['scene-3'], textures: ['bg'] },

        // Background 1 (bg_1.png -> Bg1)
        'Bg1_full': { name: 'SDP_mip_grknopa_MacroFood_Bg1_Real_NonUGC_Gen_EN_full', flow: ['scene-1'], textures: ['bg_1'] },
        'Bg1_30s': { name: 'SDP_mip_grknopa_MacroFood_Bg1_Real_NonUGC_Gen_EN_30s', flow: ['scene-2'], textures: ['bg_1'] },
        'Bg1_59s': { name: 'SDP_mip_grknopa_MacroFood_Bg1_Real_NonUGC_Gen_EN_59s', flow: ['scene-3'], textures: ['bg_1'] },

        // Background 2 (bg_2.png -> Bg2)
        'Bg2_full': { name: 'SDP_mip_grknopa_MacroFood_Bg2_Real_NonUGC_Gen_EN_full', flow: ['scene-1'], textures: ['bg_2'] },
        'Bg2_30s': { name: 'SDP_mip_grknopa_MacroFood_Bg2_Real_NonUGC_Gen_EN_30s', flow: ['scene-2'], textures: ['bg_2'] },
        'Bg2_59s': { name: 'SDP_mip_grknopa_MacroFood_Bg2_Real_NonUGC_Gen_EN_59s', flow: ['scene-3'], textures: ['bg_2'] },

        // Background 3 (bg_3.png -> Bg3)
        'Bg3_full': { name: 'SDP_mip_grknopa_MacroFood_Bg3_Real_NonUGC_Gen_EN_full', flow: ['scene-1'], textures: ['bg_3'] },
        'Bg3_30s': { name: 'SDP_mip_grknopa_MacroFood_Bg3_Real_NonUGC_Gen_EN_30s', flow: ['scene-2'], textures: ['bg_3'] },
        'Bg3_59s': { name: 'SDP_mip_grknopa_MacroFood_Bg3_Real_NonUGC_Gen_EN_59s', flow: ['scene-3'], textures: ['bg_3'] },

        // Background 4 (bg_4.png -> Bg4)
        'Bg4_full': { name: 'SDP_mip_grknopa_MacroFood_Bg4_Real_NonUGC_Gen_EN_full', flow: ['scene-1'], textures: ['bg_4'] },
        'Bg4_30s': { name: 'SDP_mip_grknopa_MacroFood_Bg4_Real_NonUGC_Gen_EN_30s', flow: ['scene-2'], textures: ['bg_4'] },
        'Bg4_59s': { name: 'SDP_mip_grknopa_MacroFood_Bg4_Real_NonUGC_Gen_EN_59s', flow: ['scene-3'], textures: ['bg_4'] }
    }
};