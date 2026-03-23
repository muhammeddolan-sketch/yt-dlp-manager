#!/bin/bash

# YT-DLM Pro v1.4.6 - Otomatik Kurulum ve Paketleme Asistanı
# Bu betik bağımlılıkları kontrol eder ve uygulamayı paketler.

clear
echo "===================================================="
echo "      YT-DLM Pro - Otomatik Kurulum Asistanı        "
echo "===================================================="
echo ""

# 1. Bağımlılık Kontrolü
echo "[1/4] Sistem bağımlılıkları kontrol ediliyor..."

command -v node >/dev/null 2>&1 || { echo >&2 "Hata: Node.js kurulu değil. Lütfen önce Node.js yükleyin."; exit 1; }
command -v npm >/dev/null 2>&1 || { echo >&2 "Hata: NPM kurulu değil."; exit 1; }

# YT-DLP ve FFMPEG Kontrolü (Debian/Ubuntu tabanlı sistemler için)
if ! command -v yt-dlp >/dev/null 2>&1 || ! command -v ffmpeg >/dev/null 2>&1; then
    echo "Eksik bağımlılıklar bulundu (yt-dlp veya ffmpeg). Yüklemek için şifre istenebilir..."
    sudo apt update && sudo apt install -y yt-dlp ffmpeg
else
    echo "✓ yt-dlp ve ffmpeg hazır."
fi

# 2. NPM Paketlerini Yükle
echo ""
echo "[2/4] Uygulama kütüphaneleri yükleniyor (npm install)..."
npm install

# 3. Uygulamayı Paketle (Distribute)
echo ""
echo "[3/4] Uygulama paketleniyor (setup dosyaları oluşturuluyor)..."
echo "Bu işlem biraz zaman alabilir, lütfen bekleyin..."
npm run dist

# 4. Sonuçları Göster
echo ""
echo "===================================================="
echo "             KURULUM TAMAMLANDI!                    "
echo "===================================================="
echo ""
echo "Kurulum dosyaları (setup) 'dist' klasörüne başarıyla oluşturuldu:"
echo ""
echo "1. Deb Paketi (Kurulum için çift tıklayın):"
echo "   $(ls dist/*.deb 2>/dev/null)"
echo ""
echo "2. AppImage (Kurmadan çalıştırmak için):"
echo "   $(ls dist/*.AppImage 2>/dev/null)"
echo ""
echo "İpucu: .deb dosyasını 'sudo dpkg -i dist/*.deb' komutuyla da kurabilirsin."
echo "===================================================="
