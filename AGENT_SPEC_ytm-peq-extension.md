# Spesifikasi Proyek: Ekstensi Chrome PEQ 10-Band untuk YouTube Music

> **Untuk AI Coding Agent:** Dokumen ini adalah spesifikasi teknis lengkap. Ikuti urutan prioritas di Bagian 0 secara ketat. Jangan lompat ke fitur "Differentiator" sebelum "Must-Have" berfungsi sempurna dan sudah diuji manual di YouTube Music asli.

---

## 0. Prioritas Eksekusi (WAJIB DIIKUTI URUT)

Proyek ini dikerjakan untuk hackathon dengan waktu terbatas. Bangun dan **verifikasi tiap tingkat sebelum lanjut ke tingkat berikutnya**:

| Tingkat | Isi | Kriteria "Selesai" |
|---|---|---|
| **1. Must-Have** | Core EQ engine + bypass + 3-5 preset manual | EQ terdengar jelas berubah saat slider digeser, bypass toggle instan, tidak crash saat ganti lagu berkali-kali |
| **2. Differentiator** | Auto-analisis spektrum + saran preset otomatis + visualizer | Saran preset muncul otomatis dalam <2 detik setelah lagu berganti karakter |
| **3. Polish** | UI dark mode rapi, animasi, persistensi state, error handling graceful | Tidak ada console error, popup selalu sinkron dengan state audio nyata |
| **4. Skip untuk hackathon** | Backend cloud, autentikasi, cross-browser | JANGAN kerjakan kecuali tingkat 1-3 sudah 100% selesai |

---

## 1. Struktur Direktori

```
/ytm-peq-extension
├── manifest.json
├── background.js           # Service worker, minimal — hanya lifecycle events
├── scripts/
│   ├── content.js          # Injeksi DOM, inisialisasi AudioContext, message listener
│   └── audio_dsp.js        # Murni logika BiquadFilterNode, tidak menyentuh DOM/UI
├── ui/
│   ├── popup.html
│   ├── popup.css           # Dark mode
│   └── popup.js            # Controller UI, kirim/terima pesan ke content.js
└── data/
    └── presets.json         # Preset EQ bawaan
```

**Aturan pemisahan tanggung jawab (WAJIB dipatuhi):**
- `audio_dsp.js` **tidak boleh** memanggil `document.*` atau `chrome.*` — murni fungsi Web Audio API.
- `content.js` yang mengorkestrasi: ambil elemen video, panggil fungsi dari `audio_dsp.js`, dengarkan pesan dari popup.
- `popup.js` **tidak pernah** jadi source of truth untuk state audio — popup unmount total setiap kali ditutup, jadi state harus selalu ditanya ulang ke `content.js` saat popup dibuka.

---

## 2. Fase 1 — Core Audio Engine (`audio_dsp.js` + `content.js`)

### 2.1 Signal Chain
```
MediaElementSource → GainNode (Preamp) → 10x BiquadFilterNode → AnalyserNode (paralel, non-blocking) → destination
```

Band pertama: `lowshelf`. Band terakhir: `highshelf`. 8 band tengah: `peaking`.

**Frekuensi band — gunakan standar ISO octave, BUKAN angka bebas:**
```
31 Hz, 62 Hz, 125 Hz, 250 Hz, 500 Hz, 1000 Hz, 2000 Hz, 4000 Hz, 8000 Hz, 16000 Hz
```
Q default untuk band peaking: **1.41** (spacing satu oktaf). Ini titik awal aman — jangan pakai Q sangat sempit (ripple) atau sangat lebar (interferensi antar-band).

### 2.2 Fungsi yang harus diimplementasikan di `audio_dsp.js`

```javascript
createFilterChain(presetData)       // bangun 10 BiquadFilterNode + preamp, return referensi chain
updateFilterGain(bandIndex, newGain) // update .gain.value real-time, TIDAK re-build chain
toggleBypass()                       // reroute: source langsung ke destination, skip semua filter
attachAnalyser(sourceNode, ctx)      // tap paralel untuk visualisasi & auto-analisis (lihat Bagian 5)
```

### 2.3 Gotcha Kritis — WAJIB ditangani, ini penyebab #1 kegagalan demo

1. **Video element YTM bisa berganti (SPA re-render).** YouTube Music kadang me-recreate `<video>` saat pindah context. Pasang `MutationObserver` pada container player untuk mendeteksi elemen video diganti, lalu rebuild graph. Jangan simpan referensi video sebagai variabel sekali-set.

