import { Router } from 'express';
import { asyncHandler } from '../lib/http';
import { getUsageSummary } from '../lib/usage';

export const usageRouter = Router();

// Aggregate AI token usage + estimated cost (totals, per-model, recent calls).
usageRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(await getUsageSummary());
  }),
);
