import type {
  Business,
  BrandKit,
  BusinessProfile,
  BusinessGoal,
  Campaign,
  Caption,
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
  designerModel: string;
  freeModel: string;
  visionModel: string;
  critiqueModel: string;
  captionModel: string;
  campaignModel: string;
  backgroundModel: string;
  templatesModel: string;
  alternativesModel: string;
  photoFitModel: string;
  designerSystem: string;
  freeSystem: string;
  templatesSystem: string;
  freeMaxTokens: number | null;
}
export interface SettingsResponse {
  settings: AiSettings;
  defaults: { designerSystem: string; freeSystem: string; templatesSystem: string; freeMaxTokens: number };
  envModels: { model: string; modelSmall: string; modelLarge: string };
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
  },
) => request<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const deleteProject = (id: string) =>
  request<{ ok: boolean }>(`/projects/${id}`, { method: 'DELETE' });

export const draftProject = (id: string, paragraph: string, mode: 'designer' | 'free' = 'designer') =>
  request<Project>(`/projects/${id}/draft`, {
    method: 'POST',
    body: JSON.stringify({ paragraph, mode }),
  });

/** (Re)generate the social caption for a project's current slides, in the brand voice. */
export const generateProjectCaption = (id: string) =>
  request<Project>(`/projects/${id}/caption`, { method: 'POST' });

export interface CritiqueReportItem {
  slideId: string;
  order: number;
  issues: string[];
  applied: string[];
}

/** Self-critique the rendered slides and auto-apply bounded layout fixes. */
export const polishProject = (id: string) =>
  request<{ project: Project; report: CritiqueReportItem[] }>(`/projects/${id}/critique`, {
    method: 'POST',
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

/** 3 AI-proposed layout alternatives for one slide (same copy, new structure). */
export const getSlideAlternatives = (projectId: string, slideId: string) =>
  request<{ alternatives: Slide[] }>(`/projects/${projectId}/slides/${slideId}/alternatives`, {
    method: 'POST',
  });

// ── Campaigns ───────────────────────────────────────────────────────────────
export const listCampaigns = (businessId: string) =>
  request<Campaign[]>(`/businesses/${businessId}/campaigns`);

export const getCampaign = (id: string) => request<Campaign>(`/campaigns/${id}`);

export const createCampaign = (
  businessId: string,
  data: { name?: string; brief: string; count: number; goal?: BusinessGoal; type: AssetType; format: Format },
) =>
  request<Campaign>(`/businesses/${businessId}/campaigns`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

/** Draft one campaign concept into a real project (returns the created/linked project). */
export const draftConcept = (campaignId: string, conceptId: string) =>
  request<Project>(`/campaigns/${campaignId}/concepts/${conceptId}/draft`, { method: 'POST' });

/** Edit a concept's title/angle/paragraph. Returns the updated campaign. */
export const editConcept = (
  campaignId: string,
  conceptId: string,
  data: { title?: string; angle?: string; paragraph?: string },
) =>
  request<Campaign>(`/campaigns/${campaignId}/concepts/${conceptId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

/** Move a concept up (-1) or down (+1) in the series order. */
export const moveConcept = (campaignId: string, conceptId: string, dir: -1 | 1) =>
  request<Campaign>(`/campaigns/${campaignId}/concepts/${conceptId}/move`, {
    method: 'POST',
    body: JSON.stringify({ dir }),
  });

/** Regenerate ONE undrafted concept with a fresh angle. */
export const regenerateConcept = (campaignId: string, conceptId: string) =>
  request<Campaign>(`/campaigns/${campaignId}/concepts/${conceptId}/regenerate`, {
    method: 'POST',
  });

export const deleteCampaign = (id: string) =>
  request<{ ok: boolean }>(`/campaigns/${id}`, { method: 'DELETE' });

// ── Media ───────────────────────────────────────────────────────────────────
export const listMedia = (businessId: string) =>
  request<MediaAsset[]>(`/businesses/${businessId}/media`);

export const regenerateBackgrounds = (businessId: string, colors: object, count = 3) =>
  request<MediaAsset[]>(`/businesses/${businessId}/media/backgrounds`, {
    method: 'POST',
    body: JSON.stringify({ colors, count }),
  });

/** Generate one AI background (SVG). Returns the new media asset. */
export const generateAiBackground = (
  businessId: string,
  colors: object,
  extra?: { styleDescriptor?: string; businessName?: string },
) =>
  request<MediaAsset>(`/businesses/${businessId}/media/backgrounds/ai`, {
    method: 'POST',
    body: JSON.stringify({ colors, ...extra }),
  });

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

/** (Re)design the brand's signature composition pack (one premium-tier AI call). */
export const regenerateTemplatePack = (kitId: string) =>
  request<BrandKit>(`/brandkits/${kitId}/templates`, { method: 'POST' });

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
