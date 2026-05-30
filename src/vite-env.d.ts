/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_CLOUDINARY_CLOUD_NAME: string;
  readonly VITE_CLOUDINARY_UPLOAD_PRESET: string;
  /** Legacy / menú público u otros flujos; el panel no depende de estas variables. */
  readonly VITE_PUBLIC_COMPANY_SLUG?: string;
  readonly VITE_COMPANY_SLUG?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
