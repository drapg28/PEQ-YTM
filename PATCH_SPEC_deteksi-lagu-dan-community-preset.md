# Spesifikasi Perbaikan: Akurasi Deteksi Lagu & Community Presets — PEQ-YTM

> **Untuk AI Coding Agent:** Proyek ini (`drapg28/PEQ-YTM`) sudah punya implementasi dasar yang berjalan. Dokumen ini berisi perbaikan spesifik atas file yang sudah ada: `scripts/audio_dsp.js` dan `scripts/content.js`. Baca dulu isi kedua file itu sebelum mengedit — semua perbaikan di bawah ini adalah **patch atas kode existing**, bukan rewrite dari nol.

---

## 0. Ringkasan Masalah

Sistem auto-deteksi karakter lagu yang ada sekarang punya satu bug arsitektur kritis dan beberapa kelemahan akurasi yang sengaja dilonggarkan untuk demo hackathon (ada di komentar kode: `// Thresholds dikalibrasi untuk demo hackathon agar PASTI muncul`). Sekarang proyek sudah jadi, threshold itu perlu dikembalikan ke logika yang benar-benar akurat.

| # | Masalah | Lokasi | Prioritas |
|---|---|---|---|
| 1 | Analyser membaca sinyal **setelah** EQ, bukan sinyal mentah — menciptakan feedback loop | `audio_dsp.js` → `createFilterChain()` | **Kritis, perbaiki dulu** |
| 2 | Baseline analisis cuma diambil sekali di 5 detik pertama lagu, lalu berhenti selamanya | `content.js` → `startAnalysis()` | Tinggi |
| 3 | Threshold klasifikasi terlalu longgar (10%) dan pakai magnitude linear mentah, bukan proporsi/dB | `content.js` → `evaluateAndRecommend()` | Tinggi |
| 4 | Trigger analisis nempel di event `play`, bisa re-trigger saat pause/resume dalam lagu yang sama, bukan cuma saat ganti lagu | `content.js` → `handlePlayEvent()` | Sedang |
| 5 | Menambah preset komunitas ke `presets.json` | `data/presets.json` | Rendah (mudah, tapi ikuti aturan skema di Bagian 3) |

---

## 1. Perbaikan Kritis — Analyser Tap Position

### 1.1 Masalah
Di `audio_dsp.js`, urutan koneksi sekarang:
```javascript
previousNode.connect(compressorNode);
// ...
attachAnalyser(compressorNode);  // BUG: nempel setelah filter chain + compressor
```

Analyser membaca sinyal yang **sudah melewati EQ user**. Konsekuensinya: kalau user sedang pakai preset "Bass Boost" (band bass +6dB), lagu apapun yang diputar berikutnya akan terbaca "bass-heavy" oleh analyser — bukan karena lagunya memang bass-heavy, tapi karena EQ-nya sendiri yang menaikkan energi itu sebelum masuk analyser. Sistem jadi merekomendasikan preset yang **sedang aktif**, bukan preset yang cocok untuk lagu.

### 1.2 Perbaikan
Tap analyser dari `sourceNode` secara paralel — sebelum masuk preamp/filter chain — bukan dari ujung chain.

```javascript
function initAudio(mediaElement) {
    // ... kode yang sudah ada, tidak berubah sampai sourceNode dibuat ...

    // TAMBAHKAN: attach analyser langsung ke sourceNode (sinyal mentah),
    // paralel dan tidak mengganggu jalur utama ke preamp/filter.
    attachAnalyser(sourceNode);

    return true;
}
```

Dan di `createFilterChain()`, **hapus** baris `attachAnalyser(compressorNode)` — analyser sudah di-attach sekali di `initAudio()`, tidak perlu di-reattach tiap kali filter chain dibangun ulang.

```javascript
function attachAnalyser(source) {
    if (!audioContext) return null;
    if (!analyserNode) {
        analyserNode = audioContext.createAnalyser();
        analyserNode.fftSize = 2048;
        analyserNode.smoothingTimeConstant = 0.6; // TAMBAHKAN: smoothing agar hasil tidak terlalu jittery antar-frame
    }
    // Catatan: sourceNode.connect(analyserNode) TIDAK memutus sourceNode.connect(preampNode)
    // yang lain — Web Audio API mengizinkan satu node output ke banyak tujuan sekaligus.
    source.connect(analyserNode);
    return analyserNode;
}
```