2. **`createMediaElementSource()` bersifat one-shot.** Elemen yang sudah "ditangkap" oleh satu `AudioContext` tidak bisa ditangkap ulang tanpa reload. Cek dulu apakah source node sudah ada sebelum membuat baru — jika sudah ada, jangan panggil ulang (akan throw `InvalidStateError`).

3. **Setelah `createMediaElementSource()`, output native mati total** sampai kamu eksplisit `.connect(destination)` di ujung chain. Jangan lupa ini atau audio jadi bisu total.

4. **AudioContext dimulai dalam state `suspended`.** Panggil `.resume()` di dalam handler klik tombol play YTM ASLI (bukan cuma tombol di popup ekstensi) — karena user sering klik play YTM duluan sebelum pernah membuka popup ekstensi.

5. **Selector DOM harus paling generik mungkin.** Gunakan `document.querySelector('video')` polos (YTM hanya punya satu elemen video utama). Jangan bergantung pada class name spesifik YTM karena mereka sering ganti struktur DOM tanpa notifikasi.

---

## 3. Fase 2 — State Management & IPC

### 3.1 Aturan Source of Truth
- **State audio real-time** (nilai gain tiap band, status bypass) → live di memory `content.js`, karena dia yang pegang `AudioContext` aktif.
- **`chrome.storage.local`** → hanya untuk *persistence*, dipakai untuk restore state saat tab baru / content script pertama kali di-inject. **Bukan** untuk sinkronisasi live popup ↔ content.
- State di-key per `tabId` (karena user bisa buka banyak tab YTM sekaligus). Jangan pakai satu state global kecuali memang didesain sengaja untuk itu.

### 3.2 Alur saat popup dibuka
```
popup.js → chrome.tabs.sendMessage(tabId, {action: "GET_STATE"})
content.js → balas state LIVE dari memory (bukan dari storage)
popup.js → render slider sesuai state yang diterima
```

### 3.3 Format pesan
```javascript
{ action: "UPDATE_GAIN", band: 4, value: 1.5 }
{ action: "TOGGLE_BYPASS" }
{ action: "GET_STATE" }
{ action: "APPLY_PRESET", presetId: "vocal_boost" }
```

### 3.4 Performa — Debounce write ke storage
- Update `BiquadFilterNode.gain.value` → **langsung**, tiap event `input` slider, tanpa debounce (murah, in-memory).
- Write ke `chrome.storage.local` → **debounce 300-500ms** setelah slider berhenti bergerak. Jangan tulis storage di setiap event `input` mentah-mentah — bisa spam puluhan write per detik.

---

## 4. Fase 3 — UI (`popup.html`, `popup.css`, `popup.js`)

### 4.1 Komponen
- Header: nama preset aktif + tombol Toggle Bypass (harus punya state visual jelas: aktif = hijau/on, bypass = abu-abu/off)
- Body: 10 slider vertikal, range -12dB s/d +12dB, step 0.1dB
- Label frekuensi di bawah tiap slider: `31Hz 62Hz 125Hz 250Hz 500Hz 1k 2k 4k 8k 16k`
- Dropdown/tombol preset cepat

### 4.2 Event Binding
Gunakan event `input` (bukan `change`) pada slider agar message passing terkirim kontinu saat digeser, bukan hanya saat dilepas — ini penting agar user dengar perubahan real-time saat menggeser.

### 4.3 Styling
Dark mode. Referensi visual: aplikasi audio profesional (contoh mental model: EQ software desktop), bukan generic Bootstrap. Prioritaskan kontras tinggi untuk slider agar posisi gain mudah dibaca sekilas saat demo.

---

## 5. Fase 4 — Differentiator: Auto-Analisis Spektrum (WOW MOMENT)

Ini fitur pembeda utama untuk demo hackathon. Kerjakan **setelah** Fase 1-3 stabil.

### 5.1 Konsep
Tap `AnalyserNode` secara paralel dari signal chain (tidak mengganggu jalur EQ utama). Setiap ~500ms, hitung energi rata-rata di tiga region frekuensi, lalu bandingkan dengan energi lagu sebelumnya. Jika profil berubah signifikan, tampilkan notifikasi kecil di popup: *"Lagu ini bass-heavy, mau pakai preset 'Bass Boost'?"*

### 5.2 Implementasi
```javascript
function attachAnalyser(sourceNode, audioContext) {
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  sourceNode.connect(analyser); // paralel — TIDAK menggantikan koneksi ke filter chain

  const dataArray = new Uint8Array(analyser.frequencyBinCount);

  function analyzeSpectrum() {
    analyser.getByteFrequencyData(dataArray);
    return {
      bassEnergy: averageRange(dataArray, 20, 250, audioContext.sampleRate),
      midEnergy: averageRange(dataArray, 250, 2000, audioContext.sampleRate),
      trebleEnergy: averageRange(dataArray, 2000, 8000, audioContext.sampleRate),
    };
  }

  return { analyser, analyzeSpectrum };
}
```

