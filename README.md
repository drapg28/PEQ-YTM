# YTM PEQ (Hackathon Edition) 🎧

Ekstensi Chrome cerdas yang memberikan kontrol penuh atas kualitas audio di YouTube Music melalui **10-Band Parametric EQ**, lengkap dengan fitur cerdas **Auto-Analisis Spektrum**.

## ✨ Fitur Unggulan

- 🎚️ **10-Band Parametric EQ**: Kontrol frekuensi presisi dari 31Hz hingga 16kHz menggunakan Web Audio API murni. Transisi *gain* yang sangat mulus tanpa *audio popping/crackling*.
- 🧠 **Smart Auto-Analysis**: Mengekstrak profil spektrum dari 5 detik pertama setiap lagu dan memberikan notifikasi cerdas berisi rekomendasi *preset* yang paling cocok (*Wow Moment*).
- 💾 **State Persistence**: Pengaturan EQ Anda otomatis tersimpan per-tab.
- 🛡️ **Headroom Protection**: Modul *Dynamics Compressor* internal memastikan suara tidak akan terdistorsi (pecah) meskipun *slider* didorong hingga batas maksimal +12dB.
- ⚡ **Instant Bypass**: Tombol *Bypass* *real-time* untuk membandingkan hasil modifikasi dengan audio orisinal secara instan.
- 🎨 **Sleek UI**: Desain *Dark Mode* profesional dengan *slider* vertikal bergaya aplikasi *mixing* studio.

## 🚀 Cara Instalasi & Penggunaan

1. *Clone* atau *Download* repositori ini ke komputer Anda: 
   ```bash
   git clone https://github.com/drapg28/PEQ-YTM.git
   ```
2. Buka Google Chrome dan navigasikan ke URL: `chrome://extensions/`
3. Nyalakan **Developer mode** (toggle di sudut kanan atas).
4. Klik tombol **Load unpacked**, kemudian pilih folder hasil *clone*/*download* tadi.
5. Buka tab baru menuju [YouTube Music](https://music.youtube.com) dan putar lagu apa saja.
6. Klik ikon ekstensi **YTM PEQ** di pojok kanan atas Chrome, dan rasakan bedanya!

## 🛠️ Arsitektur & Teknologi
- **Manifest V3** Chrome Extension Architecture
- Vanilla JavaScript (Tanpa Framework tambahan)
- **Web Audio API** (`MediaElementSource`, `BiquadFilterNode`, `AnalyserNode`, `DynamicsCompressorNode`)
- SPA DOM Observer untuk YouTube Music

---
*Dikembangkan secara khusus untuk Hackathon 2026* 🚀
