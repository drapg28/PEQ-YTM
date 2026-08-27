const peqDSP = (function() {
    const FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    const Q_VALUE = 1.41;

    let audioContext = null;
    let sourceNode = null;
    let preampNode = null;
    let filterNodes = [];
    let compressorNode = null;
    let analyserNode = null;
    let isBypassed = false;
    let mediaElements = new WeakMap();

    function initAudio(mediaElement) {
        if (!audioContext) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            audioContext = new AudioContext();
        }

        if (sourceNode) {
            sourceNode.disconnect();
        }

        if (mediaElements.has(mediaElement)) {
            sourceNode = mediaElements.get(mediaElement);
        } else {
            try {
                sourceNode = audioContext.createMediaElementSource(mediaElement);
                mediaElements.set(mediaElement, sourceNode);
            } catch (e) {
                console.error("[PEQ] Gagal membuat MediaElementSource:", e);
                return false;
            }
        }
        return true;
    }

    function createFilterChain(presetData = [0,0,0,0,0,0,0,0,0,0]) {
        if (!audioContext || !sourceNode) return false;

        // Disconnect semua node yang ada sebelumnya
        if (preampNode) preampNode.disconnect();
        filterNodes.forEach(node => node.disconnect());
        if (compressorNode) compressorNode.disconnect();

        // 1. Preamp
        preampNode = audioContext.createGain();
        preampNode.gain.value = 1.0;

        // 2. Filter Chain (10 Band)
        filterNodes = [];
        let previousNode = preampNode;

        for (let i = 0; i < 10; i++) {
            const filter = audioContext.createBiquadFilter();
            filter.frequency.value = FREQUENCIES[i];
            filter.gain.value = presetData[i] || 0;
            
            if (i === 0) {
                filter.type = 'lowshelf';
            } else if (i === 9) {
                filter.type = 'highshelf';
            } else {
                filter.type = 'peaking';
                filter.Q.value = Q_VALUE;
            }

            previousNode.connect(filter);
            previousNode = filter;
            filterNodes.push(filter);
        }

        // 3. Compressor (Headroom Protection - Gotcha 5.3)
        compressorNode = audioContext.createDynamicsCompressor();
        compressorNode.threshold.value = -1.0; 
        compressorNode.knee.value = 40;
        compressorNode.ratio.value = 12;
        compressorNode.attack.value = 0;
        compressorNode.release.value = 0.25;

        previousNode.connect(compressorNode);

        // 4. Analyser (paralel ke input)
        attachAnalyser(compressorNode);

        applyRouting();
        return true;
    }

    function updateFilterGain(bandIndex, newGain) {
        if (filterNodes[bandIndex] && audioContext) {
            // Gotcha: Linear ramp mencegah audio click/pop
            filterNodes[bandIndex].gain.setTargetAtTime(newGain, audioContext.currentTime, 0.05);
        }
    }

    function toggleBypass(bypassState) {
        isBypassed = bypassState !== undefined ? bypassState : !isBypassed;
        applyRouting();
        return isBypassed;
    }

    function applyRouting() {
        if (!sourceNode || !audioContext) return;
        
        // Putuskan koneksi sebelumnya (termasuk output ke destinasi)
        sourceNode.disconnect();
        if (compressorNode) compressorNode.disconnect();
        
        if (isBypassed) {
            // Gotcha 2.3.3: Output native di-bypass ke destination
            sourceNode.connect(audioContext.destination);
        } else {
            // Sambungkan source ke filter
            sourceNode.connect(preampNode);
            if (compressorNode) {
                // Gotcha 2.3.3: Harus di-connect ke destination agar tidak bisu
                compressorNode.connect(audioContext.destination);
            }
        }
    }

    function attachAnalyser(source) {
        if (!audioContext) return null;
        if (!analyserNode) {
            analyserNode = audioContext.createAnalyser();
            analyserNode.fftSize = 2048;
        } else {
            analyserNode.disconnect();
        }
        // Tap paralel ke output
        source.connect(analyserNode);
        return analyserNode;
    }

    function averageRange(dataArray, minFreq, maxFreq, sampleRate) {
        const nyquist = sampleRate / 2;
        const binCount = dataArray.length;
        
        const minBin = Math.floor((minFreq / nyquist) * binCount);
        const maxBin = Math.ceil((maxFreq / nyquist) * binCount);
        
        let sum = 0;
        let count = 0;
        const start = Math.max(0, minBin);
        const end = Math.min(binCount - 1, maxBin);
        
        for (let i = start; i <= end; i++) {
            sum += dataArray[i];
            count++;
        }
        
        return count > 0 ? sum / count : 0;
    }

    function analyzeSpectrum() {
        if (!analyserNode || !audioContext) return null;
        
        const dataArray = new Uint8Array(analyserNode.frequencyBinCount);
        analyserNode.getByteFrequencyData(dataArray);
        
        return {
            bassEnergy: averageRange(dataArray, 20, 250, audioContext.sampleRate),
            midEnergy: averageRange(dataArray, 250, 2000, audioContext.sampleRate),
            trebleEnergy: averageRange(dataArray, 2000, 8000, audioContext.sampleRate),
        };
    }

    function getAudioContext() {
        return audioContext;
    }

    return {
        initAudio,
        createFilterChain,
        updateFilterGain,
        toggleBypass,
        attachAnalyser,
        analyzeSpectrum,
        getAudioContext
    };
})();

window.peqDSP = peqDSP;
