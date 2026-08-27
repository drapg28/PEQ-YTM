const FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const LABELS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
let presetsData = {};
let activeTabId = null;

// Debounce helper
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

async function init() {
    // 1. Dapatkan active tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) return;
    activeTabId = tabs[0].id;

    // 2. Load presets dari data/presets.json
    try {
        const response = await fetch(chrome.runtime.getURL('data/presets.json'));
        const data = await response.json();
        presetsData = data.presets.reduce((acc, p) => { acc[p.id] = p; return acc; }, {});
        populatePresetDropdown(data.presets);
    } catch (e) {
        console.error("Gagal load presets", e);
    }
    
    renderSliders();

    // 3. Minta live state dari content script
    chrome.tabs.sendMessage(activeTabId, { action: "GET_STATE" }, (response) => {
        if (chrome.runtime.lastError) {
            console.log("Content script belum aktif (mungkin bukan tab YTM).", chrome.runtime.lastError.message);
            disableUI();
            return;
        }
        if (response) {
            syncUI(response);
        }
    });

    // 4. Setup listeners
    document.getElementById('bypass-btn').addEventListener('click', toggleBypass);
    document.getElementById('preset-dropdown').addEventListener('change', handlePresetChange);

    // 5. Dengarkan pesan Rekomendasi (Fase 4)
    chrome.runtime.onMessage.addListener((request) => {
        if (request.action === "NEW_RECOMMENDATION") {
            showRecommendationToast(request.data);
        }
    });
}

function showRecommendationToast(data) {
    if (!data) return;
    const toast = document.getElementById('toast');
    toast.innerHTML = `
        <div style="margin-bottom: 8px;">${data.message}</div>
        <button id="apply-rec-btn" style="background:white; color:#2196F3; border:none; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:11px; font-weight:bold; width:100%;">Terapkan Preset</button>
    `;
    toast.classList.remove('hidden');
    
    document.getElementById('apply-rec-btn').addEventListener('click', () => {
        const dropdown = document.getElementById('preset-dropdown');
        dropdown.value = data.presetId;
        dropdown.dispatchEvent(new Event('change'));
        toast.classList.add('hidden');
    });
    
    // Auto hide
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 8000);
}

function disableUI() {
    document.getElementById('bypass-btn').disabled = true;
    document.getElementById('preset-dropdown').disabled = true;
    document.querySelector('.eq-container').style.opacity = '0.3';
    document.querySelector('.eq-container').style.pointerEvents = 'none';
}

function populatePresetDropdown(presets) {
    const dropdown = document.getElementById('preset-dropdown');
    presets.forEach(p => {
        const option = document.createElement('option');
        option.value = p.id;
        option.textContent = p.name;
        dropdown.appendChild(option);
    });
}

function renderSliders() {
    const container = document.querySelector('.eq-container');
    
    FREQUENCIES.forEach((freq, i) => {
        const bandDiv = document.createElement('div');
        bandDiv.className = 'band';

        const valLabel = document.createElement('div');
        valLabel.className = 'band-value';
        valLabel.id = `val-${i}`;
        valLabel.textContent = '0.0';

        const sliderContainer = document.createElement('div');
        sliderContainer.className = 'slider-container';

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '-12';
        slider.max = '12';
        slider.step = '0.1';
        slider.value = '0';
        slider.id = `slider-${i}`;
        
        // Spek 4.2: Event 'input' (bukan change) agar kontinu real-time
        slider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            // Tambah simbol + jika positif
            document.getElementById(`val-${i}`).textContent = val > 0 ? `+${val.toFixed(1)}` : val.toFixed(1);
            
            // Langsung kirim (tanpa debounce) ke in-memory filter
            chrome.tabs.sendMessage(activeTabId, { action: "UPDATE_GAIN", band: i, value: val });
            
            // Ubah dropdown ke custom
            document.getElementById('preset-dropdown').value = 'custom';
            
            // Debounce save ke storage persistence
            debouncedSave();
        });

        sliderContainer.appendChild(slider);

        const freqLabel = document.createElement('div');
        freqLabel.className = 'band-label';
        freqLabel.textContent = LABELS[i];

        bandDiv.appendChild(valLabel);
        bandDiv.appendChild(sliderContainer);
        bandDiv.appendChild(freqLabel);
        
        container.appendChild(bandDiv);
    });
}

const debouncedSave = debounce(() => {
    // Ambil state terkini dan simpan ke chrome.storage
    chrome.tabs.sendMessage(activeTabId, { action: "GET_STATE" }, (state) => {
        if (state) {
            chrome.storage.local.set({ [`peq_state_${activeTabId}`]: state });
        }
    });
}, 400);

function syncUI(state) {
    setBypassUI(state.isBypassed);

    state.gains.forEach((gain, i) => {
        const slider = document.getElementById(`slider-${i}`);
        if (slider) {
            slider.value = gain;
            document.getElementById(`val-${i}`).textContent = gain > 0 ? `+${gain.toFixed(1)}` : gain.toFixed(1);
        }
    });

    if (state.presetId) {
        document.getElementById('preset-dropdown').value = state.presetId;
    } else {
        document.getElementById('preset-dropdown').value = 'custom';
    }

    if (state.recommendation) {
        showRecommendationToast(state.recommendation);
        // Hapus dari state agar tidak muncul lagi terus-menerus
        chrome.tabs.sendMessage(activeTabId, { action: "CLEAR_RECOMMENDATION" });
    }
}

function toggleBypass() {
    const btn = document.getElementById('bypass-btn');
    const isCurrentlyBypassed = btn.classList.contains('bypassed');
    const newState = !isCurrentlyBypassed;
    
    chrome.tabs.sendMessage(activeTabId, { action: "TOGGLE_BYPASS", bypass: newState }, (res) => {
        if (res && res.success) {
            setBypassUI(newState);
            debouncedSave();
        }
    });
}

function setBypassUI(isBypassed) {
    const btn = document.getElementById('bypass-btn');
    if (isBypassed) {
        btn.classList.remove('active');
        btn.classList.add('bypassed');
        btn.textContent = 'EQ BYPASS';
    } else {
        btn.classList.remove('bypassed');
        btn.classList.add('active');
        btn.textContent = 'EQ ON';
    }
}

function handlePresetChange(e) {
    const presetId = e.target.value;
    if (presetId === 'custom') return;

    const preset = presetsData[presetId];
    if (preset) {
        chrome.tabs.sendMessage(activeTabId, { action: "APPLY_PRESET", presetId: presetId, bands: preset.bands }, (res) => {
            if (res && res.success) {
                syncUI({ isBypassed: false, gains: preset.bands, presetId: presetId });
                debouncedSave();
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', init);
