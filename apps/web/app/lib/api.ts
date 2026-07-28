import type {
  Business,
  BrandKit,
  BusinessProfile,
  Caption,
  MediaAsset,
  Project,
  ProjectSettings,
  Slide,
  SlidePhoto,
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
  /** The approved kit's identity, for showing the brand on list cards. */
  kit?: { colors: BrandKit['colors']; logoUrl?: string };
}

/** Business detail also carries its project summaries. */
export interface BusinessDetail extends BusinessSummary {
  projects: Array<Pick<Project, '_id' | 'title' | 'type' | 'format' | 'status' | 'slides' | 'updatedAt' | 'campaignId'>>;
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
  // Guard the parse: a proxy or crashed dev server can answer with an HTML
  // error page — surface that as a readable error, not a raw SyntaxError.
  let data: any;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    throw new ApiClientError(res.status, `Server returned an invalid response (HTTP ${res.status}).`);
  }
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
  visionModel: string;
  captionModel: string;
  photoFitModel: string;
  recipeModel: string;
  composeModel: string;
}
export interface SettingsResponse {
  settings: AiSettings;
  envModels: { model: string; modelSmall: string; modelLarge: string; modelDesign: string };
  stock?: { configured: boolean };
}
export const getSettings = () => request<SettingsResponse>('/settings');
export const updateSettings = (s: Partial<AiSettings>) =>
  request<unknown>('/settings', { method: 'PUT', body: JSON.stringify(s) });

export interface UsageSummary {
  totals: { calls: number; inputTokens: number; outputTokens: number; costUsd: number };
  byModel: Array<{ model: string; calls: number; inputTokens: number; outputTokens: number; costUsd: number }>;
  recent: Array<{ feature: string; model: string; inputTokens: number; outputTokens: number; costUsd: number; createdAt: string }>;
}
export const getUsage = () => request<UsageSummary>('/usage');

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
  /** Save the prompt now and compose later (creates an Ideas card). */
  idea?: string;
  stage?: 'idea' | 'drafting' | 'ready' | 'shipped';
  slides?: Array<
    Pick<Slide, 'layoutType' | 'blocks' | 'imageNeed'> &
      Partial<Pick<Slide, 'order' | 'mediaAssetId' | 'overrides'>>
  >;
}) => request<Project>('/projects', { method: 'POST', body: JSON.stringify(data) });

export const updateProject = (
  id: string,
  data: {
    title?: string;
    status?: 'draft' | 'rendered';
    slides?: Slide[];
    settings?: ProjectSettings;
    caption?: Caption;
    /** Re-editing a parked Ideas card before composing it. Type/format only
     *  take effect while the project still has no slides. */
    idea?: string;
    type?: AssetType;
    format?: Format;
  },
) => request<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const deleteProject = (id: string) =>
  request<{ ok: boolean }>(`/projects/${id}`, { method: 'DELETE' });

/**
 * Replace a slide's photo list in one atomic write. Upload the bytes first with
 * `uploadMedia` (which content-sniffs and sanitises them) and place the returned
 * asset id here.
 */
export const saveSlidePhotos = (projectId: string, slideId: string, photos: SlidePhoto[]) =>
  request<Project>(`/projects/${projectId}/slides/${slideId}/photos`, {
    method: 'PUT',
    body: JSON.stringify({ photos }),
  });

/** (Re)generate the social caption for a project's current slides, in the brand voice. */
export const generateProjectCaption = (id: string) =>
  request<Project>(`/projects/${id}/caption`, { method: 'POST' });

/** AI-compose: turn an idea into on-brand AUTHORED slides using the brand recipe. */
export const composeProjectAI = (id: string, idea: string, slideCount?: number) =>
  request<Project>(
    `/projects/${id}/compose`,
    { method: 'POST', body: JSON.stringify({ idea, ...(slideCount ? { slideCount } : {}) }) },
    180_000,
  );

/** Alternative arrangements for ONE slide — same copy, different composition.
 *  Nothing is saved until the user applies one. */
export const getSlideVariants = (projectId: string, slideId: string, count = 2) =>
  request<{ variants: Array<{ html: string; bg?: string; role?: string }> }>(
    `/projects/${projectId}/slides/${slideId}/variants?count=${count}`,
    { method: 'POST' },
    180_000,
  );

/** Instant deterministic slide tweaks (no AI): headline size, inverse surface. */
export const tweakSlide = (
  projectId: string,
  slideId: string,
  tweak: 'bigger-headline' | 'smaller-headline' | 'invert' | 'un-invert',
) =>
  request<Project>(`/projects/${projectId}/slides/${slideId}/tweak`, {
    method: 'POST',
    body: JSON.stringify({ tweak }),
  });

