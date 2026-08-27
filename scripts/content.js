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
            
            // Fase 4: Mulai analisis spektrum
            startAnalysis();
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

    // --- Auto-Analisis (Fase 4) ---
    let analysisInterval = null;

    function startAnalysis() {
        if (analysisInterval) clearInterval(analysisInterval);
        
        let readCount = 0;
        let tempSpectrum = { bass: 0, mid: 0, treble: 0 };

        analysisInterval = setInterval(() => {
            if (!isGraphBuilt || !window.peqDSP || state.isBypassed) return;
            
            const current = window.peqDSP.analyzeSpectrum();
            if (!current) return;
            
            // Kumpulkan data rata-rata 10 kali (5 detik pertama lagu)
            if (readCount < 10) { 
                tempSpectrum.bass += current.bassEnergy;
                tempSpectrum.mid += current.midEnergy;
                tempSpectrum.treble += current.trebleEnergy;
                readCount++;
                
                if (readCount === 10) {
                    const baselineSpectrum = {
                        bass: tempSpectrum.bass / 10,
                        mid: tempSpectrum.mid / 10,
                        treble: tempSpectrum.treble / 10
                    };
                    const candidate = classifySpectrum(baselineSpectrum);
                    evaluateAndRecommend(candidate);
                }
            }
        }, 500);
    }

    const REFERENCE_PROFILE = { bass: 0.42, mid: 0.38, treble: 0.20 };
    const DEVIATION_THRESHOLD = 0.12;

    function classifySpectrum(avg) {
        const total = avg.bass + avg.mid + avg.treble;
        if (total === 0) return { presetId: null, message: '' };

        const proportion = {
            bass: avg.bass / total,
            mid: avg.mid / total,
            treble: avg.treble / total,
        };

        const deviation = {
            bass: proportion.bass - REFERENCE_PROFILE.bass,
            mid: proportion.mid - REFERENCE_PROFILE.mid,
            treble: proportion.treble - REFERENCE_PROFILE.treble,
        };

        const candidates = [
            { key: 'bass', value: deviation.bass, presetId: 'bass_boost', message: 'Lagu ini bass-heavy. Coba preset Bass Boost?' },
            { key: 'mid', value: deviation.mid, presetId: 'vocal_clarity', message: 'Vokal mendominasi. Coba preset Vocal Clarity?' },
            { key: 'treble', value: deviation.treble, presetId: 'tactical_audio', message: 'Detail high-end tajam. Coba Tactical Audio?' },
        ];

        const strongest = candidates.reduce((max, c) => (c.value > max.value ? c : max), candidates[0]);

        if (strongest.value > DEVIATION_THRESHOLD) {
            return strongest;
        }

        return { presetId: null, message: '' };
    }

    function evaluateAndRecommend(candidate) {
        if (!candidate.presetId) return;

        const recommendation = { presetId: candidate.presetId, message: candidate.message };
        console.log('[PEQ] Rekomendasi siap:', recommendation);
        
        state.recommendation = recommendation;
        chrome.runtime.sendMessage({ action: "NEW_RECOMMENDATION", data: recommendation }).catch(() => {});
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

        if (request.action === "CLEAR_RECOMMENDATION") {
            state.recommendation = null;
            sendResponse({success: true});
            return true;
        }
    });

    console.log('[PEQ] Content script (Fase 2) diinjeksi.');
    findAndHookVideo();
    observeDOM();
    initPersistence();
})();