**Verifikasi setelah perubahan ini:** nyalakan preset bass-heavy secara manual, lalu putar lagu yang jelas vocal-forward (misal akapela). Rekomendasi yang muncul harus tetap "Vocal Clarity", **bukan** "Bass Boost" — ini bukti analyser sudah membaca sinyal asli, bukan sinyal yang sudah di-EQ.

---

## 2. Perbaikan — Analisis Berkelanjutan, Bukan Sekali di Awal

### 2.1 Masalah
Di `content.js`, `startAnalysis()` cuma mengumpulkan 10 sample (5 detik pertama lagu) lalu berhenti total. Dua masalah dari ini:
- Kalau 5 detik pertama kebetulan intro sepi/silence/hanya ambience, baseline yang terbentuk salah total untuk sisa lagu.
- Kalau karakter lagu berubah signifikan di tengah (misal ada bagian akustik lalu masuk drop electronic), rekomendasi tidak pernah update.

### 2.2 Perbaikan
Ganti dari "one-shot baseline" menjadi **rolling window** dengan hysteresis (supaya tidak flapping/berubah-ubah rekomendasi tiap 500ms).

```javascript
function startAnalysis() {
    if (analysisInterval) clearInterval(analysisInterval);

    const WINDOW_SIZE = 16;           // ~8 detik rolling window (16 x 500ms)
    const STABLE_READS_REQUIRED = 6;  // klasifikasi harus konsisten 6x berturut sebelum direkomendasikan
    let spectrumBuffer = [];
    let lastRecommendedPreset = null;
    let consecutiveMatchCount = 0;

    analysisInterval = setInterval(() => {
        if (!isGraphBuilt || !window.peqDSP || state.isBypassed) return;

        const current = window.peqDSP.analyzeSpectrum();
        if (!current) return;

        // Lewati baca yang nyaris silent (misal jeda antar-lagu) — hindari baseline dari noise lantai
        const totalEnergy = current.bassEnergy + current.midEnergy + current.trebleEnergy;
        if (totalEnergy < 5) return; // threshold minimal, kalibrasi manual sesuai fftSize/smoothing yang dipakai

        spectrumBuffer.push(current);
        if (spectrumBuffer.length > WINDOW_SIZE) spectrumBuffer.shift();

        // Hanya evaluasi setelah window cukup terisi
        if (spectrumBuffer.length < WINDOW_SIZE) return;

        const avg = {
            bass: spectrumBuffer.reduce((s, v) => s + v.bassEnergy, 0) / WINDOW_SIZE,
            mid: spectrumBuffer.reduce((s, v) => s + v.midEnergy, 0) / WINDOW_SIZE,
            treble: spectrumBuffer.reduce((s, v) => s + v.trebleEnergy, 0) / WINDOW_SIZE,
        };

        const candidate = classifySpectrum(avg);

        if (candidate.presetId === lastRecommendedPreset) {
            consecutiveMatchCount++;
        } else {
            lastRecommendedPreset = candidate.presetId;
            consecutiveMatchCount = 1;
        }

        // Hanya munculkan rekomendasi kalau klasifikasi stabil beberapa kali berturut-turut
        if (consecutiveMatchCount === STABLE_READS_REQUIRED) {
            evaluateAndRecommend(candidate);
        }
    }, 500);
}
```

Ini menggantikan logika `readCount < 10` yang lama sepenuhnya.

---

## 3. Perbaikan — Threshold & Metode Klasifikasi

### 3.1 Masalah
Kode sekarang:
```javascript
if (spectrum.bass > spectrum.mid * 1.1) { ... }
```
Dua kelemahan:
- **Selisih 10% terlalu sensitif ke noise.** Musik pada umumnya memang punya distribusi energi natural yang miring ke bass/low-mid (karakteristik alami instrumen akustik & produksi musik modern), jadi threshold longgar akan salah mengklasifikasi lagu "normal" sebagai bass-heavy.
- **Perbandingan pakai magnitude byte mentah (0-255 linear)**, bukan proporsi terhadap total energi. Lagu yang lebih loud secara keseluruhan bisa "menang" di semua band dan salah diklasifikasi.

### 3.2 Perbaikan
Normalisasi ke proporsi (persentase dari total energi), lalu bandingkan proporsi itu terhadap baseline referensi musik pada umumnya — bukan cuma bandingkan band satu sama lain secara langsung.

