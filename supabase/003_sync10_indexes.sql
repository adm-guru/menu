-- SIAGA GURU Sync 1.0
-- Jalankan SETELAH 001_siaga_cloud_schema.sql dan 002_v37_auth_snapshot_sync.sql.
-- Tidak mengubah data; hanya menambahkan index untuk pemeriksaan revision/updated_at.

create index if not exists idx_workspace_snapshots_updated_at
  on public.workspace_snapshots(updated_at desc);

create index if not exists idx_workspace_snapshots_device_id
  on public.workspace_snapshots(device_id);
