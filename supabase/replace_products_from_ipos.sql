-- Jalankan sekali di Supabase SQL Editor.
-- Fungsi ini mengganti seluruh isi public.products dalam satu transaksi.
-- Riwayat stock_opname dan expired_dates tidak dihapus.
create
or replace function public.replace_products_from_ipos(p_products jsonb) returns integer language plpgsql security definer
set
  search_path = pg_catalog,
  public,
  auth as $ $ declare v_total integer;

v_inserted integer;

begin -- Hanya pengguna yang sudah login yang boleh menjalankan impor.
if auth.uid() is null then raise exception 'Akses ditolak: pengguna harus login.';

end if;

if p_products is null
or jsonb_typeof(p_products) <> 'array' then raise exception 'Format data impor harus berupa JSON array.';

end if;

v_total := jsonb_array_length(p_products);

if v_total < 1
or v_total > 20000 then raise exception 'Jumlah produk tidak valid: %.',
v_total;

end if;

-- Validasi nama, barcode, dan stok sebelum menghapus data lama.
if exists (
  select
    1
  from
    jsonb_array_elements(p_products) as x(item)
  where
    nullif(btrim(item ->> 'nama_product'), '') is null
    or case
      when coalesce(item ->> 'stok_system', '') ~ '^[0-9]+$' then (item ->> 'stok_system') :: numeric > 2147483647
      else true
    end
) then raise exception 'Data produk tidak valid. Nama wajib diisi dan stok harus bilangan bulat nonnegatif.';

end if;

-- Barcode boleh kosong, tetapi barcode yang terisi tidak boleh duplikat.
if exists (
  select
    lower(btrim(item ->> 'sku'))
  from
    jsonb_array_elements(p_products) as x(item)
  where
    nullif(btrim(item ->> 'sku'), '') is not null
  group by
    lower(btrim(item ->> 'sku'))
  having
    count(*) > 1
) then raise exception 'Ditemukan barcode duplikat pada data impor.';

end if;

-- DELETE dan INSERT berada dalam transaksi yang sama.
-- Jika INSERT gagal, PostgreSQL membatalkan DELETE secara otomatis.
DELETE FROM
  public.products
WHERE
  id IS NOT NULL;

insert into
  public.products (sku, nama_product, stok_system)
select
  coalesce(item ->> 'sku', ''),
  btrim(item ->> 'nama_product'),
  (item ->> 'stok_system') :: integer
from
  jsonb_array_elements(p_products) as x(item);

get diagnostics v_inserted = row_count;

return v_inserted;

end;

$ $;

revoke all on function public.replace_products_from_ipos(jsonb)
from
  public;

grant execute on function public.replace_products_from_ipos(jsonb) to authenticated;