```javascript
// Baseline referensi: distribusi energi "rata-rata" musik pop/umum.
// Angka ini AWAL, WAJIB dikalibrasi manual dengan memutar 8-10 lagu representatif
// dan mencatat rata-rata proporsi aktualnya sebelum dipakai sebagai acuan produksi.
const REFERENCE_PROFILE = { bass: 0.42, mid: 0.38, treble: 0.20 };
const DEVIATION_THRESHOLD = 0.12; // proporsi harus menyimpang >12 poin persen dari referensi untuk dianggap signifikan

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

    // Pilih deviasi terbesar yang melewati threshold
    const candidates = [
        { key: 'bass', value: deviation.bass, presetId: 'bass_boost', message: 'Lagu ini bass-heavy. Coba preset Bass Boost?' },
        { key: 'mid', value: deviation.mid, presetId: 'vocal_clarity', message: 'Vokal mendominasi. Coba preset Vocal Clarity?' },
        { key: 'treble', value: deviation.treble, presetId: 'tactical_audio', message: 'Detail high-end tajam. Coba Tactical Audio?' },
    ];

    const strongest = candidates.reduce((max, c) => (c.value > max.value ? c : max), candidates[0]);

    if (strongest.value > DEVIATION_THRESHOLD) {
        return strongest;
    }

    return { presetId: null, message: '' }; // JANGAN paksa selalu ada rekomendasi — lagu "flat" ya tidak usah direkomendasikan apa-apa
}
```

**Perubahan penting dari kode lama:** kalau lagu memang seimbang/flat, fungsi ini mengembalikan `null` — tidak dipaksa selalu punya rekomendasi seperti `else` block di kode lama (`recommendedPreset = 'vocal_clarity'` sebagai fallback default). Fallback paksa itu yang bikin akurasi terasa rendah karena rekomendasi muncul bahkan saat sebenarnya tidak ada yang perlu direkomendasikan.

Update `evaluateAndRecommend()` untuk menerima objek hasil `classifySpectrum()` langsung dan skip kalau `presetId` adalah `null`:
```javascript
function evaluateAndRecommend(candidate) {
    if (!candidate.presetId) return; // lagu flat, tidak ada rekomendasi

    const recommendation = { presetId: candidate.presetId, message: candidate.message };
    state.recommendation = recommendation;
    chrome.runtime.sendMessage({ action: "NEW_RECOMMENDATION", data: recommendation }).catch(() => {});
}
```

---

## 4. Perbaikan — Trigger Analisis per Ganti Lagu, Bukan per Event `play`

### 4.1 Masalah
`handlePlayEvent()` terpasang di event `play` elemen video. Event ini bisa fire ulang saat user pause lalu resume lagu yang sama (bukan cuma saat lagu benar-benar berganti), menyebabkan `startAnalysis()` dipanggil ulang dan buffer rolling window di Bagian 2 ter-reset tanpa perlu.

### 4.2 Perbaikan
Deteksi pergantian lagu sungguhan dengan membandingkan title tab atau metadata lagu, bukan cuma event `play`.

```javascript
let lastTrackIdentifier = null;

function getCurrentTrackIdentifier() {
    // YouTube Music selalu update document.title jadi "Judul Lagu - Artis" saat lagu berganti
    return document.title;
}

function handlePlayEvent() {
    if (!window.peqDSP) return;
    const success = window.peqDSP.initAudio(videoElement);
    if (success) {
        // ... kode resume AudioContext & createFilterChain yang sudah ada, tidak berubah ...

        const currentTrack = getCurrentTrackIdentifier();
        const isNewTrack = currentTrack !== lastTrackIdentifier;
        lastTrackIdentifier = currentTrack;

        // Hanya restart analisis dari nol kalau memang lagu baru,
        // biar pause/resume lagu yang sama tidak reset rolling window
        if (isNewTrack) {
            startAnalysis();
        }
    } else {
        console.error('[PEQ] Gagal attach Web Audio API ke video.');
    }
}
```

**Catatan:** kalau `document.title` di YTM tidak selalu update secara reliable (perlu diverifikasi manual di browser sungguhan), alternatif adalah cek elemen metadata lagu di DOM (misal selector judul lagu di player bar) — tapi ini lebih rapuh terhadap perubahan struktur DOM YTM. `document.title` biasanya lebih stabil karena dipakai juga oleh tab browser.

---

