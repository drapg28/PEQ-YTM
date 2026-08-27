(function() {
    let videoElement = null;
    let observer = null;
    let isGraphBuilt = false;

    // Dummy state untuk Phase 1
    const testPreset = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    function findAndHookVideo() {
        // Gotcha 2.3.5: Selector DOM generik
        const video = document.querySelector('video');
        
        if (video && video !== videoElement) {
            console.log('[PEQ] Elemen video ditemukan dan di-hook:', video);
            videoElement = video;
            
            // Gotcha 2.3.4: AudioContext butuh resume() dari user gesture asli
            video.addEventListener('play', handlePlayEvent);
        }
    }

    function handlePlayEvent() {
        console.log('[PEQ] Video dimainkan. Inisialisasi Audio Engine...');
        
        const success = window.peqDSP.initAudio(videoElement);
        if (success) {
            const ctx = window.peqDSP.getAudioContext();
            if (ctx && ctx.state === 'suspended') {
                ctx.resume().then(() => {
                    console.log('[PEQ] AudioContext di-resume.');
                });
            }
            
            // Gotcha 2.3.1: Re-build graph jika video direcreate
            window.peqDSP.createFilterChain(testPreset);
            isGraphBuilt = true;
            console.log('[PEQ] Filter chain dibangun (10-Band + Compressor). EQ aktif.');
        } else {
            console.error('[PEQ] Gagal attach Web Audio API ke video.');
        }
    }

    function observeDOM() {
        // Gotcha 2.3.1: Deteksi video element SPA re-render
        observer = new MutationObserver(() => {
            const currentVideo = document.querySelector('video');
            if (currentVideo && currentVideo !== videoElement) {
                console.log('[PEQ] Perubahan SPA YTM terdeteksi (Video diganti).');
                findAndHookVideo();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // Tools pengujian manual via Developer Console
    window.peqTest = {
        setGain: (bandIndex, gainDb) => {
            window.peqDSP.updateFilterGain(bandIndex, gainDb);
            console.log(`[PEQ Test] Band ${bandIndex} di-set ke ${gainDb} dB`);
        },
        toggleBypass: (bypass) => {
            const state = window.peqDSP.toggleBypass(bypass);
            console.log(`[PEQ Test] Bypass EQ: ${state ? 'AKTIF (Bisu EQ)' : 'NON-AKTIF (EQ Jalan)'}`);
        },
        status: () => {
            const ctx = window.peqDSP.getAudioContext();
            console.log({
                audioContextState: ctx ? ctx.state : 'Belum inisialisasi',
                videoHooked: !!videoElement,
                isGraphBuilt: isGraphBuilt
            });
        }
    };

    console.log('[PEQ] Content script (Fase 1) diinjeksi.');
    findAndHookVideo();
    observeDOM();
})();
