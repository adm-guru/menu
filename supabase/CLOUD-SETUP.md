# SIAGA GURU v3.6 — Cloud Ready

Versi 3.6 belum memindahkan data ke cloud secara otomatis. Tujuannya adalah menyiapkan fondasi yang aman sebelum sinkronisasi multi-perangkat diaktifkan.

## Yang sudah siap

- IndexedDB tetap menjadi penyimpanan utama agar aplikasi tetap offline.
- Database lokal naik ke versi 9 dengan store `syncQueue`.
- Record administrasi memperoleh `cloudId`, `updatedAt`, dan `syncState`.
- Perubahan baru dapat masuk ke antrean saat mode **Cloud + Offline** aktif.
- Pengaturan menyediakan Supabase Project URL, anon/publishable key, kode sekolah, dan device ID.
- Tombol **Uji Koneksi** menguji endpoint REST Supabase.
- SQL awal tersedia di `supabase/001_siaga_cloud_schema.sql`.

## Sebelum sinkronisasi penuh

1. Buat project Supabase.
2. Aktifkan Supabase Auth.
3. Jalankan `001_siaga_cloud_schema.sql`.
4. Buat sekolah/workspace dan membership akun.
5. Gunakan hanya anon/publishable key di aplikasi browser.
6. Jangan pernah meletakkan service_role key di SIAGA GURU.
7. Setelah Auth + RLS diuji, barulah engine push/pull diaktifkan.


## v3.7 — Supabase Auth + Snapshot Sync

1. Jalankan `001_siaga_cloud_schema.sql`.
2. Jalankan `002_v37_auth_snapshot_sync.sql`.
3. Pada Supabase Authentication, aktifkan Email/Password.
4. Di SIAGA GURU pilih **Cloud + Offline**, masukkan Project URL dan anon/publishable key.
5. Klik **Uji Koneksi**, lalu buat/login Akun Cloud.
6. Pada perangkat pertama klik **Siapkan Data Cloud** kemudian **Kirim ke Cloud**.
7. Pada perangkat lain login dengan akun Cloud yang sama lalu klik **Ambil dari Cloud**.

Sinkronisasi v1 menggunakan satu snapshot ruang kerja per pengguna. Ini sengaja dipilih agar relasi siswa–nilai–absensi tetap utuh saat berpindah perangkat. Jika dua perangkat diedit bersamaan, pilih secara manual versi yang dipakai melalui **Kirim ke Cloud** atau **Ambil dari Cloud**.
