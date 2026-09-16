/**
 * Offline cache for plans (blueprints/maps).
 *
 * The API serves plans with short-lived signed URLs, which made the viewer
 * unusable without connectivity — the field scenario this app is built for.
 * Here we mirror the metadata and keep a copy of the image on disk so a plan
 * that was opened once can be reviewed (and anchored) offline.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { getCachedPlan, upsertCachedPlan } from './db';
import type { Plan } from './types';

const PLANS_DIR = `${FileSystem.documentDirectory ?? ''}fotoproy/plans/`;

/** Extension taken from the (signed) URL, defaulting to jpg. */
function extensionFor(url: string): string {
  const clean = url.split('?')[0] ?? '';
  const match = clean.match(/\.(jpe?g|png|webp|heic)$/i);
  return match ? `.${match[1].toLowerCase()}` : '.jpg';
}

async function fileExists(uri: string | null | undefined): Promise<boolean> {
  if (!uri) {
    return false;
  }
  const info = await FileSystem.getInfoAsync(uri).catch(() => null);
  return info?.exists === true;
}

/** Writes the plan mirror, preserving any image already cached on disk. */
async function mirror(plan: Plan, localUri: string | null): Promise<void> {
  const previous = await getCachedPlan(plan.id);
  const kept = (await fileExists(localUri)) ? localUri : (previous?.localUri ?? null);
  await upsertCachedPlan({
    id: plan.id,
    projectId: plan.projectId,
    title: plan.title,
    localUri: kept,
    remoteUrl: plan.fileUrl,
    thumbnailUrl: plan.thumbnailUrl,
    pageCount: plan.pageCount,
    planKind: plan.planKind,
    createdAt: plan.createdAt,
    syncedAt: new Date().toISOString(),
  });
}

/** Mirrors metadata only (cheap) — used by the plans list. */
export async function cachePlans(plans: Plan[]): Promise<void> {
  for (const plan of plans) {
    await mirror(plan, null);
  }
}

/** Mirrors metadata and downloads the plan image for offline viewing. */
export async function cachePlan(plan: Plan): Promise<void> {
  await mirror(plan, null);
  if (plan.planKind !== 'IMAGE' || !plan.fileUrl) {
    return; // PDFs are not rendered yet (F3.0 spike pending)
  }
  const cached = await getCachedPlan(plan.id);
  if (await fileExists(cached?.localUri)) {
    return; // already downloaded on a previous visit
  }
  try {
    await FileSystem.makeDirectoryAsync(PLANS_DIR, { intermediates: true }).catch(() => undefined);
    const target = `${PLANS_DIR}${plan.id}${extensionFor(plan.fileUrl)}`;
    const result = await FileSystem.downloadAsync(plan.fileUrl, target);
    if (result.status === 200) {
      await mirror(plan, target);
    }
  } catch {
    // Non-fatal: the plan keeps working while online.
  }
}

/** Local copy of a plan image, or null when it was never downloaded. */
export async function localPlanUri(planId: string): Promise<string | null> {
  const cached = await getCachedPlan(planId);
  return (await fileExists(cached?.localUri)) ? (cached?.localUri ?? null) : null;
}
