(function() {
    let videoElement = null;
    let observer = null;
    let isGraphBuilt = false;

    // STATE IN-MEMORY (Source of Truth - Fase 2)
    let state = {
        gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        isBypassed: false,
        presetId: 'custom'
    };

    function findAndHookVideo() {
        const video = document.querySelector('video');
        
        if (video && video !== videoElement) {
            console.log('[PEQ] Elemen video ditemukan:', video);
            videoElement = video;
            video.addEventListener('play', handlePlayEvent);
        }
    }

    function handlePlayEvent() {
        if (!window.peqDSP) return;
        const success = window.peqDSP.initAudio(videoElement);
        if (success) {
            const ctx = window.peqDSP.getAudioContext();
            if (ctx && ctx.state === 'suspended') {
                ctx.resume().then(() => console.log('[PEQ] AudioContext di-resume.'));
            }
            
            // Terapkan state yang ada di memory saat build
            window.peqDSP.createFilterChain(state.gains);
            window.peqDSP.toggleBypass(state.isBypassed);
            isGraphBuilt = true;
            console.log('[PEQ] Filter chain dibangun (10-Band + Compressor). EQ aktif.');
        } else {
            console.error('[PEQ] Gagal attach Web Audio API ke video.');
        }
    }

    function observeDOM() {
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

    // --- IPC & Persistence (Fase 2) ---
    function initPersistence() {
        chrome.runtime.sendMessage({action: "GET_INIT_STATE"}, (response) => {
            if (response && response.state) {
                console.log('[PEQ] Restoring state dari local storage...');
                state = response.state;
                if (isGraphBuilt && window.peqDSP) {
                    state.gains.forEach((val, i) => window.peqDSP.updateFilterGain(i, val));
                    window.peqDSP.toggleBypass(state.isBypassed);
                }
            }
        });
    }

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "GET_STATE") {
            sendResponse(state);
            return true;
        }

        if (request.action === "UPDATE_GAIN") {
            state.gains[request.band] = request.value;
            state.presetId = 'custom';
            if (isGraphBuilt && window.peqDSP) {
                window.peqDSP.updateFilterGain(request.band, request.value);
            }
            sendResponse({success: true});
            return true;
        }

        if (request.action === "TOGGLE_BYPASS") {
            state.isBypassed = request.bypass !== undefined ? request.bypass : !state.isBypassed;
            if (isGraphBuilt && window.peqDSP) {
                window.peqDSP.toggleBypass(state.isBypassed);
            }
            sendResponse({success: true, isBypassed: state.isBypassed});
            return true;
        }

        if (request.action === "APPLY_PRESET") {
            state.gains = [...request.bands];
            state.presetId = request.presetId;
            state.isBypassed = false;
            
            if (isGraphBuilt && window.peqDSP) {
                state.gains.forEach((val, i) => window.peqDSP.updateFilterGain(i, val));
                window.peqDSP.toggleBypass(false);
            }
            sendResponse({success: true});
            return true;
        }
    });

    console.log('[PEQ] Content script (Fase 2) diinjeksi.');
    findAndHookVideo();
    observeDOM();
    initPersistence();
})();
