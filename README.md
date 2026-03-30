[README.md](https://github.com/user-attachments/files/26361764/README.md)
# 🚢 Amiral Battı — 3D Multiplayer

Socket.io tabanlı gerçek zamanlı multiplayer Amiral Battı oyunu.

## Dosyalar
```
battleship/
├── server.js        ← Node.js + Socket.io backend
├── package.json     ← Bağımlılıklar
└── public/
    └── index.html   ← Oyun arayüzü
```

---

## 🚀 Railway'e Deploy (Ücretsiz)

### Adım 1 — GitHub'a yükle
1. [github.com](https://github.com) → **New repository** → `amiral-batti`
2. Bu 3 dosyayı (server.js, package.json, public/index.html) yükle
   - `public/` klasörü oluşturmayı unutma

### Adım 2 — Railway'e bağla
1. [railway.app](https://railway.app) → **Start a New Project**
2. **Deploy from GitHub repo** seç
3. Az önce oluşturduğun repo'yu seç
4. Railway otomatik olarak `npm start` çalıştırır

### Adım 3 — URL al
1. Deploy tamamlandıktan sonra **Settings → Domains → Generate Domain**
2. Sana `xxx.up.railway.app` gibi bir link verir
3. Bu linki arkadaşlarınla paylaş — hepiniz aynı anda oynayabilirsiniz!

---

## 🎮 Nasıl Oynanır

1. Bir oyuncu **Oda Oluştur** → 2/3/4 oyuncu seçer
2. **6 haneli kodu** arkadaşlarına gönderir
3. Diğerleri kodu girerek katılır
4. Host **Oyunu Başlat** der
5. Herkes kendi gemilerini yerleştirir (veya Rastgele)
6. Sırayla ateş edilir → en son ayakta kalan kazanır!

---

## Lokal Test
```bash
npm install
npm start
# → http://localhost:3000
```
