# Import CSV iPos

## 1. Jalankan SQL di Supabase

Buka Supabase Dashboard -> SQL Editor, lalu jalankan seluruh isi file:

`supabase/replace_products_from_ipos.sql`

Fungsi ini hanya dapat dipanggil oleh pengguna yang sudah login. Fungsi menghapus dan memasukkan ulang data `products` dalam satu transaksi. Jika validasi atau INSERT gagal, transaksi dibatalkan sehingga data produk lama tetap utuh.

## 2. Jalankan aplikasi

```bash
npm install
npm run dev
```

Login ke aplikasi, lalu buka menu **Import CSV iPos** pada halaman Master Produk.

## 3. Impor

1. Pilih file ekspor CSV iPos.
2. Pastikan pratinjau menunjukkan jumlah produk dan contoh data yang benar.
3. Centang konfirmasi penggantian seluruh master produk.
4. Tekan tombol ganti seluruh master produk.

Format yang didukung: CSV delimiter titik koma (`;`) dengan header `Barcode`, `Nama Item`, dan `Stok`. Stok desimal koma seperti `1,00` akan dikonversi ke integer. Barcode kosong diperbolehkan.

## Catatan data historis

Tabel `stock_opname` dan `expired_dates` tidak dihapus oleh fungsi impor. Namun, aplikasi menyimpan riwayat berdasarkan SKU/barcode. Riwayat yang SKU-nya tidak ada pada daftar CSV baru tidak akan menemukan produk saat dicari berdasarkan SKU. Data produk baru mendapatkan ID baru dari kolom identity `products.id`.

Lakukan backup database sebelum impor produksi.