## 5. Menambah Preset Komunitas

### 5.1 Sumber yang Direkomendasikan
Untuk preset berbasis pengukuran IEM/headphone nyata (bukan tebakan), sumber yang **secara khusus dirancang untuk parametric EQ** (cocok dengan engine 10-band peaking/shelf yang sudah dipakai proyek ini) adalah proyek **AutoEQ** — database open-source berisi hasil pengukuran & filter parametric EQ untuk ribuan model IEM/headphone, dibangun dari data pengukuran komunitas (termasuk Crinacle, dan reviewer lain).

**Sebelum agent mengambil data apapun dari sumber eksternal:**
1. Cek lisensi repo sumber saat itu juga (lisensi proyek open-source bisa berubah) — jangan asumsikan bebas pakai tanpa verifikasi.
2. Kalau lisensi mengharuskan atribusi, cantumkan kredit di README proyek ini (misal bagian "Preset Credits" yang menyebutkan sumber data pengukuran).
3. **Jangan copy-paste nilai coefficient parametric EQ mentah-mentah** kalau format sumbernya beda jumlah band/tipe filter dari engine ini (AutoEQ biasanya pakai kombinasi band lebih banyak dengan Q bervariasi per band). Engine proyek ini tetap di 10 band tetap dengan Q seragam 1.41 — nilai gain per band harus **diperkirakan ulang / disederhanakan** ke 10 titik frekuensi tetap (31/62/125/250/500/1000/2000/4000/8000/16000 Hz) milik proyek ini, bukan dipindah 1:1.

### 5.2 Format Penambahan ke `presets.json`
Ikuti skema yang sudah dipakai proyek ini (dilihat dari cara `content.js` memanggil `APPLY_PRESET` dengan `request.bands` array 10 elemen dan `request.presetId` string). Tambahkan entri baru dengan struktur yang sama seperti preset yang sudah ada di file, contoh pola:

```json
{
  "id": "community_harman_ish",
  "name": "Harman-ish Target",
  "description": "Adaptasi dari kurva referensi target komunitas, disederhanakan ke 10 band tetap",
  "bands": [3, 2, 0, -1, -1.5, -1, 0, 1, 2, 1],
  "source": "Nama sumber komunitas + link, dicatat untuk atribusi"
}
```

Field `source` **baru** — tambahkan ke skema kalau belum ada, supaya tiap preset komunitas punya jejak asalnya (penting untuk atribusi & untuk debugging kalau ternyata suatu preset kedengaran aneh, gampang lacak sumbernya).

### 5.3 Validasi Wajib Sebelum Preset Komunitas Dipakai
- **Dengarkan langsung** hasil preset di lagu referensi yang sudah dites sebelumnya — jangan asumsikan angka dari sumber otomatis terdengar benar setelah disederhanakan ke 10 band.
- Cek total gain tertinggi antar-band tidak melebihi headroom yang sudah ditangani `compressorNode` (threshold `-1.0dB`, ratio `12`) — preset dengan boost ekstrem di banyak band sekaligus tetap berisiko terdengar over-compressed meski tidak clipping.
- Preset komunitas sebaiknya diberi label jelas di UI (misal badge "Community") supaya user paham ini beda dari preset kurasi proyek sendiri.

---

## 6. Urutan Pengerjaan yang Disarankan

1. Perbaikan Bagian 1 (posisi analyser) — **paling kritis, kerjakan dan verifikasi dulu sebelum lanjut**, karena semua perbaikan akurasi lain di bawahnya percuma kalau input datanya masih bias oleh EQ sendiri.
2. Perbaikan Bagian 3 (threshold & normalisasi proporsi) — dampak langsung ke akurasi klasifikasi.
3. Perbaikan Bagian 2 (rolling window + hysteresis) — mengurangi rekomendasi yang flapping/berubah-ubah.
4. Perbaikan Bagian 4 (deteksi ganti lagu yang lebih presisi) — penyempurnaan, bukan blocker.
5. Bagian 5 (community presets) — independen, bisa dikerjakan kapan saja, tidak bergantung ke bagian lain.

Setelah tiap bagian selesai, uji manual dengan skenario yang sama dari catatan verifikasi di Bagian 1.2 (nyalakan preset ekstrem, lalu putar lagu dengan karakter berlawanan, pastikan rekomendasi tetap sesuai lagu bukan sesuai EQ yang sedang aktif).
