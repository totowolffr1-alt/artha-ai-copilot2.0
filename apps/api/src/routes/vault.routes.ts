/**
 * vault.routes.ts — Phase 19: Autonomous Trading Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * REST endpoints for Capital Allocation Vault and Risk Guardian management.
 */

import { Router, Request, Response } from 'express';
import { capitalVault } from '../../../../packages/phase5-strategy/src/vault/CapitalVault';
import { riskGuardian, emergencyKillSwitch, getPendingApprovals, resolveApproval } from '../services/orderExecutionService';

export const vaultRouter = Router();

// GET /api/vault/status — full vault and risk guardian status
vaultRouter.get('/status', (_req: Request, res: Response) => {
  const status = capitalVault.getStatus();
  const riskReport = riskGuardian.getRiskReport();
  const pendingApprovals = getPendingApprovals();
  res.json({ vault: status, risk: riskReport, pendingApprovals });
});

// POST /api/vault/allocate — allocate capital (₹100–₹10,00,000)
vaultRouter.post('/allocate', (req: Request, res: Response) => {
  const { amount } = req.body ?? {};
  if (typeof amount !== 'number') {
    return res.status(400).json({ error: 'amount (number) is required' });
  }

  const result = capitalVault.setAllocation(amount);
  if (!result.success) {
    return res.status(400).json({ error: result.message });
  }

  return res.json({ message: result.message, vault: capitalVault.getStatus() });
});

// POST /api/vault/top-up — top up capital mid-month
vaultRouter.post('/top-up', (req: Request, res: Response) => {
  const { amount } = req.body ?? {};
  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'positive amount (number) is required' });
  }

  const result = capitalVault.topUp(amount);
  return res.json({ message: result.message, vault: capitalVault.getStatus() });
});

// POST /api/vault/mode — switch PAPER vs LIVE mode
vaultRouter.post('/mode', (req: Request, res: Response) => {
  const { mode } = req.body ?? {};
  if (mode !== 'PAPER' && mode !== 'LIVE') {
    return res.status(400).json({ error: 'mode must be PAPER or LIVE' });
  }

  const result = capitalVault.setMode(mode);
  if (!result.success) {
    return res.status(400).json({ error: result.message });
  }

  return res.json({ message: result.message, vault: capitalVault.getStatus() });
});

// POST /api/vault/compound — toggle compounding mode
vaultRouter.post('/compound', (req: Request, res: Response) => {
  const { enabled } = req.body ?? {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled (boolean) is required' });
  }

  capitalVault.setCompoundMode(enabled);
  return res.json({ message: `Compound mode set to ${enabled ? 'ON' : 'OFF'}`, vault: capitalVault.getStatus() });
});

// POST /api/vault/resume — resume trading from drawdown pause
vaultRouter.post('/resume', (_req: Request, res: Response) => {
  capitalVault.resumeFromPause();
  return res.json({ message: 'Vault resumed from pause.', vault: capitalVault.getStatus() });
});

// POST /api/vault/killswitch — emergency lock all trading
vaultRouter.post('/killswitch', (_req: Request, res: Response) => {
  emergencyKillSwitch();
  return res.json({ message: 'Emergency Kill Switch activated. All trading halted.', vault: capitalVault.getStatus() });
});

// POST /api/vault/unlock — unlock locked vault
vaultRouter.post('/unlock', (_req: Request, res: Response) => {
  capitalVault.unlock();
  return res.json({ message: 'Vault unlocked.', vault: capitalVault.getStatus() });
});

// POST /api/vault/approve — human approval endpoint for large trades
vaultRouter.post('/approve', (req: Request, res: Response) => {
  const { signalId, approved } = req.body ?? {};
  if (!signalId || typeof approved !== 'boolean') {
    return res.status(400).json({ error: 'signalId (string) and approved (boolean) are required' });
  }

  const ok = resolveApproval(signalId, approved);
  if (!ok) {
    return res.status(404).json({ error: 'Pending trade not found or already expired' });
  }

  return res.json({ message: `Trade ${approved ? 'APPROVED' : 'REJECTED'}` });
});
