"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";

type ProdukImport = {
  sku: string;
  nama_product: string;
  stok_system: number;
};

type HasilParse = {
  products: ProdukImport[];
  skipped: number;
  errors: string[];
};

function parseCsv(text: string, delimiter = ";"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

function parseIposCsv(text: string): HasilParse {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  const headerIndex = rows.findIndex((row) =>
    row.some((cell) => cell.trim().toLowerCase() === "barcode") &&
    row.some((cell) => cell.trim().toLowerCase() === "nama item") &&
    row.some((cell) => cell.trim().toLowerCase() === "stok")
  );

  if (headerIndex < 0) {
    return {
      products: [],
      skipped: 0,
      errors: ["Header Barcode, Nama Item, dan Stok tidak ditemukan. Pastikan file berasal dari ekspor daftar item iPos."],
    };
  }

  const headers = rows[headerIndex].map((cell) => cell.trim().toLowerCase());
  const barcodeIndex = headers.indexOf("barcode");
  const nameIndex = headers.indexOf("nama item");
  const stockIndex = headers.indexOf("stok");

  const products: ProdukImport[] = [];
  const errors: string[] = [];
  let skipped = 0;
  const barcodeRows = new Map<string, number>();

  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i];
    const barcode = (row[barcodeIndex] ?? "").trim();
    const nama = (row[nameIndex] ?? "").trim();
    const rawStock = (row[stockIndex] ?? "").trim();

    // Baris judul, pemisah, dan footer laporan tidak dianggap sebagai produk.
    if (!nama) {
      skipped += 1;
      continue;
    }

    if (!rawStock) {
      // Footer laporan iPos biasanya berisi tanggal cetak dan nama operator.
      if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(barcode)) {
        skipped += 1;
        continue;
      }
      errors.push(`Baris CSV ${i + 1}: stok untuk "${nama}" kosong.`);
      continue;
    }

    // Ekspor iPos menggunakan koma sebagai pemisah desimal, misalnya 1,00.
    const normalizedStock = rawStock.replace(/\./g, "").replace(",", ".");
    const stockNumber = Number(normalizedStock);

    if (!Number.isFinite(stockNumber) || stockNumber < 0 || !Number.isInteger(stockNumber)) {
      errors.push(`Baris CSV ${i + 1}: stok "${rawStock}" untuk "${nama}" bukan bilangan bulat nonnegatif.`);
      continue;
    }

    if (barcode) {
      const key = barcode.toLowerCase();
      const previousRow = barcodeRows.get(key);
      if (previousRow !== undefined) {
        errors.push(`Barcode "${barcode}" duplikat pada baris CSV ${previousRow} dan ${i + 1}.`);
        continue;
      }
      barcodeRows.set(key, i + 1);
    }

    products.push({
      sku: barcode,
      nama_product: nama,
      stok_system: stockNumber,
    });
  }

  if (products.length === 0) {
    errors.push("Tidak ada baris produk valid yang ditemukan.");
  }

  return { products, skipped, errors };
}

