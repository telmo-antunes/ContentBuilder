import type {
  Business,
  BrandKit,
  BusinessProfile,
  MediaAsset,
  Project,
  ProjectSettings,
  Slide,
  AssetType,
  Format,
} from '@contentbuilder/shared';
import { api } from './config';

/** Business list/detail view model — core fields plus server-computed summary. */
export interface BusinessSummary extends Business {
  hasApprovedKit: boolean;
  hasDraftKit: boolean;
  hasProfile: boolean;
  projectCount: number;
}

/** Business detail also carries its project summaries. */
export interface BusinessDetail extends BusinessSummary {
  projects: Array<Pick<Project, '_id' | 'title' | 'type' | 'format' | 'status' | 'slides' | 'updatedAt'>>;
}

/** Project fetched for the editor — bundled with its approved kit + business media. */
export interface ProjectDetail extends Project {
  brandKit: BrandKit | null;
  media: MediaAsset[];
}

export class ApiClientError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit, timeoutMs = 120_000): Promise<T> {
  let res: Response;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    res = await fetch(api(path), {
      ...init,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new ApiClientError(0, `Request timed out after ${Math.round(timeoutMs / 1000)}s — the server may be busy. Please try again.`);
    }
    throw new ApiClientError(0, `Cannot reach API at ${api(path)} — is it running?`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const message = (data && (data.error as string)) || `HTTP ${res.status}`;
    throw new ApiClientError(res.status, message, data?.details);
  }
  return data as T;
}

export interface HealthResponse {
  status: string;
  db: string;
  ai: { vision: boolean; draft: boolean; free?: boolean };
  time: string;
}

export const getHealth = () => request<HealthResponse>('/health');

export interface AiSettings {
  designerModel: string;
  freeModel: string;
  designerSystem: string;
  freeSystem: string;
  freeMaxTokens: number | null;
}
export interface SettingsResponse {
  settings: AiSettings;
  defaults: { designerSystem: string; freeSystem: string; freeMaxTokens: number };
  envModels: { model: string; modelSmall: string; modelLarge: string };
}
export const getSettings = () => request<SettingsResponse>('/settings');
export const updateSettings = (s: Partial<AiSettings>) =>
  request<unknown>('/settings', { method: 'PUT', body: JSON.stringify(s) });

export const listBusinesses = () => request<BusinessSummary[]>('/businesses');

export const getBusiness = (id: string) => request<BusinessDetail>(`/businesses/${id}`);

export const createBusiness = (data: { name: string; websiteUrl?: string }) =>
  request<Business>('/businesses', { method: 'POST', body: JSON.stringify(data) });

export const updateBusiness = (
  id: string,
  data: { name?: string; websiteUrl?: string; profile?: BusinessProfile | null },
) => request<Business>(`/businesses/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const deleteBusiness = (id: string) =>
  request<{ ok: boolean }>(`/businesses/${id}`, { method: 'DELETE' });

// ── Projects ──────────────────────────────────────────────────────────────────
export const listProjects = (businessId: string) =>
  request<Project[]>(`/projects?businessId=${encodeURIComponent(businessId)}`);

export const getProject = (id: string) => request<ProjectDetail>(`/projects/${id}`);

export const createProject = (data: {
  businessId: string;
  title: string;
  type: AssetType;
  format: Format;
  slides?: Array<
    Pick<Slide, 'layoutType' | 'blocks' | 'imageNeed'> &
      Partial<Pick<Slide, 'order' | 'mediaAssetId' | 'overrides'>>
  >;
}) => request<Project>('/projects', { method: 'POST', body: JSON.stringify(data) });

export const updateProject = (
  id: string,
  data: { title?: string; status?: 'draft' | 'rendered'; slides?: Slide[]; settings?: ProjectSettings },
) => request<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const deleteProject = (id: string) =>
  request<{ ok: boolean }>(`/projects/${id}`, { method: 'DELETE' });

export const draftProject = (id: string, paragraph: string, mode: 'designer' | 'free' = 'designer') =>
  request<Project>(`/projects/${id}/draft`, {
    method: 'POST',
    body: JSON.stringify({ paragraph, mode }),
  });

// ── Media ───────────────────────────────────────────────────────────────────
export const listMedia = (businessId: string) =>
  request<MediaAsset[]>(`/businesses/${businessId}/media`);

// ── Brand kits ────────────────────────────────────────────────────────────────
export interface BrandKitState {
  draft: BrandKit | null;
  approved: BrandKit | null;
}

export interface BrandKitEdit {
  colors?: BrandKit['colors'];
  fonts?: { render: { heading: string; body: string } };
  logo?: { key: string; url: string; sourceUrl?: string };
  logoTreatment?: 'original' | 'mono';
  styleDescriptor?: string;
  status?: 'draft' | 'approved';
}

export const getBrandKit = (businessId: string) =>
  request<BrandKitState>(`/businesses/${businessId}/brandkit`);

export const analyzeBusiness = (businessId: string) =>
  request<BrandKit>(`/businesses/${businessId}/analyze`, { method: 'POST' });

export const createManualKit = (businessId: string) =>
  request<BrandKit>(`/businesses/${businessId}/brandkit`, { method: 'POST' });

export const patchBrandKit = (kitId: string, data: BrandKitEdit) =>
  request<BrandKit>(`/brandkits/${kitId}`, { method: 'PATCH', body: JSON.stringify(data) });

export async function uploadMedia(businessId: string, file: File): Promise<MediaAsset> {
  const fd = new FormData();
  fd.append('file', file);
  let res: Response;
  try {
    res = await fetch(api(`/businesses/${businessId}/media`), { method: 'POST', body: fd });
  } catch {
    throw new ApiClientError(0, 'Cannot reach API — is it running?');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiClientError(res.status, (data && data.error) || `HTTP ${res.status}`);
  return data as MediaAsset;
}
