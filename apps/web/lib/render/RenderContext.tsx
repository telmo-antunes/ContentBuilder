'use client';

import { createContext, useContext } from 'react';
import type { ThemePreset } from '@contentbuilder/shared';

export interface RenderCtx {
  /** True when rendering for PNG export (the hidden /render route). */
  forExport: boolean;
  /** Active theme preset driving the decorative language. */
  theme: ThemePreset;
}

const Ctx = createContext<RenderCtx>({ forExport: false, theme: 'editorial' });

export const RenderProvider = Ctx.Provider;
export const useRenderCtx = () => useContext(Ctx);