export default function ImportProdukPage() {
  const [fileName, setFileName] = useState("");
  const [products, setProducts] = useState<ProdukImport[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [loadingFile, setLoadingFile] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const barcodeKosong = useMemo(
    () => products.filter((product) => !product.sku).length,
    [products]
  );

  const handleFile = async (file?: File) => {
    setResult("");
    setConfirmed(false);
    setProducts([]);
    setErrors([]);
    setSkipped(0);

    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setErrors(["Pilih file dengan format .csv."]);
      return;
    }

    setLoadingFile(true);
    setFileName(file.name);

    try {
      const parsed = parseIposCsv(await file.text());
      setProducts(parsed.products);
      setSkipped(parsed.skipped);
      setErrors(parsed.errors);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "File CSV gagal dibaca."]);
    } finally {
      setLoadingFile(false);
    }
  };

  const handleImport = async () => {
    if (!confirmed || products.length === 0 || errors.length > 0 || importing) return;

    const ok = window.confirm(
      `PERINGATAN: Seluruh data di tabel products akan diganti dengan ${products.length.toLocaleString("id-ID")} produk dari CSV. Lanjutkan?`
    );
    if (!ok) return;

    setImporting(true);
    setResult("");

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData.session) {
        throw new Error("Sesi login tidak ditemukan. Silakan login ulang.");
      }

      const { data, error } = await supabase.rpc("replace_products_from_ipos", {
        p_products: products,
      });

      if (error) {
        if (error.message.includes("replace_products_from_ipos")) {
          throw new Error("Fungsi SQL impor belum dibuat. Jalankan file SQL supabase/replace_products_from_ipos.sql di Supabase SQL Editor terlebih dahulu.");
        }
        throw error;
      }

      const importedCount =
        typeof data === "number"
          ? data
          : Number((data as { imported_count?: number } | null)?.imported_count ?? products.length);

      setResult(`Berhasil mengganti master produk. ${importedCount.toLocaleString("id-ID")} produk telah diimpor. Riwayat Stock Opname dan Expired Date tidak dihapus.`);
      setProducts([]);
      setConfirmed(false);
    } catch (error) {
      console.error("Import CSV iPos gagal:", error);
      setResult(error instanceof Error ? error.message : "Import gagal karena kesalahan yang tidak diketahui.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-800 sm:px-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-blue-600">NUSANTARA MART</p>
            <h1 className="text-2xl font-black text-slate-900 sm:text-3xl">Import Produk iPos</h1>
            <p className="mt-1 text-sm text-slate-500">Ganti seluruh master produk menggunakan file ekspor CSV iPos.</p>
          </div>
          <Link href="/" className="shrink-0 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
            ← Kembali
          </Link>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="font-bold text-slate-900">1. Pilih file CSV</h2>
          <p className="mt-1 text-sm text-slate-500">
            Format ekspor yang didukung: kolom <b>Barcode</b>, <b>Nama Item</b>, dan <b>Stok</b> dengan pemisah titik koma (;).
          </p>
          <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center hover:border-blue-400 hover:bg-blue-50">
            <span className="text-sm font-bold text-slate-700">{loadingFile ? "Membaca CSV..." : "Klik untuk memilih file CSV"}</span>
            <span className="mt-1 text-xs text-slate-500">File diproses di browser dan tidak diunggah ke penyimpanan eksternal.</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              disabled={loadingFile || importing}
              onChange={(event) => void handleFile(event.target.files?.[0])}
            />
          </label>
          {fileName && <p className="mt-3 text-sm text-slate-600">File dipilih: <b>{fileName}</b></p>}
        </section>

        {errors.length > 0 && (
          <section className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-5">
            <h2 className="font-bold text-rose-800">Validasi menemukan masalah ({errors.length})</h2>
            <ul className="mt-2 max-h-52 list-inside list-disc space-y-1 overflow-auto text-sm text-rose-700">
              {errors.slice(0, 30).map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}
            </ul>
            {errors.length > 30 && <p className="mt-2 text-xs text-rose-600">Menampilkan 30 dari {errors.length} masalah.</p>}
            <p className="mt-2 text-xs text-rose-700">Impor dinonaktifkan sampai seluruh masalah diperbaiki.</p>
          </section>
        )}

        {products.length > 0 && errors.length === 0 && (
          <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="font-bold text-slate-900">2. Pratinjau dan validasi</h2>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-blue-50 p-4">
                <p className="text-xs font-medium text-blue-700">Produk valid</p>
                <p className="mt-1 text-2xl font-black text-blue-900">{products.length.toLocaleString("id-ID")}</p>
              </div>
              <div className="rounded-xl bg-amber-50 p-4">
                <p className="text-xs font-medium text-amber-700">Barcode kosong</p>
                <p className="mt-1 text-2xl font-black text-amber-900">{barcodeKosong.toLocaleString("id-ID")}</p>
              </div>
              <div className="rounded-xl bg-slate-100 p-4">
                <p className="text-xs font-medium text-slate-600">Baris nonproduk dilewati</p>
                <p className="mt-1 text-2xl font-black text-slate-900">{skipped.toLocaleString("id-ID")}</p>
              </div>
            </div>

            <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="bg-slate-100 text-xs uppercase text-slate-600">
                  <tr><th className="px-3 py-3">Barcode</th><th className="px-3 py-3">Nama Produk</th><th className="px-3 py-3 text-right">Stok</th></tr>
                </thead>
                <tbody>
                  {products.slice(0, 8).map((product, index) => (
                    <tr key={`${product.sku}-${index}`} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-mono text-xs">{product.sku || <span className="text-amber-600">Kosong</span>}</td>
                      <td className="px-3 py-2">{product.nama_product}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{product.stok_system}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-500">Menampilkan 8 produk pertama sebagai sampel.</p>

            <label className="mt-5 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 accent-rose-600" />
              <span>Saya memahami bahwa seluruh data pada tabel <b>products</b> akan diganti. Riwayat Stock Opname dan Expired Date tidak dihapus, tetapi riwayat dengan SKU yang tidak ada lagi pada CSV tidak akan terhubung ke produk baru berdasarkan SKU.</span>
            </label>

            <button
              type="button"
              onClick={() => void handleImport()}
              disabled={!confirmed || importing}
              className="mt-4 w-full rounded-xl bg-rose-600 px-5 py-3 font-bold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {importing ? "Mengganti seluruh master produk..." : `Ganti Seluruh Master Produk (${products.length.toLocaleString("id-ID")} produk)`}
            </button>
          </section>
        )}

        {result && (
          <div className={`mt-5 rounded-xl border p-4 text-sm ${result.startsWith("Berhasil") ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`} role="status">
            {result}
            {result.startsWith("Berhasil") && <div className="mt-3"><Link href="/" className="font-bold underline">Kembali ke Master Produk</Link></div>}
          </div>
        )}

        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-900">
          <b>Catatan penting:</b> proses penggantian dijalankan dalam satu transaksi database. Jika proses gagal, perubahan akan dibatalkan dan data produk lama tetap ada. Pastikan file CSV merupakan ekspor terbaru sebelum melanjutkan.
        </div>
      </div>
    </main>
  );
}