- Jalankan `analyzeSpectrum()` tiap 500ms via `setInterval` di `content.js`, **bukan** `requestAnimationFrame` tiap frame (terlalu berat, tidak perlu presisi setinggi itu).
- Threshold perubahan signifikan: mulai dari selisih >20% energi rata-rata antar-region dibanding pembacaan sebelumnya, lalu kalibrasi manual dengan lagu uji.
- **Opsional (jika waktu cukup):** tambahkan `AnalyserNode` kedua yang datanya dikirim ke popup untuk visualisasi spectrum bar real-time — nilai jual visual tambahan saat demo.

### 5.3 Safety — Headroom Protection
Tambahkan `DynamicsCompressorNode` di ujung chain sebelum destination, atau hitung preamp otomatis berdasarkan total gain positif tertinggi dari semua band, supaya kombinasi boost banyak band tidak menyebabkan clipping/distorsi saat demo live.

---

## 6. Data Preset (`data/presets.json`)

### 6.1 Struktur
```json
{
  "presets": [
    {
      "id": "vocal_clarity",
      "name": "Vocal Clarity (J-Pop/Indie)",
      "description": "Boost presence 1-2.5kHz tanpa shoutiness",
      "bands": [0, 0, -1, 0, 0.5, 1.5, 2, 1, 0, 0]
    },
    {
      "id": "tactical_audio",
      "name": "Tactical Audio (Gaming)",
      "description": "Clarity untuk footstep/reload cues 4-8kHz",
      "bands": [0, 0, 0, 0, 0, 0.5, 1, 2.5, 2, 0.5]
    }
  ]
}
```

### 6.2 Aturan Desain Preset — PENTING
- Preset disimpan sebagai **delta koreksi**, bukan kurva target absolut. Ini supaya preset yang sama tetap masuk akal dikombinasikan dengan signature device apapun milik user, bukan hanya IEM referensi awal.
- Nilai gain di preset harus divalidasi dengan telinga sungguhan sebelum demo — dengarkan hasil kombinasi band, jangan asumsikan penjumlahan dB linear otomatis terdengar benar (filter berurutan bersifat multiplicative di domain magnitude).
- Sertakan minimal 3-5 preset dengan karakter **kontras jelas** (misal: satu vocal-forward, satu bass-heavy, satu flat/reference) supaya efeknya terdengar dramatis dalam demo singkat.

### 6.3 Catatan tentang klaim "directional audio" (gaming preset)
Boost 4-8kHz membantu **kejelasan/clarity** transient suara (langkah kaki, reload), tapi **tidak benar-benar menciptakan directionality** — itu produk dari ITD/ILD dan HRTF yang EQ sendirian tidak bisa perbaiki. Cantumkan ini sebagai catatan scope di README, jangan klaim preset ini "meningkatkan akurasi arah suara".

---

## 7. Manifest V3 — Poin Penting

- `permissions`: `["storage", "scripting"]`
- `host_permissions`: `["https://music.youtube.com/*"]`
- `content_scripts` inject di `music.youtube.com`, `run_at: "document_idle"`
- Gunakan `content_security_policy` yang mengizinkan `AudioWorklet` jika nanti diperlukan (opsional, tidak wajib untuk MVP karena `BiquadFilterNode` native cukup).

---

## 8. Checklist Sebelum Demo (H-1)

- [ ] Uji di device & browser yang **sama persis** dengan yang dipakai saat presentasi
- [ ] Uji ganti lagu berkali-kali cepat — pastikan tidak crash saat video element di-recreate YTM
- [ ] Siapkan 2 lagu demo dengan karakter kontras jelas (vokal-dominan vs bass-heavy) untuk showcase auto-analisis
- [ ] Rekam video demo cadangan (jaga-jaga koneksi venue buruk)
- [ ] Cek console — nol error sebelum submit
- [ ] Pastikan bypass toggle punya efek yang **jelas terdengar** dalam <1 detik (ini bagian paling sering dites juri langsung)

---

## 9. Yang JANGAN Dikerjakan (kecuali semua di atas sudah selesai)

- Backend FastAPI / cloud preset sharing — bagus untuk pitch "roadmap ke depan" di slide, tapi jangan diimplementasi kalau waktu terbatas
- Sistem autentikasi user
- Dukungan cross-browser (Firefox/Edge) — fokus Chrome saja untuk MVP
