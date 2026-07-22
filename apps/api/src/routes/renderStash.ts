import { Router } from 'express';
import { ApiError, asyncHandler } from '../lib/http';
import { getStash } from '../lib/renderStash';

/**
 * Read-only endpoint the hidden web `/render?stashId=…` page fetches to render an
 * ad-hoc candidate composition (see lib/renderStash.ts). Write is in-process only
 * (the design pipeline calls `putStash` directly), so there is intentionally no
 * POST here.
 */
export const renderStashRouter = Router();

renderStashRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = (req.params as { id?: string }).id;
    if (!id) throw new ApiError(400, 'missing stash id');
    const payload = getStash(id);
    if (!payload) throw new ApiError(404, 'Render payload not found or expired');
    res.json(payload);
  }),
);
