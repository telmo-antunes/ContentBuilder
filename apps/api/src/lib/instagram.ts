/**
 * WHAT THE POST DID — Instagram's own numbers, pulled through the Graph API.
 *
 * Everything upstream of here judges a deck before it ships: the rubric, the
 * critique, the owner's score. This is the only signal from after: reach,
 * saves, shares, likes and comments on the post the deck became. Stored on
 * the project beside the score and the prompt versions, so a form or a
 * prompt change can be checked against what readers actually did.
 *
 * Credentials live in the Settings document (never in a URL, never returned
 * whole): an Instagram Graph API access token for a Business or Creator
 * account, and that account's IG user id. The owner links a project to a
 * post by pasting its permalink; the media id is resolved from the account's
 * recent media and remembered.
 */
import { SettingModel } from '../models';

const GRAPH = 'https://graph.facebook.com/v21.0';

export interface InstagramCredentials {
  accessToken: string;
  userId: string;
}

export async function instagramCredentials(): Promise<InstagramCredentials | null> {
  const doc = (await SettingModel.findOne({ key: 'ai' }).lean()) as Record<string, unknown> | null;
  const accessToken = String(doc?.instagramAccessToken ?? '').trim();
  const userId = String(doc?.instagramUserId ?? '').trim();
  return accessToken && userId ? { accessToken, userId } : null;
}

export interface InstagramMedia {
  id: string;
  permalink?: string;
  caption?: string;
  timestamp?: string;
  mediaType?: string;
}

async function graph<T>(path: string, params: Record<string, string>, token: string): Promise<T> {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  // The token travels as a query parameter because that is the only place
  // the Graph API reads it from; it is never logged and never echoed.
  url.searchParams.set('access_token', token);
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number } } & T;
  if (!res.ok || json.error) {
    const msg = json.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`Instagram: ${msg}`);
  }
  return json;
}

/** The account's recent posts — enough to match a pasted permalink. */
export async function listRecentMedia(creds: InstagramCredentials, limit = 50): Promise<InstagramMedia[]> {
  const out = await graph<{ data?: Array<Record<string, string>> }>(`${creds.userId}/media`, {
    fields: 'id,permalink,caption,timestamp,media_type',
    limit: String(Math.min(100, Math.max(1, limit))),
  }, creds.accessToken);
  return (out.data ?? []).map((m) => ({
    id: String(m.id),
    permalink: m.permalink,
    caption: m.caption,
    timestamp: m.timestamp,
    mediaType: m.media_type,
  }));
}

/** Two permalinks name the same post when their shortcode matches. */
export function permalinkCode(url: string | undefined): string | undefined {
  const m = /instagram\.com\/(?:[^/?]+\/)?(?:p|reel)\/([A-Za-z0-9_-]+)/.exec(url ?? "");
  return m?.[1];
}

export interface MediaInsights {
  reach?: number;
  impressions?: number;
  likes?: number;
  comments?: number;
  saved?: number;
  shares?: number;
  totalInteractions?: number;
  fetchedAt: Date;
}

/**
 * The post's metrics. `impressions` is gone for media created after the 2025
 * deprecation, so it is requested separately and its absence tolerated.
 */
export async function mediaInsights(creds: InstagramCredentials, mediaId: string): Promise<MediaInsights> {
  const read = async (metric: string) => {
    const out = await graph<{ data?: Array<{ name: string; values?: Array<{ value: number }>; total_value?: { value: number } }> }>(
      `${mediaId}/insights`,
      { metric },
      creds.accessToken,
    );
    const map: Record<string, number> = {};
    for (const d of out.data ?? []) {
      const v = d.total_value?.value ?? d.values?.[0]?.value;
      if (typeof v === 'number') map[d.name] = v;
    }
    return map;
  };
  const core = await read('reach,saved,shares,likes,comments,total_interactions');
  let impressions: number | undefined;
  try {
    impressions = (await read('impressions')).impressions;
  } catch {
    /* not available for this media — fine */
  }
  return {
    reach: core.reach,
    impressions,
    likes: core.likes,
    comments: core.comments,
    saved: core.saved,
    shares: core.shares,
    totalInteractions: core.total_interactions,
    fetchedAt: new Date(),
  };
}
