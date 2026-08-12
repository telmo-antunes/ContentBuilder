/**
 * Delete orphaned render-check scaffolds.
 *
 * `createRenderScaffold` writes a throwaway business + kit + project per deck
 * and `dispose()` removes them in a `finally`. A compose that never settles
 * never reaches that `finally`, so the scaffold survives — four were left in one
 * afternoon by three stalled runs, and they show up in `GET /businesses`
 * alongside real brands.
 *
 * The ceiling in renderCheck.ts should stop new ones appearing; this clears what
 * earlier runs left, and gives an easy way to check.
 *
 *   npm run scaffolds:orphans --workspace=apps/api --          # list only
 *   npm run scaffolds:orphans --workspace=apps/api -- --delete
 */
import mongoose from 'mongoose'
import { BusinessModel, BrandKitModel, ProjectModel } from '../models'

/** Exactly what createRenderScaffold names them: `__<label>-<8 hex>`. */
const SCAFFOLD_NAME = /^__render-check-[0-9a-f]{8}$/

async function main() {
  const del = process.argv.includes('--delete')
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/contentbuilder'
  await mongoose.connect(uri)

  // Matched on the anchored pattern rather than a prefix `$regex`, so a real
  // brand that merely starts with the same characters can never be swept.
  const all = await BusinessModel.find({ name: /^__render-check-/ }).lean()
  const scaffolds = all.filter((b) => SCAFFOLD_NAME.test(String(b.name)))
  const skipped = all.length - scaffolds.length

  if (!scaffolds.length) {
    console.log('No orphaned render-check scaffolds.')
  } else {
    console.log(`${scaffolds.length} orphaned scaffold(s):`)
    for (const b of scaffolds) console.log(`  ${b._id}  ${b.name}`)
    if (skipped) console.log(`  (${skipped} near-match(es) left alone — name did not match exactly)`)
  }

  if (!del) {
    if (scaffolds.length) console.log('\nRe-run with --delete to remove them.')
    await mongoose.disconnect()
    return
  }

  const ids = scaffolds.map((b) => b._id)
  const [projects, kits, businesses] = await Promise.all([
    ProjectModel.deleteMany({ businessId: { $in: ids } }),
    BrandKitModel.deleteMany({ businessId: { $in: ids } }),
    BusinessModel.deleteMany({ _id: { $in: ids } }),
  ])
  console.log(
    `\nDeleted ${businesses.deletedCount} business(es), ${kits.deletedCount} kit(s), ` +
      `${projects.deletedCount} project(s).`,
  )
  await mongoose.disconnect()
}

main().catch((e) => { console.error('sweep failed', e); process.exit(1) })
