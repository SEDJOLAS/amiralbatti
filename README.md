# ⚓ AMİRAL BATTI — 4 Oyunculu Multiplayer

Gerçek zamanlı, 2-4 oyunculu Amiral Battı oyunu. Node.js + Socket.io ile çalışır.

---

## 🚀 Railway'e Deploy (Adım Adım)

### 1. GitHub'a Yükle

```bash
git init
git add .
git commit -m "ilk commit"
git branch -M main
git remote add origin https://github.com/KULLANICI_ADI/amiral-batti.git
git push -u origin main
```

### 2. Railway'de Proje Oluştur

1. [railway.app](https://railway.app) → **New Project**
2. **Deploy from GitHub repo** seç
3. Bu repoyu seç → **Deploy Now**
4. Railway otomatik olarak `node server.js` komutunu çalıştırır

### 3. Domain Al (Ücretsiz)

1. Railway dashboard → projen → **Settings**
2. **Domains** sekmesi → **Generate Domain**
3. `xxx.railway.app` gibi bir URL alırsın
4. Bu URL'yi arkadaşlarınla paylaş!

---

## 🎮 Nasıl Oynanır?

| Adım | Açıklama |
|------|----------|
| 1 | Bir oyuncu **ODA OLUŞTUR** tıklar, isim girer |
| 2 | 5 haneli oda kodunu arkadaşlarına gönderir |
| 3 | Diğerleri **ODAYA KATIL** ile kodu girer |
| 4 | Host **BAŞLAT** tıklar (en az 2 oyuncu olmalı) |
| 5 | Herkes gemilerini yerleştirir |
| 6 | Sırayla ateş edilir — kim batırmaz batar! |

### Oyun Mekaniği
- **İsabet** → aynı oyuncu tekrar ateş eder
- **Iskalama** → sıra bir sonraki oyuncuya geçer
- **Gemi batırma** → düşman karttan düşer, sıra devam eder
- **Son hayatta kalan** kazanır!

---

## 💻 Yerel Geliştirme

```bash
npm install
npm start
# http://localhost:3000
```

---

## 📁 Proje Yapısı

```
amiral-batti/
├── server.js          # Socket.io sunucu
├── public/
│   └── index.html     # Oyun arayüzü
├── package.json
├── railway.json
└── .gitignore
```