/** Author (or re-author) the brand's design recipe from its kit evidence (design tier). */
export const authorBrandRecipe = (kitId: string, verify = false) =>
  request<{ _id: string; recipe?: unknown }>(
    `/brandkits/${kitId}/recipe${verify ? '?verify=1' : ''}`,
    { method: 'POST' },
    300_000,
  );

// ── The Desk (board) ────────────────────────────────────────────────────────
export interface BoardCard {
  _id: string;
  businessId: string;
  title: string;
  type: AssetType;
  format: Format;
  stage: 'idea' | 'drafting' | 'ready' | 'shipped';
  idea: string;
  slideCount: number;
  authored: { html: string; bg?: string; role?: string } | null;
  exportedAt: string | null;
  postedAt: string | null;
  updatedAt: string;
}
export interface BoardResponse {
  cards: BoardCard[];
  businesses: Array<{ _id: string; name: string }>;
  kits: Record<string, BrandKit>;
}
/** The whole board in ONE call (cards + the kits needed to render thumbnails). */
export const getBoard = () => request<BoardResponse>('/projects/board');

export const setProjectStage = (
  id: string,
  stage: BoardCard['stage'],
  posted?: boolean,
) =>
  request<Project>(`/projects/${id}/stage`, {
    method: 'PATCH',
    body: JSON.stringify({ stage, ...(posted === undefined ? {} : { posted }) }),
  });

// ── Stock photos ────────────────────────────────────────────────────────────
export interface StockCandidate {
  thumb: string;
  full: string;
  width: number;
  height: number;
  alt: string;
  photographer: string;
}
export const searchStockPhotos = (businessId: string, query: string, orientation: string) =>
  request<{ candidates: StockCandidate[] }>(
    `/businesses/${businessId}/media/stock/search?query=${encodeURIComponent(query)}&orientation=${orientation}`,
  );
/** Download the picked candidate into the library; returns the new MediaAsset. */
export const storeStockPhoto = (businessId: string, c: StockCandidate) =>
  request<MediaAsset>(`/businesses/${businessId}/media/stock`, {
    method: 'POST',
    body: JSON.stringify({ full: c.full, width: c.width, height: c.height }),
  });

/** LAN address a phone on the same Wi-Fi can open (send-to-phone hand-off). */
export const getShareInfo = (id: string) =>
  request<{ url: string; onLan: boolean; hasRenders: number }>(`/projects/${id}/share-info`);

// ── Version history ─────────────────────────────────────────────────────────
export interface ProjectVersion {
  _id: string;
  label: string;
  createdAt: string;
  slideCount: number;
}
export const listProjectVersions = (id: string) =>
  request<{ versions: ProjectVersion[] }>(`/projects/${id}/versions`);
export const saveProjectVersion = (id: string, label?: string) =>
  request<{ ok: boolean }>(`/projects/${id}/versions`, {
    method: 'POST',
    body: JSON.stringify({ label }),
  });
/** Restore a snapshot (the current state is snapshotted first). Returns the project. */
export const restoreProjectVersion = (id: string, versionId: string) =>
  request<Project>(`/projects/${id}/versions/${versionId}/restore`, { method: 'POST' });

// ── Media ───────────────────────────────────────────────────────────────────
export const listMedia = (businessId: string) =>
  request<MediaAsset[]>(`/businesses/${businessId}/media`);

export const deleteMedia = (businessId: string, assetId: string) =>
  request<void>(`/businesses/${businessId}/media/${assetId}`, { method: 'DELETE' });

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
  voice?: string;
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

/** (Re)design the brand's complete package — layouts + matched backgrounds (one AI call). */
export const regenerateBrandPackage = (kitId: string) =>
  request<BrandKit>(`/brandkits/${kitId}/package`, { method: 'POST' });

export async function uploadMedia(businessId: string, file: File): Promise<MediaAsset> {
  const fd = new FormData();
  fd.append('file', file);
  // Uploads get their own timeout (large files, no JSON content-type header).
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);
  let res: Response;
  try {
    res = await fetch(api(`/businesses/${businessId}/media`), { method: 'POST', body: fd, signal: ctrl.signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new ApiClientError(0, 'Upload timed out — try a smaller file or check the server.');
    }
    throw new ApiClientError(0, 'Cannot reach API — is it running?');
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    throw new ApiClientError(res.status, `Server returned an invalid response (HTTP ${res.status}).`);
  }
  if (!res.ok) throw new ApiClientError(res.status, (data && data.error) || `HTTP ${res.status}`);
  return data as MediaAsset;
}
