/** The artifact runtime's `assets` (Supabase Storage) and `downloads` capabilities. */
import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "assets";
const MAX = 20 * 1024 * 1024;

export function createAssets(sb: SupabaseClient) {
  const urlOf = (id: string) => sb.storage.from(BUCKET).getPublicUrl(id).data.publicUrl;
  return Object.freeze({
    async upload(blob: Blob, opts?: { type?: string }) {
      const { data: s } = await sb.auth.getSession();
      const uid = s.session?.user.id;
      if (!uid) throw { code: "not_granted", message: "Sign in to upload files" };
      if (blob.size > MAX) throw { code: "too_large", message: "Files can be at most 20 MB" };
      const contentType = opts?.type || blob.type || "application/octet-stream";
      const name = (blob as File).name?.replace(/[^A-Za-z0-9._-]/g, "_") || "file";
      const id = `${uid}/${crypto.randomUUID()}-${name}`;
      const { error } = await sb.storage.from(BUCKET).upload(id, blob, { contentType, upsert: false });
      if (error) throw { code: "upstream_error", message: error.message };
      return { id, url: urlOf(id), sizeBytes: blob.size, contentType };
    },
    async list() {
      const { data: s } = await sb.auth.getSession();
      const uid = s.session?.user.id;
      if (!uid) return { assets: [], usage: { files: 0, bytes: 0, maxFiles: 1000, maxBytes: 1024 * MAX } };
      const { data } = await sb.storage.from(BUCKET).list(uid, { limit: 1000 });
      const assets = (data ?? []).map((f) => ({
        id: `${uid}/${f.name}`, url: urlOf(`${uid}/${f.name}`),
        contentType: (f.metadata?.mimetype as string) || "", sizeBytes: (f.metadata?.size as number) || 0, createdAt: f.created_at || "",
      }));
      return { assets, usage: { files: assets.length, bytes: assets.reduce((a, x) => a + x.sizeBytes, 0), maxFiles: 1000, maxBytes: 1024 * MAX } };
    },
    async delete(id: string) {
      const { data, error } = await sb.storage.from(BUCKET).remove([id]);
      if (error) throw { code: "upstream_error", message: error.message };
      return { deleted: (data ?? []).length > 0 };
    },
  });
}

export const downloads = Object.freeze({
  async save({ filename, data }: { filename: string; data: string | Blob | ArrayBuffer | ArrayBufferView }) {
    const blob = data instanceof Blob ? data : new Blob([data as BlobPart]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return { status: "saved" as const };
  },
});
